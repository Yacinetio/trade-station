/**
 * Drawdown guardian: halts new signal execution when daily loss / peak-to-equity drawdown
 * crosses configured thresholds. Optional tiered mode reduces lots before a full halt.
 * State is persisted per-account so a halt holds for the day even after restarts.
 *
 * Settings shape:
 *   settings.enableDrawdownGuard
 *   settings.enableTieredDrawdown
 *   settings.ddTierYellowPct / ddTierOrangePct / ddTierRedPct
 *   settings.ddTierYellowLotFactor / ddTierOrangeLotFactor
 *   settings.dailyLossBasis — 'realized' | 'equity'
 *   settings.maxDailyLossPct / maxPeakDrawdownPct / maxAbsoluteDailyLoss
 *
 * Persisted store key: `drawdownGuardState[accountKey]` =
 *   { day, startBalance, startOfDayEquity, peakEquity, halted, reason, haltedAt, lastTier }
 */

const STORE_KEY = 'drawdownGuardState';
const EQUITY_SNAPSHOT_STALE_MS = 60_000;
const TIER_RANK = { none: 0, yellow: 1, orange: 2, red: 3 };

function localDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readState(store) {
  try {
    const raw = store.get(STORE_KEY, {});
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (_) {
    return {};
  }
}

function writeState(store, state) {
  try { store.set(STORE_KEY, state); } catch (_) { /* noop */ }
}

function numSetting(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isSnapshotStale(accountSnapshot, nowMs = Date.now(), maxAgeMs = EQUITY_SNAPSHOT_STALE_MS) {
  const t = accountSnapshot?.time;
  if (!t) return true;
  const ms = new Date(t).getTime();
  if (!Number.isFinite(ms)) return true;
  return (nowMs - ms) > maxAgeMs;
}

function ensureDayState(store, accountKey, accountSnapshot) {
  const today = localDayKey();
  const state = readState(store);
  const cur = state[accountKey] || {};
  if (cur.day !== today) {
    const eq = Number(accountSnapshot?.equity) || Number(accountSnapshot?.balance) || 0;
    const bal = Number(accountSnapshot?.balance) || eq || 0;
    const fresh = {
      day: today,
      startBalance: bal,
      startOfDayEquity: eq,
      peakEquity: eq,
      halted: false,
      reason: '',
      haltedAt: null,
      lastTier: 'none'
    };
    state[accountKey] = fresh;
    writeState(store, state);
    return fresh;
  }
  if (!Number.isFinite(Number(cur.startOfDayEquity)) || Number(cur.startOfDayEquity) <= 0) {
    const eq = Number(accountSnapshot?.equity) || Number(cur.startBalance) || 0;
    cur.startOfDayEquity = eq;
    state[accountKey] = cur;
    writeState(store, state);
  }
  return cur;
}

/**
 * Daily loss in USD and % of day-start baseline. Uses equity basis when configured;
 * falls back to realized closed P&L when the equity snapshot is stale (>60s).
 */
function computeDailyLossMetrics({
  settings,
  store,
  accountKey,
  accountSnapshot,
  todayClosedPnl = 0,
  nowMs = Date.now()
} = {}) {
  const wantEquity = String(settings?.dailyLossBasis || 'realized').trim().toLowerCase() === 'equity';
  let cur = {};
  if (store && accountKey) {
    cur = ensureDayState(store, accountKey, accountSnapshot);
  }
  const startEq = numSetting(cur.startOfDayEquity, 0)
    || numSetting(accountSnapshot?.equity, 0)
    || numSetting(accountSnapshot?.balance, 0);
  const startBal = numSetting(cur.startBalance, 0) || numSetting(accountSnapshot?.balance, 0) || startEq;

  if (wantEquity && accountKey) {
    const stale = isSnapshotStale(accountSnapshot, nowMs);
    if (stale) {
      const lossUsd = Math.max(0, -Number(todayClosedPnl) || 0);
      const lossPct = startBal > 0 && todayClosedPnl < 0 ? (lossUsd / startBal) * 100 : 0;
      return {
        basis: 'realized',
        staleFallback: true,
        lossUsd,
        lossPct,
        startBaseline: startBal,
        currentEquity: null
      };
    }
    const eq = numSetting(accountSnapshot?.equity, 0);
    const lossUsd = Math.max(0, startEq - eq);
    const lossPct = startEq > 0 ? (lossUsd / startEq) * 100 : 0;
    return {
      basis: 'equity',
      staleFallback: false,
      lossUsd,
      lossPct,
      startBaseline: startEq,
      currentEquity: eq
    };
  }

  const lossUsd = Math.max(0, -Number(todayClosedPnl) || 0);
  const lossPct = startBal > 0 && todayClosedPnl < 0 ? (lossUsd / startBal) * 100 : 0;
  return {
    basis: 'realized',
    staleFallback: false,
    lossUsd,
    lossPct,
    startBaseline: startBal,
    currentEquity: numSetting(accountSnapshot?.equity, null)
  };
}

/**
 * Resolve tier + lot factor from daily loss %. Pure — unit-testable.
 */
function resolveDrawdownTier({ settings, lossPct = 0, halted = false } = {}) {
  if (!settings?.enableTieredDrawdown) {
    return {
      tier: halted ? 'red' : 'none',
      lotFactor: halted ? 0 : 1,
      shouldHalt: !!halted
    };
  }

  const yellowPct = Math.max(0, numSetting(settings?.ddTierYellowPct, 2));
  const orangePct = Math.max(yellowPct, numSetting(settings?.ddTierOrangePct, 3));
  const redPct = Math.max(orangePct, numSetting(settings?.ddTierRedPct, 5));
  const yellowFactor = Math.max(0.01, Math.min(1, numSetting(settings?.ddTierYellowLotFactor, 0.5)));
  const orangeFactor = Math.max(0.01, Math.min(1, numSetting(settings?.ddTierOrangeLotFactor, 0.25)));
  const pct = Math.max(0, Number(lossPct) || 0);

  if (halted || pct >= redPct) {
    return { tier: 'red', lotFactor: 0, shouldHalt: true };
  }
  if (pct >= orangePct) {
    return { tier: 'orange', lotFactor: orangeFactor, shouldHalt: false };
  }
  if (pct >= yellowPct) {
    return { tier: 'yellow', lotFactor: yellowFactor, shouldHalt: false };
  }
  return { tier: 'none', lotFactor: 1, shouldHalt: false };
}

function persistTier(store, accountKey, tier) {
  if (!accountKey || !tier) return;
  const state = readState(store);
  const cur = state[accountKey];
  if (!cur) return;
  cur.lastTier = tier;
  state[accountKey] = cur;
  writeState(store, state);
}

/**
 * Update the running peak equity. Call after each MT5 account snapshot.
 */
function recordEquitySample(store, accountKey, accountSnapshot) {
  if (!accountKey || !accountSnapshot) return;
  const eq = Number(accountSnapshot.equity);
  if (!Number.isFinite(eq) || eq <= 0) return;
  const state = readState(store);
  const cur = ensureDayState(store, accountKey, accountSnapshot);
  if (eq > Number(cur.peakEquity || 0)) {
    cur.peakEquity = eq;
    state[accountKey] = cur;
    writeState(store, state);
  }
}

/**
 * Apply tier lot reduction after lot sizing. Returns { signal, ddTierApplied }.
 */
function applyTierLotReduction(signal, ctx = {}) {
  const { store, settings, accountKey, accountSnapshot, todayClosedPnl = 0, logFn } = ctx;
  if (!signal || !settings?.enableDrawdownGuard || !settings?.enableTieredDrawdown) {
    return { signal, ddTierApplied: null };
  }
  if (!accountKey) return { signal, ddTierApplied: null };

  const metrics = computeDailyLossMetrics({
    settings,
    store,
    accountKey,
    accountSnapshot,
    todayClosedPnl
  });
  if (metrics.staleFallback && logFn) {
    logFn('Equity snapshot stale (>60s) — tier lot sizing using realized P&L fallback');
  }

  const cur = ensureDayState(store, accountKey, accountSnapshot);
  const tierInfo = resolveDrawdownTier({
    settings,
    lossPct: metrics.lossPct,
    halted: cur.halted
  });

  if (tierInfo.tier === 'none' || tierInfo.lotFactor >= 1) {
    persistTier(store, accountKey, tierInfo.tier);
    return { signal, ddTierApplied: tierInfo.tier === 'none' ? null : tierInfo.tier };
  }

  const before = Number(signal.lot) || 0;
  if (before > 0 && tierInfo.lotFactor > 0 && tierInfo.lotFactor < 1) {
    signal.lot = Math.max(0.01, Math.round(before * tierInfo.lotFactor * 100) / 100);
    if (logFn) {
      logFn(`Drawdown tier ${tierInfo.tier}: lot ${before.toFixed(2)} → ${signal.lot.toFixed(2)} (${(tierInfo.lotFactor * 100).toFixed(0)}%)`);
    }
  }

  persistTier(store, accountKey, tierInfo.tier);
  return { signal, ddTierApplied: tierInfo.tier };
}

/**
 * Evaluate a halt trigger before sending. Returns enriched status object.
 */
function evaluateGuard({
  store,
  settings,
  accountKey,
  accountSnapshot,
  todayClosedPnl = 0,
  onTierEscalation
} = {}) {
  const empty = {
    halted: false,
    reason: '',
    tier: 'none',
    lotFactor: 1,
    dailyLossPct: 0,
    dailyLossBasis: 'realized',
    staleFallback: false
  };

  if (!settings?.enableDrawdownGuard) return empty;
  if (!accountKey) return empty;

  const cur = ensureDayState(store, accountKey, accountSnapshot);
  const metrics = computeDailyLossMetrics({
    settings,
    store,
    accountKey,
    accountSnapshot,
    todayClosedPnl
  });

  const eq = Number(accountSnapshot?.equity) || 0;
  const peakEq = Math.max(Number(cur.peakEquity) || 0, eq);
  const maxPeakDdPct = Math.max(0, Number(settings?.maxPeakDrawdownPct) || 0);
  const maxAbsLoss = Math.max(0, Number(settings?.maxAbsoluteDailyLoss) || 0);
  const maxLossPct = Math.max(0, Number(settings?.maxDailyLossPct) || 0);

  let halt = null;

  if (maxAbsLoss > 0 && metrics.lossUsd >= maxAbsLoss) {
    halt = `Drawdown guard: daily loss ${metrics.lossUsd.toFixed(2)}$ ≥ ${maxAbsLoss}$ (${metrics.basis}${metrics.staleFallback ? ', stale equity fallback' : ''})`;
  }

  if (!halt && !settings?.enableTieredDrawdown && maxLossPct > 0 && metrics.lossPct >= maxLossPct) {
    halt = `Drawdown guard: daily loss ${metrics.lossPct.toFixed(2)}% ≥ ${maxLossPct}% of start ${metrics.basis === 'equity' ? 'equity' : 'balance'}`;
  }

  if (!halt && maxPeakDdPct > 0 && peakEq > 0 && eq > 0 && eq < peakEq) {
    const pct = ((peakEq - eq) / peakEq) * 100;
    if (pct >= maxPeakDdPct) {
      halt = `Drawdown guard: peak-to-equity drawdown ${pct.toFixed(2)}% ≥ ${maxPeakDdPct}%`;
    }
  }

  const tierInfo = resolveDrawdownTier({
    settings,
    lossPct: metrics.lossPct,
    halted: cur.halted
  });

  if (!halt && settings?.enableTieredDrawdown && tierInfo.shouldHalt) {
    halt = `Drawdown guard: daily loss ${metrics.lossPct.toFixed(2)}% reached red tier (${numSetting(settings?.ddTierRedPct, 5)}%)`;
  }

  if (cur.halted && !halt) {
    return {
      halted: true,
      reason: cur.reason || 'Drawdown guardian halted trading for the day',
      tier: 'red',
      lotFactor: 0,
      dailyLossPct: metrics.lossPct,
      dailyLossBasis: metrics.basis,
      staleFallback: metrics.staleFallback
    };
  }

  const prevTier = String(cur.lastTier || 'none');
  const nextTier = halt ? 'red' : tierInfo.tier;
  if (TIER_RANK[nextTier] > TIER_RANK[prevTier] && typeof onTierEscalation === 'function') {
    onTierEscalation({ from: prevTier, to: nextTier, lossPct: metrics.lossPct });
  }

  if (halt) {
    const state = readState(store);
    state[accountKey] = {
      ...cur,
      halted: true,
      reason: halt,
      haltedAt: new Date().toISOString(),
      lastTier: 'red'
    };
    writeState(store, state);
    return {
      halted: true,
      reason: halt,
      tier: 'red',
      lotFactor: 0,
      dailyLossPct: metrics.lossPct,
      dailyLossBasis: metrics.basis,
      staleFallback: metrics.staleFallback
    };
  }

  persistTier(store, accountKey, tierInfo.tier);
  return {
    halted: false,
    reason: '',
    tier: tierInfo.tier,
    lotFactor: tierInfo.lotFactor,
    dailyLossPct: metrics.lossPct,
    dailyLossBasis: metrics.basis,
    staleFallback: metrics.staleFallback
  };
}

function clearHalt(store, accountKey) {
  if (!accountKey) return;
  const state = readState(store);
  if (state[accountKey]) {
    state[accountKey].halted = false;
    state[accountKey].reason = '';
    state[accountKey].haltedAt = null;
    writeState(store, state);
  }
}

function getStatus(store, accountKey, extras = {}) {
  const state = readState(store);
  const cur = state[accountKey] || null;
  if (!cur) return null;
  const metrics = extras.metrics || null;
  const tier = extras.tier || cur.lastTier || 'none';
  return {
    ...cur,
    tier,
    dailyLossPct: metrics?.lossPct ?? null,
    dailyLossBasis: metrics?.basis ?? null,
    staleFallback: metrics?.staleFallback ?? false
  };
}

function buildGuardianStatus({ store, settings, accountKey, accountSnapshot, todayClosedPnl = 0 } = {}) {
  if (!accountKey) return null;
  const metrics = computeDailyLossMetrics({
    settings: settings || {},
    store,
    accountKey,
    accountSnapshot,
    todayClosedPnl
  });
  const cur = ensureDayState(store, accountKey, accountSnapshot);
  const tierInfo = resolveDrawdownTier({
    settings: settings || {},
    lossPct: metrics.lossPct,
    halted: cur.halted
  });
  return getStatus(store, accountKey, {
    metrics,
    tier: cur.halted ? 'red' : tierInfo.tier
  });
}

module.exports = {
  evaluateGuard,
  recordEquitySample,
  clearHalt,
  getStatus,
  buildGuardianStatus,
  computeDailyLossMetrics,
  resolveDrawdownTier,
  applyTierLotReduction,
  isSnapshotStale,
  STORE_KEY,
  EQUITY_SNAPSHOT_STALE_MS
};
