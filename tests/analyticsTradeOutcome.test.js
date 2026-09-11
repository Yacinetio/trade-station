import { describe, it, expect } from 'vitest';

const { computeAnalytics } = require('../src/main/analyticsService');

function baseTrade(overrides = {}) {
  return {
    openedAt: '2024-05-13T12:00:00.000Z',
    lastUpdateAt: '2024-05-13T13:00:00.000Z',
    symbol: 'EURUSD',
    channel: 'ch',
    timeframe: 'M30',
    type: 'BUY',
    profit: 0,
    status: 'CLOSED_TP',
    ...overrides
  };
}

describe('analytics trade outcomes (EOD, CLOSED_SL_PROFIT vs BE band)', () => {
  it('excludes CLOSED_EOD from wins, losses, and win rate denominator', () => {
    const r = computeAnalytics(
      [
        baseTrade({ status: 'CLOSED_EOD', profit: 76 }),
        baseTrade({ status: 'CLOSED_TP', profit: 100, openedAt: '2024-05-13T14:00:00.000Z' }),
        baseTrade({ status: 'CLOSED_SL', profit: -120, openedAt: '2024-05-13T15:00:00.000Z' })
      ],
      { timeScope: 'ALL', analyticsBreakEvenAmount: 50 }
    );
    expect(r.totals.wins).toBe(1);
    expect(r.totals.losses).toBe(1);
    expect(r.totals.winRate).toBeCloseTo(50, 5);
    expect(r.totals.breakevens).toBe(0);
    expect(r.totals.eodCloses).toBe(1);
  });

  it('CLOSED_SL_PROFIT inside BE band counts as BE, not a win', () => {
    const r = computeAnalytics(
      [
        baseTrade({ status: 'CLOSED_SL_PROFIT', profit: 0.49, symbol: 'GER40' }),
        baseTrade({ status: 'CLOSED_TP', profit: 50, openedAt: '2024-05-13T14:00:00.000Z' })
      ],
      { timeScope: 'ALL', analyticsBreakEvenAmount: 50 }
    );
    expect(r.totals.wins).toBe(1);
    expect(r.totals.losses).toBe(0);
    expect(r.totals.breakevens).toBe(1);
    expect(r.totals.eodCloses).toBe(0);
    expect(r.totals.winRate).toBeCloseTo(100, 5);
  });

  it('CLOSED_SL_PROFIT above BE band is plain closed win (no STOP bucket)', () => {
    const r = computeAnalytics(
      [baseTrade({ status: 'CLOSED_SL_PROFIT', profit: 120 })],
      { timeScope: 'ALL', analyticsBreakEvenAmount: 50 }
    );
    expect(r.totals.wins).toBe(1);
    expect(r.totals.losses).toBe(0);
    expect(r.totals.breakevens).toBe(0);
    expect(r.totals.eodCloses).toBe(0);
    const row = r.breakdowns.byCloseReason.find((x) => x.key === 'MANUAL_CLOSED');
    expect(row?.trades).toBe(1);
  });

  it('tpSlWinRate counts only TP and SL outcomes', () => {
    const r = computeAnalytics(
      [
        baseTrade({ status: 'CLOSED_TP', profit: 100 }),
        baseTrade({ status: 'CLOSED_SL', profit: -120, openedAt: '2024-05-13T14:00:00.000Z' }),
        baseTrade({ status: 'CLOSED_EOD', profit: 10, openedAt: '2024-05-13T15:00:00.000Z' }),
        baseTrade({ status: 'CLOSED_SL_PROFIT', profit: 0.49, openedAt: '2024-05-13T16:00:00.000Z' })
      ],
      { timeScope: 'ALL', analyticsBreakEvenAmount: 50 }
    );
    expect(r.totals.tpHits).toBe(1);
    expect(r.totals.slHits).toBe(1);
    expect(r.totals.breakevens).toBe(1);
    expect(r.totals.eodCloses).toBe(1);
    expect(r.totals.tpSlWinRate).toBeCloseTo(50, 5);
  });

  it('breakdown lists EOD under EOD_CLOSE', () => {
    const r = computeAnalytics([baseTrade({ status: 'CLOSED_EOD', profit: 10 })], {
      timeScope: 'ALL'
    });
    expect(r.totals.eodCloses).toBe(1);
    const row = r.breakdowns.byCloseReason.find((x) => x.key === 'EOD_CLOSE');
    expect(row?.trades).toBe(1);
  });
});

describe('computeAnalytics slice filters (HVN, session)', () => {
  it('hvnBands keeps only trades whose HVN flag matches', () => {
    const r = computeAnalytics(
      [
        baseTrade({ hvnBand: 'yes', openedAt: '2024-05-13T14:00:00.000Z' }),
        baseTrade({ hvnBand: 'no', openedAt: '2024-05-13T15:00:00.000Z' })
      ],
      { timeScope: 'ALL', hvnBands: ['yes'] }
    );
    expect(r.tradeCount).toBe(1);
  });

  it('sessionNames keeps trades inside the canonical UTC sessions (asia 06:00Z, NY 18:00Z summer)', () => {
    const r = computeAnalytics(
      [
        baseTrade({ openedAt: '2024-05-13T06:00:00.000Z' }),
        baseTrade({ openedAt: '2024-05-13T18:00:00.000Z', symbol: 'GER40' })
      ],
      { timeScope: 'ALL', sessionNames: ['asian', 'london', 'newYork'] }
    );
    expect(r.tradeCount).toBe(2);
  });

  it('post-NY-close trades land in the off bucket and need sessionNames "off"', () => {
    // 2024-05-13 is EDT → NY closes 20:00 UTC; 20:30 UTC is the off dead zone.
    const trades = [baseTrade({ openedAt: '2024-05-13T20:30:00.000Z' })];
    const named = computeAnalytics(trades, { timeScope: 'ALL', sessionNames: ['asian', 'london', 'newYork'] });
    expect(named.tradeCount).toBe(0);
    const off = computeAnalytics(trades, { timeScope: 'ALL', sessionNames: ['off'] });
    expect(off.tradeCount).toBe(1);
    expect(off.advanced.sessions.off.trades).toBe(1);
  });

  it('weekdayIndices narrows to trades whose local open-day matches', () => {
    const a = baseTrade({ openedAt: '2024-05-13T12:00:00.000Z' });
    const b = baseTrade({ openedAt: '2024-05-14T12:00:00.000Z', symbol: 'GER40' });
    const dayB = new Date(b.openedAt).getDay();
    const r = computeAnalytics([a, b], { timeScope: 'ALL', weekdayIndices: [dayB] });
    expect(r.tradeCount).toBe(1);
  });
});
