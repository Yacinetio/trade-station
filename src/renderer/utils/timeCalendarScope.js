/** Calendar-aligned scopes (local timezone). Keep in sync with src/main/timeScope.js */

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

/** @returns {{ from: string, to: string }} YYYY-MM-DD, month-start → today */
export function defaultCustomAnalyticsRange(now = new Date()) {
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${y}-${pad(mo + 1)}-01`;
  const to = `${y}-${pad(mo + 1)}-${pad(d)}`;
  return { from, to };
}

export function toYmd(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @returns {{ start: Date, end: Date } | null} */
export function isoYmdCustomRangeBounds(fromYmd, toYmd) {
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

export function getScopeRange(scope, now = new Date()) {
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

function tradeIsClosedLike(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('CLOSED')) return true;
  if (s.includes('SL_HIT') || s.includes('TP_HIT')) return true;
  if (trade?.closeTime) return true;
  return false;
}

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

export function tradeMatchesTimeScope(trade, scope, now = new Date(), customBounds = null) {
  const key = String(scope || 'ALL').toUpperCase();
  if (key === 'ALL') return true;
  const d = parseTradeDateLikeAnalytics(trade);
  if (!d) return false;

  if (key === 'CUSTOM') {
    if (!customBounds || !customBounds.start || !customBounds.end) return true;
    if (d < customBounds.start) return false;
    if (d > customBounds.end) return false;
    return true;
  }

  const { start, end } = getScopeRange(scope, now);
  if (!start && !end) return true;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}
