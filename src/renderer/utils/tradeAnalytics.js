import {
  getTradeOutcome,
  isClosedTradeWinForStats,
  isClosedTradeLossForStats,
  toNumericProfit,
  tradeIsClosed
} from './tradeStatus.js';

/** Lightweight stats for the trades currently visible in scope (matches table rows). */
export function computeScopedTradeStats(trades = [], breakEvenAmount = 50) {
  const be = Math.max(0, Number(breakEvenAmount) || 50);
  const rows = Array.isArray(trades) ? trades : [];
  const closed = rows.filter((t) => tradeIsClosed(t));
  const tpHits = closed.filter((t) => getTradeOutcome(t, be) === 'TP').length;
  const slHits = closed.filter((t) => getTradeOutcome(t, be) === 'SL').length;
  const breakevens = closed.filter((t) => getTradeOutcome(t, be) === 'BE').length;
  const eodCloses = closed.filter((t) => getTradeOutcome(t, be) === 'EOD').length;
  const otherCloses = closed.filter((t) => getTradeOutcome(t, be) === 'CLOSED').length;
  const wins = closed.filter((t) => isClosedTradeWinForStats(t, be));
  const losses = closed.filter((t) => isClosedTradeLossForStats(t, be));
  const totalPnl = rows.reduce((sum, t) => sum + toNumericProfit(t.profit), 0);
  const grossWin = wins.reduce((sum, t) => sum + toNumericProfit(t.profit), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + toNumericProfit(t.profit), 0));
  const decisive = wins.length + losses.length;
  const tpSlDecisive = tpHits + slHits;
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const closedPnlSum = closed.reduce((sum, t) => sum + toNumericProfit(t.profit), 0);
  const expectancy = closed.length > 0 ? closedPnlSum / closed.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  const sortedClosed = [...closed].sort((a, b) => {
    const ta = new Date(a.openedAt || a.lastUpdateAt || 0).getTime();
    const tb = new Date(b.openedAt || b.lastUpdateAt || 0).getTime();
    return ta - tb;
  });
  for (const t of sortedClosed) {
    equity += toNumericProfit(t.profit);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const tpSlWinRate = tpSlDecisive > 0 ? (tpHits / tpSlDecisive) * 100 : null;
  const winRate = tpSlWinRate != null ? tpSlWinRate : (decisive > 0 ? (wins.length / decisive) * 100 : 0);
  return {
    wins: wins.length,
    losses: losses.length,
    tpHits,
    slHits,
    breakevens,
    eodCloses,
    otherCloses,
    closed: closed.length,
    closedCount: closed.length,
    totalPnl,
    avgWin,
    avgLoss,
    winRate,
    tpSlWinRate,
    rr: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0),
    advanced: {
      expectancy,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : null,
      maxDrawdown
    }
  };
}
