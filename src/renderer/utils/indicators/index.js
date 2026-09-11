import { computeEmaSeries, computeSmaSeries } from './ema.js';
import { computeVwap } from './vwap.js';
import { computeAtrBands } from './atrBands.js';
import { computeSessionRanges } from './sessionRanges.js';
import { computeFvgZones } from './fvg.js';
import { computeKeyLevels } from './keyLevels.js';

export const REGISTRY = [
  {
    id: 'ema20',
    label: 'EMA 20',
    render: 'line',
    compute: (bars) => computeEmaSeries(bars, { period: 20 })
  },
  {
    id: 'ema50',
    label: 'EMA 50',
    render: 'line',
    compute: (bars) => computeEmaSeries(bars, { period: 50 })
  },
  {
    id: 'sma20',
    label: 'SMA 20',
    render: 'line',
    compute: (bars) => computeSmaSeries(bars, { period: 20 })
  },
  {
    id: 'vwap',
    label: 'VWAP',
    render: 'line',
    compute: (bars) => computeVwap(bars)
  },
  {
    id: 'atrBands',
    label: 'ATR Bands',
    render: 'band',
    compute: (bars) => computeAtrBands(bars, { period: 14, multiplier: 2 })
  },
  {
    id: 'sessionRanges',
    label: 'Session ranges',
    render: 'boxes',
    compute: (bars) => computeSessionRanges(bars)
  },
  {
    id: 'fvg',
    label: 'Fair Value Gaps',
    render: 'boxes',
    compute: (bars) => computeFvgZones(bars)
  },
  {
    id: 'keyLevels',
    label: 'Key levels',
    render: 'levels',
    compute: (bars) => computeKeyLevels(bars)
  }
];

export function listIndicators() {
  return REGISTRY.map(({ id, label, render }) => ({ id, label, render }));
}

export function getIndicator(id) {
  return REGISTRY.find((i) => i.id === id) || null;
}

export {
  computeEmaSeries,
  computeSmaSeries,
  computeVwap,
  computeAtrBands,
  computeSessionRanges,
  computeFvgZones,
  computeKeyLevels
};
