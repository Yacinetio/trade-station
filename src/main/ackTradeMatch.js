function normalizeSymbolForMatch(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function symbolsLikelySame(a, b) {
  const na = normalizeSymbolForMatch(a);
  const nb = normalizeSymbolForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(nb) || nb.startsWith(na);
}

function getAckTradeIds(ack) {
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

function cleanBrokerId(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '0') return '';
  return s;
}

function getAckBrokerIdSet(ack) {
  const raw = [
    ack?.positionId,
    ack?.trade?.positionId,
    ack?.dealId,
    ack?.trade?.dealId,
    ack?.orderId,
    ack?.trade?.orderId,
    ack?.ticket,
    ack?.trade?.ticket
  ];
  const set = new Set();
  for (const v of raw) {
    const s = cleanBrokerId(v);
    if (s) set.add(s);
  }
  return set;
}

function filterCandidatesByAckSymbolType(candidates, ack) {
  let list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (list.length === 0) return list;

  const ackSymbol = ack?.trade?.symbol || ack?.symbol || '';
  const ackType = String(ack?.trade?.type || ack?.type || '').toUpperCase();

  if (ackSymbol) {
    const symMatch = list.filter((t) => symbolsLikelySame(t.symbol, ackSymbol));
    if (symMatch.length === 0) return [];
    list = symMatch;
  }

  if (ackType && ackType !== 'SYNC') {
    const typeMatch = list.filter((t) => String(t.type || '').toUpperCase() === ackType);
    if (typeMatch.length > 0) list = typeMatch;
  }

  return list;
}

function pickBestAckCandidate(candidates = [], ack = {}, { isAckMatchableOpenStatus }) {
  let list = filterCandidatesByAckSymbolType(candidates, ack);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  const ackTradeIds = new Set(getAckTradeIds(ack));
  const byAckId = list.filter((t) => ackTradeIds.has(String(t.id)));
  if (byAckId.length === 1) return byAckId[0];

  const brokerSet = getAckBrokerIdSet(ack);
  if (brokerSet.size > 0) {
    const byBroker = list.filter((t) => {
      if (brokerSet.has(cleanBrokerId(t.mt5Ticket))) return true;
      if (brokerSet.has(cleanBrokerId(t.mt5PositionId))) return true;
      if (brokerSet.has(cleanBrokerId(t.mt5DealId))) return true;
      return false;
    });
    if (byBroker.length > 0) {
      const tg = byBroker.filter((t) => t.fromTelegramSignal);
      const pool = tg.length > 0 ? tg : byBroker;
      if (pool.length === 1) return pool[0];
      if (pool.length > 1) {
        return [...pool].sort((a, b) => {
          const ta = new Date(a.openedAt || a.lastUpdateAt || 0).getTime();
          const tb = new Date(b.openedAt || b.lastUpdateAt || 0).getTime();
          return tb - ta;
        })[0];
      }
    }
  }

  const active = list.filter((t) => isAckMatchableOpenStatus(t.status));
  const signalActive = active.filter((t) => t.fromTelegramSignal);
  const pool = signalActive.length > 0 ? signalActive : active;
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) {
    return [...pool].sort((a, b) => {
      const ta = new Date(a.openedAt || a.lastUpdateAt || 0).getTime();
      const tb = new Date(b.openedAt || b.lastUpdateAt || 0).getTime();
      return tb - ta;
    })[0];
  }

  return null;
}

module.exports = {
  normalizeSymbolForMatch,
  symbolsLikelySame,
  filterCandidatesByAckSymbolType,
  pickBestAckCandidate
};
