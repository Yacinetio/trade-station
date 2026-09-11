/**
 * Trading schedule filters (time range, session, weekdays) for signal forwarding.
 * Time range uses the machine's local time (same as HTML time inputs in Settings).
 * Session filter uses the canonical UTC session model (sessionModel.js — DST-aware
 * NY open/close, Asia 22:00–08:00 UTC wrap), keyed by the same settings shape
 * sessions.{asian,london,newYork}.
 */

const { getSession } = require('./sessionModel');

function parseTimeToMinutes(value) {
  const s = String(value ?? '00:00').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + min;
}

/** Minutes since local midnight (fractional for sub-minute precision at boundaries). */
function localMinutesNow(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
}

/**
 * @returns {boolean} true if now (local) is inside [from, to] inclusive on the same calendar day,
 *   or the overnight wrap when from > to.
 */
function isLocalTimeInRange(date, fromStr, toStr) {
  const fromM = parseTimeToMinutes(fromStr);
  const toM = parseTimeToMinutes(toStr);
  const nowM = localMinutesNow(date);
  if (fromM === toM) return true;
  if (fromM < toM) {
    return nowM >= fromM && nowM <= toM;
  }
  // Overnight: e.g. 22:00 → 06:00
  return nowM >= fromM || nowM <= toM;
}

/** JS: 0=Sun … 6=Sat → UI: Mon=1 … Sun=7 */
function toUiDayIndex(date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

function isTradingDayAllowed(date, settings) {
  if (!settings?.enableDaysFilter) return { ok: true };
  const days = Array.isArray(settings.tradingDays) ? settings.tradingDays : [1, 2, 3, 4, 5];
  if (days.length === 0) return { ok: false, reason: 'No trading days selected' };
  const idx = toUiDayIndex(date);
  if (days.includes(idx)) return { ok: true };
  const name = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx] || 'today';
  return { ok: false, reason: `Trading not allowed on ${name}` };
}

/** Settings key (Settings UI) → canonical sessionModel session key. */
const SESSION_SETTING_TO_MODEL = {
  asian: 'asia',
  london: 'london',
  newYork: 'newYork'
};

/**
 * Membership comes from the canonical session model (UTC, DST-aware):
 * Asia 22:00–08:00 (wraps), London 08:00 → NY open (13:30/14:30),
 * NY → 20:00/21:00 UTC. Times in the NY-close → 22:00 dead zone belong to no
 * session and are rejected whenever the session filter is enabled.
 */
function isInAnySessionUtc(date, settings) {
  const sessions = settings?.sessions || {};
  const current = getSession(date);
  if (current && current !== 'off') {
    for (const [settingKey, modelKey] of Object.entries(SESSION_SETTING_TO_MODEL)) {
      const on = sessions[settingKey] !== false;
      if (on && modelKey === current) {
        return { ok: true };
      }
    }
  }
  return { ok: false, reason: 'Outside selected trading sessions (UTC)' };
}

/**
 * @param {object} settings — normalized app settings
 * @param {Date} [date]
 * @returns {{ allowed: boolean, reason: string }}
 */
function evaluateSignalSchedule(settings, date = new Date()) {
  const day = isTradingDayAllowed(date, settings);
  if (!day.ok) {
    return { allowed: false, reason: day.reason || 'Not a trading day' };
  }

  if (settings?.enableTimeFilter) {
    const from = settings.timeFrom || '00:00';
    const to = settings.timeTo || '23:59';
    if (!isLocalTimeInRange(date, from, to)) {
      return {
        allowed: false,
        reason: `Outside allowed time window (local ${from} – ${to})`
      };
    }
  }

  if (settings?.enableSessionFilter) {
    const s = isInAnySessionUtc(date, settings);
    if (!s.ok) {
      return { allowed: false, reason: s.reason || 'Outside session filter' };
    }
  }

  return { allowed: true, reason: '' };
}

module.exports = {
  evaluateSignalSchedule,
  parseTimeToMinutes,
  isLocalTimeInRange
};
