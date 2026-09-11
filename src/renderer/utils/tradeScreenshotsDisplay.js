/** Order for trade screenshot strips: entry first, then risk/targets, then exit. */

const STAGE_RANK = {
  ENTRY: 0,
  PENDING: 1,
  OPEN: 2,
  SENT: 3,
  SL: 10,
  TP: 15,
  BE: 20,
  CLOSE: 30,
  EXIT: 30,
  CLOSED: 30,
  SHOT: 99
};

export function sortTradeScreenshotsForDisplay(screenshots) {
  if (!Array.isArray(screenshots)) return [];
  return [...screenshots].sort((a, b) => {
    const sa = String(a?.stage || '').toUpperCase();
    const sb = String(b?.stage || '').toUpperCase();
    const ra = STAGE_RANK[sa] ?? 50;
    const rb = STAGE_RANK[sb] ?? 50;
    if (ra !== rb) return ra - rb;
    return String(a?.capturedAt || '').localeCompare(String(b?.capturedAt || ''));
  });
}
