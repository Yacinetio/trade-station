/**
 * Prop-firm challenge pass simulator — bootstrap resampling of closed-trade P&L.
 */

const { filterClosedTrades, evaluateProfile } = require('./propRules');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveRng(rng) {
  if (typeof rng === 'function') return rng;
  if (typeof rng === 'number') return mulberry32(rng);
  return Math.random;
}

function sampleWithReplacement(arr, count, rng) {
  const out = [];
  const n = arr.length;
  if (n === 0) return out;
  for (let i = 0; i < count; i++) {
    out.push(arr[Math.floor(rng() * n)]);
  }
  return out;
}

function avgTradesPerDay(closedTrades) {
  if (!closedTrades.length) return 3;
  const dayCounts = new Map();
  for (const t of closedTrades) {
    const d = new Date(t.closedAt || t.closeTime || 0);
    const dk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    dayCounts.set(dk, (dayCounts.get(dk) || 0) + 1);
  }
  const counts = [...dayCounts.values()];
  const avg = counts.reduce((s, v) => s + v, 0) / counts.length;
  return Math.max(1, Math.round(avg));
}

function simulateSingleRun({ profile, pnls, tradesPerDay, riskScale, rng, maxDays = 60 }) {
  const startingBalance = Number(profile.startingBalance) || 10000;
  const profitTargetUsd = (startingBalance * Number(profile.profitTargetPct || 0)) / 100;
  const maxDdPct = Number(profile.maxDrawdownPct) || 0;
  const dailyLossPct = Number(profile.dailyLossPct) || 0;
  const minTradingDays = Number(profile.minTradingDays) || 0;
  const trailing = !!profile.trailingDrawdown;

  let equity = startingBalance;
  let peak = startingBalance;
  let tradingDays = 0;
  let daysToPass = null;

  for (let day = 0; day < maxDays; day++) {
    const dayStartEquity = equity;
    const dayPnls = sampleWithReplacement(pnls, tradesPerDay, rng).map((p) => p * riskScale);
    let dayPnl = 0;
    for (const p of dayPnls) {
      dayPnl += p;
      equity += p;
      if (equity > peak) peak = equity;
    }
    if (dayPnls.length > 0) tradingDays += 1;

    const dayLossPct = dayPnl < 0 && dayStartEquity > 0
      ? (Math.abs(dayPnl) / dayStartEquity) * 100
      : 0;
    if (dayLossPct >= dailyLossPct) return { outcome: 'bust', days: day + 1 };

    let ddPct = 0;
    if (trailing) {
      const pk = Math.max(peak, startingBalance);
      ddPct = pk > 0 ? ((pk - equity) / pk) * 100 : 0;
    } else {
      ddPct = startingBalance > 0 ? ((startingBalance - equity) / startingBalance) * 100 : 0;
    }
    if (ddPct >= maxDdPct) return { outcome: 'bust', days: day + 1 };

    const netPnl = equity - startingBalance;
    if (netPnl >= profitTargetUsd && tradingDays >= minTradingDays) {
      daysToPass = day + 1;
      return { outcome: 'pass', days: daysToPass };
    }
  }

  return { outcome: 'expire', days: maxDays };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function simulateChallenge({ profile, trades = [], runs = 2000, riskScale = 1, rng } = {}) {
  const random = resolveRng(rng);
  const closed = filterClosedTrades(trades, profile?.accountKey);
  const pnls = closed.map((t) => Number(t?.profit ?? 0)).filter((n) => Number.isFinite(n));
  const tradesPerDay = avgTradesPerDay(closed);
  const iters = Math.max(100, Math.min(10000, Number(runs) || 2000));
  const scale = Number(riskScale) || 1;

  if (pnls.length === 0) {
    return {
      passPct: 0,
      bustPct: 0,
      expirePct: 100,
      medianDaysToPass: null,
      p25DaysToPass: null,
      p75DaysToPass: null,
      runs: iters,
      tradesPerDay
    };
  }

  let pass = 0;
  let bust = 0;
  let expire = 0;
  const passDays = [];

  for (let i = 0; i < iters; i++) {
    const result = simulateSingleRun({
      profile,
      pnls,
      tradesPerDay,
      riskScale: scale,
      rng: random,
      maxDays: 60
    });
    if (result.outcome === 'pass') {
      pass += 1;
      passDays.push(result.days);
    } else if (result.outcome === 'bust') {
      bust += 1;
    } else {
      expire += 1;
    }
  }

  passDays.sort((a, b) => a - b);

  return {
    passPct: Number(((pass / iters) * 100).toFixed(2)),
    bustPct: Number(((bust / iters) * 100).toFixed(2)),
    expirePct: Number(((expire / iters) * 100).toFixed(2)),
    medianDaysToPass: passDays.length ? percentile(passDays, 50) : null,
    p25DaysToPass: passDays.length ? percentile(passDays, 25) : null,
    p75DaysToPass: passDays.length ? percentile(passDays, 75) : null,
    runs: iters,
    tradesPerDay
  };
}

function riskSensitivity({ profile, trades = [], scales = [0.5, 0.75, 1, 1.5, 2], runs = 500, rng } = {}) {
  const random = resolveRng(rng);
  return (Array.isArray(scales) ? scales : [0.5, 0.75, 1, 1.5, 2]).map((scale) => {
    const sim = simulateChallenge({
      profile,
      trades,
      runs,
      riskScale: scale,
      rng: random
    });
    return { scale: Number(scale), passPct: sim.passPct };
  });
}

module.exports = {
  mulberry32,
  simulateChallenge,
  riskSensitivity,
  simulateSingleRun,
  avgTradesPerDay
};
