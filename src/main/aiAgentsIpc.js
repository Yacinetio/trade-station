/**
 * AI agents IPC + schedulers — registered from main.js via
 * `require('./aiAgentsIpc').register(featureIpcCtx)`.
 */

const { ipcMain } = require('electron');
const { createNotebookStore } = require('./notebookStore');
const { createStrategyStore } = require('./strategyStore');
const { getFundamentalsDashboard } = require('./fundamentalsService');
const { applyAutoTags, isClosed } = require('./aiAgents/deterministicTagger');
const { runPreMarketBriefing, localDateKey } = require('./aiAgents/briefingAgent');
const { runSessionReview } = require('./aiAgents/sessionReviewAgent');
const { suggestTagsForTrade } = require('./aiAgents/aiTagSuggester');

const MAX_TIMEOUT_MS = 2147483647;
const AUTO_TAG_SWEEP_MS = 10 * 60 * 1000;
const RECENT_CLOSE_MS = 20 * 60 * 1000;

let briefingTimer = null;
let reviewTimer = null;
let autoTagSweepTimer = null;
let schedulerStarted = false;

function parseLocalTime(raw, fallback = '07:30') {
  const s = String(raw || fallback).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { hh: 7, mm: 30 };
  return {
    hh: Math.min(23, Math.max(0, parseInt(m[1], 10) || 0)),
    mm: Math.min(59, Math.max(0, parseInt(m[2], 10) || 0))
  };
}

function msUntilNextLocalTime(hh, mm) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  let delta = target.getTime() - now.getTime();
  if (delta <= 1000) delta += 24 * 60 * 60 * 1000;
  return Math.max(1, delta);
}

function clearTimer(ref) {
  if (ref) {
    try { clearTimeout(ref); } catch (_) { /* noop */ }
  }
  return null;
}

function aiAgentsSettings(settings) {
  const d = settings?.aiAgents || {};
  return {
    briefingEnabled: d.briefingEnabled === true,
    briefingTime: String(d.briefingTime || '07:30'),
    sessionReviewEnabled: d.sessionReviewEnabled === true,
    reviewTime: String(d.reviewTime || '22:30'),
    autoTagEnabled: d.autoTagEnabled !== false,
    overtradingThreshold: Number.isFinite(Number(d.overtradingThreshold)) ? Number(d.overtradingThreshold) : 6
  };
}

function register(ctx = {}) {
  const notebookStore = createNotebookStore({ dataRoot: ctx.dataRoot });
  const strategyStore = createStrategyStore({ dataRoot: ctx.dataRoot });
  const guard = typeof ctx.ensureLicensed === 'function' ? ctx.ensureLicensed : (fn) => fn;

  function getSettings() {
    return typeof ctx.getSettings === 'function' ? ctx.getSettings() : {};
  }

  function broadcastTradeUpdate(trade) {
    try {
      ctx.getMainWindow()?.webContents.send('trade:update', trade);
    } catch (_) { /* noop */ }
  }

  function agentDeps() {
    return {
      store: ctx.store,
      getSettings,
      getStoredTrades: ctx.getStoredTrades,
      saveStoredTrades: ctx.saveStoredTrades,
      notebookStore,
      notify: ctx.notify,
      listStrategies: () => strategyStore.listStrategies({ includeArchived: false }),
      getFundamentals: (settings) => getFundamentalsDashboard(settings, {})
    };
  }

  function runAutoTagSweep() {
    try {
      const settings = getSettings();
      const cfg = aiAgentsSettings(settings);
      if (!cfg.autoTagEnabled) return;
      const trades = ctx.getStoredTrades();
      const cutoff = Date.now() - RECENT_CLOSE_MS;
      const needsTag = trades.some((t) => {
        if (!isClosed(t)) return false;
        if (t?.journal?.autoTaggedAt) return false;
        const raw = t?.closedAt || t?.closeTime;
        const ms = raw ? new Date(raw).getTime() : NaN;
        return Number.isFinite(ms) && ms >= cutoff;
      });
      if (!needsTag) return;
      const { updatedTrades, changes } = applyAutoTags(trades, settings);
      if (changes.length) ctx.saveStoredTrades(updatedTrades);
    } catch (e) {
      try { ctx.addLog('warn', 'AI auto-tag sweep failed', String(e?.message || e)); } catch (_) { /* noop */ }
    }
  }

  function scheduleBriefingLoop() {
    briefingTimer = clearTimer(briefingTimer);
    const settings = getSettings();
    const cfg = aiAgentsSettings(settings);
    if (!cfg.briefingEnabled) return;

    const { hh, mm } = parseLocalTime(cfg.briefingTime, '07:30');
    const delayMs = msUntilNextLocalTime(hh, mm);
    if (delayMs > MAX_TIMEOUT_MS) {
      briefingTimer = setTimeout(() => {
        briefingTimer = null;
        scheduleBriefingLoop();
      }, MAX_TIMEOUT_MS);
      return;
    }

    briefingTimer = setTimeout(() => {
      briefingTimer = null;
      void (async () => {
        try {
          const nowCfg = aiAgentsSettings(getSettings());
          if (nowCfg.briefingEnabled) {
            await runPreMarketBriefing(agentDeps());
          }
        } catch (e) {
          try { ctx.addLog('warn', 'Scheduled briefing failed', String(e?.message || e)); } catch (_) { /* noop */ }
        }
        scheduleBriefingLoop();
      })();
    }, delayMs);
  }

  function scheduleReviewLoop() {
    reviewTimer = clearTimer(reviewTimer);
    const settings = getSettings();
    const cfg = aiAgentsSettings(settings);
    if (!cfg.sessionReviewEnabled) return;

    const { hh, mm } = parseLocalTime(cfg.reviewTime, '22:30');
    const delayMs = msUntilNextLocalTime(hh, mm);
    if (delayMs > MAX_TIMEOUT_MS) {
      reviewTimer = setTimeout(() => {
        reviewTimer = null;
        scheduleReviewLoop();
      }, MAX_TIMEOUT_MS);
      return;
    }

    reviewTimer = setTimeout(() => {
      reviewTimer = null;
      void (async () => {
        try {
          const nowCfg = aiAgentsSettings(getSettings());
          if (nowCfg.sessionReviewEnabled) {
            await runSessionReview({ ...agentDeps(), dateKey: localDateKey() });
          }
        } catch (e) {
          try { ctx.addLog('warn', 'Scheduled session review failed', String(e?.message || e)); } catch (_) { /* noop */ }
        }
        scheduleReviewLoop();
      })();
    }, delayMs);
  }

  function startSchedulers() {
    if (schedulerStarted) {
      scheduleBriefingLoop();
      scheduleReviewLoop();
      return;
    }
    schedulerStarted = true;
    scheduleBriefingLoop();
    scheduleReviewLoop();
    autoTagSweepTimer = setInterval(runAutoTagSweep, AUTO_TAG_SWEEP_MS);
    setTimeout(runAutoTagSweep, 15_000);
  }

  ipcMain.handle('aiAgents:getStatus', guard(async () => {
    const settings = getSettings();
    const cfg = aiAgentsSettings(settings);
    return {
      ok: true,
      settings: cfg,
      lastBriefing: ctx.store?.get('aiAgents.lastBriefing', null),
      lastReview: ctx.store?.get('aiAgents.lastReview', null)
    };
  }));

  ipcMain.handle('aiAgents:runBriefingNow', guard(async () => {
    return runPreMarketBriefing(agentDeps());
  }));

  ipcMain.handle('aiAgents:runSessionReviewNow', guard(async (_e, opts = {}) => {
    const dateKey = String(opts?.dateKey || '').trim() || localDateKey();
    return runSessionReview({ ...agentDeps(), dateKey });
  }));

  ipcMain.handle('aiAgents:autoTagHistory', guard(async () => {
    const settings = getSettings();
    const trades = ctx.getStoredTrades();
    const closed = trades.filter(isClosed);
    const { updatedTrades, changes } = applyAutoTags(closed.length ? trades : [], settings);
    if (changes.length) ctx.saveStoredTrades(updatedTrades);
    return { ok: true, changedCount: changes.length, changes };
  }));

  ipcMain.handle('aiAgents:suggestTags', guard(async (_e, tradeId) => {
    const id = String(tradeId || '').trim();
    if (!id) return { ok: false, error: 'TRADE_ID_REQUIRED' };
    const trade = ctx.getStoredTrades().find((t) => String(t?.id) === id);
    if (!trade) return { ok: false, error: 'NOT_FOUND' };
    return suggestTagsForTrade(trade, { store: ctx.store, getSettings });
  }));

  ipcMain.handle('aiAgents:acceptSuggestedTags', guard(async (_e, payload = {}) => {
    const tradeId = String(payload?.tradeId || '').trim();
    const incoming = Array.isArray(payload?.tags) ? payload.tags : [];
    if (!tradeId) return { ok: false, error: 'TRADE_ID_REQUIRED' };

    const trades = ctx.getStoredTrades();
    const idx = trades.findIndex((t) => String(t?.id) === tradeId);
    if (idx < 0) return { ok: false, error: 'NOT_FOUND' };

    const existing = Array.isArray(trades[idx]?.journal?.tags) ? trades[idx].journal.tags : [];
    const set = new Set(existing.map((t) => String(t).trim()).filter(Boolean));
    for (const raw of incoming) {
      const t = String(raw || '').trim();
      if (t) set.add(t);
    }
    const updated = {
      ...trades[idx],
      journal: { ...(trades[idx].journal || {}), tags: [...set] }
    };
    const next = [...trades];
    next[idx] = updated;
    ctx.saveStoredTrades(next);
    broadcastTradeUpdate(updated);
    return { ok: true, trade: updated };
  }));

  startSchedulers();
}

module.exports = {
  register,
  parseLocalTime,
  msUntilNextLocalTime,
  MAX_TIMEOUT_MS
};
