const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const Store = require('electron-store');
const instanceProfile = require('./instanceProfile');

function safeGetDocumentsPath() {
  const home = os.homedir() || process.env.USERPROFILE || process.cwd();
  const userDocuments = path.join(home, 'Documents');
  try {
    // Prefer user-profile Documents so users always find data in the expected folder.
    if (process.platform === 'win32') return userDocuments;
    if (app?.isReady?.()) return app.getPath('documents');
  } catch {
    // fallback below
  }
  return userDocuments;
}

function safeGetLegacyUserDataPath() {
  try {
    if (app?.isReady?.()) return app.getPath('userData');
  } catch {
    // fallback below
  }
  const appData = process.env.APPDATA || path.join(os.homedir() || process.cwd(), 'AppData', 'Roaming');
  return path.join(appData, 'Trade Station');
}

const DATA_ROOT = instanceProfile.active.dataRoot;
const STORE_NAME = 'tradesync-config';
const STORE_FILE = `${STORE_NAME}.json`;
const NEXT_STORE_PATH = path.join(DATA_ROOT, STORE_FILE);

function ensureDataRoot() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

function ensureStoreFileExists() {
  try {
    if (fs.existsSync(NEXT_STORE_PATH)) return;
    ensureDataRoot();
    fs.writeFileSync(NEXT_STORE_PATH, '{}', 'utf8');
  } catch {
    // best-effort; electron-store will create the file on first write.
  }
}

function migrateLegacyStoreIfNeeded() {
  if (fs.existsSync(NEXT_STORE_PATH)) return;
  // Named instances start fresh; do not pull from the default profile folder.
  if (instanceProfile.active.isNamedInstance) return;

  const docsPath = safeGetDocumentsPath();
  let appDocsPath = '';
  try {
    if (app?.isReady?.()) appDocsPath = app.getPath('documents');
  } catch {
    appDocsPath = '';
  }
  const legacyCandidates = [
    path.join(docsPath, 'TradeStation', 'data', STORE_FILE),
    path.join(docsPath, 'TradeStation', STORE_FILE),
    appDocsPath ? path.join(appDocsPath, 'TradeStation', 'data', STORE_FILE) : '',
    appDocsPath ? path.join(appDocsPath, 'TradeStation', STORE_FILE) : '',
    path.join(safeGetLegacyUserDataPath(), STORE_FILE),
    path.join(process.cwd(), STORE_FILE)
  ];

  for (const legacyPath of legacyCandidates.filter(Boolean)) {
    try {
      if (!fs.existsSync(legacyPath)) continue;
      ensureDataRoot();
      fs.copyFileSync(legacyPath, NEXT_STORE_PATH);
      break;
    } catch {
      // best-effort migration; app continues with new empty store.
    }
  }
}

ensureDataRoot();
migrateLegacyStoreIfNeeded();
ensureStoreFileExists();

const store = new Store({
  name: STORE_NAME,
  cwd: DATA_ROOT
});
store.dataRoot = DATA_ROOT;
store.dataFile = NEXT_STORE_PATH;
store.instanceProfile = instanceProfile.active;

module.exports = store;
