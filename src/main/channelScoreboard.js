/**
 * Per-channel performance KPIs derived from the existing trade store.
 *
 * Returns an array of channel rows ranked by expectancy with stats useful for
 * deciding which Telegram providers to keep, mute, or reverse.
 */

const { computeAnalytics } = require('./analyticsService');

function isClosed(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('TP_HIT') || s.includes('SL_HIT') || !!t?.closeTime;
}

function isBlocked(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('BLOCKED') || !!t?.blockedReason;
}

function toNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function expectancyOf(rows) {
  const closed = rows.filter(isClosed);
  if (closed.length === 0) return { expectancy: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: null };
  const wins = closed.filter((r) => toNumeric(r.profit) > 0);
  const losses = closed.filter((r) => toNumeric(r.profit) < 0);
  const winRate = (wins.length / closed.length) * 100;
  const avgWin = wins.length ? wins.reduce((a, b) => a + toNumeric(b.profit), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + toNumeric(b.profit), 0) / losses.length) : 0;
  const grossWin = wins.reduce((a, b) => a + toNumeric(b.profit), 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + toNumeric(b.profit), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;
  return { expectancy, winRate, avgWin, avgLoss, profitFactor };
}

function buildTrendWinRates(closedTrades = [], days = 30) {
  const buckets = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayTrades = closedTrades.filter((t) => {
      const at = t.closedAt || t.closeTime || t.openedAt;
      if (!at) return false;
      const d = new Date(at);
      return d >= dayStart && d < dayEnd;
    });
    if (dayTrades.length === 0) {
      buckets.push(null);
    } else {
      const wins = dayTrades.filter((t) => toNumeric(t.profit) > 0).length;
      buckets.push(Number(((wins / dayTrades.length) * 100).toFixed(1)));
    }
  }
  return buckets;
}

function computeChannelScoreboard(trades = [], options = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  const groups = new Map();

  for (const t of rows) {
    const channel = String(t?.channel || '').trim() || 'Unknown';
    if (!groups.has(channel)) groups.set(channel, []);
    groups.get(channel).push(t);
  }

  const minClosed = Math.max(0, Number(options.minClosedTrades) || 0);
  const out = [];
  for (const [channel, items] of groups) {
    const closed = items.filter(isClosed);
    if (closed.length < minClosed) continue;
    const blocked = items.filter(isBlocked).length;
    const totalPnl = closed.reduce((acc, x) => acc + toNumeric(x.profit), 0);
    const stats = expectancyOf(items);
    const trendWinRates = buildTrendWinRates(closed, 30);

    const dates = items.map((x) => x.openedAt).filter(Boolean);
    const firstSeen = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
    const lastSeen = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;

    const days = (firstSeen && lastSeen) ? Math.max(1, Math.round((new Date(lastSeen) - new Date(firstSeen)) / (1000 * 60 * 60 * 24))) : 1;
    const signalsPerDay = items.length / days;

    out.push({
      channel,
      tradeCount: items.length,
      closedCount: closed.length,
      blockedCount: blocked,
      totalPnl,
      winRate: Number(stats.winRate.toFixed(2)),
      avgWin: Number(stats.avgWin.toFixed(2)),
      avgLoss: Number(stats.avgLoss.toFixed(2)),
      expectancy: Number(stats.expectancy.toFixed(2)),
      profitFactor: stats.profitFactor == null ? null : Number(stats.profitFactor.toFixed(2)),
      firstSeen,
      lastSeen,
      signalsPerDay: Number(signalsPerDay.toFixed(2)),
      trendWinRates
    });
  }

  out.sort((a, b) => b.expectancy - a.expectancy);
  return out;
}

module.exports = {
  computeChannelScoreboard,
  // Re-export for callers that want full analytics for a filtered channel
  computeAnalytics
};
