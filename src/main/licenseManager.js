const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const APP_VERSION = '1.1.0';

function safeExec(command) {
  try {
    return String(execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch {
    return '';
  }
}

let _machineGuidCache = '';

function getMachineGuidWindows() {
  if (process.platform !== 'win32') return '';
  if (_machineGuidCache) return _machineGuidCache;
  const output = safeExec('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid');
  if (!output) return '';
  const lines = output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const hit = lines.find((line) => /MachineGuid/i.test(line));
  if (!hit) return '';
  const parts = hit.split(/\s+/);
  _machineGuidCache = parts[parts.length - 1] || '';
  return _machineGuidCache;
}

function buildRawFingerprint() {
  const cpu = (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || '';
  const machineGuid = getMachineGuidWindows();
  const chunks = [
    process.platform,
    process.arch,
    os.hostname(),
    os.userInfo().username,
    cpu,
    String(os.totalmem()),
    machineGuid
  ];
  return chunks.join('|');
}

function getDeviceId() {
  const raw = buildRawFingerprint();
  const digest = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `TS-${digest.slice(0, 8)}-${digest.slice(8, 16)}-${digest.slice(16, 24)}`;
}

function isTradeStationE2eMode() {
  return process.argv.includes('--trade-station-e2e');
}

/** License gating removed for open-source builds — always licensed. */
function getLicenseStatus(_store) {
  return {
    licensed: true,
    appVersion: APP_VERSION,
    deviceId: getDeviceId(),
    reason: 'OPEN_SOURCE',
    payload: null,
    expiresAt: null,
    expiresInMs: null,
  };
}

function activateLicense(_store, _token) {
  return { ok: true, reason: 'OPEN_SOURCE', deviceId: getDeviceId(), payload: null };
}

function clearLicense(_store) {
  /* no-op */
}

function resetExpiryWarnings(_store) {
  /* no-op */
}

module.exports = {
  APP_VERSION,
  getDeviceId,
  isTradeStationE2eMode,
  getLicenseStatus,
  activateLicense,
  clearLicense,
  resetExpiryWarnings,
};
