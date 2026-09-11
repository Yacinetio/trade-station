import { describe, it, expect } from 'vitest';

const {
  tradesClosedBetween,
  formatDrawdown,
  formatPnl,
  buildPerformanceReportLines,
} = require('../src/main/performanceReport');

function closedTrade(overrides = {}) {
  return {
    symbol: 'EURUSD',
    profit: 100,
    status: 'TP_HIT',
    closedAt: '2024-05-13T18:00:00.000Z',
    ...overrides,
  };
}

describe('performanceReport', () => {
  it('formatDrawdown never uses a plus sign', () => {
    expect(formatDrawdown(185.4)).toBe('-$185.40');
    expect(formatDrawdown(0)).toBe('$0.00');
  });

  it('filters trades by close time, not open time', () => {
    const trades = [
      closedTrade({ closedAt: '2024-05-13T20:00:00.000Z', openedAt: '2024-05-12T10:00:00.000Z' }),
      closedTrade({
        symbol: 'GBPUSD',
        status: 'SL_HIT',
        profit: -50,
        closedAt: '2024-05-14T20:00:00.000Z',
        openedAt: '2024-05-13T10:00:00.000Z',
      }),
    ];
    const start = new Date('2024-05-13T00:00:00.000Z').getTime();
    const end = new Date('2024-05-13T23:59:59.999Z').getTime();
    const day = tradesClosedBetween(trades, start, end);
    expect(day).toHaveLength(1);
    expect(day[0].symbol).toBe('EURUSD');
  });

  it('builds outcome breakdown with TP, SL, BE, and other buckets', () => {
    const trades = [
      closedTrade({ status: 'TP_HIT', profit: 120 }),
      closedTrade({ status: 'SL_HIT', profit: -80, closedAt: '2024-05-13T19:00:00.000Z' }),
      closedTrade({ status: 'CLOSED_SL', profit: 0.49, closedAt: '2024-05-13T19:30:00.000Z' }),
      closedTrade({ status: 'CLOSED_EOD', profit: 76, closedAt: '2024-05-13T20:30:00.000Z' }),
      { symbol: 'USDJPY', status: 'SENT', profit: 0, openedAt: '2024-05-13T12:00:00.000Z' },
    ];
    const closed = trades.filter((t) => t.status !== 'SENT');
    const msg = buildPerformanceReportLines(
      closed,
      trades,
      {
        includePnl: true,
        includeWinRate: true,
        includeDrawdown: true,
        includeOpenCount: true,
        includeTrades: true,
        includeTopPerformers: false,
        includeOutcomes: true,
      },
      ['📊 *Trade Station Daily Report*', '*Date:* 5/13/2024'],
      { breakEvenAmount: 50 }
    );
    expect(msg).toContain('*Outcomes (closed in period):*');
    expect(msg).toContain('TP: 1 (+$120.00)');
    expect(msg).toContain('SL: 1 (-$80.00)');
    expect(msg).toContain('BE: 1 (+$0.49)');
    expect(msg).toContain('Other: 1 (+$76.00)');
    expect(msg).toContain('EOD close: 1 (+$76.00)');
    expect(msg).toContain('*Max Drawdown:* -$');
    expect(msg).not.toMatch(/\*Max Drawdown:\* \+/);
    expect(msg).toContain('*Open Positions:* 1');
    expect(formatPnl(-12.5)).toBe('-$12.50');
  });
});
