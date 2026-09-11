/** Never evict manual / user-edited / Telegram signal rows when trimming in-memory trade lists. */
function isProtectedFromTradeEviction(trade) {
  if (!trade) return false;
  if (trade.manual === true) return true;
  if (trade.userEdited === true) return true;
  if (trade.fromTelegramSignal === true) return true;
  if (String(trade.channel || '') === 'Manual') return true;
  if (String(trade.accountKey || '') === 'manual') return true;
  return false;
}

function isLowPrioritySyncRow(trade) {
  const ch = String(trade?.channel || '');
  if (ch === 'MT5 Auto') return true;
  if (/^mt5-/i.test(String(trade?.id || ''))) return true;
  return false;
}

/**
 * Cap in-memory trade list without dropping manual, edited, or Telegram rows.
 * Prefer removing orphan MT5 Auto sync rows first.
 */
function trimTradesList(trades, maxLen = 200) {
  const list = Array.isArray(trades) ? trades : [];
  while (list.length > maxLen) {
    let removed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (isProtectedFromTradeEviction(list[i])) continue;
      if (!isLowPrioritySyncRow(list[i])) continue;
      list.splice(i, 1);
      removed = true;
      break;
    }
    if (!removed) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (isProtectedFromTradeEviction(list[i])) continue;
        list.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  return list;
}

module.exports = {
  isProtectedFromTradeEviction,
  trimTradesList
};
