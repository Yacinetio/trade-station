/**
 * Built-in trade table column overrides (Settings → Columns).
 * CJS mirror of renderer tradeColumnDefs builtins list.
 */

const BUILTIN_IDS = [
  'timeIn', 'timeOut', 'account', 'channel', 'symbol', 'timeframe', 'bias', 'setup',
  'vwapBand', 'hvnBand', 'trendAlign', 'obSize', 'type', 'sigEntry', 'entry', 'avgEntry', 'sl', 'tp', 'lot',
  'rr', 'profit', 'status', 'blockReason', 'comment', 'shots', 'replay'
];

const BUILTIN_DEFAULTS = {
  timeIn: { label: 'OPEN', width: 124, sortable: true },
  timeOut: { label: 'CLOSE', width: 124, sortable: true },
  account: { label: 'ACCOUNT', width: 120, sortable: true },
  channel: { label: 'CHANNEL', width: 110, sortable: true },
  symbol: { label: 'SYMBOL', width: 80, sortable: true },
  timeframe: { label: 'TF', width: 44, sortable: true },
  bias: { label: 'BIAS', width: 108, sortable: true },
  setup: { label: 'SETUP', width: 72, sortable: true },
  vwapBand: { label: 'VWAP', width: 56, sortable: true },
  hvnBand: { label: 'HVN', width: 48, sortable: true },
  trendAlign: { label: 'TREND', width: 64, sortable: true },
  obSize: { label: 'OB SZ', width: 72, sortable: true },
  type: { label: 'TYPE', width: 60, sortable: true },
  sigEntry: { label: 'SIG @', width: 76, sortable: true },
  entry: { label: 'EXEC @', width: 80, sortable: true },
  avgEntry: { label: 'AVG', width: 72, sortable: true },
  sl: { label: 'SL', width: 80, sortable: true },
  tp: { label: 'TP', width: 80, sortable: true },
  lot: { label: 'LOT', width: 52, sortable: true },
  rr: { label: 'R:R', width: 58, sortable: true },
  profit: { label: 'PROFIT', width: 86, sortable: true },
  status: { label: 'STATUS', width: 94, sortable: true },
  blockReason: { label: 'TAG', width: 72, sortable: true },
  comment: { label: 'NOTE', width: 150, sortable: false },
  shots: { label: 'SHOTS', width: 80, sortable: true },
  replay: { label: 'REPLAY', width: 72, sortable: false }
};

function clampWidth(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 90;
  return Math.min(320, Math.max(40, Math.round(v)));
}

function normalizeTradeBuiltinColumns(raw) {
  const overrides = new Map();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = String(item?.id || '').trim();
      if (!id || !BUILTIN_DEFAULTS[id]) continue;
      overrides.set(id, item);
    }
  }
  return BUILTIN_IDS.map((id) => {
    const def = BUILTIN_DEFAULTS[id];
    const o = overrides.get(id);
    if (!o) {
      return { id, label: def.label, width: def.width, sortable: def.sortable, enabled: true, builtin: true };
    }
    return {
      id,
      label: String(o.label || def.label).trim().toUpperCase() || def.label,
      width: clampWidth(o.width ?? def.width),
      sortable: o.sortable !== false && def.sortable !== false,
      enabled: o.enabled !== false,
      builtin: true
    };
  });
}

function serializeTradeBuiltinColumns(rows) {
  return (Array.isArray(rows) ? rows : []).map((c) => ({
    id: c.id,
    label: c.label,
    width: c.width,
    enabled: c.enabled !== false,
    sortable: c.sortable !== false
  }));
}

module.exports = {
  BUILTIN_IDS,
  normalizeTradeBuiltinColumns,
  serializeTradeBuiltinColumns
};
