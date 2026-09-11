import { describe, it, expect } from 'vitest';

const { analyzeWorstTrades } = require('../src/main/worstTradesAnalyzer');

function trade(overrides = {}) {
  return {
    id: `t-${Math.random()}`,
    openedAt: '2024-05-13T12:00:00.000Z',
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

describe('analyzeWorstTrades', () => {
  it('returns worst losses and underperforming buckets', () => {
    const rows = [
      trade({ id: 'w1', timeframe: 'M15', vwapBand: 'no', profit: -200, status: 'CLOSED_SL' }),
      trade({ id: 'w2', timeframe: 'M15', vwapBand: 'no', profit: -150, status: 'CLOSED_SL', openedAt: '2024-05-13T13:00:00.000Z' }),
      trade({ id: 'w3', timeframe: 'M15', vwapBand: 'no', profit: -140, status: 'CLOSED_SL', openedAt: '2024-05-13T14:00:00.000Z' }),
      trade({ id: 'g1', timeframe: 'M5', vwapBand: 'yes', profit: 80, status: 'CLOSED_TP' }),
      trade({ id: 'g2', timeframe: 'M5', vwapBand: 'yes', profit: 70, status: 'CLOSED_TP', openedAt: '2024-05-14T12:00:00.000Z' }),
      trade({ id: 'g3', timeframe: 'M5', vwapBand: 'yes', profit: 60, status: 'CLOSED_TP', openedAt: '2024-05-14T13:00:00.000Z' })
    ];
    const r = analyzeWorstTrades(rows, { minDecisive: 2, maxTrades: 5 });
    expect(r.ok).toBe(true);
    expect(r.worstTrades.length).toBeGreaterThan(0);
    expect(r.worstTrades[0].profit).toBeLessThanOrEqual(r.worstTrades[1]?.profit ?? 0);
    expect(r.avoid.length).toBeGreaterThan(0);
  });

  it('excludes disabled dimensions from buckets', () => {
    const rows = [
      trade({ id: 'w1', setup: 'sweep', profit: -100, status: 'CLOSED_SL' }),
      trade({ id: 'w2', setup: 'sweep', profit: -90, status: 'CLOSED_SL', openedAt: '2024-05-13T13:00:00.000Z' }),
      trade({ id: 'w3', setup: 'sweep', profit: -80, status: 'CLOSED_SL', openedAt: '2024-05-13T14:00:00.000Z' }),
      trade({ id: 'g1', setup: 'C', profit: 50, status: 'CLOSED_TP' })
    ];
    const r = analyzeWorstTrades(rows, { disabledDimensions: ['setup'], minDecisive: 2 });
    expect(r.ok).toBe(true);
    expect(r.worstBuckets.every((b) => b.dimension !== 'setup')).toBe(true);
  });
});
