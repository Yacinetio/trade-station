import React, { useCallback, useEffect, useState } from 'react';

/**
 * Dashboard-only: AI reads aggregated win-rate slices for trades matching ALL current filters.
 * Separate from AiInsightsPanel (per-trade review).
 */
export default function DashboardStatsAiCard({
  enabled = false,
  filterSummary = '',
  tradeIds = [],
  /** When this changes, clear the last AI reply (filters / data moved) */
  scopeKey = ''
}) {
  const [bodyCollapsed, setBodyCollapsed] = useState(() => {
    try { return window.localStorage.getItem('ts-dashboard-stats-ai-collapsed') === '1'; } catch (_) { return false; }
  });

  useEffect(() => {
    try { window.localStorage.setItem('ts-dashboard-stats-ai-collapsed', bodyCollapsed ? '1' : '0'); } catch (_) { /* noop */ }
  }, [bodyCollapsed]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    setResult(null);
    setErr('');
  }, [scopeKey]);

  const run = useCallback(async () => {
    if (!enabled || !window.electronAPI?.getAiDashboardStatsSummary) return;
    setLoading(true);
    setErr('');
    try {
      const r = await window.electronAPI.getAiDashboardStatsSummary({
        tradeIds,
        filterSummary
      });
      if (r?.ok) {
        setResult(r);
      } else if (r?.error === 'AI_DISABLED') {
        setErr('Turn on free AI in Settings → AI first.');
      } else if (r?.error === 'NO_TRADES') {
        setErr('No trades match these filters — widen scope or pick another tab.');
      } else if (r?.error === 'NO_DECISIVE_OUTCOMES') {
        setErr('Need closed trades with a clear win or loss (break-even and EOD closes are excluded). Try “Closed” or “All” tab.');
      } else if (r?.error === 'auth_required' || r?.error === 'http_401') {
        setErr('Pollinations API key required — add it in Settings → AI, then Save Settings.');
      } else if (r?.error === 'rate_limited' || r?.rateLimited) {
        setErr(`Provider rate-limited (HTTP 429)${r.retryAfter ? ` — retry in ~${r.retryAfter}s` : ''}. Add a Pollinations API key in Settings → AI.`);
      } else if (r?.error === 'json_parse_failed') {
        setErr('AI returned invalid JSON — try again or switch model under Settings → AI.');
      } else {
        setErr(`AI offline: ${r?.error || 'unknown'}`);
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [enabled, tradeIds, filterSummary]);

  const canRun = enabled && tradeIds.length > 0 && !loading;

  if (!enabled) {
    return (
      <div
        className={`panel-section dashboard-stats-ai-card ${bodyCollapsed ? 'dashboard-stats-ai-card--minimized' : ''}`}
        data-testid="dashboard-stats-ai-card"
      >
        <div className="dashboard-stats-ai-card__bar">
          <button
            type="button"
            className="dashboard-stats-ai-card__toggle"
            onClick={() => setBodyCollapsed((c) => !c)}
            aria-expanded={!bodyCollapsed}
            title={bodyCollapsed ? 'Expand' : 'Minimize'}
          >
            <span className="dashboard-stats-ai-card__chev">{bodyCollapsed ? '▶' : '▼'}</span>
            <span className="dashboard-stats-ai-card__title">📊 AI filter stats</span>
          </button>
          <span className="ai-insights-badge ai-insights-badge--off">Disabled</span>
        </div>
        {!bodyCollapsed && (
          <p className="dashboard-stats-ai-card__hint">
            Enable <strong>Settings → AI</strong> to compare best / worst TF, VWAP, bias, and two-way combinations for whatever is in the table right now.
          </p>
        )}
      </div>
    );
  }

  const meta = result?.breakdownMeta;

  return (
    <div
      className={`panel-section dashboard-stats-ai-card ${bodyCollapsed ? 'dashboard-stats-ai-card--minimized' : ''}`}
      data-testid="dashboard-stats-ai-card"
    >
      <div className="dashboard-stats-ai-card__bar">
        <button
          type="button"
          className="dashboard-stats-ai-card__toggle"
          onClick={() => setBodyCollapsed((c) => !c)}
          aria-expanded={!bodyCollapsed}
          title={bodyCollapsed ? 'Expand' : 'Minimize'}
        >
          <span className="dashboard-stats-ai-card__chev">{bodyCollapsed ? '▶' : '▼'}</span>
          <span className="dashboard-stats-ai-card__title">📊 AI filter stats</span>
        </button>
        {!bodyCollapsed && (
          <div className="dashboard-stats-ai-card__tools">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!canRun}
              onClick={run}
              title="Send aggregated stats for the current table (all filters + slice pickers) to the free AI"
            >
              {loading ? 'Thinking…' : 'Analyse filtered stats'}
            </button>
          </div>
        )}
      </div>

      {!bodyCollapsed && (
        <>
          <div className="dashboard-stats-ai-card__context">
            {filterSummary || '—'}
          </div>
          {meta && result?.ok && (
            <div className="dashboard-stats-ai-card__meta">
              <span>
                Sample: <strong>{meta.trades}</strong> trades · <strong>{meta.decisive}</strong> decisive W/L
              </span>
              {meta.winRate != null && (
                <span>
                  {' '}
                  · WR <strong>{meta.winRate}%</strong>
                </span>
              )}
              {meta.pnl != null && (
                <span style={{ color: Number(meta.pnl) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {' '}
                  · P&amp;L <strong>{Number(meta.pnl).toFixed(2)}$</strong>
                </span>
              )}
            </div>
          )}
          {result?.ok && result.headline && (
            <div className="dashboard-stats-ai-card__headline">{result.headline}</div>
          )}
          {result?.ok && (
            <div className="ai-insights-list-grid dashboard-stats-ai-card__grid">
              <div>
                <div className="ai-insights-list-title pos">Strongest slices</div>
                <ul className="ai-insights-list">
                  {(result.best_slices || []).map((x, i) => (
                    <li key={`b${i}`}>{x}</li>
                  ))}
                  {(result.best_slices || []).length === 0 && <li className="muted">—</li>}
                </ul>
              </div>
              <div>
                <div className="ai-insights-list-title neg">Weakest / avoid</div>
                <ul className="ai-insights-list">
                  {(result.worst_slices || []).map((x, i) => (
                    <li key={`w${i}`}>{x}</li>
                  ))}
                  {(result.worst_slices || []).length === 0 && <li className="muted">—</li>}
                </ul>
              </div>
            </div>
          )}
          {result?.ok && (result.avoid?.length > 0 || result.try_filters?.length > 0) && (
            <div className="dashboard-stats-ai-card__extras">
              {result.avoid?.length > 0 && (
                <div>
                  <div className="dashboard-stats-ai-card__extras-label">Patterns to avoid</div>
                  <ul className="ai-insights-list">
                    {result.avoid.map((x, i) => (
                      <li key={`a${i}`}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.try_filters?.length > 0 && (
                <div>
                  <div className="dashboard-stats-ai-card__extras-label">Try next</div>
                  <ul className="ai-insights-list">
                    {result.try_filters.map((x, i) => (
                      <li key={`t${i}`}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {result?.ok && result.caution ? (
            <div className="dashboard-stats-ai-card__caution">{result.caution}</div>
          ) : null}
          {err ? <div className="ai-insights-error">{err}</div> : null}
        </>
      )}
    </div>
  );
}
