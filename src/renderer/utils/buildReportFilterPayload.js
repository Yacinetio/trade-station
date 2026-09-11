/** Build reportEngine filter payload from app-wide shared filter state. */
export function buildReportFilterPayload({
  tradeFilters = {},
  selectedAccountKeys = [],
  timeScope = 'ALL',
  analyticsCustomRange = null,
  breakEvenAmount = 50
} = {}) {
  return {
    tradeFilters,
    accountKeys: Array.isArray(selectedAccountKeys) ? selectedAccountKeys.filter(Boolean) : [],
    timeScope: String(timeScope || 'ALL').toUpperCase(),
    scopeFrom: analyticsCustomRange?.from || '',
    scopeTo: analyticsCustomRange?.to || '',
    breakEvenAmount: Math.max(0, Number(breakEvenAmount) || 50)
  };
}
