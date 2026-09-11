/** ATR(n) bands around close — default n=14, multiplier=2. */

function trueRange(prevClose, bar) {
  const h = Number(bar.high);
  const l = Number(bar.low);
  const pc = Number(prevClose);
  if (!Number.isFinite(pc)) return h - l;
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

export function computeAtrBands(bars, opts = {}) {
  const period = Math.max(1, Math.floor(Number(opts.period) || 14));
  const mult = Number(opts.multiplier) || 2;
  const out = [];
  let atr = null;

  for (let i = 0; i < (bars || []).length; i++) {
    const bar = bars[i];
    const prevClose = i > 0 ? bars[i - 1].close : bar.open;
    const tr = trueRange(prevClose, bar);
    if (atr == null) {
      if (i + 1 < period) {
        out.push(null);
        continue;
      }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const pc = j > 0 ? bars[j - 1].close : bars[j].open;
        sum += trueRange(pc, bars[j]);
      }
      atr = sum / period;
    } else {
      atr = ((atr * (period - 1)) + tr) / period;
    }
    const close = Number(bar.close);
    out.push({
      time: bar.time,
      upper: close + atr * mult,
      lower: close - atr * mult,
      mid: close,
      atr
    });
  }
  return out.filter(Boolean);
}
