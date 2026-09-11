/**
 * Notebook feature IPC — registered from main.js via
 * `require('./notebookIpc').register(featureIpcCtx)`.
 */

const { ipcMain } = require('electron');
const { createNotebookStore } = require('./notebookStore');
const { listTemplates, instantiateTemplate } = require('./notebookTemplates');

function tradeIsClosed(trade = {}) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime;
}

function tradeCloseMs(trade = {}) {
  const raw = trade?.closeTime || trade?.closedAt || trade?.updatedAt || null;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function money(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** Markdown stats block for trades closed today (local time). */
function buildTodayStatsBlock(trades = [], now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const closedToday = (Array.isArray(trades) ? trades : []).filter((t) => {
    if (!tradeIsClosed(t)) return false;
    const ms = tradeCloseMs(t);
    return ms !== null && ms >= dayStart && ms < dayEnd;
  });

  const pad2 = (x) => String(x).padStart(2, '0');
  const dateKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  if (closedToday.length === 0) {
    return { dateKey, count: 0, markdown: `**Stats — ${dateKey}**\n\nNo trades closed today.` };
  }

  const pnls = closedToday.map((t) => Number(t.profit) || 0);
  const net = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter((p) => p > 0).length;
  const winRate = Math.round((wins / closedToday.length) * 100);
  const bestIdx = pnls.indexOf(Math.max(...pnls));
  const worstIdx = pnls.indexOf(Math.min(...pnls));
  const label = (t) => `${String(t?.symbol || '?').toUpperCase()} ${String(t?.type || '').toUpperCase()}`.trim();

  const markdown = [
    `**Stats — ${dateKey}**`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Trades closed | ${closedToday.length} |`,
    `| Net P&L | ${money(net)} |`,
    `| Win rate | ${winRate}% (${wins}W / ${closedToday.length - wins}L) |`,
    `| Best trade | ${label(closedToday[bestIdx])} ${money(pnls[bestIdx])} |`,
    `| Worst trade | ${label(closedToday[worstIdx])} ${money(pnls[worstIdx])} |`
  ].join('\n');

  return { dateKey, count: closedToday.length, markdown };
}

function register(ctx = {}) {
  const notebookStore = createNotebookStore({ dataRoot: ctx.dataRoot });
  const guard = typeof ctx.ensureLicensed === 'function' ? ctx.ensureLicensed : (fn) => fn;

  ipcMain.handle('notebook:list', guard(async (_e, opts = {}) => {
    return {
      notes: notebookStore.listNotes(opts?.folder ? String(opts.folder) : ''),
      folders: notebookStore.listFolders()
    };
  }));

  ipcMain.handle('notebook:get', guard(async (_e, noteId) => {
    const note = notebookStore.getNote(noteId);
    return note ? { success: true, note } : { success: false, error: 'NOT_FOUND' };
  }));

  ipcMain.handle('notebook:save', guard(async (_e, input = {}) => {
    let payload = input && typeof input === 'object' ? { ...input } : {};
    // New note from a template: seed title/folder/body, caller fields win.
    if (!payload.id && payload.templateId) {
      const tpl = instantiateTemplate(payload.templateId);
      if (tpl) {
        payload = {
          ...tpl,
          ...payload,
          title: payload.title !== undefined && String(payload.title).trim() !== '' ? payload.title : tpl.title,
          folder: payload.folder !== undefined && String(payload.folder).trim() !== '' ? payload.folder : tpl.folder,
          body: payload.body !== undefined && String(payload.body).trim() !== '' ? payload.body : tpl.body
        };
      }
    }
    const note = notebookStore.saveNote(payload);
    return { success: true, note };
  }));

  ipcMain.handle('notebook:delete', guard(async (_e, noteId) => {
    const deleted = notebookStore.deleteNote(noteId);
    if (deleted) ctx.addLog?.('info', 'Notebook note deleted', String(noteId || ''));
    return { success: deleted };
  }));

  ipcMain.handle('notebook:search', guard(async (_e, query) => {
    return { notes: notebookStore.search(query) };
  }));

  ipcMain.handle('notebook:listTemplates', guard(async () => {
    return { templates: listTemplates() };
  }));

  ipcMain.handle('notebook:upsertDaily', guard(async (_e, opts = {}) => {
    return notebookStore.upsertDailyNote(opts?.dateKey, opts?.sectionTitle, opts?.markdownBlock);
  }));

  ipcMain.handle('notebook:saveAttachment', guard(async (_e, opts = {}) => {
    const result = notebookStore.saveAttachment(opts?.noteId, opts?.base64, opts?.ext);
    if (!result.success) ctx.addLog?.('warn', 'Notebook attachment rejected', result.error || '');
    return result;
  }));

  ipcMain.handle('notebook:readAttachment', guard(async (_e, opts = {}) => {
    return notebookStore.readAttachment(opts?.noteId, opts?.name);
  }));

  ipcMain.handle('notebook:getTodayStatsBlock', guard(async () => {
    const trades = typeof ctx.getStoredTrades === 'function' ? ctx.getStoredTrades() : [];
    return { success: true, ...buildTodayStatsBlock(trades) };
  }));
}

module.exports = { register, buildTodayStatsBlock };
