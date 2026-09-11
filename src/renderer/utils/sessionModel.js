/**
 * Mirror of src/main/sessionModel.js — keep in sync
 *
 * Canonical SMC session / killzone model — single source of truth for session
 * classification across the app (analytics, schedule filters, renderer tables).
 *
 * Ported from OB_STATS_ANALYZER.mq5 (GetSessionIndex / IsUSDST):
 *   - All boundaries are UTC.
 *   - NY open is DST-aware: 13:30 UTC while US is on EDT, 14:30 UTC on EST.
 *   - NY close follows the indicator: 20:00 UTC (EDT) / 21:00 UTC (EST) — 16:00 New York.
 *
 * Session map (UTC):
 *   asia    22:00 → 08:00            (wraps midnight)
 *   london  08:00 → NY open          (13:30 summer / 14:30 winter)
 *   newYork NY open → NY close       (13:30–20:00 summer / 14:30–21:00 winter)
 *   off     NY close → 22:00         (dead zone between NY close and Asia open)
 */

const MIN = {
  ASIA_START: 22 * 60,
  ASIA_END: 8 * 60,
  LONDON_START: 8 * 60,
  NY_OPEN_DST: 13 * 60 + 30,
  NY_OPEN_STD: 14 * 60 + 30,
  NY_CLOSE_DST: 20 * 60,
  NY_CLOSE_STD: 21 * 60
};

function toValidDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstSundayOfMonth(year, month) {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return dow === 0 ? 1 : 8 - dow;
}

export function isUsDst(date) {
  const d = toValidDate(date);
  if (!d) return false;
  const month = d.getUTCMonth() + 1;
  if (month > 3 && month < 11) return true;
  if (month < 3 || month > 11) return false;
  const day = d.getUTCDate();
  if (month === 3) {
    const startDay = firstSundayOfMonth(d.getUTCFullYear(), 3) + 7;
    if (day !== startDay) return day > startDay;
    return d.getUTCHours() >= 7;
  }
  const endDay = firstSundayOfMonth(d.getUTCFullYear(), 11);
  if (day !== endDay) return day < endDay;
  return d.getUTCHours() < 6;
}

export function nyOpenUtcMinutes(date) {
  return isUsDst(date) ? MIN.NY_OPEN_DST : MIN.NY_OPEN_STD;
}

export function nyCloseUtcMinutes(date) {
  return isUsDst(date) ? MIN.NY_CLOSE_DST : MIN.NY_CLOSE_STD;
}

function utcMinutesOfDay(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function getSession(date) {
  const d = toValidDate(date);
  if (!d) return null;
  const m = utcMinutesOfDay(d);
  if (m >= MIN.ASIA_START || m < MIN.ASIA_END) return 'asia';
  const nyOpen = nyOpenUtcMinutes(d);
  if (m < nyOpen) return 'london';
  if (m < nyCloseUtcMinutes(d)) return 'newYork';
  return 'off';
}

export function getKillzone(date) {
  const d = toValidDate(date);
  if (!d) return null;
  const m = utcMinutesOfDay(d);
  const dst = isUsDst(d);

  const sbStart = dst ? 15 * 60 : 16 * 60;
  if (m >= sbStart && m < sbStart + 60) return 'silver-bullet';

  const nyOpen = nyOpenUtcMinutes(d);
  if (m >= nyOpen && m < nyOpen + 150) return 'ny-am-kz';

  if (m >= 15 * 60 && m < 17 * 60) return 'london-close-kz';
  if (m >= 7 * 60 && m < 10 * 60) return 'london-open-kz';
  if (m >= 0 && m < 4 * 60) return 'asia-kz';
  return null;
}

/** Map sessionModel key → renderer slice key (matches analyticsService). */
export function sessionKeyForSlice(date) {
  const s = getSession(date);
  if (s === 'asia') return 'asian';
  return s || 'off';
}

export const SESSION_KEYS = ['asia', 'london', 'newYork', 'off'];
export const KILLZONE_KEYS = ['asia-kz', 'london-open-kz', 'ny-am-kz', 'silver-bullet', 'london-close-kz'];
