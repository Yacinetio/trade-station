/**
 * AI usage tracker.
 *
 * Counts successful AI responses per local-day for the UI ("X calls today").
 * Persisted to electron-store so the count survives restarts.
 *
 * Buckets:
 *   - used         : every AI call that returned a usable response (success or rate-limit included? no — only success)
 *   - errors       : non-success calls (timeout, bad JSON, network, 5xx)
 *   - rateLimited  : calls that came back HTTP 429 (real provider rate-limit)
 *   - blocked      : checkSignal verdicts that resulted in 'block'
 *   - reduced      : checkSignal verdicts that resulted in 'reduce'
 *   - allowed      : checkSignal verdicts that resulted in 'allow'
 *
 * Self-imposed daily caps were removed; Pollinations may still return HTTP 429
 * (tracked in rateLimited). `limit` / `capReached` stay on the status object for UI compat @deprecated unlimited.
 */

const STORE_KEY = 'aiUsage';

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyDay() {
  return {
    date: todayKey(),
    used: 0,
    errors: 0,
    rateLimited: 0,
    allowed: 0,
    reduced: 0,
    blocked: 0,
    lastCallAt: null
  };
}

function readDay(store) {
  if (!store) return emptyDay();
  let raw = store.get(STORE_KEY, null);
  if (!raw || typeof raw !== 'object' || raw.date !== todayKey()) {
    raw = emptyDay();
    try { store.set(STORE_KEY, raw); } catch (_) { /* best-effort */ }
  }
  return { ...emptyDay(), ...raw, date: raw.date || todayKey() };
}

function writeDay(store, day) {
  if (!store) return;
  try { store.set(STORE_KEY, day); } catch (_) { /* best-effort */ }
}

/**
 * Record one outcome of an AI call. Multiple `kinds` can be incremented at once
 * (e.g. on a successful checkSignal we increment both `used` and `allowed`).
 *
 * @param {object} store - electron-store instance
 * @param {('used'|'errors'|'rateLimited'|'allowed'|'reduced'|'blocked')[]} kinds
 */
function record(store, kinds) {
  const day = readDay(store);
  for (const k of kinds || []) {
    if (Object.prototype.hasOwnProperty.call(day, k)) {
      day[k] = Number(day[k] || 0) + 1;
    }
  }
  day.lastCallAt = new Date().toISOString();
  writeDay(store, day);
  return day;
}

/**
 * @returns {{ date:string, used:number, errors:number, rateLimited:number,
 *            allowed:number, reduced:number, blocked:number, lastCallAt:string|null,
 *            limit:number, remaining:(number|null), capReached:boolean }}
 */
function getStatus(store, _settings) {
  const day = readDay(store);
  return {
    ...day,
    limit: 0,
    remaining: null,
    capReached: false
  };
}

/** @deprecated Daily caps removed — always false */
function isOverLimit(_store, _settings) {
  return false;
}

function reset(store) {
  const day = emptyDay();
  writeDay(store, day);
  return day;
}

module.exports = {
  STORE_KEY,
  todayKey,
  record,
  getStatus,
  isOverLimit,
  reset
};
