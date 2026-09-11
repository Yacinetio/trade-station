import { describe, it, expect } from 'vitest';

const { searchBestFilterCombinations } = require('../src/main/filterOptimizer');

function trade(overrides = {}) {
  return {
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

describe('searchBestFilterCombinations', () => {
  it('ranks pair combos and returns filter patches', () => {
    const rows = [
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 10, status: 'CLOSED_TP' }),
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 12, status: 'CLOSED_TP', openedAt: '2024-05-13T12:05:00.000Z' }),
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 11, status: 'CLOSED_TP', openedAt: '2024-05-13T12:06:00.000Z' }),
      trade({ timeframe: 'M5', vwapBand: 'no', profit: -120, status: 'CLOSED_SL', openedAt: '2024-05-13T12:10:00.000Z' }),
      trade({ symbol: 'GBPUSD', timeframe: 'M15', vwapBand: 'no', profit: -90, status: 'CLOSED_SL', openedAt: '2024-05-13T12:15:00.000Z' })
    ];
    const r = searchBestFilterCombinations(rows, { minDecisive: 3, maxResults: 8 });
    expect(r.ok).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
    const top = r.results[0];
    expect(top.filterPatch).toBeTruthy();
    expect(top.metrics.decisive).toBeGreaterThanOrEqual(3);
  });

  it('filters by anchor symbol', () => {
    const rows = [
      trade({ symbol: 'XAUUSD', timeframe: 'M15', profit: 50, status: 'CLOSED_TP' }),
      trade({ symbol: 'XAUUSD', timeframe: 'M15', profit: 40, status: 'CLOSED_TP', openedAt: '2024-05-13T13:00:00.000Z' }),
      trade({ symbol: 'XAUUSD', timeframe: 'M15', profit: 45, status: 'CLOSED_TP', openedAt: '2024-05-13T14:00:00.000Z' }),
      trade({ symbol: 'EURUSD', timeframe: 'M5', profit: -80, status: 'CLOSED_SL' })
    ];
    const r = searchBestFilterCombinations(rows, { anchorSymbol: 'XAUUSD', minDecisive: 2 });
    expect(r.ok).toBe(true);
    expect(r.anchorSymbol).toBe('XAUUSD');
    expect(r.poolSize).toBe(3);
  });

  it('locks weekday and excludes weekday from search dimensions', () => {
    const rows = [
      trade({ openedAt: '2024-05-13T12:00:00.000Z', timeframe: 'M5', vwapBand: 'yes', profit: 10, status: 'CLOSED_TP' }),
      trade({ openedAt: '2024-05-13T12:05:00.000Z', timeframe: 'M5', vwapBand: 'yes', profit: 12, status: 'CLOSED_TP' }),
      trade({ openedAt: '2024-05-13T12:06:00.000Z', timeframe: 'M5', vwapBand: 'yes', profit: 11, status: 'CLOSED_TP' }),
      trade({ openedAt: '2024-05-13T12:10:00.000Z', timeframe: 'M15', vwapBand: 'no', profit: -120, status: 'CLOSED_SL' }),
      trade({ openedAt: '2024-05-14T12:00:00.000Z', timeframe: 'M5', vwapBand: 'no', profit: -90, status: 'CLOSED_SL' })
    ];
    const r = searchBestFilterCombinations(rows, {
      lockedFilters: { sliceWeekdays: [1] },
      minDecisive: 3,
      maxResults: 8
    });
    expect(r.ok).toBe(true);
    expect(r.excludedDimensions).toContain('weekday');
    expect(r.results.every((x) => x.dimension !== 'weekday')).toBe(true);
    expect(r.poolSize).toBe(4);
  });

  it('ranks by pnl when rankBy is pnl', () => {
    const rows = [
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 200, status: 'CLOSED_TP' }),
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 180, status: 'CLOSED_TP', openedAt: '2024-05-13T12:05:00.000Z' }),
      trade({ timeframe: 'M5', vwapBand: 'yes', profit: 190, status: 'CLOSED_TP', openedAt: '2024-05-13T12:06:00.000Z' }),
      trade({ timeframe: 'M15', vwapBand: 'no', profit: 50, status: 'CLOSED_TP', openedAt: '2024-05-13T12:10:00.000Z' }),
      trade({ timeframe: 'M15', vwapBand: 'no', profit: 45, status: 'CLOSED_TP', openedAt: '2024-05-13T12:11:00.000Z' }),
      trade({ timeframe: 'M15', vwapBand: 'no', profit: 55, status: 'CLOSED_TP', openedAt: '2024-05-13T12:12:00.000Z' })
    ];
    const r = searchBestFilterCombinations(rows, { rankBy: 'pnl', minDecisive: 3, maxResults: 8 });
    expect(r.ok).toBe(true);
    expect(r.rankBy).toBe('pnl');
    expect(r.results[0].metrics.pnl).toBeGreaterThanOrEqual(r.results[1]?.metrics?.pnl ?? -Infinity);
  });

  it('excludes disabled dimensions like setup', () => {
    const rows = [
      trade({ setup: 'sweep', timeframe: 'M5', vwapBand: 'yes', profit: 10, status: 'CLOSED_TP' }),
      trade({ setup: 'sweep', timeframe: 'M5', vwapBand: 'yes', profit: 12, status: 'CLOSED_TP', openedAt: '2024-05-13T12:05:00.000Z' }),
      trade({ setup: 'sweep', timeframe: 'M5', vwapBand: 'yes', profit: 11, status: 'CLOSED_TP', openedAt: '2024-05-13T12:06:00.000Z' }),
      trade({ setup: 'C', timeframe: 'M15', vwapBand: 'no', profit: -120, status: 'CLOSED_SL', openedAt: '2024-05-13T12:10:00.000Z' })
    ];
    const r = searchBestFilterCombinations(rows, {
      disabledDimensions: ['setup'],
      minDecisive: 3,
      maxResults: 8
    });
    expect(r.ok).toBe(true);
    expect(r.excludedDimensions).toContain('setup');
    expect(r.results.every((x) => x.dimension !== 'setup')).toBe(true);
    expect(r.results.every((x) => !String(x.label).startsWith('setup:'))).toBe(true);
  });

  it('ranks journal tags as a dimension and patches sliceTags', () => {
    const tagged = (tags, overrides) => trade({ journal: { tags }, ...overrides });
    const rows = [
      tagged(['news'], { profit: 30, status: 'CLOSED_TP' }),
      tagged(['news'], { profit: 25, status: 'CLOSED_TP', openedAt: '2024-05-13T12:05:00.000Z' }),
      tagged(['news'], { profit: 28, status: 'CLOSED_TP', openedAt: '2024-05-13T12:06:00.000Z' }),
      tagged(['fomo'], { profit: -80, status: 'CLOSED_SL', openedAt: '2024-05-13T12:10:00.000Z' }),
      tagged(['fomo'], { profit: -60, status: 'CLOSED_SL', openedAt: '2024-05-13T12:11:00.000Z' }),
      tagged(['fomo'], { profit: -70, status: 'CLOSED_SL', openedAt: '2024-05-13T12:12:00.000Z' })
    ];
    const r = searchBestFilterCombinations(rows, { minDecisive: 3, maxResults: 12 });
    expect(r.ok).toBe(true);
    const tagResult = r.results.find((x) => x.dimension === 'tags');
    expect(tagResult).toBeTruthy();
    expect(tagResult.filterPatch.sliceTags).toHaveLength(1);
  });

  it('excludes tags dimension when sliceTags is locked', () => {
    const tagged = (tags, overrides) => trade({ journal: { tags }, ...overrides });
    const rows = [
      tagged(['news'], { timeframe: 'M5', profit: 30, status: 'CLOSED_TP' }),
      tagged(['news'], { timeframe: 'M5', profit: 25, status: 'CLOSED_TP', openedAt: '2024-05-13T12:05:00.000Z' }),
      tagged(['news'], { timeframe: 'M5', profit: 28, status: 'CLOSED_TP', openedAt: '2024-05-13T12:06:00.000Z' }),
      tagged(['news'], { timeframe: 'M15', profit: -80, status: 'CLOSED_SL', openedAt: '2024-05-13T12:10:00.000Z' })
    ];
    const r = searchBestFilterCombinations(rows, {
      lockedFilters: { sliceTags: ['news'] },
      minDecisive: 3,
      maxResults: 8
    });
    expect(r.ok).toBe(true);
    expect(r.excludedDimensions).toContain('tags');
    expect(r.results.every((x) => x.dimension !== 'tags')).toBe(true);
  });
});
