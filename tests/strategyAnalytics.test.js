import { describe, it, expect } from 'vitest';

const {
  computeStrategyAnalytics,
  mistakeEconomics,
  tradeR,
  tradeComplianceFraction,
  buildEquityCurve
} = require('../src/main/strategyAnalytics');

const STRAT = {
  id: 's1',
  name: 'Playbook One',
  color: '#123456',
  rules: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }],
  archived: false
};

function closedTrade(over = {}) {
  return {
    id: over.id || Math.random().toString(36),
    status: 'CLOSED',
    strategyId: 's1',
    profit: 0,
    closedAt: '2026-01-01T10:00:00.000Z',
    ...over
  };
}

describe('strategyAnalytics helpers', () => {
  it('tradeR prefers realizedR, falls back to profit/riskUsd, else null', () => {
    expect(tradeR({ realizedR: 2.5, profit: 100, riskUsd: 10 })).toBe(2.5);
    expect(tradeR({ profit: 100, riskUsd: 50 })).toBe(2);
    expect(tradeR({ profit: 100, riskUsd: 0 })).toBeNull();
    expect(tradeR({ profit: 100 })).toBeNull();
  });

  it('tradeComplianceFraction uses the strategy rule count as denominator', () => {
    expect(tradeComplianceFraction({ ruleChecks: { r1: true, r2: false } }, 2)).toBe(0.5);
    expect(tradeComplianceFraction({ ruleChecks: { r1: true } }, 4)).toBe(0.25);
    expect(tradeComplianceFraction({ ruleChecks: {} }, 2)).toBeNull();
    expect(tradeComplianceFraction({}, 2)).toBeNull();
  });

  it('buildEquityCurve accumulates chronologically', () => {
    const curve = buildEquityCurve([
      closedTrade({ profit: -50, closedAt: '2026-01-02T00:00:00.000Z' }),
      closedTrade({ profit: 100, closedAt: '2026-01-01T00:00:00.000Z' })
    ]);
    expect(curve.map((p) => p.equity)).toEqual([100, 50]);
  });
});

describe('computeStrategyAnalytics', () => {
  it('computes core metrics on fixture trades', () => {
    const trades = [
      closedTrade({ profit: 100, realizedR: 2 }),
      closedTrade({ profit: 200, riskUsd: 100 }), // R = 2
      closedTrade({ profit: -100, realizedR: -1 }),
      closedTrade({ profit: -50, realizedR: -1 }),
      { id: 'open1', status: 'OPEN', strategyId: 's1', profit: 0 }, // not closed → counted in tradeCount only
      closedTrade({ id: 'other', strategyId: 'other-strat', profit: 999 }) // different strategy
    ];
    const [row] = computeStrategyAnalytics(trades, [STRAT], []);

    expect(row.strategyId).toBe('s1');
    expect(row.tradeCount).toBe(5);
    expect(row.closedCount).toBe(4);
    expect(row.winRate).toBe(50);
    expect(row.netPnl).toBe(150);
    expect(row.avgWin).toBe(150);   // (100+200)/2
    expect(row.avgLoss).toBe(75);   // (100+50)/2
    expect(row.profitFactor).toBe(2); // 300/150
    expect(row.expectancy).toBe(37.5); // 0.5*150 - 0.5*75
    expect(row.avgR).toBe(0.5);     // (2+2-1-1)/4
    expect(row.equityCurve).toHaveLength(4);
    expect(row.equityCurve[3].equity).toBe(150);
  });

  it('returns a row (with zeros/nulls) for strategies without trades', () => {
    const [row] = computeStrategyAnalytics([], [STRAT], []);
    expect(row.tradeCount).toBe(0);
    expect(row.winRate).toBe(0);
    expect(row.netPnl).toBe(0);
    expect(row.profitFactor).toBeNull();
    expect(row.avgR).toBeNull();
    expect(row.compliancePct).toBeNull();
    expect(row.equityCurve).toEqual([]);
  });

  it('computes compliancePct and complianceVsPnl buckets', () => {
    const trades = [
      // 100% compliant winner
      closedTrade({ profit: 100, ruleChecks: { r1: true, r2: true } }),
      // 50% compliant loser
      closedTrade({ profit: -80, ruleChecks: { r1: true, r2: false } }),
      // no checks recorded — excluded from compliance stats
      closedTrade({ profit: 10 })
    ];
    const [row] = computeStrategyAnalytics(trades, [STRAT], []);
    expect(row.compliancePct).toBe(75); // avg of 100% and 50%
    expect(row.complianceVsPnl.highCount).toBe(1);
    expect(row.complianceVsPnl.highAvgPnl).toBe(100);
    expect(row.complianceVsPnl.lowCount).toBe(1);
    expect(row.complianceVsPnl.lowAvgPnl).toBe(-80);
  });

  it('sums simulated missed-trade R per strategy', () => {
    const missed = [
      { id: 'm1', strategyId: 's1', simulated: { outcome: 'TP', pnlR: 2 } },
      { id: 'm2', strategyId: 's1', simulated: { outcome: 'SL', pnlR: -1 } },
      { id: 'm3', strategyId: 's1', simulated: null },          // not simulated → ignored
      { id: 'm4', strategyId: 'zzz', simulated: { pnlR: 50 } }  // other strategy → ignored
    ];
    const [row] = computeStrategyAnalytics([], [STRAT], missed);
    expect(row.missedPnlR).toBe(1);
  });

  it('sorts rows by net P&L descending', () => {
    const s2 = { ...STRAT, id: 's2', name: 'Two' };
    const trades = [
      closedTrade({ strategyId: 's1', profit: 10 }),
      closedTrade({ strategyId: 's2', profit: 500 })
    ];
    const rows = computeStrategyAnalytics(trades, [STRAT, s2], []);
    expect(rows.map((r) => r.strategyId)).toEqual(['s2', 's1']);
  });
});

describe('mistakeEconomics', () => {
  const tagCategories = { mistakes: ['fomo', 'revenge', 'no-sl'], emotions: [] };

  it('aggregates count, totalPnl, and avgR per mistake tag (journal tags + presetTags, case-insensitive)', () => {
    const trades = [
      closedTrade({ profit: -120, realizedR: -1.2, journal: { tags: ['FOMO'] } }),
      closedTrade({ profit: -80, realizedR: -0.8, presetTags: ['fomo'] }),
      closedTrade({ profit: 40, realizedR: 0.4, journal: { tags: ['revenge'] } }),
      closedTrade({ profit: 999, journal: { tags: ['clean-setup'] } }) // not a mistake tag
    ];
    const rows = mistakeEconomics(trades, tagCategories);
    expect(rows).toHaveLength(3);

    const fomo = rows.find((r) => r.tag === 'fomo');
    expect(fomo.count).toBe(2);
    expect(fomo.totalPnl).toBe(-200);
    expect(fomo.avgR).toBe(-1);

    const revenge = rows.find((r) => r.tag === 'revenge');
    expect(revenge.count).toBe(1);
    expect(revenge.totalPnl).toBe(40);

    const noSl = rows.find((r) => r.tag === 'no-sl');
    expect(noSl.count).toBe(0);
    expect(noSl.totalPnl).toBe(0);
    expect(noSl.avgR).toBeNull();
  });

  it('sorts most costly first and handles empty inputs', () => {
    const trades = [
      closedTrade({ profit: -500, journal: { tags: ['revenge'] } }),
      closedTrade({ profit: -10, journal: { tags: ['fomo'] } })
    ];
    const rows = mistakeEconomics(trades, tagCategories);
    expect(rows[0].tag).toBe('revenge');
    expect(mistakeEconomics([], {})).toEqual([]);
    expect(mistakeEconomics([], { mistakes: null })).toEqual([]);
  });

  it('open trades count toward tag count but not P&L', () => {
    const trades = [
      { id: 'o1', status: 'OPEN', profit: 0, journal: { tags: ['fomo'] } },
      closedTrade({ profit: -60, journal: { tags: ['fomo'] } })
    ];
    const rows = mistakeEconomics(trades, tagCategories);
    const fomo = rows.find((r) => r.tag === 'fomo');
    expect(fomo.count).toBe(2);
    expect(fomo.closedCount).toBe(1);
    expect(fomo.totalPnl).toBe(-60);
  });
});
