/**
 * Replay bundle builders (Phase 2 — Trade Replay + Day Replay).
 *
 * Pure-ish: callers fetch bars (marketHistoryService) and pass them in, so
 * everything here is unit-testable with synthetic fixtures. Bars follow the
 * marketHistoryService shape: { time: unixSec, open, high, low, close },
 * ascending. Pip conventions are shared with excursionMetrics:
 * estimatePipSize (signalExecutionApply) + usdPerPipPerStandardLot (lotSizing).
 */

const path = require('path');
const { estimatePipSize } = require('./signalExecutionApply');
const { usdPerPipPerStandardLot } = require('./lotSizing');

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toUnixSec(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function normalizeBars(bars) {
  const out = (Array.isArray(bars) ? bars : [])
    .map((b) => ({
      time: Number(b?.time),
      open: Number(b?.open),
      high: Number(b?.high),
      low: Number(b?.low),
      close: Number(b?.close)
    }))
    .filter((b) => Number.isFinite(b.time) && [b.open, b.high, b.low, b.close].every(Number.isFinite));
  out.sort((a, b) => a.time - b.time);
  return out;
}

function tradeDirection(trade) {
  const t = String(trade?.type || '').toUpperCase();
  if (t.startsWith('BUY')) return 1;
  if (t.startsWith('SELL')) return -1;
  return 0;
}

function isClosedTradeStatus(status) {
  const s = String(status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT')
    || s.includes('STOP_LOSS') || s.includes('TAKE_PROFIT');
}

/** Nearest bar time to targetSec (bars ascending); null when no bars. */
function snapToBarTime(targetSec, bars) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  let best = bars[0].time;
  let bestAbs = Math.abs(best - targetSec);
  for (const b of bars) {
    const d = Math.abs(b.time - targetSec);
    if (d < bestAbs) {
      bestAbs = d;
      best = b.time;
    }
  }
  return best;
}

/** Index of the first bar at/after targetSec (fallback: nearest end). */
function barIndexAtOrAfter(targetSec, bars) {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].time >= targetSec) return i;
  }
  return bars.length - 1;
}

/** Index of the last bar at/before targetSec (fallback: 0). */
function barIndexAtOrBefore(targetSec, bars) {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].time <= targetSec) return i;
  }
  return 0;
}

function entrySecOf(trade) {
  return toUnixSec(trade?.executedAt) ?? toUnixSec(trade?.openedAt) ?? toUnixSec(trade?.time);
}

function exitSecOf(trade) {
  return toUnixSec(trade?.closedAt) ?? toUnixSec(trade?.lastUpdateAt);
}

/** Exit marker kind from the close status: sl / tp / plain exit. */
function exitKindOf(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('SL_HIT') || s.includes('STOP_LOSS')) return 'sl';
  if (s.includes('TP_HIT') || s.includes('TAKE_PROFIT')) return 'tp';
  return 'exit';
}

/** Distinct TP levels: trade.tps[] (multi-TP) first, else single trade.tp. */
function tpLevelsOf(trade) {
  const raw = Array.isArray(trade?.tps) && trade.tps.length > 0 ? trade.tps : [trade?.tp];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const n = toNum(v);
    if (n == null || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function sanitizeExcursionSeries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (Array.isArray(p) ? [toNum(p[0]), toNum(p[1])] : null))
    .filter((p) => p && p[0] != null && p[1] != null && p[0] > 0)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Trade replay bundle: M1 bars windowed from `preEntryBars` before entry to
 * `postExitBars` after exit (clamped to available bars), execution markers
 * snapped to bar timestamps, SL/TP levels, and the recorded excursion series.
 *
 * @param {{ trade: object, bars: Array, preEntryBars?: number, postExitBars?: number }} input
 */
function buildTradeReplayBundle({ trade, bars, preEntryBars = 60, postExitBars = 20 } = {}) {
  const all = normalizeBars(bars);
  if (!trade || all.length === 0) {
    return {
      bars: [], markers: [], slLine: null, tpLines: [],
      excursionSeries: [], windowStartSec: null, windowEndSec: null,
      entrySec: null, exitSec: null, closed: false, pnlModel: null
    };
  }

  const entrySec = entrySecOf(trade) ?? all[0].time;
  const closed = isClosedTradeStatus(trade.status) || !!trade.closedAt;
  const exitSec = (closed ? exitSecOf(trade) : null) ?? all[all.length - 1].time;

  const pre = Math.max(0, Math.floor(toNum(preEntryBars) ?? 60));
  const post = Math.max(0, Math.floor(toNum(postExitBars) ?? 20));
  const entryIdx = barIndexAtOrAfter(entrySec, all);
  const exitIdx = barIndexAtOrBefore(Math.max(entrySec, exitSec), all);
  const startIdx = Math.max(0, entryIdx - pre);
  const endIdx = Math.min(all.length - 1, Math.max(entryIdx, exitIdx) + post);
  const windowBars = all.slice(startIdx, endIdx + 1);

  const dir = tradeDirection(trade);
  const entry = toNum(trade.entry);
  const markers = [];

  const entrySnap = snapToBarTime(entrySec, windowBars);
  if (entrySnap != null) {
    markers.push({
      timeSec: entrySnap,
      kind: 'entry',
      price: entry,
      label: `Entry ${dir === -1 ? 'SELL' : 'BUY'}${entry != null ? ` @ ${entry}` : ''}`
    });
  }

  for (const pc of Array.isArray(trade.partialCloses) ? trade.partialCloses : []) {
    const atSec = toUnixSec(pc?.at);
    const snap = atSec != null ? snapToBarTime(atSec, windowBars) : null;
    if (snap == null) continue;
    const vol = toNum(pc?.closedVolume);
    markers.push({
      timeSec: snap,
      kind: 'partial',
      price: toNum(pc?.price),
      label: `Partial${vol != null ? ` ${vol}` : ''}${toNum(pc?.profit) != null ? ` (${pc.profit >= 0 ? '+' : ''}${Number(pc.profit).toFixed(2)}$)` : ''}`
    });
  }

  if (closed) {
    const exitSnap = snapToBarTime(exitSec, windowBars);
    if (exitSnap != null) {
      const kind = exitKindOf(trade);
      const profit = toNum(trade.profit);
      const exitBar = windowBars.find((b) => b.time === exitSnap);
      markers.push({
        timeSec: exitSnap,
        kind,
        price: exitBar ? exitBar.close : null,
        label: `${kind === 'sl' ? 'SL hit' : kind === 'tp' ? 'TP hit' : 'Exit'}${profit != null ? ` ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}$` : ''}`
      });
    }
  }

  markers.sort((a, b) => a.timeSec - b.timeSec);

  const sl = toNum(trade.sl);
  const slLine = sl != null && sl > 0 ? { price: sl, label: 'SL' } : null;
  const tps = tpLevelsOf(trade);
  const tpLines = tps.map((price, i) => ({
    price,
    label: tps.length > 1 ? `TP${i + 1}` : 'TP'
  }));

  // Everything the renderer needs to estimate running P&L from bar closes
  // when no recorded excursion series exists (pips → money via lot size).
  const pip = estimatePipSize(trade.symbol);
  const lot = toNum(trade.lot) ?? 0;
  const usdPerPip = entry != null && entry > 0
    ? usdPerPipPerStandardLot(trade.symbol, entry, toNum(trade.usdPerPipPerLot))
    : 0;
  const pnlModel = entry != null && entry > 0 && dir !== 0 && pip > 0
    ? {
      entry,
      direction: dir,
      pipSize: pip,
      moneyPerPip: lot > 0 && usdPerPip > 0 ? Math.round(usdPerPip * lot * 10000) / 10000 : 0
    }
    : null;

  return {
    bars: windowBars,
    markers,
    slLine,
    tpLines,
    excursionSeries: sanitizeExcursionSeries(trade.excursion?.pnlSeries),
    windowStartSec: windowBars[0]?.time ?? null,
    windowEndSec: windowBars[windowBars.length - 1]?.time ?? null,
    entrySec,
    exitSec: closed ? exitSec : null,
    closed,
    pnlModel
  };
}

function utcDayRangeSec(dateKey) {
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const startSec = Math.floor(ms / 1000);
  return { startSec, endSec: startSec + 24 * 60 * 60 - 1 };
}

function inDay(sec, range) {
  return sec != null && range != null && sec >= range.startSec && sec <= range.endSec;
}

/**
 * Day replay bundle: chronological open/close events for one UTC day plus a
 * running cumulative P&L series built from close events only.
 *
 * A trade belongs to the day when it OPENED or CLOSED that UTC day; only
 * closed-status trades contribute P&L.
 *
 * @param {{ dateKey: string, trades: Array, barsBySymbol?: object }} input
 */
function buildDayReplayBundle({ dateKey, trades, barsBySymbol } = {}) {
  const range = utcDayRangeSec(String(dateKey || ''));
  const list = Array.isArray(trades) ? trades.filter(Boolean) : [];

  const dayTrades = range
    ? list.filter((t) => {
      const openSec = entrySecOf(t);
      const closeSec = isClosedTradeStatus(t.status) || t.closedAt ? exitSecOf(t) : null;
      return inDay(openSec, range) || inDay(closeSec, range);
    })
    : [];

  const events = [];
  for (const t of dayTrades) {
    const tradeId = String(t.id ?? '');
    const symbol = String(t.symbol || '');
    const openSec = entrySecOf(t);
    if (inDay(openSec, range)) {
      events.push({ atSec: openSec, type: 'open', tradeId, symbol });
    }
    if (isClosedTradeStatus(t.status) || t.closedAt) {
      const closeSec = exitSecOf(t);
      if (inDay(closeSec, range)) {
        events.push({ atSec: closeSec, type: 'close', tradeId, symbol, pnl: toNum(t.profit) ?? 0 });
      }
    }
  }
  // Chronological; opens before closes on the same second.
  events.sort((a, b) => (a.atSec - b.atSec) || (a.type === b.type ? 0 : a.type === 'open' ? -1 : 1));

  const runningPnl = [];
  let cum = 0;
  for (const e of events) {
    if (e.type !== 'close') continue;
    cum += e.pnl ?? 0;
    runningPnl.push([e.atSec, Math.round(cum * 100) / 100]);
  }

  const symbols = [...new Set(dayTrades.map((t) => String(t.symbol || '')).filter(Boolean))];

  const normalizedBars = {};
  if (barsBySymbol && typeof barsBySymbol === 'object') {
    for (const [sym, bars] of Object.entries(barsBySymbol)) {
      normalizedBars[sym] = normalizeBars(bars);
    }
  }

  return {
    dateKey: String(dateKey || ''),
    events,
    trades: dayTrades,
    runningPnl,
    symbols,
    barsBySymbol: normalizedBars,
    dayStartSec: range?.startSec ?? null,
    dayEndSec: range?.endSec ?? null
  };
}

/** Trade id → filesystem-safe folder segment (never empty, never traversable). */
function sanitizeTradeIdForPath(tradeId) {
  const cleaned = String(tradeId ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'unknown';
}

/** Absolute PNG path for a replay snapshot under the app data root. */
function buildSnapshotPath(dataRoot, tradeId, now = new Date()) {
  const safeId = sanitizeTradeIdForPath(tradeId);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(String(dataRoot || ''), 'attachments', 'trades', safeId, `replay-${stamp}.png`);
}

module.exports = {
  buildTradeReplayBundle,
  buildDayReplayBundle,
  sanitizeTradeIdForPath,
  buildSnapshotPath,
  snapToBarTime,
  isClosedTradeStatus
};
