const path = require('path');
const os = require('os');

/** Well-known instance ids → default EA TCP ports (must differ per concurrent instance). */
const KNOWN_INSTANCE_PORTS = {
  demo: 9999,
  live: 10000,
  funded: 10001,
  prop: 10002,
};

const INSTANCE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

function sanitizeInstanceId(raw) {
  const id = String(raw || '').trim();
  if (!id || !INSTANCE_ID_RE.test(id)) return '';
  return id;
}

function readInstanceFromArgv(argv = process.argv) {
  for (const arg of argv) {
    if (arg.startsWith('--instance=')) {
      return sanitizeInstanceId(arg.slice('--instance='.length));
    }
    if (arg === '--instance' || arg === '-i') {
      const idx = argv.indexOf(arg);
      if (idx >= 0 && argv[idx + 1]) return sanitizeInstanceId(argv[idx + 1]);
    }
  }
  return '';
}

function readInstanceFromEnv() {
  return sanitizeInstanceId(process.env.TRADE_STATION_INSTANCE || process.env.TS_INSTANCE || '');
}

/** Infer instance from packaged exe name (double-click friendly, no --instance flag). */
function readInstanceFromExePath(exePath = '') {
  const base = path.basename(String(exePath || ''), path.extname(String(exePath || '')));
  if (!base) return '';

  const known = base.match(/(?:^|-)(Demo|Live|Funded|Prop)(?:-|$)/i);
  if (known) return sanitizeInstanceId(known[1].toLowerCase());

  const branded = base.match(/Trade[- ]Station[- ]([A-Za-z0-9_-]+)/i);
  if (branded) {
    const candidate = sanitizeInstanceId(branded[1].toLowerCase());
    if (candidate && !['portable', 'setup', 'station'].includes(candidate)) return candidate;
  }
  return '';
}

/**
 * electron-builder portable exes self-extract to %TEMP% and run as "Trade Station.exe",
 * so process.execPath never carries the Demo/Live name. The portable launcher exposes
 * the original exe path via PORTABLE_EXECUTABLE_FILE — read the instance from there.
 */
function readInstanceFromPortableEnv(env = process.env) {
  const portableFile = env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_NAME || '';
  if (!portableFile) return '';
  return readInstanceFromExePath(portableFile);
}

function resolveActiveInstanceId(argv = process.argv, exePath = process.execPath, env = process.env) {
  return (
    readInstanceFromArgv(argv)
    || readInstanceFromEnv()
    || readInstanceFromPortableEnv(env)
    || readInstanceFromExePath(exePath)
  );
}

function defaultTcpPortForInstance(id) {
  if (!id) return 9999;
  if (KNOWN_INSTANCE_PORTS[id]) return KNOWN_INSTANCE_PORTS[id];
  let h = 5381;
  for (let i = 0; i < id.length; i += 1) {
    h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  }
  return 10000 + (h % 1000);
}

function formatInstanceLabel(id) {
  if (!id) return '';
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function safeGetDocumentsPath() {
  const home = os.homedir() || process.env.USERPROFILE || process.cwd();
  return path.join(home, 'Documents');
}

function resolveDataRoot(instanceId) {
  const docs = safeGetDocumentsPath();
  if (!instanceId) return path.join(docs, 'TradeStation');
  return path.join(docs, 'TradeStation', 'instances', instanceId);
}

function resolveUserDataRoot(instanceId) {
  const appData = process.env.APPDATA || path.join(os.homedir() || process.cwd(), 'AppData', 'Roaming');
  const base = path.join(appData, 'Trade Station');
  if (!instanceId) return base;
  return path.join(base, 'instances', instanceId);
}

const instanceId = resolveActiveInstanceId();
const dataRoot = resolveDataRoot(instanceId);
const userDataRoot = resolveUserDataRoot(instanceId);
const defaultTcpPort = defaultTcpPortForInstance(instanceId);
const label = formatInstanceLabel(instanceId);

function getProfile() {
  return {
    id: instanceId,
    label,
    dataRoot,
    userDataRoot,
    defaultTcpPort,
    isNamedInstance: !!instanceId,
  };
}

module.exports = {
  sanitizeInstanceId,
  readInstanceFromArgv,
  readInstanceFromEnv,
  readInstanceFromExePath,
  readInstanceFromPortableEnv,
  resolveActiveInstanceId,
  defaultTcpPortForInstance,
  formatInstanceLabel,
  resolveDataRoot,
  resolveUserDataRoot,
  getProfile,
  /** Active profile for this process (parsed once at startup). */
  active: getProfile(),
};
