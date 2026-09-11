/**
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
 *
 * Pure functions, no dependencies. CommonJS so the Electron main process can
 * require() it directly; renderer consumes its output via the analytics payload.
 */

const MIN = {
  ASIA_START: 22 * 60, // 22:00 UTC
  ASIA_END: 8 * 60, // 08:00 UTC
  LONDON_START: 8 * 60, // 08:00 UTC
  NY_OPEN_DST: 13 * 60 + 30, // 13:30 UTC (09:30 New York, EDT)
  NY_OPEN_STD: 14 * 60 + 30, // 14:30 UTC (09:30 New York, EST)
  NY_CLOSE_DST: 20 * 60, // 20:00 UTC (16:00 New York, EDT)
  NY_CLOSE_STD: 21 * 60 // 21:00 UTC (16:00 New York, EST)
};

function toValidDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Day-of-month (1-based) of the first Sunday of a month (month 1-12), UTC calendar. */
function firstSundayOfMonth(year, month) {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return dow === 0 ? 1 : 8 - dow;
}

/**
 * True when US daylight saving time (EDT) is in effect at the given UTC instant.
 * Rule (since 2007): clocks spring forward the 2nd Sunday of March at 02:00 EST
 * (= 07:00 UTC) and fall back the 1st Sunday of November at 02:00 EDT (= 06:00 UTC).
 * Same rule as the indicator's IsUSDST, with the fall-back transition resolved to
 * the exact hour (06:00 UTC) instead of day granularity.
 * @param {Date|string|number} date
 */
function isUsDst(date) {
  const d = toValidDate(date);
  if (!d) return false;
  const month = d.getUTCMonth() + 1;
  if (month > 3 && month < 11) return true;
  if (month < 3 || month > 11) return false;
  const day = d.getUTCDate();
  if (month === 3) {
    const startDay = firstSundayOfMonth(d.getUTCFullYear(), 3) + 7; // 2nd Sunday
    if (day !== startDay) return day > startDay;
    return d.getUTCHours() >= 7; // from 07:00 UTC on the spring-forward day
  }
  const endDay = firstSundayOfMonth(d.getUTCFullYear(), 11); // 1st Sunday
  if (day !== endDay) return day < endDay;
  return d.getUTCHours() < 6; // until 06:00 UTC on the fall-back day
}

/** DST-aware NY cash open in UTC minutes (810 = 13:30, 870 = 14:30). */
function nyOpenUtcMinutes(date) {
  return isUsDst(date) ? MIN.NY_OPEN_DST : MIN.NY_OPEN_STD;
}

/** DST-aware NY session close in UTC minutes (1200 = 20:00, 1260 = 21:00). */
function nyCloseUtcMinutes(date) {
  return isUsDst(date) ? MIN.NY_CLOSE_DST : MIN.NY_CLOSE_STD;
}

function utcMinutesOfDay(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Classify a UTC instant into a trading session.
 * @param {Date|string|number} date
 * @returns {'asia'|'london'|'newYork'|'off'|null} null only for invalid input
 */
function getSession(date) {
  const d = toValidDate(date);
  if (!d) return null;
  const m = utcMinutesOfDay(d);
  if (m >= MIN.ASIA_START || m < MIN.ASIA_END) return 'asia';
  const nyOpen = nyOpenUtcMinutes(d);
  if (m < nyOpen) return 'london'; // 08:00 → NY open
  if (m < nyCloseUtcMinutes(d)) return 'newYork';
  return 'off'; // NY close → 22:00
}

/**
 * ICT killzone windows (UTC). Where windows overlap, the most specific wins:
 * silver-bullet > ny-am-kz > london-close-kz > london-open-kz > asia-kz.
 *
 *   asia-kz          00:00–04:00 UTC — Asia liquidity build (Tokyo open block)
 *   london-open-kz   07:00–10:00 UTC — London open killzone (frankfurt + LO sweep)
 *   ny-am-kz         NY open → open + 2h30 — DST-aware: 13:30–16:00 (EDT) / 14:30–17:00 (EST)
 *   london-close-kz  15:00–17:00 UTC — London close rebalancing window
 *   silver-bullet    15:00–16:00 UTC summer / 16:00–17:00 UTC winter — NY 10–11am macro
 *
 * Note: in winter, ny-am-kz (14:30–17:00) + silver-bullet (16:00–17:00) fully
 * shadow london-close-kz under this precedence.
 * @param {Date|string|number} date
 * @returns {'asia-kz'|'london-open-kz'|'ny-am-kz'|'london-close-kz'|'silver-bullet'|null}
 */
function getKillzone(date) {
  const d = toValidDate(date);
  if (!d) return null;
  const m = utcMinutesOfDay(d);
  const dst = isUsDst(d);

  const sbStart = dst ? 15 * 60 : 16 * 60; // NY 10:00 local
  if (m >= sbStart && m < sbStart + 60) return 'silver-bullet';

  const nyOpen = nyOpenUtcMinutes(d);
  if (m >= nyOpen && m < nyOpen + 150) return 'ny-am-kz';

  if (m >= 15 * 60 && m < 17 * 60) return 'london-close-kz';
  if (m >= 7 * 60 && m < 10 * 60) return 'london-open-kz';
  if (m >= 0 && m < 4 * 60) return 'asia-kz';
  return null;
}

const SESSION_KEYS = ['asia', 'london', 'newYork', 'off'];
const KILLZONE_KEYS = ['asia-kz', 'london-open-kz', 'ny-am-kz', 'silver-bullet', 'london-close-kz'];

module.exports = {
  isUsDst,
  getSession,
  getKillzone,
  nyOpenUtcMinutes,
  nyCloseUtcMinutes,
  SESSION_KEYS,
  KILLZONE_KEYS
};
