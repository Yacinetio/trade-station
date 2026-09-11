const fs = require('fs');
const os = require('os');
const path = require('path');
const extract = require('extract-zip');

let zipArchiveCtor = null;

async function getZipArchiveCtor() {
  if (!zipArchiveCtor) {
    ({ ZipArchive: zipArchiveCtor } = await import('archiver'));
  }
  return zipArchiveCtor;
}

const BACKUP_DATA_PREFIX = 'TradeStation-data';
const BACKUP_FORMAT = 'trade-station-data-backup-v1';

function sanitizeAccountKey(accountKey = '') {
  const raw = String(accountKey || 'unknown').trim() || 'unknown';
  return raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function listAccountFolderKeys(dataRoot = '') {
  const accountsRoot = path.join(path.resolve(String(dataRoot || '')), 'accounts');
  if (!accountsRoot || !fs.existsSync(accountsRoot)) return [];
  try {
    return fs.readdirSync(accountsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function shouldIncludeAccountPath(relPath = '', includeAccountKeys = null) {
  if (includeAccountKeys === null || includeAccountKeys === undefined) return true;
  const relNorm = String(relPath || '').replace(/\\/g, '/');
  const match = relNorm.match(/^accounts\/([^/]+)(\/|$)/);
  if (!match) return true;
  const allowed = new Set(
    (Array.isArray(includeAccountKeys) ? includeAccountKeys : [])
      .map((key) => sanitizeAccountKey(key))
  );
  return allowed.has(match[1]);
}

function listDataFiles(rootDir = '', { excludeAbsPaths = [], includeAccountKeys = null } = {}) {
  const root = path.resolve(String(rootDir || ''));
  if (!root || !fs.existsSync(root)) return [];
  const excluded = new Set(
    (Array.isArray(excludeAbsPaths) ? excludeAbsPaths : [])
      .map((p) => path.resolve(String(p || '')))
      .filter(Boolean)
  );
  const files = [];

  function walk(currentDir, relBase = '') {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const rel = relBase ? path.posix.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const resolved = path.resolve(abs);
      if (excluded.has(resolved)) continue;
      if (!shouldIncludeAccountPath(rel, includeAccountKeys)) continue;
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        size = 0;
      }
      files.push({ abs, rel, size });
    }
  }

  walk(root);
  return files;
}

function safeJoinUnderRoot(rootDir = '', relPath = '') {
  const root = path.resolve(String(rootDir || ''));
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }
  return target;
}

function readBackupManifest(extractedDir = '') {
  const manifestPath = path.join(String(extractedDir || ''), 'backup-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function resolveBackupSourceRoot(extractedDir = '') {
  const base = path.resolve(String(extractedDir || ''));
  if (!base || !fs.existsSync(base)) return null;

  const prefixed = path.join(base, BACKUP_DATA_PREFIX);
  if (fs.existsSync(prefixed)) return prefixed;

  if (fs.existsSync(path.join(base, 'tradesync-config.json'))) return base;

  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length === 1) {
    const candidate = path.join(base, dirs[0].name);
    if (fs.existsSync(path.join(candidate, 'tradesync-config.json'))) return candidate;
    if (fs.existsSync(path.join(candidate, BACKUP_DATA_PREFIX))) {
      return path.join(candidate, BACKUP_DATA_PREFIX);
    }
  }
  return null;
}

function mergeRestoreFromExtracted({ sourceRoot = '', dataRoot = '' } = {}) {
  const src = path.resolve(String(sourceRoot || ''));
  const dest = path.resolve(String(dataRoot || ''));
  if (!src || !fs.existsSync(src)) throw new Error('RESTORE_SOURCE_MISSING');
  if (!dest) throw new Error('DATA_ROOT_MISSING');

  const files = listDataFiles(src);
  if (files.length === 0) throw new Error('RESTORE_EMPTY');

  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  let overwritten = 0;
  for (const file of files) {
    const target = safeJoinUnderRoot(dest, file.rel);
    const existed = fs.existsSync(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.abs, target);
    copied += 1;
    if (existed) overwritten += 1;
  }
  return { copied, overwritten, added: copied - overwritten, fileCount: files.length };
}

function buildBackupManifest({
  dataRoot = '',
  files = [],
  appVersion = '',
  deviceId = '',
  includeAccountKeys = null
} = {}) {
  const totalBytes = files.reduce((sum, row) => sum + (Number(row?.size) || 0), 0);
  const manifest = {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    appVersion: String(appVersion || '').trim() || 'unknown',
    deviceId: String(deviceId || '').trim() || 'unknown',
    dataRoot: String(dataRoot || ''),
    fileCount: files.length,
    totalBytes,
    note: 'Trade Station data backup. Restore via Settings → About → Restore from backup (ZIP).'
  };
  if (Array.isArray(includeAccountKeys)) {
    manifest.includedAccountKeys = includeAccountKeys.map((key) => sanitizeAccountKey(key));
  }
  return manifest;
}

async function exportDataRootToZip({
  dataRoot = '',
  zipPath = '',
  appVersion = '',
  deviceId = '',
  includeAccountKeys = null
} = {}) {
  const root = path.resolve(String(dataRoot || ''));
  const targetZip = path.resolve(String(zipPath || ''));
  if (!root || !fs.existsSync(root)) {
    throw new Error('DATA_ROOT_MISSING');
  }
  if (!targetZip) {
    throw new Error('ZIP_PATH_MISSING');
  }

  const files = listDataFiles(root, { excludeAbsPaths: [targetZip], includeAccountKeys });
  const manifest = buildBackupManifest({
    dataRoot: root,
    files,
    appVersion,
    deviceId,
    includeAccountKeys: Array.isArray(includeAccountKeys) ? includeAccountKeys : null
  });
  const ZipArchive = await getZipArchiveCtor();

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(targetZip), { recursive: true });
    const output = fs.createWriteStream(targetZip);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => {
      resolve({
        filePath: targetZip,
        fileCount: files.length,
        totalBytes: manifest.totalBytes,
        zipBytes: archive.pointer()
      });
    });
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'backup-manifest.json' });
    for (const file of files) {
      archive.file(file.abs, { name: path.posix.join(BACKUP_DATA_PREFIX, file.rel.replace(/\\/g, '/')) });
    }
    archive.finalize();
  });
}

async function importDataZipToRoot({
  dataRoot = '',
  zipPath = '',
  createSafetyBackup = true,
  appVersion = '',
  deviceId = ''
} = {}) {
  const root = path.resolve(String(dataRoot || ''));
  const archivePath = path.resolve(String(zipPath || ''));
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error('ZIP_NOT_FOUND');
  if (!root) throw new Error('DATA_ROOT_MISSING');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-restore-'));
  try {
    await extract(archivePath, { dir: tempDir });
    const sourceRoot = resolveBackupSourceRoot(tempDir);
    if (!sourceRoot) throw new Error('INVALID_BACKUP_ZIP');

    const manifest = readBackupManifest(tempDir);
    let safetyBackupPath = null;
    if (createSafetyBackup && fs.existsSync(root) && listDataFiles(root).length > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      safetyBackupPath = path.join(path.dirname(root), `TradeStation-pre-restore-${stamp}.zip`);
      await exportDataRootToZip({
        dataRoot: root,
        zipPath: safetyBackupPath,
        appVersion,
        deviceId
      });
    }

    const merged = mergeRestoreFromExtracted({ sourceRoot, dataRoot: root });
    return {
      ...merged,
      manifest,
      safetyBackupPath,
      zipPath: archivePath
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

module.exports = {
  BACKUP_DATA_PREFIX,
  BACKUP_FORMAT,
  sanitizeAccountKey,
  listAccountFolderKeys,
  shouldIncludeAccountPath,
  listDataFiles,
  safeJoinUnderRoot,
  readBackupManifest,
  resolveBackupSourceRoot,
  mergeRestoreFromExtracted,
  buildBackupManifest,
  exportDataRootToZip,
  importDataZipToRoot
};
