import React, { useCallback, useEffect, useState } from 'react';

function formatMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function WorstTradesPanel({
  aiEnabled = false,
  tradeIds = [],
  filterSummary = '',
  breakEvenAmount = 50,
  disabledOptimizerIds = [],
  onSelectAvoid = null,
  onSelectLoss = null,
  selectedInsightId = '',
  testIdPrefix = 'worst-trades'
}) {
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [err, setErr] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [aiResult, setAiResult] = useState(null);

  const runAnalysis = useCallback(async () => {
    if (!window.electronAPI?.analyzeWorstTrades) return;
    if (tradeIds.length === 0) {
      setErr('No trades in scope — widen calendar or relax filters.');
      return;
    }
    setLoading(true);
    setErr('');
    setAiResult(null);
    try {
      const r = await window.electronAPI.analyzeWorstTrades({
        tradeIds,
        minDecisive: 3,
        maxTrades: 10,
        disabledDimensions: disabledOptimizerIds
      });
      if (r?.ok) {
        setAnalysis(r);
      } else if (r?.error === 'NO_LOSSES') {
        setErr('No clear SL losses in this scope — nothing to flag yet.');
        setAnalysis(r);
      } else if (r?.error === 'NO_TRADES') {
        setErr('No trades in scope.');
      } else {
        setErr(r?.error || 'Analysis failed');
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [tradeIds, disabledOptimizerIds]);

  useEffect(() => {
    setAnalysis(null);
    setAiResult(null);
    setErr('');
  }, [tradeIds.join(','), filterSummary]);

  const runAiSummary = useCallback(async () => {
    if (!aiEnabled || !analysis?.ok) return;
    setAiLoading(true);
    setErr('');
    try {
      const r = await window.electronAPI.getAiWorstTradesSummary({
        context: filterSummary,
        analysisResult: analysis
      });
      if (r?.ok) setAiResult(r);
      else if (r?.error === 'AI_DISABLED') setErr('Enable free AI in Settings → AI.');
      else if (r?.error === 'auth_required' || r?.error === 'http_401') setErr('Add Pollinations API key in Settings → AI.');
      else if (r?.error === 'rate_limited') setErr('Pollinations rate-limited — add API key in Settings → AI.');
      else setErr(r?.error || 'AI offline');
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setAiLoading(false);
    }
  }, [aiEnabled, analysis, filterSummary]);

  return (
    <div className="panel-section filter-lab-worst-panel" data-testid={`${testIdPrefix}-panel`}>
      {!analysis && !loading && !err && (
        <div className="filter-lab-worst-guide">
          <div className="filter-lab-worst-guide-title">How to avoid similar losses</div>
          <ol className="filter-lab-worst-guide-steps">
            <li>Run <strong>Find worst</strong> on your current scope (year, filters, accounts).</li>
            <li><strong>Recurring patterns</strong> — what most losers share (e.g. 80% on Monday).</li>
            <li><strong>Avoid these filters</strong> — underperforming combos; click to preview trades and see &quot;if skipped&quot; WR/P&amp;L impact.</li>
            <li><strong>Biggest losses</strong> — individual tickets; click to inspect context and linked buckets.</li>
          </ol>
          <p className="filter-lab-worst-guide-foot">
            Live rule: stop taking signals that match red avoid rows. Save good filters as Templates; combine templates (e.g. Mon–Thu + Fri) from the Templates menu.
          </p>
        </div>
      )}

      <div className="filter-lab-worst-header">
        <div>
          <h3 className="filter-lab-worst-title">Worst trades &amp; leaks</h3>
          <p className="filter-lab-worst-hint">
            Biggest losses and underperforming filter buckets in the current scope — so you know what to avoid.
          </p>
        </div>
        <div className="filter-lab-worst-tools">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || tradeIds.length === 0}
            onClick={runAnalysis}
            data-testid={`${testIdPrefix}-run`}
          >
            {loading ? 'Scanning…' : 'Find worst'}
          </button>
          {aiEnabled && analysis?.ok && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={aiLoading}
              onClick={runAiSummary}
              data-testid={`${testIdPrefix}-ai`}
            >
              {aiLoading ? 'AI…' : 'AI explain'}
            </button>
          )}
        </div>
      </div>

      {analysis?.ok && (
        <div className="filter-lab-worst-meta">
          <span><strong>{analysis.lossCount}</strong> SL losses in pool</span>
          {analysis.aggregate?.winRate != null && (
            <span> · Scope WR <strong>{analysis.aggregate.winRate}%</strong></span>
          )}
          {analysis.aggregate?.pnl != null && (
            <span style={{ color: analysis.aggregate.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {' '}· P&amp;L <strong>{formatMoney(analysis.aggregate.pnl)}</strong>
            </span>
          )}
        </div>
      )}

      {analysis?.patterns?.length > 0 && (
        <div className="filter-lab-worst-section">
          <div className="filter-lab-worst-section-title">Recurring patterns</div>
          <ul className="ai-insights-list">
            {analysis.patterns.map((p, i) => (
              <li key={`pat-${i}`}>{p.text}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis?.avoid?.length > 0 && (
        <div className="filter-lab-worst-section">
          <div className="filter-lab-worst-section-title">Avoid these filters <span className="filter-lab-click-hint">· click to preview</span></div>
          <div className="filter-lab-combo-list">
            {analysis.avoid.map((a, idx) => {
              const id = `avoid-${idx}`;
              return (
                <div
                  key={id}
                  className={`filter-lab-combo-item filter-lab-combo-item--avoid ${selectedInsightId === id ? 'filter-lab-combo-item--selected' : ''}`}
                >
                  <button
                    type="button"
                    className="filter-lab-combo-select"
                    onClick={() => onSelectAvoid?.(a, idx)}
                    title="Preview trades in this leaky bucket"
                  >
                    <span className="filter-lab-combo-label">{a.label}</span>
                    <span className="filter-lab-combo-stats">
                      {a.winRate}% WR · {formatMoney(a.pnl)} · {a.decisive} decisive
                      {a.trades != null && <> · {a.trades} trades in scope</>}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analysis?.worstTrades?.length > 0 && (
        <div className="filter-lab-worst-section" data-testid={`${testIdPrefix}-trades`}>
          <div className="filter-lab-worst-section-title">Biggest individual losses <span className="filter-lab-click-hint">· click to preview</span></div>
          <div className="filter-lab-combo-list">
            {analysis.worstTrades.map((t, idx) => {
              const id = `loss-${t.id || idx}`;
              return (
                <div
                  key={id}
                  className={`filter-lab-combo-item filter-lab-combo-item--loss ${selectedInsightId === id ? 'filter-lab-combo-item--selected' : ''}`}
                >
                  <button
                    type="button"
                    className="filter-lab-combo-select"
                    onClick={() => onSelectLoss?.(t, idx)}
                    title="Preview this trade"
                  >
                    <span className="filter-lab-combo-rank">#{idx + 1}</span>
                    <span className="filter-lab-combo-label">{t.contextLabel}</span>
                    <span className="filter-lab-combo-stats" style={{ color: 'var(--danger)' }}>
                      {formatMoney(t.profit)} · {formatDate(t.openedAt)}
                    </span>
                    {t.reasons?.length > 0 && (
                      <ul className="filter-lab-trade-reasons">
                        {t.reasons.map((r, ri) => (
                          <li key={ri}>{r.text}</li>
                        ))}
                      </ul>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {aiResult?.ok && (
        <div className="filter-lab-ai">
          {aiResult.headline && <div className="dashboard-stats-ai-card__headline">{aiResult.headline}</div>}
          {aiResult.apply_first && (
            <div className="filter-lab-apply-first"><strong>Do first:</strong> {aiResult.apply_first}</div>
          )}
          {aiResult.leak_patterns?.length > 0 && (
            <>
              <div className="filter-lab-worst-section-title">Leak patterns</div>
              <ul className="ai-insights-list">
                {aiResult.leak_patterns.map((x, i) => <li key={`lp${i}`}>{x}</li>)}
              </ul>
            </>
          )}
          {aiResult.avoid_filters?.length > 0 && (
            <>
              <div className="filter-lab-worst-section-title">Suggested avoids</div>
              <ul className="ai-insights-list">
                {aiResult.avoid_filters.map((x, i) => <li key={`af${i}`}>{x}</li>)}
              </ul>
            </>
          )}
          {aiResult.caution && <div className="dashboard-stats-ai-card__caution">{aiResult.caution}</div>}
        </div>
      )}

      {err ? <div className="ai-insights-error">{err}</div> : null}
    </div>
  );
}
