import { describe, expect, it } from 'vitest';
import { buildFundamentalsDigest, normalizeDigestAssetClasses } from '../src/renderer/utils/fundamentalsDigest.js';

describe('normalizeDigestAssetClasses', () => {
  it('defaults to all classes when empty', () => {
    expect(normalizeDigestAssetClasses([])).toEqual(['forex', 'commodities', 'indices', 'crypto']);
    expect(normalizeDigestAssetClasses(null)).toEqual(['forex', 'commodities', 'indices', 'crypto']);
  });

  it('filters unknown keys', () => {
    expect(normalizeDigestAssetClasses(['forex', 'bogus'])).toEqual(['forex']);
  });
});

describe('buildFundamentalsDigest', () => {
  const base = {
    hasRealData: true,
    generatedAt: '2026-01-01T00:00:00Z',
    overview: {
      marketBias: 'BULLISH',
      sentimentRegime: 'RISK_ON',
      keyDriver: 'Test driver',
      score: 12,
      confidence: 55
    },
    checklist: { verdict: 'GO' },
    opportunities: {
      bestBuy: [
        { id: 'EURUSD', symbol: 'EURUSD', direction: 'BULLISH', trendScore: 2, assetClass: 'forex' },
        { id: 'EURGBP', symbol: 'EUR/GBP', direction: 'BULLISH', trendScore: 1.9, assetClass: 'forex' },
        { id: 'XAU', symbol: 'XAUUSD', direction: 'BULLISH', trendScore: 1.5, assetClass: 'commodities' }
      ],
      bestSell: [
        { id: 'GBPUSD', symbol: 'GBPUSD', direction: 'BEARISH', trendScore: -1, assetClass: 'forex' },
        { id: 'BTC', symbol: 'BTC', direction: 'BEARISH', trendScore: -2, assetClass: 'crypto' }
      ]
    },
    currencyStrength: {
      rows: [
        { currency: 'USD', score: 24, bias: 'STRONG', rank: 1 },
        { currency: 'EUR', score: 4, bias: 'NEUTRAL', rank: 2 },
        { currency: 'JPY', score: -18, bias: 'WEAK', rank: 8 }
      ],
      bestPair: { pair: 'EUR/GBP', bias: 'MILD', buy: 'EUR', sell: 'GBP' }
    }
  };

  it('forex-only uses USD majors and drops crosses (e.g. EURGBP)', () => {
    const d = buildFundamentalsDigest(base, { assetClasses: ['forex'] });
    const flat = [...d.focus, ...d.ignore].map((x) => String(x.symbol || '').replace(/\s/g, '').toUpperCase());
    expect(flat.some((s) => s.includes('EURGBP') || s.includes('EUR/GBP'))).toBe(false);
    expect(d.focus.every((x) => x.assetClass === 'forex')).toBe(true);
    expect(d.ignore.every((x) => x.assetClass === 'forex')).toBe(true);
    // EUR/GBP strength skew is hidden when only majors are requested
    expect(d.setups.some((s) => String(s.title || '').includes('EUR') && String(s.title || '').includes('GBP'))).toBe(false);
  });

  it('includes commodities and excludes forex focus when only commodities', () => {
    const d = buildFundamentalsDigest(base, { assetClasses: ['commodities'] });
    expect(d.focus.map((x) => x.symbol)).toContain('XAUUSD');
    expect(d.focus.some((x) => x.symbol === 'EURUSD')).toBe(false);
    expect(d.setups.some((s) => s.id.startsWith('cs-'))).toBe(false);
  });

  it('exposes coverage on digest', () => {
    const d = buildFundamentalsDigest(base, { assetClasses: ['forex', 'commodities'] });
    expect(d.coverage).toEqual(['forex', 'commodities']);
  });

  it('includes sorted currency strength when forex is in coverage', () => {
    const d = buildFundamentalsDigest(base, { assetClasses: ['forex', 'commodities'] });
    expect(Array.isArray(d.currencyStrength)).toBe(true);
    expect(d.currencyStrength.length).toBeGreaterThanOrEqual(3);
    expect(d.currencyStrength[0].currency).toBe('USD');
    expect(d.currencyStrength[0].bias).toBe('STRONG');
    const jpy = d.currencyStrength.find((x) => x.currency === 'JPY');
    expect(jpy?.bias).toBe('WEAK');
  });

  it('omits currency strength when forex is not in coverage', () => {
    const d = buildFundamentalsDigest(base, { assetClasses: ['commodities'] });
    expect(d.currencyStrength).toEqual([]);
  });
});
