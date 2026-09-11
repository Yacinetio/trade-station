import {
  tradeMatchesSlice,
  canonicalTradeVwapBand,
  canonicalTradeHvnBand,
  tradeSessionLocal
} from './tradeSliceFilters.js';
import { EMPTY_LAB_CONSTRAINTS, tradeMatchesLabConstraints } from './labConstraints.js';
import { getTradeOutcome } from './tradeStatus.js';

/** Merge base lab locks + combo patch into tradeFilters-shaped object. */
export function mergeFilterPatches(baseConstraints = {}, patch = {}) {
  const c = { ...EMPTY_LAB_CONSTRAINTS, ...baseConstraints };
  return {
    ...c,
    sliceTimeframes: patch.sliceTimeframes ?? c.sliceTimeframes,
    slicePairs: patch.slicePairs ?? c.slicePairs,
    sliceBiases: patch.sliceBiases ?? c.sliceBiases,
    sliceSetups: patch.sliceSetups ?? c.sliceSetups,
    sliceVwapBands: patch.sliceVwapBands ?? c.sliceVwapBands,
    sliceHvnBands: patch.sliceHvnBands ?? c.sliceHvnBands,
    sliceTrendAligns: patch.sliceTrendAligns ?? c.sliceTrendAligns,
    sliceKillzones: patch.sliceKillzones ?? c.sliceKillzones,
    sliceConfluenceTiers: patch.sliceConfluenceTiers ?? c.sliceConfluenceTiers,
    sliceTop1Values: patch.sliceTop1Values ?? c.sliceTop1Values,
    sliceSessions: patch.sliceSessions ?? c.sliceSessions,
    sliceWeekdays: patch.sliceWeekdays ?? c.sliceWeekdays,
    sliceTags: patch.sliceTags ?? c.sliceTags,
    filterType: patch.filterType ?? c.filterType,
    filterChannel: patch.filterChannel ?? c.filterChannel
  };
}

export function tradesMatchingFilterPatch(trades = [], baseConstraints = {}, patch = {}) {
  const merged = mergeFilterPatches(baseConstraints, patch);
  return trades.filter((t) => tradeMatchesLabConstraints(t, merged));
}

export function computeTradesInsightStats(trades = [], breakEvenAmount = 50) {
  const be = Math.max(0, Number(breakEvenAmount ?? 50) || 50);
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const o = getTradeOutcome(t, be);
    if (o === 'TP' || (o === 'CLOSED' && Number(t.profit) > be)) wins += 1;
    else if (o === 'SL' || (o === 'CLOSED' && Number(t.profit) < -be)) losses += 1;
  }
  const decisive = wins + losses;
  const pnl = trades.reduce((s, t) => s + Number(t.profit || 0), 0);
  return {
    tradeCount: trades.length,
    wins,
    losses,
    decisive,
    winRate: decisive > 0 ? Number(((wins / decisive) * 100).toFixed(1)) : null,
    pnl: Number(pnl.toFixed(2))
  };
}

export function formatTradeRowLabel(trade) {
  const parts = [
    String(trade?.symbol || '').toUpperCase(),
    String(trade?.timeframe || '').toUpperCase(),
    String(trade?.type || '').toUpperCase()
  ].filter(Boolean);
  const sess = tradeSessionLocal(trade);
  if (sess) parts.push(sess === 'newYork' ? 'NY' : sess);
  const vw = canonicalTradeVwapBand(trade);
  if (vw === 'yes' || vw === 'no') parts.push(`vwap:${vw}`);
  return parts.join(' · ') || '—';
}
