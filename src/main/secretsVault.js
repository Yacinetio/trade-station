/**
 * Encrypts sensitive electron-store values at rest using Electron's `safeStorage`
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Falls back to plaintext
 * passthrough when encryption is unavailable so the app still functions.
 *
 * The encrypted format is: `enc:v1:<base64>` so we can detect and migrate old plaintext
 * values automatically the first time we read them.
 */

const ENC_PREFIX = 'enc:v1:';

let safeStorageRef = null;
let canEncrypt = false;

function getSafeStorage() {
  if (safeStorageRef) return safeStorageRef;
  try {
    safeStorageRef = require('electron').safeStorage;
  } catch (_) {
    safeStorageRef = null;
  }
  return safeStorageRef;
}

/** Call after `app.whenReady()`. Determines whether DPAPI/keyring is available. */
function init() {
  const ss = getSafeStorage();
  try {
    canEncrypt = !!(ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable());
  } catch (_) {
    canEncrypt = false;
  }
  return canEncrypt;
}

function isEncryptedString(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

function encryptValue(plain) {
  if (plain == null || plain === '') return plain;
  if (!canEncrypt) return String(plain);
  const ss = getSafeStorage();
  try {
    const buf = ss.encryptString(String(plain));
    return ENC_PREFIX + buf.toString('base64');
  } catch (_) {
    return String(plain);
  }
}

function decryptValue(stored) {
  if (stored == null || stored === '') return stored;
  if (!isEncryptedString(stored)) return stored;
  if (!canEncrypt) return '';
  const ss = getSafeStorage();
  try {
    const b64 = stored.slice(ENC_PREFIX.length);
    const buf = Buffer.from(b64, 'base64');
    return ss.decryptString(buf);
  } catch (_) {
    return '';
  }
}

/**
 * Read a single secret from the store, transparently decrypting if needed.
 * If the stored value is plaintext (legacy), it is re-encrypted in place when
 * encryption is available, performing a one-time migration.
 */
function getSecret(store, key, fallback = '') {
  const raw = store.get(key, fallback);
  if (raw == null || raw === '') return fallback;
  if (isEncryptedString(raw)) return decryptValue(raw);
  // Legacy plaintext — migrate.
  if (canEncrypt) {
    try {
      store.set(key, encryptValue(raw));
    } catch (_) { /* best effort */ }
  }
  return String(raw);
}

function setSecret(store, key, value) {
  if (value == null || value === '') {
    store.set(key, '');
    return;
  }
  store.set(key, encryptValue(value));
}

/**
 * Encrypt a single nested string field on each item of an array stored at `key`.
 * Used for `brokerConnections[].auth.password`.
 */
function migrateArrayField(store, key, fieldPath) {
  if (!canEncrypt) return;
  const list = store.get(key);
  if (!Array.isArray(list) || list.length === 0) return;
  let changed = false;
  const next = list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const segs = fieldPath.split('.');
    let cursor = item;
    for (let i = 0; i < segs.length - 1; i += 1) {
      cursor = cursor && cursor[segs[i]];
      if (!cursor || typeof cursor !== 'object') return item;
    }
    const last = segs[segs.length - 1];
    const v = cursor[last];
    if (typeof v === 'string' && v && !isEncryptedString(v)) {
      cursor[last] = encryptValue(v);
      changed = true;
    }
    return item;
  });
  if (changed) {
    try { store.set(key, next); } catch (_) { /* best effort */ }
  }
}

function decryptArrayField(list, fieldPath) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const segs = fieldPath.split('.');
    const clone = JSON.parse(JSON.stringify(item));
    let cursor = clone;
    for (let i = 0; i < segs.length - 1; i += 1) {
      cursor = cursor && cursor[segs[i]];
      if (!cursor || typeof cursor !== 'object') return clone;
    }
    const last = segs[segs.length - 1];
    const v = cursor[last];
    if (typeof v === 'string' && isEncryptedString(v)) {
      cursor[last] = decryptValue(v);
    }
    return clone;
  });
}

function encryptArrayField(list, fieldPath) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const segs = fieldPath.split('.');
    const clone = JSON.parse(JSON.stringify(item));
    let cursor = clone;
    for (let i = 0; i < segs.length - 1; i += 1) {
      cursor = cursor && cursor[segs[i]];
      if (!cursor || typeof cursor !== 'object') return clone;
    }
    const last = segs[segs.length - 1];
    const v = cursor[last];
    if (typeof v === 'string' && v && !isEncryptedString(v)) {
      cursor[last] = encryptValue(v);
    }
    return clone;
  });
}

/**
 * One-shot migration after `app.whenReady()`. Encrypts existing plaintext secrets that
 * we know about, so subsequent reads/writes go through getSecret/setSecret seamlessly.
 */
function migrateKnownSecrets(store) {
  if (!canEncrypt) return;
  const knownTopLevelKeys = ['telegramSession', 'license.token'];
  for (const k of knownTopLevelKeys) {
    const raw = store.get(k, '');
    if (typeof raw === 'string' && raw && !isEncryptedString(raw)) {
      try { store.set(k, encryptValue(raw)); } catch (_) { /* best-effort */ }
    }
  }

  // brokerConnections[].auth.password
  migrateArrayField(store, 'brokerConnections', 'auth.password');
}

module.exports = {
  init,
  isEncryptionAvailable: () => canEncrypt,
  isEncryptedString,
  getSecret,
  setSecret,
  migrateKnownSecrets,
  encryptArrayField,
  decryptArrayField
};
