import React, { useEffect, useMemo } from 'react';
import MultiPickFilter from './MultiPickFilter.jsx';
import FilterTemplatesControl from './FilterTemplatesControl.jsx';
import {
  tradeMatchesSlice,
  uniqueSortedStrings,
  canonicalTradeVwapBand,
  canonicalTradeHvnBand,
  SLICE_SESSION_KEYS,
  SLICE_WEEKDAY_ORDER,
  formatWeekdaySliceOption,
  sortWeekdayIndicesMonFirst
} from '../utils/tradeSliceFilters.js';
import { tradeMatchesTimeScope, isoYmdCustomRangeBounds } from '../utils/timeCalendarScope.js';
import { effectiveAccountKeysForScope, tradeMatchesAccountScope } from '../utils/accountScope.js';
import { tradeFiltersAreDefault } from '../hooks/usePersistedTradeFilters.js';
import { resolveFilterDimensions, stripDisabledSliceFilters } from '../utils/filterDimensions.js';
import { buildFilterSummaryText } from '../utils/filterSummaryText.js';
import {
  tradeIsBlocked,
  tradeIsClosed,
  tradeIsLive,
  getTradeOutcome
} from '../utils/tradeStatus.js';
import { computeTemplateResults } from '../utils/filterPresetMatch.js';

function tradeIsSimulated(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s === 'SIMULATED' || trade?.simulated === true;
}

/**
 * Shared slice filter bar (TF, Pair, Bias, Session, Tags, Templates…) used on
 * Dashboard, Trades, Filter Lab, and Reports — all bound to the same persisted
 * `tradeFilters` object from App.
 */
export default function TradeSliceFilterBar({
  trades = [],
  selectedAccountKeys = [],
  tradeFilters = {},
  setTradeFilters = () => {},
  resetTradeFilters = () => {},
  timeScope = 'ALL',
  setTimeScope = null,
  analyticsCustomRange = null,
  setAnalyticsCustomRange = null,
  settings = null,
  onSettingsLoaded = null,
  testIdPrefix = 'slice',
  scopeMetricLabel = '',
  showHint = true
}) {
  const [localSettings, setLocalSettings] = React.useState(settings);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
      return;
    }
    window.electronAPI?.getSettings?.().then((s) => {
      setLocalSettings(s);
      onSettingsLoaded?.(s);
    }).catch(() => {});
  }, [settings, onSettingsLoaded]);

  const {
    signalsTab = 'ALL',
    filterSymbol = '',
    filterType = 'ALL',
    filterStatus = 'ALL',
    filterChannel = 'ALL',
    sliceTimeframes = [],
    slicePairs = [],
    sliceBiases = [],
    sliceSetups = [],
    sliceVwapBands = [],
    sliceHvnBands = [],
    sliceSessions = [],
    sliceWeekdays = [],
    sliceTags = []
  } = tradeFilters;

  const filtersAreDefault = useMemo(() => tradeFiltersAreDefault(tradeFilters), [tradeFilters]);

  const filterDims = useMemo(
    () => resolveFilterDimensions(localSettings?.tradeBuiltinColumns),
    [localSettings?.tradeBuiltinColumns]
  );
  const dimOn = (id) => filterDims.enabled.has(id);

  useEffect(() => {
    const patch = stripDisabledSliceFilters(tradeFilters, localSettings?.tradeBuiltinColumns);
    if (Object.keys(patch).length) setTradeFilters(patch);
  }, [localSettings?.tradeBuiltinColumns, tradeFilters, setTradeFilters]);

  const effectiveAccountKeys = useMemo(
    () => effectiveAccountKeysForScope(selectedAccountKeys),
    [selectedAccountKeys]
  );

  const customScopeBounds = useMemo(() => {
    if (String(timeScope || '').toUpperCase() !== 'CUSTOM') return null;
    return isoYmdCustomRangeBounds(analyticsCustomRange?.from, analyticsCustomRange?.to);
  }, [timeScope, analyticsCustomRange?.from, analyticsCustomRange?.to]);

  const accountScopedTrades = useMemo(
    () => trades.filter((t) => tradeMatchesAccountScope(t, effectiveAccountKeys)),
    [trades, effectiveAccountKeys]
  );

  const timeScopedTrades = useMemo(
    () => accountScopedTrades.filter((t) => tradeMatchesTimeScope(t, timeScope, new Date(), customScopeBounds)),
    [accountScopedTrades, timeScope, customScopeBounds]
  );

  const sliceFilterPayload = useMemo(() => ({
    timeframes: sliceTimeframes,
    symbols: slicePairs,
    biasTerms: sliceBiases,
    setupTerms: sliceSetups,
    vwapBands: sliceVwapBands,
    hvnBands: sliceHvnBands,
    sessions: sliceSessions,
    weekdays: sliceWeekdays
  }), [sliceTimeframes, slicePairs, sliceBiases, sliceSetups, sliceVwapBands, sliceHvnBands, sliceSessions, sliceWeekdays]);

  const sliceOptions = useMemo(() => ({
    tfs: uniqueSortedStrings(
      timeScopedTrades.map((t) => String(t.timeframe || '').toUpperCase().trim()).filter(Boolean)
    ),
    pairs: uniqueSortedStrings(timeScopedTrades.map((t) => t.symbol)),
    biases: uniqueSortedStrings(timeScopedTrades.map((t) => t.bias)),
    setups: uniqueSortedStrings(
      [
        ...timeScopedTrades.flatMap((t) => (Array.isArray(t.presetTags) ? t.presetTags : [])),
        ...timeScopedTrades.map((t) => t.setup).filter(Boolean)
      ],
      { limit: 100 }
    ),
    vwapBands: (() => {
      const raw = [...new Set(timeScopedTrades.map((t) => canonicalTradeVwapBand(t)).filter(Boolean))];
      return ['yes', 'no', 'na'].filter((v) => raw.includes(v));
    })(),
    hvnBands: (() => {
      const raw = [...new Set(timeScopedTrades.map((t) => canonicalTradeHvnBand(t)).filter(Boolean))];
      return ['yes', 'no', 'na'].filter((v) => raw.includes(v));
    })(),
    sessions: [...SLICE_SESSION_KEYS],
    tags: uniqueSortedStrings(
      timeScopedTrades.flatMap((t) => [
        ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
        ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
      ]),
      { limit: 100 }
    )
  }), [timeScopedTrades]);

  const filteredTrades = useMemo(() => {
    const breakEvenAmount = Math.max(0, Number(localSettings?.analyticsBreakEvenAmount ?? 50) || 50);
    const tab = String(signalsTab || 'ALL').toUpperCase();
    return timeScopedTrades.filter((t) => {
      if (tab === 'LIVE' && !tradeIsLive(t)) return false;
      if (tab === 'CLOSED' && !tradeIsClosed(t)) return false;
      if (tab === 'BLOCKED' && !tradeIsBlocked(t)) return false;
      if (tab === 'SIMULATED' && !tradeIsSimulated(t)) return false;
      if (filterSymbol && !t.symbol?.toLowerCase().includes(filterSymbol.toLowerCase())) return false;
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (filterStatus !== 'ALL') {
        const s = (t.status || '').toUpperCase();
        const outcome = getTradeOutcome(t, breakEvenAmount);
        if (filterStatus === 'CLOSED' && !tradeIsClosed(t)) return false;
        if (filterStatus === 'PENDING' && s !== 'PENDING') return false;
        if (filterStatus === 'SENT' && s !== 'SENT') return false;
        if (filterStatus === 'BLOCKED' && !tradeIsBlocked(t)) return false;
        if (filterStatus === 'TP' && outcome !== 'TP') return false;
        if (filterStatus === 'SL' && outcome !== 'SL') return false;
        if (filterStatus === 'BE' && outcome !== 'BE') return false;
        if (filterStatus === 'EOD' && outcome !== 'EOD') return false;
      }
      if (filterChannel !== 'ALL' && t.channel !== filterChannel) return false;
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
  }, [
    timeScopedTrades,
    signalsTab,
    filterSymbol,
    filterType,
    filterStatus,
    filterChannel,
    sliceFilterPayload,
    sliceTags,
    localSettings?.analyticsBreakEvenAmount
  ]);

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
    sliceSessions,
    sliceWeekdays: sortWeekdayIndicesMonFirst(sliceWeekdays),
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
    sliceSessions,
    sliceWeekdays,
    sliceTags
  ]);

  const templateResults = useMemo(
    () => computeTemplateResults(
      filteredTrades,
      Math.max(0, Number(localSettings?.analyticsBreakEvenAmount ?? 50) || 50)
    ),
    [filteredTrades, localSettings?.analyticsBreakEvenAmount]
  );

  return (
    <div className="filter-bar filter-bar-slice" data-testid={`${testIdPrefix}-slice-bar`}>
      <span className="filter-slice-label">Slice stats &amp; table</span>
      {dimOn('timeframe') && (
        <MultiPickFilter testId={`${testIdPrefix}-slice-tf`} label="TF" options={sliceOptions.tfs} selected={sliceTimeframes} onChange={(v) => setTradeFilters({ sliceTimeframes: v })} />
      )}
      {dimOn('symbol') && (
        <MultiPickFilter testId={`${testIdPrefix}-slice-pair`} label="Pair" options={sliceOptions.pairs} selected={slicePairs} onChange={(v) => setTradeFilters({ slicePairs: v })} />
      )}
      {dimOn('bias') && (
        <MultiPickFilter testId={`${testIdPrefix}-slice-bias`} label="Bias" options={sliceOptions.biases} selected={sliceBiases} onChange={(v) => setTradeFilters({ sliceBiases: v })} />
      )}
      {dimOn('setup') && (
        <MultiPickFilter
          testId={`${testIdPrefix}-slice-setup`}
          label="Setup"
          options={sliceOptions.setups}
          selected={sliceSetups}
          onChange={(v) => setTradeFilters({ sliceSetups: v })}
          formatOption={(s) => (s.length > 42 ? `${s.slice(0, 39)}…` : s)}
          maxMenuHeight={280}
        />
      )}
      {dimOn('vwap') && (
        <MultiPickFilter
          testId={`${testIdPrefix}-slice-vwap`}
          label="VWAP"
          options={sliceOptions.vwapBands}
          selected={sliceVwapBands}
          onChange={(v) => setTradeFilters({ sliceVwapBands: v })}
          formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
        />
      )}
      {dimOn('hvn') && (
        <MultiPickFilter
          testId={`${testIdPrefix}-slice-hvn`}
          label="HVN"
          options={sliceOptions.hvnBands}
          selected={sliceHvnBands}
          onChange={(v) => setTradeFilters({ sliceHvnBands: v })}
          formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
        />
      )}
      <MultiPickFilter
        testId={`${testIdPrefix}-slice-session`}
        label="Session"
        options={sliceOptions.sessions}
        selected={sliceSessions}
        onChange={(v) => setTradeFilters({ sliceSessions: v })}
        formatOption={(s) => (s === 'asian' ? 'Asian' : s === 'london' ? 'London' : s === 'newYork' ? 'NY' : s)}
      />
      <MultiPickFilter
        testId={`${testIdPrefix}-slice-weekday`}
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
        testId={`${testIdPrefix}-slice-tags`}
        label="Tags"
        options={sliceOptions.tags}
        selected={sliceTags}
        onChange={(v) => setTradeFilters({ sliceTags: v })}
        emptyHint="Journal tags"
      />
      <button
        type="button"
        className="btn-reset-filters"
        data-testid={`${testIdPrefix}-reset-all-slice`}
        onClick={resetTradeFilters}
        disabled={filtersAreDefault}
        title="Reset all filters including tabs, symbol, and slice picks (shared app-wide)"
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
        testIdPrefix={`${testIdPrefix}-filter-templates`}
      />
      {showHint && (
        <span className="filter-slice-hint">No selection = all · several ticked = match any of them</span>
      )}
    </div>
  );
}

export { TradeSliceFilterBar };
