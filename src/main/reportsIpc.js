/**
 * IPC surface for the Reports engine (reportEngine.js).
 *
 * register(ctx) is called from main.js with the shared featureIpcCtx:
 * { store, dataRoot, getStoredTrades, saveStoredTrades, ensureLicensed,
 *   addLog, getSettings, getMainWindow, notify }.
 *
 * Saved report filters persist in ctx.store under 'reportSavedFilters'.
 */

const { ipcMain } = require('electron');
const {
  listDimensions,
  computeReport,
  compareReports,
  winsVsLossesCompare
} = require('./reportEngine');

const SAVED_FILTERS_KEY = 'reportSavedFilters';
const LEGACY_FILTER_KEYS = ['accountKeys', 'channels', 'symbols', 'dateFromMs', 'dateToMs', 'tags', 'strategyIds', 'direction', 'winLoss'];
const TRADE_FILTER_STRING_KEYS = ['filterSymbol', 'filterType', 'filterStatus', 'filterChannel', 'signalsTab'];
const TRADE_FILTER_ARRAY_KEYS = [
  'sliceTimeframes', 'slicePairs', 'sliceBiases', 'sliceSetups',
  'sliceVwapBands', 'sliceHvnBands', 'sliceSessions', 'sliceTags',
  'sliceTrendAligns', 'sliceKillzones', 'sliceConfluenceTiers', 'sliceTop1Values'
];

function sanitizeStringList(raw, max = 100) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x || '').trim()).filter(Boolean).slice(0, max);
}

/** Normalize persisted app-wide tradeFilters before main-process filtering. */
function sanitizeTradeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of TRADE_FILTER_STRING_KEYS) {
    if (f[key] == null) continue;
    out[key] = String(f[key]).slice(0, 200);
  }
  for (const key of TRADE_FILTER_ARRAY_KEYS) {
    const list = sanitizeStringList(f[key]);
    if (list.length) out[key] = list;
  }
  if (Array.isArray(f.sliceWeekdays)) {
    const days = f.sliceWeekdays
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (days.length) out.sliceWeekdays = days;
  }
  return out;
}

/** Keep only known filter keys so arbitrary renderer payloads never persist. */
function sanitizeFilter(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const out = {};

  // App-wide Reports payload (shared with Dashboard / Trades filters)
  if (f.tradeFilters && typeof f.tradeFilters === 'object') {
    out.tradeFilters = sanitizeTradeFilters(f.tradeFilters);
  }
  const timeScope = String(f.timeScope || '').trim().toUpperCase();
  if (timeScope) out.timeScope = timeScope.slice(0, 20);
  if (f.scopeFrom != null && String(f.scopeFrom).trim()) {
    out.scopeFrom = String(f.scopeFrom).slice(0, 20);
  }
  if (f.scopeTo != null && String(f.scopeTo).trim()) {
    out.scopeTo = String(f.scopeTo).slice(0, 20);
  }
  const be = Number(f.breakEvenAmount);
  if (Number.isFinite(be) && be >= 0) out.breakEvenAmount = be;

  for (const key of LEGACY_FILTER_KEYS) {
    if (f[key] == null) continue;
    if (key === 'dateFromMs' || key === 'dateToMs') {
      const n = Number(f[key]);
      if (Number.isFinite(n)) out[key] = n;
    } else if (key === 'direction' || key === 'winLoss') {
      const s = String(f[key]).trim().toUpperCase();
      if (s) out[key] = s;
    } else if (Array.isArray(f[key])) {
      const list = sanitizeStringList(f[key]);
      if (list.length) out[key] = list;
    }
  }
  return out;
}

function readSavedFilters(store) {
  const raw = store.get(SAVED_FILTERS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object' && x.id && x.name)
    .map((x) => ({
      id: String(x.id),
      name: String(x.name).slice(0, 80),
      filter: sanitizeFilter(x.filter),
      createdAt: x.createdAt || null,
      updatedAt: x.updatedAt || null
    }));
}

function register(ctx) {
  const { store, getStoredTrades, ensureLicensed, addLog } = ctx;

  ipcMain.handle('reports:listDimensions', ensureLicensed(async () => {
    return { ok: true, groups: listDimensions() };
  }));

  ipcMain.handle('reports:compute', ensureLicensed(async (_e, opts = {}) => {
    try {
      const result = computeReport(getStoredTrades(), {
        dimensionId: String(opts?.dimensionId || ''),
        filter: sanitizeFilter(opts?.filter)
      });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }));

  ipcMain.handle('reports:compare', ensureLicensed(async (_e, opts = {}) => {
    try {
      const result = compareReports(getStoredTrades(), {
        filterA: sanitizeFilter(opts?.filterA),
        filterB: sanitizeFilter(opts?.filterB)
      });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }));

  ipcMain.handle('reports:winsVsLosses', ensureLicensed(async (_e, opts = {}) => {
    try {
      const result = winsVsLossesCompare(getStoredTrades(), sanitizeFilter(opts?.filter));
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }));

  ipcMain.handle('reports:listSavedFilters', ensureLicensed(async () => {
    return { ok: true, filters: readSavedFilters(store) };
  }));

  ipcMain.handle('reports:saveFilter', ensureLicensed(async (_e, payload = {}) => {
    const name = String(payload?.name || '').trim().slice(0, 80);
    if (!name) return { ok: false, error: 'Filter name is required' };
    const filters = readSavedFilters(store);
    const id = payload?.id ? String(payload.id) : `rf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const entry = {
      id,
      name,
      filter: sanitizeFilter(payload?.filter),
      createdAt: now,
      updatedAt: now
    };
    const idx = filters.findIndex((f) => f.id === id);
    if (idx >= 0) {
      entry.createdAt = filters[idx].createdAt || now;
      filters[idx] = entry;
    } else {
      filters.push(entry);
    }
    store.set(SAVED_FILTERS_KEY, filters.slice(0, 100));
    addLog('info', 'Report filter saved', name);
    return { ok: true, filters: readSavedFilters(store), savedId: id };
  }));

  ipcMain.handle('reports:deleteSavedFilter', ensureLicensed(async (_e, id) => {
    const target = String(id || '');
    if (!target) return { ok: false, error: 'Filter id is required' };
    const filters = readSavedFilters(store).filter((f) => f.id !== target);
    store.set(SAVED_FILTERS_KEY, filters);
    return { ok: true, filters };
  }));
}

module.exports = { register, sanitizeFilter, sanitizeTradeFilters };
