/** Manual / user-entered rows use accountKey "manual" or channel "Manual" — always visible unless channel filter excludes them. */
export function isManualEntryTrade(trade) {
  if (!trade) return false;
  if (trade.manual === true) return true;
  if (String(trade.channel || '') === 'Manual') return true;
  if (String(trade.origin || '').toUpperCase() === 'MANUAL' && String(trade.channel || '') === 'Manual') return true;
  return String(trade.accountKey || '') === 'manual';
}

/** True when trade belongs in the current account picker scope. */
export function tradeMatchesAccountScope(trade, effectiveAccountKeys = []) {
  const keys = Array.isArray(effectiveAccountKeys) ? effectiveAccountKeys.filter(Boolean) : [];
  if (keys.length === 0) return true;
  if (trade?.userEdited === true) return true;
  if (isManualEntryTrade(trade)) return true;
  return keys.includes(trade?.accountKey || 'unknown');
}

export function effectiveAccountKeysForScope(selectedAccountKeys) {
  return Array.isArray(selectedAccountKeys) ? selectedAccountKeys.filter(Boolean) : [];
}
