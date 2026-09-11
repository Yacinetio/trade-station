/**
 * Calendar-aligned scopes in the machine's local timezone.
 * DAY — today from 00:00:00.000 through 23:59:59.999
 * WEEK — Sunday 00:00 through Saturday end (matches calendar grid usage elsewhere)
 * MONTH — first through last ms of calendar month
 * YEAR — Jan 1 through Dec 31 of current calendar year
 */

function getScopeRange(scope, now = new Date()) {
  const key = String(scope || 'ALL').toUpperCase();
  if (key === 'ALL' || key === 'CUSTOM') return { start: null, end: null };

  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();

  if (key === 'DAY') {
    const start = new Date(y, m, day, 0, 0, 0, 0);
    const end = new Date(y, m, day, 23, 59, 59, 999);
    return { start, end };
  }

  if (key === 'WEEK') {
    const d = new Date(now);
    const dow = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - dow);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (key === 'MONTH') {
    const start = new Date(y, m, 1, 0, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (key === 'YEAR') {
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    const end = new Date(y, 11, 31, 23, 59, 59, 999);
    return { start, end };
  }

  return { start: null, end: null };
}

function parseYmdLocalBoundary(ymd, endOfDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (endOfDay) return new Date(y, mo - 1, d, 23, 59, 59, 999);
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

/** @returns {{ start: Date, end: Date } | null} */
function getCustomScopeBounds(fromYmd, toYmd) {
  let start = parseYmdLocalBoundary(fromYmd, false);
  let end = parseYmdLocalBoundary(toYmd, true);
  if (!start || !end) return null;
  if (start.getTime() > end.getTime()) {
    const a = parseYmdLocalBoundary(toYmd, false);
    const b = parseYmdLocalBoundary(fromYmd, true);
    if (!a || !b) return null;
    start = a;
    end = b;
  }
  return { start, end };
}

function tradeIsClosedLike(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('CLOSED')) return true;
  if (s.includes('SL_HIT') || s.includes('TP_HIT')) return true;
  if (trade?.closeTime) return true;
  return false;
}

/** Closed trades → closedAt first; open → openedAt. Never use lastUpdateAt (sync noise). */
function parseTradeDateLikeAnalytics(trade) {
  const closed = tradeIsClosedLike(trade);
  const candidates = closed
    ? [trade?.closedAt, trade?.openedAt]
    : [trade?.openedAt, trade?.closedAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** True iff trade belongs in computeAnalytics slice for this scope (same date basis as summaries). */
function tradeMatchesTimeScope(trade, scope, now = new Date()) {
  if (String(scope || 'ALL').toUpperCase() === 'ALL') return true;
  const d = parseTradeDateLikeAnalytics(trade);
  if (!d) return false;
  const { start, end } = getScopeRange(scope, now);
  if (!start && !end) return true;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

module.exports = {
  getScopeRange,
  getCustomScopeBounds,
  parseTradeDateLikeAnalytics,
  tradeMatchesTimeScope
};
