/**
 * Checkbox / selection Sets must use a single canonical type — JSON restores ids as
 * strings while live trades may use numeric ids — so we normalize to strings.
 */
export function tradeSelectionKey(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw);
}
