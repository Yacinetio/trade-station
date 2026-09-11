import { formatWeekdaySliceOption, sortWeekdayIndicesMonFirst } from './tradeSliceFilters.js';

/** Human-readable summary of active trade filters (dashboard + trades). */
export function buildFilterSummaryText({
  scopeMetricLabel = '',
  effectiveAccountKeysCount = 0,
  signalsTab = 'ALL',
  filterSymbol = '',
  filterType = 'ALL',
  filterStatus = 'ALL',
  filterChannel = 'ALL',
  sliceTimeframes = [],
  slicePairs = [],
  sliceBiases = [],
  sliceSetups = [],
  sliceVwapBands = [],
  sliceHvnBands = [],
  sliceSessions = [],
  sliceWeekdays = [],
  sliceTags = []
} = {}) {
  const parts = [];
  if (scopeMetricLabel) parts.push(`Calendar: ${scopeMetricLabel}`);
  if (effectiveAccountKeysCount > 0) {
    parts.push(`Accounts narrowed: ${effectiveAccountKeysCount}`);
  }
  parts.push(`Tab: ${signalsTab}`);
  if (String(filterSymbol || '').trim()) parts.push(`Symbol search: "${String(filterSymbol).trim()}"`);
  if (filterType !== 'ALL') parts.push(`Type: ${filterType}`);
  if (filterStatus !== 'ALL') parts.push(`Status filter: ${filterStatus}`);
  if (filterChannel !== 'ALL') parts.push(`Channel: ${filterChannel}`);
  if (sliceTimeframes.length) parts.push(`Slice TF (OR): ${sliceTimeframes.join(', ')}`);
  if (slicePairs.length) parts.push(`Slice pairs (OR): ${slicePairs.join(', ')}`);
  if (sliceBiases.length) parts.push(`Slice bias (OR): ${sliceBiases.join(', ')}`);
  if (sliceSetups.length) {
    const shown = sliceSetups.slice(0, 10);
    parts.push(`Slice setup (OR): ${shown.join('; ')}${sliceSetups.length > 10 ? ' …' : ''}`);
  }
  if (sliceVwapBands.length) {
    const vw = sliceVwapBands.map((v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a'));
    parts.push(`Slice VWAP (OR): ${vw.join(', ')}`);
  }
  if (sliceHvnBands.length) {
    const hv = sliceHvnBands.map((v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a'));
    parts.push(`Slice HVN (OR): ${hv.join(', ')}`);
  }
  if (sliceSessions.length) {
    const lab = { asian: 'Asian', london: 'London', newYork: 'NY' };
    parts.push(`Slice session (OR): ${sliceSessions.map((s) => lab[s] || s).join(', ')}`);
  }
  if (sliceWeekdays.length) {
    const label = sortWeekdayIndicesMonFirst(sliceWeekdays).map(formatWeekdaySliceOption).join(', ');
    parts.push(`Weekdays (OR): ${label}`);
  }
  if (sliceTags.length) parts.push(`Tags (OR): ${sliceTags.join(', ')}`);
  return parts.join(' · ');
}
