/**
 * Excursion feature IPC (registered from main.js via the feature-ipc anchor):
 *   excursion:backfill — compute MFE/MAE from 1-min bars for closed trades missing excursion
 *   excursion:bestExit — Best Exit Analysis for one closed trade
 *   excursion:summary  — efficiency / money-left-on-table aggregates (+ per-channel)
 */

const { ipcMain } = require('electron');
const bridgeRouter = require('./bridgeRouter');
const { getMarketBars } = require('./marketHistoryService');
const {
  computeEfficiencyPct,
  computeEdgeRatio,
  computeExcursionFromBars,
  simulateBestExits
} = require('./excursionMetrics');

const BACKFILL_BATCH_LIMIT = 40;

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isClosedTradeStatus(status) {
  const s = String(status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT')
    || s.includes('STOP_LOSS') || s.includes('TAKE_PROFIT');
}

function hasExcursion(trade) {
  const e = trade?.excursion;
  return !!(e && (toNum(e.mfePips) != null || toNum(e.maePips) != null));
}

function tradeMatchesAccountKeys(trade, accountKeys) {
  if (!Array.isArray(accountKeys) || accountKeys.length === 0) return true;
  return accountKeys.includes(String(trade?.accountKey || 'unknown'));
}

function backfillEligible(trade) {
  if (!trade || hasExcursion(trade)) return false;
  if (!isClosedTradeStatus(trade.status)) return false;
  if (!(toNum(trade.entry) > 0)) return false;
  if (!String(trade.symbol || '').trim()) return false;
  const opened = new Date(trade.openedAt || '').getTime();
  const closed = new Date(trade.closedAt || '').getTime();
  return Number.isFinite(opened) && Number.isFinite(closed) && closed > opened;
}

async function fetchTradeBars(trade, ctx) {
  const openedMs = new Date(trade.openedAt).getTime();
  const closedMs = trade.closedAt ? new Date(trade.closedAt).getTime() : Date.now();
  const st = bridgeRouter.getStatus?.();
  return getMarketBars(
    {
      brokerSymbol: String(trade.symbol).trim(),
      resolutionMinutes: 1,
      fromIso: new Date(openedMs - 60_000).toISOString(),
      toIso: new Date(closedMs + 60_000).toISOString()
    },
    {
      settings: ctx.getSettings(),
      dataRoot: ctx.dataRoot,
      tcpConnected: !!st?.connected,
      requestMt5History: (p) => bridgeRouter.requestMt5History(p)
    }
  );
}

function register(ctx) {
  ipcMain.handle('excursion:backfill', ctx.ensureLicensed(async (_evt, opts = {}) => {
    const trades = ctx.getStoredTrades();
    const accountKeys = Array.isArray(opts?.accountKeys) ? opts.accountKeys : [];
    const eligible = trades.filter((t) => backfillEligible(t) && tradeMatchesAccountKeys(t, accountKeys));
    const batch = eligible.slice(0, BACKFILL_BATCH_LIMIT);

    let updated = 0;
    let failed = 0;
    const errors = [];
    for (const trade of batch) {
      try {
        const res = await fetchTradeBars(trade, ctx);
        const result = res?.success ? computeExcursionFromBars(trade, res.bars) : null;
        if (!result) {
          failed++;
          if (errors.length < 5) errors.push(`${trade.symbol}: ${res?.message || res?.code || 'no usable bars'}`);
          continue;
        }
        trade.excursion = {
          mfePips: result.mfePips,
          maePips: result.maePips,
          mfeMoney: result.mfeMoney,
          maeMoney: result.maeMoney,
          source: 'backfill',
          updatedAt: new Date().toISOString()
        };
        updated++;
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push(`${trade.symbol}: ${e?.message || 'fetch failed'}`);
      }
    }

    if (updated > 0) ctx.saveStoredTrades(trades);
    ctx.addLog('info', `Excursion backfill: ${updated} updated, ${failed} failed`, `${eligible.length - batch.length} remaining`);
    return {
      success: true,
      processed: batch.length,
      updated,
      failed,
      remaining: eligible.length - batch.length,
      errors
    };
  }));

  ipcMain.handle('excursion:bestExit', ctx.ensureLicensed(async (_evt, tradeId) => {
    const trades = ctx.getStoredTrades();
    const trade = trades.find((t) => String(t?.id) === String(tradeId));
    if (!trade) return { success: false, error: 'TRADE_NOT_FOUND' };
    if (!isClosedTradeStatus(trade.status)) return { success: false, error: 'TRADE_NOT_CLOSED' };

    const res = await fetchTradeBars(trade, ctx);
    if (!res?.success || !Array.isArray(res.bars) || res.bars.length === 0) {
      return { success: false, error: res?.message || res?.code || 'NO_BARS' };
    }
    const result = simulateBestExits(trade, res.bars);
    if (!result.ok) return { success: false, error: result.reason || 'SIMULATION_FAILED' };
    return { success: true, source: res.source, ...result };
  }));

  ipcMain.handle('excursion:summary', ctx.ensureLicensed(async (_evt, opts = {}) => {
    const trades = ctx.getStoredTrades();
    const accountKeys = Array.isArray(opts?.accountKeys) ? opts.accountKeys : [];
    const closed = trades.filter((t) => t && isClosedTradeStatus(t.status) && tradeMatchesAccountKeys(t, accountKeys));
    const withExcursion = closed.filter((t) => hasExcursion(t));

    let effSum = 0;
    let effCount = 0;
    let edgeSum = 0;
    let edgeCount = 0;
    let totalLeftOnTable = 0;
    const byChannel = {};

    for (const t of withExcursion) {
      const eff = computeEfficiencyPct(t);
      const edge = computeEdgeRatio(t);
      const profit = toNum(t.profit) ?? 0;
      const mfeMoney = toNum(t.excursion?.mfeMoney) ?? 0;
      const leftOnTable = profit > 0 ? Math.max(0, mfeMoney - profit) : 0;

      if (eff != null) { effSum += eff; effCount++; }
      if (edge != null) { edgeSum += edge; edgeCount++; }
      totalLeftOnTable += leftOnTable;

      const channel = String(t.channel || 'Unknown');
      if (!byChannel[channel]) {
        byChannel[channel] = { channel, count: 0, effSum: 0, effCount: 0, leftOnTable: 0 };
      }
      byChannel[channel].count++;
      if (eff != null) { byChannel[channel].effSum += eff; byChannel[channel].effCount++; }
      byChannel[channel].leftOnTable += leftOnTable;
    }

    const round2 = (n) => Math.round(n * 100) / 100;
    return {
      success: true,
      closedCount: closed.length,
      withExcursion: withExcursion.length,
      missingExcursion: closed.length - withExcursion.length,
      avgEfficiencyPct: effCount > 0 ? round2(effSum / effCount) : null,
      avgEdgeRatio: edgeCount > 0 ? round2(edgeSum / edgeCount) : null,
      totalLeftOnTable: round2(totalLeftOnTable),
      byChannel: Object.values(byChannel)
        .map((c) => ({
          channel: c.channel,
          count: c.count,
          avgEfficiencyPct: c.effCount > 0 ? round2(c.effSum / c.effCount) : null,
          leftOnTable: round2(c.leftOnTable)
        }))
        .sort((a, b) => b.leftOnTable - a.leftOnTable)
    };
  }));
}

module.exports = { register };
