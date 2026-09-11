import { describe, it, expect } from 'vitest';
const {
  isSpreadEntryPair,
  isSpreadEntryAllPairs,
  attachLiveSpreadForEntryAdjust
} = require('../src/main/spreadQuoteService');

describe('spreadQuoteService', () => {
  it('isSpreadEntryPair matches listed symbols only', () => {
    const settings = {
      enableSpreadEntryAdjust: true,
      spreadEntryRules: [{ symbol: 'US100' }, { symbol: 'XAUUSD' }]
    };
    expect(isSpreadEntryPair(settings, 'US100.cash')).toBe(true);
    expect(isSpreadEntryPair(settings, 'EURUSD')).toBe(false);
  });

  it('attachLiveSpreadForEntryAdjust uses MT5 live spread', async () => {
    const out = await attachLiveSpreadForEntryAdjust(
      { symbol: 'US100', type: 'BUY', entry: 21000 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'US100' }] },
      async () => ({ success: true, spreadPips: 11.5 })
    );
    expect(out.spreadPips).toBeCloseTo(11.5);
    expect(out.spreadEntrySource).toBe('live');
  });

  it('attachLiveSpreadForEntryAdjust falls back when MT5 offline', async () => {
    const out = await attachLiveSpreadForEntryAdjust(
      { symbol: 'US100', type: 'BUY', entry: 21000 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'US100', spreadPips: 9 }] },
      async () => ({ success: false, error: 'NO_MT5' })
    );
    expect(out.spreadPips).toBe(9);
    expect(out.spreadEntrySource).toBe('fallback');
  });

  it('all pairs mode applies to any symbol', () => {
    const settings = {
      enableSpreadEntryAdjust: true,
      spreadEntryAllPairs: true,
      spreadEntryRules: []
    };
    expect(isSpreadEntryAllPairs(settings)).toBe(true);
    expect(isSpreadEntryPair(settings, 'EURUSD')).toBe(true);
    expect(isSpreadEntryPair(settings, 'GBPJPY')).toBe(true);
  });

  it('all pairs mode fetches live spread for unlisted symbol', async () => {
    const out = await attachLiveSpreadForEntryAdjust(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1 },
      { enableSpreadEntryAdjust: true, spreadEntryAllPairs: true, spreadEntryRules: [] },
      async () => ({ success: true, spreadPips: 0.8 })
    );
    expect(out.spreadPips).toBeCloseTo(0.8);
    expect(out.spreadEntrySource).toBe('live');
  });

  it('leaves signal unchanged for unlisted pairs when MT5 returns spread only', async () => {
    const sig = { symbol: 'EURUSD', type: 'BUY', entry: 1.1 };
    const out = await attachLiveSpreadForEntryAdjust(
      sig,
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'US100' }] },
      async () => ({ success: true, spreadPips: 12 })
    );
    expect(out).toBe(sig);
    expect(out.spreadPips).toBeUndefined();
  });

  it('attaches broker pip value even when spread offset is off for the symbol', async () => {
    const out = await attachLiveSpreadForEntryAdjust(
      { symbol: 'GBPJPY', type: 'SELL', entry: 214.65 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'US100' }] },
      async () => ({ success: true, spreadPips: 3, usdPerPipPerLot: 7.74 })
    );
    expect(out.usdPerPipPerLot).toBeCloseTo(7.74);
    expect(out.spreadPips).toBeUndefined();
  });
});
