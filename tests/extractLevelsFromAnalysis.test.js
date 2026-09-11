import { describe, it, expect } from 'vitest';
import { extractEntrySlTpFromAnalysis, detectBiasFromAnalysis } from '../src/renderer/utils/extractLevelsFromAnalysis.js';

describe('extractEntrySlTpFromAnalysis', () => {
  it('keeps only entry, SL, TP and uses last mention per role', () => {
    const t = 'noise support 1.0400\nEntry 1.0520 SL 1.0500 TP 1.0600\nlater TP 1.0620';
    const r = extractEntrySlTpFromAnalysis(t, { lo: 1.04, hi: 1.07 });
    expect(r.length).toBe(3);
    expect(r.find((x) => x.role === 'entry')?.price).toBe(1.052);
    expect(r.find((x) => x.role === 'stop')?.price).toBe(1.05);
    expect(r.find((x) => x.role === 'target')?.price).toBe(1.062);
    expect(r.map((x) => x.label)).toEqual(['Entry', 'SL', 'TP']);
  });

  it('filters outside extended bar range', () => {
    const t = 'Entry 99.99 SL 1.051 TP 1.060';
    const r = extractEntrySlTpFromAnalysis(t, { lo: 1.05, hi: 1.06 });
    expect(r.some((x) => x.price === 99.99)).toBe(false);
  });
});

describe('detectBiasFromAnalysis', () => {
  it('detects buy', () => {
    expect(detectBiasFromAnalysis('…final lean is to buy the dip.')).toBe('buy');
  });
  it('detects sell', () => {
    expect(detectBiasFromAnalysis('short bias into resistance')).toBe('sell');
  });
});
