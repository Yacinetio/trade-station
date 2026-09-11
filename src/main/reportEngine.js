/**
 * Generic report engine — TradeZella-parity "50+ reports".
 *
 * Pure module: a registry of dimensions (bucketing functions over trades) plus
 * computeReport / applyReportFilter / compareReports. No Electron imports so
 * everything is unit-testable and reusable (IPC layer lives in reportsIpc.js).
 *
 * Closed-trade detection mirrors analyticsService.isClosedTrade; win/loss here
 * uses profit sign over closed trades (channelScoreboard convention) so every
 * dimension gets consistent decisive stats without needing settings context.
 */

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isClosedTrade(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime;
}

function isBlockedTrade(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.startsWith('BLOCKED') || s.includes('BLOCKED') || !!trade?.blockedReason;
}

function parseTradeDate(trade) {
  const closed = isClosedTrade(trade);
  const candidates = closed
    ? [trade?.closedAt, trade?.openedAt, trade?.time]
    : [trade?.openedAt, trade?.closedAt, trade?.time];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function openDate(trade) {
  for (const raw of [trade?.openedAt, trade?.time, trade?.closedAt]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function closeDate(trade) {
  for (const raw of [trade?.closedAt, trade?.closeTime]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function utcDayKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function isoWeekKey(date) {
  // ISO-8601 week: Thursday of the current week decides the ISO year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Sessions by openedAt UTC hour: Asian 0–7, London 7–13, NewYork 13–21, Late 21–24. */
function sessionForUtcHour(hour) {
  if (hour >= 0 && hour < 7) return 'Asian';
  if (hour >= 7 && hour < 13) return 'London';
  if (hour >= 13 && hour < 21) return 'NewYork';
  return 'Late';
}

// ─── Symbol classification ───────────────────────────────────────────────────

const CURRENCY_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'PLN', 'MXN', 'ZAR', 'TRY', 'CNH', 'CZK', 'HUF']);
const FOREX_MAJORS = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD']);
const METAL_PREFIXES = ['XAU', 'XAG', 'XPT', 'XPD', 'GOLD', 'SILVER'];
const CRYPTO_PREFIXES = ['BTC', 'ETH', 'LTC', 'XRP', 'SOL', 'ADA', 'DOGE', 'BNB', 'DOT', 'AVAX'];
const INDEX_TOKENS = ['US30', 'US100', 'US500', 'NAS100', 'USTEC', 'SPX', 'NDX', 'DJ30', 'GER40', 'GER30', 'DE40', 'DAX', 'UK100', 'FTSE', 'JP225', 'NIKKEI', 'HK50', 'AUS200', 'FRA40', 'CAC', 'EU50', 'STOXX'];

/** Uppercased symbol with broker suffixes stripped (EURUSD.m → EURUSD). */
function cleanSymbol(rawSymbol) {
  const s = String(rawSymbol || '').toUpperCase().trim();
  return s.replace(/[._\-#/].*$/, '').replace(/[^A-Z0-9]/g, '');
}

function classifySymbol(rawSymbol) {
  const s = cleanSymbol(rawSymbol);
  if (!s) return 'other';
  if (METAL_PREFIXES.some((p) => s.startsWith(p))) return 'metal';
  if (INDEX_TOKENS.some((p) => s.startsWith(p))) return 'index';
  if (CRYPTO_PREFIXES.some((p) => s.startsWith(p))) return 'crypto';
  if (s.length >= 6) {
    const base = s.slice(0, 3);
    const quote = s.slice(3, 6);
    if (CURRENCY_CODES.has(base) && CURRENCY_CODES.has(quote)) {
      return FOREX_MAJORS.has(base + quote) ? 'forex major' : 'forex cross';
    }
  }
  return 'other';
}

function currencyPairParts(rawSymbol) {
  const s = cleanSymbol(rawSymbol);
  if (s.length < 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);
  const baseOk = CURRENCY_CODES.has(base) || METAL_PREFIXES.includes(base) || CRYPTO_PREFIXES.includes(base);
  if (baseOk && CURRENCY_CODES.has(quote)) return { base, quote };
  return null;
}

/** Heuristic pip size for SL-distance bucketing (no broker metadata available). */
function pipSizeFor(rawSymbol) {
  const s = cleanSymbol(rawSymbol);
  if (!s) return 0.0001;
  if (s.startsWith('XAU') || s.startsWith('GOLD')) return 0.1;
  if (s.startsWith('XAG') || s.startsWith('SILVER')) return 0.01;
  if (INDEX_TOKENS.some((p) => s.startsWith(p))) return 1;
  if (CRYPTO_PREFIXES.some((p) => s.startsWith(p))) return 1;
  if (s.includes('JPY')) return 0.01;
  return 0.0001;
}

function firstSl(trade) {
  const sl = Array.isArray(trade?.sl) ? trade.sl[0] : trade?.sl;
  const n = Number(sl);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tpList(trade) {
  const raw = trade?.tp;
  const arr = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

function slDistancePips(trade) {
  const entry = Number(trade?.entry);
  const sl = firstSl(trade);
  if (!Number.isFinite(entry) || entry <= 0 || sl == null) return null;
  const pip = pipSizeFor(trade?.symbol);
  return Math.abs(entry - sl) / pip;
}

// ─── Bucket helpers ──────────────────────────────────────────────────────────

/**
 * Generic threshold bucketing: edges [e1, e2, ...] ascending produce labels
 * labels[i] for value < edges[i], last label for value >= last edge.
 */
function bucketize(value, edges, labels) {
  if (!Number.isFinite(value)) return null;
  for (let i = 0; i < edges.length; i++) {
    if (value < edges[i]) return labels[i];
  }
  return labels[labels.length - 1];
}

const DURATION_LABELS = ['<5m', '5-30m', '30m-2h', '2-8h', '8-24h', '>24h'];
function durationBucket(ms) {
  const min = ms / 60000;
  return bucketize(min, [5, 30, 120, 480, 1440], DURATION_LABELS);
}

const GAP_LABELS = ['<5m', '5-30m', '30m-2h', '>2h'];
function gapBucket(ms) {
  const min = ms / 60000;
  return bucketize(min, [5, 30, 120], GAP_LABELS);
}

const LOT_LABELS = ['≤0.01', '0.02-0.05', '0.06-0.1', '0.11-0.5', '0.51-1', '>1'];
function lotBucket(lot) {
  if (!Number.isFinite(lot) || lot <= 0) return null;
  if (lot <= 0.01) return LOT_LABELS[0];
  if (lot <= 0.05) return LOT_LABELS[1];
  if (lot <= 0.1) return LOT_LABELS[2];
  if (lot <= 0.5) return LOT_LABELS[3];
  if (lot <= 1) return LOT_LABELS[4];
  return LOT_LABELS[5];
}

const RISK_USD_LABELS = ['≤10$', '10-25$', '25-50$', '50-100$', '100-250$', '>250$'];
const PLANNED_RR_LABELS = ['<1', '1-2', '2-3', '>3'];
const REALIZED_R_LABELS = ['≤-1R', '-1-0R', '0-1R', '1-2R', '≥2R'];
function realizedRBucket(r) {
  if (!Number.isFinite(r)) return null;
  if (r <= -1) return REALIZED_R_LABELS[0];
  if (r < 0) return REALIZED_R_LABELS[1];
  if (r < 1) return REALIZED_R_LABELS[2];
  if (r < 2) return REALIZED_R_LABELS[3];
  return REALIZED_R_LABELS[4];
}

const SL_PIPS_LABELS = ['<10 pips', '10-25 pips', '25-50 pips', '50-100 pips', '>100 pips'];
const CONFIDENCE_LABELS = ['0-3', '4-6', '7-10'];
const EFFICIENCY_LABELS = ['<25%', '25-50%', '50-75%', '>75%'];
const MAE_SL_LABELS = ['<25% of SL', '25-50% of SL', '50-75% of SL', '75-100% of SL', 'SL exceeded'];
const MFE_R_LABELS = ['<0.5R', '0.5-1R', '1-2R', '>2R'];
const PNL_LABELS = ['< -500$', '-500 - -100$', '-100 - 0$', '0 - 100$', '100 - 500$', '> 500$'];
const RISK_TYPICAL_LABELS = ['<50% typical', '50-80% typical', '80-120% typical', '120-200% typical', '>200% typical'];
const MISTAKE_COUNT_LABELS = ['0 mistakes', '1 mistake', '2 mistakes', '3+ mistakes'];
const AI_VERDICT_LABELS = ['no-ai', '<50', '50-70', '70-85', '≥85'];

function tradeOutcome(trade) {
  if (!isClosedTrade(trade)) return null;
  const p = toNum(trade?.profit);
  if (p > 0) return 'win';
  if (p < 0) return 'loss';
  return 'breakeven';
}

function journalTags(trade) {
  return (Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [])
    .map((x) => String(x || '').trim()).filter(Boolean);
}

function presetTagsOf(trade) {
  const list = (Array.isArray(trade?.presetTags) ? trade.presetTags : [])
    .map((x) => String(x || '').trim()).filter(Boolean);
  const legacy = String(trade?.setup || '').trim();
  if (legacy && !list.some((t) => t.toLowerCase() === legacy.toLowerCase())) list.push(legacy);
  return list;
}

function mistakeTags(trade) {
  return (Array.isArray(trade?.journal?.mistakes) ? trade.journal.mistakes : [])
    .map((x) => String(x || '').trim()).filter(Boolean);
}

// ─── Per-report context (cross-trade lookups) ────────────────────────────────

/**
 * Precomputes everything a dimension may need that depends on OTHER trades:
 * previous-trade gaps, prior-closed outcome, intraday trade index, day P&L at
 * open, median riskUsd. Keyed by trade id (falls back to object identity map).
 */
function buildReportContext(trades) {
  const byId = new Map();
  const idOf = (t) => (t?.id != null ? String(t.id) : null);

  const perAccount = new Map();
  for (const t of trades) {
    const acc = String(t?.accountKey || 'unknown');
    if (!perAccount.has(acc)) perAccount.set(acc, []);
    perAccount.get(acc).push(t);
  }

  for (const list of perAccount.values()) {
    const opened = list
      .map((t) => ({ t, at: openDate(t) }))
      .filter((x) => x.at)
      .sort((a, b) => a.at - b.at);
    const closedSorted = list
      .map((t) => ({ t, at: closeDate(t) || (isClosedTrade(t) ? openDate(t) : null) }))
      .filter((x) => x.at && isClosedTrade(x.t))
      .sort((a, b) => a.at - b.at);

    const dayCounters = new Map();
    for (let i = 0; i < opened.length; i++) {
      const { t, at } = opened[i];
      const id = idOf(t);
      if (!id) continue;
      const entry = {};

      if (i > 0) entry.msSincePrevTrade = at - opened[i - 1].at;

      const dayKey = utcDayKey(at);
      const n = (dayCounters.get(dayKey) || 0) + 1;
      dayCounters.set(dayKey, n);
      entry.tradeIndexInDay = n;

      // Latest trade on this account closed strictly before this open.
      let prevClosed = null;
      for (const c of closedSorted) {
        if (c.at < at && c.t !== t) prevClosed = c.t;
        else if (c.at >= at) break;
      }
      if (prevClosed) {
        const p = toNum(prevClosed.profit);
        entry.prevClosedOutcome = p > 0 ? 'win' : (p < 0 ? 'loss' : 'breakeven');
      }

      // Realized P&L for the same UTC day at the moment this trade opened.
      let dayPnl = 0;
      let dayHadCloses = false;
      for (const c of closedSorted) {
        if (c.at >= at) break;
        if (utcDayKey(c.at) === dayKey) {
          dayPnl += toNum(c.t.profit);
          dayHadCloses = true;
        }
      }
      entry.dayPnlAtOpen = dayHadCloses ? dayPnl : null;

      byId.set(id, entry);
    }
  }

  const risks = trades.map((t) => Number(t?.riskUsd)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const medianRiskUsd = risks.length > 0
    ? (risks.length % 2 === 1 ? risks[(risks.length - 1) / 2] : (risks[risks.length / 2 - 1] + risks[risks.length / 2]) / 2)
    : null;

  return {
    forTrade: (t) => byId.get(idOf(t)) || {},
    medianRiskUsd
  };
}

// ─── Dimension registry ──────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const DOM_ORDER = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

/**
 * Each dimension: { id, label, group, keyFn(trade, ctx) -> string|string[]|null, order? }.
 * order: string[] = fixed bucket order; 'numeric' | 'alpha' = key comparators;
 * omitted = rows sorted by netPnl desc.
 */
const DIMENSIONS = [
  // ── Date/Time ──
  {
    id: 'day-of-week', label: 'Day of week', group: 'Date & Time', order: WD_ORDER,
    keyFn: (t) => { const d = openDate(t); return d ? WD_LONG[d.getUTCDay()] : null; }
  },
  {
    id: 'hour-of-day', label: 'Hour of day (UTC)', group: 'Date & Time', order: HOURS,
    keyFn: (t) => { const d = openDate(t); return d ? String(d.getUTCHours()).padStart(2, '0') : null; }
  },
  {
    id: 'session', label: 'Session', group: 'Date & Time', order: ['Asian', 'London', 'NewYork', 'Late'],
    keyFn: (t) => { const d = openDate(t); return d ? sessionForUtcHour(d.getUTCHours()) : null; }
  },
  {
    id: 'month', label: 'Month', group: 'Date & Time', order: 'alpha',
    keyFn: (t) => {
      const d = openDate(t);
      return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : null;
    }
  },
  {
    id: 'month-of-year', label: 'Month of year', group: 'Date & Time', order: MONTH_NAMES,
    keyFn: (t) => { const d = openDate(t); return d ? MONTH_NAMES[d.getUTCMonth()] : null; }
  },
  {
    id: 'week', label: 'Week (ISO)', group: 'Date & Time', order: 'alpha',
    keyFn: (t) => { const d = openDate(t); return d ? isoWeekKey(d) : null; }
  },
  {
    id: 'quarter', label: 'Quarter', group: 'Date & Time', order: 'alpha',
    keyFn: (t) => {
      const d = openDate(t);
      return d ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` : null;
    }
  },
  {
    id: 'year', label: 'Year', group: 'Date & Time', order: 'alpha',
    keyFn: (t) => { const d = openDate(t); return d ? String(d.getUTCFullYear()) : null; }
  },
  {
    id: 'day-of-month', label: 'Day of month', group: 'Date & Time', order: DOM_ORDER,
    keyFn: (t) => { const d = openDate(t); return d ? String(d.getUTCDate()).padStart(2, '0') : null; }
  },
  {
    id: 'am-vs-pm', label: 'AM vs PM (UTC)', group: 'Date & Time', order: ['AM', 'PM'],
    keyFn: (t) => { const d = openDate(t); return d ? (d.getUTCHours() < 12 ? 'AM' : 'PM') : null; }
  },
  {
    id: 'duration-bucket', label: 'Trade duration', group: 'Date & Time', order: DURATION_LABELS,
    keyFn: (t) => {
      const o = openDate(t); const c = closeDate(t);
      if (!o || !c || c < o) return null;
      return durationBucket(c - o);
    }
  },
  {
    id: 'time-since-prev-trade', label: 'Time since previous trade', group: 'Date & Time', order: ['first trade', ...GAP_LABELS],
    keyFn: (t, ctx) => {
      const ms = ctx?.forTrade(t)?.msSincePrevTrade;
      if (ms == null) return 'first trade';
      return gapBucket(ms);
    }
  },
  {
    id: 'open-vs-close-day', label: 'Open vs close day', group: 'Date & Time', order: ['same day', 'different day'],
    keyFn: (t) => {
      const o = openDate(t); const c = closeDate(t);
      if (!o || !c) return null;
      return utcDayKey(o) === utcDayKey(c) ? 'same day' : 'different day';
    }
  },
  {
    id: 'close-day-of-week', label: 'Close day of week', group: 'Date & Time', order: WD_ORDER,
    keyFn: (t) => { const d = closeDate(t); return d ? WD_LONG[d.getUTCDay()] : null; }
  },
  {
    id: 'close-hour', label: 'Close hour (UTC)', group: 'Date & Time', order: HOURS,
    keyFn: (t) => { const d = closeDate(t); return d ? String(d.getUTCHours()).padStart(2, '0') : null; }
  },

  // ── Instrument ──
  {
    id: 'symbol', label: 'Symbol', group: 'Instrument',
    keyFn: (t) => cleanSymbol(t?.symbol) || null
  },
  {
    id: 'symbol-class', label: 'Symbol class', group: 'Instrument', order: ['forex major', 'forex cross', 'metal', 'index', 'crypto', 'other'],
    keyFn: (t) => (t?.symbol ? classifySymbol(t.symbol) : null)
  },
  {
    id: 'quote-currency', label: 'Quote currency', group: 'Instrument', order: 'alpha',
    keyFn: (t) => currencyPairParts(t?.symbol)?.quote || null
  },
  {
    id: 'base-currency', label: 'Base currency', group: 'Instrument', order: 'alpha',
    keyFn: (t) => currencyPairParts(t?.symbol)?.base || null
  },
  {
    id: 'account', label: 'Account', group: 'Instrument', order: 'alpha',
    keyFn: (t) => String(t?.accountKey || 'unknown')
  },

  // ── Risk & Size ──
  {
    id: 'lot-bucket', label: 'Lot size', group: 'Risk & Size', order: LOT_LABELS,
    keyFn: (t) => lotBucket(Number(t?.lot))
  },
  {
    id: 'risk-usd-bucket', label: 'Risk (USD)', group: 'Risk & Size', order: RISK_USD_LABELS,
    keyFn: (t) => {
      const r = Number(t?.riskUsd);
      if (!Number.isFinite(r) || r <= 0) return null;
      if (r <= 10) return RISK_USD_LABELS[0];
      if (r <= 25) return RISK_USD_LABELS[1];
      if (r <= 50) return RISK_USD_LABELS[2];
      if (r <= 100) return RISK_USD_LABELS[3];
      if (r <= 250) return RISK_USD_LABELS[4];
      return RISK_USD_LABELS[5];
    }
  },
  {
    id: 'planned-rr-bucket', label: 'Planned R:R', group: 'Risk & Size', order: PLANNED_RR_LABELS,
    keyFn: (t) => bucketize(Number(t?.plannedRR), [1, 2, 3], PLANNED_RR_LABELS)
  },
  {
    id: 'realized-r-bucket', label: 'Realized R', group: 'Risk & Size', order: REALIZED_R_LABELS,
    keyFn: (t) => realizedRBucket(Number(t?.realizedR))
  },
  {
    id: 'sl-distance-bucket', label: 'SL distance (pips)', group: 'Risk & Size', order: SL_PIPS_LABELS,
    keyFn: (t) => bucketize(slDistancePips(t), [10, 25, 50, 100], SL_PIPS_LABELS)
  },
  {
    id: 'has-sl', label: 'With vs without SL', group: 'Risk & Size', order: ['has SL', 'no SL'],
    keyFn: (t) => (firstSl(t) != null ? 'has SL' : 'no SL')
  },
  {
    id: 'tp-count', label: 'TP count', group: 'Risk & Size', order: ['no TP', '1 TP', '2 TP', '3+ TP'],
    keyFn: (t) => {
      const n = tpList(t).length;
      if (n === 0) return 'no TP';
      if (n === 1) return '1 TP';
      if (n === 2) return '2 TP';
      return '3+ TP';
    }
  },
  {
    id: 'risk-vs-typical', label: 'Risk vs typical (median)', group: 'Risk & Size', order: RISK_TYPICAL_LABELS,
    keyFn: (t, ctx) => {
      const r = Number(t?.riskUsd);
      const med = ctx?.medianRiskUsd;
      if (!Number.isFinite(r) || r <= 0 || !med) return null;
      const pct = (r / med) * 100;
      return bucketize(pct, [50, 80, 120, 200], RISK_TYPICAL_LABELS);
    }
  },
  {
    id: 'pnl-bucket', label: 'P&L bucket', group: 'Risk & Size', order: PNL_LABELS,
    keyFn: (t) => {
      if (!isClosedTrade(t)) return null;
      return bucketize(toNum(t?.profit), [-500, -100, 0, 100, 500], PNL_LABELS);
    }
  },

  // ── Execution ──
  {
    id: 'order-type', label: 'Order type', group: 'Execution', order: 'alpha',
    keyFn: (t) => {
      const o = String(t?.orderType || '').trim().toUpperCase();
      return o || 'MARKET';
    }
  },
  {
    id: 'direction', label: 'Direction', group: 'Execution', order: ['BUY', 'SELL'],
    keyFn: (t) => {
      const d = String(t?.type || '').trim().toUpperCase();
      return d === 'BUY' || d === 'SELL' ? d : null;
    }
  },
  {
    id: 'outcome', label: 'Win / loss / breakeven', group: 'Execution', order: ['win', 'loss', 'breakeven'],
    keyFn: (t) => tradeOutcome(t)
  },
  {
    id: 'entry-slippage', label: 'Entry slippage', group: 'Execution', order: ['better than signal', 'exact', 'worse than signal'],
    keyFn: (t) => {
      const entry = Number(t?.entry);
      const sig = Number(t?.sigEntry);
      if (!Number.isFinite(entry) || !Number.isFinite(sig) || sig <= 0) return null;
      const dir = String(t?.type || '').toUpperCase();
      if (entry === sig) return 'exact';
      const worse = dir === 'SELL' ? entry < sig : entry > sig;
      return worse ? 'worse than signal' : 'better than signal';
    }
  },
  {
    id: 'partial-close-used', label: 'Partial close used', group: 'Execution', order: ['partial close', 'single close'],
    keyFn: (t) => {
      const used = (Array.isArray(t?.partialCloses) && t.partialCloses.length > 0)
        || String(t?.status || '').toUpperCase().includes('PARTIAL');
      return used ? 'partial close' : 'single close';
    }
  },
  {
    id: 'weekend-held', label: 'Held over weekend', group: 'Execution', order: ['held over weekend', 'intra-week'],
    keyFn: (t) => {
      const o = openDate(t); const c = closeDate(t);
      if (!o || !c || c <= o) return null;
      // Weekend-held when the holding interval contains a full Sunday (UTC):
      // covers open-Fri / close-Mon+ without depending on exact hours.
      const cursor = new Date(Date.UTC(o.getUTCFullYear(), o.getUTCMonth(), o.getUTCDate()));
      while (cursor.getTime() <= c.getTime()) {
        if (cursor.getUTCDay() === 0
          && cursor.getTime() >= o.getTime()
          && cursor.getTime() + 86400000 <= c.getTime()) {
          return 'held over weekend';
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return 'intra-week';
    }
  },

  // ── Journal ──
  {
    id: 'journal-tag', label: 'Journal tag', group: 'Journal',
    keyFn: (t) => { const tags = journalTags(t); return tags.length ? tags : null; }
  },
  {
    id: 'setup-tag', label: 'Setup / preset tag', group: 'Journal',
    keyFn: (t) => { const tags = presetTagsOf(t); return tags.length ? tags : null; }
  },
  {
    id: 'strategy', label: 'Strategy', group: 'Journal', order: 'alpha',
    keyFn: (t) => {
      const id = String(t?.strategyId || '').trim();
      return id || '(no strategy)';
    }
  },
  {
    id: 'confidence-bucket', label: 'Confidence', group: 'Journal', order: CONFIDENCE_LABELS,
    keyFn: (t) => {
      const c = Number(t?.journal?.confidence);
      if (!Number.isFinite(c)) return null;
      if (c <= 3) return CONFIDENCE_LABELS[0];
      if (c <= 6) return CONFIDENCE_LABELS[1];
      return CONFIDENCE_LABELS[2];
    }
  },
  {
    id: 'emotion', label: 'Emotion', group: 'Journal', order: 'alpha',
    keyFn: (t) => {
      const e = String(t?.journal?.emotion || '').trim().toLowerCase();
      return e || null;
    }
  },
  {
    id: 'rating', label: 'Trade rating', group: 'Journal', order: 'alpha',
    keyFn: (t) => {
      const r = t?.journal?.rating;
      if (r == null || String(r).trim() === '') return null;
      return String(r).trim().toUpperCase();
    }
  },
  {
    id: 'has-notes', label: 'Has notes', group: 'Journal', order: ['has notes', 'no notes'],
    keyFn: (t) => (String(t?.journal?.notes || '').trim() ? 'has notes' : 'no notes')
  },
  {
    id: 'mistake-count-bucket', label: 'Mistake tag count', group: 'Journal', order: MISTAKE_COUNT_LABELS,
    keyFn: (t) => {
      const n = mistakeTags(t).length;
      if (n === 0) return MISTAKE_COUNT_LABELS[0];
      if (n === 1) return MISTAKE_COUNT_LABELS[1];
      if (n === 2) return MISTAKE_COUNT_LABELS[2];
      return MISTAKE_COUNT_LABELS[3];
    }
  },

  // ── Signal Source ──
  {
    id: 'channel', label: 'Channel', group: 'Signal Source',
    keyFn: (t) => {
      const c = String(t?.channel || '').trim();
      return c || '(no channel)';
    }
  },
  {
    id: 'ai-verdict', label: 'AI verdict score', group: 'Signal Source', order: AI_VERDICT_LABELS,
    keyFn: (t) => {
      const raw = t?.aiCheck?.score ?? t?.aiCheck?.confidence;
      const s = Number(raw);
      if (!Number.isFinite(s)) return 'no-ai';
      if (s < 50) return AI_VERDICT_LABELS[1];
      if (s < 70) return AI_VERDICT_LABELS[2];
      if (s < 85) return AI_VERDICT_LABELS[3];
      return AI_VERDICT_LABELS[4];
    }
  },
  {
    id: 'blocked-vs-executed', label: 'Blocked vs executed', group: 'Signal Source', order: ['executed', 'blocked'],
    keyFn: (t) => (isBlockedTrade(t) ? 'blocked' : 'executed')
  },
  {
    id: 'edited-vs-original', label: 'Edited vs original signal', group: 'Signal Source', order: ['original', 'edited'],
    keyFn: (t) => (t?.userEdited === true ? 'edited' : 'original')
  },
  {
    id: 'timeframe', label: 'Timeframe', group: 'Signal Source', order: 'alpha',
    keyFn: (t) => {
      const tf = String(t?.timeframe || '').trim().toUpperCase();
      return tf || '(no TF)';
    }
  },

  // ── Excursion ──
  {
    id: 'efficiency-bucket', label: 'Efficiency (realized / MFE)', group: 'Excursion', order: EFFICIENCY_LABELS,
    keyFn: (t) => {
      if (!isClosedTrade(t)) return null;
      const mfe = Number(t?.excursion?.mfeMoney);
      if (!Number.isFinite(mfe) || mfe <= 0) return null;
      const pct = (toNum(t?.profit) / mfe) * 100;
      return bucketize(pct, [25, 50, 75], EFFICIENCY_LABELS);
    }
  },
  {
    id: 'mae-vs-sl-bucket', label: 'MAE vs SL distance', group: 'Excursion', order: MAE_SL_LABELS,
    keyFn: (t) => {
      const mae = Number(t?.excursion?.maePips);
      const slPips = slDistancePips(t);
      if (!Number.isFinite(mae) || mae < 0 || !Number.isFinite(slPips) || slPips <= 0) return null;
      const pct = (mae / slPips) * 100;
      if (pct > 100) return MAE_SL_LABELS[4];
      return bucketize(pct, [25, 50, 75, 100.0001], MAE_SL_LABELS);
    }
  },
  {
    id: 'mfe-captured-bucket', label: 'MFE available (in R)', group: 'Excursion', order: MFE_R_LABELS,
    keyFn: (t) => {
      const mfe = Number(t?.excursion?.mfeMoney);
      const risk = Number(t?.riskUsd);
      if (!Number.isFinite(mfe) || mfe < 0 || !Number.isFinite(risk) || risk <= 0) return null;
      return bucketize(mfe / risk, [0.5, 1, 2], MFE_R_LABELS);
    }
  },

  // ── Behavior ──
  {
    id: 'after-win-loss', label: 'After win vs after loss', group: 'Behavior', order: ['after win', 'after loss', 'after breakeven', 'no prior trade'],
    keyFn: (t, ctx) => {
      const prev = ctx?.forTrade(t)?.prevClosedOutcome;
      if (!prev) return 'no prior trade';
      if (prev === 'win') return 'after win';
      if (prev === 'loss') return 'after loss';
      return 'after breakeven';
    }
  },
  {
    id: 'trade-of-day', label: 'Trade number of day', group: 'Behavior', order: ['1st', '2nd', '3rd', '4th+'],
    keyFn: (t, ctx) => {
      const n = ctx?.forTrade(t)?.tradeIndexInDay;
      if (!Number.isFinite(n)) return null;
      if (n === 1) return '1st';
      if (n === 2) return '2nd';
      if (n === 3) return '3rd';
      return '4th+';
    }
  },
  {
    id: 'day-pnl-at-open', label: 'Day P&L when opened', group: 'Behavior', order: ['green day', 'red day', 'flat / first of day'],
    keyFn: (t, ctx) => {
      const pnl = ctx?.forTrade(t)?.dayPnlAtOpen;
      if (pnl == null || pnl === 0) return 'flat / first of day';
      return pnl > 0 ? 'green day' : 'red day';
    }
  }
];

const DIMENSION_BY_ID = new Map(DIMENSIONS.map((d) => [d.id, d]));

// ─── Filters ─────────────────────────────────────────────────────────────────

function normStringList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
}

/**
 * filter: { accountKeys?, channels?, symbols?, dateFromMs?, dateToMs?, tags?,
 *           strategyIds?, direction?, winLoss? }
 */
function applyReportFilter(trades, filter = {}) {
  const f = filter && typeof filter === 'object' ? filter : {};
  if (f.tradeFilters && typeof f.tradeFilters === 'object') {
    const { applyGlobalTradeFilters } = require('./globalTradeFilter');
    return applyGlobalTradeFilters(trades, f);
  }

  const list = Array.isArray(trades) ? trades : [];

  const accountKeys = normStringList(f.accountKeys);
  const channels = normStringList(f.channels);
  const symbols = normStringList(f.symbols).map((s) => cleanSymbol(s));
  const tags = normStringList(f.tags).map((s) => s.toLowerCase());
  const strategyIds = normStringList(f.strategyIds);
  const direction = String(f.direction || '').trim().toUpperCase();
  const winLoss = String(f.winLoss || '').trim().toUpperCase();
  const fromMs = Number.isFinite(Number(f.dateFromMs)) && f.dateFromMs != null ? Number(f.dateFromMs) : null;
  const toMs = Number.isFinite(Number(f.dateToMs)) && f.dateToMs != null ? Number(f.dateToMs) : null;

  return list.filter((t) => {
    if (accountKeys.length > 0 && !accountKeys.includes(String(t?.accountKey || 'unknown'))) return false;
    if (channels.length > 0 && !channels.includes(String(t?.channel || '').trim())) return false;
    if (symbols.length > 0 && !symbols.includes(cleanSymbol(t?.symbol))) return false;
    if (direction && (direction === 'BUY' || direction === 'SELL')) {
      if (String(t?.type || '').toUpperCase() !== direction) return false;
    }
    if (strategyIds.length > 0 && !strategyIds.includes(String(t?.strategyId || '').trim())) return false;
    if (tags.length > 0) {
      const own = [...journalTags(t), ...presetTagsOf(t)].map((x) => x.toLowerCase());
      if (!tags.some((tag) => own.includes(tag))) return false;
    }
    if (fromMs != null || toMs != null) {
      const d = parseTradeDate(t);
      if (!d) return false;
      const ts = d.getTime();
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
    }
    if (winLoss === 'WIN' || winLoss === 'LOSS' || winLoss === 'BREAKEVEN' || winLoss === 'BE') {
      const o = tradeOutcome(t);
      if (winLoss === 'WIN' && o !== 'win') return false;
      if (winLoss === 'LOSS' && o !== 'loss') return false;
      if ((winLoss === 'BREAKEVEN' || winLoss === 'BE') && o !== 'breakeven') return false;
    }
    return true;
  });
}

// ─── Report computation ──────────────────────────────────────────────────────

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function metricsForBucket(bucketTrades) {
  const closed = bucketTrades.filter(isClosedTrade);
  const wins = closed.filter((t) => toNum(t.profit) > 0);
  const losses = closed.filter((t) => toNum(t.profit) < 0);
  const grossWin = wins.reduce((a, t) => a + toNum(t.profit), 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + toNum(t.profit), 0));
  const netPnl = closed.reduce((a, t) => a + toNum(t.profit), 0);
  const decisive = wins.length + losses.length;
  const rValues = closed.map((t) => Number(t.realizedR)).filter((n) => Number.isFinite(n));
  return {
    count: bucketTrades.length,
    closedCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    netPnl: round2(netPnl),
    winRatePct: decisive > 0 ? round2((wins.length / decisive) * 100) : null,
    avgWin: wins.length > 0 ? round2(grossWin / wins.length) : 0,
    avgLoss: losses.length > 0 ? round2(grossLoss / losses.length) : 0,
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : (grossWin > 0 ? null : 0),
    expectancy: closed.length > 0 ? round2(netPnl / closed.length) : 0,
    totalR: round2(rValues.reduce((a, b) => a + b, 0))
  };
}

function sortRows(rows, dimension) {
  const order = dimension?.order;
  if (Array.isArray(order)) {
    const idx = new Map(order.map((k, i) => [k, i]));
    return rows.sort((a, b) => {
      const ai = idx.has(a.key) ? idx.get(a.key) : order.length;
      const bi = idx.has(b.key) ? idx.get(b.key) : order.length;
      if (ai !== bi) return ai - bi;
      return String(a.key).localeCompare(String(b.key));
    });
  }
  if (order === 'numeric') {
    return rows.sort((a, b) => Number(a.key) - Number(b.key));
  }
  if (order === 'alpha') {
    return rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }
  return rows.sort((a, b) => b.netPnl - a.netPnl);
}

function computeReport(trades, { dimensionId, filter } = {}) {
  const dimension = DIMENSION_BY_ID.get(String(dimensionId || ''));
  if (!dimension) {
    throw new Error(`Unknown report dimension: ${dimensionId}`);
  }
  const filtered = applyReportFilter(Array.isArray(trades) ? trades : [], filter);
  const ctx = buildReportContext(filtered);

  const buckets = new Map();
  for (const trade of filtered) {
    let keys;
    try {
      keys = dimension.keyFn(trade, ctx);
    } catch (_) {
      keys = null;
    }
    if (keys == null) continue;
    const list = Array.isArray(keys) ? keys : [keys];
    for (const rawKey of list) {
      const key = String(rawKey ?? '').trim();
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(trade);
    }
  }

  const rows = [...buckets.entries()].map(([key, bucketTrades]) => ({
    key,
    label: key,
    ...metricsForBucket(bucketTrades)
  }));

  return {
    dimension: { id: dimension.id, label: dimension.label, group: dimension.group },
    totalTrades: filtered.length,
    rows: sortRows(rows, dimension)
  };
}

// ─── Compare mode ────────────────────────────────────────────────────────────

function computeMaxDrawdown(closedTradesSortedByClose) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of closedTradesSortedByClose) {
    equity += toNum(t.profit);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return round2(maxDd);
}

function kpisForFilter(trades, filter) {
  const filtered = applyReportFilter(trades, filter);
  const m = metricsForBucket(filtered);
  const closedSorted = filtered
    .filter(isClosedTrade)
    .map((t) => ({ t, at: closeDate(t) || openDate(t) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.t);
  const rValues = filtered.filter(isClosedTrade).map((t) => Number(t.realizedR)).filter((n) => Number.isFinite(n));
  return {
    count: m.count,
    closedCount: m.closedCount,
    wins: m.wins,
    losses: m.losses,
    netPnl: m.netPnl,
    winRatePct: m.winRatePct,
    profitFactor: m.profitFactor,
    expectancy: m.expectancy,
    avgWin: m.avgWin,
    avgLoss: m.avgLoss,
    avgR: rValues.length > 0 ? round2(rValues.reduce((a, b) => a + b, 0) / rValues.length) : null,
    totalR: m.totalR,
    maxDrawdown: computeMaxDrawdown(closedSorted)
  };
}

const COMPARE_DELTA_KEYS = ['count', 'closedCount', 'netPnl', 'winRatePct', 'profitFactor', 'expectancy', 'avgR', 'maxDrawdown'];

/** Deltas are A minus B (positive delta = side A higher). */
function compareReports(trades, { filterA, filterB } = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const a = kpisForFilter(list, filterA || {});
  const b = kpisForFilter(list, filterB || {});
  const deltas = {};
  for (const key of COMPARE_DELTA_KEYS) {
    const av = a[key];
    const bv = b[key];
    deltas[key] = (av == null || bv == null) ? null : round2(av - bv);
  }
  return { a, b, deltas };
}

/** One-click preset: winners vs losers on top of an optional base filter. */
function winsVsLossesCompare(trades, baseFilter = {}) {
  const base = baseFilter && typeof baseFilter === 'object' ? baseFilter : {};
  const result = compareReports(trades, {
    filterA: { ...base, winLoss: 'WIN' },
    filterB: { ...base, winLoss: 'LOSS' }
  });
  return { ...result, labels: { a: 'Winners', b: 'Losers' } };
}

// ─── Metadata for the UI ─────────────────────────────────────────────────────

const GROUP_ORDER = ['Date & Time', 'Instrument', 'Risk & Size', 'Execution', 'Journal', 'Signal Source', 'Excursion', 'Behavior'];

function listDimensions() {
  const grouped = new Map();
  for (const dim of DIMENSIONS) {
    if (!grouped.has(dim.group)) grouped.set(dim.group, []);
    grouped.get(dim.group).push({ id: dim.id, label: dim.label });
  }
  return GROUP_ORDER
    .filter((g) => grouped.has(g))
    .map((g) => ({ group: g, dimensions: grouped.get(g) }));
}

module.exports = {
  DIMENSIONS,
  listDimensions,
  computeReport,
  applyReportFilter,
  compareReports,
  winsVsLossesCompare,
  buildReportContext,
  classifySymbol,
  isClosedTrade
};
