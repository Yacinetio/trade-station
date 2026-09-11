const { symbolsLikelySame } = require('./ackTradeMatch');

const METADATA_FIELDS = [
  'bias',
  'fundBias',
  'vwapBand',
  'hvnBand',
  'trendAlign',
  'obSize',
  'timeframe',
  'signalEntry',
  'avgEntry',
  'confluence',
  'rejPct',
  'obWinRate',
  'top1',
  'signalSession',
  'channel',
  'comment'
];

const EXEC_FIELDS = ['entry', 'sl', 'tp', 'lot'];

const ALL_PATCH_FIELDS = [...EXEC_FIELDS, ...METADATA_FIELDS];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isOpenTradeStatus(status = '') {
  const s = String(status || '').toUpperCase();
  if (!s) return false;
  if (s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT')) return false;
  if (s.startsWith('FAILED') || s.startsWith('BLOCKED')) return false;
  if (s === 'SIMULATED') return false;
  return true;
}

function inheritMissingTradeMetadata(target = {}, source = {}) {
  if (!target || !source) return target;
  const out = { ...target };
  for (const key of ALL_PATCH_FIELDS) {
    if (out[key] !== undefined && out[key] !== null && out[key] !== '') continue;
    if (source[key] === undefined || source[key] === null || source[key] === '') continue;
    out[key] = source[key];
  }
  if (!out.tgMessageId && source.tgMessageId) out.tgMessageId = source.tgMessageId;
  if (!out.fromTelegramSignal && source.fromTelegramSignal) out.fromTelegramSignal = true;
  if ((!Array.isArray(out.presetTags) || out.presetTags.length === 0) && Array.isArray(source.presetTags) && source.presetTags.length) {
    out.presetTags = [...source.presetTags];
  }
  if (!String(out.setup || '').trim() && String(source.setup || '').trim()) out.setup = source.setup;
  return out;
}

function buildTradePatch(rawPatch = {}) {
  const patch = {};
  if (!rawPatch || typeof rawPatch !== 'object') return patch;

  for (const key of EXEC_FIELDS) {
    if (!(key in rawPatch)) continue;
    const n = toNumber(rawPatch[key]);
    if (n != null && n >= 0) patch[key] = n;
  }

  if ('signalEntry' in rawPatch) {
    const n = toNumber(rawPatch.signalEntry);
    if (n != null && n > 0) patch.signalEntry = n;
    else if (rawPatch.signalEntry === '' || rawPatch.signalEntry === null) patch.signalEntry = null;
  }
  if ('avgEntry' in rawPatch) {
    const n = toNumber(rawPatch.avgEntry);
    if (n != null && n > 0) patch.avgEntry = n;
    else if (rawPatch.avgEntry === '' || rawPatch.avgEntry === null) patch.avgEntry = null;
  }

  if ('bias' in rawPatch) patch.bias = String(rawPatch.bias || '').trim().slice(0, 200);
  if ('obSize' in rawPatch) patch.obSize = String(rawPatch.obSize || '').trim().slice(0, 80);
  if ('timeframe' in rawPatch) patch.timeframe = String(rawPatch.timeframe || '').trim().slice(0, 16);
  if ('channel' in rawPatch) patch.channel = String(rawPatch.channel || '').trim().slice(0, 120);
  if ('comment' in rawPatch) patch.comment = String(rawPatch.comment || '').trim().slice(0, 500);

  if ('fundBias' in rawPatch) {
    const fb = String(rawPatch.fundBias || '').trim().toUpperCase();
    patch.fundBias = ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(fb) ? fb : '';
  }

  for (const key of ['vwapBand', 'hvnBand', 'trendAlign']) {
    if (!(key in rawPatch)) continue;
    const raw = String(rawPatch[key] || '').trim().toLowerCase();
    if (!raw || raw === '-') {
      patch[key] = '';
      continue;
    }
    const v = raw === 'n/a' ? 'na' : raw;
    patch[key] = v;
  }

  if ('confluence' in rawPatch) {
    const c = Number(rawPatch.confluence);
    patch.confluence = Number.isInteger(c) ? c : null;
  }
  if ('rejPct' in rawPatch) {
    const r = Number(rawPatch.rejPct);
    patch.rejPct = Number.isFinite(r) ? r : null;
  }
  if ('obWinRate' in rawPatch) {
    const w = Number(rawPatch.obWinRate);
    patch.obWinRate = Number.isFinite(w) ? w : null;
  }
  if ('top1' in rawPatch) {
    if (rawPatch.top1 === true || rawPatch.top1 === false) patch.top1 = rawPatch.top1;
    else patch.top1 = null;
  }
  if ('signalSession' in rawPatch) {
    patch.signalSession = String(rawPatch.signalSession || '').trim();
  }

  if ('symbol' in rawPatch) {
    const sym = String(rawPatch.symbol || '').trim().toUpperCase();
    if (sym) patch.symbol = sym;
  }
  if ('type' in rawPatch) {
    const t = String(rawPatch.type || '').trim().toUpperCase();
    if (t === 'BUY' || t === 'SELL') patch.type = t;
  }
  if ('obEdge' in rawPatch) {
    const n = toNumber(rawPatch.obEdge);
    if (n != null && n > 0) patch.obEdge = n;
    else if (rawPatch.obEdge === '' || rawPatch.obEdge === null) patch.obEdge = null;
  }

  return patch;
}

function cleanBrokerId(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '0') return '';
  return s;
}

function brokerIdSetFromTrade(trade = {}) {
  const ids = new Set();
  for (const raw of [trade.id, trade.mt5Ticket, trade.mt5PositionId, trade.mt5DealId]) {
    const s = cleanBrokerId(raw);
    if (s) ids.add(s);
    const m = String(raw ?? '').match(/^mt5-(.+)$/i);
    if (m?.[1]) ids.add(cleanBrokerId(m[1]));
  }
  return ids;
}

/** Resolve row index when id alone fails (merged MT5 duplicate, stale UI row, ticket alias). */
function findTradeIndexForUpdate(trades, tradeId, hint = {}) {
  if (!Array.isArray(trades) || trades.length === 0) return -1;

  const idStr = String(tradeId ?? '').trim();
  if (idStr) {
    const byId = trades.findIndex((t) => String(t?.id) === idStr);
    if (byId >= 0) return byId;
    const mt5FromId = idStr.match(/^mt5-(.+)$/i)?.[1];
    if (mt5FromId) {
      const ticket = cleanBrokerId(mt5FromId);
      if (ticket) {
        for (let i = 0; i < trades.length; i++) {
          if (brokerIdSetFromTrade(trades[i]).has(ticket)) return i;
        }
      }
    }
  }

  const hintIds = brokerIdSetFromTrade(hint);
  if (hintIds.size) {
    for (let i = 0; i < trades.length; i++) {
      const rowIds = brokerIdSetFromTrade(trades[i]);
      for (const hid of hintIds) {
        if (rowIds.has(hid)) return i;
      }
    }
  }

  const sym = String(hint.symbol || '').trim().toUpperCase();
  const type = String(hint.type || '').trim().toUpperCase();
  const openedMs = hint.openedAt ? new Date(hint.openedAt).getTime() : NaN;
  const profit = toNumber(hint.profit);
  if (sym && Number.isFinite(openedMs)) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (String(t.symbol || '').toUpperCase() !== sym) continue;
      if (type && String(t.type || '').toUpperCase() !== type) continue;
      const tMs = new Date(t.openedAt || '').getTime();
      if (!Number.isFinite(tMs)) continue;
      const diff = Math.abs(tMs - openedMs);
      if (diff > 5 * 60 * 1000) continue;
      const tProfit = toNumber(t.profit);
      if (profit != null && tProfit != null && Math.abs(tProfit - profit) > 0.02) continue;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) return bestIdx;
  }

  return -1;
}

/** Re-create a row the UI still shows after sync merged/removed it from disk. */
function buildRestoredTradeFromHint(tradeId, hint = {}) {
  if (!String(hint.symbol || '').trim()) return null;
  const ticket = cleanBrokerId(hint.mt5Ticket || hint.mt5PositionId || hint.mt5DealId);
  const id = String(tradeId ?? '').trim()
    || String(hint.id ?? '').trim()
    || (ticket ? `mt5-${ticket}` : '')
    || String(Date.now());
  return {
    ...hint,
    id,
    channel: hint.channel || 'MT5 Auto',
    journal: hint.journal && typeof hint.journal === 'object' ? hint.journal : {},
    screenshots: Array.isArray(hint.screenshots) ? hint.screenshots : [],
    presetTags: Array.isArray(hint.presetTags) ? hint.presetTags : []
  };
}

function ackTradeIdsFromAck(ack = {}) {
  return [
    ack?.trade?.tradeId,
    ack?.tradeId,
    ack?.signal?.tradeId,
    ack?.trade?.id,
    ack?.id
  ]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => String(v));
}

/** Find Telegram / user-edited row to supply OB stats when MT5 history ACK is sparse. */
function findMetadataDonorForSync(trades, ctx = {}) {
  const { symbol, type, openedAtIso, profit } = ctx;
  const symNorm = String(symbol || '').trim();
  if (!symNorm || symNorm === 'UNKNOWN') return null;
  const typeNorm = String(type || '').trim().toUpperCase();
  const openedMs = openedAtIso ? new Date(openedAtIso).getTime() : NaN;

  let best = null;
  let bestScore = 0;
  for (const t of trades) {
    const hasMeta =
      t?.fromTelegramSignal
      || t?.userEdited
      || t?.manual
      || String(t?.channel || '') === 'Manual';
    if (!hasMeta) continue;
    if (!symbolsLikelySame(t.symbol, symNorm)) continue;
    if (typeNorm && typeNorm !== 'SYNC' && String(t.type || '').toUpperCase() !== typeNorm) continue;

    let score = 0;
    if (t.fromTelegramSignal) score += 15;
    if (t.userEdited) score += 25;
    if (String(t.bias || '').trim()) score += 5;
    if (String(t.trendAlign || '').trim()) score += 3;
    if (Number(t.signalEntry) > 0) score += 5;

    const tOpened = new Date(t.openedAt || '').getTime();
    if (Number.isFinite(openedMs) && Number.isFinite(tOpened)) {
      const diffMin = Math.abs(tOpened - openedMs) / 60000;
      if (diffMin > 20) continue;
      score += Math.max(0, 80 - Math.floor(diffMin));
    } else if (!Number.isFinite(openedMs)) {
      score += 10;
    }

    const tProfit = toNumber(t.profit);
    if (profit != null && tProfit != null && Math.abs(tProfit - profit) <= Math.max(2, Math.abs(profit) * 0.08)) {
      score += 40;
    }

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 40 ? best : null;
}

/** Match sync ACK to an existing row before creating a bare MT5 Auto duplicate. */
function findSyncMergeTarget(trades, ack, ctx = {}) {
  if (!Array.isArray(trades) || !trades.length) return null;
  const { symbol, type, dealId, positionId, ticket, openedAtIso, profit } = ctx;

  for (const id of ackTradeIdsFromAck(ack)) {
    const hit = trades.find((t) => String(t?.id) === id);
    if (hit) return hit;
  }

  const brokerIds = new Set(
    [dealId, positionId, ticket].map(cleanBrokerId).filter(Boolean)
  );
  for (const t of trades) {
    const rowIds = brokerIdSetFromTrade(t);
    for (const bid of brokerIds) {
      if (rowIds.has(bid)) return t;
    }
  }

  return findMetadataDonorForSync(trades, { symbol, type, openedAtIso, profit });
}

function resolveModifyTicket(trade = {}) {
  const ticket = String(trade?.mt5PositionId || trade?.mt5Ticket || '').trim();
  if (ticket && ticket !== '0') return ticket;
  return '';
}

/** Never replace a filled price with 0 from sparse MT5 history sync. */
function applyAckExecToTrade(trade, { entry, sl, tp, lot } = {}) {
  if (!trade) return trade;
  if (entry > 0 && !(Number(trade.entry) > 0)) trade.entry = entry;
  if (sl > 0 && !(Number(trade.sl) > 0)) trade.sl = sl;
  if (tp > 0 && !(Number(trade.tp) > 0)) trade.tp = tp;
  if (lot > 0 && !(Number(trade.lot) > 0)) trade.lot = lot;
  return trade;
}

/** Renderer merge when a sparse MT5 sync update arrives for a user-edited row. */
function mergeTradeUpdatePreservingUserEdits(existing = {}, incoming = {}) {
  if (!existing?.userEdited) return { ...existing, ...incoming };
  const merged = { ...existing, ...incoming, userEdited: true };
  const keys = [
    ...EXEC_FIELDS,
    'signalEntry',
    'avgEntry',
    'obEdge',
    ...METADATA_FIELDS
  ];
  for (const key of keys) {
    const prev = existing[key];
    const next = incoming[key];
    const prevSet = prev !== undefined && prev !== null && prev !== '' && !(key in EXEC_FIELDS && Number(prev) === 0);
    const nextEmpty = next === undefined || next === null || next === '' || (key in EXEC_FIELDS && Number(next) === 0);
    if (prevSet && nextEmpty) merged[key] = prev;
  }
  return merged;
}

module.exports = {
  ALL_PATCH_FIELDS,
  buildTradePatch,
  inheritMissingTradeMetadata,
  isOpenTradeStatus,
  resolveModifyTicket,
  applyAckExecToTrade,
  mergeTradeUpdatePreservingUserEdits,
  findTradeIndexForUpdate,
  buildRestoredTradeFromHint,
  findSyncMergeTarget,
  findMetadataDonorForSync
};
