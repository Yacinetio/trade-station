/**
 * Fair Value Gaps: 3-candle imbalance zones.
 * Bullish: bar[i-2].high < bar[i].low
 * Bearish: bar[i-2].low > bar[i].high
 */

export function computeFvgZones(bars, opts = {}) {
  const arr = bars || [];
  const zones = [];

  for (let i = 2; i < arr.length; i++) {
    const b1 = arr[i - 2];
    const b3 = arr[i];
    const fromSec = b1.time;

    if (Number(b1.high) < Number(b3.low)) {
      zones.push({
        fromSec,
        top: Number(b3.low),
        bottom: Number(b1.high),
        dir: 'bull',
        filledAtSec: null
      });
    } else if (Number(b1.low) > Number(b3.high)) {
      zones.push({
        fromSec,
        top: Number(b1.low),
        bottom: Number(b3.high),
        dir: 'bear',
        filledAtSec: null
      });
    }
  }

  if (opts.markFilled !== false) {
    for (const zone of zones) {
      for (const bar of arr) {
        if (bar.time <= zone.fromSec) continue;
        if (zone.dir === 'bull' && Number(bar.low) <= zone.bottom) {
          zone.filledAtSec = bar.time;
          break;
        }
        if (zone.dir === 'bear' && Number(bar.high) >= zone.top) {
          zone.filledAtSec = bar.time;
          break;
        }
      }
    }
  }

  return zones;
}
