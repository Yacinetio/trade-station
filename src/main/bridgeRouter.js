const tcpBridge = require('./tcpBridge');
const cloudBridge = require('./cloudBridge');

let eventHandler = null;
let preferCloud = false;

function wireCloudEvents(handler) {
  const events = [
    'connection:status',
    'mt5:hello',
    'trade:ack',
    'sync:progress',
    'quote:tick',
    'latency:metric'
  ];
  for (const ev of events) {
    cloudBridge.removeAllListeners(ev);
    cloudBridge.on(ev, (data) => handler(ev, data));
  }
}

function start(handler, options = {}) {
  eventHandler = handler;
  tcpBridge.start(handler, options);
  wireCloudEvents(handler);
}

function setPreferCloud(enabled = false) {
  preferCloud = !!enabled;
}

function getActiveBridge() {
  const cloud = cloudBridge.getStatus();
  const tcp = tcpBridge.getStatus();
  if (preferCloud && cloud.connected) return cloudBridge;
  if (tcp.connected) return tcpBridge;
  if (cloud.connected) return cloudBridge;
  return tcpBridge;
}

function sendSignal(signal, callback) {
  return getActiveBridge().sendSignal(signal, callback);
}

function sendControl(type, payload = {}, callback) {
  return getActiveBridge().sendControl(type, payload, callback);
}

function getStatus() {
  const tcp = tcpBridge.getStatus();
  const cloud = cloudBridge.getStatus();
  return {
    ...tcp,
    cloudConnected: cloud.connected,
    cloudAccountId: cloud.accountId || null,
    transport: cloud.connected && (preferCloud || !tcp.connected) ? 'cloud' : (tcp.connected ? 'ea_tcp' : 'none'),
    active: cloud.connected || tcp.connected
  };
}

function requestMt5History(payload, timeoutMs) {
  const bridge = getActiveBridge();
  if (typeof bridge.requestMt5History === 'function') {
    return bridge.requestMt5History(payload, timeoutMs);
  }
  return tcpBridge.requestMt5History(payload, timeoutMs);
}

function requestMt5Spread(payload, timeoutMs) {
  const bridge = getActiveBridge();
  if (typeof bridge.requestMt5Spread === 'function') {
    return bridge.requestMt5Spread(payload, timeoutMs);
  }
  return tcpBridge.requestMt5Spread(payload, timeoutMs);
}

module.exports = {
  start,
  setPreferCloud,
  getActiveBridge,
  sendSignal,
  sendControl,
  getStatus,
  requestMt5History,
  requestMt5Spread,
  getEaHealth: () => tcpBridge.getEaHealth(),
  requestEaDiagnostic: (payload, timeoutMs) => tcpBridge.requestEaDiagnostic(payload, timeoutMs),
  recordSettingsUpdate: (settings) => tcpBridge.recordSettingsUpdate(settings),
  setFileOutboundAppender: (fn) => tcpBridge.setFileOutboundAppender(fn),
  processInboundLine: (line) => tcpBridge.processInboundLine(line),
  tcp: tcpBridge,
  cloud: cloudBridge
};
