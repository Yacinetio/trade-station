import { describe, it, expect } from 'vitest';

const { buildTradesCsv, buildTradesJson, summarizeTrades } = require('../src/main/tradeExport');

const sampleTrades = [
  {
    id: 'a1',
    openedAt: '2026-07-01T10:00:00Z',
    channel: 'Gold Signals',
    symbol: 'XAUUSD',
    type: 'BUY',
    status: 'CLOSED_TP',
    entry: 2300.5,
    sl: 2290,
    tp: [2310, 2320],
    lot: 0.1,
    profit: 95.5,
    comment: 'has, comma and "quotes"',
    journal: { tags: ['news', 'a+'] },
    accountKey: 'acc-1'
  },
  {
    id: 'a2',
    openedAt: '2026-07-01T11:00:00Z',
    channel: 'FX',
    symbol: 'EURUSD',
    type: 'SELL',
    status: 'CLOSED_SL',
    entry: 1.085,
    sl: 1.09,
    tp: 1.08,
    lot: 0.2,
    profit: -40,
    accountKey: 'acc-1'
  },
  { id: 'a3', symbol: 'GBPUSD', type: 'BUY', status: 'SENT', profit: 0 }
];

describe('tradeExport', () => {
  it('builds a CSV with a header and one line per trade', () => {
    const csv = buildTradesCsv(sampleTrades);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1 + sampleTrades.length);
    expect(lines[0].startsWith('id,openedAt,')).toBe(true);
  });

  it('escapes commas and quotes in CSV fields', () => {
    const csv = buildTradesCsv(sampleTrades);
    expect(csv).toContain('"has, comma and ""quotes"""');
  });

  it('joins TP arrays and journal tags', () => {
    const csv = buildTradesCsv(sampleTrades);
    expect(csv).toContain('2310; 2320');
    expect(csv).toContain('news; a+');
  });

  it('handles an empty trade list', () => {
    const csv = buildTradesCsv([]);
    expect(csv.trim().split('\n').length).toBe(1);
  });

  it('builds JSON with metadata and full rows', () => {
    const parsed = JSON.parse(buildTradesJson(sampleTrades));
    expect(parsed.tradeCount).toBe(3);
    expect(parsed.trades[0].id).toBe('a1');
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('summarizes closed trades for the PDF header', () => {
    const s = summarizeTrades(sampleTrades);
    expect(s.tradeCount).toBe(3);
    expect(s.closedCount).toBe(2);
    expect(s.totalPnl).toBeCloseTo(55.5);
    expect(s.winRate).toBe(50);
  });
});
