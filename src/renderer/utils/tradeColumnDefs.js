/** Built-in trade table columns — custom fields from settings are merged on top. */

export const BUILTIN_COLUMN_DEFS = [
  { id: 'timeIn', label: 'OPEN', width: 124, sortable: true, builtin: true },
  { id: 'timeOut', label: 'CLOSE', width: 124, sortable: true, builtin: true },
  { id: 'account', label: 'ACCOUNT', width: 120, sortable: true, builtin: true },
  { id: 'channel', label: 'CHANNEL', width: 110, sortable: true, builtin: true },
  { id: 'symbol', label: 'SYMBOL', width: 80, sortable: true, builtin: true },
  { id: 'timeframe', label: 'TF', width: 44, sortable: true, builtin: true },
  { id: 'bias', label: 'BIAS', width: 108, sortable: true, builtin: true },
  { id: 'fundBias', label: 'FUND', width: 82, sortable: true, builtin: true },
  { id: 'setup', label: 'SETUP', width: 72, sortable: true, builtin: true },
  { id: 'tags', label: 'TAGS', width: 110, sortable: true, builtin: true },
  { id: 'vwapBand', label: 'VWAP', width: 56, sortable: true, builtin: true },
  { id: 'hvnBand', label: 'HVN', width: 48, sortable: true, builtin: true },
  { id: 'trendAlign', label: 'TREND', width: 64, sortable: true, builtin: true },
  { id: 'obSize', label: 'OB SZ', width: 72, sortable: true, builtin: true },
  { id: 'type', label: 'TYPE', width: 60, sortable: true, builtin: true },
  { id: 'sigEntry', label: 'SIG @', width: 76, sortable: true, builtin: true },
  { id: 'entry', label: 'EXEC @', width: 80, sortable: true, builtin: true },
  { id: 'avgEntry', label: 'AVG', width: 72, sortable: true, builtin: true },
  { id: 'sl', label: 'SL', width: 80, sortable: true, builtin: true },
  { id: 'tp', label: 'TP', width: 80, sortable: true, builtin: true },
  { id: 'lot', label: 'LOT', width: 52, sortable: true, builtin: true },
  { id: 'rr', label: 'R:R', width: 58, sortable: true, builtin: true },
  { id: 'profit', label: 'PROFIT', width: 86, sortable: true, builtin: true },
  { id: 'status', label: 'STATUS', width: 94, sortable: true, builtin: true },
  { id: 'blockReason', label: 'TAG', width: 72, sortable: true, builtin: true },
  { id: 'comment', label: 'NOTE', width: 150, sortable: false, builtin: true },
  { id: 'shots', label: 'SHOTS', width: 80, sortable: true, builtin: true },
  { id: 'replay', label: 'REPLAY', width: 72, sortable: false, builtin: true },
  // ─── TradeZella-parity columns — agents: replace ONLY your own anchor line ───
  { id: 'mfe', label: 'MFE', width: 76, sortable: true, builtin: true },
  { id: 'mae', label: 'MAE', width: 76, sortable: true, builtin: true },
  { id: 'efficiency', label: 'EFF %', width: 64, sortable: true, builtin: true },
  { id: 'rating', label: 'RATE', width: 56, sortable: true, builtin: true },
];

export function normalizeCustomTradeColumnsForUi(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && String(c.parseKey || '').trim())
    .map((c) => ({
      id: String(c.id || '').trim(),
      label: String(c.label || c.parseKey || '').trim().toUpperCase(),
      parseKey: String(c.parseKey || '').trim(),
      width: Number.isFinite(Number(c.width)) ? Number(c.width) : 90,
      enabled: c.enabled !== false,
      sortable: c.sortable !== false,
      mapToPresetTags: c.mapToPresetTags === true,
      tags: Array.isArray(c.tags) ? c.tags.map((x) => String(x || '').trim()).filter(Boolean) : []
    }));
}

function clampColumnWidth(n, fallback = 90) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(320, Math.max(40, Math.round(v)));
}

/** Merge settings overrides onto built-in column defs. Empty settings = all defaults enabled. */
export function normalizeTradeBuiltinColumns(tradeBuiltinColumns = []) {
  const overrides = new Map();
  if (Array.isArray(tradeBuiltinColumns)) {
    for (const item of tradeBuiltinColumns) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      overrides.set(id, item);
    }
  }
  return BUILTIN_COLUMN_DEFS.map((def) => {
    const o = overrides.get(def.id);
    if (!o) return { ...def, enabled: true };
    return {
      ...def,
      label: String(o.label || def.label).trim().toUpperCase() || def.label,
      width: clampColumnWidth(o.width, def.width),
      sortable: o.sortable !== false && def.sortable !== false,
      enabled: o.enabled !== false
    };
  });
}

export function serializeTradeBuiltinColumns(rows = []) {
  return rows.map((c) => ({
    id: c.id,
    label: c.label,
    width: c.width,
    enabled: c.enabled !== false,
    sortable: c.sortable !== false
  }));
}

export function buildTradeColumnDefs(customTradeColumns = [], tradeBuiltinColumns = []) {
  const builtins = normalizeTradeBuiltinColumns(tradeBuiltinColumns).filter((c) => c.enabled !== false);
  const custom = normalizeCustomTradeColumnsForUi(customTradeColumns)
    .filter((c) => c.enabled !== false)
    .map((c) => ({
      id: c.id,
      label: c.label,
      width: c.width,
      sortable: c.sortable !== false,
      builtin: false,
      parseKey: c.parseKey,
      mapToPresetTags: c.mapToPresetTags,
      tags: c.tags
    }));
  return [...builtins, ...custom];
}

export function getDefaultVisibleColumnIds(columnDefs = BUILTIN_COLUMN_DEFS) {
  return columnDefs.map((c) => c.id);
}

export function normalizeStoredVisibleColumns(rawIds, columnDefs = BUILTIN_COLUMN_DEFS) {
  const allowed = new Set(columnDefs.map((c) => c.id));
  let next = (Array.isArray(rawIds) ? rawIds : []).filter((id) => allowed.has(id) || id === 'time');
  const ti = next.indexOf('time');
  if (ti >= 0) {
    next = next.filter((id) => id !== 'time');
    next.splice(ti, 0, 'timeIn', 'timeOut');
  }
  next = next.filter((id) => allowed.has(id));
  if (next.length === 0) return getDefaultVisibleColumnIds(columnDefs);
  const insert = ['bias', 'fundBias', 'setup', 'tags', 'vwapBand', 'hvnBand', 'trendAlign', 'obSize'].filter((id) => allowed.has(id) && !next.includes(id));
  if (insert.length) {
    const tfIdx = next.indexOf('timeframe');
    if (tfIdx >= 0) next = [...next.slice(0, tfIdx + 1), ...insert, ...next.slice(tfIdx + 1)];
    else next = [...next, ...insert];
  }
  const entryIdx = next.indexOf('entry');
  if (entryIdx >= 0 && allowed.has('sigEntry') && !next.includes('sigEntry')) {
    next = [...next.slice(0, entryIdx), 'sigEntry', ...next.slice(entryIdx)];
  }
  // Append any new custom columns not yet in saved visibility list
  for (const col of columnDefs) {
    if (!col.builtin && !next.includes(col.id)) next.push(col.id);
  }
  return next;
}
