/**
 * Strategy (playbook) IPC layer — registered from main.js via
 * `require('./strategyIpc').register(featureIpcCtx)`.
 *
 * Owns every `strategies:*` channel: CRUD, templates, trade attachment +
 * rule-compliance checks, analytics, JSON import/export, and the missed-trades
 * log with bar-replay simulation.
 */

const { ipcMain } = require('electron');
const {
  createStrategyStore,
  walkBarsForOutcome,
  suggestStrategyForTrade,
  applyStrategyToTrade,
  applyRuleChecksToTrade
} = require('./strategyStore');
const { listTemplates, instantiateTemplate } = require('./strategyTemplates');
const { computeStrategyAnalytics, mistakeEconomics } = require('./strategyAnalytics');
const { getMarketBars } = require('./marketHistoryService');

const EXPORT_FORMAT = 'trade-station.strategy';
const SIMULATION_MAX_DAYS = 5;

function register(ctx) {
  const store = createStrategyStore({ dataRoot: ctx.dataRoot || process.cwd() });

  function broadcastChanged() {
    try {
      ctx.getMainWindow()?.webContents.send('strategies:changed');
    } catch (_) {
      /* window may be closed */
    }
  }

  function broadcastTradeUpdate(trade) {
    try {
      ctx.getMainWindow()?.webContents.send('trade:update', trade);
    } catch (_) {
      /* window may be closed */
    }
  }

  // ── Strategy CRUD ──

  ipcMain.handle('strategies:list', ctx.ensureLicensed(async (_e, opts = {}) => {
    return {
      success: true,
      strategies: store.listStrategies({ includeArchived: opts?.includeArchived !== false })
    };
  }));

  ipcMain.handle('strategies:save', ctx.ensureLicensed(async (_e, input = {}) => {
    if (!String(input?.name || '').trim() && !input?.id) {
      return { success: false, error: 'A strategy needs a name.' };
    }
    const strategy = store.saveStrategy(input);
    broadcastChanged();
    return { success: true, strategy };
  }));

  ipcMain.handle('strategies:delete', ctx.ensureLicensed(async (_e, strategyId) => {
    const removed = store.deleteStrategy(strategyId);
    if (removed) {
      // Detach the strategy from trades so stale ids never linger.
      const trades = ctx.getStoredTrades();
      let touched = false;
      const next = trades.map((t) => {
        if (String(t?.strategyId || '') !== String(strategyId)) return t;
        touched = true;
        return applyStrategyToTrade(t, null);
      });
      if (touched) ctx.saveStoredTrades(next);
      broadcastChanged();
    }
    return { success: removed, error: removed ? undefined : 'Strategy not found' };
  }));

  // ── Templates ──

  ipcMain.handle('strategies:listTemplates', ctx.ensureLicensed(async () => {
    return { success: true, templates: listTemplates() };
  }));

  ipcMain.handle('strategies:createFromTemplate', ctx.ensureLicensed(async (_e, templateId) => {
    const input = instantiateTemplate(templateId);
    if (!input) return { success: false, error: 'Template not found' };
    const strategy = store.saveStrategy(input);
    ctx.addLog('info', `Strategy created from template: ${strategy.name}`);
    broadcastChanged();
    return { success: true, strategy };
  }));

  // ── Trade attachment + rule compliance ──

  ipcMain.handle('strategies:attachTrade', ctx.ensureLicensed(async (_e, payload = {}) => {
    const tradeId = String(payload?.tradeId || '');
    if (!tradeId) return { success: false, error: 'tradeId is required' };

    const trades = ctx.getStoredTrades();
    const idx = trades.findIndex((t) => String(t?.id) === tradeId);
    if (idx < 0) return { success: false, error: 'Trade not found' };

    let strategyId = payload?.strategyId === undefined || payload?.strategyId === 'auto'
      ? null
      : payload.strategyId;

    if (payload?.strategyId === undefined || payload?.strategyId === 'auto') {
      strategyId = suggestStrategyForTrade(trades[idx], store.listStrategies({ includeArchived: false }));
      if (!strategyId) {
        return { success: false, error: 'No strategy matched this trade (link channels or tags on a strategy first).' };
      }
    } else if (strategyId && !store.getStrategy(strategyId)) {
      return { success: false, error: 'Strategy not found' };
    }

    const updated = applyStrategyToTrade(trades[idx], strategyId);
    const next = [...trades];
    next[idx] = updated;
    ctx.saveStoredTrades(next);
    broadcastChanged();
    broadcastTradeUpdate(updated);
    return { success: true, trade: updated, strategyId: updated.strategyId };
  }));

  ipcMain.handle('strategies:setRuleChecks', ctx.ensureLicensed(async (_e, payload = {}) => {
    const tradeId = String(payload?.tradeId || '');
    if (!tradeId) return { success: false, error: 'tradeId is required' };

    const trades = ctx.getStoredTrades();
    const idx = trades.findIndex((t) => String(t?.id) === tradeId);
    if (idx < 0) return { success: false, error: 'Trade not found' };

    const strategy = trades[idx]?.strategyId ? store.getStrategy(trades[idx].strategyId) : null;
    const updated = applyRuleChecksToTrade(trades[idx], payload?.ruleChecks || {}, strategy);
    const next = [...trades];
    next[idx] = updated;
    ctx.saveStoredTrades(next);
    broadcastChanged();
    broadcastTradeUpdate(updated);
    return { success: true, trade: updated };
  }));

  // ── Analytics ──

  ipcMain.handle('strategies:analytics', ctx.ensureLicensed(async () => {
    const trades = ctx.getStoredTrades();
    const strategies = store.listStrategies({ includeArchived: true });
    const missed = store.listMissed();
    const settings = ctx.getSettings() || {};
    return {
      success: true,
      rows: computeStrategyAnalytics(trades, strategies, missed),
      mistakes: mistakeEconomics(trades, settings.tagCategories || {}),
      missedTotalR: missed
        .filter((m) => m?.simulated)
        .reduce((a, m) => a + (Number(m.simulated.pnlR) || 0), 0)
    };
  }));

  // ── Import / export ──

  ipcMain.handle('strategies:exportOne', ctx.ensureLicensed(async (_e, strategyId) => {
    const strategy = store.getStrategy(strategyId);
    if (!strategy) return { success: false, error: 'Strategy not found' };
    const json = JSON.stringify({ format: EXPORT_FORMAT, version: 1, strategy }, null, 2);
    return { success: true, json };
  }));

  ipcMain.handle('strategies:importOne', ctx.ensureLicensed(async (_e, json) => {
    let parsed;
    try {
      parsed = JSON.parse(String(json || ''));
    } catch {
      return { success: false, error: 'Not valid JSON.' };
    }
    // Accept both the wrapped export format and a bare strategy object.
    const candidate = parsed?.format === EXPORT_FORMAT ? parsed.strategy : parsed;
    if (!candidate || typeof candidate !== 'object' || !String(candidate.name || '').trim()) {
      return { success: false, error: 'JSON does not contain a strategy (missing name).' };
    }
    // Fresh id so an import never overwrites an existing playbook.
    const strategy = store.saveStrategy({ ...candidate, id: undefined });
    ctx.addLog('info', `Strategy imported: ${strategy.name}`);
    broadcastChanged();
    return { success: true, strategy };
  }));

  // ── Missed trades ──

  ipcMain.handle('strategies:listMissed', ctx.ensureLicensed(async () => {
    return { success: true, missed: store.listMissed() };
  }));

  ipcMain.handle('strategies:addMissed', ctx.ensureLicensed(async (_e, payload = {}) => {
    if (!String(payload?.symbol || '').trim()) {
      return { success: false, error: 'Symbol is required.' };
    }
    const missed = store.addMissed(payload);
    broadcastChanged();
    return { success: true, missed };
  }));

  ipcMain.handle('strategies:deleteMissed', ctx.ensureLicensed(async (_e, missedId) => {
    const removed = store.deleteMissed(missedId);
    if (removed) broadcastChanged();
    return { success: removed, error: removed ? undefined : 'Missed trade not found' };
  }));

  ipcMain.handle('strategies:simulateMissed', ctx.ensureLicensed(async (_e, missedId) => {
    const missed = store.getMissed(missedId);
    if (!missed) return { success: false, error: 'Missed trade not found' };
    if (![missed.plannedEntry, missed.plannedSl, missed.plannedTp].every((v) => Number.isFinite(Number(v)))) {
      return { success: false, error: 'Planned entry, SL, and TP are all required to simulate.' };
    }

    const fromMs = new Date(missed.at || Date.now()).getTime();
    if (!Number.isFinite(fromMs)) return { success: false, error: 'Invalid planned time.' };
    const toMs = Math.min(fromMs + SIMULATION_MAX_DAYS * 24 * 60 * 60 * 1000, Date.now());
    if (toMs - fromMs < 60 * 1000) {
      return { success: false, error: 'Planned time is too recent — bars are not available yet.' };
    }

    const barsRes = await getMarketBars(
      {
        brokerSymbol: missed.symbol,
        resolutionMinutes: 1,
        fromIso: new Date(fromMs).toISOString(),
        toIso: new Date(toMs).toISOString()
      },
      { settings: ctx.getSettings() || {}, dataRoot: ctx.dataRoot }
    );
    if (!barsRes?.success || !Array.isArray(barsRes.bars) || barsRes.bars.length === 0) {
      const detail = barsRes?.message || barsRes?.code || 'No bars returned';
      ctx.addLog('warn', `Missed-trade simulation failed for ${missed.symbol}`, String(detail));
      return { success: false, error: `Could not fetch 1-min bars for ${missed.symbol}: ${detail}` };
    }

    const result = walkBarsForOutcome({
      direction: missed.direction,
      entry: missed.plannedEntry,
      sl: missed.plannedSl,
      tp: missed.plannedTp,
      bars: barsRes.bars
    });

    const simulated = {
      outcome: result.outcome,
      pnlR: result.pnlR,
      entryFilled: !!result.entryFilled,
      barCount: barsRes.bars.length,
      source: barsRes.source || '',
      simulatedAt: new Date().toISOString()
    };
    const updated = store.updateMissed(missed.id, { simulated });
    ctx.addLog('info', `Missed trade simulated: ${missed.symbol} ${missed.direction} → ${simulated.outcome} (${simulated.pnlR}R)`);
    broadcastChanged();
    return { success: true, missed: updated, simulated };
  }));
}

module.exports = { register };
