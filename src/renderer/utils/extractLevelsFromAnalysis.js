/**
 * Heuristic extraction from AI plain-text analysis.
 * Not financial advice — for visualization only; models can hallucinate numbers.
 */

const DATE_LIKE = /^\d{4}\.\d{2}$/;

/** @param {number} p */
function plausibleFxPrice(p) {
  if (!Number.isFinite(p)) return false;
  if (p <= 0 || p > 1e6) return false;
  if (DATE_LIKE.test(String(p))) return false;
  return true;
}

const PRICE_RE = /\b(\d{1,5}\.\d{2,5})\b/g;

/**
 * Use text immediately BEFORE the price so one line "Entry 1.05 SL 1.04 TP 1.06" does not tag entry as SL.
 * @returns {'entry'|'stop'|'target'|null}
 */
function tradeRoleBeforePrice(line, priceStartIdx) {
  /** Short window so a later price on the same line is not assigned SL/TP from earlier labels. */
  const before = line.slice(Math.max(0, priceStartIdx - 12), priceStartIdx).toLowerCase();
  if (/\b(stop|sl\b|invalidation)\b/.test(before)) return 'stop';
  if (/\b(tp\d?\b|target|take[- ]?profit)\b/.test(before)) return 'target';
  if (/\b(entry|entries)\b/.test(before)) return 'entry';
  if (/\b(buy|sell)\s+(at|near|around|@)\b/.test(before)) return 'entry';
  if (/\b(long|short)\s+(at|near|around|@)\b/.test(before)) return 'entry';
  return null;
}

function labelForRole(role) {
  if (role === 'entry') return 'Entry';
  if (role === 'stop') return 'SL';
  if (role === 'target') return 'TP';
  return role;
}

/**
 * Last mention wins per role (entry, SL, TP). Ignores support/resistance swing levels.
 * @param {string} text
 * @param {{ lo: number, hi: number } | null} barRange
 * @returns {Array<{ price: number, label: string, role: 'entry'|'stop'|'target' }>}
 */
export function extractEntrySlTpFromAnalysis(text, barRange) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  let pad = 0;
  if (barRange && Number.isFinite(barRange.lo) && Number.isFinite(barRange.hi) && barRange.hi > barRange.lo) {
    pad = (barRange.hi - barRange.lo) * 0.25;
  }

  /** @type {Record<string, { price: number, label: string, role: 'entry'|'stop'|'target' }>} */
  const last = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    let m;
    PRICE_RE.lastIndex = 0;
    while ((m = PRICE_RE.exec(line)) != null) {
      const priceStr = m[1];
      const p = Number(priceStr);
      if (!plausibleFxPrice(p)) continue;
      if (barRange && pad > 0 && (p < barRange.lo - pad || p > barRange.hi + pad)) continue;

      const i = m.index;
      const role = tradeRoleBeforePrice(line, i);
      if (!role) continue;

      last[role] = { price: p, label: labelForRole(role), role };
    }
  }

  const order = /** @type {const} */ (['entry', 'stop', 'target']);
  return order.map((k) => last[k]).filter(Boolean);
}

/**
 * @param {string} text
 * @returns {'buy'|'sell'|null}
 */
export function detectBiasFromAnalysis(text) {
  const t = String(text || '').slice(-900).toLowerCase();
  if (!t.trim()) return null;
  const buy = (t.match(/\b(buy|long|bullish)\b/g) || []).length;
  const sell = (t.match(/\b(sell|short|bearish)\b/g) || []).length;
  if (buy === 0 && sell === 0) return null;
  if (buy === sell) return null;
  return buy > sell ? 'buy' : 'sell';
}
