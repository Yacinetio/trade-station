/**
 * cTrader Open API bridge — scaffold.
 *
 * STATUS: Scaffold only. Network calls are NOT live yet — `sendSignal` returns
 * `NO_BRIDGE` until you wire the cTrader Open API credentials. The interface mirrors
 * `tcpBridge` so callers can multiplex by `settings.executionPlatform`.
 *
 * Why a separate file: cTrader's Open API uses OAuth2 + Protobuf over WebSocket and a
 * REST trading endpoint. That stack is wildly different from MT5 and would bloat
 * `tcpBridge.js`. Keeping it isolated also lets you sell cTrader as a paid add-on later.
 *
 * Required user inputs (settings.cTrader = { ... }):
 *   - clientId / clientSecret (registered at openapi.ctrader.com)
 *   - refreshToken (obtained via OAuth2 device flow in-app — TODO)
 *   - accountId (cTrader trading account number)
 *   - environment ('live' | 'demo')
 *
 * To go live, implement:
 *   1. OAuth2 dance (auth_code + refresh_token rotation)
 *   2. Open WebSocket to wss://(live|demo).ctraderapi.com:5036 with Protobuf payloads
 *   3. Send ProtoOANewOrderReq for each signal, parse ProtoOAExecutionEvent for fills
 *   4. Mirror fills back into the same trade store (`tradeStore.upsertTrade`).
 *
 * Reference: https://help.ctrader.com/open-api/
 */

let storeRef = null;
let licensedRef = () => false;

function init({ store, isLicensed }) {
  storeRef = store;
  licensedRef = typeof isLicensed === 'function' ? isLicensed : () => false;
  return { initialized: true, ready: false };
}

function isConfigured() {
  if (!storeRef) return false;
  const cfg = storeRef.get('settings', {})?.cTrader || {};
  return !!(cfg.clientId && cfg.clientSecret && cfg.accountId);
}

function getStatus() {
  return {
    platform: 'cTrader',
    configured: isConfigured(),
    licensed: licensedRef(),
    connected: false,
    note: 'Scaffold — OAuth2 + Protobuf WebSocket pipeline not yet wired'
  };
}

async function sendSignal(/* signal */) {
  return { status: 'NO_BRIDGE', reason: 'cTrader bridge not implemented yet' };
}

async function sendControl(/* type, payload */) {
  return { status: 'NO_BRIDGE' };
}

module.exports = {
  init,
  isConfigured,
  getStatus,
  sendSignal,
  sendControl
};
