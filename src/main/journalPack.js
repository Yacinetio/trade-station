/**
 * Journal pack export/import — selective zip of trades, notebook, strategies, attachments.
 * Reuses archiver + extract-zip mechanics from dataBackupService.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const extract = require('extract-zip');
const { safeJoinUnderRoot } = require('./dataBackupService');

const PACK_FORMAT = 'trade-station-journal-pack-v1';
const MANIFEST_NAME = 'manifest.json';

let zipArchiveCtor = null;

async function getZipArchiveCtor() {
  if (!zipArchiveCtor) {
    ({ ZipArchive: zipArchiveCtor } = await import('archiver'));
  }
  return zipArchiveCtor;
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function filterTradesByAccounts(trades = [], accountKeys = null) {
  const list = Array.isArray(trades) ? trades : [];
  if (!Array.isArray(accountKeys) || accountKeys.length === 0) return list;
  const allowed = new Set(accountKeys.map((k) => String(k)));
  return list.filter((t) => allowed.has(String(t?.accountKey || '')));
}

function listTradeAttachmentFiles(dataRoot, tradeId) {
  const dir = safeJoinUnderRoot(dataRoot, path.posix.join('attachments', 'trades', String(tradeId)));
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => ({
        abs: path.join(dir, e.name),
        rel: path.posix.join('attachments', 'trades', String(tradeId), e.name)
      }));
  } catch {
    return [];
  }
}

async function exportPack({
  dataRoot = '',
  trades = [],
  accountKeys = null,
  includeNotebook = true,
  includeStrategies = true,
  outPath = ''
} = {}) {
  const root = path.resolve(String(dataRoot || ''));
  const zipPath = path.resolve(String(outPath || ''));
  if (!root) throw new Error('DATA_ROOT_MISSING');
  if (!zipPath) throw new Error('ZIP_PATH_MISSING');

  const filtered = filterTradesByAccounts(trades, accountKeys);
  const manifest = {
    version: 1,
    format: PACK_FORMAT,
    exportedAt: new Date().toISOString(),
    accountKeys: Array.isArray(accountKeys) ? accountKeys.map(String) : null,
    counts: {
      trades: filtered.length,
      notebook: 0,
      strategies: 0,
      attachments: 0
    }
  };

  const notebookPath = path.join(root, 'notebook.json');
  const strategiesPath = path.join(root, 'strategies.json');
  const notebook = includeNotebook ? readJsonFile(notebookPath, { notes: [] }) : null;
  const strategies = includeStrategies ? readJsonFile(strategiesPath, { strategies: [], missed: [] }) : null;

  if (notebook) manifest.counts.notebook = Array.isArray(notebook.notes) ? notebook.notes.length : 0;
  if (strategies) manifest.counts.strategies = Array.isArray(strategies.strategies) ? strategies.strategies.length : 0;

  const attachmentFiles = [];
  for (const t of filtered) {
    const files = listTradeAttachmentFiles(root, t.id);
    attachmentFiles.push(...files);
  }
  manifest.counts.attachments = attachmentFiles.length;

  const ZipArchive = await getZipArchiveCtor();

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => {
      resolve({
        filePath: zipPath,
        manifest,
        zipBytes: archive.pointer()
      });
    });
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_NAME });
    archive.append(JSON.stringify(filtered, null, 2), { name: 'trades.json' });
    if (notebook) archive.append(JSON.stringify(notebook, null, 2), { name: 'notebook.json' });
    if (strategies) archive.append(JSON.stringify(strategies, null, 2), { name: 'strategies.json' });
    for (const file of attachmentFiles) {
      archive.file(file.abs, { name: file.rel.replace(/\\/g, '/') });
    }
    archive.finalize();
  });
}

function readPackManifest(extractedDir) {
  const manifestPath = path.join(extractedDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || parsed.version !== 1) return null;
    if (parsed.format && parsed.format !== PACK_FORMAT) return null;
    return parsed;
  } catch {
    return null;
  }
}

function remapTradeId(id, existingIds) {
  const base = `shared-${String(id || 'unknown')}`;
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function importPack({ dataRoot = '', zipPath = '', currentTrades = [] } = {}) {
  const root = path.resolve(String(dataRoot || ''));
  const archivePath = path.resolve(String(zipPath || ''));
  if (!root) throw new Error('DATA_ROOT_MISSING');
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error('ZIP_NOT_FOUND');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-journal-pack-'));
  const result = { tradesImported: 0, notesImported: 0, strategiesImported: 0, skipped: 0 };

  try {
    await extract(archivePath, { dir: tempDir });
    const manifest = readPackManifest(tempDir);
    if (!manifest) throw new Error('INVALID_JOURNAL_PACK');

    const tradesRaw = readJsonFile(path.join(tempDir, 'trades.json'), null);
    if (!Array.isArray(tradesRaw)) throw new Error('INVALID_JOURNAL_PACK');

    const existingIds = new Set((Array.isArray(currentTrades) ? currentTrades : []).map((t) => String(t?.id || '')));
    const importedTrades = [];

    for (const t of tradesRaw) {
      const origId = String(t?.id || '');
      const newId = remapTradeId(origId, existingIds);
      if (existingIds.has(String(t?.id || ''))) {
        result.skipped += 1;
        continue;
      }
      existingIds.add(newId);
      const origAccount = String(t?.accountKey || 'unknown');
      importedTrades.push({
        ...t,
        id: newId,
        accountKey: `shared:${origAccount}`,
        readOnlyScope: true,
        importedFromPack: true,
        originalId: origId,
        originalAccountKey: origAccount
      });
      result.tradesImported += 1;

      const attachSrc = path.join(tempDir, 'attachments', 'trades', origId);
      if (fs.existsSync(attachSrc)) {
        const attachDest = safeJoinUnderRoot(root, path.posix.join('attachments', 'trades', newId));
        fs.mkdirSync(attachDest, { recursive: true });
        for (const name of fs.readdirSync(attachSrc)) {
          const src = path.join(attachSrc, name);
          const dest = path.join(attachDest, name);
          if (fs.existsSync(dest)) continue;
          if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
        }
      }
    }

    const notebookSrc = path.join(tempDir, 'notebook.json');
    if (fs.existsSync(notebookSrc)) {
      const incoming = readJsonFile(notebookSrc, { notes: [] });
      const notebookPath = path.join(root, 'notebook.json');
      const current = readJsonFile(notebookPath, { notes: [] });
      const existingNoteIds = new Set((current.notes || []).map((n) => String(n?.id || '')));
      const nextNotes = [...(current.notes || [])];

      for (const note of incoming.notes || []) {
        const nid = `shared-${String(note?.id || 'note')}`;
        if (existingNoteIds.has(nid)) {
          result.skipped += 1;
          continue;
        }
        existingNoteIds.add(nid);
        nextNotes.push({
          ...note,
          id: nid,
          folder: 'Shared',
          imported: true
        });
        result.notesImported += 1;
      }
      safeWriteJson(notebookPath, { notes: nextNotes });
    }

    const strategiesSrc = path.join(tempDir, 'strategies.json');
    if (fs.existsSync(strategiesSrc)) {
      const incoming = readJsonFile(strategiesSrc, { strategies: [], missed: [] });
      const strategiesPath = path.join(root, 'strategies.json');
      const current = readJsonFile(strategiesPath, { strategies: [], missed: [] });
      const existingStratIds = new Set((current.strategies || []).map((s) => String(s?.id || '')));
      const nextStrategies = [...(current.strategies || [])];

      for (const strat of incoming.strategies || []) {
        const sid = `shared-${String(strat?.id || 'strat')}`;
        if (existingStratIds.has(sid)) {
          result.skipped += 1;
          continue;
        }
        existingStratIds.add(sid);
        nextStrategies.push({
          ...strat,
          id: sid,
          imported: true
        });
        result.strategiesImported += 1;
      }
      safeWriteJson(strategiesPath, {
        strategies: nextStrategies,
        missed: current.missed || []
      });
    }

    return { ...result, trades: importedTrades, manifest };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

module.exports = {
  PACK_FORMAT,
  exportPack,
  importPack,
  readPackManifest,
  filterTradesByAccounts
};
