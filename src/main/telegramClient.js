const store = require('./store');
const secretsVault = require('./secretsVault');

/** GramJS is heavy (~MiB parsed); load only when Telegram is used — avoids freezing startup. */
let gramCached = null;
function gram() {
  if (!gramCached) {
    const { TelegramClient } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const { NewMessage } = require('telegram/events');
    let EditedMessage = null;
    try { EditedMessage = require('telegram/events').EditedMessage; } catch (_) { EditedMessage = null; }
    gramCached = { TelegramClient, StringSession, NewMessage, EditedMessage };
  }
  return gramCached;
}

let client = null;
let messageHandlers = [];
/**
 * The client instance that GramJS event handlers are currently attached to.
 * setupMessageHandler() is called from several entry points (checkSession,
 * signIn, reconnect, …) and the renderer invokes checkSession from more than
 * one place. Without this guard each call would call client.addEventHandler
 * again on the same client, so every Telegram message would fire the pipeline
 * twice → two SIGNAL dispatches → two MT5 positions for one signal.
 */
let handlersAttachedClient = null;
/** chatId → display title; avoids await getEntity on every message (saves ~0.5–2s). */
const channelTitleById = new Map();

function rememberChannelTitle(id, title) {
  const key = id != null ? String(id) : '';
  const name = String(title || '').trim();
  if (key && name) channelTitleById.set(key, name);
}

// Built-in API credentials (Telegram Desktop)
const BUILTIN_API_ID = 2040;
const BUILTIN_API_HASH = 'b18441a1ff607e10a989891a5462e627';

function getApiCredentials() {
  return { apiId: BUILTIN_API_ID, apiHash: BUILTIN_API_HASH };
}

async function disconnectClient() {
  if (!client) return;
  try { await client.disconnect(); } catch (_) { /* noop */ }
  client = null;
  handlersAttachedClient = null;
}

async function getClient(forceNew = false) {
  if (client && !forceNew) return client;
  if (forceNew) await disconnectClient();
  const { TelegramClient, StringSession } = gram();
  const { apiId, apiHash } = getApiCredentials();
  if (!apiId || !apiHash) throw new Error('API_CREDENTIALS_MISSING');
  const savedSession = secretsVault.getSecret(store, 'telegramSession', '');
  const session = new StringSession(savedSession);
  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    useWSS: false,
    langCode: 'en',
  });
  handlersAttachedClient = null;
  await client.connect();
  return client;
}

async function checkSession() {
  try {
    const savedSession = secretsVault.getSecret(store, 'telegramSession', '');
    if (!savedSession) return { authenticated: false };
    const c = await getClient();
    const isAuthorized = await c.isUserAuthorized();
    if (isAuthorized) {
      const me = await c.getMe();
      setupMessageHandler(c);
      return { authenticated: true, user: { firstName: me.firstName, phone: me.phone } };
    }
    return { authenticated: false };
  } catch (e) {
    console.error('[Telegram] checkSession error:', e.message);
    return { authenticated: false, error: e.message };
  }
}

async function sendCode(phone) {
  try {
    const c = await getClient(true);
    const { apiId, apiHash } = getApiCredentials();
    const result = await c.sendCode({ apiId, apiHash }, phone);
    return { success: true, phoneCodeHash: result.phoneCodeHash };
  } catch (e) {
    console.error('[Telegram] sendCode error:', e.message);
    return { success: false, error: e.message };
  }
}

async function signIn(phone, phoneCodeHash, code) {
  try {
    const c = await getClient();
    await c.invoke(
      new (require('telegram/tl').Api.auth.SignIn)({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code.trim(),
      })
    );
    const sessionStr = c.session.save();
    secretsVault.setSecret(store, 'telegramSession', sessionStr);
    setupMessageHandler(c);
    return { success: true };
  } catch (e) {
    console.error('[Telegram] signIn error:', e.message);
    if (e.message && e.message.includes('SESSION_PASSWORD_NEEDED')) {
      return { success: false, needs2FA: true };
    }
    return { success: false, error: e.message };
  }
}

async function signInWith2FA(password) {
  try {
    const c = await getClient();
    // Get the SRP parameters for 2FA
    const pwdInfo = await c.invoke(new (require('telegram/tl').Api.account.GetPassword)());
    const { computeCheck } = require('telegram/Password');
    const pwdCheck = await computeCheck(pwdInfo, password);
    await c.invoke(new (require('telegram/tl').Api.auth.CheckPassword)({ password: pwdCheck }));
    const sessionStr = c.session.save();
    secretsVault.setSecret(store, 'telegramSession', sessionStr);
    setupMessageHandler(c);
    return { success: true };
  } catch (e) {
    console.error('[Telegram] 2FA error:', e.message);
    return { success: false, error: 'Incorrect password. Please try again.' };
  }
}

async function signOut() {
  try {
    stopHealthWatchdog();
    if (client) {
      try { await client.invoke(new (require('telegram/tl').Api.auth.LogOut)({})); } catch (_) {}
      await client.disconnect();
      client = null;
    }
    store.delete('telegramSession');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
    })
  ]);
}

async function getChannels(opts = {}) {
  const timeoutMs = Math.max(5000, Math.min(120000, Number(opts.timeoutMs) || 30000));
  const forceReconnect = !!opts.forceReconnect;
  try {
    const c = await withTimeout(getClient(forceReconnect), timeoutMs, 'TELEGRAM_CONNECT');
    const dialogs = await withTimeout(c.getDialogs({ limit: 200 }), timeoutMs, 'TELEGRAM_DIALOGS');
    const channels = dialogs
      .filter(d => d.isChannel || d.isGroup)
      .map(d => ({
        id: d.id ? d.id.toString() : String(Math.random()),
        name: d.title || d.name || 'Unknown',
        username: d.entity?.username || '',
        type: d.isChannel ? 'channel' : 'group',
      }));
    for (const ch of channels) rememberChannelTitle(ch.id, ch.name);
    return { success: true, channels };
  } catch (e) {
    console.error('[Telegram] getChannels error:', e.message);
    if (forceReconnect) await disconnectClient();
    return { success: false, error: e.message, channels: [] };
  }
}

/** Drop cached GramJS client so the next call reconnects from scratch. */
async function reconnect() {
  await disconnectClient();
  try {
    const c = await getClient(true);
    const isAuthorized = await c.isUserAuthorized();
    if (isAuthorized) setupMessageHandler(c);
    return { success: true, authenticated: isAuthorized };
  } catch (e) {
    console.error('[Telegram] reconnect error:', e.message);
    return { success: false, error: e.message, authenticated: false };
  }
}

function onMessage(handler) {
  messageHandlers.push(handler);
}

function removeAllMessageHandlers() {
  messageHandlers.length = 0;
}

async function dispatchMessage(c, message, { edited = false } = {}) {
  if (!message) return;
  const text = message.text || '';
  const hasPhoto = !!(message.photo || (message.media && message.media.photo));
  if (!text && !hasPhoto) return;
  const enabledChannels = store.get('enabledChannels', []);
  const chatId = message.chatId ? message.chatId.toString() : '';
  if (!enabledChannels.includes(chatId)) return;
  let channelName = channelTitleById.get(chatId) || chatId;
  if (!channelTitleById.has(chatId)) {
    try {
      const entity = await c.getEntity(message.chatId);
      const name = entity?.title || entity?.username || chatId;
      rememberChannelTitle(chatId, name);
      channelName = name;
    } catch (_) {
      /* keep chatId fallback */
    }
  }

  let imageBuffer = null;
  if (hasPhoto) {
    try { imageBuffer = await c.downloadMedia(message, {}); } catch (_) { imageBuffer = null; }
  }

  for (const handler of messageHandlers) {
    try {
      await handler(text, channelName, { imageBuffer, messageId: message.id, edited });
    } catch (err) {
      console.error('[Telegram] message handler error:', err?.message || err);
    }
  }
}

// ─── Session health watchdog ─────────────────────────────────────────────────
// MTProto user sessions can silently die (idle disconnects, network changes,
// session revoked from another device). A dead session means silently missed
// signals — the worst failure mode for a copier — so we probe and auto-reconnect.

const WATCHDOG_INTERVAL_MS = 30000;
const DEEP_PROBE_EVERY_TICKS = 10; // getMe() round-trip every ~5 min when connected
const RECONNECT_BACKOFF_MS = [30000, 60000, 120000, 300000];

let watchdogTimer = null;
let watchdogState = 'idle'; // 'idle' | 'ok' | 'reconnecting' | 'dead'
let watchdogTickRunning = false;
let deepProbeCounter = 0;
let reconnectAttempts = 0;
let nextReconnectAt = 0;
const sessionStateListeners = [];

function onSessionState(cb) {
  if (typeof cb === 'function') sessionStateListeners.push(cb);
}

function setSessionState(state, detail = '') {
  const prev = watchdogState;
  if (state === prev) return;
  watchdogState = state;
  // Silent on the very first healthy observation — nothing was lost.
  if (prev === 'idle' && state === 'ok') return;
  for (const cb of sessionStateListeners) {
    try { cb({ state, prev, detail, attempts: reconnectAttempts }); } catch (_) { /* noop */ }
  }
}

async function probeConnectionHealthy() {
  if (!client) return false;
  if (client.connected !== true) return false;
  deepProbeCounter += 1;
  if (deepProbeCounter < DEEP_PROBE_EVERY_TICKS && watchdogState === 'ok') return true;
  deepProbeCounter = 0;
  await withTimeout(client.getMe(), 10000, 'TELEGRAM_PROBE');
  return true;
}

async function watchdogTick() {
  if (watchdogTickRunning) return;
  watchdogTickRunning = true;
  try {
    const savedSession = secretsVault.getSecret(store, 'telegramSession', '');
    if (!savedSession || !client) return; // not logged in / not started this run

    let healthy = false;
    let probeError = '';
    try {
      healthy = await probeConnectionHealthy();
    } catch (e) {
      healthy = false;
      probeError = e?.message || String(e);
    }

    if (healthy) {
      reconnectAttempts = 0;
      nextReconnectAt = 0;
      setSessionState('ok');
      return;
    }

    setSessionState('reconnecting', probeError);
    if (Date.now() < nextReconnectAt) return;
    const backoff = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)];
    reconnectAttempts += 1;
    nextReconnectAt = Date.now() + backoff;

    const result = await reconnect();
    if (result.success && result.authenticated) {
      reconnectAttempts = 0;
      nextReconnectAt = 0;
      setSessionState('ok');
    } else if (result.success && !result.authenticated) {
      // Connected but no longer authorized — session revoked; re-login required.
      setSessionState('dead', 'SESSION_UNAUTHORIZED');
    } else {
      setSessionState('reconnecting', result.error || 'RECONNECT_FAILED');
    }
  } finally {
    watchdogTickRunning = false;
  }
}

function startHealthWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => { void watchdogTick(); }, WATCHDOG_INTERVAL_MS);
}

function stopHealthWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  watchdogState = 'idle';
  reconnectAttempts = 0;
  nextReconnectAt = 0;
}

function setupMessageHandler(c) {
   // Attach GramJS event handlers at most once per client instance. Re-attaching
   // on the same client (checkSession is called from multiple places) would make
   // every Telegram message dispatch the pipeline N times → duplicate MT5 orders.
   if (handlersAttachedClient === c) return;
   const { NewMessage, EditedMessage } = gram();
   c.addEventHandler((event) => dispatchMessage(c, event.message, { edited: false }), new NewMessage({}));
   if (EditedMessage) {
      c.addEventHandler((event) => dispatchMessage(c, event.message, { edited: true }), new EditedMessage({}));
   }
   handlersAttachedClient = c;
}

module.exports = {
  checkSession,
  sendCode,
  signIn,
  signInWith2FA,
  signOut,
  getChannels,
  reconnect,
  disconnectClient,
  onMessage,
  removeAllMessageHandlers,
  getClient,
  onSessionState,
  startHealthWatchdog,
  stopHealthWatchdog,
};




