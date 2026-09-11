import { describe, expect, it } from 'vitest';

const {
  normalizeCorrelationSymbol,
  getCorrelationGroups,
  upgradeCorrelationGroups,
  cleanCorrelationGroups,
  DEFAULT_CORRELATION_GROUPS
} = require('../src/main/correlationGroups');

describe('correlationGroups', () => {
  it('normalizes US index broker symbols', () => {
    expect(normalizeCorrelationSymbol('US100.cash')).toBe('US100');
    expect(normalizeCorrelationSymbol('US30.cash')).toBe('US30');
    expect(normalizeCorrelationSymbol('NAS100')).toBe('US100');
  });

  it('includes US indices in defaults', () => {
    const usGroup = DEFAULT_CORRELATION_GROUPS.find((g) => g.includes('US100'));
    expect(usGroup).toEqual(['US100', 'US30', 'US500']);
  });

  it('upgrades legacy default groups to new defaults', () => {
    const legacy = [
      ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'],
      ['EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY']
    ];
    const upgraded = upgradeCorrelationGroups(legacy);
    expect(upgraded.some((g) => g.includes('US100') && g.includes('US30'))).toBe(true);
  });

  it('cleans custom groups from settings', () => {
    const cleaned = cleanCorrelationGroups([
      ['us100.cash', 'US30.CASH'],
      ['solo']
    ]);
    expect(cleaned).toEqual([['US100', 'US30']]);
  });

  it('resolves groups for execution guard settings', () => {
    const groups = getCorrelationGroups({
      correlationGroups: [['US100.cash', 'US30.cash']]
    });
    expect(groups[0]).toEqual(['US100', 'US30']);
  });
});
