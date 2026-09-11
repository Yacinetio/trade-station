/**
 * Signal Parser - Detects trading signals from Telegram messages
 * Supports various signal formats used by Forex/trading channels
 */

const { applyCustomFieldsToSignal } = require('./customTradeFields');

const SYMBOL_PATTERNS = [
  // Metals
  'XAUUSD', 'GOLD', 'XAGUSD', 'SILVER',
  // Majors
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
  // Crosses
  'EURGBP', 'EURJPY', 'GBPJPY', 'EURAUD', 'EURCHF', 'GBPCAD', 'CADJPY',
  'AUDJPY', 'AUDNZD', 'NZDJPY', 'GBPAUD', 'GBPNZD', 'EURCAD', 'NZDCAD',
  'AUDCAD', 'AUDCHF', 'NZDCHF', 'CADCHF', 'GBPCHF', 'CHFJPY', 'EURHUF', 'EURSEK',
  // Indices
  'US100', 'US30', 'US500', 'SPX500', 'NAS100', 'DJ30', 'GER40', 'UK100',
  'US100.cash', 'US30.cash', 'NAS100.cash',
  // Crypto
  'BTCUSD', 'ETHUSD', 'LTCUSD', 'BNBUSD', 'XRPUSD',
  // Commodities
  'USOIL', 'UKOIL', 'OIL', 'NATGAS',
];

// Also match broker suffixes like EURUSDm, XAUUSDx, etc.
const SYMBOL_SUFFIX_RE = /\b(XAUUSD|GOLD|EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD|AUDUSD|NZDUSD|EURGBP|EURJPY|GBPJPY|EURAUD|EURCHF|GBPCAD|CADJPY|AUDJPY|AUDNZD|NZDJPY|GBPAUD|GBPNZD|EURCAD|NZDCAD|AUDCAD|AUDCHF|NZDCHF|CADCHF|GBPCHF|CHFJPY|US100|US30|US500|SPX500|NAS100|DJ30|GER40|UK100|BTCUSD|ETHUSD|USOIL|UKOIL|XAGUSD)[a-zA-Z0-9.]*/gi;

function normalizeSymbol(raw) {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const aliases = {
    GOLD: 'XAUUSD', SILVER: 'XAGUSD', OIL: 'USOIL',
    NAS100: 'NAS100.cash', NASDAQ: 'NAS100.cash',
    DOWJONES: 'US30', DAX: 'GER40', FTSE: 'UK100',
    GER30: 'US30.cash',
    'US30.CASH': 'US30.cash',
    'US100.CASH': 'US100.cash',
    'NAS100.CASH': 'NAS100.cash'
  };
  return aliases[upper] || upper;
}

function canonicalizeBrokerSymbolCase(value) {
  const s = String(value || '').trim();
  if (!s) return s;
  // Many brokers require lowercase suffixes for synthetic indices (e.g. US30.cash).
  return s.replace(/\.CASH$/i, '.cash');
}

function parseFloat2(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.]/g, '');
  const v = parseFloat(cleaned);
  return isNaN(v) || v <= 0 ? null : v;
}

/**
 * When SL/TP are geometrically impossible for the side (e.g. BUY with SL above entry and TP below),
 * the provider often swapped the labels — fix once by exchanging SL ↔ first TP.
 */
function fixSwappedSlTpForDirection(type, entry, sl, tps) {
  const side = String(type || '').toUpperCase();
  const e = Number(entry);
  let slNum = Number(sl);
  const out = Array.isArray(tps) ? [...tps] : [];
  const tp0 = out.length ? Number(out[0]) : NaN;
  if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(slNum) || slNum <= 0 || !Number.isFinite(tp0)) {
    return { sl: slNum || sl, tp: out };
  }
  if (side === 'BUY' && slNum > e && tp0 < e) {
    [slNum, out[0]] = [tp0, slNum];
  } else if (side === 'SELL' && slNum < e && tp0 > e) {
    [slNum, out[0]] = [tp0, slNum];
  }
  return { sl: slNum, tp: out };
}

function applyReverseModeToStops(type, sl, tps) {
  const flipped = type === 'BUY' ? 'SELL' : 'BUY';
  const out = Array.isArray(tps) ? [...tps] : [];
  let slNext = sl;
  if (out.length > 0 && slNext != null && Number(slNext) > 0) {
    const tmp = Number(slNext);
    slNext = out[0];
    out[0] = tmp;
  }
  return { type: flipped, sl: slNext, tp: out };
}

/**
 * Reverse modes (global settings.reverseMode or channel override):
 *   'all' / 'flip'  → flip direction + mirror SL↔TP1
 *   'buy' / 'sell'  → flip only that side
 *   'sl_tp_only'    → keep direction, swap SL↔TP1 only
 * Anything else (incl. 'none') leaves the signal untouched.
 */
function applyReverseSettingsToSignal(mode, type, sl, tps) {
  const m = String(mode || 'none').toLowerCase();
  const out = { type, sl, tp: Array.isArray(tps) ? [...tps] : [] };
  if (!m || m === 'none') return out;

  const flipAll = m === 'all' || m === 'flip'
    || (m === 'buy' && type === 'BUY')
    || (m === 'sell' && type === 'SELL');
  if (flipAll) {
    return applyReverseModeToStops(type, sl, out.tp);
  }
  if (m === 'sl_tp_only') {
    if (out.tp.length > 0 && sl != null && Number(sl) > 0) {
      const tmp = Number(sl);
      out.sl = out.tp[0];
      out.tp[0] = tmp;
    }
  }
  return out;
}

const META_BIAS_MAX = 200;

function trimMetaValue(raw, maxLen) {
  const t = String(raw || '').replace(/\r/g, '').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** Labeled lines from OB STATS Telegram (and similar): Bias only — VWAP is separate. */
function extractBiasFromText(text) {
  if (!text || typeof text !== 'string') return { bias: '' };
  const biasM = text.match(/^\s*bias:\s*(.+)$/im);
  return {
    bias: trimMetaValue(biasM?.[1], META_BIAS_MAX),
  };
}

/** VWAP: YES/NO/n/a — YES = OB intersects SD-1..SD+1 at hit (partial overlap OK; EA uses only ±1σ) */
function extractVwapBandFromText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/^\s*vwap:\s*(yes|no|n\/a)\b/im);
  if (m) {
    const v = m[1].toLowerCase();
    return v === 'n/a' ? 'na' : v;
  }
  const leg = text.match(/ob\s+in\s+vwap\s*[±+\-]?1[\s\u03c3s]*\s*band:\s*(yes|no)\b/i);
  if (leg) return leg[1].toLowerCase() === 'yes' ? 'yes' : 'no';
  return '';
}

/** OB edge price (order-block boundary) — used for blend-50% entry when Telegram ENTRY is already the midpoint. */
function extractObEdgeFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(
    /(?:^|\n)\s*(?:ob\s*)?edge\s*[:\s]+\s*([0-9]+(?:[.,][0-9]+)?)/im
  );
  if (!m) return null;
  const v = parseFloat2(m[1]);
  return v > 0 ? v : null;
}

/** HVN: YES/NO/n/a — VP cluster overlap on OB zone (OB_STATS_ANALYZER Telegram) */
function extractHvnBandFromText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/^\s*hvn:\s*(yes|no|n\/a)\b/im);
  if (m) {
    const v = m[1].toLowerCase();
    return v === 'n/a' ? 'na' : v;
  }
  return '';
}

/** Trend: WITH/AGAINST/neutral/n/a — trade direction vs TF EMA bias (OB_STATS_ANALYZER Telegram) */
function extractTrendAlignFromText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/^\s*trend:\s*(with|against|neutral|n\/a)\b/im);
  if (!m) return '';
  const v = m[1].toLowerCase();
  return v === 'n/a' ? 'na' : v;
}

/** Confluence: N — multi-TF overlap count (OB_STATS_ANALYZER Telegram) */
function extractConfluenceFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/^\s*confluence:\s*(\d+)\b/im);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

/** Rej: XX% — last line wins when TF + OB stats both present */
function extractRejPctFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const matches = [...text.matchAll(/^\s*rej:\s*([0-9]+(?:[.,][0-9]+)?)\s*%?\b/gim)];
  if (!matches.length) return null;
  const v = parseFloat2(matches[matches.length - 1][1]);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/** WR: XX% — last line wins when TF + OB stats both present */
function extractObWinRateFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const matches = [...text.matchAll(/^\s*wr:\s*([0-9]+(?:[.,][0-9]+)?)\s*%?\b/gim)];
  if (!matches.length) return null;
  const v = parseFloat2(matches[matches.length - 1][1]);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/** Top1: YES/NO — top-scored OB zone flag */
function extractTop1FromText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/^\s*top1:\s*(yes|no)\b/im);
  if (!m) return null;
  return m[1].toLowerCase() === 'yes';
}

/** Session: Asia/London/NY/Off — indicator session at signal time */
function extractSignalSessionFromText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/^\s*session:\s*(asia|london|ny|off)\b/im);
  if (!m) return '';
  const map = { asia: 'asian', london: 'london', ny: 'newYork', off: 'off' };
  return map[m[1].toLowerCase()] || '';
}

/** OB size: N pips — order-block zone height (OB_STATS_ANALYZER Telegram) */
function extractObSizeFromText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/^\s*ob\s*size:\s*([0-9]+(?:[.,][0-9]+)?)\s*pips?\b/im);
  if (!m) return '';
  const num = String(m[1]).replace(',', '.');
  return trimMetaValue(`${num} pips`, META_BIAS_MAX);
}

/**
 * OB STATS ANALYZER Telegram block (header "Signal: BUY|SELL SYMBOL", labeled Entry/SL/TP/TF/Lot).
 * Parsed first so broker symbol + OB prices win over generic keyword/line-order heuristics.
 */
function tryParseObStatsTelegram(text, channelName, settings) {
  // Mid-line merge headers ("Merged OB x2|x3|… | Signal: BUY|SELL …" from OB STATS) — not only start-of-line.
  // If we miss here, generic parsing runs and matches buy keyword `BULL` inside "STRONG BULLISH" before `SELL`.
  if (!/\bsignal:\s*(buy|sell)\s+/im.test(text)) return null;
  if (!/^\s*entry:\s*[0-9]/im.test(text) || !/^\s*sl:\s*[0-9]/im.test(text)) return null;

  const typeMatch = text.match(/signal:\s*(buy|sell)/i);
  if (!typeMatch) return null;
  let type = typeMatch[1].toUpperCase() === 'BUY' ? 'BUY' : 'SELL';

  const symMatch = text.match(/signal:\s*(?:buy|sell)\s+([A-Za-z0-9.]+)/i);
  if (!symMatch) return null;
  let symbol = symMatch[1].replace(/[^A-Za-z0-9.]/g, '');
  if (!symbol) return null;
  symbol = canonicalizeBrokerSymbolCase(normalizeSymbol(symbol.toUpperCase()));

  let timeframe = '';
  const tfLine = text.match(/\btf:\s*([A-Za-z0-9]+)/i);
  if (tfLine) {
    const cand = tfLine[1].toUpperCase();
    if (/^(M|H)\d{1,3}$|^D1$|^W1$|^MN1$/i.test(cand)) timeframe = cand;
  }

  const entryMatch = text.match(/^\s*entry:\s*([0-9]+(?:[.,][0-9]+)?)/im);
  const slMatch = text.match(/^\s*sl:\s*([0-9]+(?:[.,][0-9]+)?)/im);
  let entry = entryMatch ? parseFloat2(entryMatch[1]) : null;
  let sl = slMatch ? parseFloat2(slMatch[1]) : null;
  if (!entry || !sl) return null;

  let avgEntry = null;
  const avgEntryMatch = text.match(
    /(?:avg\.?\s*entry|average\s+entry)\s*[:\s]+\s*([0-9]+(?:[.,][0-9]+)?)/i
  );
  if (avgEntryMatch) avgEntry = parseFloat2(avgEntryMatch[1]);
  const obEdge = extractObEdgeFromText(text);

  const tps = [];
  const tpMatch = text.match(/^\s*tp:\s*([0-9]+(?:[.,][0-9]+)?)/im);
  if (tpMatch) {
    const v = parseFloat2(tpMatch[1]);
    if (v) tps.push(v);
  }

  if (tps.length > 0) {
    const fixed = fixSwappedSlTpForDirection(type, entry, sl, tps);
    sl = fixed.sl;
    tps.splice(0, tps.length, ...fixed.tp);
  }

  let lot = null;
  const lotMatch = text.match(/\blot:\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (lotMatch) {
    const v = parseFloat2(lotMatch[1]);
    if (v && v >= 0.01 && v <= 500) lot = v;
  }
  if (lot == null) {
    for (const re of [
      /(?:lot\s*size|lot[s]?|volume|size|risk)[:\s]+([0-9]+(?:[.,][0-9]+)?)\s*(?:lot[s]?)?/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*lot[s]?/i,
      /lot[s]?\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
    ]) {
      const m = text.match(re);
      if (m) {
        const v = parseFloat2(m[1]);
        if (v && v >= 0.01 && v <= 500) { lot = v; break; }
      }
    }
  }

  // OB STATS with edge+entry: let EA place limit at entry when below Ask (MARKET always fills at quote).
  let orderType = 'MARKET';
  if (
    entry > 0
    && obEdge != null
    && !settings?.forceMarket
    && String(settings?.orderType || '').toLowerCase() !== 'market'
  ) {
    orderType = 'AUTO';
  }

  if (settings?.reverseMode && settings.reverseMode !== 'none') {
    const rev = applyReverseSettingsToSignal(settings.reverseMode, type, sl, tps);
    type = rev.type;
    sl = rev.sl;
    tps.length = 0;
    tps.push(...rev.tp);
  }

  if (settings?.forceMarket) orderType = 'MARKET';

  if (settings?.tradeType === 'buy'  && type !== 'BUY')  return null;
  if (settings?.tradeType === 'sell' && type !== 'SELL') return null;
  if (settings?.orderType === 'market'  && orderType !== 'MARKET') return null;
  if (settings?.orderType === 'pending' && orderType === 'MARKET')  return null;

  const excludedPairs = settings?.excludedPairs || [];
  if (excludedPairs.some(p => symbol.toUpperCase().startsWith(p.toUpperCase()))) return null;

  const { bias } = extractBiasFromText(text);
  const vwapBand = extractVwapBandFromText(text);
  const hvnBand = extractHvnBandFromText(text);
  const trendAlign = extractTrendAlignFromText(text);
  const obSize = extractObSizeFromText(text);
  const confluence = extractConfluenceFromText(text);
  const rejPct = extractRejPctFromText(text);
  const obWinRate = extractObWinRateFromText(text);
  const top1 = extractTop1FromText(text);
  const signalSession = extractSignalSessionFromText(text);
  const payload = {
    symbol,
    type,
    orderType,
    entry: entry || 0,
    sl: sl || 0,
    tp: tps,
    lot: lot || 0,
    timeframe: timeframe || '',
    raw: text,
    channel: channelName,
    time: new Date().toISOString(),
    source: 'ob_stats',
    ...(bias ? { bias } : {}),
    ...(vwapBand ? { vwapBand } : {}),
    ...(hvnBand ? { hvnBand } : {}),
    ...(trendAlign ? { trendAlign } : {}),
    ...(obSize ? { obSize } : {}),
    ...(avgEntry != null && avgEntry > 0 ? { avgEntry } : {}),
    ...(obEdge != null && obEdge > 0 ? { obEdge } : {}),
    ...(confluence != null ? { confluence } : {}),
    ...(rejPct != null ? { rejPct } : {}),
    ...(obWinRate != null ? { obWinRate } : {}),
    ...(top1 != null ? { top1 } : {}),
    ...(signalSession ? { signalSession } : {}),
  };
  return applyCustomFieldsToSignal(payload, text, settings);
}

function parse(text, channelName, settings) {
  if (!text || text.length < 5) return null;

  const upper = text.toUpperCase();

  // ─── Skip ignored keywords ───────────────────────────────────────────────
  const ignoredKeywords = settings?.ignoredKeywords || [];
  for (const kw of ignoredKeywords) {
    if (upper.includes(kw.toUpperCase())) return null;
  }

  const obStatsSignal = tryParseObStatsTelegram(text, channelName, settings);
  if (obStatsSignal) return obStatsSignal;

  // ─── Detect order type (pending FIRST to avoid false positives) ──────────
  let type = null;
  let orderType = 'MARKET';

  if      (/\bBUY\s+LIMIT\b/.test(upper))  { type = 'BUY';  orderType = 'BUY LIMIT'; }
  else if (/\bBUY\s+STOP\b/.test(upper))   { type = 'BUY';  orderType = 'BUY STOP'; }
  else if (/\bSELL\s+LIMIT\b/.test(upper)) { type = 'SELL'; orderType = 'SELL LIMIT'; }
  else if (/\bSELL\s+STOP\b/.test(upper))  { type = 'SELL'; orderType = 'SELL STOP'; }
  else {
    // Market order — custom + default keywords
    const buyKeywords  = settings?.customKeywords?.buy  || ['BUY', 'LONG', 'BULL', '📈', '🟢', '⬆'];
    const sellKeywords = settings?.customKeywords?.sell || ['SELL', 'SHORT', 'BEAR', '📉', '🔴', '⬇'];
    for (const kw of buyKeywords)  { if (upper.includes(kw.toUpperCase())) { type = 'BUY';  break; } }
    if (!type) {
      for (const kw of sellKeywords) { if (upper.includes(kw.toUpperCase())) { type = 'SELL'; break; } }
    }
  }
  if (!type) return null;

  // ─── Detect symbol ───────────────────────────────────────────────────────
  let symbol = null;
  let symbolFromMapping = false;

  // Try custom symbol mappings first
  if (settings?.symbolMappings?.length) {
    for (const m of settings.symbolMappings) {
      if (upper.includes(m.from.toUpperCase())) {
        symbol = canonicalizeBrokerSymbolCase(m.to); // also fixes legacy saved values like US30.CASH
        symbolFromMapping = true;
        break;
      }
    }
  }

  if (!symbol) {
    // Match with optional broker suffix (e.g., EURUSDm, XAUUSDx)
    const suffixMatches = text.match(SYMBOL_SUFFIX_RE);
    if (suffixMatches && suffixMatches.length > 0) {
      symbol = suffixMatches[0].toUpperCase();
    }
  }

  if (!symbol) {
    // Exact match without suffix
    for (const sym of SYMBOL_PATTERNS) {
      const re = new RegExp(`\\b${sym.replace('.', '\\.')}\\b`, 'i');
      if (re.test(text)) { symbol = normalizeSymbol(sym); break; }
    }
  }

  if (!symbol) return null;
  // When symbol came from a custom mapping, preserve its exact case/format
  if (!symbolFromMapping) {
    symbol = normalizeSymbol(symbol.replace(/[^A-Z0-9.]/gi, ''));
  }
  symbol = canonicalizeBrokerSymbolCase(symbol);

  // ─── Chart timeframe (e.g. "Symbol : EURUSD M10") ──────────────────────────
  let timeframe = null;
  const symLineMatch = text.match(/symbol\s*[:\s]+\s*([^\n\r]+)/i);
  if (symLineMatch) {
    const tfMatch = String(symLineMatch[1]).match(/\b(M\d{1,2}|H\d{1,2}|D1|W1|MN1)\b/i);
    if (tfMatch) timeframe = tfMatch[1].toUpperCase();
  }

  // ─── AVG ENTRY (separate from primary ENTRY) ─────────────────────────────
  let avgEntry = null;
  const avgEntryMatch = text.match(
    /(?:avg\.?\s*entry|average\s+entry)\s*[:\s]+\s*([0-9]+(?:[.,][0-9]+)?)/i
  );
  if (avgEntryMatch) avgEntry = parseFloat2(avgEntryMatch[1]);
  const obEdge = extractObEdgeFromText(text);

  // ─── Extract entry price ─────────────────────────────────────────────────
  let entry = null;

  // Prefer standalone "ENTRY :" row so we never grab AVG ENTRY as primary entry.
  // The generic `entry` pattern must NOT match the word "entry" inside "avg entry" / "average entry",
  // or the first line wins and primary entry becomes the avg price (blend then does nothing).
  const entryPatterns = [
    /(?:^|\n)\s*ENTRY\s*[:\s]+\s*([0-9]+(?:[.,][0-9]+)?)/im,
    /(?<!\bavg\s)(?<!\baverage\s)(?:entry|enter|open|price|at|@)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /(?:buy|sell)\s+(?:limit|stop)?\s*@?\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /(?:buy|sell)\s*[:\s]+([0-9]+(?:[.,][0-9]+)?)/i,
  ];
  for (const re of entryPatterns) {
    const m = text.match(re);
    if (m) { entry = parseFloat2(m[1]); break; }
  }

  // Fallback: first standalone price on its own line
  if (!entry) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // skip lines that look like SL/TP/Lot
      if (/^(sl|tp|lot|stop|take|risk)/i.test(trimmed)) continue;
      if (/avg/i.test(trimmed)) continue;
      const priceMatch = trimmed.match(/^([0-9]{1,7}(?:[.,][0-9]{1,6})?)(\s|$)/);
      if (priceMatch) { entry = parseFloat2(priceMatch[1]); break; }
    }
  }

  // ─── Extract SL ──────────────────────────────────────────────────────────
  let sl = null;
  let slMatch = text.match(/^\s*sl:\s*([0-9]+(?:[.,][0-9]+)?)/im);
  if (!slMatch) slMatch = text.match(/(?:sl|stop[\s_]?loss|stoploss)[:\s\-]+([0-9]+(?:[.,][0-9]+)?)/i);
  if (slMatch) sl = parseFloat2(slMatch[1]);

  // ─── Extract TPs ─────────────────────────────────────────────────────────
  const tps = [];

  // TP1, TP2, TP3... — prefer line-start "TP:" so we never match "RTP:" / mid-word false positives
  let tpLineMatch = text.match(/^\s*tp[s]?\s*[:\-]\s*([\d.,\s\/]+)/im);
  if (!tpLineMatch) tpLineMatch = text.match(/tp[s]?\s*[:\-]\s*([\d.,\s\/]+)/i);
  if (tpLineMatch) {
    const parts = tpLineMatch[1].split(/[,\/\s]+/);
    for (const p of parts) {
      const v = parseFloat2(p);
      if (v) tps.push(v);
    }
  }

  if (tps.length === 0) {
    // Numbered TPs: "TP1: 1.xxx" "TP2: 1.xxx"
    const tpMatches = [...text.matchAll(/tp\s*[1-9]?\s*[:\-]\s*([0-9]+(?:[.,][0-9]+)?)/gi)];
    for (const m of tpMatches) { const v = parseFloat2(m[1]); if (v) tps.push(v); }
  }

  if (tps.length === 0) {
    // "Take profit: 1.xxx"
    const single = text.match(/take[\s_]?profit[:\s]+([0-9]+(?:[.,][0-9]+)?)/i);
    if (single) tps.push(parseFloat2(single[1]));
  }

  if (tps.length === 0) {
    // "Target: 1.xxx" or "Target 1: 1.xxx"
    const targets = [...text.matchAll(/target\s*[1-9]?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)/gi)];
    for (const m of targets) { const v = parseFloat2(m[1]); if (v) tps.push(v); }
  }

  if (entry && sl && tps.length > 0) {
    const fixed = fixSwappedSlTpForDirection(type, entry, sl, tps);
    sl = fixed.sl;
    tps.splice(0, tps.length, ...fixed.tp);
  }

  // ─── Extract Lot size ────────────────────────────────────────────────────
  let lot = null;

  // "Lot: 0.1" / "Lots: 0.1" / "Lot size: 0.1" / "Volume: 0.1" / "Size: 0.1" / "Risk: 0.1 lot"
  const lotPatterns = [
    /(?:lot\s*size|lot[s]?|volume|size|risk)[:\s]+([0-9]+(?:[.,][0-9]+)?)\s*(?:lot[s]?)?/i,
    /([0-9]+(?:[.,][0-9]+)?)\s*lot[s]?/i,
    /lot[s]?\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
  ];
  for (const re of lotPatterns) {
    const m = text.match(re);
    if (m) {
      const v = parseFloat2(m[1]);
      // sanity check: lot size should be between 0.01 and 500
      if (v && v >= 0.01 && v <= 500) { lot = v; break; }
    }
  }

  // ─── Apply settings overrides ────────────────────────────────────────────
  // Reverse mode — 'all'/'flip'/'buy'/'sell' flip side + mirror stops; 'sl_tp_only' swaps SL↔TP1 only.
  if (settings?.reverseMode && settings.reverseMode !== 'none') {
    const rev = applyReverseSettingsToSignal(settings.reverseMode, type, sl, tps);
    type = rev.type;
    sl = rev.sl;
    tps.splice(0, tps.length, ...rev.tp);
  }

  // Force market
  if (settings?.forceMarket) orderType = 'MARKET';

  // Trade type filter
  if (settings?.tradeType === 'buy'  && type !== 'BUY')  return null;
  if (settings?.tradeType === 'sell' && type !== 'SELL') return null;
  if (settings?.orderType === 'market'  && orderType !== 'MARKET') return null;
  if (settings?.orderType === 'pending' && orderType === 'MARKET')  return null;

  // Excluded pairs
  const excludedPairs = settings?.excludedPairs || [];
  if (excludedPairs.some(p => symbol.toUpperCase().startsWith(p.toUpperCase()))) return null;

  const { bias } = extractBiasFromText(text);
  const vwapBand = extractVwapBandFromText(text);
  const hvnBand = extractHvnBandFromText(text);
  const trendAlign = extractTrendAlignFromText(text);
  const obSize = extractObSizeFromText(text);
  const payload = {
    symbol,
    type,
    orderType,
    entry: entry || 0,
    sl: sl || 0,
    tp: tps,
    lot: lot || 0,
    timeframe: timeframe || '',
    raw: text,
    channel: channelName,
    time: new Date().toISOString()
  };
  if (avgEntry != null && avgEntry > 0) payload.avgEntry = avgEntry;
  if (obEdge != null && obEdge > 0) payload.obEdge = obEdge;
  if (bias) payload.bias = bias;
  if (vwapBand) payload.vwapBand = vwapBand;
  if (hvnBand) payload.hvnBand = hvnBand;
  if (trendAlign) payload.trendAlign = trendAlign;
  if (obSize) payload.obSize = obSize;
  return applyCustomFieldsToSignal(payload, text, settings);
}

module.exports = { parse, applyReverseSettingsToSignal };
