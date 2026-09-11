/**
 * Prop-firm dashboard IPC — profiles, evaluation, simulator, journal packs.
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const {
  PRESETS,
  listPresets,
  newProfileId,
  evaluateProfile,
  violationHistory
} = require('./propRules');
const { simulateChallenge, riskSensitivity } = require('./challengeSimulator');
const { exportPack, importPack } = require('./journalPack');

const STORE_KEY = 'propRuleProfiles';

function loadProfiles(store) {
  const rows = store?.get?.(STORE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function saveProfiles(store, profiles) {
  store?.set?.(STORE_KEY, profiles);
}

function findProfile(store, profileId) {
  const id = String(profileId || '');
  return loadProfiles(store).find((p) => String(p?.id) === id) || null;
}

function register(ctx) {
  ipcMain.handle('propfirm:listProfiles', ctx.ensureLicensed(async () => ({
    success: true,
    profiles: loadProfiles(ctx.store)
  })));

  ipcMain.handle('propfirm:saveProfile', ctx.ensureLicensed(async (_e, input = {}) => {
    const profiles = loadProfiles(ctx.store);
    const id = input.id ? String(input.id) : newProfileId();
    const idx = profiles.findIndex((p) => String(p?.id) === id);
    const preset = PRESETS[input.presetId] || {};
    const record = {
      ...(idx >= 0 ? profiles[idx] : {}),
      ...preset,
      ...input,
      id,
      createdAt: idx >= 0 ? profiles[idx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    delete record.presetId;
    if (idx >= 0) profiles[idx] = record;
    else profiles.push(record);
    saveProfiles(ctx.store, profiles);
    return { success: true, profile: record };
  }));

  ipcMain.handle('propfirm:deleteProfile', ctx.ensureLicensed(async (_e, profileId) => {
    const id = String(profileId || '');
    const profiles = loadProfiles(ctx.store).filter((p) => String(p?.id) !== id);
    saveProfiles(ctx.store, profiles);
    return { success: true };
  }));

  ipcMain.handle('propfirm:listPresets', ctx.ensureLicensed(async () => ({
    success: true,
    presets: listPresets()
  })));

  ipcMain.handle('propfirm:evaluate', ctx.ensureLicensed(async (_e, profileId) => {
    const profile = findProfile(ctx.store, profileId);
    if (!profile) return { success: false, error: 'Profile not found' };
    const trades = ctx.getStoredTrades();
    return {
      success: true,
      profile,
      evaluation: evaluateProfile(profile, trades),
      violations: violationHistory(profile, trades)
    };
  }));

  ipcMain.handle('propfirm:evaluateAll', ctx.ensureLicensed(async () => {
    const trades = ctx.getStoredTrades();
    const rows = loadProfiles(ctx.store).map((profile) => ({
      profile,
      evaluation: evaluateProfile(profile, trades),
      violations: violationHistory(profile, trades)
    }));
    return { success: true, rows };
  }));

  ipcMain.handle('propfirm:simulate', ctx.ensureLicensed(async (_e, opts = {}) => {
    const profile = findProfile(ctx.store, opts?.profileId);
    if (!profile) return { success: false, error: 'Profile not found' };
    const settings = ctx.getSettings?.() || {};
    const riskScale = Number(opts?.riskScale ?? settings?.propFirm?.defaultRiskScale ?? 1) || 1;
    const trades = ctx.getStoredTrades();
    const simulation = simulateChallenge({ profile, trades, riskScale, runs: 2000 });
    return { success: true, simulation, riskScale };
  }));

  ipcMain.handle('propfirm:riskSensitivity', ctx.ensureLicensed(async (_e, opts = {}) => {
    const profile = findProfile(ctx.store, opts?.profileId);
    if (!profile) return { success: false, error: 'Profile not found' };
    const trades = ctx.getStoredTrades();
    const rows = riskSensitivity({ profile, trades, runs: 500 });
    return { success: true, rows };
  }));

  ipcMain.handle('propfirm:exportPack', ctx.ensureLicensed(async (_e, opts = {}) => {
    const dataRoot = ctx.dataRoot || '';
    if (!dataRoot) return { success: false, error: 'DATA_ROOT_MISSING' };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultPath = path.join(path.dirname(dataRoot), `TradeStation-journal-pack-${stamp}.zip`);
    const saveResult = await dialog.showSaveDialog(ctx.getMainWindow() || undefined, {
      title: 'Export journal pack',
      defaultPath,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }
    let zipPath = String(saveResult.filePath || '').trim();
    if (!/\.zip$/i.test(zipPath)) zipPath += '.zip';

    const exported = await exportPack({
      dataRoot,
      trades: ctx.getStoredTrades(),
      accountKeys: Array.isArray(opts?.accountKeys) ? opts.accountKeys : null,
      includeNotebook: opts?.includeNotebook !== false,
      includeStrategies: opts?.includeStrategies !== false,
      outPath: zipPath
    });
    ctx.addLog?.('success', 'Journal pack exported', zipPath);
    return { success: true, ...exported };
  }));

  ipcMain.handle('propfirm:importPack', ctx.ensureLicensed(async () => {
    const dataRoot = ctx.dataRoot || '';
    if (!dataRoot) return { success: false, error: 'DATA_ROOT_MISSING' };

    const pickResult = await dialog.showOpenDialog(ctx.getMainWindow() || undefined, {
      title: 'Import journal pack',
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      properties: ['openFile']
    });
    if (pickResult.canceled || !pickResult.filePaths?.length) {
      return { success: false, canceled: true };
    }

    const zipPath = pickResult.filePaths[0];
    const currentTrades = ctx.getStoredTrades();
    const imported = await importPack({ dataRoot, zipPath, currentTrades });
    if (imported.trades?.length) {
      ctx.saveStoredTrades([...currentTrades, ...imported.trades]);
    }
    ctx.addLog?.('success', 'Journal pack imported', `${imported.tradesImported} trades`);
    try {
      ctx.getMainWindow()?.webContents.send('trades:changed');
    } catch {
      /* window may be closed */
    }
    return {
      success: true,
      tradesImported: imported.tradesImported,
      notesImported: imported.notesImported,
      strategiesImported: imported.strategiesImported,
      skipped: imported.skipped
    };
  }));
}

module.exports = { register };
