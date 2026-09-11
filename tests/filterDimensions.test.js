import { describe, it, expect } from 'vitest';
import {
  resolveFilterDimensions,
  stripDisabledSliceFilters,
  stripDisabledLabConstraints
} from '../src/renderer/utils/filterDimensions.js';

describe('filterDimensions', () => {
  it('marks setup disabled when column hidden', () => {
    const r = resolveFilterDimensions([{ id: 'setup', enabled: false }]);
    expect(r.enabled.has('setup')).toBe(false);
    expect(r.disabled.some((d) => d.id === 'setup')).toBe(true);
    expect(r.disabledOptimizerIds).toContain('setup');
  });

  it('strips setup from active slice filters', () => {
    const patch = stripDisabledSliceFilters(
      { sliceSetups: ['sweep'], sliceBiases: ['bull'] },
      [{ id: 'setup', enabled: false }]
    );
    expect(patch.sliceSetups).toEqual([]);
    expect(patch.sliceBiases).toBeUndefined();
  });

  it('strips disabled fields from lab constraints', () => {
    const next = stripDisabledLabConstraints(
      { sliceSetups: ['sweep'], sliceWeekdays: [1] },
      [{ id: 'setup', enabled: false }]
    );
    expect(next.sliceSetups).toEqual([]);
    expect(next.sliceWeekdays).toEqual([1]);
  });
});
