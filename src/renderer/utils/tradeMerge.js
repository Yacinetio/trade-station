const EXEC_KEYS = ['entry', 'sl', 'tp', 'lot', 'signalEntry', 'avgEntry', 'obEdge'];
const META_KEYS = [
  'bias', 'fundBias', 'vwapBand', 'hvnBand', 'trendAlign', 'obSize', 'timeframe',
  'confluence', 'rejPct', 'obWinRate', 'top1', 'signalSession', 'channel', 'comment'
];

function fieldIsSet(key, value) {
  if (value === undefined || value === null || value === '') return false;
  if (EXEC_KEYS.includes(key) && Number(value) === 0) return false;
  return true;
}

/** Keep user-saved OB stats when a sparse MT5 sync row arrives over the wire. */
export function mergeTradeUpdatePreservingUserEdits(existing = {}, incoming = {}) {
  if (!existing?.userEdited) return { ...existing, ...incoming };
  const merged = { ...existing, ...incoming, userEdited: true };
  for (const key of [...EXEC_KEYS, ...META_KEYS, 'symbol', 'type']) {
    const prev = existing[key];
    const next = incoming[key];
    if (fieldIsSet(key, prev) && !fieldIsSet(key, next)) merged[key] = prev;
  }
  return merged;
}

export function tradeIdsEqual(a, b) {
  return String(a ?? '') === String(b ?? '');
}
