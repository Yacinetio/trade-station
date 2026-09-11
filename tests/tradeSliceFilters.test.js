import { describe, it, expect } from 'vitest';
import { tradeMatchesSlice } from '../src/renderer/utils/tradeSliceFilters.js';

describe('tradeMatchesSlice weekdays', () => {
  it('empty weekdays means no weekday filter', () => {
    const row = { openedAt: '2024-05-13T12:00:00.000Z' };
    expect(tradeMatchesSlice(row, { weekdays: [] })).toBe(true);
    expect(tradeMatchesSlice(row, {})).toBe(true);
  });

  it('matches when openedAt local weekday is in selection (OR)', () => {
    const row = { openedAt: '2024-05-13T12:00:00.000Z' };
    const d = new Date(row.openedAt);
    expect(tradeMatchesSlice(row, { weekdays: [d.getDay()] })).toBe(true);
    const other = (d.getDay() + 1) % 7;
    expect(tradeMatchesSlice(row, { weekdays: [other] })).toBe(false);
  });

  it('excludes trades with no open time when weekday slice is active', () => {
    expect(tradeMatchesSlice({ symbol: 'X' }, { weekdays: [1] })).toBe(false);
  });
});

describe('tradeMatchesSlice HVN + session', () => {
  it('matches hvnBands like vwap (OR within selection)', () => {
    const row = { hvnBand: 'yes', openedAt: '2024-01-01T12:00:00.000Z' };
    expect(tradeMatchesSlice(row, { hvnBands: ['yes'] })).toBe(true);
    expect(tradeMatchesSlice(row, { hvnBands: ['no'] })).toBe(false);
  });

  it('excludes trades with no open time when session slice is active', () => {
    expect(tradeMatchesSlice({ symbol: 'X' }, { sessions: ['asian'] })).toBe(false);
  });

  it('uses UTC sessionModel for session slice (not local hour)', () => {
    const row = { openedAt: '2024-06-03T10:00:00.000Z' };
    expect(tradeMatchesSlice(row, { sessions: ['london'] })).toBe(true);
    expect(tradeMatchesSlice(row, { sessions: ['newYork'] })).toBe(false);
  });

  it('matches trendAlign and killzone slices', () => {
    const row = {
      trendAlign: 'with',
      openedAt: '2024-06-03T08:30:00.000Z'
    };
    expect(tradeMatchesSlice(row, { trendAligns: ['with'] })).toBe(true);
    expect(tradeMatchesSlice(row, { trendAligns: ['against'] })).toBe(false);
    expect(tradeMatchesSlice(row, { killzones: ['london-open-kz'] })).toBe(true);
  });

  it('matches confluence tier and top1 slices', () => {
    const row = { confluence: 4, top1: true };
    expect(tradeMatchesSlice(row, { confluenceTiers: ['3+'] })).toBe(true);
    expect(tradeMatchesSlice(row, { confluenceTiers: ['0'] })).toBe(false);
    expect(tradeMatchesSlice(row, { top1Values: ['yes'] })).toBe(true);
    expect(tradeMatchesSlice(row, { top1Values: ['no'] })).toBe(false);
  });
});
