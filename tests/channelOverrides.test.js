import { describe, it, expect } from 'vitest';
const { applyChannelOverrides } = require('../src/main/channelOverrides');

describe('applyChannelOverrides', () => {
  it('returns global settings when no override exists', () => {
    const r = applyChannelOverrides({ lotMode: 'percentage' }, 'Unknown');
    expect(r.merged.lotMode).toBe('percentage');
    expect(r.override).toBeNull();
  });

  it('marks the channel as disabled when override.enabled === false', () => {
    const r = applyChannelOverrides({ channelStrategies: { 'Gold VIP': { enabled: false } } }, 'Gold VIP');
    expect(r.channelDisabled).toBe(true);
  });

  it('overrides lotMode and riskPct from per-channel config', () => {
    const settings = {
      lotMode: 'percentage',
      lotPercentage: 1,
      channelStrategies: {
        'Aggressive': { lotMode: 'riskpct', riskPct: 5 }
      }
    };
    const r = applyChannelOverrides(settings, 'Aggressive');
    expect(r.merged.lotMode).toBe('riskpct');
    expect(r.merged.riskPct).toBe(5);
  });

  it('forces blockInvalidOrMissingStopLoss when skipNoSL is true', () => {
    const r = applyChannelOverrides({
      blockInvalidOrMissingStopLoss: false,
      channelStrategies: { 'Strict': { skipNoSL: true } }
    }, 'Strict');
    expect(r.merged.blockInvalidOrMissingStopLoss).toBe(true);
  });
});
