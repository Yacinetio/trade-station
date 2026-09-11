/**
 * Apply the same trade filter set used on Dashboard / Trades (localStorage
 * `ts-global-trade-filters-v1`) inside main-process analytics + reports.
 */

const {
  passesFilters,
  getTradeOutcomeForFilter,
  isClosedTrade
} = require('./analyticsService');
const {
  getScopeRange,
  getCustomScopeBounds,
  parseTradeDateLikeAnalytics
} = require('./timeScope');

function tradeIsBlocked(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('BLOCKED')) return true;
  if (s.startsWith('FAILED')) return true;
  return Boolean(trade?.blockedReason);
}

function tradeIsSimulated(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s === 'SIMULATED' || trade?.simulated === true;
}

function tradeIsLive(trade) {
  return !tradeIsBlocked(trade) && !isClosedTrade(trade);
}

function journalTags(trade) {
  const tags = [];
  if (Array.isArray(trade?.journal?.tags)) {
    for (const t of trade.journal.tags) {
      const s = String(t || '').trim().toLowerCase();
      if (s) tags.push(s);
    }
  }
  if (Array.isArray(trade?.presetTags)) {
    for (const t of trade.presetTags) {
      const s = String(t || '').trim().toLowerCase();
      if (s) tags.push(s);
    }
  }
  return tags;
}

function tradeMatchesTimeScope(trade, timeScope, now, customBounds) {
  const key = String(timeScope || 'ALL').toUpperCase();
  if (key === 'ALL') return true;
  const d = parseTradeDateLikeAnalytics(trade);
  if (!d) return false;
  if (key === 'CUSTOM') {
    if (!customBounds?.start || !customBounds?.end) return true;
    if (d < customBounds.start) return false;
    if (d > customBounds.end) return false;
    return true;
  }
  const { start, end } = getScopeRange(timeScope, now);
  if (!start && !end) return true;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

function mapTradeFiltersToAnalyticsShape(tradeFilters = {}, breakEvenAmount = 50) {
  const tf = tradeFilters && typeof tradeFilters === 'object' ? tradeFilters : {};
  return {
    accountKeys: [],
    symbol: String(tf.filterSymbol || ''),
    type: String(tf.filterType || 'ALL').toUpperCase(),
    channel: String(tf.filterChannel || 'ALL'),
    status: 'ALL',
    analyticsBreakEvenAmount: Math.max(0, Number(breakEvenAmount) || 50),
    timeframes: Array.isArray(tf.sliceTimeframes) ? tf.sliceTimeframes.map((x) => String(x).toUpperCase()) : [],
    symbols: Array.isArray(tf.slicePairs) ? tf.slicePairs.map((x) => String(x).toUpperCase()) : [],
    biasTerms: Array.isArray(tf.sliceBiases) ? tf.sliceBiases.map((x) => String(x)) : [],
    setupTerms: Array.isArray(tf.sliceSetups) ? tf.sliceSetups.map((x) => String(x)) : [],
    vwapBands: Array.isArray(tf.sliceVwapBands) ? tf.sliceVwapBands.map((x) => String(x)) : [],
    hvnBands: Array.isArray(tf.sliceHvnBands) ? tf.sliceHvnBands.map((x) => String(x)) : [],
    trendAligns: Array.isArray(tf.sliceTrendAligns) ? tf.sliceTrendAligns.map((x) => String(x)) : [],
    killzones: Array.isArray(tf.sliceKillzones) ? tf.sliceKillzones.map((x) => String(x)) : [],
    confluenceTiers: Array.isArray(tf.sliceConfluenceTiers) ? tf.sliceConfluenceTiers.map((x) => String(x)) : [],
    top1Values: Array.isArray(tf.sliceTop1Values) ? tf.sliceTop1Values.map((x) => String(x)) : [],
    sessionNames: Array.isArray(tf.sliceSessions) ? tf.sliceSessions.map((x) => String(x)) : [],
    weekdayIndices: Array.isArray(tf.sliceWeekdays)
      ? tf.sliceWeekdays.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      : []
  };
}

function matchesTabAndStatus(trade, tradeFilters = {}, breakEvenAmount = 50) {
  const tab = String(tradeFilters.signalsTab || 'ALL').toUpperCase();
  if (tab === 'LIVE' && !tradeIsLive(trade)) return false;
  if (tab === 'CLOSED' && !isClosedTrade(trade)) return false;
  if (tab === 'BLOCKED' && !tradeIsBlocked(trade)) return false;
  if (tab === 'SIMULATED' && !tradeIsSimulated(trade)) return false;

  const filterStatus = String(tradeFilters.filterStatus || 'ALL').toUpperCase();
  if (filterStatus === 'ALL') return true;

  const s = String(trade?.status || '').toUpperCase();
  const outcome = getTradeOutcomeForFilter(trade, breakEvenAmount);

  if (filterStatus === 'CLOSED' && !isClosedTrade(trade)) return false;
  if (filterStatus === 'PENDING' && s !== 'PENDING') return false;
  if (filterStatus === 'SENT' && s !== 'SENT') return false;
  if (filterStatus === 'BLOCKED' && !tradeIsBlocked(trade)) return false;
  if (filterStatus === 'TP' && outcome !== 'TP') return false;
  if (filterStatus === 'SL' && outcome !== 'SL') return false;
  if (filterStatus === 'BE' && outcome !== 'BE') return false;
  if (filterStatus === 'EOD' && outcome !== 'EOD') return false;
  return s === filterStatus;
}

function matchesSliceTags(trade, sliceTags = []) {
  if (!Array.isArray(sliceTags) || sliceTags.length === 0) return true;
  const tags = journalTags(trade);
  return sliceTags.some((wanted) => tags.includes(String(wanted).toLowerCase()));
}

/**
 * @param {object} filter
 *   tradeFilters — persisted global filter object
 *   accountKeys — selected account scope
 *   timeScope, scopeFrom, scopeTo — calendar scope (shared with Dashboard)
 *   breakEvenAmount — settings analyticsBreakEvenAmount
 *   Legacy reportEngine keys (channels, symbols, tags, direction, dateFromMs, dateToMs, winLoss)
 *   are merged on top when tradeFilters is absent or for compare presets.
 */
function applyGlobalTradeFilters(trades, filter = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const f = filter && typeof filter === 'object' ? filter : {};
  const tradeFilters = f.tradeFilters && typeof f.tradeFilters === 'object' ? f.tradeFilters : null;
  const breakEvenAmount = Math.max(0, Number(f.breakEvenAmount ?? 50) || 50);
  const now = new Date();

  let scopeBounds = { start: null, end: null };
  const timeScope = String(f.timeScope || 'ALL').toUpperCase();
  if (timeScope === 'CUSTOM') {
    scopeBounds = getCustomScopeBounds(f.scopeFrom, f.scopeTo) || { start: null, end: null };
  } else if (timeScope !== 'ALL') {
    scopeBounds = getScopeRange(timeScope, now);
  }

  const accountKeys = Array.isArray(f.accountKeys) ? f.accountKeys.map(String) : [];

  if (tradeFilters) {
    const analyticsShape = mapTradeFiltersToAnalyticsShape(tradeFilters, breakEvenAmount);
    if (accountKeys.length) analyticsShape.accountKeys = accountKeys;

    return list.filter((trade) => {
      if (!tradeMatchesTimeScope(trade, timeScope, now, scopeBounds)) return false;
      if (!matchesTabAndStatus(trade, tradeFilters, breakEvenAmount)) return false;
      if (!passesFilters(trade, analyticsShape)) return false;
      if (!matchesSliceTags(trade, tradeFilters.sliceTags)) return false;
      return true;
    });
  }

  return list;
}

module.exports = {
  applyGlobalTradeFilters,
  mapTradeFiltersToAnalyticsShape,
  tradeMatchesTimeScope
};
