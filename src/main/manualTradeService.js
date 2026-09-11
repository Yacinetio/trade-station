/**
 * Manual closed trades on channel "Manual" — paste Telegram OB block or enter fields.
 */

const signalParser = require('./signalParser');

const MANUAL_TRADE_CHANNEL = 'Manual';

function parseObStatsSignalTime(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(
    /^\s*time:\s*(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/im
  );
  if (!m) return null;
  const sec = m[6] != null ? Number(m[6]) : 0;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    sec
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '.').trim());
  return Number.isFinite(n) ? n : null;
}

function outcomeToStatus(outcome) {
  const o = String(outcome || '').trim().toLowerCase();
  if (o === 'tp') return 'CLOSED_TP';
  if (o === 'sl') return 'CLOSED_SL';
  if (o === 'be') return 'CLOSED_SL';
  return 'CLOSED';
}

function exitPriceForOutcome(outcome, fields) {
  const o = String(outcome || '').trim().toLowerCase();
  const entry = num(fields.entry);
  const sl = num(fields.sl);
  const tp = num(fields.tp);
  if (o === 'tp' && tp != null) return tp;
  if (o === 'sl' && sl != null) return sl;
  if (o === 'be' && entry != null) return entry;
  return tp != null ? tp : sl != null ? sl : entry;
}

/**
 * Parse Telegram OB-stats style message for manual entry form.
 *
 * @param {string} text
 * @param {object} [settings]
 * @returns {{ ok: boolean, error?: string, fields?: object }}
 */
function parseTelegramForManual(text, settings = {}) {
  const raw = String(text || '').trim();
  if (raw.length < 10) {
    return { ok: false, error: 'Paste a Telegram signal message first.' };
  }
  const parsed = signalParser.parse(raw, MANUAL_TRADE_CHANNEL, settings || {});
  if (!parsed) {
    return { ok: false, error: 'Could not parse signal — need Signal: BUY/SELL, Entry, and SL lines.' };
  }
  const openedAt = parseObStatsSignalTime(raw) || new Date().toISOString();
  const tp0 = Array.isArray(parsed.tp) && parsed.tp.length ? Number(parsed.tp[0]) : null;
  return {
    ok: true,
    fields: {
      symbol: parsed.symbol || '',
      type: String(parsed.type || 'BUY').toUpperCase(),
      entry: num(parsed.entry),
      signalEntry: num(parsed.entry),
      sl: num(parsed.sl),
      tp: tp0,
      lot: num(parsed.lot),
      timeframe: parsed.timeframe || '',
      bias: parsed.bias || '',
      vwapBand: parsed.vwapBand || '',
      hvnBand: parsed.hvnBand || '',
      trendAlign: parsed.trendAlign || '',
      obSize: parsed.obSize || '',
      avgEntry: num(parsed.avgEntry),
      obEdge: num(parsed.obEdge),
      openedAt,
      closedAt: openedAt,
      comment: ''
    }
  };
}

/**
 * @param {object} payload
 * @param {object} ctx - { normalizeTradeForStorage, account }
 */
function createManualTrade(payload, ctx = {}) {
  const normalize = ctx.normalizeTradeForStorage || ((t) => t);
  const outcome = String(payload?.outcome || 'tp').toLowerCase();
  let profit = num(payload?.profit);
  if (profit == null) profit = 0;
  if (outcome === 'be' && payload?.forceBeProfitZero !== false) {
    profit = 0;
  }

  let fields = payload?.fields && typeof payload.fields === 'object' ? { ...payload.fields } : {};
  if (payload?.telegramText) {
    const parsed = parseTelegramForManual(payload.telegramText, ctx.settings || {});
    if (!parsed.ok) {
      const err = new Error(parsed.error || 'Parse failed');
      err.code = 'PARSE_FAILED';
      throw err;
    }
    fields = { ...parsed.fields, ...fields };
  }

  const symbol = String(fields.symbol || '').trim().toUpperCase();
  const type = String(fields.type || '').trim().toUpperCase();
  if (!symbol || (type !== 'BUY' && type !== 'SELL')) {
    const err = new Error('Symbol and BUY/SELL type are required.');
    err.code = 'VALIDATION';
    throw err;
  }
  const entry = num(fields.entry);
  if (entry == null || entry <= 0) {
    const err = new Error('Entry price is required.');
    err.code = 'VALIDATION';
    throw err;
  }

  const now = new Date();
  const openedAt = fields.openedAt ? new Date(fields.openedAt) : now;
  const openedIso = Number.isNaN(openedAt.getTime()) ? now.toISOString() : openedAt.toISOString();
  const closedRaw = fields.closedAt ? new Date(fields.closedAt) : openedAt;
  const closedIso = Number.isNaN(closedRaw.getTime()) ? openedIso : closedRaw.toISOString();
  const timeStr = openedIso.slice(11, 19);
  const closeTimeStr = closedIso.slice(11, 19);

  const account = ctx.account || {};
  const status = outcomeToStatus(outcome);
  const exitPx = exitPriceForOutcome(outcome, fields);

  const trade = normalize({
    id: Date.now(),
    time: timeStr,
    openedAt: openedIso,
    closeTime: closeTimeStr,
    closedAt: closedIso,
    lastUpdateAt: closedIso,
    channel: MANUAL_TRADE_CHANNEL,
    symbol,
    type,
    orderType: 'MARKET',
    entry,
    sl: num(fields.sl) || 0,
    tp: num(fields.tp) || 0,
    lot: num(fields.lot) || 0,
    timeframe: String(fields.timeframe || '').trim(),
    profit,
    status,
    exitPrice: exitPx != null ? exitPx : undefined,
    manual: true,
    source: 'MANUAL',
    origin: 'MANUAL',
    accountKey: account.key || 'manual',
    accountLogin: account.login || 'Manual',
    accountServer: account.server || '',
    accountName: account.name || 'Manual entry',
    screenshots: [],
    journal: {},
    presetTags: [],
    ...(fields.signalEntry != null && num(fields.signalEntry) > 0
      ? { signalEntry: num(fields.signalEntry) }
      : {}),
    ...(num(fields.avgEntry) > 0 ? { avgEntry: num(fields.avgEntry) } : {}),
    ...(num(fields.obEdge) > 0 ? { obEdge: num(fields.obEdge) } : {}),
    ...(String(fields.bias || '').trim() ? { bias: String(fields.bias).trim().slice(0, 200) } : {}),
    ...(String(fields.vwapBand || '').trim()
      ? {
          vwapBand: String(fields.vwapBand).trim().toLowerCase().replace(/^n\/a$/i, 'na')
        }
      : {}),
    ...(String(fields.hvnBand || '').trim()
      ? {
          hvnBand: String(fields.hvnBand).trim().toLowerCase().replace(/^n\/a$/i, 'na')
        }
      : {}),
    ...(String(fields.trendAlign || '').trim()
      ? {
          trendAlign: String(fields.trendAlign).trim().toLowerCase().replace(/^n\/a$/i, 'na')
        }
      : {}),
    ...(String(fields.obSize || '').trim() ? { obSize: String(fields.obSize).trim().slice(0, 80) } : {}),
    ...(String(fields.comment || '').trim() ? { comment: String(fields.comment).trim().slice(0, 500) } : {})
  });

  return trade;
}

module.exports = {
  MANUAL_TRADE_CHANNEL,
  parseObStatsSignalTime,
  parseTelegramForManual,
  createManualTrade,
  outcomeToStatus
};
