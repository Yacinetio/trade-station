import React from 'react';
import { Toggle } from './SettingsFields.jsx';

export default function ConnectionTab({ s, set, instanceInfo = null }) {
  const md = s.marketData || {};
  const patchMd = (patch) => set('marketData', { ...md, ...patch });
  const listenPort = Number(s.serverPort) || instanceInfo?.defaultTcpPort || 9999;
  return (
    <>
      {instanceInfo?.id ? (
        <div className="settings-section" style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 12, lineHeight: 1.5 }}>
            Running as instance <strong>{instanceInfo.label || instanceInfo.id}</strong>.
            Data is isolated under <code style={{ fontSize: 11 }}>Documents\TradeStation\instances\{instanceInfo.id}</code>.
            Set the EA <strong>ServerPort</strong> input to match the port below (default for this instance: {instanceInfo.defaultTcpPort}).
          </p>
        </div>
      ) : null}
      <div className="settings-section">
        <h3>🔌 MT5 EA Connection</h3>
        <p>Configure how the app connects to the MetaTrader 5 Expert Advisor via TCP socket.</p>
        <div className="form-row">
          <div className="form-group">
            <label>Server IP</label>
            <input style={{width:'100%',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px',color:'var(--text)',fontSize:13,outline:'none'}}
              value={s.serverIP||'127.0.0.1'} onChange={e=>set('serverIP',e.target.value)} placeholder="127.0.0.1" />
          </div>
          <div className="form-group">
            <label>Port</label>
            <div className="number-input-wrap">
              <input type="number" value={listenPort} min={1} max={65535} onChange={e=>set('serverPort',parseInt(e.target.value))} />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>📂 MT4 file bridge (prop terminals)</h3>
        <p style={{ marginTop: 8, color: 'var(--text3)', fontSize: 12, lineHeight: 1.45 }}>
          MT4 EA connects via this folder only (no TCP). Set it to the <strong>same absolute path</strong> as{' '}
          <code style={{ fontSize: 11 }}>Terminal … \MQL4\Files\&lt;FileBridgeFolder&gt;</code>{' '}
          (MT4: <code style={{ fontSize: 11 }}>File → Open Data Folder → MQL4 → Files → …</code>). EA input{' '}
          <code style={{ fontSize: 11 }}>FileBridgeFolder</code> must match that subfolder name. MT5 still uses TCP from the app.
        </p>
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>Shared folder (absolute path)</label>
          <input
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontSize: 13 }}
            value={s.mt4FileBridgeDir || ''}
            placeholder="e.g. C:\\Users\\You\\AppData\\Roaming\\MetaQuotes\\Terminal\\…\\MQL4\\Files\\TradeStationFileBridge"
            onChange={(e) => set('mt4FileBridgeDir', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>MT HTML import — broker offset (minutes east of UTC)</label>
          <div className="number-input-wrap" style={{ maxWidth: 200 }}>
            <input
              type="number"
              step={1}
              placeholder="e.g. 120 (EET)"
              value={
                s.mtHtmlReportBrokerOffsetMinutes === null || s.mtHtmlReportBrokerOffsetMinutes === undefined
                  ? ''
                  : s.mtHtmlReportBrokerOffsetMinutes
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || v == null) {
                  set('mtHtmlReportBrokerOffsetMinutes', null);
                  return;
                }
                const n = parseInt(v, 10);
                set('mtHtmlReportBrokerOffsetMinutes', Number.isFinite(n) ? n : null);
              }}
            />
          </div>
          <p style={{ marginTop: 6, color: 'var(--text3)', fontSize: 12, lineHeight: 1.45 }}>
            Report timestamps have no timezone. Leave empty to treat them as <strong>this PC&apos;s local time</strong>{' '}
            (legacy). If imported times are about 1–3 hours off vs MetaTrader, enter the broker&apos;s offset east of UTC{' '}
            (common: <code style={{ fontSize: 11 }}>120</code> EET, <code style={{ fontSize: 11 }}>180</code> MSK).
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3>📈 Chart replay (free-tier OHLC)</h3>
        <p style={{ marginTop: 8, color: 'var(--text3)', fontSize: 12, lineHeight: 1.45 }}>
          Optional Twelve Data + Alpha Vantage keys unlock FX/stock REST bars. Crypto uses public Kraken/Binance REST.
          Broker CFD/indices use MT5 EA v1.3+ (History RPC) — no mock candles.
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Twelve Data provider</span>
          <Toggle checked={md.enableTwelveData !== false} onChange={(v) => patchMd({ enableTwelveData: v })} />
        </div>
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>Twelve Data API key</label>
          <input
            type="password"
            autoComplete="off"
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontSize: 13 }}
            value={md.twelveDataKey || ''}
            placeholder="free tier at twelvedata.com"
            onChange={(e) => patchMd({ twelveDataKey: e.target.value })}
          />
        </div>
        <div className="toggle-row">
          <span className="toggle-label">Alpha Vantage provider</span>
          <Toggle checked={md.enableAlphaVantage !== false} onChange={(v) => patchMd({ enableAlphaVantage: v })} />
        </div>
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>Alpha Vantage API key</label>
          <input
            type="password"
            autoComplete="off"
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontSize: 13 }}
            value={md.alphaVantageKey || ''}
            placeholder="free tier at alphavantage.co"
            onChange={(e) => patchMd({ alphaVantageKey: e.target.value })}
          />
        </div>
        <div className="toggle-row">
          <span className="toggle-label">Fallback to MT5 broker bars when REST fails</span>
          <Toggle checked={md.fallbackMt5 !== false} onChange={(v) => patchMd({ fallbackMt5: v })} />
        </div>
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>Disk cache TTL (minutes)</label>
          <div className="number-input-wrap">
            <input
              type="number"
              min={60}
              max={43200}
              value={Number.isFinite(Number(md.cacheTtlMinutes)) ? md.cacheTtlMinutes : 1440}
              onChange={(e) => patchMd({ cacheTtlMinutes: Math.max(60, parseInt(e.target.value, 10) || 1440) })}
            />
            <span className="number-input-unit">min</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>⏱️ Reconnect &amp; Timeouts</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Reconnect Delay (ms)</label>
            <div className="number-input-wrap">
              <input type="number" value={s.reconnectDelay||5000} min={500} step={500} onChange={e=>set('reconnectDelay',parseInt(e.target.value))} />
              <span className="number-input-unit">ms</span>
            </div>
          </div>
          <div className="form-group">
            <label>Slippage (points)</label>
            <div className="number-input-wrap">
              <input type="number" value={s.slippage||30} min={0} onChange={e=>set('slippage',parseInt(e.target.value))} />
              <span className="number-input-unit">pts</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>⏳ Pending Order Expiry</h3>
        <div className="toggle-row">
          <span className="toggle-label">Enable pending order expiry</span>
          <Toggle checked={!!s.enablePendingExpiry} onChange={v=>set('enablePendingExpiry',v)} />
        </div>
        {s.enablePendingExpiry && (
          <div className="form-group" style={{marginTop:10}}>
            <label>Expiry after (hours)</label>
            <div className="number-input-wrap">
              <input type="number" value={s.pendingExpiry||24} min={1} onChange={e=>set('pendingExpiry',parseInt(e.target.value))} />
              <span className="number-input-unit">h</span>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>📋 EA Options</h3>
        <div className="toggle-row">
          <span className="toggle-label">Use lot size from app (override EA lot)</span>
          <Toggle checked={s.useAppLotSize!==false} onChange={v=>set('useAppLotSize',v)} />
        </div>
        <div className="toggle-row">
          <span className="toggle-label">Enable detailed EA logs</span>
          <Toggle checked={s.enableLogs!==false} onChange={v=>set('enableLogs',v)} />
        </div>
        <div className="toggle-row">
          <span className="toggle-label">Force all orders as market orders</span>
          <Toggle checked={!!s.forceMarket} onChange={v=>set('forceMarket',v)} />
        </div>
        {s.forceMarket && (
          <div style={{color:'var(--warning)',fontSize:12,marginTop:4}}>⚠ All pending signals will be executed as market orders.</div>
        )}
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>MT5 ACK log interval (seconds)</label>
          <div className="number-input-wrap">
            <input
              type="number"
              value={s.mt5AckLogIntervalSec ?? 5}
              min={0}
              step={1}
              onChange={e => set('mt5AckLogIntervalSec', parseInt(e.target.value) || 0)}
            />
            <span className="number-input-unit">sec</span>
          </div>
          <div className="hint">0 = no throttling (show every ACK log).</div>
        </div>
      </div>

      <details className="settings-section settings-advanced">
        <summary className="settings-advanced-summary">⚙️ Advanced bridge options</summary>
        <p style={{ marginTop: 10, color: 'var(--text3)', fontSize: 12, lineHeight: 1.45 }}>
          Defaults work for everyone running MetaTrader on this PC. Only change these if you know why.
        </p>
        <div className="form-row" style={{ marginTop: 10 }}>
          <div className="form-group">
            <label>Bridge listen address</label>
            <input
              className="select-field"
              value={s.tcpBindHost ?? '127.0.0.1'}
              placeholder="127.0.0.1"
              onChange={(e) => set('tcpBindHost', e.target.value.trim())}
            />
            <div className="hint" style={{ marginTop: 6 }}>
              Only change if MetaTrader runs on another machine (e.g. <code style={{ fontSize: 11 }}>0.0.0.0</code> to accept LAN connections).
            </div>
            {(s.tcpBindHost && s.tcpBindHost !== '127.0.0.1' && s.tcpBindHost !== 'localhost' && !(s.eaSharedSecret || '').trim()) && (
              <div style={{ color: 'var(--warning)', fontSize: 12, marginTop: 6 }}>
                ⚠ Non-local address without an EA shared secret: anyone on the network can read your
                signals and impersonate the EA. Set a shared secret below.
              </div>
            )}
          </div>
          <div className="form-group">
            <label>EA shared secret</label>
            <input
              className="select-field"
              type="password"
              value={s.eaSharedSecret ?? ''}
              placeholder="Empty = no authentication"
              onChange={(e) => set('eaSharedSecret', e.target.value)}
            />
            <div className="hint" style={{ marginTop: 6 }}>
              When set, the EA must send the same value (EA input <code style={{ fontSize: 11 }}>SharedSecret</code>) or
              its connection is rejected. Requires EA v1.3+ and a restart of the bridge (restart the app after changing).
            </div>
          </div>
          <div className="form-group">
            <label>Offline signal expiry (seconds)</label>
            <div className="number-input-wrap">
              <input
                type="number"
                min={5}
                step={5}
                value={Math.round((Number(s.queueTtlMs) > 0 ? Number(s.queueTtlMs) : 120000) / 1000)}
                onChange={(e) => {
                  const sec = Number.parseInt(e.target.value, 10);
                  set('queueTtlMs', (Number.isFinite(sec) && sec > 0 ? sec : 120) * 1000);
                }}
              />
              <span className="number-input-unit">sec</span>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              If MetaTrader is offline when a signal arrives, the signal waits this long. Older signals are dropped instead of executing late at a stale price (shown as &quot;expired while offline&quot;).
            </div>
          </div>
        </div>
      </details>
    </>
  );
}
