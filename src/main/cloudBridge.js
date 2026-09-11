const { EventEmitter } = require('events');

let WebSocketImpl;
try {
  WebSocketImpl = require('ws');
} catch {
  WebSocketImpl = null;
}

/**
 * Trade Station cloud bridge client — mirrors tcpBridge surface for bridgeRouter.
 */
class CloudBridgeClient extends EventEmitter {
  constructor() {
    super();
    this.apiBase = process.env.TS_BRIDGE_API_URL || 'http://127.0.0.1:8787';
    this.wsBase = process.env.TS_BRIDGE_WS_URL || 'ws://127.0.0.1:8788';
    this.token = '';
    this.accountId = null;
    this.ws = null;
    this.connected = false;
    this._signalCallbacks = new Map();
    this._historyWaiters = new Map();
  }

  configure(opts = {}) {
    if (opts.apiBase) this.apiBase = String(opts.apiBase).replace(/\/$/, '');
    if (opts.wsBase) this.wsBase = String(opts.wsBase).replace(/\/$/, '');
    if (opts.token) this.token = String(opts.token);
    if (opts.accountId) this.accountId = String(opts.accountId);
  }

  async api(path, method = 'GET', body) {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'API_ERROR');
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async ensureDevToken(tenantId = 'dev-tenant') {
    if (this.token) return this.token;
    const data = await fetch(`${this.apiBase}/v1/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId })
    }).then((r) => r.json());
    this.token = data.token || '';
    return this.token;
  }

  async listAccounts() {
    const data = await this.api('/v1/accounts');
    return data.accounts || [];
  }

  async createAccount(payload) {
    const data = await this.api('/v1/accounts', 'POST', payload);
    return data.account;
  }

  async deployAccount(accountId) {
    const data = await this.api(`/v1/accounts/${accountId}/deploy`, 'POST');
    return data.account;
  }

  async stopAccount(accountId) {
    const data = await this.api(`/v1/accounts/${accountId}/stop`, 'POST');
    return data.account;
  }

  async restartAccount(accountId) {
    const data = await this.api(`/v1/accounts/${accountId}/restart`, 'POST');
    return data.account;
  }

  async syncAccount(accountId) {
    const data = await this.api(`/v1/accounts/${accountId}/sync`, 'POST');
    return data.account;
  }

  async getCredentialLink(accountId) {
    const data = await this.api(`/v1/accounts/${accountId}/credential-link`, 'POST');
    return data.url;
  }

  async getAccount(accountId) {
    const data = await this.api(`/v1/accounts/${accountId}`);
    return data.account;
  }

  connect(accountId) {
    this.accountId = accountId;
    if (!WebSocketImpl) {
      this.connected = false;
      return Promise.resolve({ success: false, reason: 'NO_WEBSOCKET' });
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }

    const url = `${this.wsBase}/?token=${encodeURIComponent(this.token)}`;
    return new Promise((resolve) => {
      this.ws = new WebSocketImpl(url);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ type: 'subscribe', accountId }));
      });
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        this._handleWsMessage(msg, resolve);
      });
      this.ws.on('close', () => {
        this.connected = false;
        this.emit('connection:status', { mt5: false, cloud: false, accountId: this.accountId });
      });
      this.ws.on('error', () => {
        this.connected = false;
        resolve({ success: false, reason: 'WS_ERROR' });
      });
    });
  }

  _handleWsMessage(msg, connectResolve) {
    if (msg.event === 'subscribed') {
      this.connected = true;
      this.emit('connection:status', { mt5: true, cloud: true, accountId: this.accountId });
      if (connectResolve) connectResolve({ success: true });
      return;
    }

    if (!msg.event) return;
    const eventName = msg.event === 'terminal:hello' ? 'mt5:hello' : msg.event;
    const data = msg.data || {};
    this.emit(eventName, data);

    if (msg.event === 'trade:ack' && data) {
      if (data.type === 'HISTORY_REPLY' && data.reqId) {
        const w = this._historyWaiters.get(data.reqId);
        if (w) {
          clearTimeout(w.timer);
          w.finish({ success: true, bars: data.bars || [] });
          this._historyWaiters.delete(data.reqId);
        }
      }
      const tradeId = data.tradeId || data.id;
      if (tradeId) {
        const cb = this._signalCallbacks.get(String(tradeId));
        if (cb) {
          cb(data);
          this._signalCallbacks.delete(String(tradeId));
        }
      }
    }
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    this.connected = false;
    this.accountId = null;
  }

  getStatus() {
    return {
      connected: this.connected,
      cloud: true,
      accountId: this.accountId,
      transport: 'cloud',
      clients: this.connected ? 1 : 0
    };
  }

  sendControl(type, payload = {}, callback) {
    if (!this.ws || this.ws.readyState !== 1) {
      if (callback) callback({ status: 'NO_CLOUD' });
      return false;
    }
    this.ws.send(JSON.stringify({ command: type, payload }));
    if (callback) callback({ status: 'SENT' });
    return true;
  }

  sendSignal(signal, callback) {
    const tradeId = signal.tradeId || signal.id;
    if (tradeId && typeof callback === 'function') {
      this._signalCallbacks.set(String(tradeId), callback);
    }
    const ok = this.sendControl('SIGNAL', { signal }, (ack) => {
      if (callback && ack?.status === 'SENT') callback({ status: 'DISPATCHED' });
    });
    if (!ok && callback) callback({ status: 'NO_CLOUD' });
    return ok;
  }

  requestMt5History(payload = {}, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const { randomUUID } = require('crypto');
      const reqId = payload.reqId || randomUUID();
      const timer = setTimeout(() => {
        this._historyWaiters.delete(reqId);
        resolve({ success: false, error: 'HISTORY_TIMEOUT', bars: [] });
      }, timeoutMs);
      this._historyWaiters.set(reqId, { finish: resolve, timer });
      const ok = this.sendControl('HISTORY_REQUEST', {
        reqId,
        symbol: String(payload.symbol || ''),
        timeframeMinutes: Number(payload.timeframeMinutes) || 5,
        from: Number(payload.from) || 0,
        to: Number(payload.to) || 0
      });
      if (!ok) {
        clearTimeout(timer);
        this._historyWaiters.delete(reqId);
        resolve({ success: false, error: 'NO_CLOUD', bars: [] });
      }
    });
  }
}

const client = new CloudBridgeClient();

module.exports = client;
