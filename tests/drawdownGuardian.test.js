import { describe, it, expect } from 'vitest';
const drawdownGuardian = require('../src/main/drawdownGuardian');

function makeMemoryStore() {
  const map = new Map();
  return {
    get: (k, fb) => (map.has(k) ? map.get(k) : fb),
    set: (k, v) => { map.set(k, v); },
    delete: (k) => map.delete(k)
  };
}

describe('drawdownGuardian.evaluateGuard', () => {
  it('does not halt when guard is disabled', () => {
    const store = makeMemoryStore();
    const r = drawdownGuardian.evaluateGuard({
      store,
      settings: { enableDrawdownGuard: false },
      accountKey: 'acct-1',
      accountSnapshot: { balance: 10000, equity: 9500, time: new Date().toISOString() },
      todayClosedPnl: -500
    });
    expect(r.halted).toBe(false);
  });

  it('halts on max absolute daily loss', () => {
    const store = makeMemoryStore();
    const r = drawdownGuardian.evaluateGuard({
      store,
      settings: { enableDrawdownGuard: true, maxAbsoluteDailyLoss: 100 },
      accountKey: 'acct-1',
      accountSnapshot: { balance: 10000, equity: 9800, time: new Date().toISOString() },
      todayClosedPnl: -150
    });
    expect(r.halted).toBe(true);
    expect(r.reason).toMatch(/100/);
  });

  it('halts on peak-to-equity drawdown threshold', () => {
    const store = makeMemoryStore();
    drawdownGuardian.recordEquitySample(store, 'acct-1', { balance: 10000, equity: 10500 });
    const r = drawdownGuardian.evaluateGuard({
      store,
      settings: { enableDrawdownGuard: true, maxPeakDrawdownPct: 3 },
      accountKey: 'acct-1',
      accountSnapshot: { balance: 10000, equity: 10000, time: new Date().toISOString() },
      todayClosedPnl: 0
    });
    expect(r.halted).toBe(true);
  });

  it('clearHalt clears the halt flag', () => {
    const store = makeMemoryStore();
    drawdownGuardian.evaluateGuard({
      store,
      settings: { enableDrawdownGuard: true, maxAbsoluteDailyLoss: 50 },
      accountKey: 'acct-1',
      accountSnapshot: { balance: 10000, equity: 9000, time: new Date().toISOString() },
      todayClosedPnl: -300
    });
    drawdownGuardian.clearHalt(store, 'acct-1');
    const status = drawdownGuardian.getStatus(store, 'acct-1');
    expect(status?.halted).toBe(false);
  });
});

describe('drawdownGuardian.resolveDrawdownTier', () => {
  const tierSettings = {
    enableTieredDrawdown: true,
    ddTierYellowPct: 2,
    ddTierOrangePct: 3,
    ddTierRedPct: 5,
    ddTierYellowLotFactor: 0.5,
    ddTierOrangeLotFactor: 0.25
  };

  it('returns none below yellow threshold', () => {
    const r = drawdownGuardian.resolveDrawdownTier({ settings: tierSettings, lossPct: 1.5 });
    expect(r.tier).toBe('none');
    expect(r.lotFactor).toBe(1);
    expect(r.shouldHalt).toBe(false);
  });

  it('returns yellow with half lot factor', () => {
    const r = drawdownGuardian.resolveDrawdownTier({ settings: tierSettings, lossPct: 2.5 });
    expect(r.tier).toBe('yellow');
    expect(r.lotFactor).toBe(0.5);
  });

  it('returns orange with quarter lot factor', () => {
    const r = drawdownGuardian.resolveDrawdownTier({ settings: tierSettings, lossPct: 3.5 });
    expect(r.tier).toBe('orange');
    expect(r.lotFactor).toBe(0.25);
  });

  it('returns red halt at red threshold', () => {
    const r = drawdownGuardian.resolveDrawdownTier({ settings: tierSettings, lossPct: 5.1 });
    expect(r.tier).toBe('red');
    expect(r.lotFactor).toBe(0);
    expect(r.shouldHalt).toBe(true);
  });
});

describe('drawdownGuardian.computeDailyLossMetrics', () => {
  it('uses equity basis when snapshot is fresh', () => {
    const store = makeMemoryStore();
    const snap = { balance: 10000, equity: 9700, time: new Date().toISOString() };
    drawdownGuardian.recordEquitySample(store, 'acct-1', { balance: 10000, equity: 10000 });
    const m = drawdownGuardian.computeDailyLossMetrics({
      settings: { dailyLossBasis: 'equity' },
      store,
      accountKey: 'acct-1',
      accountSnapshot: snap,
      todayClosedPnl: 0
    });
    expect(m.basis).toBe('equity');
    expect(m.lossUsd).toBeCloseTo(300, 0);
    expect(m.lossPct).toBeCloseTo(3, 1);
  });

  it('falls back to realized when equity snapshot is stale', () => {
    const store = makeMemoryStore();
    const stale = new Date(Date.now() - 120000).toISOString();
    drawdownGuardian.recordEquitySample(store, 'acct-1', { balance: 10000, equity: 10000 });
    const m = drawdownGuardian.computeDailyLossMetrics({
      settings: { dailyLossBasis: 'equity' },
      store,
      accountKey: 'acct-1',
      accountSnapshot: { balance: 10000, equity: 8000, time: stale },
      todayClosedPnl: -200
    });
    expect(m.staleFallback).toBe(true);
    expect(m.basis).toBe('realized');
    expect(m.lossUsd).toBe(200);
  });
});

describe('drawdownGuardian.applyTierLotReduction', () => {
  it('reduces lot at orange tier', () => {
    const store = makeMemoryStore();
    drawdownGuardian.recordEquitySample(store, 'acct-1', { balance: 10000, equity: 10000 });
    const signal = { lot: 1.0, symbol: 'EURUSD' };
    const { signal: out, ddTierApplied } = drawdownGuardian.applyTierLotReduction(signal, {
      store,
      settings: {
        enableDrawdownGuard: true,
        enableTieredDrawdown: true,
        ddTierYellowPct: 2,
        ddTierOrangePct: 3,
        ddTierRedPct: 5,
        ddTierOrangeLotFactor: 0.25,
        dailyLossBasis: 'equity'
      },
      accountKey: 'acct-1',
      accountSnapshot: { balance: 10000, equity: 9650, time: new Date().toISOString() },
      todayClosedPnl: 0
    });
    expect(ddTierApplied).toBe('orange');
    expect(out.lot).toBe(0.25);
  });
});
