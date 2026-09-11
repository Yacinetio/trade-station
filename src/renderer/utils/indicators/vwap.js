/**
 * Session-anchored VWAP using typical price; volume=1 when missing.
 */

function utcDayKey(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function computeVwap(bars, _opts = {}) {
  const out = [];
  let day = null;
  let cumTpV = 0;
  let cumV = 0;

  for (const bar of bars || []) {
    const t = Number(bar.time);
    const dk = utcDayKey(t);
    if (dk !== day) {
      day = dk;
      cumTpV = 0;
      cumV = 0;
    }
    const tp = (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
    const vol = Number(bar.volume) > 0 ? Number(bar.volume) : 1;
    cumTpV += tp * vol;
    cumV += vol;
    out.push({ time: t, value: cumV > 0 ? cumTpV / cumV : tp });
  }
  return out;
}
