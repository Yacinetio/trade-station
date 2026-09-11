import { describe, it, expect } from 'vitest';
import { triBandValue, trendAlignValue } from '../src/renderer/utils/manualTradeFormUtils.js';

describe('manualTradeFormUtils band values', () => {
  it('triBandValue accepts yes/no/na only', () => {
    expect(triBandValue('YES')).toBe('yes');
    expect(triBandValue('with')).toBe('');
  });

  it('trendAlignValue accepts with/against/neutral/na', () => {
    expect(trendAlignValue('WITH')).toBe('with');
    expect(trendAlignValue('against')).toBe('against');
    expect(trendAlignValue('NEUTRAL')).toBe('neutral');
    expect(trendAlignValue('n/a')).toBe('na');
    expect(trendAlignValue('yes')).toBe('');
  });
});
