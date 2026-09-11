const net = require('net');
const { randomUUID } = require('crypto');

let server = null;
let activeSocket = null;
let mt5Connected = false;
let emitter = null;
let pendingSignals = [];
/** @type {Map<string, { finish: function, timer: NodeJS.Timeout }>} */
const historyWaiters = new Map();
/** @type {Map<string, { finish: function, timer: NodeJS.Timeout }>} */
const spreadWaiters = new Map();
/** @type {Map<string, { finish: function, timer: NodeJS.Timeout }>} */
const diagWaiters = new Map();

/** @type {null | ((line: string) => void)} */
let fileOutboundAppender = null;
let fileTransportHandshakeOk = false;
let lastEaHeartbeatMs = 0;
let lastSettingsUpdateMs = 0;
let lastSettingsHash = '';

/** Avoid spamming renderer; emit when mt5 / file bridge flags change */
let lastEmittedConn = { mt5: undefined, fileBridge: undefined, fileHandshake: undefined };

const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TIMEOUT = 15000;

const DEFAULT_PORT = 9999;
/** Loopback by default: the EA runs on the same machine; never expose the unauthenticated trade port on LAN. */
const DEFAULT_BIND_HOST = '127.0.0.1';
/** Queued signals older than this are dropped on flush instead of executing at a stale price. */
const DEFAULT_QUEUE_TTL_MS = 120000;
const DEFAULT_MAX_QUEUE = 50;
const DROPPED_SIGNALS_KEPT = 20;

let bindHost = DEFAULT_BIND_HOST;
let listenPort = DEFAULT_PORT;
let queueTtlMs = DEFAULT_QUEUE_TTL_MS;
let maxQueue = DEFAULT_MAX_QUEUE;
/**
 * Optional shared secret. When set, a client socket is only promoted to the
 * active EA connection after a HELLO carrying the matching `secret` field;
 * anything else is rejected. Empty = legacy behavior (no auth) so existing
 * EA installs keep working until the user opts in.
 */
let sharedSecret = '';
let authFailureCount = 0;
let listenRetryTimer = null;
let droppedSignalCount = 0;
/** Most recent dropped queue entries (newest last), surfaced via getStatus(). */
let droppedSignals = [];

/**
 * Drop one queued signal and propagate the failure through the same paths used
 * for send failures: the per-signal dispatch callback (main.js routes this into
 * applyTradeDispatchCallback) plus a bridge event for observability.
 * reason: 'QUEUE_EXPIRED' (TTL exceeded) | 'QUEUE_OVERFLOW' (oldest evicted at cap).
 */
function notifyDroppedSignal(ps, reason) {
  droppedSignalCount += 1;
  droppedSignals.push({
    reason,
    droppedAt: Date.now(),
    queuedAt: ps.queuedAt || ps.time || null,
    type: ps.signal?.type || '',
    symbol: ps.signal?.symbol || '',
    tradeId: ps.signal?.tradeId || null
  });
  if (droppedSignals.length > DROPPED_SIGNALS_KEPT) {
    droppedSignals = droppedSignals.slice(-DROPPED_SIGNALS_KEPT);
  }
  console.log('[TCP] Queued signal dropped (' + reason + '):', ps.signal?.type, ps.signal?.symbol);
  try {
    if (ps.callback) ps.callback({ status: reason, reason });
  } catch (_) {}
  if (emitter) {
    emitter('signal:dropped', {
      reason,
      signal: ps.signal,
      queuedAt: ps.queuedAt || ps.time || null
    });
  }
}

/** Remove queued signals older than queueTtlMs so they never execute at a stale price. */
function pruneExpiredQueuedSignals(now = Date.now()) {
  if (pendingSignals.length === 0) return;
  const kept = [];
  for (const ps of pendingSignals) {
    const age = now - (ps.queuedAt || ps.time || now);
    if (age > queueTtlMs) {
      notifyDroppedSignal(ps, 'QUEUE_EXPIRED');
    } else {
      kept.push(ps);
    }
  }
  pendingSignals = kept;
}

function flushSpreadWaiters(reason = 'MT5_DISCONNECTED') {
  for (const [, w] of spreadWaiters) {
    try {
      clearTimeout(w.timer);
      w.finish({ success: false, error: reason, spreadPips: 0 });
    } catch (_) {}
  }
  spreadWaiters.clear();
  for (const [, w] of diagWaiters) {
    try {
      clearTimeout(w.timer);
      w.finish({ success: false, error: reason });
    } catch (_) {}
  }
  diagWaiters.clear();
}

function flushHistoryWaiters(reason = 'MT5_DISCONNECTED') {
  flushSpreadWaiters(reason);
  for (const [, w] of historyWaiters) {
    try {
      clearTimeout(w.timer);
      w.finish({ success: false, error: reason, bars: [] });
    } catch (_) {}
  }
  historyWaiters.clear();
}

function tcpSocketWritable() {
  return Boolean(activeSocket && !activeSocket.destroyed && activeSocket.writable);
}

function recordEaHeartbeat() {
  lastEaHeartbeatMs = Date.now();
}

function recordSettingsUpdate(settings = {}) {
  lastSettingsUpdateMs = Date.now();
  try {
    const crypto = require('crypto');
    lastSettingsHash = crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0, 12);
  } catch (_) {
    lastSettingsHash = '';
  }
}

function getEaHealth() {
  const ageMs = lastEaHeartbeatMs ? Date.now() - lastEaHeartbeatMs : null;
  return {
    connected: mt5Connected,
    lastHeartbeatMs: lastEaHeartbeatMs || null,
    lastHeartbeatAgeSec: ageMs != null ? Math.round(ageMs / 1000) : null,
    heartbeatStale: ageMs != null ? ageMs > HEARTBEAT_TIMEOUT : !mt5Connected,
    lastSettingsUpdateMs: lastSettingsUpdateMs || null,
    settingsHash: lastSettingsHash || '',
  };
}

function emitConnectionStatusIfChanged() {
  const payload = {
    mt5: mt5Connected,
    fileBridge: Boolean(fileOutboundAppender),
    fileHandshake: fileTransportHandshakeOk
  };
  if (
    payload.mt5 === lastEmittedConn.mt5 &&
    payload.fileBridge === lastEmittedConn.fileBridge &&
    payload.fileHandshake === lastEmittedConn.fileHandshake
  ) {
    return;
  }
  lastEmittedConn = {
    mt5: payload.mt5,
    fileBridge: payload.fileBridge,
    fileHandshake: payload.fileHandshake
  };
  if (emitter) emitter('connection:status', payload);
}

function refreshMt5Connected() {
  const tcpReady = tcpSocketWritable();
  mt5Connected = tcpReady || fileTransportHandshakeOk;
  emitConnectionStatusIfChanged();
}

function removeSocket(socket) {
  if (activeSocket === socket) {
    activeSocket = null;
    flushHistoryWaiters();
    refreshMt5Connected();
  }
  try { socket.destroy(); } catch (_) {}
}

/** Deliver one newline-terminated JSON line to TCP client (if any) and/or file bridge appender. */
function deliverOutbound(line) {
  let ok = false;
  if (tcpSocketWritable()) {
    try {
      activeSocket.write(line);
      ok = true;
    } catch (e) {
      console.error('[TCP] Socket write error:', e.message);
      removeSocket(activeSocket);
    }
  }
  if (fileOutboundAppender) {
    try {
      fileOutboundAppender(line);
      ok = true;
    } catch (e) {
      console.error('[TCP] File outbound error:', e.message);
    }
  }
  return ok;
}

function flushPendingSignalsQueue() {
  pruneExpiredQueuedSignals();
  if (pendingSignals.length === 0) return;
  console.log('[TCP] Flushing', pendingSignals.length, 'queued signal(s)');
  const kept = [];
  for (const ps of pendingSignals) {
    if (deliverOutbound(ps.payload)) {
      if (ps.callback) ps.callback({ status: 'DISPATCHED' });
    } else {
      kept.push(ps);
      if (ps.callback) ps.callback({ status: 'WRITE_FAILED' });
    }
  }
  pendingSignals = kept;
}

/**
 * @param {string} trimmed one JSON line
 * @param {null | ((line: string) => void)} replyFn HELLO_ACK sink (TCP socket or file append)
 * @param {{ viaFile?: boolean }} meta set viaFile when line came from MT4 file bridge
 */
function processInboundLine(trimmed, replyFn = null, meta = {}) {
  const viaFile = meta.viaFile === true;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.type === 'HELLO') {
      console.log('[TCP] HELLO from EA:', msg.ea, 'v' + msg.version, 'acc:', msg.account);
      if (viaFile) fileTransportHandshakeOk = true;
      refreshMt5Connected();
      if (emitter) emitter('mt5:hello', msg);
      const ack = JSON.stringify({ type: 'HELLO_ACK', status: 'OK' }) + '\n';
      if (replyFn) {
        try { replyFn(ack); } catch (_) {}
      } else if (tcpSocketWritable()) {
        try { activeSocket.write(ack); } catch (_) {}
      }
      flushPendingSignalsQueue();
      return;
    }
    if (msg.type === 'PONG') {
      return;
    }
    if (msg.type === 'ACK') {
      if (emitter) emitter('trade:ack', msg);
      return;
    }
    if (msg.type === 'PARTIAL_CLOSE') {
      if (emitter) emitter('trade:partialClose', msg);
      return;
    }
    if (msg.type === 'HISTORY_REPLY') {
      const reqId = msg.reqId;
      const w = reqId ? historyWaiters.get(reqId) : null;
      if (w) {
        clearTimeout(w.timer);
        historyWaiters.delete(reqId);
        if (msg.success && Array.isArray(msg.bars)) {
          w.finish({ success: true, bars: msg.bars, source: 'mt5' });
        } else {
          w.finish({ success: false, error: msg.error || 'HISTORY_FAILED', bars: [] });
        }
      }
      return;
    }
    if (msg.type === 'DIAG_REPLY') {
      const reqId = msg.reqId;
      const w = reqId ? diagWaiters.get(reqId) : null;
      if (w) {
        clearTimeout(w.timer);
        diagWaiters.delete(reqId);
        w.finish({ success: true, ...msg });
      }
      return;
    }
    if (msg.type === 'SPREAD_REPLY') {
      const reqId = msg.reqId;
      const w = reqId ? spreadWaiters.get(reqId) : null;
      if (w) {
        clearTimeout(w.timer);
        spreadWaiters.delete(reqId);
        const spreadPips = Number(msg.spreadPips);
        const usdPerPipPerLot = Number(msg.usdPerPipPerLot);
        const hasSpread = msg.success && Number.isFinite(spreadPips) && spreadPips > 0;
        const hasPipVal = Number.isFinite(usdPerPipPerLot) && usdPerPipPerLot > 0;
        if (msg.success && (hasSpread || hasPipVal)) {
          w.finish({
            success: true,
            spreadPips: hasSpread ? spreadPips : 0,
            usdPerPipPerLot: hasPipVal ? usdPerPipPerLot : 0,
            symbol: msg.symbol || '',
            ask: msg.ask,
            bid: msg.bid,
            source: 'mt5'
          });
        } else {
          w.finish({
            success: false,
            error: msg.error || 'SPREAD_FAILED',
            spreadPips: 0,
            symbol: msg.symbol || ''
          });
        }
      }
      return;
    }
  } catch (e) {
    console.error('[TCP] Parse error:', e.message, '| raw:', trimmed.slice(0, 80));
  }
}

function setFileOutboundAppender(fn) {
  fileOutboundAppender = typeof fn === 'function' ? fn : null;
  if (!fileOutboundAppender) fileTransportHandshakeOk = false;
  refreshMt5Connected();
}

/**
 * @param {(event: string, data: any) => void} emit
 * @param {{ bindHost?: string, port?: number, queueTtlMs?: number, maxQueue?: number }} [options]
 *   bindHost defaults to 127.0.0.1 (loopback only). Pass e.g. '0.0.0.0' explicitly
 *   to expose on LAN — caller (main.js settings) owns that decision.
 */
function start(emit, options = {}) {
  emitter = emit;
  bindHost = typeof options.bindHost === 'string' && options.bindHost.trim()
    ? options.bindHost.trim()
    : DEFAULT_BIND_HOST;
  listenPort = Number.isInteger(options.port) && options.port >= 0 ? options.port : DEFAULT_PORT;
  queueTtlMs = Number.isFinite(options.queueTtlMs) && options.queueTtlMs > 0 ? options.queueTtlMs : DEFAULT_QUEUE_TTL_MS;
  maxQueue = Number.isInteger(options.maxQueue) && options.maxQueue > 0 ? options.maxQueue : DEFAULT_MAX_QUEUE;
  sharedSecret = typeof options.sharedSecret === 'string' ? options.sharedSecret.trim() : '';
  if (server) {
    console.log('[TCP] Bridge already running — start() skipped');
    return;
  }

  server = net.createServer((socket) => {
    const requireAuth = !!sharedSecret;
    let authed = !requireAuth;

    const promoteSocket = () => {
      if (activeSocket && activeSocket !== socket && !activeSocket.destroyed) {
        console.log('[TCP] New EA — closing previous socket');
        try { activeSocket.destroy(); } catch (_) {}
      }
      activeSocket = socket;
      refreshMt5Connected();
    };

    if (!requireAuth) {
      // Legacy path: first connection wins immediately.
      promoteSocket();
      console.log('[TCP] MT5 EA connected from', socket.remoteAddress);
    } else {
      console.log('[TCP] Client connected from', socket.remoteAddress, '— awaiting authenticated HELLO');
    }

    socket.setKeepAlive(true, 3000);
    socket.setNoDelay(true);
    socket.setTimeout(30000);

    let recvBuf = '';
    let lastPong = Date.now();
    let pingTimer = null;

    pingTimer = setInterval(() => {
      if (!socket.writable || socket.destroyed) {
        clearInterval(pingTimer);
        removeSocket(socket);
        return;
      }
      if (Date.now() - lastPong > HEARTBEAT_TIMEOUT) {
        console.log('[TCP] Heartbeat timeout — removing dead socket');
        clearInterval(pingTimer);
        removeSocket(socket);
        return;
      }
      try { socket.write(JSON.stringify({ type: 'PING' }) + '\n'); }
      catch (e) {
        clearInterval(pingTimer);
        removeSocket(socket);
      }
    }, HEARTBEAT_INTERVAL);

    if (!requireAuth) flushPendingSignalsQueue();

    /** @returns {boolean} true when the line may proceed to normal processing */
    const authenticateLine = (trimmed) => {
      if (authed) return true;
      let msg = null;
      try { msg = JSON.parse(trimmed); } catch (_) { msg = null; }
      const offeredSecret = typeof msg?.secret === 'string' ? msg.secret : '';
      if (msg?.type === 'HELLO' && offeredSecret && offeredSecret === sharedSecret) {
        authed = true;
        promoteSocket();
        console.log('[TCP] EA authenticated from', socket.remoteAddress);
        return true;
      }
      authFailureCount += 1;
      console.warn('[TCP] Rejected unauthenticated client from', socket.remoteAddress);
      if (emitter) {
        emitter('bridge:authFailed', {
          remoteAddress: socket.remoteAddress || '',
          reason: msg?.type === 'HELLO' ? 'BAD_SECRET' : 'NO_HELLO',
          count: authFailureCount
        });
      }
      try { socket.write(JSON.stringify({ type: 'HELLO_ACK', status: 'AUTH_FAILED' }) + '\n'); } catch (_) {}
      clearInterval(pingTimer);
      try { socket.destroy(); } catch (_) {}
      return false;
    };

    socket.on('data', (data) => {
      recvBuf += data.toString();
      const lines = recvBuf.split('\n');
      recvBuf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!authenticateLine(trimmed)) return;
        lastPong = Date.now();
        recordEaHeartbeat();
        processInboundLine(trimmed, (ln) => {
          try { socket.write(ln); } catch (_) {}
        }, { viaFile: false });
      }
    });

    socket.on('close', () => {
      clearInterval(pingTimer);
      if (activeSocket === socket) {
        activeSocket = null;
        console.log('[TCP] EA disconnected');
        refreshMt5Connected();
      }
    });

    socket.on('error', (err) => {
      clearInterval(pingTimer);
      console.error('[TCP] Socket error:', err.message);
      removeSocket(socket);
    });

    socket.on('timeout', () => {
      console.log('[TCP] Socket timeout');
      clearInterval(pingTimer);
      removeSocket(socket);
    });
  });

  server.listen(listenPort, bindHost, () => {
    const addr = server.address();
    const actualPort = addr && typeof addr === 'object' ? addr.port : listenPort;
    console.log(`[TCP] Bridge listening on ${bindHost}:${actualPort}`);
    if (emitter) emitter('tcp:port', { port: actualPort, host: bindHost });
    emitConnectionStatusIfChanged();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[TCP] ❌ Port ${listenPort} in use — retrying in 3 s`);
      listenRetryTimer = setTimeout(() => {
        listenRetryTimer = null;
        if (!server) return;
        try { server.close(); } catch (_) {}
        server.listen(listenPort, bindHost);
      }, 3000);
    } else {
      console.error('[TCP] Server error:', err.message);
    }
  });
}

/** Close server + socket and reset transient state. Safe to call repeatedly (shutdown/tests). */
function stop() {
  if (listenRetryTimer) {
    clearTimeout(listenRetryTimer);
    listenRetryTimer = null;
  }
  if (activeSocket) {
    try { activeSocket.destroy(); } catch (_) {}
    activeSocket = null;
  }
  if (server) {
    try { server.close(); } catch (_) {}
    server = null;
  }
  flushHistoryWaiters('BRIDGE_STOPPED');
  pendingSignals = [];
  droppedSignals = [];
  droppedSignalCount = 0;
  mt5Connected = false;
  fileTransportHandshakeOk = false;
  authFailureCount = 0;
  lastEmittedConn = { mt5: undefined, fileBridge: undefined, fileHandshake: undefined };
  emitter = null;
}

function sendSignal(signal, callback) {
  const payload = JSON.stringify({ type: 'SIGNAL', signal }) + '\n';

  if (!deliverOutbound(payload)) {
    refreshMt5Connected();
    pruneExpiredQueuedSignals();
    const now = Date.now();
    pendingSignals.push({ payload, signal, callback, time: now, queuedAt: now });
    while (pendingSignals.length > maxQueue) {
      notifyDroppedSignal(pendingSignals.shift(), 'QUEUE_OVERFLOW');
    }
    console.log('[TCP] MT5 offline — signal queued (queue:', pendingSignals.length, ')');
    if (callback) callback({ status: 'NO_MT5_QUEUED' });
    return;
  }

  console.log('[TCP] Signal sent:', signal.type, signal.symbol);
  if (callback) callback({ status: 'DISPATCHED' });
}

function sendControl(type, payload = {}, callback) {
  const packet = JSON.stringify({ type, ...payload }) + '\n';
  if (!deliverOutbound(packet)) {
    refreshMt5Connected();
    if (callback) callback({ status: 'NO_MT5' });
    return false;
  }
  if (callback) callback({ status: 'SENT' });
  return true;
}

function getStatus() {
  const addr = server ? server.address() : null;
  return {
    connected: mt5Connected,
    clients: activeSocket ? 1 : 0,
    fileBridge: Boolean(fileOutboundAppender),
    fileHandshake: fileTransportHandshakeOk,
    bindHost,
    port: addr && typeof addr === 'object' ? addr.port : null,
    authRequired: !!sharedSecret,
    authFailureCount,
    queuedSignals: pendingSignals.length,
    droppedSignalCount,
    droppedSignals: [...droppedSignals]
  };
}

/** Request OHLC from EA (CopyRates). Always resolves — never rejects. */
function requestMt5History(payload = {}, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const reqId = payload.reqId || randomUUID();
    const timer = setTimeout(() => {
      historyWaiters.delete(reqId);
      resolve({ success: false, error: 'HISTORY_TIMEOUT', bars: [] });
    }, timeoutMs);
    historyWaiters.set(reqId, {
      finish: (msg) => resolve(msg),
      timer
    });
    const ok = sendControl('HISTORY_REQUEST', {
      reqId,
      symbol: String(payload.symbol || ''),
      timeframeMinutes: Number(payload.timeframeMinutes) || 5,
      from: Number(payload.from) || 0,
      to: Number(payload.to) || 0
    });
    if (!ok) {
      clearTimeout(timer);
      historyWaiters.delete(reqId);
      resolve({ success: false, error: 'NO_MT5', bars: [] });
    }
  });
}

/** Request live Ask−Bid spread (pips) from EA. Always resolves — never rejects. */
function requestMt5Spread(payload = {}, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const reqId = payload.reqId || randomUUID();
    const timer = setTimeout(() => {
      spreadWaiters.delete(reqId);
      resolve({ success: false, error: 'SPREAD_TIMEOUT', spreadPips: 0 });
    }, timeoutMs);
    spreadWaiters.set(reqId, {
      finish: (msg) => resolve(msg),
      timer
    });
    const ok = sendControl('SPREAD_REQUEST', {
      reqId,
      symbol: String(payload.symbol || '')
    });
    if (!ok) {
      clearTimeout(timer);
      spreadWaiters.delete(reqId);
      resolve({ success: false, error: 'NO_MT5', spreadPips: 0 });
    }
  });
}

/** Ask the EA for its trading-permission + quote-flow diagnostic. Always resolves. */
function requestEaDiagnostic(payload = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const reqId = payload.reqId || randomUUID();
    const timer = setTimeout(() => {
      diagWaiters.delete(reqId);
      resolve({ success: false, error: 'DIAG_TIMEOUT' });
    }, timeoutMs);
    diagWaiters.set(reqId, {
      finish: (msg) => resolve(msg),
      timer
    });
    const ok = sendControl('DIAG_REQUEST', {
      reqId,
      symbol: String(payload.symbol || '')
    });
    if (!ok) {
      clearTimeout(timer);
      diagWaiters.delete(reqId);
      resolve({ success: false, error: 'NO_MT5' });
    }
  });
}

module.exports = {
  start,
  stop,
  sendSignal,
  sendControl,
  getStatus,
  getEaHealth,
  recordSettingsUpdate,
  requestMt5History,
  requestMt5Spread,
  requestEaDiagnostic,
  setFileOutboundAppender,
  processInboundLine
};
