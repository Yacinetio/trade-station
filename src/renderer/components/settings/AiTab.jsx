import React, { useEffect, useState } from 'react';
import { Toggle } from './SettingsFields.jsx';

function formatAiPingError(err, retryAfter) {
  if (err === 'auth_required' || err === 'http_401' || err === 'http_402') {
    return 'API key required — get a free key at enter.pollinations.ai, paste below, Save Settings, then test again.';
  }
  if (err === 'rate_limited') {
    const wait = retryAfter ? ` Retry in ~${retryAfter}s.` : ' Anonymous tier is exhausted.';
    return `Rate-limited (HTTP 429).${wait} Add a Pollinations API key for reliable access.`;
  }
  return `Unreachable: ${err || 'unknown'}`;
}

export default function AiTab({ s, set }) {
  const ai = (s.aiCheck && typeof s.aiCheck === 'object') ? s.aiCheck : {};
  const updateAi = (patch) => set('aiCheck', { ...ai, ...patch });
  const hasPollinationsKey = !!String(ai.pollinationsApiKey || '').trim();

  const [textModels, setTextModels] = useState([{ id: 'openai', label: 'OpenAI (Pollinations)' }]);
  useEffect(() => {
    window.electronAPI?.getFreeTextModels?.().then((r) => {
      if (Array.isArray(r?.models) && r.models.length) setTextModels(r.models);
    }).catch(() => {});
  }, []);

  const [pingState, setPingState] = useState({ status: 'idle', message: '' });
  const runPing = async () => {
    setPingState({ status: 'pending', message: 'Pinging…' });
    try {
      const r = await window.electronAPI?.pingAi?.();
      if (r?.ok) setPingState({ status: 'ok', message: `Reachable — replied: ${(r.reply || '').toString().slice(0, 60)}` });
      else setPingState({ status: 'fail', message: formatAiPingError(r?.error, r?.retryAfter) });
    } catch (e) {
      setPingState({ status: 'fail', message: String(e?.message || e) });
    }
  };

  const [usage, setUsage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.electronAPI?.getAiUsage?.();
        if (!cancelled && r) setUsage(r);
      } catch (_) { /* noop */ }
    };
    load();
    const t = setInterval(load, 6000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const resetUsage = async () => {
    try {
      const r = await window.electronAPI?.resetAiUsage?.();
      if (r) setUsage(r);
    } catch (_) { /* noop */ }
  };

  return (
    <>
      <div className="settings-section">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>🤖 AI Signal Check (free — no API key)</h3>
          {usage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text2)' }}>
              <span title={`Errors: ${usage.errors || 0}\nRate-limited (provider HTTP 429): ${usage.rateLimited || 0}\nDate: ${usage.date}`}>
                <strong style={{ color: 'var(--text)' }}>
                  {usage.used || 0}
                </strong>
                {' '}AI calls today
                {(usage.rateLimited || 0) > 0 && (
                  <span style={{ color: 'var(--warning)', marginLeft: 6 }}>· {usage.rateLimited} rate-limited</span>
                )}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={resetUsage} title="Reset today's counter">
                Reset
              </button>
            </div>
          )}
        </div>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          When enabled, every incoming signal is rated 0–100% via{' '}
          <a href="https://gen.pollinations.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Pollinations</a>.
          The old anonymous endpoint is rate-limited (HTTP 429) — add a free API key from{' '}
          <a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>enter.pollinations.ai</a>{' '}
          (<code style={{ fontSize: 10 }}>pk_</code> publishable or <code style={{ fontSize: 10 }}>sk_</code> secret).
          Choose whether low scores <strong>block</strong>, <strong>reduce lot</strong>, or only <strong>advise</strong>.
        </p>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Pollinations API key</label>
          <input
            className="select-field"
            type="password"
            autoComplete="off"
            value={ai.pollinationsApiKey || ''}
            onChange={(e) => updateAi({ pollinationsApiKey: e.target.value.trim() })}
            placeholder="pk_… or sk_… from enter.pollinations.ai"
          />
          <div style={{ fontSize: 10, color: hasPollinationsKey ? 'var(--success)' : 'var(--warning)', marginTop: 4 }}>
            {hasPollinationsKey
              ? 'Key set — Test connection should succeed after Save Settings.'
              : 'No key — you will see HTTP 429 / auth errors until a key is added.'}
          </div>
        </div>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Enable AI signal-check</span>
          <Toggle checked={!!ai.enabled} onChange={(v) => updateAi({ enabled: v })} />
        </div>

        <div className="toggle-row" style={{ marginTop: 10 }}>
          <span className="toggle-label">Save AI score &amp; notes on each trade</span>
          <Toggle checked={ai.persistAnalysisOnTrade !== false} onChange={(v) => updateAi({ persistAnalysisOnTrade: v })} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          Off = no <code style={{ fontSize: 10 }}>aiCheck</code> field on stored trades (block or allow paths). AI Insights verdict list can still update.
        </div>

        <div className="toggle-row" style={{ marginTop: 10 }}>
          <span className="toggle-label">Auto AI insight when a trade closes (TP / SL / manual)</span>
          <Toggle checked={s.autoAiCloseInsight !== false} onChange={(v) => set('autoAiCloseInsight', v)} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          Adds a <code style={{ fontSize: 10 }}>[AI_CLOSE]</code> block to the trade journal Notes using the same free AI model (subject to daily limits).
        </div>

        <div className="toggle-row" style={{ marginTop: 10 }}>
          <span className="toggle-label">Use OHLC chart context (MT5 / market data)</span>
          <Toggle checked={ai.useChartContext !== false} onChange={(v) => updateAi({ useChartContext: v })} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          Adds recent bars to prompts (range vs your SL/TP). Requires MT5 connected or market API keys. The free text model still cannot see screenshot images.
        </div>

        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label>Min confidence to allow</label>
            <input
              className="select-field"
              type="number"
              min="0"
              max="100"
              step="1"
              value={Number(ai.minConfidence ?? 70)}
              onChange={(e) => updateAi({ minConfidence: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            />
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
              0–100. Below this, the AI blocks, reduces lot, or only warns — depending on “On low confidence”.
            </div>
          </div>
          <div className="form-group">
            <label>On low confidence</label>
            <select className="select-field" value={ai.onLowConfidence || 'block'} onChange={(e) => updateAi({ onLowConfidence: e.target.value })}>
              <option value="block">Block the trade (recommended)</option>
              <option value="reduce">Reduce lot size</option>
              <option value="allow">Allow trade anyway (advisory only)</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
              Advisory mode never blocks or reduces; low scores are logged only.
            </div>
          </div>
          {ai.onLowConfidence === 'reduce' && (
            <div className="form-group">
              <label>Reduce factor</label>
              <input
                className="select-field"
                type="number"
                min="0.05"
                max="1"
                step="0.05"
                value={Number(ai.reduceFactor ?? 0.5)}
                onChange={(e) => updateAi({ reduceFactor: Math.max(0.05, Math.min(1, Number(e.target.value) || 0.5)) })}
              />
            </div>
          )}
          <div className="form-group">
            <label>Model</label>
            <select
              className="select-field"
              value={ai.model || 'openai'}
              onChange={(e) => updateAi({ model: e.target.value })}
              disabled={!hasPollinationsKey}
              title={hasPollinationsKey ? 'Pollinations text model' : 'Add API key to choose model'}
            >
              {textModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
              {hasPollinationsKey ? 'More models unlock with your Pollinations key.' : 'Defaults to openai once a key is set.'}
            </div>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Extra instructions (optional)</label>
          <textarea
            className="select-field"
            rows={2}
            placeholder="e.g. Be stricter on XAUUSD; never allow signals with R:R below 1.5."
            value={ai.extraInstructions || ''}
            onChange={(e) => updateAi({ extraInstructions: e.target.value.slice(0, 500) })}
          />
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={runPing}>
            {pingState.status === 'pending' ? 'Testing…' : 'Test connection'}
          </button>
          {pingState.message && (
            <span style={{
              fontSize: 12,
              color: pingState.status === 'ok' ? 'var(--success)'
                   : pingState.status === 'fail' ? 'var(--danger)'
                   : 'var(--text2)'
            }}>
              {pingState.message}
            </span>
          )}
        </div>

        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'color-mix(in srgb, var(--surface2) 92%, transparent)', fontSize: 11, color: 'var(--text2)' }}>
          <strong style={{ color: 'var(--text)' }}>How it works:</strong> when a signal arrives, we send a structured prompt
          (channel name, R:R, SL validity, news guard status, recent winrate) to the free AI endpoint. The model responds
          with a confidence score and short reasons. If the score is below your threshold, we either block the trade or
          shrink the lot. If the AI is briefly offline, signals are still allowed (so trading isn't accidentally paused).
        </div>
      </div>

      <div className="settings-section">
        <h3>🖼️ Advanced: AI image-signal parsing (optional, requires OpenAI key)</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Optional. Only used for channels that post screenshots instead of text. Costs ~$0.001/image with gpt-4o-mini.
          Leave disabled if you don't follow image-only channels.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Enable image-signal parsing (uses your OpenAI key)</span>
          <Toggle checked={!!s.aiVisionEnabled} onChange={(v) => set('aiVisionEnabled', v)} />
        </div>
        {s.aiVisionEnabled && (
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label>OpenAI API key</label>
              <input
                className="select-field"
                type="password"
                autoComplete="off"
                value={s.aiOpenAIApiKey || ''}
                onChange={(e) => set('aiOpenAIApiKey', e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <div className="form-group">
              <label>Model</label>
              <select className="select-field" value={s.aiVisionModel || 'gpt-4o-mini'} onChange={(e) => set('aiVisionModel', e.target.value)}>
                <option value="gpt-4o-mini">gpt-4o-mini (cheap, fast)</option>
                <option value="gpt-4o">gpt-4o (best accuracy)</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
