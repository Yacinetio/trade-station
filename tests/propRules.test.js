import { describe, it, expect } from 'vitest';
const {
  PRESETS,
  evaluateProfile,
  violationHistory,
  utcDateKey
} = require('../src/main/propRules');

const START = 10000;
const ACCT = 'demo';

function makeTrade({ id, profit, closedAt, status = 'CLOSED_TP' }) {
  return {
    id,
    accountKey: ACCT,
    symbol: 'EURUSD',
    type: 'BUY',
    profit,
    status,
    closedAt
  };
}

describe('propRules.evaluateProfile', () => {
  it('computes static max drawdown from starting balance', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      trailingDrawdown: false
    };
    const trades = [
      makeTrade({ id: '1', profit: 500, closedAt: '2026-01-02T12:00:00.000Z' }),
      makeTrade({ id: '2', profit: -1600, closedAt: '2026-01-03T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    expect(r.maxDrawdownPctObserved).toBe(11);
    expect(r.ddBreached).toBe(true);
    expect(r.status).toBe('failed');
  });

  it('computes trailing drawdown from high-water mark', () => {
    const profile = {
      ...PRESETS.topstep,
      accountKey: ACCT,
      startingBalance: START,
      trailingDrawdown: true,
      maxDrawdownPct: 4
    };
    const trades = [
      makeTrade({ id: '1', profit: 2000, closedAt: '2026-01-02T12:00:00.000Z' }),
      makeTrade({ id: '2', profit: -600, closedAt: '2026-01-03T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    // peak 12000, equity 11400 → dd 5%
    expect(r.maxDrawdownPctObserved).toBe(5);
    expect(r.ddBreached).toBe(true);
  });

  it('flags daily loss breach', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      dailyLossPct: 5
    };
    const trades = [
      makeTrade({ id: '1', profit: -600, closedAt: '2026-01-02T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    expect(r.dailyLossBreached).toBe(true);
    expect(r.worstDailyLossPct).toBeGreaterThan(5);
    expect(r.failReasons.some((x) => /daily loss/i.test(x))).toBe(true);
  });

  it('enforces consistency rule when configured', () => {
    const profile = {
      ...PRESETS.custom,
      accountKey: ACCT,
      startingBalance: START,
      consistencyRulePct: 40,
      profitTargetPct: 10,
      minTradingDays: 1
    };
    const trades = [
      makeTrade({ id: '1', profit: 900, closedAt: '2026-01-02T12:00:00.000Z' }),
      makeTrade({ id: '2', profit: 100, closedAt: '2026-01-03T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    expect(r.consistencyOk).toBe(false);
    expect(r.biggestDayPct).toBe(90);
    expect(r.status).toBe('failed');
  });

  it('requires min trading days for passed status', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      minTradingDays: 4
    };
    const trades = [
      makeTrade({ id: '1', profit: 1200, closedAt: '2026-01-02T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    expect(r.netPnlPct).toBeGreaterThanOrEqual(10);
    expect(r.minDaysMet).toBe(false);
    expect(r.status).toBe('in-progress');
  });

  it('marks passed when target and min days met without breaches', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      minTradingDays: 2
    };
    const trades = [
      makeTrade({ id: '1', profit: 300, closedAt: '2026-01-02T12:00:00.000Z' }),
      makeTrade({ id: '2', profit: 300, closedAt: '2026-01-03T12:00:00.000Z' }),
      makeTrade({ id: '3', profit: 400, closedAt: '2026-01-04T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    expect(r.status).toBe('passed');
    expect(r.minDaysMet).toBe(true);
  });

  it('reports distance to daily and drawdown violations', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START
    };
    const nowMs = new Date('2026-01-05T15:00:00.000Z').getTime();
    const trades = [
      makeTrade({ id: '1', profit: 200, closedAt: '2026-01-05T10:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades, nowMs);
    expect(r.distanceToDailyViolationUsd).toBeGreaterThan(0);
    expect(r.distanceToDdViolationUsd).toBeGreaterThan(0);
  });

  it('computes projected days to target from recent active days', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      profitTargetPct: 10,
      minTradingDays: 1
    };
    const trades = [
      makeTrade({ id: '1', profit: 100, closedAt: '2026-01-02T12:00:00.000Z' }),
      makeTrade({ id: '2', profit: 100, closedAt: '2026-01-03T12:00:00.000Z' })
    ];
    const r = evaluateProfile(profile, trades);
    expect(r.projectedDaysToTarget).toBeGreaterThan(0);
  });
});

describe('propRules.violationHistory', () => {
  it('records daily loss and drawdown breach events', () => {
    const profile = {
      ...PRESETS['ftmo-challenge'],
      accountKey: ACCT,
      startingBalance: START,
      trailingDrawdown: false
    };
    const trades = [
      makeTrade({ id: '1', profit: -600, closedAt: '2026-01-02T12:00:00.000Z' }),
      makeTrade({ id: '2', profit: -600, closedAt: '2026-01-03T12:00:00.000Z' })
    ];
    const events = violationHistory(profile, trades);
    expect(events.some((e) => e.rule === 'dailyLoss')).toBe(true);
    expect(events.some((e) => e.rule === 'maxDrawdown')).toBe(true);
  });
});

describe('propRules.utcDateKey', () => {
  it('uses UTC calendar day', () => {
    expect(utcDateKey(Date.parse('2026-01-02T23:30:00.000Z'))).toBe('2026-01-02');
  });
});
