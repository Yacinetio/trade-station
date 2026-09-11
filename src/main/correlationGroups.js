/**
 * Correlation clusters — symbols that move together for execution guard
 * (block opposing direction on another symbol in the same group).
 */

const SYMBOL_ALIASES = {
  NAS100: 'US100',
  'US100.CASH': 'US100',
  'US30.CASH': 'US30',
  'US500.CASH': 'US500',
  DJ30: 'US30',
  DJI: 'US30',
  DOW: 'US30',
  SPX500: 'US500',
  SPX: 'US500',
  USTEC: 'US100'
};

/** Built-in groups shipped with the app (also the Settings “Reset defaults”). */
const DEFAULT_CORRELATION_GROUPS = [
  ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'],
  ['EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY'],
  ['US100', 'US30', 'US500'],
  ['XAUUSD', 'XAGUSD']
];

/** Previous default (pre US indices) — auto-upgrade on load. */
const LEGACY_DEFAULT_CORRELATION_GROUPS = [
  ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'],
  ['EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY']
];

/** Quick-add presets in Settings. */
const CORRELATION_GROUP_PRESETS = [
  {
    id: 'usd-majors',
    label: 'USD majors',
    symbols: ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD']
  },
  {
    id: 'jpy-crosses',
    label: 'JPY crosses',
    symbols: ['EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY']
  },
  {
    id: 'us-indices',
    label: 'US indices (Nasdaq · Dow · S&P)',
    symbols: ['US100', 'US30', 'US500']
  },
  {
    id: 'precious',
    label: 'Gold & silver',
    symbols: ['XAUUSD', 'XAGUSD']
  }
];

function normalizeCorrelationSymbol(sym) {
  const raw = String(sym || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (SYMBOL_ALIASES[upper]) return SYMBOL_ALIASES[upper];

  const m = upper.match(
    /\b(XAUUSD|XAGUSD|EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD|AUDUSD|NZDUSD|EURGBP|EURJPY|GBPJPY|EURAUD|EURNZD|EURCAD|EURCHF|AUDJPY|NZDJPY|CADJPY|AUDNZD|AUDCAD|CADCHF|NZDCHF|AUDCHF|GBPAUD|GBPNZD|BTCUSD|ETHUSD|US100|US30|US500|NAS100|GER40|UK100)[a-zA-Z0-9.]*/i
  );
  if (m) {
    const base = m[1].toUpperCase();
    return SYMBOL_ALIASES[base] || base;
  }

  const cleaned = upper.replace(/[^A-Z0-9.]/g, '');
  const noSuffix = cleaned.split('.')[0];
  return SYMBOL_ALIASES[noSuffix] || noSuffix.slice(0, 16) || '';
}

function groupsEqual(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((group, i) => {
    const gA = [...group].map(String).sort();
    const gB = [...(right[i] || [])].map(String).sort();
    return gA.length === gB.length && gA.every((v, j) => v === gB[j]);
  });
}

function cleanCorrelationGroups(raw) {
  if (!Array.isArray(raw)) return null;
  const cleaned = raw
    .map((group) => {
      if (!Array.isArray(group)) return [];
      return [...new Set(group.map(normalizeCorrelationSymbol).filter(Boolean))];
    })
    .filter((group) => group.length >= 2);
  return cleaned.length > 0 ? cleaned : null;
}

function upgradeCorrelationGroups(saved) {
  const cleaned = cleanCorrelationGroups(saved);
  if (!cleaned) return DEFAULT_CORRELATION_GROUPS.map((g) => [...g]);
  if (groupsEqual(cleaned, LEGACY_DEFAULT_CORRELATION_GROUPS)) {
    return DEFAULT_CORRELATION_GROUPS.map((g) => [...g]);
  }
  return cleaned;
}

function getCorrelationGroups(settings) {
  return upgradeCorrelationGroups(settings?.correlationGroups);
}

function parseCorrelationGroupInput(text) {
  return [...new Set(
    String(text || '')
      .split(/[,;\n]+/)
      .map((s) => normalizeCorrelationSymbol(s.trim()))
      .filter(Boolean)
  )];
}

function formatCorrelationGroupLabel(symbols = []) {
  const labels = {
    US100: 'Nasdaq (US100)',
    US30: 'Dow (US30)',
    US500: 'S&P (US500)',
    XAUUSD: 'Gold',
    XAGUSD: 'Silver'
  };
  return symbols.map((s) => labels[s] || s).join(', ');
}

module.exports = {
  DEFAULT_CORRELATION_GROUPS,
  LEGACY_DEFAULT_CORRELATION_GROUPS,
  CORRELATION_GROUP_PRESETS,
  normalizeCorrelationSymbol,
  cleanCorrelationGroups,
  upgradeCorrelationGroups,
  getCorrelationGroups,
  parseCorrelationGroupInput,
  formatCorrelationGroupLabel
};
