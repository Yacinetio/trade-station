const fs = require('fs');
const path = require('path');

function sanitizeAccountKey(accountKey = '') {
  const raw = String(accountKey || 'unknown').trim() || 'unknown';
  return raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function getAccountKeyFromTrade(trade = {}) {
  return String(trade?.accountKey || 'unknown').trim() || 'unknown';
}

function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return undefined;
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Read main file; if missing/empty/corrupt fall back to the .bak copy of the last good write. */
function safeReadJson(filePath, fallback) {
  const primary = tryReadJson(filePath);
  if (primary !== undefined) return primary;
  const backup = tryReadJson(`${filePath}.bak`);
  if (backup !== undefined) return backup;
  return fallback;
}

/**
 * Crash-safe write: serialize to .tmp, atomically rename over the main file,
 * then refresh the .bak copy. A crash mid-write leaves either the previous
 * main file intact (tmp never renamed) or the new one + stale .bak.
 */
function safeWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch {
    // backup refresh is best-effort; the main write already succeeded
  }
}

function safeDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best effort
  }
}

/** Delete a trades file plus its .bak/.tmp sidecars so stale data cannot resurrect. */
function safeDeleteFileWithSidecars(filePath) {
  safeDeleteFile(filePath);
  safeDeleteFile(`${filePath}.bak`);
  safeDeleteFile(`${filePath}.tmp`);
}

function safeDeleteEmptyDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) fs.rmdirSync(dirPath);
  } catch {
    // best effort
  }
}

function createTradeStore({ dataRoot, legacyStore, normalizeTradeForStorage }) {
  const accountsRoot = path.join(String(dataRoot || process.cwd()), 'accounts');
  const legacyStoreFile = String(legacyStore?.dataFile || path.join(String(dataRoot || process.cwd()), 'tradesync-config.json'));

  let tradesCache = null;

  function getAccountDirByKey(accountKey = '') {
    return path.join(accountsRoot, sanitizeAccountKey(accountKey));
  }

  function getTradesFileByKey(accountKey = '') {
    return path.join(getAccountDirByKey(accountKey), 'trades.json');
  }

  function ensureAccountsRoot() {
    fs.mkdirSync(accountsRoot, { recursive: true });
  }

  function readAccountTrades(accountKey = '') {
    const filePath = getTradesFileByKey(accountKey);
    const parsed = safeReadJson(filePath, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function writeAccountTrades(accountKey = '', trades = []) {
    const key = getAccountKeyFromTrade({ accountKey });
    const filePath = getTradesFileByKey(key);
    const normalized = Array.isArray(trades) ? trades.map((t) => normalizeTradeForStorage(t)) : [];
    safeWriteJson(filePath, normalized);
  }

  function listAccountKeysFromDisk() {
    try {
      ensureAccountsRoot();
      const entries = fs.readdirSync(accountsRoot, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  function getAllTrades() {
    if (tradesCache !== null) return tradesCache;
    ensureAccountsRoot();
    const keys = listAccountKeysFromDisk();
    const all = [];
    for (const key of keys) {
      const rows = readAccountTrades(key);
      if (!Array.isArray(rows)) continue;
      for (const trade of rows) {
        const normalized = normalizeTradeForStorage(trade);
        if (!normalized.accountKey) normalized.accountKey = key;
        all.push(normalized);
      }
    }
    tradesCache = all;
    return all;
  }

  function invalidateTradesCache() {
    tradesCache = null;
  }

  /** Serialize read-modify-write so rapid MT5 ACK bursts cannot overwrite each other. */
  let serializedChain = Promise.resolve();

  function runSerialized(fn) {
    const run = serializedChain.then(() => fn()).catch((err) => {
      console.error('[tradeStore] runSerialized failed:', err?.message || err);
      throw err;
    });
    serializedChain = run.catch(() => {});
    return run;
  }

  const PROTECTED_ACCOUNT_KEYS = new Set(['manual']);

  function mergePreservedUserTrades(accountKey, incomingRows = []) {
    const incomingIds = new Set(incomingRows.map((t) => String(t?.id)));
    const diskRows = readAccountTrades(accountKey);
    const extra = diskRows.filter((t) => {
      if (incomingIds.has(String(t?.id))) return false;
      return t?.userEdited === true || t?.manual === true || String(t?.channel || '') === 'Manual';
    });
    if (!extra.length) return incomingRows;
    return [...incomingRows, ...extra.map((t) => normalizeTradeForStorage(t))];
  }

  function saveAllTrades(trades = []) {
    invalidateTradesCache();
    ensureAccountsRoot();
    const grouped = new Map();
    const normalized = Array.isArray(trades) ? trades.map((t) => normalizeTradeForStorage(t)) : [];
    for (const trade of normalized) {
      const key = getAccountKeyFromTrade(trade);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ ...trade, accountKey: key });
    }

    // Write all active account files.
    for (const [key, rows] of grouped.entries()) {
      writeAccountTrades(key, mergePreservedUserTrades(key, rows));
    }

    // Cleanup removed account files (compare sanitized keys).
    const groupedSanitized = new Set(
      [...grouped.keys()].map((key) => sanitizeAccountKey(key))
    );
    for (const diskKey of listAccountKeysFromDisk()) {
      if (groupedSanitized.has(diskKey)) continue;
      if (PROTECTED_ACCOUNT_KEYS.has(diskKey)) {
        const preserved = readAccountTrades(diskKey);
        if (preserved.length > 0) writeAccountTrades(diskKey, preserved);
        continue;
      }
      const filePath = getTradesFileByKey(diskKey);
      safeDeleteFileWithSidecars(filePath);
      safeDeleteEmptyDir(getAccountDirByKey(diskKey));
    }

    // Keep legacy mirror for backward compatibility.
    try {
      legacyStore?.set?.('trades', getAllTrades());
    } catch {
      // best effort
    }
    return getAllTrades();
  }

  function deleteByAccount(accountKey = '') {
    invalidateTradesCache();
    const key = getAccountKeyFromTrade({ accountKey });
    const filePath = getTradesFileByKey(key);
    safeDeleteFileWithSidecars(filePath);
    safeDeleteEmptyDir(getAccountDirByKey(key));
  }

  function migrateFromLegacyIfNeeded() {
    const hasAccountDirs = listAccountKeysFromDisk().length > 0;
    if (hasAccountDirs) return { migrated: false, reason: 'ALREADY_MIGRATED' };
    const fromCurrentStore = legacyStore?.get?.('trades', []);
    if (Array.isArray(fromCurrentStore) && fromCurrentStore.length > 0) {
      saveAllTrades(fromCurrentStore);
      return { migrated: true, count: fromCurrentStore.length, source: 'CURRENT_STORE' };
    }

    const rootDir = path.dirname(legacyStoreFile);
    const fallbackLegacyFiles = [
      path.join(rootDir, 'data', path.basename(legacyStoreFile)),
      path.join(rootDir, path.basename(legacyStoreFile))
    ];
    for (const filePath of fallbackLegacyFiles) {
      const parsed = safeReadJson(filePath, {});
      const trades = Array.isArray(parsed?.trades) ? parsed.trades : [];
      if (trades.length === 0) continue;
      saveAllTrades(trades);
      return { migrated: true, count: trades.length, source: filePath };
    }

    return { migrated: false, reason: 'NO_LEGACY_TRADES' };
  }

  return {
    accountsRoot,
    getAllTrades,
    saveAllTrades,
    deleteByAccount,
    migrateFromLegacyIfNeeded,
    invalidateCache: invalidateTradesCache,
    runSerialized
  };
}

module.exports = { createTradeStore };
