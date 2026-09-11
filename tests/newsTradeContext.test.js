import { describe, expect, it } from 'vitest';

const {
  normalizeSymbolForNews,
  resolveNewsCurrenciesForSymbol,
  buildTradeNewsContext,
  pickPostBlockNewsContext
} = require('../src/main/fundamentalsService');

describe('news trade context helpers', () => {
  it('normalizes broker symbols for news lookup', () => {
    expect(normalizeSymbolForNews('US100.cash')).toBe('US100');
    expect(normalizeSymbolForNews('eurusd')).toBe('EURUSD');
  });

  it('maps indices and metals to USD macro events', () => {
    expect(resolveNewsCurrenciesForSymbol('US100.cash')).toEqual(['USD']);
    expect(resolveNewsCurrenciesForSymbol('XAUUSD')).toEqual(['USD']);
    expect(resolveNewsCurrenciesForSymbol('EURUSD')).toEqual(['EUR', 'USD']);
  });

  it('builds after-release labels', () => {
    const ctx = buildTradeNewsContext(
      { title: 'Non-Farm Payrolls', country: 'USD', impact: 3 },
      { minutes: -22, phase: 'AFTER', blocked: false, afterMinutes: 15, contextAfterMinutes: 120 }
    );
    expect(ctx.label).toBe('USD Non-Farm Payrolls was 22m ago');
    expect(ctx.minutesAgo).toBe(22);
    expect(ctx.blocked).toBe(false);
  });

  it('picks most recent event in post-block context window', () => {
    const events = [
      { title: 'Old CPI', country: 'USD', impact: 3, minutesToEvent: -90 },
      { title: 'NFP', country: 'USD', impact: 3, minutesToEvent: -25 },
      { title: 'Still blocked', country: 'USD', impact: 3, minutesToEvent: -10 }
    ];
    const ctx = pickPostBlockNewsContext(events, {
      beforeMinutes: 30,
      afterMinutes: 15,
      contextAfterMinutes: 120
    });
    expect(ctx?.title).toBe('NFP');
    expect(ctx?.minutesAgo).toBe(25);
  });

  it('returns null when all events are outside context window', () => {
    const events = [
      { title: 'NFP', country: 'USD', impact: 3, minutesToEvent: -200 }
    ];
    const ctx = pickPostBlockNewsContext(events, {
      beforeMinutes: 30,
      afterMinutes: 15,
      contextAfterMinutes: 120
    });
    expect(ctx).toBeNull();
  });
});
