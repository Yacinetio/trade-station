function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeMaxDrawdownFromSeries(pnls) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * Monte Carlo: shuffle closed-trade P&L order.
 * @param {number[]} closedPnls
 * @param {number} iterations
 */
function runMonteCarloSimulation(closedPnls = [], iterations = 1000) {
  const base = (Array.isArray(closedPnls) ? closedPnls : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (base.length === 0) {
    return {
      iterations: 0,
      finalEquity: { p5: 0, p50: 0, p95: 0 },
      maxDrawdown: { p5: 0, p50: 0, p95: 0 },
      probabilityOfLoss: 0,
    };
  }

  const iters = Math.max(100, Math.min(10000, Number(iterations) || 1000));
  const finals = [];
  const dds = [];
  let lossCount = 0;

  for (let i = 0; i < iters; i++) {
    const seq = shuffleInPlace([...base]);
    const total = seq.reduce((s, v) => s + v, 0);
    finals.push(total);
    dds.push(computeMaxDrawdownFromSeries(seq));
    if (total < 0) lossCount++;
  }

  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);

  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)))];

  return {
    iterations: iters,
    sampleSize: base.length,
    finalEquity: {
      p5: Number(pct(finals, 5).toFixed(2)),
      p50: Number(pct(finals, 50).toFixed(2)),
      p95: Number(pct(finals, 95).toFixed(2)),
    },
    maxDrawdown: {
      p5: Number(pct(dds, 5).toFixed(2)),
      p50: Number(pct(dds, 50).toFixed(2)),
      p95: Number(pct(dds, 95).toFixed(2)),
    },
    probabilityOfLoss: Number(((lossCount / iters) * 100).toFixed(2)),
  };
}

/** Underwater equity series from sorted closed trades. */
function buildUnderwaterSeries(closedTradesSorted = []) {
  let equity = 0;
  let peak = 0;
  return closedTradesSorted.map((t, i) => {
    const p = Number(t?.profit ?? t?._profit ?? 0);
    equity += p;
    if (equity > peak) peak = equity;
    const underwater = peak - equity;
    return {
      index: i,
      equity: Number(equity.toFixed(2)),
      underwater: Number(underwater.toFixed(2)),
      at: t?.closedAt || t?.closeTime || t?.lastUpdateAt || null,
    };
  });
}

module.exports = {
  runMonteCarloSimulation,
  buildUnderwaterSeries,
};
