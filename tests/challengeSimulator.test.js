import { describe, it, expect } from 'vitest';
const { mulberry32, simulateChallenge, riskSensitivity } = require('../src/main/challengeSimulator');
const { PRESETS } = require('../src/main/propRules');

const ACCT = 'demo';
const START = 10000;

function makeWinningTrades(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    accountKey: ACCT,
    profit: 200,
    status: 'CLOSED_TP',
    closedAt: new Date(Date.UTC(2026, 0, 2 + Math.floor(i / 3), 12, 0, 0)).toISOString()
  }));
}

function makeLosingTrades(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    accountKey: ACCT,
    profit: -300,
    status: 'CLOSED_SL',
    closedAt: new Date(Date.UTC(2026, 0, 2 + Math.floor(i / 3), 12, 0, 0)).toISOString()
  }));
}

describe('challengeSimulator', () => {
  it('is deterministic with seeded rng', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      minTradingDays: 2
    };
    const trades = makeWinningTrades(20);
    const a = simulateChallenge({ profile, trades, runs: 200, rng: mulberry32(42) });
    const b = simulateChallenge({ profile, trades, runs: 200, rng: mulberry32(42) });
    expect(a).toEqual(b);
  });

  it('all-winning distribution yields high pass rate', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      profitTargetPct: 5,
      minTradingDays: 2,
      maxDrawdownPct: 20,
      dailyLossPct: 10
    };
    const trades = makeWinningTrades(30);
    const sim = simulateChallenge({ profile, trades, runs: 300, rng: mulberry32(7) });
    expect(sim.passPct).toBe(100);
    expect(sim.bustPct).toBe(0);
  });

  it('all-losing distribution yields high bust rate', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START
    };
    const trades = makeLosingTrades(30);
    const sim = simulateChallenge({ profile, trades, runs: 300, rng: mulberry32(9) });
    expect(sim.bustPct).toBe(100);
    expect(sim.passPct).toBe(0);
  });

  it('risk sensitivity returns pass rates for each scale', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      profitTargetPct: 8,
      maxDrawdownPct: 8,
      dailyLossPct: 4,
      minTradingDays: 2
    };
    const trades = makeLosingTrades(20);
    const rows = riskSensitivity({
      profile,
      trades,
      scales: [0.5, 1, 2],
      runs: 200,
      rng: mulberry32(123)
    });
    expect(rows).toEqual([
      { scale: 0.5, passPct: expect.any(Number) },
      { scale: 1, passPct: expect.any(Number) },
      { scale: 2, passPct: expect.any(Number) }
    ]);
    expect(rows.every((r) => r.passPct >= 0 && r.passPct <= 100)).toBe(true);
  });
});
