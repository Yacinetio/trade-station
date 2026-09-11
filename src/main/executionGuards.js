/**
 * Pre-send guards: valid stop loss, min pip stop distance, daily trade count, opposite-symbol hedge,
 * correlated-pair hedge, concurrent limit, daily loss.
 */

/** Strip broker suffix from symbol for comparisons (EURUSDm → EURUSD). */
function normalizeGuardSymbol(sym) {
  const n = normalizeCorrelationSymbol(sym);
  return n || 'UNKNOWN';
}

function tradeSide(trade) {
  const t = String(trade?.type || '').toUpperCase();
  if (t.includes('BUY')) return 'BUY';
  if (t.includes('SELL')) return 'SELL';
  return '';
}

function signalSide(signal) {
  const t = String(signal?.type || '').toUpperCase();
  if (t.includes('BUY')) return 'BUY';
  if (t.includes('SELL')) return 'SELL';
  return '';
}

/**
 * Require a usable stop loss: finite, strictly > 0, and on the correct side of entry when entry is known
 * (after execution transforms — e.g. default SL pips). Skipped when settings.blockInvalidOrMissingStopLoss is false.
 * When entry is missing/zero (e.g. some market parses), only SL presence is enforced — side check needs a price anchor.
 * @returns {{ code: string, reason: string } | null}
 */
function evaluateRequiredValidStopLoss({ settings, signal }) {
  if (settings?.blockInvalidOrMissingStopLoss === false) return null;
  if (!signal) return null;
  const side = signalSide(signal);
  if (!side) return null;

  const sl = Number(signal.sl);
  const entry = Number(signal.entry);

  if (!Number.isFinite(sl) || sl <= 0) {
    return {
      code: 'BLOCKED_INVALID_SL',
      reason: 'Stop loss missing or invalid — need a finite SL before sending to MT'
    };
  }

  if (Number.isFinite(entry) && entry > 0) {
    if (side === 'BUY' && sl >= entry) {
      return {
        code: 'BLOCKED_INVALID_SL',
        reason: `Invalid SL for BUY: stop (${sl}) must be strictly below entry (${entry})`
      };
    }
    if (side === 'SELL' && sl <= entry) {
      return {
        code: 'BLOCKED_INVALID_SL',
        reason: `Invalid SL for SELL: stop (${sl}) must be strictly above entry (${entry})`
      };
    }
  }

  return null;
}

const {
  getCorrelationGroups,
  normalizeCorrelationSymbol
} = require('./correlationGroups');
const { computeDailyLossMetrics } = require('./drawdownGuardian');

function tradesForAccount(trades, accountKey) {
  const k = String(accountKey ?? 'unknown');
  return (trades || []).filter((t) => String(t?.accountKey || 'unknown') === k);
}

/**
 * Block BUY vs SELL flip on the same instrument while the first leg is still open.
 */
function evaluateOppositeSameSymbol({ settings, signal, trades, accountKey }) {
  if (!settings?.enableBlockOppositeSameSymbol) return null;
  const incoming = normalizeGuardSymbol(signal?.symbol);
  const sideNew = signalSide(signal);
  if (!incoming || !sideNew) return null;

  const slice = tradesForAccount(trades, accountKey);
  for (const t of slice) {
    if (!isOpenishStatus(t?.status) || t?.closeTime || t?.closedAt) continue;
    const sym = normalizeGuardSymbol(t.symbol);
    if (sym !== incoming) continue;
    const sideOld = tradeSide(t);
    if (!sideOld || sideOld === sideNew) continue;
    return {
      code: 'BLOCKED_OPPOSITE_SYMBOL',
      reason: `Opposite direction blocked: open ${sideOld} on ${incoming}, incoming ${sideNew} — close the existing trade first`
    };
  }
  return null;
}

/**
 * Block opposing directions on different symbols in the same correlation group while a leg is open.
 */
function evaluateCorrelatedOpposite({ settings, signal, trades, accountKey }) {
  if (!settings?.enableBlockCorrelatedOpposite) return null;
  const incomingSym = normalizeGuardSymbol(signal?.symbol);
  const sideNew = signalSide(signal);
  if (!incomingSym || !sideNew) return null;

  const groups = getCorrelationGroups(settings);
  const slice = tradesForAccount(trades, accountKey);

  for (const group of groups) {
    const set = new Set(group.map(normalizeGuardSymbol));
    if (!set.has(incomingSym)) continue;

    for (const t of slice) {
      if (!isOpenishStatus(t?.status) || t?.closeTime || t?.closedAt) continue;
      const openSym = normalizeGuardSymbol(t.symbol);
      if (!set.has(openSym) || openSym === incomingSym) continue;
      const sideOld = tradeSide(t);
      if (!sideOld || sideOld === sideNew) continue;
      return {
        code: 'BLOCKED_CORRELATED_PAIR',
        reason: `Correlated hedge blocked: open ${sideOld} ${openSym}, incoming ${sideNew} ${incomingSym} — close the first trade or disable this rule`
      };
    }
  }
  return null;
}

function localDayKey(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function isClosedishStatus(st) {
  const u = String(st || '').toUpperCase();
  return u.includes('CLOSED') || u.includes('TP_HIT') || u.includes('SL_HIT') || u === 'CANCELLED' || u === 'CANCELED' || u === 'REJECTED';
}

function isOpenishStatus(st) {
  const u = String(st || '').toUpperCase();
  if (u.includes('BLOCKED')) return false;
  if (u.startsWith('FAILED')) return false;
  if (u === 'PENDING' || u === 'SENT' || u === 'DISPATCHED' || u === 'NO_MT5_QUEUED') return true;
  if (!isClosedishStatus(u) && u && !u.includes('FAIL')) return true;
  return false;
}

/**
 * @param {object[]} trades
 * @param {Date} [now]
 */
function countTradesStartedToday(trades, now = new Date()) {
  const key = localDayKey(now);
  return (trades || []).filter((t) => t?.openedAt && localDayKey(t.openedAt) === key).length;
}

/**
 * "Open" copy trades in our list (simplified: pending / sent, not definitively closed).
 * @param {object[]} trades
 */
function countAppOpenTrades(trades) {
  return (trades || []).filter((t) => isOpenishStatus(t?.status) && !t?.closeTime && !t?.closedAt).length;
}

/**
 * @param {object[]} trades
 * @param {Date} [now]
 */
function sumTodayClosedPnl(trades, now = new Date()) {
  const key = localDayKey(now);
  let sum = 0;
  for (const t of trades || []) {
    if (!t) continue;
    if (!isClosedishStatus(t.status)) continue;
    const p = Number(t.profit);
    if (!Number.isFinite(p)) continue;
    const d = t.closeTime || t.closedAt || t.lastUpdateAt;
    if (!d) continue;
    if (localDayKey(d) !== key) continue;
    sum += p;
  }
  return sum;
}

/**
 * @param {object} param0
 * @param {object} param0.settings
 * @param {object} param0.signal - after transforms (has entry, sl, symbol)
 * @param {object[]} param0.trades
 * @param {object} [param0.accountSnapshot] - from mt5: balance, equity
 * @param {{ priceDistancePips: function }} [param0.helpers]
 * @param {object} [param0.store] - electron-store for start-of-day equity baseline
 * @param {string} [param0.accountKey] - MT5 account scope for open-trade checks
 * @returns {{ allowed: boolean, reason: string, code?: string }}
 */
function evaluateExecutionGuards({ settings, signal, trades, accountSnapshot, helpers, accountKey, store }) {
  const slGuard = evaluateRequiredValidStopLoss({ settings, signal });
  if (slGuard) return { allowed: false, ...slGuard };

  const priceDistancePips = helpers?.priceDistancePips;
  const minPips = Math.max(0, Number(settings?.minPips) || 0);
  if (minPips > 0 && signal && priceDistancePips && signal.entry > 0 && signal.sl > 0) {
    const d = priceDistancePips(signal.symbol, signal.entry, signal.sl);
    if (d < minPips) {
      return {
        allowed: false,
        code: 'BLOCKED_MIN_PIPS',
        reason: `SL distance ${d.toFixed(1)} pips is below minimum ${minPips} pips`
      };
    }
  }

  const maxDaily = Math.max(0, Number(settings?.maxDailyTrades) || 0);
  if (maxDaily > 0) {
    const n = countTradesStartedToday(trades);
    if (n >= maxDaily) {
      return {
        allowed: false,
        code: 'BLOCKED_DAILY_TRADES',
        reason: `Maximum daily signals (${maxDaily}) reached for today`
      };
    }
  }

  const maxSpread = Math.max(0, Number(settings?.maxSpreadPips) || 0);
  if (maxSpread > 0 && signal && Number.isFinite(Number(signal.spreadPips))) {
    const spread = Number(signal.spreadPips);
    if (spread > maxSpread) {
      return {
        allowed: false,
        code: 'BLOCKED_SPREAD',
        reason: `Spread ${spread.toFixed(1)} pips exceeds cap ${maxSpread.toFixed(1)} pips`
      };
    }
  }

  const opp = evaluateOppositeSameSymbol({ settings, signal, trades, accountKey });
  if (opp) return { allowed: false, ...opp };

  const corr = evaluateCorrelatedOpposite({ settings, signal, trades, accountKey });
  if (corr) return { allowed: false, ...corr };

  if (settings?.enableTradeLimit) {
    const maxC = Math.max(1, Number(settings?.maxConcurrentTrades) || 10);
    const openN = countAppOpenTrades(trades);
    if (openN >= maxC) {
      return {
        allowed: false,
        code: 'BLOCKED_CONCURRENT',
        reason: `Concurrent open trades limit (${maxC}) reached (${openN} open in app list)`
      };
    }
  }

  if (settings?.enableDailyLoss) {
    const maxLoss = Math.max(0, Number(settings?.maxDailyLoss) || 0);
    const maxLossPct = Math.max(0, Number(settings?.maxDailyLossPct) || 0);
    const todayPnl = sumTodayClosedPnl(trades);
    const metrics = computeDailyLossMetrics({
      settings,
      store: store || null,
      accountKey: accountKey || 'unknown',
      accountSnapshot,
      todayClosedPnl: todayPnl
    });
    const lossUsd = metrics.lossUsd;
    const lossPct = metrics.lossPct;
    const basisLabel = metrics.basis === 'equity' ? 'equity' : 'realized P&L';
    const staleNote = metrics.staleFallback ? ' (stale equity snapshot — using realized)' : '';

    if (maxLoss > 0 && lossUsd >= maxLoss) {
      return {
        allowed: false,
        code: 'BLOCKED_DAILY_LOSS',
        reason: `Daily loss ${lossUsd.toFixed(2)}$ (${basisLabel}) hit max cap (${maxLoss}$)${staleNote}`
      };
    }
    if (maxLossPct > 0 && metrics.startBaseline > 0 && lossPct >= maxLossPct) {
      return {
        allowed: false,
        code: 'BLOCKED_DAILY_LOSS_PCT',
        reason: `Daily loss ${lossPct.toFixed(2)}% (${basisLabel}) exceeds limit (${maxLossPct}%)${staleNote}`
      };
    }
  }

  return { allowed: true, reason: '' };
}

module.exports = {
  evaluateExecutionGuards,
  countTradesStartedToday,
  countAppOpenTrades,
  sumTodayClosedPnl,
  localDayKey,
  normalizeGuardSymbol
};
