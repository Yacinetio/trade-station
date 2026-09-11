import { describe, it, expect } from 'vitest';
import { sanitizeFilter } from '../src/main/reportsIpc.js';
import { applyReportFilter } from '../src/main/reportEngine.js';

const FIXTURE = [
  {
    id: 't1',
    symbol: 'EURUSD',
    type: 'BUY',
    channel: 'Alpha',
    timeframe: 'H1',
    bias: 'strong bullish',
    openedAt: '2026-06-02T08:30:00Z',
    closedAt: '2026-06-02T09:00:00Z',
    status: 'CLOSED_TP',
    profit: 100
  },
  {
    id: 't2',
    symbol: 'EURUSD',
    type: 'SELL',
    channel: 'Alpha',
    timeframe: 'M15',
    bias: 'weak bearish',
    openedAt: '2026-06-02T14:00:00Z',
    closedAt: '2026-06-02T14:20:00Z',
    status: 'CLOSED_SL',
    profit: -50
  },
  {
    id: 't3',
    symbol: 'GBPJPY',
    type: 'BUY',
    channel: 'Beta',
    timeframe: 'H1',
    openedAt: '2026-06-02T03:00:00Z',
    closedAt: '2026-06-02T11:00:00Z',
    status: 'CLOSED_TP',
    profit: 200
  }
];

describe('reportsIpc sanitizeFilter', () => {
  it('preserves app-wide tradeFilters payload (was stripped before)', () => {
    const raw = {
      tradeFilters: {
        filterChannel: 'ALL',
        sliceTimeframes: ['H1'],
        sliceSessions: ['london', 'newYork'],
        sliceWeekdays: [1, 2, 3]
      },
      accountKeys: ['acc1'],
      timeScope: 'YEAR',
      scopeFrom: '',
      scopeTo: '',
      breakEvenAmount: 50
    };
    const out = sanitizeFilter(raw);
    expect(out.tradeFilters?.sliceTimeframes).toEqual(['H1']);
    expect(out.tradeFilters?.sliceSessions).toEqual(['london', 'newYork']);
    expect(out.tradeFilters?.sliceWeekdays).toEqual([1, 2, 3]);
    expect(out.timeScope).toBe('YEAR');
    expect(out.breakEvenAmount).toBe(50);
    expect(out.accountKeys).toEqual(['acc1']);
  });

  it('sanitized global payload actually filters trades', () => {
    const filtered = applyReportFilter(FIXTURE, sanitizeFilter({
      tradeFilters: { sliceTimeframes: ['H1'] },
      timeScope: 'ALL',
      breakEvenAmount: 50
    }));
    expect(filtered.map((t) => t.id)).toEqual(['t1', 't3']);
  });
});
