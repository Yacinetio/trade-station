/**
 * Stealth execution: jittered delay + tiny lot rounding randomization to avoid
 * "copy-trade detection" patterns on funded / prop accounts.
 */

function clampMs(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(60_000, Math.max(0, Math.round(n)));
}

function getStealthDelayMs(settings, perChannelExtraMs = 0) {
  const enabled = settings?.stealthMode === true;
  if (!enabled) return 0;
  const minMs = clampMs(settings?.stealthMinDelayMs, 200);
  const maxMs = clampMs(settings?.stealthMaxDelayMs, 2500);
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const span = Math.max(0, hi - lo);
  const jitter = lo + Math.floor(Math.random() * (span + 1));
  const extra = clampMs(perChannelExtraMs, 0);
  return jitter + extra;
}

/**
 * Applies a small lot-size randomization (default ±0.5%) to make copy lots not
 * perfectly identical to the source signal. Respects min lot 0.01.
 */
function applyStealthLotJitter(lot, settings) {
  if (settings?.stealthMode !== true) return lot;
  const pct = Number(settings?.stealthLotJitterPct);
  if (!Number.isFinite(pct) || pct <= 0) return lot;
  const base = Number(lot);
  if (!Number.isFinite(base) || base <= 0) return lot;
  const sign = Math.random() < 0.5 ? -1 : 1;
  const factor = 1 + sign * (Math.random() * (pct / 100));
  const next = Math.max(0.01, Math.round(base * factor * 100) / 100);
  return next;
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  getStealthDelayMs,
  applyStealthLotJitter,
  sleep
};
