import { describe, expect, it } from 'vitest';
import {
  normalizeTradeSymbolKey,
  resolveFundInstrumentId,
  buildScreenerBiasMap,
  lookupScreenerBias
} from '../src/renderer/utils/fundamentalsSymbolMap.js';

describe('fundamentalsSymbolMap', () => {
  it('strips broker suffixes from trade symbols', () => {
    expect(normalizeTradeSymbolKey('US100.cash')).toBe('US100');
    expect(normalizeTradeSymbolKey('US100.ca')).toBe('US100');
    expect(normalizeTradeSymbolKey('EURUSDm')).toBe('EURUSD');
  });

  it('maps trade symbols to fundamentals instrument ids', () => {
    expect(resolveFundInstrumentId('XAUUSD')).toBe('XAU');
    expect(resolveFundInstrumentId('US100.cash')).toBe('NDX');
    expect(resolveFundInstrumentId('EURUSD')).toBe('EURUSD');
  });

  it('builds screener map with trade aliases and looks up fund bias', () => {
    const rows = [
      { id: 'XAU', symbol: 'Gold', sourceSymbol: 'GC=F', direction: 'BULLISH' },
      { id: 'NDX', symbol: 'NASDAQ 100', sourceSymbol: '^NDX', direction: 'BEARISH' },
      { id: 'EURUSD', symbol: 'EUR/USD', sourceSymbol: 'EURUSD=X', direction: 'NEUTRAL' }
    ];
    const map = buildScreenerBiasMap(rows);

    expect(lookupScreenerBias(map, 'XAUUSD')).toBe('BULLISH');
    expect(lookupScreenerBias(map, 'US100.ca')).toBe('BEARISH');
    expect(lookupScreenerBias(map, 'EURUSD')).toBe('NEUTRAL');
    expect(lookupScreenerBias(map, 'GBPUSD')).toBe('');
  });
});
