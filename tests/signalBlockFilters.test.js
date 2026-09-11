import { describe, it, expect } from 'vitest';

const {
  evaluateAdvancedSignalBlock,
  rowMatchesProfile,
  coerceProfile,
  profileHasActiveCriteria
} = require('../src/main/signalBlockFilters.js');

describe('signalBlockFilters', () => {
  it('disabled setting never blocks', () => {
    const r = evaluateAdvancedSignalBlock(
      { enableAdvancedSignalBlockFilters: false, signalBlockFilters: { symbols: ['EURUSD'] } },
      { symbol: 'EURUSD', type: 'BUY', channel: 'ch' },
      new Date('2024-05-13T12:00:00')
    );
    expect(r.blocked).toBe(false);
  });

  it('no active criteria never blocks', () => {
    const r = evaluateAdvancedSignalBlock(
      { enableAdvancedSignalBlockFilters: true, signalBlockFilters: {} },
      { symbol: 'EURUSD', type: 'BUY', channel: 'ch' },
      new Date()
    );
    expect(r.blocked).toBe(false);
    expect(profileHasActiveCriteria(coerceProfile({}))).toBe(false);
  });

  it('blocks when all active criteria match', () => {
    const r = evaluateAdvancedSignalBlock(
      {
        enableAdvancedSignalBlockFilters: true,
        signalBlockFilters: {
          symbols: ['EURUSD'],
          types: ['BUY'],
          sessionNames: ['london'],
          trendAlignTerms: ['with'],
          top1Values: ['yes'],
          confluenceMin: 2,
          rejPctMin: 60
        }
      },
      {
        symbol: 'EURUSD',
        type: 'BUY',
        channel: 'SignalLab',
        timeframe: 'M15',
        bias: 'bullish',
        vwapBand: 'yes',
        trendAlign: 'with',
        top1: true,
        confluence: 3,
        rejPct: 72,
        presetTags: []
      },
      new Date('2024-05-13T12:00:00Z')
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('EURUSD');
    expect(r.reason).toContain('trend');
  });

  it('does not block when trendAlign criterion fails', () => {
    const r = evaluateAdvancedSignalBlock(
      {
        enableAdvancedSignalBlockFilters: true,
        signalBlockFilters: { trendAlignTerms: ['against'] }
      },
      { symbol: 'EURUSD', type: 'BUY', channel: 'c', trendAlign: 'with' },
      new Date()
    );
    expect(r.blocked).toBe(false);
  });

  it('does not block when confluence below minimum', () => {
    const r = evaluateAdvancedSignalBlock(
      {
        enableAdvancedSignalBlockFilters: true,
        signalBlockFilters: { confluenceMin: 3 }
      },
      { symbol: 'EURUSD', type: 'BUY', channel: 'c', confluence: 1 },
      new Date()
    );
    expect(r.blocked).toBe(false);
  });

  it('blocks when confluence meets minimum and profile active', () => {
    const r = evaluateAdvancedSignalBlock(
      {
        enableAdvancedSignalBlockFilters: true,
        signalBlockFilters: { symbols: ['EURUSD'], confluenceMin: 2 }
      },
      { symbol: 'EURUSD', type: 'BUY', channel: 'c', confluence: 3 },
      new Date()
    );
    expect(r.blocked).toBe(true);
  });

  it('blocks when all active criteria match (legacy session)', () => {
    const r = evaluateAdvancedSignalBlock(
      {
        enableAdvancedSignalBlockFilters: true,
        signalBlockFilters: {
          symbols: ['EURUSD'],
          types: ['BUY'],
          sessionNames: ['london']
        }
      },
      {
        symbol: 'EURUSD',
        type: 'BUY',
        channel: 'SignalLab',
        timeframe: 'M15',
        bias: 'bullish',
        vwapBand: 'yes',
        presetTags: []
      },
      new Date('2024-05-13T12:00:00Z')
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('EURUSD');
  });

  it('does not block when one criterion fails', () => {
    const r = evaluateAdvancedSignalBlock(
      {
        enableAdvancedSignalBlockFilters: true,
        signalBlockFilters: { symbols: ['GER40'], types: ['BUY'] }
      },
      { symbol: 'EURUSD', type: 'BUY', channel: 'c' },
      new Date()
    );
    expect(r.blocked).toBe(false);
  });  it('rowMatchesProfile respects weekdayIndices', () => {
    const d = new Date('2024-06-03T12:00:00');
    const wd = d.getDay();
    const p = coerceProfile({ weekdayIndices: [wd] });
    expect(rowMatchesProfile({ symbol: 'X', type: 'BUY', channel: 'c' }, p, d)).toBe(true);
    const other = (wd + 1) % 7;
    expect(rowMatchesProfile({ symbol: 'X', type: 'BUY', channel: 'c' }, coerceProfile({ weekdayIndices: [other] }), d)).toBe(false);
  });
});
