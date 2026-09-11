import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADE_FILTERS } from '../src/renderer/hooks/usePersistedTradeFilters.js';
import {
  filtersMatchPreset,
  findMatchingPreset,
  computeTemplateResults,
  mergeFilterPresets
} from '../src/renderer/utils/filterPresetMatch.js';

describe('filterPresetMatch', () => {
  it('matches equivalent filter snapshots', () => {
    const live = {
      ...DEFAULT_TRADE_FILTERS,
      filterSymbol: 'eur',
      sliceWeekdays: [1]
    };
    const preset = {
      ...DEFAULT_TRADE_FILTERS,
      filterSymbol: 'eur',
      sliceWeekdays: [1]
    };
    expect(filtersMatchPreset(live, preset)).toBe(true);
  });

  it('finds preset by live filters', () => {
    const presets = [
      { id: 'a', name: 'Mon', filters: { ...DEFAULT_TRADE_FILTERS, sliceWeekdays: [1] } },
      { id: 'b', name: 'Tue', filters: { ...DEFAULT_TRADE_FILTERS, sliceWeekdays: [2] } }
    ];
    const match = findMatchingPreset(presets, { ...DEFAULT_TRADE_FILTERS, sliceWeekdays: [2] });
    expect(match?.id).toBe('b');
  });

  it('merges weekday templates without conflict', () => {
    const midWeek = {
      id: 'a',
      name: 'Mid-week',
      timeScope: 'YEAR',
      filters: { ...DEFAULT_TRADE_FILTERS, sliceWeekdays: [1, 2, 4] }
    };
    const friday = {
      id: 'b',
      name: 'Friday',
      timeScope: 'YEAR',
      filters: { ...DEFAULT_TRADE_FILTERS, sliceWeekdays: [5] }
    };
    const merged = mergeFilterPresets([midWeek, friday]);
    expect(merged.ok).toBe(true);
    expect(merged.filters.sliceWeekdays).toEqual([1, 2, 4, 5]);
    expect(merged.presetNames).toEqual(['Mid-week', 'Friday']);
  });

  it('reports scalar conflicts when combining templates', () => {
    const buy = {
      id: 'a',
      name: 'Buys',
      timeScope: 'YEAR',
      filters: { ...DEFAULT_TRADE_FILTERS, filterType: 'BUY' }
    };
    const sell = {
      id: 'b',
      name: 'Sells',
      timeScope: 'YEAR',
      filters: { ...DEFAULT_TRADE_FILTERS, filterType: 'SELL' }
    };
    const merged = mergeFilterPresets([buy, sell]);
    expect(merged.ok).toBe(false);
    expect(merged.conflicts.some((c) => c.includes('Type'))).toBe(true);
  });

  it('computes template results from trades', () => {
    const trades = [
      { id: '1', status: 'CLOSED', profit: 100 },
      { id: '2', status: 'CLOSED', profit: -80, closeReason: 'SL' }
    ];
    const res = computeTemplateResults(trades, 50);
    expect(res.tradeCount).toBe(2);
    expect(res.pnl).toBe(20);
  });
});
