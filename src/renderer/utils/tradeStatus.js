/**
 * Single source of truth for trade-status semantics across renderer pages and analytics.
 *
 * Treats a trade as "closed" if status contains CLOSED / SL_HIT / TP_HIT, OR a closeTime
 * has been recorded. The previous DashboardPage helpers ignored `closeTime`, which made
 * tab counts disagree with analytics totals.
 */

export function tradeIsBlocked(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('BLOCKED')) return true;
  if (s.startsWith('FAILED')) return true;
  return Boolean(trade?.blockedReason);
}

export function tradeIsClosed(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('CLOSED')) return true;
  if (s.includes('SL_HIT') || s.includes('TP_HIT')) return true;
  if (trade?.closeTime) return true;
  return false;
}

export function tradeIsLive(trade) {
  return !tradeIsBlocked(trade) && !tradeIsClosed(trade);
}

export function toNumericProfit(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    let raw = String(value).trim();
    if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(raw) || /^-?\d+,\d+$/.test(raw)) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/[^0-9.+-]/g, '');
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function getTradeOutcome(trade, breakEvenAmount = 50) {
  const s = String(trade?.status || '').toUpperCase();
  const threshold = Math.max(0, Number(breakEvenAmount) || 0);
  const profit = toNumericProfit(trade?.profit);
  /** Scheduled EOD flatten — excluded from win/loss & TP/SL-style buckets in analytics. */
  if (s === 'CLOSED_EOD') return 'EOD';
  /** Stop-filled in profit — Settings BE band only: inside → BE; outside → closed (no STOP+ category). */
  if (s === 'CLOSED_SL_PROFIT' || s.includes('SL_PROFIT')) {
    if (Math.abs(profit) <= threshold) return 'BE';
    return 'CLOSED';
  }
  if (s === 'TP_HIT' || s === 'CLOSED_TP') return 'TP';
  if (!tradeIsClosed(trade)) return 'OPEN';
  if (s === 'SL_HIT' || s === 'CLOSED_SL') {
    if (Math.abs(profit) <= threshold) return 'BE';
    return 'SL';
  }
  if (Math.abs(profit) <= threshold) return 'BE';
  return 'CLOSED';
}

/** Win for stats — TP hits only (excludes SL, BE, EOD, manual CLOSED). */
export function isClosedTradeWinForStats(trade, breakEvenAmount = 50) {
  return getTradeOutcome(trade, breakEvenAmount) === 'TP';
}

/** Loss for stats — SL hits only (excludes TP, BE, EOD, manual CLOSED). */
export function isClosedTradeLossForStats(trade, breakEvenAmount = 50) {
  return getTradeOutcome(trade, breakEvenAmount) === 'SL';
}

export function tradeMatchesFocusStatus(trade, focusStatus = 'ALL', breakEvenAmount = 50) {
  const wanted = String(focusStatus || 'ALL').toUpperCase();
  if (wanted === 'ALL') return true;
  const status = String(trade?.status || '').toUpperCase();
  const outcome = getTradeOutcome(trade, breakEvenAmount);
  if (wanted === 'LIVE') return tradeIsLive(trade);
  if (wanted === 'CLOSED') return tradeIsClosed(trade);
  if (wanted === 'BLOCKED') return tradeIsBlocked(trade);
  if (wanted === 'SENT') return status === 'SENT';
  if (wanted === 'DISPATCHED') return status === 'DISPATCHED' || status === 'NO_MT5_QUEUED';
  if (wanted === 'PENDING') return status === 'PENDING';
  if (wanted === 'TP') return outcome === 'TP';
  if (wanted === 'SL') return outcome === 'SL';
  if (wanted === 'BE') return outcome === 'BE';
  if (wanted === 'EOD') return outcome === 'EOD';
  return status === wanted;
}
