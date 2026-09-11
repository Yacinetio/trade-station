/**
 * Search best filter combinations for a trade sample (win rate + P&L ranking).
 * Uses the same slice dimensions as buildDashboardFilterStatsBreakdown.
 */

const { buildDashboardFilterStatsBreakdown, passesFilters } = require('./analyticsService');

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PAIR_SLICE_DIMS = {
  tf_vwap: ['timeframe', 'vwap'],
  tf_session: ['timeframe', 'session'],
  tf_bias: ['timeframe', 'bias'],
  tf_side: ['timeframe', 'side'],
  tf_trend: ['timeframe', 'trend'],
  tf_killzone: ['timeframe', 'killzone'],
  vwap_bias: ['vwap', 'bias'],
  hvn_vwap: ['hvn', 'vwap'],
  tf_setup: ['timeframe', 'setup']
};

function normalizeRankBy(raw) {
  const m = String(raw || 'balanced').toLowerCase();
  if (['winrate', 'wr', 'win_rate'].includes(m)) return 'winrate';
  if (['pnl', 'profit', 'p&l'].includes(m)) return 'pnl';
  if (['decisive', 'sample', 'trades'].includes(m)) return 'decisive';
  return 'balanced';
}

function rankScore(metrics, minDecisive = 3, rankBy = 'balanced') {
  if (!metrics || !metrics.decisive || metrics.decisive < minDecisive || metrics.winRate == null) {
    return -1e9;
  }
  const wr = Number(metrics.winRate) || 0;
  const pnl = Number(metrics.pnl) || 0;
  const pnlNorm = Math.tanh(pnl / 500) * 50;
  const sample = Math.min(metrics.decisive / 10, 1) * 15;
  const mode = normalizeRankBy(rankBy);
  switch (mode) {
    case 'winrate':
      return wr * 0.9 + sample * 0.1;
    case 'pnl':
      return pnlNorm * 0.9 + sample * 0.1;
    case 'decisive':
      return metrics.decisive * 5 + wr * 0.05;
    default:
      return wr * 0.45 + pnlNorm * 0.35 + sample * 0.2;
  }
}

function compareCandidates(a, b, rankBy = 'balanced') {
  const mode = normalizeRankBy(rankBy);
  if (mode === 'pnl') {
    return b.metrics.pnl - a.metrics.pnl
      || b.metrics.winRate - a.metrics.winRate
      || b.metrics.decisive - a.metrics.decisive;
  }
  if (mode === 'winrate') {
    return b.metrics.winRate - a.metrics.winRate
      || b.metrics.pnl - a.metrics.pnl
      || b.metrics.decisive - a.metrics.decisive;
  }
  if (mode === 'decisive') {
    return b.metrics.decisive - a.metrics.decisive
      || b.metrics.winRate - a.metrics.winRate
      || b.metrics.pnl - a.metrics.pnl;
  }
  return b.score - a.score
    || b.metrics.pnl - a.metrics.pnl
    || b.metrics.winRate - a.metrics.winRate;
}

function isSkippableKey(key) {
  const k = String(key || '').trim();
  return !k || k.startsWith('(');
}

function sessionLabelToKey(label) {
  const s = String(label || '').trim();
  const map = {
    Asian: 'asian',
    asian: 'asian',
    London: 'london',
    london: 'london',
    NY: 'newYork',
    'New York': 'newYork',
    newYork: 'newYork'
  };
  return map[s] || s.toLowerCase();
}

function normalizeLockedFilters(raw = {}) {
  const locked = raw && typeof raw === 'object' ? raw : {};
  return {
    sliceTimeframes: Array.isArray(locked.sliceTimeframes) ? locked.sliceTimeframes : [],
    slicePairs: Array.isArray(locked.slicePairs) ? locked.slicePairs : [],
    sliceBiases: Array.isArray(locked.sliceBiases) ? locked.sliceBiases : [],
    sliceSetups: Array.isArray(locked.sliceSetups) ? locked.sliceSetups : [],
    sliceVwapBands: Array.isArray(locked.sliceVwapBands) ? locked.sliceVwapBands : [],
    sliceHvnBands: Array.isArray(locked.sliceHvnBands) ? locked.sliceHvnBands : [],
    sliceTrendAligns: Array.isArray(locked.sliceTrendAligns) ? locked.sliceTrendAligns : [],
    sliceKillzones: Array.isArray(locked.sliceKillzones) ? locked.sliceKillzones : [],
    sliceConfluenceTiers: Array.isArray(locked.sliceConfluenceTiers) ? locked.sliceConfluenceTiers : [],
    sliceTop1Values: Array.isArray(locked.sliceTop1Values) ? locked.sliceTop1Values : [],
    sliceSessions: Array.isArray(locked.sliceSessions) ? locked.sliceSessions : [],
    sliceWeekdays: Array.isArray(locked.sliceWeekdays) ? locked.sliceWeekdays : [],
    sliceTags: Array.isArray(locked.sliceTags) ? locked.sliceTags : [],
    filterType: String(locked.filterType || 'ALL').toUpperCase(),
    filterChannel: String(locked.filterChannel || 'ALL')
  };
}

function lockedFiltersToPassFilters(locked) {
  return {
    timeframes: locked.sliceTimeframes,
    symbols: locked.slicePairs,
    biasTerms: locked.sliceBiases,
    setupTerms: locked.sliceSetups,
    vwapBands: locked.sliceVwapBands,
    hvnBands: locked.sliceHvnBands,
    trendAligns: locked.sliceTrendAligns,
    killzones: locked.sliceKillzones,
    confluenceTiers: locked.sliceConfluenceTiers,
    top1Values: locked.sliceTop1Values,
    sessionNames: locked.sliceSessions,
    weekdayIndices: locked.sliceWeekdays,
    type: locked.filterType,
    channel: locked.filterChannel
  };
}

function tradeMatchesTags(trade, tags = []) {
  if (!Array.isArray(tags) || tags.length === 0) return true;
  const tradeTags = [
    ...(Array.isArray(trade?.journal?.tags) ? trade.journal.tags : []),
    ...(Array.isArray(trade?.presetTags) ? trade.presetTags : [])
  ].map((x) => String(x || '').toLowerCase());
  return tags.some((wanted) => tradeTags.includes(String(wanted).toLowerCase()));
}

function applyLockedFilters(trades = [], lockedFilters = {}) {
  const locked = normalizeLockedFilters(lockedFilters);
  const pass = lockedFiltersToPassFilters(locked);
  return trades.filter((t) => passesFilters(t, pass) && tradeMatchesTags(t, locked.sliceTags));
}

function getExcludedDimensions(lockedFilters = {}) {
  const locked = normalizeLockedFilters(lockedFilters);
  const excluded = new Set();
  if (locked.sliceTimeframes.length > 0) excluded.add('timeframe');
  if (locked.slicePairs.length > 0) excluded.add('symbol');
  if (locked.sliceBiases.length > 0) excluded.add('bias');
  if (locked.sliceSetups.length > 0) excluded.add('setup');
  if (locked.sliceVwapBands.length > 0) excluded.add('vwap');
  if (locked.sliceHvnBands.length > 0) excluded.add('hvn');
  if (locked.sliceTrendAligns.length > 0) excluded.add('trend');
  if (locked.sliceKillzones.length > 0) excluded.add('killzone');
  if (locked.sliceConfluenceTiers.length > 0) excluded.add('confluence');
  if (locked.sliceTop1Values.length > 0) excluded.add('top1');
  if (locked.sliceSessions.length > 0) excluded.add('session');
  if (locked.sliceWeekdays.length > 0) excluded.add('weekday');
  if (locked.sliceTags.length > 0) excluded.add('tags');
  if (locked.filterType !== 'ALL') excluded.add('side');
  if (locked.filterChannel !== 'ALL') excluded.add('channel');
  return excluded;
}

function buildLockedSummary(lockedFilters = {}) {
  const locked = normalizeLockedFilters(lockedFilters);
  const parts = [];
  if (locked.slicePairs.length) parts.push(`Pair: ${locked.slicePairs.join(', ')}`);
  if (locked.sliceWeekdays.length) {
    const days = locked.sliceWeekdays.map((d) => WD_SHORT[Number(d)] || d).join(', ');
    parts.push(`Weekday: ${days}`);
  }
  if (locked.sliceTimeframes.length) parts.push(`TF: ${locked.sliceTimeframes.join(', ')}`);
  if (locked.sliceSessions.length) parts.push(`Session: ${locked.sliceSessions.join(', ')}`);
  if (locked.sliceVwapBands.length) parts.push(`VWAP: ${locked.sliceVwapBands.join(', ')}`);
  if (locked.sliceHvnBands.length) parts.push(`HVN: ${locked.sliceHvnBands.join(', ')}`);
  if (locked.sliceTrendAligns.length) parts.push(`Trend: ${locked.sliceTrendAligns.join(', ')}`);
  if (locked.sliceKillzones.length) parts.push(`Killzone: ${locked.sliceKillzones.join(', ')}`);
  if (locked.sliceConfluenceTiers.length) parts.push(`Confluence: ${locked.sliceConfluenceTiers.join(', ')}`);
  if (locked.sliceTop1Values.length) parts.push(`Top-1: ${locked.sliceTop1Values.join(', ')}`);
  if (locked.sliceBiases.length) parts.push(`Bias: ${locked.sliceBiases.join(', ')}`);
  if (locked.sliceSetups.length) {
    const shown = locked.sliceSetups.slice(0, 3);
    parts.push(`Setup: ${shown.join('; ')}${locked.sliceSetups.length > 3 ? '…' : ''}`);
  }
  if (locked.sliceTags.length) parts.push(`Tags: ${locked.sliceTags.join(', ')}`);
  if (locked.filterType !== 'ALL') parts.push(`Type: ${locked.filterType}`);
  if (locked.filterChannel !== 'ALL') parts.push(`Channel: ${locked.filterChannel}`);
  return parts.join(' · ');
}

function dimensionToFilterPatch(dim, key) {
  if (isSkippableKey(key)) return null;
  const k = String(key).trim();
  switch (dim) {
    case 'timeframe':
      return { sliceTimeframes: [k.toUpperCase()] };
    case 'vwap':
      return { sliceVwapBands: [k] };
    case 'hvn':
      return { sliceHvnBands: [k] };
    case 'trend':
      return { sliceTrendAligns: [k] };
    case 'killzone':
      return { sliceKillzones: [k] };
    case 'confluence':
      return { sliceConfluenceTiers: [k] };
    case 'top1':
      return { sliceTop1Values: [k.toLowerCase()] };
    case 'session':
      return { sliceSessions: [sessionLabelToKey(k)] };
    case 'bias':
      return { sliceBiases: [k] };
    case 'setup':
      return { sliceSetups: [k] };
    case 'tags':
      return { sliceTags: [k] };
    case 'symbol':
      return { slicePairs: [k.toUpperCase()], filterSymbol: k.toUpperCase() };
    case 'channel':
      return { filterChannel: k };
    case 'side':
      return { filterType: k.toUpperCase() };
    case 'weekday': {
      const idx = WD_SHORT.indexOf(k);
      if (idx < 0) return null;
      return { sliceWeekdays: [idx] };
    }
    default:
      return null;
  }
}

function pairKeyToFilterPatch(key) {
  const patch = {};
  const parts = String(key || '').split(' + ').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('vwap:')) {
      patch.sliceVwapBands = [part.slice(5).trim()];
      continue;
    }
    if (part.startsWith('hvn:')) {
      patch.sliceHvnBands = [part.slice(4).trim()];
      continue;
    }
    if (part.startsWith('trend:')) {
      patch.sliceTrendAligns = [part.slice(6).trim()];
      continue;
    }
    if (part.startsWith('killzone:')) {
      patch.sliceKillzones = [part.slice(9).trim()];
      continue;
    }
    if (part.startsWith('confluence:')) {
      patch.sliceConfluenceTiers = [part.slice(11).trim()];
      continue;
    }
    if (part.startsWith('top1:')) {
      patch.sliceTop1Values = [part.slice(5).trim().toLowerCase()];
      continue;
    }
    if (part.startsWith('session:')) {
      patch.sliceSessions = [sessionLabelToKey(part.slice(8).trim())];
      continue;
    }
    if (part.startsWith('bias:')) {
      patch.sliceBiases = [part.slice(5).trim()];
      continue;
    }
    if (part.startsWith('setup:')) {
      patch.sliceSetups = [part.slice(6).trim()];
      continue;
    }
    if (part === 'BUY' || part === 'SELL') {
      patch.filterType = part;
      continue;
    }
    if (/^(M|H)\d{1,3}$|^D1$|^W1$|^MN1$/i.test(part)) {
      patch.sliceTimeframes = [part.toUpperCase()];
      continue;
    }
  }
  return Object.keys(patch).length ? patch : null;
}

function pairTouchesExcluded(sliceName, excluded) {
  const dims = PAIR_SLICE_DIMS[sliceName] || [];
  return dims.some((d) => excluded.has(d));
}

function collectCandidates(breakdown, minDecisive, excluded = new Set(), rankBy = 'balanced') {
  const out = [];
  const seen = new Set();

  function push(item) {
    const id = item.label;
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(item);
  }

  for (const [dim, bucket] of Object.entries(breakdown.singles || {})) {
    if (excluded.has(dim)) continue;
    for (const row of [...(bucket.best || []), ...(bucket.worst || [])]) {
      if (!row || row.decisive < minDecisive || row.winRate == null) continue;
      const filterPatch = dimensionToFilterPatch(dim, row.key);
      if (!filterPatch) continue;
      push({
        kind: 'single',
        dimension: dim,
        label: `${dim}: ${row.key}`,
        key: row.key,
        metrics: {
          trades: row.trades,
          closed: row.closed,
          decisive: row.decisive,
          wins: row.wins,
          losses: row.losses,
          winRate: row.winRate,
          pnl: row.pnl
        },
        filterPatch,
        score: rankScore(row, minDecisive, rankBy)
      });
    }
  }

  for (const row of breakdown.pairs?.best || []) {
    if (!row || row.decisive < minDecisive || row.winRate == null) continue;
    if (pairTouchesExcluded(row.slice, excluded)) continue;
    const filterPatch = pairKeyToFilterPatch(row.key);
    if (!filterPatch) continue;
    push({
      kind: 'pair',
      dimension: row.slice || 'pair',
      label: row.key,
      key: row.key,
      metrics: {
        trades: row.trades,
        closed: row.closed,
        decisive: row.decisive,
        wins: row.wins,
        losses: row.losses,
        winRate: row.winRate,
        pnl: row.pnl
      },
      filterPatch,
      score: rankScore(row, minDecisive, rankBy)
    });
  }

  return out;
}

/**
 * @param {object[]} trades
 * @param {object} options
 * @returns {{ ok: boolean, anchorSymbol?: string, poolSize: number, results: object[], breakdown?: object, error?: string }}
 */
function searchBestFilterCombinations(trades = [], options = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const breakEvenAmount = Math.max(0, Number(options.breakEvenAmount ?? 50) || 50);
  const minDecisive = Math.max(2, Number(options.minDecisive ?? 3) || 3);
  const maxResults = Math.min(30, Math.max(5, Number(options.maxResults ?? 12) || 12));
  const anchorSymbol = String(options.anchorSymbol || '').trim().toUpperCase();

  let lockedFilters = normalizeLockedFilters(options.lockedFilters || {});
  if (anchorSymbol && lockedFilters.slicePairs.length === 0) {
    lockedFilters = {
      ...lockedFilters,
      slicePairs: [anchorSymbol]
    };
  }

  let pool = applyLockedFilters(list, lockedFilters);
  if (pool.length === 0) {
    const lockedSummary = buildLockedSummary(lockedFilters);
    if (lockedSummary) {
      return { ok: false, error: 'NO_TRADES_FOR_LOCKS', lockedSummary, poolSize: 0, results: [] };
    }
    if (anchorSymbol) {
      return { ok: false, error: 'NO_TRADES_FOR_SYMBOL', anchorSymbol, poolSize: 0, results: [] };
    }
    return { ok: false, error: 'NO_TRADES', poolSize: 0, results: [] };
  }

  const excluded = getExcludedDimensions(lockedFilters);
  for (const dim of Array.isArray(options.disabledDimensions) ? options.disabledDimensions : []) {
    const d = String(dim || '').trim();
    if (d) excluded.add(d);
  }
  const rankBy = normalizeRankBy(options.rankBy);
  const lockedSummary = buildLockedSummary(lockedFilters);

  const breakdown = buildDashboardFilterStatsBreakdown(pool, breakEvenAmount);
  if (!breakdown.aggregate.decisive) {
    return {
      ok: false,
      error: 'NO_DECISIVE_OUTCOMES',
      poolSize: pool.length,
      results: [],
      breakdown,
      lockedFilters,
      lockedSummary: lockedSummary || null,
      excludedDimensions: [...excluded]
    };
  }

  const candidates = collectCandidates(breakdown, minDecisive, excluded, rankBy)
    .sort((a, b) => compareCandidates(a, b, rankBy))
    .slice(0, maxResults);

  return {
    ok: true,
    anchorSymbol: lockedFilters.slicePairs.length === 1 ? lockedFilters.slicePairs[0] : (anchorSymbol || null),
    poolSize: pool.length,
    aggregate: breakdown.aggregate,
    results: candidates,
    breakdown,
    lockedFilters,
    lockedSummary: lockedSummary || null,
    excludedDimensions: [...excluded],
    rankBy
  };
}

module.exports = {
  searchBestFilterCombinations,
  rankScore,
  normalizeRankBy,
  compareCandidates,
  dimensionToFilterPatch,
  pairKeyToFilterPatch,
  normalizeLockedFilters,
  applyLockedFilters,
  getExcludedDimensions,
  buildLockedSummary
};
