const { isClosedTrade } = require('./analyticsService');

function tradeCloseMs(trade) {
  for (const raw of [trade?.closedAt, trade?.closeTime, trade?.lastUpdateAt]) {
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

function isLiveInApp(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.includes('BLOCKED')) return false;
  return !isClosedTrade(trade) && s !== 'PENDING';
}

/**
 * Compare stored trades vs optional MT5 snapshot for drift.
 * Does not mutate data.
 */
function runDataIntegrityAudit(trades = [], accountSnapshot = {}) {
  const issues = [];
  const list = Array.isArray(trades) ? trades : [];

  const liveInApp = list.filter(isLiveInApp);
  const staleLive = liveInApp.filter((t) => {
    const ms = tradeCloseMs(t);
    if (!Number.isFinite(ms)) return false;
    const ageDays = (Date.now() - ms) / (86400000);
    return ageDays > 14;
  });

  if (staleLive.length > 0) {
    issues.push({
      severity: 'warn',
      code: 'STALE_LIVE',
      message: `${staleLive.length} trade(s) marked live but last update > 14 days ago`,
      tradeIds: staleLive.slice(0, 20).map((t) => t.id),
    });
  }

  const missingProfit = list.filter((t) => isClosedTrade(t) && !Number.isFinite(Number(t.profit)));
  if (missingProfit.length > 0) {
    issues.push({
      severity: 'info',
      code: 'MISSING_PNL',
      message: `${missingProfit.length} closed trade(s) missing profit value`,
      tradeIds: missingProfit.slice(0, 20).map((t) => t.id),
    });
  }

  const dupTickets = new Map();
  for (const t of list) {
    const ticket = t?.ticket != null ? String(t.ticket) : '';
    if (!ticket) continue;
    const key = `${t.accountKey || t.accountId || 'default'}:${ticket}`;
    dupTickets.set(key, (dupTickets.get(key) || 0) + 1);
  }
  const dupes = [...dupTickets.entries()].filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    issues.push({
      severity: 'warn',
      code: 'DUPLICATE_TICKET',
      message: `${dupes.length} duplicate ticket reference(s) in store`,
      samples: dupes.slice(0, 10).map(([k, c]) => ({ key: k, count: c })),
    });
  }

  if (accountSnapshot && Number.isFinite(Number(accountSnapshot.equity))) {
    issues.push({
      severity: 'info',
      code: 'SNAPSHOT_OK',
      message: `Latest MT5 equity: ${Number(accountSnapshot.equity).toFixed(2)}`,
    });
  } else {
    issues.push({
      severity: 'info',
      code: 'NO_SNAPSHOT',
      message: 'No MT5 account snapshot — connect bridge for live equity check',
    });
  }

  return {
    auditedAt: new Date().toISOString(),
    tradeCount: list.length,
    liveCount: liveInApp.length,
    closedCount: list.filter(isClosedTrade).length,
    issueCount: issues.filter((i) => i.severity !== 'info' || i.code !== 'SNAPSHOT_OK').length,
    issues,
  };
}

module.exports = { runDataIntegrityAudit };
