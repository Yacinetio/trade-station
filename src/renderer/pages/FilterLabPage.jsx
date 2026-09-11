import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import ScopeDateRangeToolbar from '../components/ScopeDateRangeToolbar.jsx';
import FilterLabPanel from '../components/FilterLabPanel.jsx';
import WorstTradesPanel from '../components/WorstTradesPanel.jsx';
import FilterLabTradePreview from '../components/FilterLabTradePreview.jsx';
import MultiPickFilter from '../components/MultiPickFilter.jsx';
import FilterTemplatesControl from '../components/FilterTemplatesControl.jsx';
import { computeTemplateResults } from '../utils/filterPresetMatch.js';
import { MetricPill } from '../components/ui';
import { tradeMatchesTimeScope, isoYmdCustomRangeBounds } from '../utils/timeCalendarScope.js';
import { tradeMatchesSlice, uniqueSortedStrings, canonicalTradeVwapBand, canonicalTradeHvnBand, canonicalTradeTrendAlign, canonicalTradeConfluenceTier, canonicalTradeTop1, tradeKillzone, SLICE_SESSION_KEYS, SLICE_TREND_ALIGN_KEYS, SLICE_KILLZONE_KEYS, SLICE_CONFLUENCE_TIER_KEYS, SLICE_TOP1_KEYS, SLICE_WEEKDAY_ORDER, formatWeekdaySliceOption, formatKillzoneSliceOption } from '../utils/tradeSliceFilters.js';
import { buildFilterSummaryText } from '../utils/filterSummaryText.js';
import { effectiveAccountKeysForScope, tradeMatchesAccountScope } from '../utils/accountScope.js';
import {
  tradeIsBlocked as isBlockedTrade,
  tradeIsClosed as isClosedTrade,
  tradeIsLive,
  tradeMatchesFocusStatus
} from '../utils/tradeStatus.js';
import { tradeFiltersAreDefault } from '../hooks/usePersistedTradeFilters.js';
import { resolveFilterDimensions, stripDisabledSliceFilters } from '../utils/filterDimensions.js';
import { tradesMatchingFilterPatch, computeTradesInsightStats } from '../utils/filterPatchMatch.js';
export default function FilterLabPage({
  trades = [],
  timeScope = 'YEAR',
  setTimeScope,
  analyticsCustomRange = null,
  setAnalyticsCustomRange = () => {},
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  tradeFilters,
  setTradeFilters = () => {},
  resetTradeFilters = () => {},
  routeVisible = true
}) {
  const [settings, setSettings] = useState(null);
  const [insight, setInsight] = useState(null);

  useEffect(() => {
    if (!routeVisible) return undefined;
    let active = true;
    window.electronAPI?.getSettings?.().then((s) => {
      if (active) setSettings(s || null);
    }).catch(() => {});
    return () => { active = false; };
  }, [routeVisible]);

  const {
    filterSymbol = '',
    filterType = 'ALL',
    filterStatus = 'ALL',
    filterChannel = 'ALL',
    signalsTab = 'ALL',
    sliceTimeframes = [],
    slicePairs = [],
    sliceBiases = [],
    sliceSetups = [],
    sliceVwapBands = [],
    sliceHvnBands = [],
    sliceTrendAligns = [],
    sliceKillzones = [],
    sliceConfluenceTiers = [],
    sliceTop1Values = [],
    sliceSessions = [],
    sliceWeekdays = [],
    sliceTags = []
  } = tradeFilters || {};

  const filtersAreDefault = useMemo(() => tradeFiltersAreDefault(tradeFilters), [tradeFilters]);

  const filterDims = useMemo(
    () => resolveFilterDimensions(settings?.tradeBuiltinColumns),
    [settings?.tradeBuiltinColumns]
  );
  const dimOn = (id) => filterDims.enabled.has(id);

  useEffect(() => {
    const patch = stripDisabledSliceFilters(tradeFilters, settings?.tradeBuiltinColumns);
    if (Object.keys(patch).length) setTradeFilters(patch);
  }, [settings?.tradeBuiltinColumns]);

  useEffect(() => {
    setInsight(null);
  }, [
    timeScope,
    analyticsCustomRange?.from,
    analyticsCustomRange?.to,
    filterSymbol,
    signalsTab,
    sliceWeekdays.join(','),
    slicePairs.join(',')
  ]);

  const customScopeBounds = useMemo(
    () => isoYmdCustomRangeBounds(analyticsCustomRange),
    [analyticsCustomRange]
  );

  const effectiveAccountKeys = useMemo(
    () => effectiveAccountKeysForScope(selectedAccountKeys),
    [selectedAccountKeys]
  );

  const accountScopedTrades = useMemo(() => {
    return trades.filter((t) => tradeMatchesAccountScope(t, effectiveAccountKeys));
  }, [trades, effectiveAccountKeys]);

  const scopeMetricLabel = useMemo(() => {
    const ts = String(timeScope || '').toUpperCase();
    if (ts !== 'CUSTOM') return String(timeScope || '');
    const f = analyticsCustomRange?.from;
    const t = analyticsCustomRange?.to;
    if (!f || !t) return 'CUSTOM';
    try {
      const a = new Date(`${f}T12:00:00`);
      const b = new Date(`${t}T12:00:00`);
      return `${a.toLocaleDateString()} – ${b.toLocaleDateString()}`;
    } catch {
      return 'CUSTOM';
    }
  }, [timeScope, analyticsCustomRange]);

  const scopeTrades = useMemo(() => {
    const beAmount = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);
    return accountScopedTrades.filter((t) => {
      if (signalsTab === 'LIVE' && !tradeIsLive(t)) return false;
      if (signalsTab === 'CLOSED' && !isClosedTrade(t)) return false;
      if (signalsTab === 'BLOCKED' && !isBlockedTrade(t)) return false;
      if (filterSymbol && !String(t.symbol || '').toLowerCase().includes(filterSymbol.toLowerCase())) return false;
      if (filterType !== 'ALL' && String(t.type || '').toUpperCase() !== filterType) return false;
      if (!tradeMatchesFocusStatus(t, filterStatus, beAmount)) return false;
      if (filterChannel !== 'ALL' && t.channel !== filterChannel) return false;
      return tradeMatchesTimeScope(t, timeScope, new Date(), customScopeBounds);
    });
  }, [accountScopedTrades, signalsTab, filterSymbol, filterType, filterStatus, filterChannel, timeScope, customScopeBounds, settings?.analyticsBreakEvenAmount]);

  const sliceFilterPayload = useMemo(() => ({
    timeframes: sliceTimeframes,
    symbols: slicePairs,
    biasTerms: sliceBiases,
    setupTerms: sliceSetups,
    vwapBands: sliceVwapBands,
    hvnBands: sliceHvnBands,
    trendAligns: sliceTrendAligns,
    killzones: sliceKillzones,
    confluenceTiers: sliceConfluenceTiers,
    top1Values: sliceTop1Values,
    sessions: sliceSessions,
    weekdays: sliceWeekdays
  }), [sliceTimeframes, slicePairs, sliceBiases, sliceSetups, sliceVwapBands, sliceHvnBands, sliceTrendAligns, sliceKillzones, sliceConfluenceTiers, sliceTop1Values, sliceSessions, sliceWeekdays]);

  const sliceOptions = useMemo(() => ({
    tfs: uniqueSortedStrings(
      scopeTrades.map((t) => String(t.timeframe || '').toUpperCase().trim()).filter(Boolean)
    ),
    pairs: uniqueSortedStrings(scopeTrades.map((t) => t.symbol)),
    biases: uniqueSortedStrings(scopeTrades.map((t) => t.bias)),
    setups: uniqueSortedStrings(
      [
        ...scopeTrades.flatMap((t) => (Array.isArray(t.presetTags) ? t.presetTags : [])),
        ...scopeTrades.map((t) => t.setup).filter(Boolean),
        ...(Array.isArray(settings?.tradePresets) ? settings.tradePresets : [])
      ],
      { limit: 200 }
    ),
    vwapBands: (() => {
      const raw = [...new Set(scopeTrades.map((t) => canonicalTradeVwapBand(t)).filter(Boolean))];
      const order = { yes: 0, no: 1, na: 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    hvnBands: (() => {
      const raw = [...new Set(scopeTrades.map((t) => canonicalTradeHvnBand(t)).filter(Boolean))];
      const order = { yes: 0, no: 1, na: 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    trendAligns: (() => {
      const raw = [...new Set(scopeTrades.map((t) => canonicalTradeTrendAlign(t)).filter(Boolean))];
      const order = { with: 0, against: 1, neutral: 2, na: 3 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    killzones: (() => {
      const raw = [...new Set(scopeTrades.map((t) => tradeKillzone(t)).filter(Boolean))];
      const order = Object.fromEntries(SLICE_KILLZONE_KEYS.map((k, i) => [k, i]));
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    confluenceTiers: (() => {
      const raw = [...new Set(scopeTrades.map((t) => canonicalTradeConfluenceTier(t)).filter(Boolean))];
      const order = { 0: 0, '1-2': 1, '3+': 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    top1Values: (() => {
      const raw = [...new Set(scopeTrades.map((t) => canonicalTradeTop1(t)).filter(Boolean))];
      const order = { yes: 0, no: 1 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    sessions: [...SLICE_SESSION_KEYS],
    tags: uniqueSortedStrings(
      scopeTrades.flatMap((t) => [
        ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
        ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
      ]),
      { limit: 100 }
    )
  }), [scopeTrades, settings?.tradePresets]);

  const filteredTrades = useMemo(() => {
    return scopeTrades.filter((t) => {
      if (!tradeMatchesSlice(t, sliceFilterPayload)) return false;
      if (sliceTags.length > 0) {
        const tags = [
          ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
          ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
        ].map((x) => String(x || '').toLowerCase());
        if (!sliceTags.some((wanted) => tags.includes(String(wanted).toLowerCase()))) return false;
      }
      return true;
    });
  }, [scopeTrades, sliceFilterPayload, sliceTags]);

  const previewPool = filteredTrades.length ? filteredTrades : scopeTrades;

  const filterSummary = useMemo(() => buildFilterSummaryText({
    scopeMetricLabel,
    effectiveAccountKeysCount: effectiveAccountKeys.length,
    signalsTab,
    filterSymbol,
    filterType,
    filterStatus,
    filterChannel,
    sliceTimeframes,
    slicePairs,
    sliceBiases,
    sliceSetups,
    sliceVwapBands,
    sliceHvnBands,
    sliceTrendAligns,
    sliceKillzones,
    sliceConfluenceTiers,
    sliceTop1Values,
    sliceSessions,
    sliceWeekdays,
    sliceTags
  }), [
    scopeMetricLabel,
    effectiveAccountKeys.length,
    signalsTab,
    filterSymbol,
    filterType,
    filterStatus,
    filterChannel,
    sliceTimeframes,
    slicePairs,
    sliceBiases,
    sliceSetups,
    sliceVwapBands,
    sliceHvnBands,
    sliceTrendAligns,
    sliceKillzones,
    sliceConfluenceTiers,
    sliceTop1Values,
    sliceSessions,
    sliceWeekdays,
    sliceTags
  ]);

  const scopeTradeIds = useMemo(() => scopeTrades.map((t) => t.id), [scopeTrades]);
  const filteredTradeIds = useMemo(() => filteredTrades.map((t) => t.id), [filteredTrades]);

  const tabCounts = useMemo(() => ({
    all: scopeTrades.length,
    live: scopeTrades.filter((t) => tradeIsLive(t)).length,
    closed: scopeTrades.filter((t) => isClosedTrade(t)).length,
    blocked: scopeTrades.filter((t) => isBlockedTrade(t)).length
  }), [scopeTrades]);

  const channels = useMemo(
    () => [...new Set(scopeTrades.map((t) => t.channel).filter(Boolean))],
    [scopeTrades]
  );

  const beAmount = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);

  const templateResults = useMemo(
    () => computeTemplateResults(filteredTrades, beAmount),
    [filteredTrades, beAmount]
  );

  const handleSelectAvoid = useCallback((item, idx) => {
    if (!item?.filterPatch) return;
    const matched = tradesMatchingFilterPatch(previewPool, {}, item.filterPatch);
    const matchedIds = new Set(matched.map((t) => String(t.id)));
    const without = previewPool.filter((t) => !matchedIds.has(String(t.id)));
    const poolStats = computeTradesInsightStats(previewPool, beAmount);
    const withoutStats = computeTradesInsightStats(without, beAmount);
    const wrDelta = poolStats.winRate != null && withoutStats.winRate != null
      ? Number((withoutStats.winRate - poolStats.winRate).toFixed(1))
      : null;
    const pnlDelta = Number((withoutStats.pnl - poolStats.pnl).toFixed(2));
    setInsight({
      id: `avoid-${idx}`,
      type: 'avoid',
      title: `Avoid: ${item.label}`,
      subtitle: `${item.winRate}% WR · ${item.pnl}$ · ${item.decisive} decisive in this bucket`,
      counterfactual: matched.length > 0
        ? `If you skipped these ${matched.length} trade${matched.length !== 1 ? 's' : ''}: WR ${poolStats.winRate ?? '—'}% → ${withoutStats.winRate ?? '—'}%${wrDelta != null && wrDelta > 0 ? ` (+${wrDelta})` : ''}, P&L ${poolStats.pnl}$ → ${withoutStats.pnl}$${pnlDelta > 0 ? ` (+${pnlDelta}$)` : ''}`
        : null,
      filterPatch: item.filterPatch,
      trades: matched,
      stats: computeTradesInsightStats(matched, beAmount)
    });
  }, [previewPool, beAmount]);

  const handleSelectLoss = useCallback((row, idx) => {
    const full = previewPool.find((t) => String(t.id) === String(row.id)) || row;
    setInsight({
      id: `loss-${row.id || idx}`,
      type: 'loss',
      title: `Loss #${idx + 1}: ${row.contextLabel}`,
      subtitle: `${row.profit}$`,
      trades: [full],
      stats: computeTradesInsightStats([full], beAmount)
    });
  }, [previewPool, beAmount]);

  const handleApplyInsight = useCallback((item) => {
    if (!item?.filterPatch) return;
    setTradeFilters(item.filterPatch);
  }, [setTradeFilters]);

  return (
    <div className="dashboard-shell filter-lab-shell" data-testid="filter-lab-page">
      <div className="titlebar">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon">🧪</span>
          <span className="brand-name">Filter Lab</span>
          <span className="subtitle">Find best filters · spot worst trades · preview matching rows</span>
        </div>
        <div className="titlebar-actions">
          <ScopeDateRangeToolbar
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            customRange={
              analyticsCustomRange && analyticsCustomRange.from && analyticsCustomRange.to
                ? analyticsCustomRange
                : { from: '', to: '' }
            }
            setCustomRange={setAnalyticsCustomRange}
            testIdPrefix="filter-lab"
          />
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
        </div>
      </div>

      <div className="center-panel" data-testid="filter-lab-workspace">
        <div className="stats-bar animate-enter">
          <MetricPill label="Scope" value={scopeMetricLabel} tone="accent" />
          <MetricPill label="Pool" value={String(scopeTrades.length)} />
          <MetricPill label="Filtered" value={String(filteredTrades.length)} />
          {templateResults.decisive > 0 && (
            <MetricPill
              label="Win Rate (TP/SL)"
              value={`${Number(templateResults.winRate || 0).toFixed(1)}%`}
              tone={Number(templateResults.winRate || 0) >= 50 ? 'success' : 'danger'}
            />
          )}
          <MetricPill
            label="P&L"
            value={`${templateResults.pnl >= 0 ? '+' : ''}${Number(templateResults.pnl || 0).toFixed(2)}$`}
            tone={templateResults.pnl >= 0 ? 'success' : 'danger'}
          />
        </div>

        <div className="filter-bar" data-testid="filter-lab-filter-bar">
          <div className="analytics-tabs">
            {['ALL', 'LIVE', 'CLOSED', 'BLOCKED'].map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`filter-lab-tab-${tab.toLowerCase()}`}
                className={`analytics-tab-btn ${signalsTab === tab ? 'active' : ''}`}
                onClick={() => setTradeFilters({ signalsTab: tab })}
              >
                {tab === 'ALL' ? 'All' : tab === 'LIVE' ? 'Live' : tab === 'CLOSED' ? 'Closed' : 'Blocked'}
                <span className={`analytics-tab-count ${tab === 'BLOCKED' ? 'tab-count-blocked' : ''}`}>
                  {tab === 'ALL' ? tabCounts.all : tab === 'LIVE' ? tabCounts.live : tab === 'CLOSED' ? tabCounts.closed : tabCounts.blocked}
                </span>
              </button>
            ))}
          </div>
          <input
            className="filter-input"
            data-testid="filter-lab-filter-symbol"
            placeholder="Symbol..."
            value={filterSymbol}
            onChange={(e) => setTradeFilters({ filterSymbol: e.target.value })}
          />
          <select className="filter-select" data-testid="filter-lab-filter-type" value={filterType} onChange={(e) => setTradeFilters({ filterType: e.target.value })}>
            <option value="ALL">All Types</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <select className="filter-select" data-testid="filter-lab-filter-status" value={filterStatus} onChange={(e) => setTradeFilters({ filterStatus: e.target.value })}>
            <option value="ALL">All Status</option>
            <option value="SENT">Sent</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
            <option value="TP">TP</option>
            <option value="SL">SL</option>
            <option value="BE">BE</option>
            <option value="EOD">EOD close</option>
            <option value="BLOCKED">Blocked / filtered</option>
          </select>
          <select className="filter-select" data-testid="filter-lab-filter-channel" value={filterChannel} onChange={(e) => setTradeFilters({ filterChannel: e.target.value })}>
            <option value="ALL">All Channels</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            className="btn-reset-filters"
            data-testid="filter-lab-reset-filters"
            onClick={resetTradeFilters}
            disabled={filtersAreDefault}
            title="Reset all filters including slice filters (shared with Dashboard & Trades)"
          >
            Reset all
          </button>
          <span className="filter-count">{filteredTrades.length} / {scopeTrades.length}</span>
        </div>

        <div className="filter-bar filter-bar-slice" data-testid="filter-lab-slice-bar">
          <span className="filter-slice-label">Slice stats &amp; table</span>
          {dimOn('timeframe') && (
            <MultiPickFilter testId="filter-lab-slice-tf" label="TF" options={sliceOptions.tfs} selected={sliceTimeframes} onChange={(v) => setTradeFilters({ sliceTimeframes: v })} />
          )}
          {dimOn('symbol') && (
            <MultiPickFilter testId="filter-lab-slice-pair" label="Pair" options={sliceOptions.pairs} selected={slicePairs} onChange={(v) => setTradeFilters({ slicePairs: v })} />
          )}
          {dimOn('bias') && (
            <MultiPickFilter testId="filter-lab-slice-bias" label="Bias" options={sliceOptions.biases} selected={sliceBiases} onChange={(v) => setTradeFilters({ sliceBiases: v })} />
          )}
          {dimOn('setup') && (
            <MultiPickFilter
              testId="filter-lab-slice-setup"
              label="Setup"
              options={sliceOptions.setups}
              selected={sliceSetups}
              onChange={(v) => setTradeFilters({ sliceSetups: v })}
              formatOption={(s) => (s.length > 42 ? `${s.slice(0, 39)}…` : s)}
              maxMenuHeight={280}
            />
          )}
          {dimOn('vwap') && (
            <MultiPickFilter testId="filter-lab-slice-vwap" label="VWAP" options={sliceOptions.vwapBands} selected={sliceVwapBands} onChange={(v) => setTradeFilters({ sliceVwapBands: v })} formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')} />
          )}
          {dimOn('hvn') && (
            <MultiPickFilter testId="filter-lab-slice-hvn" label="HVN" options={sliceOptions.hvnBands} selected={sliceHvnBands} onChange={(v) => setTradeFilters({ sliceHvnBands: v })} formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')} />
          )}
          {dimOn('trend') && (
            <MultiPickFilter testId="filter-lab-slice-trend" label="Trend" options={sliceOptions.trendAligns} selected={sliceTrendAligns} onChange={(v) => setTradeFilters({ sliceTrendAligns: v })} formatOption={(v) => (v === 'na' ? 'n/a' : v.toUpperCase())} />
          )}
          {dimOn('killzone') && (
            <MultiPickFilter testId="filter-lab-slice-killzone" label="Killzone" options={sliceOptions.killzones.length ? sliceOptions.killzones : SLICE_KILLZONE_KEYS} selected={sliceKillzones} onChange={(v) => setTradeFilters({ sliceKillzones: v })} formatOption={formatKillzoneSliceOption} />
          )}
          {dimOn('confluence') && (
            <MultiPickFilter testId="filter-lab-slice-confluence" label="Confluence" options={sliceOptions.confluenceTiers.length ? sliceOptions.confluenceTiers : SLICE_CONFLUENCE_TIER_KEYS} selected={sliceConfluenceTiers} onChange={(v) => setTradeFilters({ sliceConfluenceTiers: v })} />
          )}
          {dimOn('top1') && (
            <MultiPickFilter testId="filter-lab-slice-top1" label="Top-1" options={sliceOptions.top1Values.length ? sliceOptions.top1Values : SLICE_TOP1_KEYS} selected={sliceTop1Values} onChange={(v) => setTradeFilters({ sliceTop1Values: v })} formatOption={(v) => v.toUpperCase()} />
          )}
          <MultiPickFilter
            testId="filter-lab-slice-session"
            label="Session"
            options={sliceOptions.sessions}
            selected={sliceSessions}
            onChange={(v) => setTradeFilters({ sliceSessions: v })}
            formatOption={(s) => (s === 'asian' ? 'Asian' : s === 'london' ? 'London' : s === 'newYork' ? 'NY' : s === 'off' ? 'Off' : s)}
          />
          <MultiPickFilter
            testId="filter-lab-slice-weekday"
            label="Weekday"
            options={SLICE_WEEKDAY_ORDER}
            selected={sliceWeekdays}
            onChange={(v) => setTradeFilters({ sliceWeekdays: v })}
            formatOption={formatWeekdaySliceOption}
            allButtonLabel="All days"
            allButtonTitle="Include every weekday (clear day filter)"
            emptyHint="Weekdays"
          />
          <MultiPickFilter
            testId="filter-lab-slice-tags"
            label="Tags"
            options={sliceOptions.tags}
            selected={sliceTags}
            onChange={(v) => setTradeFilters({ sliceTags: v })}
            emptyHint="Journal tags"
          />
          <button
            type="button"
            className="btn-reset-filters"
            data-testid="filter-lab-reset-all-slice"
            onClick={resetTradeFilters}
            disabled={filtersAreDefault}
            title="Reset all filters including tabs, symbol, and slice picks"
          >
            Reset all
          </button>
          <FilterTemplatesControl
            tradeFilters={tradeFilters}
            setTradeFilters={setTradeFilters}
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            analyticsCustomRange={analyticsCustomRange}
            setAnalyticsCustomRange={setAnalyticsCustomRange}
            results={templateResults}
            filterSummary={filterSummary}
            testIdPrefix="filter-lab-templates"
          />
          <span className="filter-slice-hint">No selection = all · several ticked = match any of them</span>
        </div>

        <div className="filter-lab-page-context">{filterSummary || '—'}</div>

        <div className="filter-lab-page-body">
          <FilterLabTradePreview
            insight={insight}
            breakEvenAmount={beAmount}
            onClear={() => setInsight(null)}
            onApply={insight?.type === 'combo' && insight?.filterPatch ? handleApplyInsight : null}
          />

          <div className="filter-lab-page-grid">
          <FilterLabPanel
            standalone
            aiEnabled={!!settings?.aiCheck?.enabled}
            tradeIds={scopeTradeIds}
            scopeTrades={scopeTrades}
            filteredTrades={filteredTrades}
            tradeFilters={tradeFilters}
            tradeBuiltinColumns={settings?.tradeBuiltinColumns}
            timeScope={timeScope}
            scopeFrom={analyticsCustomRange?.from || ''}
            scopeTo={analyticsCustomRange?.to || ''}
            filterSummary={filterSummary}
            breakEvenAmount={settings?.analyticsBreakEvenAmount}
            tradePresets={settings?.tradePresets}
            setTradeFilters={setTradeFilters}
            onSelectCombo={setInsight}
            selectedComboId={insight?.type === 'combo' ? insight.id : ''}
            testIdPrefix="filter-lab"
          />
          <WorstTradesPanel
            aiEnabled={!!settings?.aiCheck?.enabled}
            tradeIds={filteredTradeIds.length ? filteredTradeIds : scopeTradeIds}
            filterSummary={filterSummary}
            breakEvenAmount={settings?.analyticsBreakEvenAmount}
            disabledOptimizerIds={filterDims.disabledOptimizerIds}
            onSelectAvoid={handleSelectAvoid}
            onSelectLoss={handleSelectLoss}
            selectedInsightId={insight?.type === 'avoid' || insight?.type === 'loss' ? insight.id : ''}
            testIdPrefix="worst-trades"
          />
          </div>
        </div>
      </div>
    </div>
  );
}
