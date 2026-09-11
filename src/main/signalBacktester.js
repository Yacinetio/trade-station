/**
 * Lightweight backtester that replays prior signals from a single channel against the
 * current settings stack — re-runs lot sizing + execution guards and reports an
 * "if I had used my current settings" P&L curve.
 *
 * Note: this is a config-replay — it does NOT re-fetch historical OHLC bars for entry/SL/TP
 * fills. It uses each historical trade's recorded outcome (status + profit) and only
 * recomputes lot size + whether the guard pipeline would have blocked it.
 *
 * For full price-replay backtesting, see `marketHistoryService.getMarketBars` — that is a
 * larger lift planned in a follow-up release.
 */

const { applyLotSizingToSignal } = require('./lotSizing');
const { applyChannelOverrides } = require('./channelOverrides');
const { applyPerPairOverrides } = require('./perPairLot');
const { evaluateExecutionGuards } = require('./executionGuards');
const { priceDistancePips } = require('./signalExecutionApply');

function isClosed(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('TP_HIT') || s.includes('SL_HIT') || !!t?.closeTime;
}

function tradeAsSignal(t) {
  return {
    type: t.type,
    symbol: t.symbol,
    entry: Number(t.entry) || 0,
    sl: Number(t.sl) || 0,
    tp: t.tp ? [Number(t.tp)] : [],
    orderType: t.orderType || 'MARKET',
    timeframe: t.timeframe || ''
  };
}

function runChannelReplay(trades, opts = {}) {
  const channel = String(opts?.channel || '').trim();
  if (!channel) return { ok: false, error: 'CHANNEL_REQUIRED' };

  const settings = opts?.settings || {};
  const accountSnapshot = opts?.accountSnapshot || { balance: 10000, equity: 10000 };

  const rows = (trades || []).filter((t) => String(t?.channel || '') === channel);
  rows.sort((a, b) => String(a.openedAt || '').localeCompare(String(b.openedAt || '')));

  const replayed = [];
  let cumulative = 0;
  let wins = 0;
  let losses = 0;
  let blockedNow = 0;

  for (const t of rows) {
    const channelMerge = applyChannelOverrides(settings, channel);
    if (channelMerge.channelDisabled) continue;
    const effectiveSettings = applyPerPairOverrides(channelMerge.merged, t.symbol);
    const signal = tradeAsSignal(t);
    const sized = applyLotSizingToSignal(signal, effectiveSettings, accountSnapshot);

    const guard = evaluateExecutionGuards({
      settings: effectiveSettings,
      signal: sized,
      trades: [],
      accountSnapshot,
      accountKey: t.accountKey || 'unknown',
      helpers: { priceDistancePips }
    });

    if (!guard.allowed) {
      blockedNow += 1;
      replayed.push({
        id: t.id,
        openedAt: t.openedAt,
        symbol: t.symbol,
        type: t.type,
        wouldBlock: true,
        blockedReason: guard.reason || guard.code,
        originalProfit: Number(t.profit) || 0,
        replayedProfit: 0
      });
      continue;
    }

    if (!isClosed(t)) {
      replayed.push({
        id: t.id,
        openedAt: t.openedAt,
        symbol: t.symbol,
        type: t.type,
        wouldBlock: false,
        originalProfit: Number(t.profit) || 0,
        replayedProfit: 0,
        notClosed: true
      });
      continue;
    }

    // Scale historical profit by lot ratio (replay assumes same fill price + outcome).
    const oldLot = Number(t.lot) || 0;
    const newLot = Number(sized.lot) || 0;
    const ratio = oldLot > 0 ? newLot / oldLot : 0;
    const scaled = (Number(t.profit) || 0) * (ratio || 1);
    cumulative += scaled;
    if (scaled > 0) wins += 1;
    else if (scaled < 0) losses += 1;

    replayed.push({
      id: t.id,
      openedAt: t.openedAt,
      symbol: t.symbol,
      type: t.type,
      wouldBlock: false,
      originalProfit: Number(t.profit) || 0,
      replayedProfit: scaled,
      cumulativePnl: cumulative
    });
  }

  const closedCount = wins + losses;
  return {
    ok: true,
    channel,
    rows: replayed,
    totals: {
      tradeCount: rows.length,
      replayedCount: replayed.length,
      blockedCount: blockedNow,
      closedCount,
      wins,
      losses,
      winRate: closedCount ? Number(((wins / closedCount) * 100).toFixed(2)) : 0,
      totalPnl: Number(cumulative.toFixed(2))
    }
  };
}

module.exports = {
  runChannelReplay
};
