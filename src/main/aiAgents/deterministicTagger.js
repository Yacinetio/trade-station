/**
 * Deterministic auto-tag rules — no AI. Tags merge into trade.journal.tags (deduped).
 */

function isClosed(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime || !!trade?.closedAt;
}

function openMs(trade) {
  const raw = trade?.openedAt || trade?.time || trade?.createdAt;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function closeMs(trade) {
  const raw = trade?.closedAt || trade?.closeTime || trade?.updatedAt;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function utcDayKeyFromMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sessionTagFromUtcHour(hour) {
  if (hour >= 0 && hour < 7) return 'session:asian';
  if (hour >= 7 && hour < 13) return 'session:london';
  if (hour >= 13 && hour < 21) return 'session:newyork';
  return 'session:late';
}

function sessionTagForTrade(trade) {
  const ms = openMs(trade);
  if (ms == null) return null;
  return sessionTagFromUtcHour(new Date(ms).getUTCHours());
}

function hasNoSl(trade) {
  const sl = Number(trade?.sl ?? trade?.stopLoss);
  return !Number.isFinite(sl) || sl === 0;
}

function lotOf(trade) {
  const n = Number(trade?.lot ?? trade?.volume ?? trade?.lots);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function profitOf(trade) {
  const n = Number(trade?.profit);
  return Number.isFinite(n) ? n : 0;
}

function accountKeyOf(trade) {
  return String(trade?.accountKey || 'unknown');
}

function existingTags(trade) {
  const tags = Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [];
  return tags.map((t) => String(t || '').trim()).filter(Boolean);
}

function median(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function lastClosedSameAccount(allTrades, accountKey, beforeMs, limit = 20) {
  return (Array.isArray(allTrades) ? allTrades : [])
    .filter((t) => isClosed(t) && accountKeyOf(t) === accountKey)
    .map((t) => ({ t, ms: closeMs(t) }))
    .filter((x) => x.ms != null && (beforeMs == null || x.ms < beforeMs))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map((x) => x.t);
}

function isOversized(trade, allTrades) {
  const lot = lotOf(trade);
  if (lot == null) return false;
  const prior = lastClosedSameAccount(allTrades, accountKeyOf(trade), openMs(trade), 20);
  const lots = prior.map(lotOf).filter((n) => n != null);
  const med = median(lots);
  if (med == null || med <= 0) return false;
  return lot > med * 2;
}

function isRevengeCandidate(trade, allTrades) {
  const opened = openMs(trade);
  if (opened == null) return false;
  const account = accountKeyOf(trade);
  const windowMs = 15 * 60 * 1000;
  for (const other of Array.isArray(allTrades) ? allTrades : []) {
    if (!isClosed(other)) continue;
    if (accountKeyOf(other) !== account) continue;
    const closed = closeMs(other);
    if (closed == null || closed >= opened) continue;
    const delta = opened - closed;
    if (delta > 0 && delta < windowMs && profitOf(other) < 0) return true;
  }
  return false;
}

function countOpenedUtcDay(allTrades, dayKey) {
  let n = 0;
  for (const t of Array.isArray(allTrades) ? allTrades : []) {
    const ms = openMs(t);
    if (ms == null) continue;
    if (utcDayKeyFromMs(ms) === dayKey) n += 1;
  }
  return n;
}

function isWeekendHeld(trade) {
  const oms = openMs(trade);
  const cms = closeMs(trade);
  if (oms == null || cms == null) return false;
  const openDay = new Date(oms).getUTCDay();
  const closeDay = new Date(cms).getUTCDay();
  if (openDay !== 5) return false;
  const closeDate = new Date(cms);
  const openDate = new Date(oms);
  const daysApart = Math.floor((Date.UTC(
    closeDate.getUTCFullYear(), closeDate.getUTCMonth(), closeDate.getUTCDate()
  ) - Date.UTC(
    openDate.getUTCFullYear(), openDate.getUTCMonth(), openDate.getUTCDate()
  )) / 86400000);
  return daysApart >= 3 || closeDay === 1 || closeDay === 0;
}

function avgAbsProfitClosed(allTrades) {
  const closed = (Array.isArray(allTrades) ? allTrades : []).filter(isClosed);
  if (closed.length < 10) return null;
  const sum = closed.reduce((a, t) => a + Math.abs(profitOf(t)), 0);
  return sum / closed.length;
}

function computeAutoTags(trade, allTrades, settings = {}) {
  const tags = [];
  const st = sessionTagForTrade(trade);
  if (st) tags.push(st);
  if (hasNoSl(trade)) tags.push('no-sl');
  if (isOversized(trade, allTrades)) tags.push('oversized');
  if (isRevengeCandidate(trade, allTrades)) tags.push('revenge-candidate');

  const threshold = Number(settings?.aiAgents?.overtradingThreshold);
  const overN = Number.isFinite(threshold) && threshold > 0 ? threshold : 6;
  const oms = openMs(trade);
  if (oms != null) {
    const dayKey = utcDayKeyFromMs(oms);
    if (countOpenedUtcDay(allTrades, dayKey) >= overN) tags.push('overtrading-day');
  }

  if (isClosed(trade) && isWeekendHeld(trade)) tags.push('weekend-held');

  if (isClosed(trade)) {
    const avgAbs = avgAbsProfitClosed(allTrades);
    if (avgAbs != null && avgAbs > 0) {
      const p = Math.abs(profitOf(trade));
      if (p > avgAbs * 2) {
        tags.push(profitOf(trade) >= 0 ? 'big-winner' : 'big-loser');
      }
    }
  }

  return tags;
}

function mergeTags(existing, toAdd) {
  const set = new Set(existing.map((t) => String(t).trim()).filter(Boolean));
  const added = [];
  for (const raw of toAdd) {
    const t = String(raw || '').trim();
    if (!t || set.has(t)) continue;
    set.add(t);
    added.push(t);
  }
  return { tags: [...set], added };
}

function applyAutoTags(trades, settings = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const changes = [];
  const now = new Date().toISOString();

  const updatedTrades = list.map((trade) => {
    if (!isClosed(trade)) return trade;
    const autoTags = computeAutoTags(trade, list, settings);
    const cur = existingTags(trade);
    const { tags, added } = mergeTags(cur, autoTags);
    if (!added.length && trade?.journal?.autoTaggedAt) return trade;
    if (!added.length) {
      return {
        ...trade,
        journal: { ...(trade.journal || {}), tags, autoTaggedAt: trade.journal?.autoTaggedAt || now }
      };
    }
    changes.push({ tradeId: trade.id, added });
    return {
      ...trade,
      journal: { ...(trade.journal || {}), tags, autoTaggedAt: now }
    };
  });

  return { updatedTrades, changes };
}

module.exports = {
  isClosed,
  openMs,
  closeMs,
  sessionTagFromUtcHour,
  computeAutoTags,
  applyAutoTags
};
