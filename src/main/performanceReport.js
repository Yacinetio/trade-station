const {
  isClosedTrade,
  getTradeOutcomeForFilter,
  isClosedTradeWinForStats,
  isClosedTradeLossForStats,
  computeMaxDrawdown,
} = require('./analyticsService');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tradeCloseMs(trade) {
  const candidates = [trade?.closedAt, trade?.closeTime, trade?.lastUpdateAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

function tradesClosedBetween(allTrades, startInclusiveMs, endInclusiveMs) {
  return (Array.isArray(allTrades) ? allTrades : []).filter((t) => {
    if (!isClosedTrade(t)) return false;
    const closeMs = tradeCloseMs(t);
    if (!Number.isFinite(closeMs)) return false;
    return closeMs >= startInclusiveMs && closeMs <= endInclusiveMs;
  });
}

function countLiveTrades(allTrades) {
  return (Array.isArray(allTrades) ? allTrades : []).filter((t) => {
    const s = String(t?.status || '').toUpperCase();
    if (s === 'PENDING') return false;
    return !isClosedTrade(t);
  }).length;
}

function formatPnl(n) {
  const v = toNumber(n);
  return v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`;
}

/** Drawdown is always a drop from peak — never show a leading "+". */
function formatDrawdown(n) {
  const v = Math.abs(toNumber(n));
  return v === 0 ? '$0.00' : `-$${v.toFixed(2)}`;
}

function summarizeOutcomeBucket(trades, breakEvenAmount) {
  const beAmt = Math.max(0, Number(breakEvenAmount) || 0);
  const pnl = trades.reduce((sum, t) => sum + toNumber(t?.profit), 0);
  const wins = trades.filter((t) => isClosedTradeWinForStats(t, beAmt)).length;
  const losses = trades.filter((t) => isClosedTradeLossForStats(t, beAmt)).length;
  return {
    count: trades.length,
    pnl: Number(pnl.toFixed(2)),
    wins,
    losses,
  };
}

function buildPerformanceReportLines(periodClosedTrades, allTrades, reportSettings, headerLines, options = {}) {
  const breakEvenAmount = Math.max(0, Number(options.breakEvenAmount ?? 50) || 50);
  const closedTrades = (Array.isArray(periodClosedTrades) ? periodClosedTrades : []).filter(isClosedTrade);
  const beAmt = breakEvenAmount;

  const tpTrades = [];
  const slTrades = [];
  const beTrades = [];
  const otherTrades = [];

  for (const t of closedTrades) {
    const outcome = getTradeOutcomeForFilter(t, beAmt);
    if (outcome === 'TP') tpTrades.push(t);
    else if (outcome === 'SL') slTrades.push(t);
    else if (outcome === 'BE') beTrades.push(t);
    else otherTrades.push(t);
  }

  const totalPnl = closedTrades.reduce((sum, t) => sum + toNumber(t.profit), 0);
  const wins = closedTrades.filter((t) => isClosedTradeWinForStats(t, beAmt)).length;
  const losses = closedTrades.filter((t) => isClosedTradeLossForStats(t, beAmt)).length;
  const decisive = wins + losses;
  const winRate = decisive > 0 ? Math.round((wins / decisive) * 100) : 0;

  const tpBucket = summarizeOutcomeBucket(tpTrades, beAmt);
  const slBucket = summarizeOutcomeBucket(slTrades, beAmt);
  const beBucket = summarizeOutcomeBucket(beTrades, beAmt);
  const otherBucket = summarizeOutcomeBucket(otherTrades, beAmt);

  const eodTrades = otherTrades.filter((t) => getTradeOutcomeForFilter(t, beAmt) === 'EOD');
  const manualOtherTrades = otherTrades.filter((t) => getTradeOutcomeForFilter(t, beAmt) !== 'EOD');

  const pairStats = {};
  for (const t of closedTrades) {
    const sym = t.symbol || 'unknown';
    if (!pairStats[sym]) pairStats[sym] = { pnl: 0, wins: 0, losses: 0 };
    pairStats[sym].pnl += toNumber(t.profit);
    if (isClosedTradeWinForStats(t, beAmt)) pairStats[sym].wins++;
    else if (isClosedTradeLossForStats(t, beAmt)) pairStats[sym].losses++;
  }
  const sortedPairs = Object.entries(pairStats).sort((a, b) => b[1].pnl - a[1].pnl);
  const topGainers = sortedPairs.slice(0, 3).filter(([, d]) => d.pnl > 0);
  const topLosers = sortedPairs.slice(-3).reverse().filter(([, d]) => d.pnl < 0);

  const lines = [...headerLines, ''];
  if (reportSettings.includePnl) {
    lines.push(`*Total P&L:* ${formatPnl(totalPnl)}`);
  }
  if (reportSettings.includeWinRate) {
    lines.push(`*Win Rate (TP/SL):* ${winRate}% (${wins} TP / ${losses} SL)`);
  }
  if (reportSettings.includeOutcomes !== false) {
    lines.push('', '*Outcomes (closed in period):*');
    lines.push(`  TP: ${tpBucket.count} (${formatPnl(tpBucket.pnl)})`);
    lines.push(`  SL: ${slBucket.count} (${formatPnl(slBucket.pnl)})`);
    lines.push(`  BE: ${beBucket.count} (${formatPnl(beBucket.pnl)})`);
    lines.push(`  Other: ${otherBucket.count} (${formatPnl(otherBucket.pnl)})`);
    if (eodTrades.length > 0) {
      const eodPnl = eodTrades.reduce((s, t) => s + toNumber(t.profit), 0);
      lines.push(`    EOD close: ${eodTrades.length} (${formatPnl(eodPnl)})`);
    }
    if (manualOtherTrades.length > 0) {
      const manualPnl = manualOtherTrades.reduce((s, t) => s + toNumber(t.profit), 0);
      lines.push(`    Manual / other: ${manualOtherTrades.length} (${formatPnl(manualPnl)})`);
    }
  }
  if (reportSettings.includeDrawdown) {
    const sortedByClose = [...closedTrades].sort((a, b) => tradeCloseMs(a) - tradeCloseMs(b));
    const prepared = sortedByClose.map((t) => ({ _profit: toNumber(t.profit) }));
    const maxDd = computeMaxDrawdown(prepared);
    lines.push(`*Max Drawdown:* ${formatDrawdown(maxDd)}`);
  }
  if (reportSettings.includeOpenCount) {
    lines.push(`*Open Positions:* ${countLiveTrades(allTrades)}`);
  }
  if (reportSettings.includeTrades) {
    lines.push(`*Closed trades:* ${closedTrades.length}`);
  }
  if (reportSettings.includeTopPerformers && topGainers.length > 0) {
    lines.push('', '*Top Gainers:*');
    for (const [sym, d] of topGainers) {
      lines.push(`  ${sym}: ${formatPnl(d.pnl)} (${d.wins}W/${d.losses}L)`);
    }
  }
  if (reportSettings.includeTopPerformers && topLosers.length > 0) {
    lines.push('', '*Top Losers:*');
    for (const [sym, d] of topLosers) {
      lines.push(`  ${sym}: ${formatPnl(d.pnl)} (${d.wins}W/${d.losses}L)`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  tradeCloseMs,
  tradesClosedBetween,
  countLiveTrades,
  formatPnl,
  formatDrawdown,
  buildPerformanceReportLines,
};
