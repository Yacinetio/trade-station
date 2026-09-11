/**
 * Prop-firm rule profiles and live evaluation from closed trade history.
 */

const PRESETS = {
  'ftmo-challenge': {
    id: 'ftmo-challenge',
    firm: 'FTMO',
    label: 'FTMO Challenge',
    phase: 'challenge',
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    dailyLossPct: 5,
    minTradingDays: 4,
    trailingDrawdown: false
  },
  'ftmo-verification': {
    id: 'ftmo-verification',
    firm: 'FTMO',
    label: 'FTMO Verification',
    phase: 'verification',
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    dailyLossPct: 5,
    minTradingDays: 4,
    trailingDrawdown: false
  },
  'fundednext': {
    id: 'fundednext',
    firm: 'FundedNext',
    label: 'FundedNext Challenge',
    phase: 'challenge',
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    dailyLossPct: 5,
    minTradingDays: 5,
    trailingDrawdown: false
  },
  'topstep': {
    id: 'topstep',
    firm: 'TopStep',
    label: 'TopStep Combine',
    phase: 'challenge',
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    dailyLossPct: 2,
    minTradingDays: 5,
    trailingDrawdown: true
  },
  'apex': {
    id: 'apex',
    firm: 'Apex',
    label: 'Apex Evaluation',
    phase: 'challenge',
    profitTargetPct: 6,
    maxDrawdownPct: 6,
    dailyLossPct: 3,
    minTradingDays: 7,
    trailingDrawdown: true
  },
  'e8': {
    id: 'e8',
    firm: 'E8 Funding',
    label: 'E8 Evaluation',
    phase: 'challenge',
    profitTargetPct: 8,
    maxDrawdownPct: 8,
    dailyLossPct: 5,
    minTradingDays: 5,
    trailingDrawdown: false
  },
  'the5ers': {
    id: 'the5ers',
    firm: 'The5%ers',
    label: 'The5%ers Bootcamp',
    phase: 'challenge',
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    dailyLossPct: 4,
    minTradingDays: 3,
    trailingDrawdown: false
  },
  custom: {
    id: 'custom',
    firm: 'Custom',
    label: 'Custom rules',
    phase: 'challenge',
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    dailyLossPct: 5,
    minTradingDays: 4,
    trailingDrawdown: false
  }
};

function utcDateKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isClosedTrade(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.startsWith('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT')) return true;
  return !!(trade?.closedAt || trade?.closeTime);
}

function filterClosedTrades(trades = [], accountKey) {
  const key = String(accountKey || '');
  return (Array.isArray(trades) ? trades : [])
    .filter((t) => isClosedTrade(t) && String(t?.accountKey || '') === key)
    .sort((a, b) => new Date(a.closedAt || a.closeTime || 0) - new Date(b.closedAt || b.closeTime || 0));
}

function buildEquitySeries(startingBalance, closedTrades) {
  let equity = Number(startingBalance) || 0;
  let peak = equity;
  let minEquity = equity;
  let maxTrailingDdPct = 0;
  let maxStaticDdPct = 0;
  const start = equity;
  const dayPnl = new Map();
  const tradingDays = new Set();
  const points = [{ at: null, equity, peak }];

  for (const t of closedTrades) {
    const pnl = Number(t?.profit ?? 0);
    if (!Number.isFinite(pnl)) continue;
    const closedMs = new Date(t.closedAt || t.closeTime || 0).getTime();
    const dk = utcDateKey(closedMs);
    tradingDays.add(dk);
    dayPnl.set(dk, (dayPnl.get(dk) || 0) + pnl);
    equity += pnl;
    if (equity > peak) peak = equity;
    if (equity < minEquity) minEquity = equity;
    const trailPk = Math.max(peak, start);
    if (trailPk > 0) {
      maxTrailingDdPct = Math.max(maxTrailingDdPct, ((trailPk - equity) / trailPk) * 100);
    }
    if (start > 0) {
      maxStaticDdPct = Math.max(maxStaticDdPct, ((start - minEquity) / start) * 100);
    }
    points.push({ at: t.closedAt || t.closeTime, equity, peak, dayKey: dk });
  }

  return { equity, peak, minEquity, maxTrailingDdPct, maxStaticDdPct, dayPnl, tradingDays, points };
}

function startOfDayEquityMap(startingBalance, closedTrades) {
  const map = new Map();
  let equity = Number(startingBalance) || 0;
  let prevDay = null;
  for (const t of closedTrades) {
    const closedMs = new Date(t.closedAt || t.closeTime || 0).getTime();
    const dk = utcDateKey(closedMs);
    if (prevDay !== dk) {
      map.set(dk, equity);
      prevDay = dk;
    }
    equity += Number(t?.profit ?? 0) || 0;
  }
  return map;
}

function computeMaxDrawdownPctObserved({ maxTrailingDdPct, maxStaticDdPct, trailingDrawdown }) {
  if (trailingDrawdown) return Math.max(0, maxTrailingDdPct || 0);
  return Math.max(0, maxStaticDdPct || 0);
}

function computeDailyLossStats(dayPnl, startOfDayEquity, dailyLossPct) {
  let worstDailyLossPct = 0;
  let dailyLossBreached = false;
  const breaches = [];

  for (const [dk, pnl] of dayPnl.entries()) {
    const sod = startOfDayEquity.get(dk) || 0;
    if (sod <= 0 || pnl >= 0) continue;
    const lossPct = (Math.abs(pnl) / sod) * 100;
    if (lossPct > worstDailyLossPct) worstDailyLossPct = lossPct;
    if (lossPct > dailyLossPct) {
      dailyLossBreached = true;
      breaches.push({ dateKey: dk, rule: 'dailyLoss', amount: Number(lossPct.toFixed(2)) });
    }
  }

  return { worstDailyLossPct, dailyLossBreached, dailyBreaches: breaches };
}

function evaluateProfile(profile = {}, trades = [], nowMs = Date.now()) {
  const startingBalance = Number(profile.startingBalance) || 10000;
  const profitTargetPct = Number(profile.profitTargetPct) || 0;
  const maxDrawdownPct = Number(profile.maxDrawdownPct) || 0;
  const dailyLossPct = Number(profile.dailyLossPct) || 0;
  const minTradingDays = Number(profile.minTradingDays) || 0;
  const maxTradingDays = profile.maxTradingDays != null ? Number(profile.maxTradingDays) : null;
  const consistencyRulePct = profile.consistencyRulePct != null ? Number(profile.consistencyRulePct) : null;
  const trailingDrawdown = !!profile.trailingDrawdown;

  const closed = filterClosedTrades(trades, profile.accountKey);
  const { equity, peak, maxTrailingDdPct, maxStaticDdPct, dayPnl, tradingDays } = buildEquitySeries(startingBalance, closed);
  const startOfDayEquity = startOfDayEquityMap(startingBalance, closed);

  const netPnl = equity - startingBalance;
  const netPnlPct = startingBalance > 0 ? (netPnl / startingBalance) * 100 : 0;
  const profitProgressPct = profitTargetPct > 0 ? (netPnlPct / profitTargetPct) * 100 : 0;

  const maxDrawdownPctObserved = computeMaxDrawdownPctObserved({
    maxTrailingDdPct,
    maxStaticDdPct,
    trailingDrawdown
  });
  const ddBreached = maxDrawdownPctObserved >= maxDrawdownPct;

  const { worstDailyLossPct, dailyLossBreached } = computeDailyLossStats(
    dayPnl,
    startOfDayEquity,
    dailyLossPct
  );

  const tradingDayCount = tradingDays.size;
  const minDaysMet = tradingDayCount >= minTradingDays;

  let biggestDayPct = 0;
  let consistencyOk = true;
  if (consistencyRulePct != null && netPnl > 0) {
    let maxDayProfit = 0;
    for (const pnl of dayPnl.values()) {
      if (pnl > maxDayProfit) maxDayProfit = pnl;
    }
    biggestDayPct = (maxDayProfit / netPnl) * 100;
    consistencyOk = biggestDayPct <= consistencyRulePct;
  }

  const todayKey = utcDateKey(nowMs);
  const todayStartEquity = startOfDayEquity.has(todayKey)
    ? startOfDayEquity.get(todayKey)
    : equity;
  const todayPnl = dayPnl.get(todayKey) || 0;
  const todayLossUsed = todayPnl < 0 ? Math.abs(todayPnl) : 0;
  const todayAllowance = todayStartEquity > 0 ? (todayStartEquity * dailyLossPct) / 100 : 0;
  const distanceToDailyViolationUsd = Math.max(0, todayAllowance - todayLossUsed);

  let distanceToDdViolationUsd = 0;
  if (trailingDrawdown) {
    const pk = Math.max(peak, startingBalance);
    const floor = pk * (1 - maxDrawdownPct / 100);
    distanceToDdViolationUsd = Math.max(0, equity - floor);
  } else {
    const floor = startingBalance * (1 - maxDrawdownPct / 100);
    distanceToDdViolationUsd = Math.max(0, equity - floor);
  }

  const failReasons = [];
  if (ddBreached) failReasons.push(`Max drawdown breached (${maxDrawdownPctObserved.toFixed(1)}% ≥ ${maxDrawdownPct}%)`);
  if (dailyLossBreached) failReasons.push(`Daily loss limit breached (worst ${worstDailyLossPct.toFixed(1)}%)`);
  if (consistencyRulePct != null && netPnl > 0 && !consistencyOk) {
    failReasons.push(`Consistency rule failed (best day ${biggestDayPct.toFixed(1)}% of profit > ${consistencyRulePct}%)`);
  }
  if (maxTradingDays != null && tradingDayCount > maxTradingDays) {
    failReasons.push(`Exceeded max trading days (${tradingDayCount} > ${maxTradingDays})`);
  }

  const targetMet = netPnlPct >= profitTargetPct;
  let status = 'in-progress';
  if (failReasons.length > 0) status = 'failed';
  else if (targetMet && minDaysMet && (consistencyRulePct == null || netPnl <= 0 || consistencyOk)) {
    status = 'passed';
  }

  let projectedDaysToTarget = null;
  if (profitTargetPct > 0 && netPnlPct < profitTargetPct) {
    const activeDays = [...dayPnl.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 10)
      .map(([, v]) => v);
    if (activeDays.length > 0) {
      const avg = activeDays.reduce((s, v) => s + v, 0) / activeDays.length;
      if (avg > 0) {
        const remaining = (startingBalance * profitTargetPct) / 100 - netPnl;
        projectedDaysToTarget = Math.ceil(remaining / avg);
      }
    }
  }

  return {
    netPnl: Number(netPnl.toFixed(2)),
    netPnlPct: Number(netPnlPct.toFixed(2)),
    profitProgressPct: Number(profitProgressPct.toFixed(2)),
    maxDrawdownPctObserved: Number(maxDrawdownPctObserved.toFixed(2)),
    worstDailyLossPct: Number(worstDailyLossPct.toFixed(2)),
    dailyLossBreached,
    ddBreached,
    tradingDays: tradingDayCount,
    minDaysMet,
    consistencyOk,
    biggestDayPct: Number(biggestDayPct.toFixed(2)),
    status,
    failReasons,
    distanceToDailyViolationUsd: Number(distanceToDailyViolationUsd.toFixed(2)),
    distanceToDdViolationUsd: Number(distanceToDdViolationUsd.toFixed(2)),
    projectedDaysToTarget,
    equity: Number(equity.toFixed(2)),
    peak: Number(peak.toFixed(2))
  };
}

function violationHistory(profile = {}, trades = []) {
  const startingBalance = Number(profile.startingBalance) || 10000;
  const maxDrawdownPct = Number(profile.maxDrawdownPct) || 0;
  const dailyLossPct = Number(profile.dailyLossPct) || 0;
  const consistencyRulePct = profile.consistencyRulePct != null ? Number(profile.consistencyRulePct) : null;
  const trailingDrawdown = !!profile.trailingDrawdown;

  const closed = filterClosedTrades(trades, profile.accountKey);
  const events = [];

  let equity = startingBalance;
  let peak = startingBalance;
  let minEquity = startingBalance;
  let maxTrailingDdPct = 0;
  let maxStaticDdPct = 0;
  const dayPnl = new Map();
  const startOfDayEquity = startOfDayEquityMap(startingBalance, closed);

  for (const t of closed) {
    const pnl = Number(t?.profit ?? 0) || 0;
    const dk = utcDateKey(new Date(t.closedAt || t.closeTime || 0).getTime());
    dayPnl.set(dk, (dayPnl.get(dk) || 0) + pnl);
    equity += pnl;
    if (equity > peak) peak = equity;
    if (equity < minEquity) minEquity = equity;
    const trailPk = Math.max(peak, startingBalance);
    if (trailPk > 0) {
      maxTrailingDdPct = Math.max(maxTrailingDdPct, ((trailPk - equity) / trailPk) * 100);
    }
    if (startingBalance > 0) {
      maxStaticDdPct = Math.max(maxStaticDdPct, ((startingBalance - minEquity) / startingBalance) * 100);
    }
  }

  for (const [dk, pnl] of dayPnl.entries()) {
    const sod = startOfDayEquity.get(dk) || 0;
    if (sod <= 0 || pnl >= 0) continue;
    const lossPct = (Math.abs(pnl) / sod) * 100;
    if (lossPct > dailyLossPct) {
      events.push({ dateKey: dk, rule: 'dailyLoss', amount: Number(lossPct.toFixed(2)) });
    }
  }

  const ddObs = computeMaxDrawdownPctObserved({
    maxTrailingDdPct,
    maxStaticDdPct,
    trailingDrawdown
  });
  if (ddObs >= maxDrawdownPct) {
    events.push({ dateKey: closed.length ? utcDateKey(new Date(closed[closed.length - 1].closedAt || closed[closed.length - 1].closeTime || 0).getTime()) : utcDateKey(Date.now()), rule: 'maxDrawdown', amount: Number(ddObs.toFixed(2)) });
  }

  const netPnl = equity - startingBalance;
  if (consistencyRulePct != null && netPnl > 0) {
    let maxDayProfit = 0;
    let maxDay = null;
    for (const [dk, pnl] of dayPnl.entries()) {
      if (pnl > maxDayProfit) {
        maxDayProfit = pnl;
        maxDay = dk;
      }
    }
    const pct = (maxDayProfit / netPnl) * 100;
    if (pct > consistencyRulePct && maxDay) {
      events.push({ dateKey: maxDay, rule: 'consistency', amount: Number(pct.toFixed(2)) });
    }
  }

  return events.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

function listPresets() {
  return Object.values(PRESETS).map((p) => ({ ...p }));
}

function newProfileId() {
  return `prop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  PRESETS,
  listPresets,
  newProfileId,
  isClosedTrade,
  filterClosedTrades,
  evaluateProfile,
  violationHistory,
  utcDateKey
};
