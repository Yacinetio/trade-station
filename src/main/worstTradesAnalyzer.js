/**
 * Identify worst trades and underperforming filter buckets for the current scope.
 */

const {
  buildDashboardFilterStatsBreakdown,
  isClosedTradeLossForStats
} = require('./analyticsService');
const { dimensionToFilterPatch, pairKeyToFilterPatch } = require('./filterOptimizer');
const { getSession, getKillzone } = require('./sessionModel');

function parseTradeDate(trade) {
  const candidates = [trade?.openedAt, trade?.time, trade?.lastUpdateAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

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

function sessionFromTrade(trade) {
  const fromSignal = String(trade?.signalSession || '').trim();
  if (fromSignal === 'asian' || fromSignal === 'london' || fromSignal === 'newYork' || fromSignal === 'off') {
    return fromSignal;
  }
  const d = parseTradeDate(trade);
  if (!d) return '';
  const s = getSession(d);
  if (s === 'asia') return 'asian';
  return s || 'off';
}

function killzoneFromTrade(trade) {
  const d = parseTradeDate(trade);
  if (!d) return '';
  return getKillzone(d) || 'none';
}

function trendAlignFromTrade(trade) {
  const raw = String(trade?.trendAlign || '').trim().toLowerCase();
  return raw === 'n/a' ? 'na' : raw;
}

function confluenceTierFromTrade(trade) {
  if (trade?.confluence == null) return '';
  const c = Number(trade.confluence);
  if (!Number.isFinite(c) || c <= 0) return '0';
  if (c <= 2) return '1-2';
  return '3+';
}

function top1FromTrade(trade) {
  if (trade?.top1 === true) return 'yes';
  if (trade?.top1 === false) return 'no';
  return '';
}

function weekdayFromTrade(trade) {
  const d = parseTradeDate(trade);
  if (!d) return '';
  return WD_SHORT[d.getDay()] || '';
}

function vwapBand(trade) {
  const raw = String(trade?.vwapBand || '').trim().toLowerCase();
  return raw === 'n/a' ? 'na' : raw;
}

function hvnBand(trade) {
  const raw = String(trade?.hvnBand || '').trim().toLowerCase();
  return raw === 'n/a' ? 'na' : raw;
}

function tradeContextLabel(trade) {
  const parts = [
    String(trade?.symbol || '').toUpperCase().trim(),
    String(trade?.timeframe || '').toUpperCase().trim(),
    String(trade?.type || '').toUpperCase().trim()
  ].filter(Boolean);
  const sess = sessionFromTrade(trade);
  if (sess) parts.push(sess === 'newYork' ? 'NY' : sess);
  const wd = weekdayFromTrade(trade);
  if (wd) parts.push(wd);
  const vw = vwapBand(trade);
  if (vw === 'yes' || vw === 'no') parts.push(`vwap:${vw}`);
  const hv = hvnBand(trade);
  if (hv === 'yes' || hv === 'no') parts.push(`hvn:${hv}`);
  const bias = String(trade?.bias || '').trim();
  if (bias) parts.push(bias);
  return parts.join(' · ') || '—';
}

function tradeMatchesBucket(trade, dimension, key) {
  const k = String(key || '').trim();
  if (!k || k.startsWith('(')) return false;
  switch (dimension) {
    case 'timeframe':
      return String(trade?.timeframe || '').toUpperCase().trim() === k.toUpperCase();
    case 'symbol':
      return String(trade?.symbol || '').toUpperCase().trim() === k.toUpperCase();
    case 'vwap':
      return vwapBand(trade) === k;
    case 'hvn':
      return hvnBand(trade) === k;
    case 'trend':
      return trendAlignFromTrade(trade) === k;
    case 'killzone':
      return killzoneFromTrade(trade) === k;
    case 'confluence':
      return confluenceTierFromTrade(trade) === k;
    case 'top1':
      return top1FromTrade(trade) === k.toLowerCase();
    case 'session': {
      const sess = sessionFromTrade(trade);
      const map = { Asian: 'asian', London: 'london', NY: 'newYork', 'New York': 'newYork' };
      const want = map[k] || k.toLowerCase();
      return sess === want;
    }
    case 'bias':
      return String(trade?.bias || '').trim().toLowerCase() === k.toLowerCase();
    case 'weekday':
      return weekdayFromTrade(trade) === k;
    case 'side':
      return String(trade?.type || '').toUpperCase().trim() === k.toUpperCase();
    case 'channel':
      return String(trade?.channel || '').trim() === k;
    default:
      return false;
  }
}

function pairTouchesExcluded(sliceName, excluded) {
  const dims = PAIR_SLICE_DIMS[sliceName] || [];
  return dims.some((d) => excluded.has(d));
}

function collectWorstBuckets(breakdown, minDecisive, excluded = new Set(), maxBuckets = 12) {
  const out = [];

  for (const [dim, bucket] of Object.entries(breakdown.singles || {})) {
    if (excluded.has(dim)) continue;
    for (const row of bucket.worst || []) {
      if (!row || row.decisive < minDecisive || row.pnl >= 0 || row.winRate == null) continue;
      out.push({
        kind: 'single',
        dimension: dim,
        key: row.key,
        label: `${dim}: ${row.key}`,
        metrics: {
          trades: row.trades,
          decisive: row.decisive,
          winRate: row.winRate,
          pnl: row.pnl
        }
      });
    }
  }

  for (const row of breakdown.pairs?.worst || []) {
    if (!row || row.decisive < minDecisive || row.pnl >= 0 || row.winRate == null) continue;
    if (pairTouchesExcluded(row.slice, excluded)) continue;
    out.push({
      kind: 'pair',
      dimension: row.slice || 'pair',
      key: row.key,
      label: row.key,
      metrics: {
        trades: row.trades,
        decisive: row.decisive,
        winRate: row.winRate,
        pnl: row.pnl
      }
    });
  }

  return out
    .sort((a, b) => a.metrics.pnl - b.metrics.pnl || a.metrics.winRate - b.metrics.winRate)
    .slice(0, maxBuckets);
}

function reasonsForTrade(trade, worstBuckets) {
  const reasons = [];
  for (const bucket of worstBuckets) {
    if (bucket.kind === 'single' && tradeMatchesBucket(trade, bucket.dimension, bucket.key)) {
      reasons.push({
        type: 'bucket',
        label: bucket.label,
        winRate: bucket.metrics.winRate,
        pnl: bucket.metrics.pnl,
        decisive: bucket.metrics.decisive,
        text: `${bucket.label} underperforms in this scope (${bucket.metrics.winRate}% WR, ${bucket.metrics.pnl}$ across ${bucket.metrics.decisive} decisive)`
      });
    }
  }
  return reasons.slice(0, 4);
}

function detectPatterns(worstTrades, totalLosses) {
  if (!worstTrades.length) return [];

  const fields = [
    { id: 'timeframe', pick: (t) => String(t.timeframe || '').toUpperCase().trim() },
    { id: 'symbol', pick: (t) => String(t.symbol || '').toUpperCase().trim() },
    { id: 'session', pick: (t) => sessionFromTrade(t) },
    { id: 'weekday', pick: (t) => weekdayFromTrade(t) },
    { id: 'vwap', pick: (t) => vwapBand(t) },
    { id: 'hvn', pick: (t) => hvnBand(t) },
    { id: 'trend', pick: (t) => trendAlignFromTrade(t) },
    { id: 'killzone', pick: (t) => killzoneFromTrade(t) },
    { id: 'confluence', pick: (t) => confluenceTierFromTrade(t) },
    { id: 'top1', pick: (t) => top1FromTrade(t) },
    { id: 'type', pick: (t) => String(t.type || '').toUpperCase().trim() }
  ];

  const patterns = [];
  const n = worstTrades.length;

  for (const { id, pick } of fields) {
    const counts = new Map();
    for (const t of worstTrades) {
      const v = pick(t);
      if (!v || v === 'na') continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    for (const [value, count] of counts) {
      if (count < 2) continue;
      const share = count / n;
      if (share < 0.35 && count < 3) continue;
      const pct = Math.round(share * 100);
      patterns.push({
        dimension: id,
        value,
        count,
        sharePct: pct,
        text: `${pct}% of worst losses (${count}/${n}) share ${id} = ${value}`
      });
    }
  }

  return patterns
    .sort((a, b) => b.count - a.count || b.sharePct - a.sharePct)
    .slice(0, 6);
}

/**
 * @param {object[]} trades
 * @param {object} options
 */
function analyzeWorstTrades(trades = [], options = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const breakEvenAmount = Math.max(0, Number(options.breakEvenAmount ?? 50) || 50);
  const minDecisive = Math.max(2, Number(options.minDecisive ?? 3) || 3);
  const maxTrades = Math.min(20, Math.max(5, Number(options.maxTrades ?? 10) || 10));
  const excluded = new Set(Array.isArray(options.disabledDimensions) ? options.disabledDimensions : []);

  if (list.length === 0) {
    return { ok: false, error: 'NO_TRADES', results: [] };
  }

  const losses = list
    .filter((t) => isClosedTradeLossForStats(t, breakEvenAmount))
    .sort((a, b) => Number(a.profit || 0) - Number(b.profit || 0));

  const breakdown = buildDashboardFilterStatsBreakdown(list, breakEvenAmount);
  const worstBuckets = collectWorstBuckets(breakdown, minDecisive, excluded);

  const worstTradeRows = losses.slice(0, maxTrades).map((t) => ({
    id: t.id,
    symbol: t.symbol,
    timeframe: t.timeframe,
    type: t.type,
    channel: t.channel,
    bias: t.bias,
    profit: Number(Number(t.profit || 0).toFixed(2)),
    openedAt: t.openedAt || t.time || null,
    status: t.status,
    contextLabel: tradeContextLabel(t),
    reasons: reasonsForTrade(t, worstBuckets)
  }));

  const patterns = detectPatterns(losses.slice(0, maxTrades), losses.length);

  const avoid = worstBuckets.slice(0, 8).map((b) => {
    const filterPatch = b.kind === 'single'
      ? dimensionToFilterPatch(b.dimension, b.key)
      : pairKeyToFilterPatch(b.key);
    return {
      label: b.label,
      winRate: b.metrics.winRate,
      pnl: b.metrics.pnl,
      decisive: b.metrics.decisive,
      trades: b.metrics.trades,
      filterPatch: filterPatch || null,
      text: `Avoid ${b.label} — ${b.metrics.winRate}% WR, ${b.metrics.pnl}$ (${b.metrics.decisive} decisive)`
    };
  });

  if (worstTradeRows.length === 0 && worstBuckets.length === 0) {
    return {
      ok: false,
      error: 'NO_LOSSES',
      poolSize: list.length,
      aggregate: breakdown.aggregate
    };
  }

  return {
    ok: true,
    poolSize: list.length,
    lossCount: losses.length,
    aggregate: breakdown.aggregate,
    worstTrades: worstTradeRows,
    worstBuckets,
    patterns,
    avoid,
    excludedDimensions: [...excluded]
  };
}

module.exports = {
  analyzeWorstTrades,
  tradeContextLabel,
  collectWorstBuckets
};
