import { describe, it, expect } from 'vitest';
const { evaluateExecutionGuards } = require('../src/main/executionGuards');

const helpers = { priceDistancePips: () => 100 };

describe('evaluateExecutionGuards', () => {
  it('blocks signals with missing SL when default flag is on', () => {
    const r = evaluateExecutionGuards({
      settings: { blockInvalidOrMissingStopLoss: true },
      signal: { type: 'BUY', symbol: 'EURUSD', entry: 1.1, sl: 0, tp: [1.11] },
      trades: [],
      helpers
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BLOCKED_INVALID_SL');
  });

  it('allows BUY with SL strictly below entry', () => {
    const r = evaluateExecutionGuards({
      settings: { blockInvalidOrMissingStopLoss: true },
      signal: { type: 'BUY', symbol: 'EURUSD', entry: 1.1, sl: 1.095, tp: [1.11] },
      trades: [],
      helpers
    });
    expect(r.allowed).toBe(true);
  });

  it('blocks BUY with SL above entry (wrong-side SL)', () => {
    const r = evaluateExecutionGuards({
      settings: { blockInvalidOrMissingStopLoss: true },
      signal: { type: 'BUY', symbol: 'EURUSD', entry: 1.1, sl: 1.11, tp: [1.12] },
      trades: [],
      helpers
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BLOCKED_INVALID_SL');
  });

  it('respects spread cap', () => {
    const r = evaluateExecutionGuards({
      settings: { blockInvalidOrMissingStopLoss: true, maxSpreadPips: 5 },
      signal: { type: 'BUY', symbol: 'EURUSD', entry: 1.1, sl: 1.095, tp: [1.11], spreadPips: 8 },
      trades: [],
      helpers
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BLOCKED_SPREAD');
  });

  it('blocks opposing direction on correlated US indices when enabled', () => {
    const r = evaluateExecutionGuards({
      settings: {
        blockInvalidOrMissingStopLoss: false,
        enableBlockCorrelatedOpposite: true,
        correlationGroups: [['US100', 'US30', 'US500']]
      },
      signal: { type: 'SELL', symbol: 'US30.cash', entry: 39000, sl: 39100, tp: [38900] },
      trades: [{
        id: '1',
        symbol: 'US100.cash',
        type: 'BUY',
        status: 'SENT',
        accountKey: 'acc1'
      }],
      accountKey: 'acc1',
      helpers
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BLOCKED_CORRELATED_PAIR');
  });

  it('caps daily trade count', () => {
    const today = new Date().toISOString();
    const trades = Array.from({ length: 5 }).map((_, i) => ({ id: i, openedAt: today, status: 'SENT' }));
    const r = evaluateExecutionGuards({
      settings: { blockInvalidOrMissingStopLoss: true, maxDailyTrades: 3 },
      signal: { type: 'BUY', symbol: 'EURUSD', entry: 1.1, sl: 1.095, tp: [1.11] },
      trades,
      helpers
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BLOCKED_DAILY_TRADES');
  });

  it('blocks on equity-basis daily loss when floating drawdown exceeds cap', () => {
    const map = new Map();
    const store = {
      get: (k, fb) => (map.has(k) ? map.get(k) : fb),
      set: (k, v) => map.set(k, v)
    };
    const drawdownGuardian = require('../src/main/drawdownGuardian');
    drawdownGuardian.recordEquitySample(store, 'acc1', { balance: 10000, equity: 10000 });
    const r = evaluateExecutionGuards({
      settings: {
        blockInvalidOrMissingStopLoss: true,
        enableDailyLoss: true,
        maxDailyLossPct: 2,
        dailyLossBasis: 'equity'
      },
      signal: { type: 'BUY', symbol: 'EURUSD', entry: 1.1, sl: 1.095, tp: [1.11] },
      trades: [],
      accountSnapshot: { balance: 10000, equity: 9700, time: new Date().toISOString() },
      accountKey: 'acc1',
      store,
      helpers
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BLOCKED_DAILY_LOSS_PCT');
  });
});
