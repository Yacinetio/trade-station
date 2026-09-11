import React, { useEffect, useImperativeHandle, useMemo, useState, useCallback, forwardRef, useRef } from 'react';

/** Verdict/usage polling while tab hidden wastes IPC; MT5 trade ticks reset intervals when refreshKey is abused */
const AI_INSIGHTS_POLL_MS = 14000;

function fmtAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function ScoreBadge({ score, action }) {
  const tone = action === 'block'
    ? { bg: 'color-mix(in srgb, var(--danger) 18%, transparent)', fg: 'var(--danger)', label: 'BLOCK' }
    : action === 'reduce'
      ? { bg: 'color-mix(in srgb, var(--warning) 18%, transparent)', fg: 'var(--warning)', label: 'REDUCE' }
      : { bg: 'color-mix(in srgb, var(--success) 18%, transparent)', fg: 'var(--success)', label: 'ALLOW' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 6,
      background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.4
    }}>
      <span>{tone.label}</span>
      {Number.isFinite(score) && <span style={{ opacity: 0.85 }}>{score}%</span>}
    </span>
  );
}

const AiInsightsPanel = forwardRef(function AiInsightsPanel({
  enabled = false,
  /** Kept for backwards compatibility; polling no longer resets on every trade tick */
  refreshKey = 0,
  /** When false (route hidden but component still mounted), skip timers and auto dashboard AI */
  pollActive = true,
  selectedTradeIds = [],
  /** When set (e.g. Analytics dashboard scope), summary uses these trade IDs */
  performanceTradeIds = null,
  /** Auto-fetch AI summary when performanceTradeIds changes */
  autoRefreshPerformanceScope = false,
  layoutVariant = 'default'
}, ref) {
  const [verdicts, setVerdicts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [aiOnline, setAiOnline] = useState(null);
  const [usage, setUsage] = useState(null);
  const [journalSavedHint, setJournalSavedHint] = useState('');
  const [bodyCollapsed, setBodyCollapsed] = useState(() => {
    try { return window.localStorage.getItem('ts-ai-insights-collapsed') === '1'; } catch (_) { return false; }
  });

  useEffect(() => {
    try { window.localStorage.setItem('ts-ai-insights-collapsed', bodyCollapsed ? '1' : '0'); } catch (_) { /* noop */ }
  }, [bodyCollapsed]);

  const refreshVerdicts = useCallback(async () => {
    if (!window.electronAPI?.getAiRecentVerdicts) return;
    try {
      const r = await window.electronAPI.getAiRecentVerdicts({ limit: 50 });
      setVerdicts(Array.isArray(r?.rows) ? r.rows : []);
    } catch (_) { /* noop */ }
  }, []);

  const clearVerdictHistory = useCallback(async () => {
    if (!enabled || !window.electronAPI?.clearAiVerdictHistory) return;
    if (verdicts.length === 0) return;
    if (!window.confirm('Clear all recent signal verdicts from this session?')) return;
    try {
      await window.electronAPI.clearAiVerdictHistory();
      setVerdicts([]);
    } catch (_) { /* noop */ }
  }, [enabled, verdicts.length]);

  const refreshUsage = useCallback(async () => {
    if (!window.electronAPI?.getAiUsage) return;
    try {
      const r = await window.electronAPI.getAiUsage();
      if (r) setUsage(r);
    } catch (_) { /* noop */ }
  }, []);

  /** Run the performance summary. If `useSelected` is true and the parent passed
   *  selected trade IDs, the AI is told to analyse only that subset. */
  const requestSummary = useCallback(async (useSelected = false, explicitIds = null) => {
    if (!enabled || !window.electronAPI?.getAiPerformanceSummary) return;
    setSummaryLoading(true);
    setSummaryError('');
    setJournalSavedHint('');
    try {
      const payload = { limit: 30 };
      const ids =
        Array.isArray(explicitIds) && explicitIds.length > 0
          ? explicitIds
          : useSelected && Array.isArray(selectedTradeIds) && selectedTradeIds.length > 0
            ? selectedTradeIds
            : null;
      if (ids && ids.length > 0) {
        payload.tradeIds = ids.slice(0, 60);
      }
      const r = await window.electronAPI.getAiPerformanceSummary(payload);
      if (r?.ok) {
        setSummary(r);
        setAiOnline(true);
        setJournalSavedHint(r.journalSaved ? 'Saved AI review to that trade\'s Notes and chart confidence.' : '');
      } else if (r?.error === 'NO_CLOSED_TRADES') {
        setSummary(null);
        setSummaryError('No closed trades in scope yet — AI will analyse them once any close.');
      } else if (r?.error === 'NO_SELECTED_TRADES') {
        setSummary(null);
        setSummaryError('No trades selected. Tick rows in the table first, then click "Analyse selected".');
      } else if (r?.error === 'AI_DISABLED') {
        setSummary(null);
        setSummaryError('AI signal-check is disabled in Settings → AI.');
      } else if (r?.error === 'rate_limited' || r?.rateLimited) {
        setSummary(null);
        setAiOnline(false);
        setSummaryError(`Provider rate-limited (HTTP 429)${r?.retryAfter ? ` — retry in ~${r.retryAfter}s` : ''}.`);
      } else if (r?.error === 'json_parse_failed') {
        setSummary(null);
        setAiOnline(false);
        setSummaryError(
          'The AI reply was not valid JSON — usually fixed by running analyse again or switching model under Settings → AI.'
        );
      } else {
        setSummary(null);
        setAiOnline(false);
        setSummaryError(`AI offline: ${r?.error || 'unknown'}`);
      }
      refreshUsage();
    } catch (e) {
      setSummary(null);
      setAiOnline(false);
      setSummaryError(String(e?.message || e));
    } finally {
      setSummaryLoading(false);
    }
  }, [enabled, selectedTradeIds, refreshUsage]);

  const requestPerformanceScopeSummary = useCallback(() => {
    const ids = Array.isArray(performanceTradeIds) ? performanceTradeIds.filter((x) => x != null) : [];
    if (ids.length === 0) return;
    return requestSummary(false, ids);
  }, [enabled, performanceTradeIds, requestSummary]);

  useImperativeHandle(ref, () => ({
    analyseSelected: () => requestSummary(true),
    analyseRecent: () => requestSummary(false),
    analysePerformanceScope: () => requestPerformanceScopeSummary()
  }), [requestSummary, requestPerformanceScopeSummary]);

  const perfScopeKey = useMemo(() => {
    const ids = Array.isArray(performanceTradeIds) ? performanceTradeIds.map(String).sort().join('|') : '';
    return `${ids}:${refreshKey}`;
  }, [performanceTradeIds, refreshKey]);

  const requestPerfScopeRef = useRef(requestPerformanceScopeSummary);
  requestPerfScopeRef.current = requestPerformanceScopeSummary;

  useEffect(() => {
    if (!pollActive || !enabled || !autoRefreshPerformanceScope || layoutVariant !== 'dashboardStrip') return undefined;
    const ids = Array.isArray(performanceTradeIds) ? performanceTradeIds.filter((x) => x != null) : [];
    if (ids.length === 0) return undefined;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) requestPerfScopeRef.current?.();
    }, 2800);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pollActive, enabled, autoRefreshPerformanceScope, layoutVariant, perfScopeKey]);

  useEffect(() => {
    if (!pollActive || !enabled) return undefined;
    refreshVerdicts();
    refreshUsage();
    const t = window.setInterval(() => {
      refreshVerdicts();
      refreshUsage();
    }, AI_INSIGHTS_POLL_MS);
    return () => window.clearInterval(t);
  }, [pollActive, enabled, refreshVerdicts, refreshUsage]);

  const stats = useMemo(() => {
    if (!verdicts.length) return null;
    const scored = verdicts.filter((v) => Number.isFinite(Number(v.score)));
    const allow = verdicts.filter((v) => v.action === 'allow').length;
    const block = verdicts.filter((v) => v.action === 'block').length;
    const reduce = verdicts.filter((v) => v.action === 'reduce').length;
    const avg = scored.length ? Math.round(scored.reduce((acc, v) => acc + Number(v.score), 0) / scored.length) : null;
    return { allow, block, reduce, avg, total: verdicts.length };
  }, [verdicts]);

  const selectedCount = Array.isArray(selectedTradeIds) ? selectedTradeIds.length : 0;
  const perfScopeCount = Array.isArray(performanceTradeIds) ? performanceTradeIds.length : 0;
  const isDashboardStrip = layoutVariant === 'dashboardStrip';

  if (!enabled) {
    return (
      <div className={`panel-section ai-insights-panel ${bodyCollapsed ? 'ai-insights-panel--minimized' : ''} ${isDashboardStrip ? 'ai-insights-panel--dashboard-strip' : ''}`}>
        <div className="ai-insights-minimize-bar">
          <button
            type="button"
            className="ai-insights-minimize-toggle"
            onClick={() => setBodyCollapsed((c) => !c)}
            aria-expanded={!bodyCollapsed}
            title={bodyCollapsed ? 'Expand AI Insights' : 'Minimize AI Insights'}
          >
            <span className="ai-insights-minimize-icon">{bodyCollapsed ? '▶' : '▼'}</span>
            <span className="ai-insights-minimize-title">🤖 AI Insights</span>
          </button>
          <span className="ai-insights-badge ai-insights-badge--off">Disabled</span>
        </div>
        {!bodyCollapsed && (
          <p style={{ color: 'var(--text2)', fontSize: 12, marginTop: 8 }}>
            Free AI signal-check is off. Enable it in <strong>Settings → AI</strong> to get a 0–100% confidence score
            on every incoming signal, plus an honest review of your selected (or recent) trades — no API key required.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`panel-section ai-insights-panel ${bodyCollapsed ? 'ai-insights-panel--minimized' : ''} ${isDashboardStrip ? 'ai-insights-panel--dashboard-strip' : ''}`}>
      <div className="ai-insights-minimize-bar">
        <button
          type="button"
          className="ai-insights-minimize-toggle"
          onClick={() => setBodyCollapsed((c) => !c)}
          aria-expanded={!bodyCollapsed}
          title={bodyCollapsed ? 'Expand AI Insights' : 'Minimize AI Insights'}
        >
          <span className="ai-insights-minimize-icon">{bodyCollapsed ? '▶' : '▼'}</span>
          <span className="ai-insights-minimize-title">
            {isDashboardStrip ? '🤖 AI Insights — dashboard scope' : '🤖 AI Insights'}
          </span>
        </button>
        {!bodyCollapsed && (
          <div className="ai-insights-header-tools">
            {usage && (
              <span
                className="ai-insights-badge ai-insights-badge--on"
                title={`Today: ${usage.used} successful AI responses · ${usage.errors || 0} errors · ${usage.rateLimited || 0} provider HTTP 429\n${usage.lastCallAt ? 'Last call: ' + new Date(usage.lastCallAt).toLocaleTimeString() : 'No calls yet today'}`}
              >
                {usage.used} today
              </span>
            )}
            {aiOnline === false && <span className="ai-insights-badge ai-insights-badge--off">Offline</span>}
            {aiOnline === true && <span className="ai-insights-badge ai-insights-badge--on">Online</span>}
            {isDashboardStrip && perfScopeCount > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={summaryLoading}
                onClick={() => requestPerformanceScopeSummary()}
                title="Re-run AI on trades matching current dashboard filters"
              >
                {summaryLoading ? 'Thinking…' : `📊 Refresh scope (${perfScopeCount})`}
              </button>
            )}
            {!isDashboardStrip && (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={summaryLoading || selectedCount === 0}
                  onClick={() => requestSummary(true)}
                  title={selectedCount > 0
                    ? `Send ${selectedCount} selected trades to the AI for analysis`
                    : 'Tick rows in the trades table first, then click here'}
                >
                  {summaryLoading ? 'Thinking…' : `🎯 Analyse selected${selectedCount ? ` (${selectedCount})` : ''}`}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={summaryLoading}
                  onClick={() => requestSummary(false)}
                  title="Analyse the most recent closed trades"
                >
                  {summaryLoading ? 'Thinking…' : '✨ Analyse recent'}
                </button>
              </>
            )}
            {isDashboardStrip && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={summaryLoading}
                onClick={() => requestSummary(false)}
                title="Analyse the most recent closed trades globally"
              >
                {summaryLoading ? 'Thinking…' : '✨ Recent closed (global)'}
              </button>
            )}
          </div>
        )}
      </div>

      {!bodyCollapsed && stats && (
        <div className="ai-insights-stats">
          <div className="ai-insights-stat">
            <span className="ai-insights-stat-label">Avg confidence</span>
            <span className="ai-insights-stat-value">{stats.avg != null ? `${stats.avg}%` : '—'}</span>
          </div>
          <div className="ai-insights-stat">
            <span className="ai-insights-stat-label">Allowed</span>
            <span className="ai-insights-stat-value pos">{stats.allow}</span>
          </div>
          <div className="ai-insights-stat">
            <span className="ai-insights-stat-label">Reduced</span>
            <span className="ai-insights-stat-value warn">{stats.reduce}</span>
          </div>
          <div className="ai-insights-stat">
            <span className="ai-insights-stat-label">Blocked</span>
            <span className="ai-insights-stat-value neg">{stats.block}</span>
          </div>
        </div>
      )}

      {!bodyCollapsed && summary && summary.ok && (
        <div className="ai-insights-commentary ai-insights-commentary--scroll">
          <div className="ai-insights-scope">
            Analysed <strong>{summary.sample}</strong> {summary.scope === 'selected' ? 'selected' : 'recent closed'} trades
            {Array.isArray(summary.symbols) && summary.symbols.length > 0 && (
              <> · symbols: <code>{summary.symbols.slice(0, 8).join(', ')}</code></>
            )}
            {' · net '}
            <strong style={{ color: Number(summary.totalPnl) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {Number(summary.totalPnl).toFixed(2)}$
            </strong>
          </div>
          <div className="ai-insights-headline">{summary.headline}</div>
          <div className="ai-insights-list-grid">
            <div>
              <div className="ai-insights-list-title pos">What's working</div>
              <ul className="ai-insights-list">
                {(summary.wins_list || []).map((w, i) => <li key={`w${i}`}>{w}</li>)}
                {(summary.wins_list || []).length === 0 && <li className="muted">—</li>}
              </ul>
            </div>
            <div>
              <div className="ai-insights-list-title neg">What's leaking</div>
              <ul className="ai-insights-list">
                {(summary.leaks || []).map((l, i) => <li key={`l${i}`}>{l}</li>)}
                {(summary.leaks || []).length === 0 && <li className="muted">—</li>}
              </ul>
            </div>
          </div>
          {summary.next_action && (
            <div className="ai-insights-action">
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Next action: </span>
              {summary.next_action}
            </div>
          )}
          {journalSavedHint ? (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
              {journalSavedHint}
            </div>
          ) : null}
        </div>
      )}
      {!bodyCollapsed && summaryError && <div className="ai-insights-error">{summaryError}</div>}

      {!bodyCollapsed && (
      <div className="ai-insights-feed">
        <div className="ai-insights-feed-header">
          <div className="ai-insights-feed-title">Recent signal verdicts</div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={verdicts.length === 0}
            onClick={clearVerdictHistory}
            title="Remove all verdict rows from this session (does not change saved trade journals)"
          >
            Clear history
          </button>
        </div>
        {verdicts.length === 0 && (
          <div className="ai-insights-empty">
            No verdicts yet. The next signal you receive will be scored here.
          </div>
        )}
        <div className="ai-insights-feed-scroll">
        {verdicts.map((v, idx) => (
          <div key={`${v.at}-${idx}`} className="ai-verdict-row">
            <div className="ai-verdict-row__head">
              <ScoreBadge score={v.score} action={v.action} />
              <span className="ai-verdict-symbol">{v.type || '?'} {v.symbol || '?'}</span>
              <span className="ai-verdict-channel" title={v.channel}>{v.channel || '—'}</span>
              <span className="ai-verdict-time">{fmtAgo(v.at)}</span>
            </div>
            {v.summary && <div className="ai-verdict-summary">{v.summary}</div>}
            {v.entryVsChart ? (
              <div className="ai-verdict-extra"><span className="ai-verdict-extra-label">Entry vs chart</span> {v.entryVsChart}</div>
            ) : null}
            {v.tfBiasVsStructure ? (
              <div className="ai-verdict-extra"><span className="ai-verdict-extra-label">TF bias vs structure</span> {v.tfBiasVsStructure}</div>
            ) : null}
            {v.adjustHint ? (
              <div className="ai-verdict-extra"><span className="ai-verdict-extra-label">Adjust</span> {v.adjustHint}</div>
            ) : null}
            {Array.isArray(v.reasons) && v.reasons.length > 0 && (
              <ul className="ai-verdict-reasons">
                {v.reasons.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        ))}
        </div>
      </div>
      )}
    </div>
  );
});

export default AiInsightsPanel;
