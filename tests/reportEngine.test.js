import { describe, it, expect } from 'vitest';
import {
  DIMENSIONS,
  listDimensions,
  computeReport,
  applyReportFilter,
  compareReports,
  winsVsLossesCompare,
  buildReportContext,
  classifySymbol
} from '../src/main/reportEngine.js';

function mk(overrides = {}) {
  return {
    id: overrides.id,
    symbol: 'EURUSD',
    type: 'BUY',
    orderType: 'MARKET',
    entry: 1.1,
    sl: 1.099,
    tp: [1.102],
    lot: 0.01,
    profit: 0,
    status: 'SENT',
    accountKey: 'acc1',
    channel: 'Misc',
    ...overrides
  };
}

// June 2026 (UTC): Jun 1 = Monday, Jun 5 = Friday, Jun 7 = Sunday, Jun 8 = Monday.
const FIXTURE = [
  mk({
    id: 't1', symbol: 'EURUSD', type: 'BUY', entry: 1.1, sl: 1.099, tp: [1.102],
    lot: 0.01, profit: 100, status: 'CLOSED_TP', channel: 'Alpha', timeframe: 'M15',
    openedAt: '2026-06-01T08:30:00Z', closedAt: '2026-06-01T09:00:00Z',
    riskUsd: 50, plannedRR: 2, realizedR: 2,
    journal: { tags: ['fomo', 'a-plus'], confidence: 8, emotion: 'calm', rating: 'A', notes: 'clean break' }
  }),
  mk({
    id: 't2', symbol: 'EURUSD', type: 'SELL', entry: 1.105, sl: 1.106, tp: [1.103],
    lot: 0.02, profit: -50, status: 'CLOSED_SL', channel: 'Alpha',
    openedAt: '2026-06-01T14:00:00Z', closedAt: '2026-06-01T14:20:00Z',
    riskUsd: 50, plannedRR: 2, realizedR: -1,
    journal: { tags: ['fomo'] }
  }),
  mk({
    id: 't3', symbol: 'GBPJPY', type: 'BUY', entry: 190, sl: 189.5, tp: [191],
    lot: 0.1, profit: 200, status: 'CLOSED_TP', channel: 'Beta', timeframe: 'H1',
    openedAt: '2026-06-02T03:00:00Z', closedAt: '2026-06-02T11:00:00Z',
    riskUsd: 100, plannedRR: 3, realizedR: 1.5,
    presetTags: ['breakout']
  }),
  mk({
    id: 't4', symbol: 'XAUUSD', type: 'SELL', entry: 2400, sl: 2410, tp: [2380],
    lot: 0.5, profit: -100, status: 'CLOSED_SL', channel: 'Beta',
    openedAt: '2026-06-02T22:00:00Z', closedAt: '2026-06-03T01:00:00Z',
    riskUsd: 100,
    excursion: { mfePips: 30, maePips: 100, mfeMoney: 150, maeMoney: -500 }
  }),
  mk({
    id: 't5', symbol: 'US30', type: 'BUY', lot: 1, profit: 0, status: 'SENT',
    channel: 'Alpha', openedAt: '2026-06-03T13:05:00Z', entry: 39000, sl: 38900, tp: [39200]
  }),
  mk({
    id: 't6', symbol: 'EURUSD', status: 'BLOCKED_HIGH_NEWS', blockedReason: 'news',
    channel: 'Gamma', openedAt: '2026-06-03T14:00:00Z', profit: 0
  }),
  mk({
    id: 't7', symbol: 'BTCUSD', type: 'BUY', entry: 65000, sl: 64000, tp: [70000],
    lot: 2, profit: 300, status: 'CLOSED_TP', channel: 'Crypto',
    openedAt: '2026-06-04T05:00:00Z', closedAt: '2026-06-08T05:00:00Z'
  }),
  mk({
    id: 't8', profit: 50, status: 'CLOSED_TP', channel: 'Delta',
    openedAt: '2026-06-05T08:00:00Z', closedAt: '2026-06-05T08:10:00Z'
  }),
  mk({
    id: 't9', profit: -20, status: 'CLOSED_SL', channel: 'Delta',
    openedAt: '2026-06-05T08:12:00Z', closedAt: '2026-06-05T08:30:00Z'
  }),
  mk({
    id: 't10', profit: -30, status: 'CLOSED_SL', channel: 'Delta',
    openedAt: '2026-06-05T09:00:00Z', closedAt: '2026-06-05T09:30:00Z'
  }),
  mk({
    id: 't11', profit: 10, status: 'CLOSED_TP', channel: 'Delta',
    openedAt: '2026-06-05T12:00:00Z', closedAt: '2026-06-05T12:30:00Z'
  }),
  mk({
    id: 't12', symbol: 'USDJPY', accountKey: 'acc2', profit: 75, status: 'CLOSED_TP',
    channel: 'Delta', openedAt: '2026-06-05T08:00:00Z', closedAt: '2026-06-05T10:00:00Z',
    entry: 155, sl: 154.5, tp: [156]
  }),
  mk({
    id: 't13', symbol: 'NAS100', profit: -80, status: 'CLOSED_SL', userEdited: true,
    openedAt: '2026-06-08T15:00:00Z', closedAt: '2026-06-08T16:00:00Z',
    entry: 18000, sl: 18100, tp: [17800]
  }),
  mk({
    id: 't14', profit: 120, status: 'CLOSED_TP', aiCheck: { score: 90 },
    openedAt: '2026-06-09T10:00:00Z', closedAt: '2026-06-09T12:00:00Z'
  }),
  mk({
    id: 't15', profit: -40, status: 'CLOSED_SL', aiCheck: { score: 60 },
    openedAt: '2026-06-09T16:00:00Z', closedAt: '2026-06-09T17:00:00Z'
  }),
  mk({
    id: 't16', profit: 60, status: 'CLOSED_TP', sl: null, tp: [1.11, 1.12, 1.13],
    openedAt: '2026-06-10T07:30:00Z', closedAt: '2026-06-10T09:30:00Z'
  }),
  mk({
    id: 't17', profit: -150, status: 'CLOSED_SL', strategyId: 'ict-fvg', realizedR: -1.5,
    openedAt: '2026-06-10T13:30:00Z', closedAt: '2026-06-10T14:30:00Z',
    journal: { tags: [], mistakes: ['revenge', 'oversized'], emotion: 'revenge', rating: 'C' }
  }),
  mk({
    id: 't18', symbol: 'GBPUSD', type: 'BUY', sigEntry: 1.2, entry: 1.2005, sl: 1.195,
    profit: 30, status: 'CLOSED_TP',
    openedAt: '2026-06-11T09:00:00Z', closedAt: '2026-06-11T10:00:00Z'
  }),
  mk({
    id: 't19', symbol: 'XAUUSD', type: 'BUY', sigEntry: 2400, entry: 2399, sl: 2395,
    profit: 45, status: 'CLOSED_TP', plannedRR: 0.8,
    openedAt: '2026-06-11T11:00:00Z', closedAt: '2026-06-11T12:00:00Z'
  }),
  mk({
    id: 't20', profit: 0, status: 'CLOSED',
    openedAt: '2026-06-12T10:00:00Z', closedAt: '2026-06-12T11:00:00Z'
  })
];

function findTrade(id) {
  return FIXTURE.find((t) => t.id === id);
}

function keyOf(dimensionId, trade, ctx) {
  const dim = DIMENSIONS.find((d) => d.id === dimensionId);
  return dim.keyFn(trade, ctx);
}

describe('reportEngine dimension registry', () => {
  it('registers at least 50 dimensions with unique ids', () => {
    expect(DIMENSIONS.length).toBeGreaterThanOrEqual(50);
    const ids = new Set(DIMENSIONS.map((d) => d.id));
    expect(ids.size).toBe(DIMENSIONS.length);
    for (const dim of DIMENSIONS) {
      expect(dim.label).toBeTruthy();
      expect(dim.group).toBeTruthy();
      expect(typeof dim.keyFn).toBe('function');
    }
  });

  it('every dimension computes without throwing and yields rows on the fixture set', () => {
    for (const dim of DIMENSIONS) {
      const report = computeReport(FIXTURE, { dimensionId: dim.id });
      expect(Array.isArray(report.rows)).toBe(true);
      expect(report.rows.length, `dimension ${dim.id} produced no rows`).toBeGreaterThan(0);
      for (const row of report.rows) {
        expect(typeof row.key).toBe('string');
        expect(Number.isFinite(row.count)).toBe(true);
      }
    }
  });

  it('throws on unknown dimension', () => {
    expect(() => computeReport(FIXTURE, { dimensionId: 'nope' })).toThrow(/Unknown report dimension/);
  });

  it('listDimensions groups all registered dimensions', () => {
    const groups = listDimensions();
    const total = groups.reduce((a, g) => a + g.dimensions.length, 0);
    expect(total).toBe(DIMENSIONS.length);
    expect(groups.map((g) => g.group)).toContain('Date & Time');
  });
});

describe('dimension keying', () => {
  const ctx = buildReportContext(FIXTURE);

  it('day-of-week keys June 1 2026 as Monday', () => {
    expect(keyOf('day-of-week', findTrade('t1'), ctx)).toBe('Monday');
    expect(keyOf('day-of-week', findTrade('t8'), ctx)).toBe('Friday');
  });

  it('session buckets follow the UTC hour spec', () => {
    expect(keyOf('session', findTrade('t3'), ctx)).toBe('Asian');   // 03:00
    expect(keyOf('session', findTrade('t1'), ctx)).toBe('London');  // 08:30
    expect(keyOf('session', findTrade('t2'), ctx)).toBe('NewYork'); // 14:00
    expect(keyOf('session', findTrade('t4'), ctx)).toBe('Late');    // 22:00
  });

  it('lot buckets', () => {
    expect(keyOf('lot-bucket', findTrade('t1'), ctx)).toBe('≤0.01');
    expect(keyOf('lot-bucket', findTrade('t2'), ctx)).toBe('0.02-0.05');
    expect(keyOf('lot-bucket', findTrade('t3'), ctx)).toBe('0.06-0.1');
    expect(keyOf('lot-bucket', findTrade('t4'), ctx)).toBe('0.11-0.5');
    expect(keyOf('lot-bucket', findTrade('t5'), ctx)).toBe('0.51-1');
    expect(keyOf('lot-bucket', findTrade('t7'), ctx)).toBe('>1');
  });

  it('realized R buckets', () => {
    expect(keyOf('realized-r-bucket', findTrade('t1'), ctx)).toBe('≥2R');
    expect(keyOf('realized-r-bucket', findTrade('t2'), ctx)).toBe('≤-1R');
    expect(keyOf('realized-r-bucket', findTrade('t17'), ctx)).toBe('≤-1R');
    expect(keyOf('realized-r-bucket', findTrade('t3'), ctx)).toBe('1-2R');
    expect(keyOf('realized-r-bucket', findTrade('t4'), ctx)).toBe(null);
  });

  it('journal tags are multi-key', () => {
    const report = computeReport(FIXTURE, { dimensionId: 'journal-tag' });
    const fomo = report.rows.find((r) => r.key === 'fomo');
    const aplus = report.rows.find((r) => r.key === 'a-plus');
    expect(fomo.count).toBe(2); // t1 + t2
    expect(aplus.count).toBe(1);
  });

  it('symbol classifier', () => {
    expect(classifySymbol('EURUSD')).toBe('forex major');
    expect(classifySymbol('GBPJPY')).toBe('forex cross');
    expect(classifySymbol('XAUUSD.m')).toBe('metal');
    expect(classifySymbol('US30')).toBe('index');
    expect(classifySymbol('BTCUSD')).toBe('crypto');
    expect(classifySymbol('WEIRD')).toBe('other');
  });

  it('SL distance pip buckets respect symbol pip size', () => {
    expect(keyOf('sl-distance-bucket', findTrade('t1'), ctx)).toBe('10-25 pips'); // 10 pips @ 0.0001
    expect(keyOf('sl-distance-bucket', findTrade('t3'), ctx)).toBe('50-100 pips'); // 50 pips @ 0.01 (JPY)
    expect(keyOf('sl-distance-bucket', findTrade('t4'), ctx)).toBe('>100 pips'); // 100 pips @ 0.1 (gold)
    expect(keyOf('sl-distance-bucket', findTrade('t16'), ctx)).toBe(null); // no SL
  });

  it('execution dimensions', () => {
    expect(keyOf('has-sl', findTrade('t16'), ctx)).toBe('no SL');
    expect(keyOf('tp-count', findTrade('t16'), ctx)).toBe('3+ TP');
    expect(keyOf('outcome', findTrade('t20'), ctx)).toBe('breakeven');
    expect(keyOf('entry-slippage', findTrade('t18'), ctx)).toBe('worse than signal');
    expect(keyOf('entry-slippage', findTrade('t19'), ctx)).toBe('better than signal');
    expect(keyOf('weekend-held', findTrade('t7'), ctx)).toBe('held over weekend');
    expect(keyOf('weekend-held', findTrade('t1'), ctx)).toBe('intra-week');
    expect(keyOf('blocked-vs-executed', findTrade('t6'), ctx)).toBe('blocked');
    expect(keyOf('edited-vs-original', findTrade('t13'), ctx)).toBe('edited');
  });

  it('excursion dimensions on t4', () => {
    expect(keyOf('efficiency-bucket', findTrade('t4'), ctx)).toBe('<25%');       // -100/150
    expect(keyOf('mae-vs-sl-bucket', findTrade('t4'), ctx)).toBe('75-100% of SL'); // 100/100 pips
    expect(keyOf('mfe-captured-bucket', findTrade('t4'), ctx)).toBe('1-2R');     // 150$/100$
  });

  it('AI verdict buckets', () => {
    expect(keyOf('ai-verdict', findTrade('t14'), ctx)).toBe('≥85');
    expect(keyOf('ai-verdict', findTrade('t15'), ctx)).toBe('50-70');
    expect(keyOf('ai-verdict', findTrade('t1'), ctx)).toBe('no-ai');
  });

  it('behavior dimensions use per-account ordering', () => {
    expect(keyOf('trade-of-day', findTrade('t8'), ctx)).toBe('1st');
    expect(keyOf('trade-of-day', findTrade('t9'), ctx)).toBe('2nd');
    expect(keyOf('trade-of-day', findTrade('t10'), ctx)).toBe('3rd');
    expect(keyOf('trade-of-day', findTrade('t11'), ctx)).toBe('4th+');
    expect(keyOf('trade-of-day', findTrade('t12'), ctx)).toBe('1st'); // acc2

    expect(keyOf('after-win-loss', findTrade('t9'), ctx)).toBe('after win');   // t8 closed +50
    expect(keyOf('after-win-loss', findTrade('t10'), ctx)).toBe('after loss'); // t9 closed -20

    expect(keyOf('day-pnl-at-open', findTrade('t9'), ctx)).toBe('green day');       // +50 booked
    expect(keyOf('day-pnl-at-open', findTrade('t11'), ctx)).toBe('flat / first of day'); // 50-20-30 = 0
    expect(keyOf('day-pnl-at-open', findTrade('t8'), ctx)).toBe('flat / first of day');

    expect(keyOf('time-since-prev-trade', findTrade('t9'), ctx)).toBe('5-30m');   // 12 min after t8
    expect(keyOf('time-since-prev-trade', findTrade('t10'), ctx)).toBe('30m-2h'); // 48 min after t9
    expect(keyOf('time-since-prev-trade', findTrade('t12'), ctx)).toBe('first trade'); // acc2
  });
});

describe('computeReport metric math', () => {
  it('hand-computed metrics for the Alpha channel bucket', () => {
    const report = computeReport(FIXTURE, { dimensionId: 'channel' });
    const alpha = report.rows.find((r) => r.key === 'Alpha');
    expect(alpha).toBeTruthy();
    expect(alpha.count).toBe(3);       // t1, t2, t5 (open counts)
    expect(alpha.closedCount).toBe(2); // t1, t2
    expect(alpha.wins).toBe(1);
    expect(alpha.losses).toBe(1);
    expect(alpha.netPnl).toBe(50);       // 100 - 50
    expect(alpha.winRatePct).toBe(50);
    expect(alpha.avgWin).toBe(100);
    expect(alpha.avgLoss).toBe(50);
    expect(alpha.profitFactor).toBe(2);  // 100 / 50
    expect(alpha.expectancy).toBe(25);   // 50 / 2 closed
    expect(alpha.totalR).toBe(1);        // 2 + (-1)
  });

  it('sorts ordered dimensions by natural order', () => {
    const report = computeReport(FIXTURE, { dimensionId: 'session' });
    const keys = report.rows.map((r) => r.key);
    const expectedOrder = ['Asian', 'London', 'NewYork', 'Late'].filter((k) => keys.includes(k));
    expect(keys).toEqual(expectedOrder);
  });

  it('sorts unordered dimensions by net P&L descending', () => {
    const report = computeReport(FIXTURE, { dimensionId: 'channel' });
    const pnls = report.rows.map((r) => r.netPnl);
    const sorted = [...pnls].sort((a, b) => b - a);
    expect(pnls).toEqual(sorted);
  });
});

describe('applyReportFilter', () => {
  it('filters by channel, symbol, direction, account and tags', () => {
    expect(applyReportFilter(FIXTURE, { channels: ['Alpha'] }).map((t) => t.id)).toEqual(['t1', 't2', 't5']);
    expect(applyReportFilter(FIXTURE, { symbols: ['GBPUSD'] }).map((t) => t.id)).toEqual(['t18']);
    expect(applyReportFilter(FIXTURE, { accountKeys: ['acc2'] }).map((t) => t.id)).toEqual(['t12']);
    expect(applyReportFilter(FIXTURE, { tags: ['fomo'] }).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(applyReportFilter(FIXTURE, { tags: ['breakout'] }).map((t) => t.id)).toEqual(['t3']);
    expect(applyReportFilter(FIXTURE, { strategyIds: ['ict-fvg'] }).map((t) => t.id)).toEqual(['t17']);
    const sells = applyReportFilter(FIXTURE, { direction: 'SELL' }).map((t) => t.id);
    expect(sells).toEqual(['t2', 't4']);
  });

  it('filters by date range (closed trades keyed on close date)', () => {
    const rows = applyReportFilter(FIXTURE, {
      dateFromMs: Date.UTC(2026, 5, 1),
      dateToMs: Date.UTC(2026, 5, 2)
    });
    expect(rows.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('filters by win/loss outcome', () => {
    const wins = applyReportFilter(FIXTURE, { winLoss: 'WIN' });
    expect(wins.every((t) => Number(t.profit) > 0)).toBe(true);
    expect(wins.length).toBe(10);
    const be = applyReportFilter(FIXTURE, { winLoss: 'BREAKEVEN' }).map((t) => t.id);
    expect(be).toEqual(['t20']);
  });

  it('filters via shared tradeFilters payload (app-wide filters)', () => {
    const filtered = applyReportFilter(FIXTURE, {
      tradeFilters: {
        filterChannel: 'Alpha',
        sliceTags: ['fomo']
      },
      accountKeys: [],
      timeScope: 'ALL',
      breakEvenAmount: 50
    });
    expect(filtered.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('compareReports', () => {
  it('computes KPI sides and A-minus-B deltas', () => {
    const { a, b, deltas } = compareReports(FIXTURE, {
      filterA: { channels: ['Alpha'] },
      filterB: { channels: ['Beta'] }
    });
    expect(a.count).toBe(3);
    expect(b.count).toBe(2);
    expect(a.netPnl).toBe(50);
    expect(b.netPnl).toBe(100);   // 200 - 100
    expect(deltas.netPnl).toBe(-50);
    expect(deltas.count).toBe(1);
    expect(a.maxDrawdown).toBe(50);  // 100 → 50 equity
    expect(b.maxDrawdown).toBe(100); // 200 → 100 equity
    expect(deltas.maxDrawdown).toBe(-50);
    expect(b.avgR).toBe(1.5); // only t3 carries realizedR
  });

  it('wins vs losses preset', () => {
    const { a, b, labels } = winsVsLossesCompare(FIXTURE);
    expect(labels).toEqual({ a: 'Winners', b: 'Losers' });
    expect(a.count).toBe(10);
    expect(b.count).toBe(7);
    expect(a.netPnl).toBe(990);
    expect(b.netPnl).toBe(-470);
    expect(a.winRatePct).toBe(100);
    expect(b.winRatePct).toBe(0);
  });

  it('preset respects a base filter', () => {
    const { a, b } = winsVsLossesCompare(FIXTURE, { channels: ['Alpha'] });
    expect(a.count).toBe(1); // t1
    expect(b.count).toBe(1); // t2
    expect(a.netPnl).toBe(100);
    expect(b.netPnl).toBe(-50);
  });
});
