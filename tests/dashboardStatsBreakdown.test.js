import { describe, it, expect } from 'vitest';

const { buildDashboardFilterStatsBreakdown } = require('../src/main/analyticsService');

function trade(overrides = {}) {
  return {
    openedAt: '2024-05-13T12:00:00.000Z',
    lastUpdateAt: '2024-05-13T13:00:00.000Z',
    symbol: 'EURUSD',
    channel: 'ch-a',
    timeframe: 'M5',
    type: 'BUY',
    bias: 'bull',
    vwapBand: 'yes',
    profit: 10,
    status: 'CLOSED_TP',
    ...overrides
  };
}

describe('buildDashboardFilterStatsBreakdown', () => {
  it('aggregates decisive W/L and splits by timeframe + vwap pairs', () => {
    const rows = [
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 10, status: 'CLOSED_TP' }),
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 12, status: 'CLOSED_TP', openedAt: '2024-05-13T12:05:00.000Z' }),
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 11, status: 'CLOSED_TP', openedAt: '2024-05-13T12:06:00.000Z' }),
      trade({ timeframe: 'M5', vwapBand: 'no', profit: -120, status: 'CLOSED_SL', openedAt: '2024-05-13T12:10:00.000Z' }),
      trade({ timeframe: 'M15', vwapBand: 'no', profit: -90, status: 'CLOSED_SL', openedAt: '2024-05-13T12:15:00.000Z' })
    ];
    const b = buildDashboardFilterStatsBreakdown(rows, 50);
    expect(b.aggregate.trades).toBe(5);
    expect(b.aggregate.decisive).toBe(5);
    expect(b.aggregate.wins).toBe(3);
    expect(b.aggregate.losses).toBe(2);
    const tf = b.singles.timeframe;
    expect(tf.best.some((r) => r.key === 'M5' && r.winRate === 75)).toBe(true);
    const pairBest = b.pairs.best;
    expect(pairBest.length).toBeGreaterThan(0);
    const m5yesPair = pairBest.find((p) => p.key === 'M5 + vwap:yes');
    expect(m5yesPair && m5yesPair.decisive).toBe(3);
    expect(m5yesPair && m5yesPair.winRate).toBe(100);
  });
});
