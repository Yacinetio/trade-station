import { describe, it, expect } from 'vitest';
import { ema, sma, computeEmaSeries, computeSmaSeries } from '../src/renderer/utils/indicators/ema.js';
import { computeVwap } from '../src/renderer/utils/indicators/vwap.js';
import { computeAtrBands } from '../src/renderer/utils/indicators/atrBands.js';
import { computeSessionRanges } from '../src/renderer/utils/indicators/sessionRanges.js';
import { computeFvgZones } from '../src/renderer/utils/indicators/fvg.js';
import { computeKeyLevels } from '../src/renderer/utils/indicators/keyLevels.js';

const bars = [
  { time: 1704067200, open: 1.0, high: 1.01, low: 0.99, close: 1.005 },
  { time: 1704067260, open: 1.005, high: 1.015, low: 1.0, close: 1.01 },
  { time: 1704067320, open: 1.01, high: 1.02, low: 1.005, close: 1.015 },
  { time: 1704067380, open: 1.015, high: 1.025, low: 1.01, close: 1.02 },
  { time: 1704067440, open: 1.02, high: 1.03, low: 1.015, close: 1.025 }
];

describe('indicators', () => {
  it('SMA known values', () => {
    const closes = [1, 2, 3, 4, 5];
    expect(sma(closes, 3)[2]).toBeCloseTo(2, 6);
    expect(sma(closes, 3)[4]).toBeCloseTo(4, 6);
  });

  it('EMA known values', () => {
    const closes = [1, 2, 3, 4, 5];
    const out = ema(closes, 3);
    expect(out[4]).toBeGreaterThan(out[2]);
    const series = computeEmaSeries(bars, { period: 3 });
    expect(series.length).toBeGreaterThan(0);
    expect(series[0].time).toBe(bars[2].time);
  });

  it('computeSmaSeries aligns to bar times', () => {
    const series = computeSmaSeries(bars, { period: 2 });
    expect(series[0].value).toBeCloseTo((bars[1].close + bars[0].close) / 2, 6);
  });

  it('VWAP on fixture uses typical price', () => {
    const v = computeVwap(bars);
    expect(v.length).toBe(bars.length);
    expect(v[0].value).toBeCloseTo((bars[0].high + bars[0].low + bars[0].close) / 3, 6);
  });

  it('ATR bands produce upper/lower around close', () => {
    const bands = computeAtrBands(bars, { period: 2, multiplier: 2 });
    const last = bands[bands.length - 1];
    expect(last.upper).toBeGreaterThan(last.mid);
    expect(last.lower).toBeLessThan(last.mid);
  });

  it('session range boxes per UTC day', () => {
    const londonBars = [
      { time: Date.parse('2024-01-02T08:00:00.000Z') / 1000, open: 1, high: 1.02, low: 0.99, close: 1.01 },
      { time: Date.parse('2024-01-02T09:00:00.000Z') / 1000, open: 1.01, high: 1.03, low: 1.0, close: 1.02 }
    ];
    const boxes = computeSessionRanges(londonBars);
    expect(boxes.some((b) => b.id === 'london')).toBe(true);
    const london = boxes.find((b) => b.id === 'london');
    expect(london.high).toBe(1.03);
    expect(london.low).toBe(0.99);
  });

  it('FVG detection bullish bearish and filled', () => {
    const fvgBars = [
      { time: 100, open: 1.0, high: 1.01, low: 0.99, close: 1.0 },
      { time: 160, open: 1.02, high: 1.03, low: 1.015, close: 1.025 },
      { time: 220, open: 1.04, high: 1.05, low: 1.035, close: 1.045 },
      { time: 280, open: 1.0, high: 1.005, low: 0.98, close: 0.99 },
      { time: 340, open: 0.99, high: 0.995, low: 0.97, close: 0.98 },
      { time: 400, open: 0.98, high: 0.985, low: 0.96, close: 0.965 }
    ];
    const zones = computeFvgZones(fvgBars);
    expect(zones.some((z) => z.dir === 'bull')).toBe(true);
    expect(zones.some((z) => z.dir === 'bear')).toBe(true);
    const bull = zones.find((z) => z.dir === 'bull');
    expect(bull.filledAtSec).not.toBeNull();
  });

  it('key levels previous day and week', () => {
    const dayBars = [
      { time: Date.parse('2024-01-01T12:00:00.000Z') / 1000, open: 1, high: 1.05, low: 0.95, close: 1.02 },
      { time: Date.parse('2024-01-02T12:00:00.000Z') / 1000, open: 1.02, high: 1.08, low: 1.0, close: 1.04 }
    ];
    const levels = computeKeyLevels(dayBars);
    expect(levels.some((l) => l.kind === 'prevDayHigh' && l.price === 1.05)).toBe(true);
    expect(levels.some((l) => l.kind === 'prevDayLow' && l.price === 0.95)).toBe(true);
  });
});
