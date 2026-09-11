/**
 * EMA / SMA over OHLC bar arrays { time, open, high, low, close }.
 */

export function sma(values, period) {
  const p = Math.max(1, Math.floor(Number(period) || 1));
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < p) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += values[j];
    out.push(sum / p);
  }
  return out;
}

export function ema(values, period) {
  const p = Math.max(1, Math.floor(Number(period) || 1));
  const k = 2 / (p + 1);
  const out = [];
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      if (i + 1 < p) {
        out.push(null);
        continue;
      }
      let sum = 0;
      for (let j = i - p + 1; j <= i; j++) sum += values[j];
      prev = sum / p;
      out.push(prev);
      continue;
    }
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function computeEmaSeries(bars, opts = {}) {
  const period = opts.period ?? 20;
  const closes = (bars || []).map((b) => Number(b.close));
  const values = ema(closes, period);
  return (bars || []).map((b, i) => ({
    time: b.time,
    value: values[i]
  })).filter((p) => p.value != null);
}

export function computeSmaSeries(bars, opts = {}) {
  const period = opts.period ?? 20;
  const closes = (bars || []).map((b) => Number(b.close));
  const values = sma(closes, period);
  return (bars || []).map((b, i) => ({
    time: b.time,
    value: values[i]
  })).filter((p) => p.value != null);
}
