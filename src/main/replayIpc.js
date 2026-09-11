/**
 * Replay feature IPC (registered from main.js via the feature-ipc anchor):
 *   replay:getTradeBundle — M1 bars + markers window for one trade
 *   replay:getDayBundle   — chronological events + running P&L for one UTC day
 *   replay:saveSnapshot   — persist a chart PNG and link it to journal.attachments
 */

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const bridgeRouter = require('./bridgeRouter');
const { getMarketBars } = require('./marketHistoryService');
const {
  buildTradeReplayBundle,
  buildDayReplayBundle,
  buildSnapshotPath
} = require('./replayService');

const DAY_SYMBOL_CAP = 6;
const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_ATTACHMENTS_PER_TRADE = 100;

function toMs(raw) {
  const t = new Date(raw || '').getTime();
  return Number.isFinite(t) ? t : null;
}

function marketCtx(ctx) {
  const st = bridgeRouter.getStatus?.();
  return {
    settings: ctx.getSettings(),
    dataRoot: ctx.dataRoot,
    tcpConnected: !!st?.connected,
    requestMt5History: (p) => bridgeRouter.requestMt5History(p)
  };
}

function replaySettings(ctx) {
  const r = ctx.getSettings()?.replay || {};
  const pre = Number(r.preEntryBars);
  const post = Number(r.postExitBars);
  return {
    preEntryBars: Number.isFinite(pre) && pre >= 0 ? Math.floor(pre) : 60,
    postExitBars: Number.isFinite(post) && post >= 0 ? Math.floor(post) : 20
  };
}

function register(ctx) {
  ipcMain.handle('replay:getTradeBundle', ctx.ensureLicensed(async (_evt, tradeId) => {
    const trades = ctx.getStoredTrades();
    const trade = trades.find((t) => String(t?.id) === String(tradeId));
    if (!trade) return { success: false, error: 'Trade not found.' };

    const symbol = String(trade.symbol || '').trim();
    if (!symbol) return { success: false, error: 'This trade has no symbol — bars cannot be loaded.' };

    const openedMs = toMs(trade.executedAt) ?? toMs(trade.openedAt);
    if (openedMs == null) return { success: false, error: 'This trade has no open time — nothing to replay.' };
    const closedMs = toMs(trade.closedAt) ?? Date.now();

    const { preEntryBars, postExitBars } = replaySettings(ctx);
    // Fetch a padded M1 window (a few extra bars each side so clamping is data-driven).
    const fromMs = openedMs - (preEntryBars + 5) * 60_000;
    const toIsoMs = Math.min(Date.now(), closedMs + (postExitBars + 5) * 60_000);

    let res;
    try {
      res = await getMarketBars(
        {
          brokerSymbol: symbol,
          resolutionMinutes: 1,
          fromIso: new Date(fromMs).toISOString(),
          toIso: new Date(toIsoMs).toISOString()
        },
        marketCtx(ctx)
      );
    } catch (e) {
      return { success: false, error: `Bar fetch failed: ${e?.message || String(e)}` };
    }

    if (!res?.success || !Array.isArray(res.bars) || res.bars.length === 0) {
      return {
        success: false,
        error: res?.message || res?.code
          || `No 1-minute bars available for ${symbol} in this window. Check API keys, symbol mapping, or connect MT5.`
      };
    }

    const bundle = buildTradeReplayBundle({ trade, bars: res.bars, preEntryBars, postExitBars });
    if (bundle.bars.length === 0) {
      return { success: false, error: `Bars were returned for ${symbol} but none fall inside the trade window.` };
    }
    return { success: true, source: res.source || '', tradeId: String(trade.id), bundle };
  }));

  ipcMain.handle('replay:getDayBundle', ctx.ensureLicensed(async (_evt, opts = {}) => {
    const dateKey = String(opts?.dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return { success: false, error: 'Invalid dateKey — expected YYYY-MM-DD.' };
    }
    const accountKey = String(opts?.accountKey || '').trim();

    const all = ctx.getStoredTrades();
    const scoped = accountKey
      ? all.filter((t) => String(t?.accountKey || 'unknown') === accountKey)
      : all;

    // Pre-build once without bars to learn which symbols the day involves.
    const preview = buildDayReplayBundle({ dateKey, trades: scoped });
    if (preview.trades.length === 0) {
      return { success: false, error: `No trades opened or closed on ${dateKey}${accountKey ? ` for account ${accountKey}` : ''}.` };
    }

    const symbols = preview.symbols.slice(0, DAY_SYMBOL_CAP);
    const skippedSymbols = preview.symbols.slice(DAY_SYMBOL_CAP);
    const barsBySymbol = {};
    const barWarnings = [];
    const mctx = marketCtx(ctx);
    for (const sym of symbols) {
      try {
        const res = await getMarketBars(
          {
            brokerSymbol: sym,
            resolutionMinutes: 1,
            fromIso: `${dateKey}T00:00:00.000Z`,
            toIso: `${dateKey}T23:59:59.999Z`
          },
          mctx
        );
        if (res?.success && Array.isArray(res.bars) && res.bars.length > 0) {
          barsBySymbol[sym] = res.bars;
        } else {
          barWarnings.push(`${sym}: ${res?.message || res?.code || 'no bars'}`);
        }
      } catch (e) {
        barWarnings.push(`${sym}: ${e?.message || 'fetch failed'}`);
      }
    }

    const bundle = buildDayReplayBundle({ dateKey, trades: scoped, barsBySymbol });
    return {
      success: true,
      bundle,
      barWarnings,
      skippedSymbols
    };
  }));

  ipcMain.handle('replay:saveSnapshot', ctx.ensureLicensed(async (_evt, opts = {}) => {
    const tradeId = String(opts?.tradeId || '').trim();
    if (!tradeId) return { success: false, error: 'Missing tradeId.' };

    const raw = String(opts?.base64Png || '').replace(/^data:image\/png;base64,/, '').trim();
    if (!raw) return { success: false, error: 'Missing snapshot image data.' };

    let buf;
    try {
      buf = Buffer.from(raw, 'base64');
    } catch {
      return { success: false, error: 'Snapshot data is not valid base64.' };
    }
    if (!buf || buf.length === 0) return { success: false, error: 'Snapshot decoded to zero bytes.' };
    if (buf.length > SNAPSHOT_MAX_BYTES) {
      return { success: false, error: `Snapshot is ${(buf.length / 1024 / 1024).toFixed(1)}MB — the limit is 8MB.` };
    }

    const trades = ctx.getStoredTrades();
    const trade = trades.find((t) => String(t?.id) === tradeId);
    if (!trade) return { success: false, error: 'Trade not found.' };

    const filePath = buildSnapshotPath(ctx.dataRoot, tradeId);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buf);
    } catch (e) {
      return { success: false, error: `Could not write snapshot: ${e?.message || String(e)}` };
    }

    const at = new Date().toISOString();
    const journal = trade.journal && typeof trade.journal === 'object' ? trade.journal : {};
    const existing = Array.isArray(journal.attachments) ? journal.attachments : [];
    trade.journal = {
      ...journal,
      attachments: [...existing, { path: filePath, at }].slice(-MAX_ATTACHMENTS_PER_TRADE)
    };
    trade.lastUpdateAt = at;
    ctx.saveStoredTrades(trades);

    const win = ctx.getMainWindow?.();
    if (win) win.webContents.send('trade:update', trade);
    ctx.addLog?.('info', 'Replay snapshot saved', `${trade.symbol || ''} → ${path.basename(filePath)}`);

    return { success: true, path: filePath, at, attachmentCount: trade.journal.attachments.length };
  }));
}

module.exports = { register };
