/**
 * Settings-driven “advanced” signal block rules (Settings → Filters).
 * When enabled AND the row matches every configured criterion, copy is blocked with BLOCKED_SIGNAL_FILTERS.
 * Semantics mirror dashboard slice filters: empty / unset = that dimension does not apply.
 */

const { getSession } = require('./sessionModel');

const SESSION_KEYS = new Set(['asian', 'london', 'newYork', 'off']);
const TREND_ALIGN_KEYS = new Set(['with', 'against', 'neutral', 'na']);
const TOP1_KEYS = new Set(['yes', 'no']);

function sessionKeyFromDate(date) {
  const s = getSession(date);
  if (s === 'asia') return 'asian';
  return s || 'off';
}

function sessionKeyFromRow(row, now = new Date()) {
  const fromSignal = String(row?.signalSession || '').trim();
  if (fromSignal && SESSION_KEYS.has(fromSignal)) return fromSignal;
  return sessionKeyFromDate(now);
}

function normalizeStringList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
}

function normalizeUpperList(raw) {
  return normalizeStringList(raw).map((x) => x.toUpperCase());
}

function normalizeLowerList(raw) {
  return normalizeStringList(raw).map((x) => x.toLowerCase());
}

function normalizeWeekdayList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const x of raw) {
    const n = Number(x);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function normalizeVwapHvnList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const x of raw) {
    const s = String(x || '').trim().toLowerCase();
    const v = s === 'n/a' ? 'na' : s;
    if (v === 'yes' || v === 'no' || v === 'na') out.add(v);
  }
  return [...out];
}

function normalizeTrendAlignList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const x of raw) {
    const s = String(x || '').trim().toLowerCase();
    const v = s === 'n/a' ? 'na' : s;
    if (TREND_ALIGN_KEYS.has(v)) out.add(v);
  }
  return [...out];
}

function normalizeTop1List(raw) {
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const x of raw) {
    const s = String(x || '').trim().toLowerCase();
    if (TOP1_KEYS.has(s)) out.add(s);
  }
  return [...out];
}

function normalizeMinThreshold(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeTypesList(raw) {
  const list = normalizeUpperList(raw);
  return list.filter((x) => x === 'BUY' || x === 'SELL');
}

function canonicalVwapHvn(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'n/a') return 'na';
  if (s === 'yes' || s === 'no' || s === 'na') return s;
  return '';
}

function canonicalTrendAlign(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'n/a') return 'na';
  if (TREND_ALIGN_KEYS.has(s)) return s;
  return '';
}

function canonicalTop1(raw) {
  if (raw === true || raw === 'true' || String(raw).toLowerCase() === 'yes') return 'yes';
  if (raw === false || raw === 'false' || String(raw).toLowerCase() === 'no') return 'no';
  return '';
}

function tradePresetTagList(trade) {
  const pts = Array.isArray(trade?.presetTags) ? trade.presetTags : [];
  const out = pts.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  const legacy = String(trade?.setup || '').trim().toLowerCase();
  if (legacy && !out.includes(legacy)) out.push(legacy);
  return out;
}

function signalSide(signal) {
  const t = String(signal?.type || '').toUpperCase();
  if (t.includes('BUY')) return 'BUY';
  if (t.includes('SELL')) return 'SELL';
  return '';
}

function signalNumericField(row, key) {
  const n = Number(row?.[key]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merge stored profile with defaults (pure).
 * @param {object} raw
 */
function coerceProfile(raw = {}) {
  return {
    symbolContains: String(raw.symbolContains || '').trim(),
    types: normalizeTypesList(raw.types),
    channels: normalizeStringList(raw.channels),
    timeframes: normalizeUpperList(raw.timeframes),
    symbols: normalizeUpperList(raw.symbols),
    biasTerms: normalizeLowerList(raw.biasTerms),
    setupTerms: normalizeLowerList(raw.setupTerms),
    vwapBands: normalizeVwapHvnList(raw.vwapBands),
    hvnBands: normalizeVwapHvnList(raw.hvnBands),
    trendAlignTerms: normalizeTrendAlignList(raw.trendAlignTerms),
    top1Values: normalizeTop1List(raw.top1Values),
    confluenceMin: normalizeMinThreshold(raw.confluenceMin),
    rejPctMin: normalizeMinThreshold(raw.rejPctMin),
    sessionNames: normalizeStringList(raw.sessionNames).filter((k) => SESSION_KEYS.has(k)),
    weekdayIndices: normalizeWeekdayList(raw.weekdayIndices)
  };
}

function profileHasActiveCriteria(p) {
  if (p.symbolContains) return true;
  if (p.types.length) return true;
  if (p.channels.length) return true;
  if (p.timeframes.length) return true;
  if (p.symbols.length) return true;
  if (p.biasTerms.length) return true;
  if (p.setupTerms.length) return true;
  if (p.vwapBands.length) return true;
  if (p.hvnBands.length) return true;
  if (p.trendAlignTerms.length) return true;
  if (p.top1Values.length) return true;
  if (p.confluenceMin != null) return true;
  if (p.rejPctMin != null) return true;
  if (p.sessionNames.length) return true;
  if (p.weekdayIndices.length) return true;
  return false;
}

/**
 * Row shape: fields available on a parsed signal / stored trade at send time.
 * Session uses signalSession when present, else UTC sessionModel at `now`.
 */
function rowMatchesProfile(row, p, now = new Date()) {
  if (p.symbolContains) {
    const sym = String(row.symbol || '').toLowerCase();
    if (!sym.includes(p.symbolContains.toLowerCase())) return false;
  }
  if (p.types.length) {
    const side = signalSide(row);
    if (!side || !p.types.includes(side)) return false;
  }
  if (p.channels.length) {
    const ch = String(row.channel || '').trim();
    if (!ch || !p.channels.includes(ch)) return false;
  }
  if (p.timeframes.length) {
    const tf = String(row.timeframe || '').toUpperCase().trim();
    if (!tf || !p.timeframes.includes(tf)) return false;
  }
  if (p.symbols.length) {
    const sym = String(row.symbol || '').toUpperCase().trim();
    if (!sym || !p.symbols.includes(sym)) return false;
  }
  if (p.biasTerms.length) {
    const b = String(row.bias || '').trim().toLowerCase();
    if (!b) return false;
    if (!p.biasTerms.includes(b)) return false;
  }
  if (p.setupTerms.length) {
    const tags = tradePresetTagList(row);
    if (!tags.length) return false;
    const want = new Set(p.setupTerms);
    if (!tags.some((t) => want.has(t))) return false;
  }
  if (p.vwapBands.length) {
    const v = canonicalVwapHvn(row.vwapBand);
    if (!v || !p.vwapBands.includes(v)) return false;
  }
  if (p.hvnBands.length) {
    const v = canonicalVwapHvn(row.hvnBand);
    if (!v || !p.hvnBands.includes(v)) return false;
  }
  if (p.trendAlignTerms.length) {
    const v = canonicalTrendAlign(row.trendAlign);
    if (!v || !p.trendAlignTerms.includes(v)) return false;
  }
  if (p.top1Values.length) {
    const v = canonicalTop1(row.top1);
    if (!v || !p.top1Values.includes(v)) return false;
  }
  if (p.confluenceMin != null) {
    const c = signalNumericField(row, 'confluence');
    if (c == null || c < p.confluenceMin) return false;
  }
  if (p.rejPctMin != null) {
    const r = signalNumericField(row, 'rejPct');
    if (r == null || r < p.rejPctMin) return false;
  }
  if (p.sessionNames.length) {
    const sess = sessionKeyFromRow(row, now);
    if (!sess || !p.sessionNames.includes(sess)) return false;
  }
  if (p.weekdayIndices.length) {
    if (!p.weekdayIndices.includes(now.getDay())) return false;
  }
  return true;
}

function summarizeProfileMatch(p) {
  const parts = [];
  if (p.symbolContains) parts.push(`symbol ~ "${p.symbolContains}"`);
  if (p.types.length) parts.push(`type: ${p.types.join('/')}`);
  if (p.channels.length) parts.push(`channel: ${p.channels.join('|')}`);
  if (p.timeframes.length) parts.push(`TF: ${p.timeframes.join(',')}`);
  if (p.symbols.length) parts.push(`pairs: ${p.symbols.join(',')}`);
  if (p.biasTerms.length) parts.push(`bias: ${p.biasTerms.join(',')}`);
  if (p.setupTerms.length) parts.push(`setup/tags: ${p.setupTerms.slice(0, 4).join(';')}${p.setupTerms.length > 4 ? '…' : ''}`);
  if (p.vwapBands.length) parts.push(`VWAP: ${p.vwapBands.join(',')}`);
  if (p.hvnBands.length) parts.push(`HVN: ${p.hvnBands.join(',')}`);
  if (p.trendAlignTerms.length) parts.push(`trend: ${p.trendAlignTerms.join(',')}`);
  if (p.top1Values.length) parts.push(`top1: ${p.top1Values.join(',')}`);
  if (p.confluenceMin != null) parts.push(`confluence ≥ ${p.confluenceMin}`);
  if (p.rejPctMin != null) parts.push(`rej ≥ ${p.rejPctMin}%`);
  if (p.sessionNames.length) parts.push(`session: ${p.sessionNames.join(',')}`);
  if (p.weekdayIndices.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    parts.push(`weekday: ${p.weekdayIndices.map((i) => names[i] ?? i).join(',')}`);
  }
  return parts.join(' · ');
}

/**
 * @param {object} settings
 * @param {object} row — signal + channel, or trade row
 * @param {Date} [now]
 * @returns {{ blocked: boolean, reason: string }}
 */
function evaluateAdvancedSignalBlock(settings, row, now = new Date()) {
  if (settings?.enableAdvancedSignalBlockFilters !== true) {
    return { blocked: false, reason: '' };
  }
  const p = coerceProfile(settings.signalBlockFilters);
  if (!profileHasActiveCriteria(p)) {
    return { blocked: false, reason: '' };
  }
  if (!rowMatchesProfile(row, p, now)) {
    return { blocked: false, reason: '' };
  }
  const detail = summarizeProfileMatch(p);
  return {
    blocked: true,
    reason: detail
      ? `Blocked by advanced signal filters — matched: ${detail}`
      : 'Blocked by advanced signal filters (Settings → Filters)'
  };
}

module.exports = {
  coerceProfile,
  profileHasActiveCriteria,
  rowMatchesProfile,
  evaluateAdvancedSignalBlock,
  defaultSignalBlockFilters: () => ({
    symbolContains: '',
    types: [],
    channels: [],
    timeframes: [],
    symbols: [],
    biasTerms: [],
    setupTerms: [],
    vwapBands: [],
    hvnBands: [],
    trendAlignTerms: [],
    top1Values: [],
    confluenceMin: null,
    rejPctMin: null,
    sessionNames: [],
    weekdayIndices: []
  })
};
