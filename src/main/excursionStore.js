/**
 * Excursion persistence: merges EA-sent MFE/MAE payloads (POSITION_UPDATE and
 * close ACK lines carrying mfePips/maePips/mfeMoney/maeMoney and, on final
 * close, pnlSeries) onto stored trade rows as `trade.excursion`.
 *
 * Pure-ish: mutates the matched trade inside the given `trades` array and
 * returns { changed, trade } — persistence stays with the caller (main.js
 * already calls saveStoredTrades at both ACK call sites).
 */

const PNL_SERIES_CAP = 400;

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** MT5 sends "0" for unused ids — treat as missing (same as main.js cleanBrokerId). */
function cleanId(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '0') return '';
  return s;
}

/** [[unixSec, pnl], ...] — drop malformed pairs, sort by time, downsample to cap keeping the last point. */
function sanitizePnlSeries(raw) {
  if (!Array.isArray(raw)) return null;
  const pairs = raw
    .map((p) => (Array.isArray(p) ? [toNum(p[0]), toNum(p[1])] : null))
    .filter((p) => p && p[0] != null && p[1] != null && p[0] > 0);
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  if (pairs.length <= PNL_SERIES_CAP) return pairs;
  const stride = Math.ceil(pairs.length / PNL_SERIES_CAP);
  const out = [];
  for (let i = 0; i < pairs.length; i += stride) out.push(pairs[i]);
  const last = pairs[pairs.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Excursion fields from a raw ACK payload, or null when the line carries none. */
function extractExcursionFromPayload(payload = {}) {
  const mfePips = toNum(payload?.mfePips);
  const maePips = toNum(payload?.maePips);
  if (mfePips == null && maePips == null) return null;
  return {
    mfePips: mfePips ?? 0,
    maePips: maePips ?? 0,
    mfeMoney: toNum(payload?.mfeMoney) ?? 0,
    maeMoney: toNum(payload?.maeMoney) ?? 0,
    pnlSeries: sanitizePnlSeries(payload?.pnlSeries)
  };
}

function payloadTradeIds(payload = {}) {
  return [
    payload?.trade?.tradeId,
    payload?.tradeId,
    payload?.trade?.id
  ]
    .map((v) => (v === undefined || v === null || v === '' ? '' : String(v)))
    .filter(Boolean);
}

function payloadBrokerIds(payload = {}) {
  return [
    payload?.positionId,
    payload?.trade?.positionId,
    payload?.dealId,
    payload?.trade?.dealId,
    payload?.ticket,
    payload?.trade?.ticket
  ]
    .map((v) => cleanId(v))
    .filter(Boolean);
}

/** Same matching order as main.js ack handling: app tradeId first, then broker position/deal/ticket ids. */
function findTradeForExcursion(trades = [], payload = {}) {
  const ids = payloadTradeIds(payload);
  if (ids.length > 0) {
    const byId = trades.find((t) => t && ids.includes(String(t.id)));
    if (byId) return byId;
  }
  const brokerIds = new Set(payloadBrokerIds(payload));
  if (brokerIds.size === 0) return null;
  return (
    trades.find((t) => {
      if (!t) return false;
      return (
        brokerIds.has(cleanId(t.mt5PositionId))
        || brokerIds.has(cleanId(t.mt5Ticket))
        || brokerIds.has(cleanId(t.mt5DealId))
      );
    }) || null
  );
}

function maxOf(a, b) {
  const na = toNum(a);
  const nb = toNum(b);
  if (na == null) return nb ?? 0;
  if (nb == null) return na;
  return Math.max(na, nb);
}

/**
 * Merge an EA excursion payload onto the matching trade in `trades`.
 * Peaks only ever grow (max-merge with any previous values); a pnlSeries in
 * the payload (final close flush) replaces the stored one.
 *
 * @param {Array<object>} trades - stored trades (mutated in place)
 * @param {object} payload - raw ACK object from the EA
 * @param {{ preferTrade?: object }} [opts] - trade already resolved by the caller's ack matching
 * @returns {{ changed: boolean, trade: object | null }}
 */
function applyExcursionPayload(trades, payload, opts = {}) {
  const data = extractExcursionFromPayload(payload);
  if (!data) return { changed: false, trade: null };

  const list = Array.isArray(trades) ? trades : [];
  let trade = opts.preferTrade && list.includes(opts.preferTrade) ? opts.preferTrade : null;
  if (!trade) trade = findTradeForExcursion(list, payload);
  if (!trade) return { changed: false, trade: null };

  const prev = trade.excursion && typeof trade.excursion === 'object' ? trade.excursion : {};
  const pnlSeries = data.pnlSeries || sanitizePnlSeries(prev.pnlSeries);
  trade.excursion = {
    mfePips: maxOf(prev.mfePips, data.mfePips),
    maePips: maxOf(prev.maePips, data.maePips),
    mfeMoney: maxOf(prev.mfeMoney, data.mfeMoney),
    maeMoney: maxOf(prev.maeMoney, data.maeMoney),
    ...(pnlSeries ? { pnlSeries } : {}),
    source: 'ea',
    updatedAt: new Date().toISOString()
  };
  return { changed: true, trade };
}

module.exports = {
  applyExcursionPayload,
  extractExcursionFromPayload,
  findTradeForExcursion,
  sanitizePnlSeries
};
