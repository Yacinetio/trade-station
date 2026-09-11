import React, { useCallback, useEffect, useMemo, useState } from 'react';
import '../styles/aiAgents.css';

const AUTO_TAG_RULES = [
  { id: 'session', label: 'Session tag', detail: 'session:asian | london | newyork | late from openedAt UTC hour (0–7 / 7–13 / 13–21 / 21–24)' },
  { id: 'no-sl', label: 'no-sl', detail: 'Stop loss missing or zero' },
  { id: 'oversized', label: 'oversized', detail: 'Lot size > 2× median of last 20 closed trades on the same account' },
  { id: 'revenge', label: 'revenge-candidate', detail: 'Opened less than 15 minutes after a closed loss on the same account' },
  { id: 'overtrading', label: 'overtrading-day', detail: 'At least N trades opened the same UTC day (threshold in settings, default 6)' },
  { id: 'weekend', label: 'weekend-held', detail: 'Opened Friday UTC, closed Monday or later' },
  { id: 'big', label: 'big-winner / big-loser', detail: '|profit| > 2× average |profit| across closed trades (min 10 closed)' }
];

export default function AiAgentsPanel() {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [briefPreview, setBriefPreview] = useState('');
  const [reviewPreview, setReviewPreview] = useState('');
  const [tagHistoryCount, setTagHistoryCount] = useState(null);
  const [trades, setTrades] = useState([]);
  const [selectedTradeId, setSelectedTradeId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [accepted, setAccepted] = useState(new Set());

  const aiCfg = useMemo(() => ({
    briefingEnabled: settings?.aiAgents?.briefingEnabled === true,
    briefingTime: settings?.aiAgents?.briefingTime || '07:30',
    sessionReviewEnabled: settings?.aiAgents?.sessionReviewEnabled === true,
    reviewTime: settings?.aiAgents?.reviewTime || '22:30',
    autoTagEnabled: settings?.aiAgents?.autoTagEnabled !== false,
    overtradingThreshold: Number(settings?.aiAgents?.overtradingThreshold) || 6
  }), [settings]);

  const recentClosed = useMemo(() => {
    const closed = (Array.isArray(trades) ? trades : []).filter((t) => {
      const s = String(t?.status || '').toUpperCase();
      return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!t?.closeTime;
    });
    return closed
      .slice()
      .sort((a, b) => String(b?.closedAt || b?.closeTime || '').localeCompare(String(a?.closedAt || a?.closeTime || '')))
      .slice(0, 20);
  }, [trades]);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [st, stat, tr] = await Promise.all([
        window.electronAPI?.getSettings?.(),
        window.electronAPI?.getAiAgentsStatus?.(),
        window.electronAPI?.getTrades?.()
      ]);
      if (st) setSettings(st);
      if (stat) setStatus(stat);
      const list = Array.isArray(tr) ? tr : (Array.isArray(tr?.trades) ? tr.trades : []);
      setTrades(list);
      if (!selectedTradeId && list.length) {
        const first = recentClosed[0]?.id;
        if (first) setSelectedTradeId(String(first));
      }
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [selectedTradeId, recentClosed]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (recentClosed.length && !recentClosed.some((t) => String(t.id) === String(selectedTradeId))) {
      setSelectedTradeId(String(recentClosed[0]?.id || ''));
    }
  }, [recentClosed, selectedTradeId]);

  const patchAiAgents = useCallback(async (patch) => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const next = {
        ...settings,
        aiAgents: { ...(settings.aiAgents || {}), ...patch }
      };
      const res = await window.electronAPI?.saveSettings?.(next);
      setSettings(res?.settings || next);
      const stat = await window.electronAPI?.getAiAgentsStatus?.();
      if (stat) setStatus(stat);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const onRunBriefing = async () => {
    setBusy('briefing');
    setError('');
    try {
      const r = await window.electronAPI?.runBriefingNow?.();
      if (r?.ok) {
        setBriefPreview(r.markdown || '');
        await loadAll();
      } else {
        setError(r?.error || 'Briefing failed');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const onRunReview = async () => {
    setBusy('review');
    setError('');
    try {
      const r = await window.electronAPI?.runSessionReviewNow?.({});
      if (r?.ok) {
        setReviewPreview(r.markdown || '');
        await loadAll();
      } else {
        setError(r?.error || 'Session review failed');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const onAutoTagHistory = async () => {
    setBusy('tag');
    setError('');
    try {
      const r = await window.electronAPI?.autoTagHistory?.();
      setTagHistoryCount(Number(r?.changedCount) || 0);
      await window.electronAPI?.refreshTrades?.();
      await loadAll();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const onSuggestTags = async () => {
    if (!selectedTradeId) return;
    setBusy('suggest');
    setError('');
    setSuggestions([]);
    setAccepted(new Set());
    try {
      const r = await window.electronAPI?.suggestTradeTags?.(selectedTradeId);
      if (r?.ok) {
        setSuggestions(Array.isArray(r.suggestions) ? r.suggestions : []);
      } else {
        setError(r?.error || 'Tag suggestion failed');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const toggleAccept = (tag) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const onAcceptTags = async () => {
    const tags = [...accepted];
    if (!tags.length || !selectedTradeId) return;
    setBusy('accept');
    try {
      await window.electronAPI?.acceptSuggestedTags?.({ tradeId: selectedTradeId, tags });
      setAccepted(new Set());
      setSuggestions([]);
      await loadAll();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="ai-agents-panel" data-testid="ai-agents-panel">
      <header className="ai-agents-head">
        <h2 className="ai-agents-title">AI Agents</h2>
        <p className="ai-agents-lede">
          Scheduled pre-market briefings and end-of-day reviews land in your Notebook. Deterministic tags run free; AI tag suggestions need one-click accept.
        </p>
      </header>

      {error ? <div className="ai-agents-banner ai-agents-banner--error">{error}</div> : null}

      <section className="ai-agents-card">
        <h3 className="ai-agents-section-title">Schedule</h3>
        <div className="ai-agents-grid">
          <label className="ai-agents-toggle">
            <input
              type="checkbox"
              checked={aiCfg.briefingEnabled}
              disabled={saving}
              onChange={(e) => patchAiAgents({ briefingEnabled: e.target.checked })}
            />
            <span>Pre-market briefing</span>
          </label>
          <label className="ai-agents-field">
            <span>Briefing time</span>
            <input
              type="time"
              value={aiCfg.briefingTime}
              disabled={saving}
              onChange={(e) => patchAiAgents({ briefingTime: e.target.value })}
            />
          </label>
          <label className="ai-agents-toggle">
            <input
              type="checkbox"
              checked={aiCfg.sessionReviewEnabled}
              disabled={saving}
              onChange={(e) => patchAiAgents({ sessionReviewEnabled: e.target.checked })}
            />
            <span>Session review</span>
          </label>
          <label className="ai-agents-field">
            <span>Review time</span>
            <input
              type="time"
              value={aiCfg.reviewTime}
              disabled={saving}
              onChange={(e) => patchAiAgents({ reviewTime: e.target.value })}
            />
          </label>
          <label className="ai-agents-toggle">
            <input
              type="checkbox"
              checked={aiCfg.autoTagEnabled}
              disabled={saving}
              onChange={(e) => patchAiAgents({ autoTagEnabled: e.target.checked })}
            />
            <span>Auto-tag on close (deterministic)</span>
          </label>
          <label className="ai-agents-field">
            <span>Overtrading threshold (UTC day)</span>
            <input
              type="number"
              min={2}
              max={50}
              value={aiCfg.overtradingThreshold}
              disabled={saving}
              onChange={(e) => patchAiAgents({ overtradingThreshold: Number(e.target.value) || 6 })}
            />
          </label>
        </div>
        {status?.lastBriefing?.at ? (
          <p className="ai-agents-meta">Last briefing: {new Date(status.lastBriefing.at).toLocaleString()} ({status.lastBriefing.dateKey})</p>
        ) : null}
        {status?.lastReview?.at ? (
          <p className="ai-agents-meta">Last review: {new Date(status.lastReview.at).toLocaleString()} ({status.lastReview.dateKey})</p>
        ) : null}
      </section>

      <section className="ai-agents-card">
        <h3 className="ai-agents-section-title">Run now</h3>
        <div className="ai-agents-actions">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={onRunBriefing}>
            {busy === 'briefing' ? 'Running…' : 'Run briefing now'}
          </button>
          <button type="button" className="btn btn-outline" disabled={!!busy} onClick={onRunReview}>
            {busy === 'review' ? 'Running…' : 'Run session review'}
          </button>
        </div>
        {briefPreview ? (
          <div className="ai-agents-preview">
            <div className="ai-agents-preview-label">Briefing preview</div>
            <pre className="ai-agents-preview-body">{briefPreview}</pre>
          </div>
        ) : null}
        {reviewPreview ? (
          <div className="ai-agents-preview">
            <div className="ai-agents-preview-label">Review preview</div>
            <pre className="ai-agents-preview-body">{reviewPreview}</pre>
          </div>
        ) : null}
      </section>

      <section className="ai-agents-card">
        <h3 className="ai-agents-section-title">Deterministic auto-tags</h3>
        <ul className="ai-agents-rules">
          {AUTO_TAG_RULES.map((r) => (
            <li key={r.id}>
              <strong>{r.label}</strong>
              <span>{r.detail}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-outline" disabled={!!busy} onClick={onAutoTagHistory}>
          {busy === 'tag' ? 'Tagging…' : 'Tag my history'}
        </button>
        {tagHistoryCount != null ? (
          <p className="ai-agents-meta">{tagHistoryCount} trade(s) received new auto-tags.</p>
        ) : null}
      </section>

      <section className="ai-agents-card">
        <h3 className="ai-agents-section-title">AI tag suggester (tester)</h3>
        <div className="ai-agents-suggest-row">
          <select
            className="select-field"
            value={selectedTradeId}
            onChange={(e) => setSelectedTradeId(e.target.value)}
          >
            {recentClosed.length === 0 ? <option value="">No closed trades</option> : null}
            {recentClosed.map((t) => (
              <option key={t.id} value={t.id}>
                {String(t.symbol || '?').toUpperCase()} · ${Number(t.profit || 0).toFixed(2)} · {String(t.closedAt || t.closeTime || '').slice(0, 10)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-outline" disabled={!!busy || !selectedTradeId} onClick={onSuggestTags}>
            {busy === 'suggest' ? 'Suggesting…' : 'Suggest tags'}
          </button>
        </div>
        {suggestions.length > 0 ? (
          <div className="ai-agents-chips">
            {suggestions.map((s) => (
              <button
                key={s.tag}
                type="button"
                className={`ai-agents-chip ${accepted.has(s.tag) ? 'is-selected' : ''}`}
                title={s.reason}
                onClick={() => toggleAccept(s.tag)}
              >
                {s.tag} ({Math.round((s.confidence || 0) * 100)}%)
              </button>
            ))}
          </div>
        ) : null}
        {accepted.size > 0 ? (
          <button type="button" className="btn btn-primary ai-agents-accept-btn" disabled={!!busy} onClick={onAcceptTags}>
            Accept {accepted.size} tag{accepted.size === 1 ? '' : 's'}
          </button>
        ) : null}
      </section>
    </div>
  );
}
