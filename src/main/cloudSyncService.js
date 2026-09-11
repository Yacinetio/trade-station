/**
 * Push read-only mirror to cloud relay for Flutter/mobile (see cloud/schema.sql, cloud/functions/mobile-ingest).
 * Tenancy: store key `mobileSync` = { enabled, ingestUrl, secret }. secret is plain Bearer token; tenant_id = sha256(secret).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let secretsVault = null;
try { secretsVault = require('./secretsVault'); } catch (_) { secretsVault = null; }
function decryptSecretValue(value) {
  if (!value || !secretsVault) return value || '';
  if (typeof value !== 'string') return '';
  if (!secretsVault.isEncryptedString(value)) return value;
  try {
    const fakeStore = { get: () => value, set: () => {} };
    return secretsVault.getSecret(fakeStore, '__inline__', '');
  } catch (_) {
    return '';
  }
}

const MAX_QUEUE = 6000;
const FLUSH_INTERVAL_MS = 4000;
const FUNDAMENTALS_MIN_INTERVAL_MS = 120000;
const INGEST_BATCH = 72;

/** Skip very large screenshots so ingest JSON stays reasonable (mobile decodes dataUrl). */
const MAX_SCREENSHOT_BYTES = 480 * 1024;
const MAX_SCREENSHOTS_WITH_EMBED = 8;

/**
 * Deep-clone a trade and attach data:image/...;base64 for local screenshot files so mobile can render them.
 * @param {Record<string, unknown>} trade
 */
function embedTradeScreenshotsForCloud(trade) {
  const t = JSON.parse(JSON.stringify(trade));
  const shots = t.screenshots;
  if (!Array.isArray(shots) || shots.length === 0) return t;
  let embedded = 0;
  for (const shot of shots) {
    if (!shot || typeof shot !== 'object') continue;
    if (embedded >= MAX_SCREENSHOTS_WITH_EMBED) break;
    const existing = shot.dataUrl || shot.imageDataUrl;
    if (typeof existing === 'string' && existing.trim().startsWith('data:image')) {
      embedded += 1;
      continue;
    }
    const rawPath = String(shot.path || shot.file || shot.absolutePath || '').trim();
    if (!rawPath) continue;
    try {
      if (!fs.existsSync(rawPath)) continue;
      const buf = fs.readFileSync(rawPath);
      if (!buf.length || buf.length > MAX_SCREENSHOT_BYTES) continue;
      const ext = path.extname(rawPath).toLowerCase();
      let mime = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
      else if (ext === '.webp') mime = 'image/webp';
      else if (ext === '.gif') mime = 'image/gif';
      shot.dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      embedded += 1;
    } catch (_) {
      /* missing permissions / bad path */
    }
  }
  return t;
}

/** @type {import('electron-store') | null} */
let storeRef = null;
/** @returns {boolean} */
let licensedRef = () => false;

/** @type {unknown[]} */
let queue = [];
let flushTimer = null;
let fundamentalsTimer = 0;

function getConfig() {
  if (!storeRef) return { enabled: false, ingestUrl: '', secret: '' };
  const raw = storeRef.get('mobileSync', {});
  const rawSecret = String(raw.secret || '');
  const secret = secretsVault && secretsVault.isEncryptedString(rawSecret)
    ? decryptSecretValue(rawSecret)
    : rawSecret.trim();
  return {
    enabled: raw.enabled === true,
    ingestUrl: String(raw.ingestUrl || '').trim(),
    secret
  };
}

function shouldRun() {
  const c = getConfig();
  return c.enabled && Boolean(c.ingestUrl) && Boolean(c.secret) && licensedRef();
}

function enqueue(op) {
  if (!shouldRun()) return;
  let out = op;
  if (out && out.type === 'trade_upsert' && out.trade && typeof out.trade === 'object') {
    out = {
      ...out,
      trade: embedTradeScreenshotsForCloud(out.trade)
    };
  }
  queue.push(out);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
}

function normalizeAccountIdentity(raw = {}) {
  const login = String(
    raw.login ?? raw.account ?? raw.accountNumber ?? raw.accountId ?? ''
  ).trim();
  const server = String(raw.server ?? raw.broker ?? '').trim();
  const name = String(raw.name ?? raw.accountName ?? '').trim();
  const key = login ? (server ? `${login}@${server}` : login) : '';
  return { key, login, server, name };
}

function bestAccountFromAck(ack = {}, fallback = null) {
  const fromAck = normalizeAccountIdentity(ack);
  if (fromAck.key) return fromAck;
  const t = ack && ack.trade ? ack.trade : {};
  const fromTrade = normalizeAccountIdentity(t);
  if (fromTrade.key) return fromTrade;
  return fallback && fallback.key ? fallback : normalizeAccountIdentity();
}

const INGEST_TIMEOUT_MS = 12000;

async function flushOnce() {
  const { enabled, ingestUrl, secret } = getConfig();
  if (!enabled || !ingestUrl || !secret || !licensedRef()) {
    queue = [];
    return;
  }
  if (queue.length === 0) return;
  const batch = queue.splice(0, INGEST_BATCH);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`
      },
      body: JSON.stringify({ ops: batch }),
      signal: controller.signal
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn('[cloudSync] ingest failed', res.status, t.slice(0, 200));
      queue.unshift(...batch);
    }
  } catch (e) {
    const reason = e?.name === 'AbortError' ? `timeout after ${INGEST_TIMEOUT_MS}ms` : (e?.message || e);
    console.warn('[cloudSync] ingest error', reason);
    queue.unshift(...batch);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ store: import('electron-store'), isLicensed: () => boolean }} opts
 */
function init(opts) {
  storeRef = opts.store;
  licensedRef = typeof opts.isLicensed === 'function' ? opts.isLicensed : () => false;
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    flushOnce().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

/**
 * Ensure a random pairing secret exists (store).
 * @returns {string}
 */
function ensureSecret() {
  if (!storeRef) return '';
  const raw = storeRef.get('mobileSync', {});
  const existing = String(raw.secret || '');
  if (existing) {
    const decrypted = secretsVault && secretsVault.isEncryptedString(existing)
      ? decryptSecretValue(existing)
      : existing;
    if (decrypted && decrypted.length >= 24) return decrypted;
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  const persisted = secretsVault ? (function persistEncrypted() {
    try {
      const tmp = { _v: '' };
      const fakeStore = { get: () => tmp._v, set: (_k, v) => { tmp._v = v; } };
      secretsVault.setSecret(fakeStore, '__inline__', secret);
      return tmp._v || secret;
    } catch (_) { return secret; }
  })() : secret;
  storeRef.set('mobileSync', { ...raw, secret: persisted });
  return secret;
}

function getStatus() {
  const c = getConfig();
  return {
    enabled: c.enabled,
    hasIngestUrl: Boolean(c.ingestUrl),
    hasSecret: Boolean(c.secret),
    queueLength: queue.length,
    licensed: licensedRef()
  };
}

/**
 * @param {Record<string, unknown>} patch
 */
function setConfig(patch = {}) {
  if (!storeRef) return { success: false };
  const cur = storeRef.get('mobileSync', {});
  let nextSecret = cur.secret;
  if (patch.secret !== undefined) {
    const plain = String(patch.secret || '').trim();
    if (!plain) {
      nextSecret = '';
    } else if (secretsVault) {
      try {
        const tmp = { _v: '' };
        const fakeStore = { get: () => tmp._v, set: (_k, v) => { tmp._v = v; } };
        secretsVault.setSecret(fakeStore, '__inline__', plain);
        nextSecret = tmp._v || plain;
      } catch (_) {
        nextSecret = plain;
      }
    } else {
      nextSecret = plain;
    }
  }
  const next = {
    ...cur,
    ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
    ...(patch.ingestUrl !== undefined ? { ingestUrl: String(patch.ingestUrl || '').trim() } : {}),
    ...(patch.secret !== undefined ? { secret: nextSecret } : {})
  };
  storeRef.set('mobileSync', next);
  return { success: true, config: getStatus() };
}

/**
 * @param {string} event
 * @param {unknown} data
 * @param {{ getCurrentAccount?: () => { key?: string, login?: string, server?: string, name?: string } | null, getTcpStatus?: () => { connected?: boolean } }} ctx
 */
function handleBridgeEvent(event, data, ctx = {}) {
  const getCurrentAccount = ctx.getCurrentAccount || (() => null);
  const getTcpStatus = ctx.getTcpStatus || (() => ({ connected: false }));

  if (event === 'connection:status') {
    const d = data || {};
    enqueue({
      type: 'event',
      kind: 'MT5_CONNECTION',
      payload: { mt5: d.mt5, fileBridge: d.fileBridge, fileHandshake: d.fileHandshake }
    });
    return;
  }

  if (event === 'mt5:hello') {
    const msg = data || {};
    const id = normalizeAccountIdentity(msg);
    if (id.key) {
      enqueue({
        type: 'account_upsert',
        account_key: id.key,
        login: id.login,
        server: id.server,
        name: id.name
      });
    }
    return;
  }

  if (event === 'trade:ack') {
    const ack = data || {};
    if (ack.status === 'ACCOUNT_SNAPSHOT') {
      const id = bestAccountFromAck(ack, getCurrentAccount());
      enqueue({
        type: 'account_upsert',
        account_key: id.key || 'unknown',
        login: id.login,
        server: id.server,
        name: id.name
      });
      enqueue({
        type: 'snapshot',
        account_key: id.key || 'unknown',
        captured_at: new Date().toISOString(),
        balance: typeof ack.balance === 'number' ? ack.balance : Number(ack.balance),
        equity: typeof ack.equity === 'number' ? ack.equity : Number(ack.equity),
        margin: typeof ack.margin === 'number' ? ack.margin : Number(ack.margin),
        free_margin: typeof ack.freeMargin === 'number' ? ack.freeMargin : Number(ack.freeMargin),
        profit: typeof ack.profit === 'number' ? ack.profit : Number(ack.profit),
        mt5_connected: Boolean(getTcpStatus().connected),
        raw: {
          status: ack.status,
          account: id
        }
      });
    }
  }
}

/**
 * @param {Record<string, unknown>} trade
 */
function notifyTrade(trade) {
  if (!trade || !trade.id) return;
  enqueue({
    type: 'trade_upsert',
    trade_id: String(trade.id),
    account_key: String(trade.accountKey || 'unknown'),
    trade
  });
}

/** Enqueue upserts for all local trades (e.g. after enabling mobile sync or on license unlock). */
function notifyAllTrades(trades) {
  if (!Array.isArray(trades)) return;
  for (const trade of trades) notifyTrade(trade);
}

function tradeToSignalMirror(trade) {
  if (!trade || typeof trade !== 'object') return {};
  const t = trade;
  return {
    symbol: t.symbol,
    type: t.type,
    orderType: t.orderType,
    entry: t.entry,
    ...(t.avgEntry != null && Number(t.avgEntry) > 0 ? { avgEntry: t.avgEntry } : {}),
    ...(t.signalEntry != null && Number(t.signalEntry) > 0 ? { signalEntry: t.signalEntry } : {}),
    sl: t.sl,
    tp: t.tp,
    lot: t.lot,
    channel: t.channel,
    status: t.status,
    bias: t.bias,
    timeframe: t.timeframe,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    profit: t.profit,
    accountKey: t.accountKey,
    blockedReason: t.blockedReason
  };
}

/** Mirror each stored trade as a telegram row (deduped by mirror_key trade:ID) so mobile sees signal history.
 * Telegram-originated trades already have a `tg:` row from notifySignal — skip to avoid duplicate feed/DB rows.
 */
function notifyTelegramMirrorFromTrades(trades) {
  if (!Array.isArray(trades)) return;
  for (const trade of trades) {
    if (!trade || trade.id == null) continue;
    if (trade.fromTelegramSignal === true) continue;
    const mirrorKey = `trade:${trade.id}`;
    enqueue({
      type: 'telegram',
      mirror_key: mirrorKey,
      channel: String(trade.channel || ''),
      message_id: mirrorKey,
      received_at: trade.openedAt || trade.lastUpdateAt || new Date().toISOString(),
      signal: tradeToSignalMirror(trade),
      raw_preview: String(trade.blockedReason || '').slice(0, 500)
    });
  }
}

/**
 * @param {Array<{ key?: string, login?: string, server?: string, name?: string }>} accounts
 */
function notifyAllKnownAccounts(accounts) {
  if (!Array.isArray(accounts)) return;
  for (const acc of accounts) {
    if (!acc || !acc.key) continue;
    enqueue({
      type: 'account_upsert',
      account_key: String(acc.key),
      login: acc.login || '',
      server: acc.server || '',
      name: acc.name || ''
    });
  }
}

/** Last persisted MT5 snapshot from store (balance/equity) so mobile gets a row without live EA. */
function notifyPersistedMt5Snapshot(snap, mt5Connected) {
  if (!snap || typeof snap !== 'object') return;
  const key = String(snap.accountKey || 'unknown');
  if (key === 'unknown' && !snap.accountLogin) return;
  enqueue({
    type: 'account_upsert',
    account_key: key,
    login: String(snap.accountLogin || ''),
    server: String(snap.accountServer || ''),
    name: String(snap.accountName || '')
  });
  enqueue({
    type: 'snapshot',
    account_key: key,
    captured_at: snap.time || new Date().toISOString(),
    balance: typeof snap.balance === 'number' ? snap.balance : Number(snap.balance),
    equity: typeof snap.equity === 'number' ? snap.equity : Number(snap.equity),
    margin: typeof snap.margin === 'number' ? snap.margin : Number(snap.margin),
    free_margin: typeof snap.freeMargin === 'number' ? snap.freeMargin : Number(snap.freeMargin),
    profit: null,
    mt5_connected: Boolean(mt5Connected),
    raw: { source: 'persisted_mt5_snapshot' }
  });
}

/**
 * Full mirror: accounts, snapshot, trades, trade→telegram mirror rows.
 * @param {{ trades?: unknown[], knownAccounts?: unknown[], mt5Snapshot?: unknown, mt5Connected?: boolean }} payload
 */
function pushFullMirror(payload = {}) {
  const { trades, knownAccounts, mt5Snapshot, mt5Connected } = payload;
  notifyAllKnownAccounts(Array.isArray(knownAccounts) ? knownAccounts : []);
  notifyPersistedMt5Snapshot(mt5Snapshot, mt5Connected);
  notifyAllTrades(Array.isArray(trades) ? trades : []);
  notifyTelegramMirrorFromTrades(Array.isArray(trades) ? trades : []);
}

/**
 * @param {Record<string, unknown>} signal
 * @param {string} channelName
 */
function notifySignal(signal, channelName = '') {
  const ch = String(channelName || signal.channel || '');
  const mid = signal.id != null ? String(signal.id) : String(signal.messageId || '').trim();
  const mirrorKey = mid ? `tg:${ch}:${mid}` : `tg:${ch}:${Date.now()}`;
  enqueue({
    type: 'telegram',
    mirror_key: mirrorKey,
    channel: ch,
    message_id: mid || mirrorKey,
    received_at: new Date().toISOString(),
    signal: JSON.parse(JSON.stringify(signal)),
    raw_preview: ''
  });
}

/**
 * @param {Record<string, unknown>} dashboard
 * @param {{ force?: boolean }} opts
 */
function notifyFundamentalsDashboard(dashboard, opts) {
  const force = opts && opts.force === true;
  const now = Date.now();
  if (!force && now - fundamentalsTimer < FUNDAMENTALS_MIN_INTERVAL_MS) return;
  fundamentalsTimer = now;
  enqueue({
    type: 'fundamentals',
    payload: JSON.parse(JSON.stringify(dashboard || {}))
  });
}

function rotatePairingSecret() {
  if (!storeRef) return '';
  const raw = storeRef.get('mobileSync', {});
  const secret = crypto.randomBytes(32).toString('base64url');
  storeRef.set('mobileSync', { ...raw, secret });
  return secret;
}

module.exports = {
  init,
  ensureSecret,
  rotatePairingSecret,
  getStatus,
  setConfig,
  handleBridgeEvent,
  embedTradeScreenshotsForCloud,
  notifyTrade,
  notifyAllTrades,
  notifyAllKnownAccounts,
  notifyTelegramMirrorFromTrades,
  notifyPersistedMt5Snapshot,
  pushFullMirror,
  notifySignal,
  notifyFundamentalsDashboard,
  flushOnce
};
