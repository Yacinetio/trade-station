/**
 * Strategy (playbook) analytics — pure functions over stored trades.
 *
 * No IO, no electron: everything takes plain arrays so vitest can exercise the
 * math directly. Metric conventions mirror channelScoreboard.js so numbers
 * agree across pages.
 */

function toNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isClosed(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('TP_HIT') || s.includes('SL_HIT') || !!t?.closeTime || !!t?.closedAt;
}

function closeTimeOf(t) {
  return t?.closedAt || t?.closeTime || t?.openedAt || null;
}

/** R-multiple for one trade: prefer recorded realizedR, else profit / riskUsd. */
function tradeR(t) {
  const realized = Number(t?.realizedR);
  if (Number.isFinite(realized)) return realized;
  const profit = Number(t?.profit);
  const risk = Number(t?.riskUsd);
  if (Number.isFinite(profit) && Number.isFinite(risk) && risk > 0) return profit / risk;
  return null;
}

/** Fraction (0..1) of the strategy's rules checked on this trade, or null when nothing was recorded. */
function tradeComplianceFraction(t, ruleCount) {
  const checks = t?.ruleChecks;
  if (!checks || typeof checks !== 'object') return null;
  const keys = Object.keys(checks);
  if (keys.length === 0) return null;
  const denominator = ruleCount > 0 ? ruleCount : keys.length;
  if (denominator <= 0) return null;
  const checked = keys.filter((k) => checks[k] === true).length;
  return Math.min(1, checked / denominator);
}

function round2(n) {
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function buildEquityCurve(closedTrades) {
  const sorted = [...closedTrades].sort(
    (a, b) => new Date(closeTimeOf(a) || 0) - new Date(closeTimeOf(b) || 0)
  );
  let equity = 0;
  return sorted.map((t) => {
    equity += toNumeric(t.profit);
    return { t: closeTimeOf(t), equity: round2(equity) };
  });
}

const COMPLIANCE_SPLIT = 0.8;

/**
 * Per-strategy performance rows. Strategies without trades still get a row
 * (so freshly created playbooks and missed-trade-only strategies show up).
 *
 * @param {Array} trades       stored trades (any status; closed detected internally)
 * @param {Array} strategies   strategy records from strategyStore
 * @param {Array} missedTrades missed-trade records (for missedPnlR)
 */
function computeStrategyAnalytics(trades = [], strategies = [], missedTrades = []) {
  const tradeRows = Array.isArray(trades) ? trades : [];
  const missed = Array.isArray(missedTrades) ? missedTrades : [];

  const byStrategy = new Map();
  for (const t of tradeRows) {
    const sid = t?.strategyId ? String(t.strategyId) : '';
    if (!sid) continue;
    if (!byStrategy.has(sid)) byStrategy.set(sid, []);
    byStrategy.get(sid).push(t);
  }

  const rows = [];
  for (const strat of Array.isArray(strategies) ? strategies : []) {
    if (!strat?.id) continue;
    const sid = String(strat.id);
    const items = byStrategy.get(sid) || [];
    const closed = items.filter(isClosed);

    const wins = closed.filter((t) => toNumeric(t.profit) > 0);
    const losses = closed.filter((t) => toNumeric(t.profit) < 0);
    const grossWin = wins.reduce((a, t) => a + toNumeric(t.profit), 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + toNumeric(t.profit), 0));
    const netPnl = closed.reduce((a, t) => a + toNumeric(t.profit), 0);
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
    const avgWin = wins.length ? grossWin / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;
    const expectancy = closed.length
      ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
      : 0;

    const rValues = closed.map(tradeR).filter((r) => r !== null);
    const avgR = rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;

    const ruleCount = Array.isArray(strat.rules) ? strat.rules.length : 0;
    const fractions = items
      .map((t) => tradeComplianceFraction(t, ruleCount))
      .filter((f) => f !== null);
    const compliancePct = fractions.length
      ? (fractions.reduce((a, b) => a + b, 0) / fractions.length) * 100
      : null;

    // Avg P&L when the plan was mostly followed (≥80% rules checked) vs not.
    const highBucket = [];
    const lowBucket = [];
    for (const t of closed) {
      const f = tradeComplianceFraction(t, ruleCount);
      if (f === null) continue;
      (f >= COMPLIANCE_SPLIT ? highBucket : lowBucket).push(toNumeric(t.profit));
    }
    const complianceVsPnl = {
      highCount: highBucket.length,
      highAvgPnl: highBucket.length
        ? round2(highBucket.reduce((a, b) => a + b, 0) / highBucket.length)
        : null,
      lowCount: lowBucket.length,
      lowAvgPnl: lowBucket.length
        ? round2(lowBucket.reduce((a, b) => a + b, 0) / lowBucket.length)
        : null
    };

    const missedPnlR = missed
      .filter((m) => String(m?.strategyId || '') === sid && m?.simulated)
      .reduce((a, m) => a + toNumeric(m.simulated.pnlR), 0);

    rows.push({
      strategyId: sid,
      name: strat.name || 'Untitled strategy',
      color: strat.color || '#6c8cff',
      archived: !!strat.archived,
      ruleCount,
      tradeCount: items.length,
      closedCount: closed.length,
      winRate: round2(winRate),
      netPnl: round2(netPnl),
      avgWin: round2(avgWin),
      avgLoss: round2(avgLoss),
      profitFactor: profitFactor === null ? null : round2(profitFactor),
      expectancy: round2(expectancy),
      avgR: avgR === null ? null : round2(avgR),
      compliancePct: compliancePct === null ? null : round2(compliancePct),
      complianceVsPnl,
      equityCurve: buildEquityCurve(closed),
      missedPnlR: round2(missedPnlR)
    });
  }

  rows.sort((a, b) => (b.netPnl ?? 0) - (a.netPnl ?? 0));
  return rows;
}

function tradeTagsLower(trade) {
  const tags = []
    .concat(Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [])
    .concat(Array.isArray(trade?.presetTags) ? trade.presetTags : []);
  return new Set(tags.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean));
}

/**
 * Dollar cost of mistakes: for every tag categorized as a mistake, aggregate
 * the closed trades carrying that tag.
 *
 * @param {Array}  trades        stored trades
 * @param {object} tagCategories settings.tagCategories ({ mistakes: [], emotions: [] })
 * @returns Array<{ tag, count, totalPnl, avgR }> sorted most-costly first
 */
function mistakeEconomics(trades = [], tagCategories = {}) {
  const mistakeTags = Array.isArray(tagCategories?.mistakes) ? tagCategories.mistakes : [];
  const tradeRows = Array.isArray(trades) ? trades : [];
  const out = [];

  for (const rawTag of mistakeTags) {
    const tag = String(rawTag ?? '').trim().toLowerCase();
    if (!tag) continue;
    const tagged = tradeRows.filter((t) => tradeTagsLower(t).has(tag));
    const closed = tagged.filter(isClosed);
    const totalPnl = closed.reduce((a, t) => a + toNumeric(t.profit), 0);
    const rValues = closed.map(tradeR).filter((r) => r !== null);
    out.push({
      tag,
      count: tagged.length,
      closedCount: closed.length,
      totalPnl: round2(totalPnl),
      avgR: rValues.length
        ? round2(rValues.reduce((a, b) => a + b, 0) / rValues.length)
        : null
    });
  }

  out.sort((a, b) => (a.totalPnl ?? 0) - (b.totalPnl ?? 0));
  return out;
}

module.exports = {
  computeStrategyAnalytics,
  mistakeEconomics,
  tradeR,
  tradeComplianceFraction,
  buildEquityCurve
};
