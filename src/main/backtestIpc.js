/**
 * Backtest feature IPC — registered from main.js via the feature-ipc anchor.
 */

const { ipcMain } = require('electron');
const bridgeRouter = require('./bridgeRouter');
const { getMarketBars } = require('./marketHistoryService');
const { createBacktestSessionStore } = require('./backtestSessionStore');
const { normalizeTradeForStorage, isClosedTradeWinForStats, isClosedTradeLossForStats } = require('./analyticsService');
const { estimatePipSize } = require('./signalExecutionApply');

const TF_MINUTES = { M1: 1, M5: 5, M15: 15, H1: 60 };

function marketCtx(ctx) {
  const st = bridgeRouter.getStatus?.();
  return {
    settings: ctx.getSettings(),
    dataRoot: ctx.dataRoot,
    tcpConnected: !!st?.connected,
    requestMt5History: (p) => bridgeRouter.requestMt5History(p)
  };
}

function resolutionMinutes(tf) {
  const key = String(tf || 'M1').toUpperCase();
  return TF_MINUTES[key] || 1;
}

function validateDateRange(from, to) {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { ok: false, error: 'Invalid date range.' };
  }
  if (toMs <= fromMs) {
    return { ok: false, error: 'End date must be after start date.' };
  }
  return { ok: true, fromMs, toMs };
}

function tradesForSession(allTrades, sessionId) {
  const key = `bt:${sessionId}`;
  return (allTrades || []).filter((t) => String(t?.accountKey || '') === key);
}

function computeSessionStats(trades, engineSnapshot) {
  const closed = (trades || []).filter((t) => String(t?.status || '').toUpperCase().includes('CLOSED')
    || String(t?.status || '').toUpperCase().includes('TP_HIT')
    || String(t?.status || '').toUpperCase().includes('SL_HIT'));
  const profits = closed.map((t) => Number(t.profit) || 0);
  const netPnl = profits.reduce((a, b) => a + b, 0);
  const wins = closed.filter((t) => isClosedTradeWinForStats(t, 50)).length;
  const losses = closed.filter((t) => isClosedTradeLossForStats(t, 50)).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : null;
  const grossWin = profits.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(profits.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : null);

  let equityCurve = Array.isArray(engineSnapshot?.equityCurve) ? engineSnapshot.equityCurve : [];
  if (equityCurve.length === 0 && closed.length > 0) {
    const start = Number(engineSnapshot?.startingBalance) || 100000;
    let eq = start;
    equityCurve = closed
      .slice()
      .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt))
      .map((t) => {
        eq += Number(t.profit) || 0;
        return { timeSec: Math.floor(new Date(t.closedAt).getTime() / 1000), equity: eq, balance: eq };
      });
  }

  return {
    netPnl: Math.round(netPnl * 100) / 100,
    winRate: winRate != null ? Math.round(winRate * 10) / 10 : null,
    profitFactor: profitFactor != null ? Math.round(profitFactor * 100) / 100 : null,
    closedCount: closed.length,
    wins,
    losses,
    equityCurve
  };
}

function normalizeBacktestTrade(closed, session, accountKey) {
  const id = String(closed.id || `bt_${Date.now()}`);
  return normalizeTradeForStorage({
    id,
    symbol: closed.symbol || session.symbol,
    type: closed.type,
    entry: closed.entry,
    sl: closed.sl,
    tp: closed.tp,
    lot: closed.lot,
    profit: closed.profit,
    status: closed.status,
    openedAt: closed.openedAt,
    closedAt: closed.closedAt,
    channel: 'Backtest',
    accountKey,
    strategyId: session.strategyId || undefined,
    riskUsd: closed.riskUsd,
    realizedR: closed.realizedR,
    journal: closed.journal || { notes: '', tags: [], mistakes: [], checklist: [], confidence: null },
    origin: 'BACKTEST',
    source: 'BACKTEST'
  });
}

function register(ctx) {
  const store = createBacktestSessionStore({ dataRoot: ctx.dataRoot || process.cwd() });

  ipcMain.handle('backtest:listSessions', ctx.ensureLicensed(async (_e, opts = {}) => {
    return { success: true, sessions: store.listSessions(opts) };
  }));

  ipcMain.handle('backtest:createSession', ctx.ensureLicensed(async (_e, input = {}) => {
    const symbol = String(input.symbol || '').trim();
    if (!symbol) return { success: false, error: 'Symbol is required.' };

    const dateFrom = String(input.dateFrom || '').slice(0, 10);
    const dateTo = String(input.dateTo || '').slice(0, 10);
    const range = validateDateRange(`${dateFrom}T00:00:00.000Z`, `${dateTo}T23:59:59.999Z`);
    if (!range.ok) return { success: false, error: range.error };

    const settings = ctx.getSettings();
    const btDefaults = settings.backtest || {};
    const startingBalance = Number(input.startingBalance) || Number(btDefaults.defaultBalance) || 100000;
    const spreadPips = Number(input.spreadPips ?? btDefaults.defaultSpreadPips ?? 1);
    const timeframe = String(input.timeframe || 'M1').toUpperCase();
    const resMin = resolutionMinutes(timeframe);

    let barsRes;
    try {
      barsRes = await getMarketBars(
        {
          brokerSymbol: symbol,
          resolutionMinutes: resMin,
          fromIso: `${dateFrom}T00:00:00.000Z`,
          toIso: `${dateFrom}T12:00:00.000Z`
        },
        marketCtx(ctx)
      );
    } catch (e) {
      return { success: false, error: `Bar prefetch failed: ${e?.message || String(e)}` };
    }

    if (!barsRes?.success || !Array.isArray(barsRes.bars) || barsRes.bars.length === 0) {
      return {
        success: false,
        error: barsRes?.message || barsRes?.code || 'No bars available for this symbol/range.'
      };
    }

    const pipSize = estimatePipSize(symbol);

    const session = store.saveSession({
      name: String(input.name || `${symbol} ${dateFrom}`).slice(0, 120),
      symbol,
      timeframe,
      dateFrom,
      dateTo,
      startingBalance,
      spreadPips,
      pipSize,
      strategyId: input.strategyId || null,
      cursorIso: `${dateFrom}T00:00:00.000Z`,
      engineSnapshot: null,
      notes: '',
      closedTradeIds: [],
      status: 'active'
    });

    ctx.addLog?.('info', `Backtest session created: ${session.name}`);

    return {
      success: true,
      session,
      bars: barsRes.bars,
      barSource: barsRes.source || 'unknown'
    };
  }));

  ipcMain.handle('backtest:deleteSession', ctx.ensureLicensed(async (_e, payload = {}) => {
    const sessionId = String(payload?.sessionId || payload || '');
    if (!sessionId) return { success: false, error: 'sessionId required' };

    const deleteTrades = payload?.deleteTrades !== false;
    const removed = store.deleteSession(sessionId);
    if (!removed) return { success: false, error: 'Session not found' };

    if (deleteTrades) {
      const key = store.accountKeyForSession(sessionId);
      const trades = ctx.getStoredTrades();
      const next = trades.filter((t) => String(t?.accountKey || '') !== key);
      if (next.length !== trades.length) ctx.saveStoredTrades(next);
    }

    return { success: true };
  }));

  ipcMain.handle('backtest:getBars', ctx.ensureLicensed(async (_e, query = {}) => {
    const session = store.getSession(query.sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const fromIso = query.fromIso || session.dateFrom;
    const toIso = query.toIso || session.dateTo;
    const resMin = resolutionMinutes(session.timeframe);

    try {
      const res = await getMarketBars(
        {
          brokerSymbol: session.symbol,
          resolutionMinutes: resMin,
          fromIso: fromIso.includes('T') ? fromIso : `${fromIso}T00:00:00.000Z`,
          toIso: toIso.includes('T') ? toIso : `${toIso}T23:59:59.999Z`
        },
        marketCtx(ctx)
      );
      if (!res?.success) {
        return { success: false, error: res?.message || res?.code || 'Failed to load bars' };
      }
      return { success: true, bars: res.bars, source: res.source };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }));

  ipcMain.handle('backtest:saveSnapshot', ctx.ensureLicensed(async (_e, payload = {}) => {
    const sessionId = String(payload?.sessionId || '');
    if (!sessionId) return { success: false, error: 'sessionId required' };
    const existing = store.getSession(sessionId);
    if (!existing) return { success: false, error: 'Session not found' };
    const updated = store.saveSession({
      ...existing,
      cursorIso: payload.cursorIso != null ? String(payload.cursorIso) : existing.cursorIso,
      engineSnapshot: payload.engineSnapshot != null ? payload.engineSnapshot : existing.engineSnapshot,
      notes: payload.notes != null ? String(payload.notes) : existing.notes,
      status: payload.status === 'archived' ? 'archived' : existing.status
    });
    if (!updated) return { success: false, error: 'Session not found' };
    return { success: true, session: updated };
  }));

  ipcMain.handle('backtest:recordClosedTrades', ctx.ensureLicensed(async (_e, payload = {}) => {
    const sessionId = String(payload?.sessionId || '');
    const closedTrades = Array.isArray(payload?.closedTrades) ? payload.closedTrades : [];
    if (!sessionId) return { success: false, error: 'sessionId required' };

    const session = store.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const accountKey = store.accountKeyForSession(sessionId);
    const all = ctx.getStoredTrades();
    const existingIds = new Set(all.map((t) => String(t.id)));
    const saved = [];

    for (const closed of closedTrades) {
      const norm = normalizeBacktestTrade(closed, session, accountKey);
      if (existingIds.has(String(norm.id))) continue;
      all.push(norm);
      existingIds.add(String(norm.id));
      saved.push(norm.id);
    }

    if (saved.length) {
      ctx.saveStoredTrades(all);
      store.appendClosedTradeIds(sessionId, saved);
    }

    return { success: true, ids: saved };
  }));

  ipcMain.handle('backtest:sessionStats', ctx.ensureLicensed(async (_e, sessionId) => {
    const session = store.getSession(sessionId);
    if (!session) return { success: false, error: 'Session not found' };
    const trades = tradesForSession(ctx.getStoredTrades(), session.id);
    const stats = computeSessionStats(trades, session.engineSnapshot);
    return { success: true, stats, session };
  }));
}

module.exports = { register, computeSessionStats };
