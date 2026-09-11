import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MultiPickFilter from './MultiPickFilter.jsx';
import {
  tradeIsClosed as isClosedTrade,
  getTradeOutcome
} from '../utils/tradeStatus.js';
import {
  uniqueSortedStrings,
  canonicalTradeVwapBand,
  canonicalTradeHvnBand,
  canonicalTradeTrendAlign,
  canonicalTradeConfluenceTier,
  canonicalTradeTop1,
  tradeKillzone,
  SLICE_SESSION_KEYS,
  SLICE_TREND_ALIGN_KEYS,
  SLICE_KILLZONE_KEYS,
  SLICE_CONFLUENCE_TIER_KEYS,
  SLICE_TOP1_KEYS,
  SLICE_WEEKDAY_ORDER,
  formatWeekdaySliceOption,
  formatKillzoneSliceOption
} from '../utils/tradeSliceFilters.js';
import {
  EMPTY_LAB_CONSTRAINTS,
  tradeMatchesLabConstraints,
  labConstraintsToFilterPatch,
  buildLabConstraintsSummary,
  labConstraintsAreEmpty
} from '../utils/labConstraints.js';
import { tradesMatchingFilterPatch, computeTradesInsightStats } from '../utils/filterPatchMatch.js';
import {
  resolveFilterDimensions,
  stripDisabledLabConstraints,
  FILTER_LAB_RANK_OPTIONS,
  rankByLabel
} from '../utils/filterDimensions.js';

function formatMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

function computeFilterResults(trades, breakEvenAmount) {
  const be = Math.max(0, Number(breakEvenAmount ?? 50) || 50);
  const closed = trades.filter((t) => isClosedTrade(t));
  let wins = 0;
  let losses = 0;
  for (const t of closed) {
    const o = getTradeOutcome(t, be);
    if (o === 'TP' || (o === 'CLOSED' && Number(t.profit) > be)) wins += 1;
    else if (o === 'SL' || (o === 'CLOSED' && Number(t.profit) < -be)) losses += 1;
  }
  const decisive = wins + losses;
  const pnl = trades.reduce((s, t) => s + Number(t.profit || 0), 0);
  return {
    tradeCount: trades.length,
    closedCount: closed.length,
    wins,
    losses,
    decisive,
    winRate: decisive > 0 ? Number(((wins / decisive) * 100).toFixed(1)) : null,
    pnl: Number(pnl.toFixed(2))
  };
}

const SESSION_LABELS = { asian: 'Asian', london: 'London', newYork: 'NY' };

const SEARCH_DIM_LABELS = {
  timeframe: 'TF',
  vwap: 'VWAP',
  hvn: 'HVN',
  trend: 'Trend',
  killzone: 'Killzone',
  confluence: 'Confluence',
  top1: 'Top-1',
  session: 'Session',
  bias: 'Bias',
  setup: 'Setup',
  tags: 'Tags',
  symbol: 'Pair',
  channel: 'Channel',
  side: 'Type',
  weekday: 'Weekday'
};

export default function FilterLabPanel({
  enabled = true,
  standalone = false,
  aiEnabled = false,
  tradeIds = [],
  scopeTrades = [],
  filteredTrades = [],
  tradeFilters = {},
  tradeBuiltinColumns = [],
  timeScope = 'ALL',
  scopeFrom = '',
  scopeTo = '',
  filterSummary = '',
  breakEvenAmount = 50,
  tradePresets = [],
  setTradeFilters = () => {},
  onSelectCombo = null,
  selectedComboId = '',
  testIdPrefix = 'filter-lab'
}) {
  const filterDims = useMemo(
    () => resolveFilterDimensions(tradeBuiltinColumns),
    [tradeBuiltinColumns]
  );
  const dimOn = (id) => filterDims.enabled.has(id);

  const [collapsed, setCollapsed] = useState(() => {
    if (standalone) return false;
    try { return window.localStorage.getItem('ts-filter-lab-collapsed') === '1'; } catch (_) { return false; }
  });
  const [labConstraints, setLabConstraints] = useState(() => ({ ...EMPTY_LAB_CONSTRAINTS }));
  const [rankBy, setRankBy] = useState(() => {
    try { return window.localStorage.getItem('ts-filter-lab-rank-by') || 'balanced'; } catch (_) { return 'balanced'; }
  });
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [err, setErr] = useState('');
  const [optimizer, setOptimizer] = useState(null);
  const [aiResult, setAiResult] = useState(null);

  useEffect(() => {
    setLabConstraints((prev) => stripDisabledLabConstraints(prev, tradeBuiltinColumns));
  }, [tradeBuiltinColumns]);

  useEffect(() => {
    try { window.localStorage.setItem('ts-filter-lab-rank-by', rankBy); } catch (_) { /* noop */ }
  }, [rankBy]);

  const poolTrades = useMemo(() => {
    const base = scopeTrades.length ? scopeTrades : filteredTrades;
    const constraints = stripDisabledLabConstraints(labConstraints, tradeBuiltinColumns);
    return base.filter((t) => tradeMatchesLabConstraints(t, constraints));
  }, [scopeTrades, filteredTrades, labConstraints, tradeBuiltinColumns]);

  const poolTradeIds = useMemo(() => poolTrades.map((t) => t.id), [poolTrades]);

  const constraintOptions = useMemo(() => {
    const base = scopeTrades.length ? scopeTrades : filteredTrades;
    return {
      tfs: uniqueSortedStrings(
        base.map((t) => String(t.timeframe || '').toUpperCase().trim()).filter(Boolean)
      ),
      pairs: uniqueSortedStrings(base.map((t) => t.symbol)),
      biases: uniqueSortedStrings(base.map((t) => t.bias)),
      setups: uniqueSortedStrings(
        [
          ...base.flatMap((t) => (Array.isArray(t.presetTags) ? t.presetTags : [])),
          ...base.map((t) => t.setup).filter(Boolean),
          ...(Array.isArray(tradePresets) ? tradePresets : [])
        ],
        { limit: 200 }
      ),
      vwapBands: (() => {
        const raw = [...new Set(base.map((t) => canonicalTradeVwapBand(t)).filter(Boolean))];
        const order = { yes: 0, no: 1, na: 2 };
        raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
        return raw;
      })(),
      hvnBands: (() => {
        const raw = [...new Set(base.map((t) => canonicalTradeHvnBand(t)).filter(Boolean))];
        const order = { yes: 0, no: 1, na: 2 };
        raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
        return raw;
      })(),
      trendAligns: (() => {
        const raw = [...new Set(base.map((t) => canonicalTradeTrendAlign(t)).filter(Boolean))];
        const order = { with: 0, against: 1, neutral: 2, na: 3 };
        raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
        return raw;
      })(),
      killzones: (() => {
        const raw = [...new Set(base.map((t) => tradeKillzone(t)).filter(Boolean))];
        const order = Object.fromEntries(SLICE_KILLZONE_KEYS.map((k, i) => [k, i]));
        raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
        return raw;
      })(),
      confluenceTiers: (() => {
        const raw = [...new Set(base.map((t) => canonicalTradeConfluenceTier(t)).filter(Boolean))];
        const order = { 0: 0, '1-2': 1, '3+': 2 };
        raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
        return raw;
      })(),
      top1Values: (() => {
        const raw = [...new Set(base.map((t) => canonicalTradeTop1(t)).filter(Boolean))];
        const order = { yes: 0, no: 1 };
        raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
        return raw;
      })(),
      sessions: [...SLICE_SESSION_KEYS],
      tags: uniqueSortedStrings(
        base.flatMap((t) => [
          ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
          ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
        ]),
        { limit: 100 }
      ),
      channels: uniqueSortedStrings(base.map((t) => t.channel).filter(Boolean))
    };
  }, [scopeTrades, filteredTrades, tradePresets]);

  const labConstraintsSummary = useMemo(
    () => buildLabConstraintsSummary(stripDisabledLabConstraints(labConstraints, tradeBuiltinColumns)),
    [labConstraints, tradeBuiltinColumns]
  );

  const updateConstraint = useCallback((patch) => {
    setLabConstraints((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (standalone) return;
    try { window.localStorage.setItem('ts-filter-lab-collapsed', collapsed ? '1' : '0'); } catch (_) { /* noop */ }
  }, [collapsed, standalone]);

  useEffect(() => {
    setOptimizer(null);
    setAiResult(null);
    setErr('');
  }, [tradeIds.join(','), filterSummary, labConstraintsSummary, rankBy]);

  const currentResults = useMemo(
    () => computeFilterResults(filteredTrades, breakEvenAmount),
    [filteredTrades, breakEvenAmount]
  );

  const labPoolResults = useMemo(
    () => computeFilterResults(poolTrades, breakEvenAmount),
    [poolTrades, breakEvenAmount]
  );

  const handleApplyCombo = useCallback((combo) => {
    if (!combo?.filterPatch) return;
    const patch = {
      ...labConstraintsToFilterPatch(stripDisabledLabConstraints(labConstraints, tradeBuiltinColumns)),
      ...combo.filterPatch
    };
    setTradeFilters(patch);
  }, [setTradeFilters, labConstraints, tradeBuiltinColumns]);

  const handleSelectCombo = useCallback((combo, idx) => {
    if (!onSelectCombo) return;
    const base = stripDisabledLabConstraints(labConstraints, tradeBuiltinColumns);
    const matched = tradesMatchingFilterPatch(poolTrades, base, combo.filterPatch);
    onSelectCombo({
      id: `${combo.label}-${idx}`,
      type: 'combo',
      title: combo.label,
      subtitle: `Best combo #${idx + 1} · ranked by ${rankByLabel(rankBy)}`,
      filterPatch: { ...labConstraintsToFilterPatch(base), ...combo.filterPatch },
      trades: matched,
      stats: computeTradesInsightStats(matched, breakEvenAmount),
      combo
    });
  }, [onSelectCombo, poolTrades, labConstraints, tradeBuiltinColumns, breakEvenAmount, rankBy]);

  const runOptimizer = useCallback(async () => {
    if (!window.electronAPI?.searchBestFilterCombinations) return;
    if (poolTradeIds.length === 0 && tradeIds.length === 0) {
      setErr('No trades in scope — widen calendar or relax lock filters.');
      return;
    }
    setLoading(true);
    setErr('');
    setAiResult(null);
    try {
      const r = await window.electronAPI.searchBestFilterCombinations({
        tradeIds: scopeTrades.length ? scopeTrades.map((t) => t.id) : tradeIds,
        lockedFilters: stripDisabledLabConstraints(labConstraints, tradeBuiltinColumns),
        rankBy,
        disabledDimensions: filterDims.disabledOptimizerIds,
        minDecisive: 3,
        maxResults: 12
      });
      if (r?.ok) {
        setOptimizer(r);
      } else if (r?.error === 'NO_DECISIVE_OUTCOMES') {
        setErr('Need closed trades with clear wins/losses in this period.');
      } else if (r?.error === 'NO_TRADES_FOR_LOCKS') {
        setErr(`No trades match locked filters${r.lockedSummary ? `: ${r.lockedSummary}` : '.'}`);
      } else if (r?.error === 'NO_TRADES_FOR_SYMBOL') {
        setErr(`No trades for ${r.anchorSymbol} in the current scope.`);
      } else {
        setErr(r?.error || 'Optimizer failed');
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [tradeIds, scopeTrades, poolTradeIds, labConstraints, rankBy, filterDims.disabledOptimizerIds, tradeBuiltinColumns]);

  const runAiSummary = useCallback(async () => {
    if (!aiEnabled || !optimizer?.results?.length) return;
    setAiLoading(true);
    setErr('');
    try {
      const lockCtx = optimizer.lockedSummary || labConstraintsSummary;
      const r = await window.electronAPI.getAiFilterOptimizerSummary({
        context: `${filterSummary}${lockCtx ? ` · Locked: ${lockCtx}` : ''} · Rank: ${rankByLabel(optimizer.rankBy || rankBy)}`,
        optimizerResult: optimizer
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
  }, [aiEnabled, optimizer, filterSummary, labConstraintsSummary, rankBy]);

  const searchableDims = useMemo(() => {
    if (!optimizer?.excludedDimensions) return [];
    return Object.keys(SEARCH_DIM_LABELS)
      .filter((d) => !optimizer.excludedDimensions.includes(d))
      .map((d) => SEARCH_DIM_LABELS[d]);
  }, [optimizer]);

  if (!enabled) return null;

  return (
    <div
      className={`panel-section dashboard-stats-ai-card filter-lab-panel ${standalone ? 'filter-lab-panel--standalone' : ''} ${collapsed ? 'dashboard-stats-ai-card--minimized' : ''}`}
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="dashboard-stats-ai-card__bar">
        {standalone ? (
          <div className="dashboard-stats-ai-card__title filter-lab-standalone-title">🧪 Find best filters</div>
        ) : (
          <button
            type="button"
            className="dashboard-stats-ai-card__toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            <span className="dashboard-stats-ai-card__chev">{collapsed ? '▶' : '▼'}</span>
            <span className="dashboard-stats-ai-card__title">🧪 Filter lab</span>
          </button>
        )}
        {(!collapsed || standalone) && (
          <div className="dashboard-stats-ai-card__tools">
            <label className="filter-lab-rank-by">
              <span className="filter-lab-rank-by-label">Rank by</span>
              <select
                className="filter-select filter-lab-rank-select"
                value={rankBy}
                onChange={(e) => setRankBy(e.target.value)}
                data-testid={`${testIdPrefix}-rank-by`}
              >
                {FILTER_LAB_RANK_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={loading || (poolTradeIds.length === 0 && tradeIds.length === 0)}
              onClick={runOptimizer}
              data-testid={`${testIdPrefix}-run`}
            >
              {loading ? 'Scanning…' : 'Find best filters'}
            </button>
            {aiEnabled && optimizer?.results?.length > 0 && (
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
        )}
      </div>

      {(!collapsed || standalone) && (
        <>
          {!standalone && (
            <div className="dashboard-stats-ai-card__context">{filterSummary || '—'}</div>
          )}
          <div className="dashboard-stats-ai-card__meta filter-lab-current">
            <span>
              Current: <strong>{currentResults.tradeCount}</strong> trades
              {currentResults.decisive > 0 && (
                <>
                  {' '}· WR <strong>{currentResults.winRate}%</strong>
                  <span style={{ color: currentResults.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {' '}· P&amp;L <strong>{formatMoney(currentResults.pnl)}</strong>
                  </span>
                </>
              )}
            </span>
            {!labConstraintsAreEmpty(stripDisabledLabConstraints(labConstraints, tradeBuiltinColumns)) && (
              <span className="filter-lab-pool-meta">
                Lab pool: <strong>{labPoolResults.tradeCount}</strong> trades
                {labPoolResults.decisive > 0 && (
                  <> · WR <strong>{labPoolResults.winRate}%</strong></>
                )}
              </span>
            )}
          </div>

          <div className="filter-lab-constraints">
            <div className="filter-lab-constraints-title">Lock filters (optional)</div>
            <p className="filter-lab-constraints-hint">
              Pick constraints first — the optimizer finds best combos among the other dimensions.
            </p>
            {filterDims.disabled.length > 0 && (
              <div className="filter-lab-disabled-dims" data-testid={`${testIdPrefix}-disabled-dims`}>
                <span className="filter-lab-disabled-label">Hidden in Settings → Columns:</span>
                {filterDims.disabled.map((d) => (
                  <span key={d.id} className="filter-lab-disabled-chip" title="Column hidden — not used in Filter Lab or optimizer">
                    {d.label}
                  </span>
                ))}
              </div>
            )}
            <div className="filter-lab-constraints-grid">
              {dimOn('weekday') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-weekday`}
                  label="Weekday"
                  options={SLICE_WEEKDAY_ORDER}
                  selected={labConstraints.sliceWeekdays}
                  onChange={(v) => updateConstraint({ sliceWeekdays: v })}
                  formatOption={formatWeekdaySliceOption}
                  allButtonLabel="All days"
                  allButtonTitle="No weekday lock"
                />
              )}
              {dimOn('symbol') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-pair`}
                  label="Pair"
                  options={constraintOptions.pairs}
                  selected={labConstraints.slicePairs}
                  onChange={(v) => updateConstraint({ slicePairs: v })}
                />
              )}
              {dimOn('timeframe') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-tf`}
                  label="TF"
                  options={constraintOptions.tfs}
                  selected={labConstraints.sliceTimeframes}
                  onChange={(v) => updateConstraint({ sliceTimeframes: v })}
                />
              )}
              {dimOn('session') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-session`}
                  label="Session"
                  options={constraintOptions.sessions}
                  selected={labConstraints.sliceSessions}
                  onChange={(v) => updateConstraint({ sliceSessions: v })}
                  formatOption={(s) => SESSION_LABELS[s] || s}
                />
              )}
              {dimOn('vwap') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-vwap`}
                  label="VWAP"
                  options={constraintOptions.vwapBands}
                  selected={labConstraints.sliceVwapBands}
                  onChange={(v) => updateConstraint({ sliceVwapBands: v })}
                  formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
                />
              )}
              {dimOn('hvn') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-hvn`}
                  label="HVN"
                  options={constraintOptions.hvnBands}
                  selected={labConstraints.sliceHvnBands}
                  onChange={(v) => updateConstraint({ sliceHvnBands: v })}
                  formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
                />
              )}
              {dimOn('trend') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-trend`}
                  label="Trend"
                  options={constraintOptions.trendAligns}
                  selected={labConstraints.sliceTrendAligns}
                  onChange={(v) => updateConstraint({ sliceTrendAligns: v })}
                  formatOption={(v) => (v === 'na' ? 'n/a' : v.toUpperCase())}
                />
              )}
              {dimOn('killzone') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-killzone`}
                  label="Killzone"
                  options={constraintOptions.killzones.length ? constraintOptions.killzones : SLICE_KILLZONE_KEYS}
                  selected={labConstraints.sliceKillzones}
                  onChange={(v) => updateConstraint({ sliceKillzones: v })}
                  formatOption={formatKillzoneSliceOption}
                />
              )}
              {dimOn('confluence') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-confluence`}
                  label="Confluence"
                  options={constraintOptions.confluenceTiers.length ? constraintOptions.confluenceTiers : SLICE_CONFLUENCE_TIER_KEYS}
                  selected={labConstraints.sliceConfluenceTiers}
                  onChange={(v) => updateConstraint({ sliceConfluenceTiers: v })}
                />
              )}
              {dimOn('top1') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-top1`}
                  label="Top-1"
                  options={constraintOptions.top1Values.length ? constraintOptions.top1Values : SLICE_TOP1_KEYS}
                  selected={labConstraints.sliceTop1Values}
                  onChange={(v) => updateConstraint({ sliceTop1Values: v })}
                  formatOption={(v) => v.toUpperCase()}
                />
              )}
              {dimOn('bias') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-bias`}
                  label="Bias"
                  options={constraintOptions.biases}
                  selected={labConstraints.sliceBiases}
                  onChange={(v) => updateConstraint({ sliceBiases: v })}
                />
              )}
              {dimOn('setup') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-setup`}
                  label="Setup"
                  options={constraintOptions.setups}
                  selected={labConstraints.sliceSetups}
                  onChange={(v) => updateConstraint({ sliceSetups: v })}
                  maxMenuHeight={280}
                />
              )}
              {dimOn('tags') && (
                <MultiPickFilter
                  testId={`${testIdPrefix}-lock-tags`}
                  label="Tags"
                  options={constraintOptions.tags}
                  selected={labConstraints.sliceTags}
                  onChange={(v) => updateConstraint({ sliceTags: v })}
                />
              )}
              {(dimOn('side') || dimOn('channel')) && (
                <div className="filter-lab-constraint-selects">
                  {dimOn('side') && (
                    <label className="filter-lab-anchor-label">
                      Type
                      <select
                        className="filter-select"
                        value={labConstraints.filterType}
                        onChange={(e) => updateConstraint({ filterType: e.target.value })}
                        data-testid={`${testIdPrefix}-lock-type`}
                      >
                        <option value="ALL">All</option>
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </label>
                  )}
                  {dimOn('channel') && (
                    <label className="filter-lab-anchor-label">
                      Channel
                      <select
                        className="filter-select"
                        value={labConstraints.filterChannel}
                        onChange={(e) => updateConstraint({ filterChannel: e.target.value })}
                        data-testid={`${testIdPrefix}-lock-channel`}
                      >
                        <option value="ALL">All</option>
                        {constraintOptions.channels.map((ch) => (
                          <option key={ch} value={ch}>{ch}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
            {labConstraintsSummary && (
              <div className="filter-lab-locked-summary" data-testid={`${testIdPrefix}-locked-summary`}>
                Locked: {labConstraintsSummary}
              </div>
            )}
          </div>

          {optimizer?.ok && optimizer.results?.length > 0 && (
            <div className="filter-lab-results" data-testid={`${testIdPrefix}-results`}>
              <div className="filter-lab-results-title">
                Top combinations
                {optimizer.lockedSummary ? ` · ${optimizer.lockedSummary}` : ''}
                <span className="filter-lab-results-sub">
                  ({optimizer.poolSize} trades · ranked by {rankByLabel(optimizer.rankBy || rankBy)})
                </span>
              </div>
              <div className="filter-lab-results-hint">
                Click a row to preview matching trades above.
                {searchableDims.length > 0 && <> Searching: {searchableDims.join(', ')}.</>}
              </div>
              <div className="filter-lab-combo-list">
                {optimizer.results.map((combo, idx) => {
                  const comboId = `${combo.label}-${idx}`;
                  const selected = selectedComboId === comboId;
                  return (
                    <div
                      key={comboId}
                      className={`filter-lab-combo-item ${selected ? 'filter-lab-combo-item--selected' : ''}`}
                    >
                      <button
                        type="button"
                        className="filter-lab-combo-select"
                        onClick={() => handleSelectCombo(combo, idx)}
                        title="Preview trades in this combination"
                      >
                        <span className="filter-lab-combo-rank">#{idx + 1}</span>
                        <span className="filter-lab-combo-label">{combo.label}</span>
                        <span className="filter-lab-combo-stats">
                          {combo.metrics.winRate}% WR · {formatMoney(combo.metrics.pnl)}
                          {' '}· {combo.metrics.decisive} decisive · {combo.metrics.trades} trades
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleApplyCombo(combo)}
                        title="Apply locked filters + this combination"
                      >
                        Apply
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
                <div className="filter-lab-apply-first"><strong>Apply first:</strong> {aiResult.apply_first}</div>
              )}
              {aiResult.best_combos?.length > 0 && (
                <ul className="ai-insights-list">
                  {aiResult.best_combos.map((x, i) => <li key={`bc${i}`}>{x}</li>)}
                </ul>
              )}
              {aiResult.caution && <div className="dashboard-stats-ai-card__caution">{aiResult.caution}</div>}
            </div>
          )}

          {err ? <div className="ai-insights-error">{err}</div> : null}
        </>
      )}
    </div>
  );
}
