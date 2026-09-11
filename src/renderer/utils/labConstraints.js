import { tradeMatchesSlice } from './tradeSliceFilters.js';
import { formatWeekdaySliceOption, sortWeekdayIndicesMonFirst } from './tradeSliceFilters.js';

export const EMPTY_LAB_CONSTRAINTS = {
  sliceTimeframes: [],
  slicePairs: [],
  sliceBiases: [],
  sliceSetups: [],
  sliceVwapBands: [],
  sliceHvnBands: [],
  sliceTrendAligns: [],
  sliceKillzones: [],
  sliceConfluenceTiers: [],
  sliceTop1Values: [],
  sliceSessions: [],
  sliceWeekdays: [],
  sliceTags: [],
  filterType: 'ALL',
  filterChannel: 'ALL'
};

export function labConstraintsToSlicePayload(constraints = {}) {
  return {
    timeframes: constraints.sliceTimeframes || [],
    symbols: constraints.slicePairs || [],
    biasTerms: constraints.sliceBiases || [],
    setupTerms: constraints.sliceSetups || [],
    vwapBands: constraints.sliceVwapBands || [],
    hvnBands: constraints.sliceHvnBands || [],
    trendAligns: constraints.sliceTrendAligns || [],
    killzones: constraints.sliceKillzones || [],
    confluenceTiers: constraints.sliceConfluenceTiers || [],
    top1Values: constraints.sliceTop1Values || [],
    sessions: constraints.sliceSessions || [],
    weekdays: constraints.sliceWeekdays || []
  };
}

export function tradeMatchesLabConstraints(trade, constraints = {}) {
  const c = { ...EMPTY_LAB_CONSTRAINTS, ...constraints };
  if (!tradeMatchesSlice(trade, labConstraintsToSlicePayload(c))) return false;
  if (c.filterType !== 'ALL' && String(trade?.type || '').toUpperCase() !== c.filterType) return false;
  if (c.filterChannel !== 'ALL' && String(trade?.channel || '') !== c.filterChannel) return false;
  if (Array.isArray(c.sliceTags) && c.sliceTags.length > 0) {
    const tags = [
      ...(Array.isArray(trade?.journal?.tags) ? trade.journal.tags : []),
      ...(Array.isArray(trade?.presetTags) ? trade.presetTags : [])
    ].map((x) => String(x || '').toLowerCase());
    if (!c.sliceTags.some((wanted) => tags.includes(String(wanted).toLowerCase()))) return false;
  }
  return true;
}

export function labConstraintsToFilterPatch(constraints = {}) {
  const c = { ...EMPTY_LAB_CONSTRAINTS, ...constraints };
  const patch = {};
  if (c.sliceTimeframes.length) patch.sliceTimeframes = [...c.sliceTimeframes];
  if (c.slicePairs.length) {
    patch.slicePairs = [...c.slicePairs];
    if (c.slicePairs.length === 1) patch.filterSymbol = c.slicePairs[0];
  }
  if (c.sliceBiases.length) patch.sliceBiases = [...c.sliceBiases];
  if (c.sliceSetups.length) patch.sliceSetups = [...c.sliceSetups];
  if (c.sliceVwapBands.length) patch.sliceVwapBands = [...c.sliceVwapBands];
  if (c.sliceHvnBands.length) patch.sliceHvnBands = [...c.sliceHvnBands];
  if (c.sliceTrendAligns.length) patch.sliceTrendAligns = [...c.sliceTrendAligns];
  if (c.sliceKillzones.length) patch.sliceKillzones = [...c.sliceKillzones];
  if (c.sliceConfluenceTiers.length) patch.sliceConfluenceTiers = [...c.sliceConfluenceTiers];
  if (c.sliceTop1Values.length) patch.sliceTop1Values = [...c.sliceTop1Values];
  if (c.sliceSessions.length) patch.sliceSessions = [...c.sliceSessions];
  if (c.sliceWeekdays.length) patch.sliceWeekdays = [...c.sliceWeekdays];
  if (c.sliceTags.length) patch.sliceTags = [...c.sliceTags];
  if (c.filterType !== 'ALL') patch.filterType = c.filterType;
  if (c.filterChannel !== 'ALL') patch.filterChannel = c.filterChannel;
  return patch;
}

export function buildLabConstraintsSummary(constraints = {}) {
  const c = { ...EMPTY_LAB_CONSTRAINTS, ...constraints };
  const parts = [];
  if (c.slicePairs.length) parts.push(`Pair: ${c.slicePairs.join(', ')}`);
  if (c.sliceWeekdays.length) {
    const days = sortWeekdayIndicesMonFirst(c.sliceWeekdays).map(formatWeekdaySliceOption).join(', ');
    parts.push(`Weekday: ${days}`);
  }
  if (c.sliceTimeframes.length) parts.push(`TF: ${c.sliceTimeframes.join(', ')}`);
  if (c.sliceSessions.length) {
    const lab = { asian: 'Asian', london: 'London', newYork: 'NY' };
    parts.push(`Session: ${c.sliceSessions.map((s) => lab[s] || s).join(', ')}`);
  }
  if (c.sliceVwapBands.length) {
    const vw = c.sliceVwapBands.map((v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a'));
    parts.push(`VWAP: ${vw.join(', ')}`);
  }
  if (c.sliceHvnBands.length) {
    const hv = c.sliceHvnBands.map((v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a'));
    parts.push(`HVN: ${hv.join(', ')}`);
  }
  if (c.sliceTrendAligns.length) {
    parts.push(`Trend: ${c.sliceTrendAligns.join(', ')}`);
  }
  if (c.sliceKillzones.length) {
    parts.push(`Killzone: ${c.sliceKillzones.join(', ')}`);
  }
  if (c.sliceConfluenceTiers.length) {
    parts.push(`Confluence: ${c.sliceConfluenceTiers.join(', ')}`);
  }
  if (c.sliceTop1Values.length) {
    parts.push(`Top-1: ${c.sliceTop1Values.map((v) => v.toUpperCase()).join(', ')}`);
  }
  if (c.sliceBiases.length) parts.push(`Bias: ${c.sliceBiases.join(', ')}`);
  if (c.sliceSetups.length) {
    const shown = c.sliceSetups.slice(0, 3);
    parts.push(`Setup: ${shown.join('; ')}${c.sliceSetups.length > 3 ? '…' : ''}`);
  }
  if (c.sliceTags.length) parts.push(`Tags: ${c.sliceTags.join(', ')}`);
  if (c.filterType !== 'ALL') parts.push(`Type: ${c.filterType}`);
  if (c.filterChannel !== 'ALL') parts.push(`Channel: ${c.filterChannel}`);
  return parts.join(' · ');
}

export function labConstraintsAreEmpty(constraints = {}) {
  return !buildLabConstraintsSummary(constraints);
}
