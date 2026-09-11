import React, { useEffect, useState } from 'react';

const SAMPLES = [
  {
    label: 'Gold multi-TP',
    text: 'GOLD BUY NOW @ 2331\nSL 2325\nTP1 2336\nTP2 2342\nTP3 2350'
  },
  {
    label: 'FX pending',
    text: 'EURUSD SELL LIMIT @ 1.0895\nSL: 1.0925\nTP: 1.0850'
  },
  {
    label: 'No SL (should warn)',
    text: 'BUY US30 now!! TP 39500'
  }
];

function CheckRow({ label, ok, reason }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 14 }}>{ok ? '✅' : '⛔'}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 12, color: ok ? 'var(--text3)' : 'var(--danger)', marginLeft: 'auto', textAlign: 'right' }}>
        {ok ? 'Passed' : (reason || 'Blocked')}
      </span>
    </div>
  );
}

function Field({ label, value }) {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: empty ? 'var(--text3)' : 'var(--text)' }}>
        {empty ? '—' : (Array.isArray(value) ? value.join(' / ') : String(value))}
      </div>
    </div>
  );
}

export default function ParserDebugPage({ routeVisible = true }) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState('');
  const [channels, setChannels] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!routeVisible) return;
    window.electronAPI?.getEnabledChannels?.().then((rows) => {
      const names = (Array.isArray(rows) ? rows : [])
        .map((c) => (typeof c === 'string' ? c : (c?.name || c?.title || '')))
        .filter(Boolean);
      setChannels([...new Set(names)]);
    }).catch(() => {});
  }, [routeVisible]);

  const runParse = async () => {
    if (!text.trim() || running) return;
    setRunning(true);
    setError('');
    try {
      const res = await window.electronAPI?.debugParserMessage?.({ text, channel: channel || undefined });
      setResult(res || null);
      if (!res) setError('No response from parser');
    } catch (err) {
      setError(err?.message || String(err));
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const parsed = result?.parsed || null;

  return (
    <div className="dashboard-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon">🔬</span>
          <span className="brand-name">Parser Lab</span>
          <span className="subtitle">Paste a signal message and see exactly how Trade Station would read it</span>
        </div>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.2fr)', gap: 16, alignItems: 'start' }}>
        {/* Input side */}
        <div className="settings-section" style={{ margin: 0 }}>
          <h3>📨 Test message</h3>
          <p>Runs your real parser settings (custom keywords, symbol mappings, filters) — nothing is sent to MT5.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runParse(); }}
            placeholder={'Paste a Telegram signal here, e.g.\n\nGOLD BUY NOW @ 2331\nSL 2325\nTP 2336\nTP 2342'}
            spellCheck={false}
            style={{
              width: '100%', minHeight: 180, resize: 'vertical',
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
              padding: 12, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none'
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <select
              className="filter-select"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              title="Simulate the message coming from a specific channel"
            >
              <option value="">Any channel</option>
              {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="btn btn-primary" onClick={runParse} disabled={running || !text.trim()}>
              {running ? 'Parsing…' : 'Parse message'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Ctrl+Enter</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Try a sample:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SAMPLES.map((s) => (
                <button key={s.label} type="button" className="btn btn-sm btn-outline" onClick={() => setText(s.text)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Result side */}
        <div className="settings-section" style={{ margin: 0 }}>
          <h3>🧾 Result</h3>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {!result && !error && (
            <p style={{ color: 'var(--text3)' }}>Parse a message to see the extracted signal and every gate it would pass through.</p>
          )}
          {result && (
            <>
              <div style={{
                borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700,
                background: result.wouldExecute ? 'rgba(0,200,120,0.12)' : 'rgba(255,80,80,0.10)',
                border: `1px solid ${result.wouldExecute ? 'rgba(0,200,120,0.4)' : 'rgba(255,80,80,0.35)'}`,
                color: result.wouldExecute ? 'var(--success)' : 'var(--danger)'
              }}>
                {result.wouldExecute
                  ? '✅ This message would be executed (guards evaluated with an empty account state)'
                  : result.ok
                    ? '⛔ Parsed, but a filter or guard would block it'
                    : `⛔ Not recognized as a signal${result.parseError ? ` — ${result.parseError}` : ''}`}
              </div>

              {parsed && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginBottom: 14 }}>
                  <Field label="Symbol" value={parsed.symbol} />
                  <Field label="Type" value={parsed.type} />
                  <Field label="Entry" value={parsed.entry ?? 'Market'} />
                  <Field label="SL" value={parsed.sl} />
                  <Field label="TP" value={parsed.tp} />
                  <Field label="Lot" value={parsed.lot} />
                  {parsed.orderType ? <Field label="Order type" value={parsed.orderType} /> : null}
                  {parsed.timeframe ? <Field label="TF" value={parsed.timeframe} /> : null}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <CheckRow label="Parsed as a signal" ok={!!result.ok} reason={result.parseError || 'Message did not match any signal pattern'} />
                <CheckRow label="Trading schedule" ok={result.schedule?.allowed !== false} reason={result.schedule?.reason} />
                <CheckRow label="Advanced signal filters" ok={result.advancedBlock?.allowed !== false} reason={result.advancedBlock?.reason} />
                <CheckRow label="Execution guards" ok={result.executionGuard?.allowed !== false} reason={result.executionGuard?.reason} />
              </div>

              <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? 'Hide raw output' : 'Show raw output'}
              </button>
              {showRaw && (
                <pre style={{
                  marginTop: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 12, fontSize: 11, color: 'var(--text2)', maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap'
                }}>
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
