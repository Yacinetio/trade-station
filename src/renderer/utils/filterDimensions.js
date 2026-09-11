import { normalizeTradeBuiltinColumns } from './tradeColumnDefs.js';

/**
 * Filter / slice dimensions tied to built-in table columns (Settings → Columns).
 * `optimizerId` matches keys used in filterOptimizer breakdown.
 */
export const FILTER_DIMENSION_DEFS = [
  { id: 'weekday', optimizerId: 'weekday', label: 'Weekday', columnId: null, alwaysOn: true },
  { id: 'symbol', optimizerId: 'symbol', label: 'Pair', columnId: 'symbol' },
  { id: 'timeframe', optimizerId: 'timeframe', label: 'TF', columnId: 'timeframe' },
  { id: 'session', optimizerId: 'session', label: 'Session', columnId: null, alwaysOn: true },
  { id: 'vwap', optimizerId: 'vwap', label: 'VWAP', columnId: 'vwapBand' },
  { id: 'hvn', optimizerId: 'hvn', label: 'HVN', columnId: 'hvnBand' },
  { id: 'trend', optimizerId: 'trend', label: 'Trend', columnId: 'trendAlign' },
  { id: 'killzone', optimizerId: 'killzone', label: 'Killzone', columnId: null, alwaysOn: true },
  { id: 'confluence', optimizerId: 'confluence', label: 'Confluence', columnId: null, alwaysOn: true },
  { id: 'top1', optimizerId: 'top1', label: 'Top-1', columnId: null, alwaysOn: true },
  { id: 'bias', optimizerId: 'bias', label: 'Bias', columnId: 'bias' },
  { id: 'setup', optimizerId: 'setup', label: 'Setup', columnId: 'setup' },
  { id: 'tags', optimizerId: 'tags', label: 'Tags', columnId: null, alwaysOn: true },
  { id: 'side', optimizerId: 'side', label: 'Type', columnId: 'type' },
  { id: 'channel', optimizerId: 'channel', label: 'Channel', columnId: 'channel' }
];

const SLICE_FILTER_KEYS = {
  setup: 'sliceSetups',
  bias: 'sliceBiases',
  timeframe: 'sliceTimeframes',
  vwap: 'sliceVwapBands',
  hvn: 'sliceHvnBands',
  trend: 'sliceTrendAligns',
  killzone: 'sliceKillzones',
  confluence: 'sliceConfluenceTiers',
  top1: 'sliceTop1Values',
  symbol: 'slicePairs',
  weekday: 'sliceWeekdays',
  session: 'sliceSessions',
  tags: 'sliceTags',
  side: 'filterType',
  channel: 'filterChannel'
};

export function resolveFilterDimensions(tradeBuiltinColumns = []) {
  const cols = normalizeTradeBuiltinColumns(tradeBuiltinColumns);
  const colEnabled = new Map(cols.map((c) => [c.id, c.enabled !== false]));

  const enabled = new Set();
  const disabled = [];

  for (const def of FILTER_DIMENSION_DEFS) {
    const isEnabled = def.alwaysOn || !def.columnId || colEnabled.get(def.columnId) !== false;
    if (isEnabled) enabled.add(def.id);
    else disabled.push(def);
  }

  return {
    enabled,
    disabled,
    disabledOptimizerIds: disabled.map((d) => d.optimizerId)
  };
}

export function isFilterDimensionEnabled(dimId, tradeBuiltinColumns = []) {
  return resolveFilterDimensions(tradeBuiltinColumns).enabled.has(dimId);
}

/** Clear slice filter values for dimensions hidden in Settings → Columns. */
export function stripDisabledSliceFilters(tradeFilters = {}, tradeBuiltinColumns = []) {
  const { enabled } = resolveFilterDimensions(tradeBuiltinColumns);
  const patch = {};

  for (const def of FILTER_DIMENSION_DEFS) {
    if (enabled.has(def.id)) continue;
    const key = SLICE_FILTER_KEYS[def.id];
    if (!key) continue;
    if (def.id === 'side') {
      if (tradeFilters.filterType && tradeFilters.filterType !== 'ALL') patch.filterType = 'ALL';
      continue;
    }
    if (def.id === 'channel') {
      if (tradeFilters.filterChannel && tradeFilters.filterChannel !== 'ALL') patch.filterChannel = 'ALL';
      continue;
    }
    const val = tradeFilters[key];
    if (Array.isArray(val) && val.length > 0) patch[key] = [];
  }

  return patch;
}

export function stripDisabledLabConstraints(constraints = {}, tradeBuiltinColumns = []) {
  const { enabled } = resolveFilterDimensions(tradeBuiltinColumns);
  const patch = { ...constraints };

  for (const def of FILTER_DIMENSION_DEFS) {
    if (enabled.has(def.id)) continue;
    const key = SLICE_FILTER_KEYS[def.id];
    if (!key) continue;
    if (def.id === 'side') {
      patch.filterType = 'ALL';
      continue;
    }
    if (def.id === 'channel') {
      patch.filterChannel = 'ALL';
      continue;
    }
    patch[key] = [];
  }

  return patch;
}

export const FILTER_LAB_RANK_OPTIONS = [
  { id: 'balanced', label: 'WR + P&L (balanced)' },
  { id: 'winrate', label: 'Win rate' },
  { id: 'pnl', label: 'P&L' },
  { id: 'decisive', label: 'Sample size' }
];

export function rankByLabel(rankBy = 'balanced') {
  return FILTER_LAB_RANK_OPTIONS.find((o) => o.id === rankBy)?.label || 'WR + P&L';
}
