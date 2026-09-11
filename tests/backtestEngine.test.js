import { describe, it, expect } from 'vitest';
import {
  createEngineState,
  placeOrder,
  advanceBar,
  closePosition,
  modifyPosition,
  drainClosedTrades
} from '../src/shared/backtestEngine.js';

const PIP = 0.0001;

function bar(time, o, h, l, c) {
  return { time, open: o, high: h, low: l, close: c };
}

describe('backtestEngine', () => {
  it('market BUY fill applies spread padding', () => {
    const state = createEngineState({ startingBalance: 100000, spreadPips: 2, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1002, 1.0998, 1.1));
    placeOrder(state, {
      kind: 'market',
      side: 'BUY',
      lots: 0.1,
      slPips: 20,
      tpPips: 40
    });
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].entryPrice).toBeCloseTo(1.1 + 2 * PIP, 6);
  });

  it('limit order fills when bar range touches price', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.101, 1.102, 1.099, 1.101));
    placeOrder(state, {
      kind: 'limit',
      side: 'BUY',
      price: 1.1,
      lots: 0.1,
      slPips: 10,
      tpPips: 20
    });
    advanceBar(state, bar(1060, 1.101, 1.1015, 1.0995, 1.1005));
    expect(state.positions).toHaveLength(1);
    expect(state.pendingOrders).toHaveLength(0);
  });

  it('stop order stop-through-open fills at open (conservative)', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.105, 1.106, 1.104, 1.105));
    placeOrder(state, {
      kind: 'stop',
      side: 'BUY',
      price: 1.102,
      lots: 0.1,
      slPips: 50,
      tpPips: 80
    });
    advanceBar(state, bar(1060, 1.103, 1.104, 1.101, 1.103));
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].entryPrice).toBeGreaterThan(1.102);
  });

  it('hits TP on favorable bar', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, { kind: 'market', side: 'BUY', lots: 0.1, slPips: 10, tpPips: 20 });
    const entry = state.positions[0].entryPrice;
    advanceBar(state, bar(1060, entry, entry + 30 * PIP, entry - 5 * PIP, entry + 25 * PIP));
    const closed = drainClosedTrades(state);
    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('CLOSED_TP');
    expect(closed[0].profit).toBeGreaterThan(0);
  });

  it('hits SL on adverse bar', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, { kind: 'market', side: 'BUY', lots: 0.1, slPips: 10, tpPips: 30 });
    const entry = state.positions[0].entryPrice;
    advanceBar(state, bar(1060, entry, entry + 5 * PIP, entry - 15 * PIP, entry - 12 * PIP));
    const closed = drainClosedTrades(state);
    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('CLOSED_SL');
    expect(closed[0].profit).toBeLessThan(0);
  });

  it('same-bar SL wins when both SL and TP touched', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, { kind: 'market', side: 'BUY', lots: 0.1, slPips: 10, tpPips: 10 });
    const entry = state.positions[0].entryPrice;
    advanceBar(state, bar(1060, entry, entry + 20 * PIP, entry - 20 * PIP, entry));
    const closed = drainClosedTrades(state);
    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('CLOSED_SL');
  });

  it('auto breakeven trigger then exits at BE', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, {
      kind: 'market',
      side: 'BUY',
      lots: 0.1,
      slPips: 10,
      tpPips: 50,
      autoBreakevenAtR: 1
    });
    const entry = state.positions[0].entryPrice;
    advanceBar(state, bar(1060, entry, entry + 12 * PIP, entry + 1 * PIP, entry + 10 * PIP));
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].beTriggered).toBe(true);
    expect(state.positions[0].slPrice).toBeCloseTo(entry, 6);
    advanceBar(state, bar(1120, entry + 1 * PIP, entry + 2 * PIP, entry - 1 * PIP, entry));
    const closed = drainClosedTrades(state);
    expect(closed).toHaveLength(1);
    expect(Math.abs(closed[0].profit)).toBeLessThan(5);
  });

  it('partial close fractions keep remaining position math', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, { kind: 'market', side: 'BUY', lots: 0.4, slPips: 10, tpPips: 30 });
    const posId = state.positions[0].id;
    closePosition(state, posId, { fraction: 0.5, atPrice: 1.101 });
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].remainingLots).toBeCloseTo(0.2, 2);
    const closed = drainClosedTrades(state);
    expect(closed).toHaveLength(1);
    expect(closed[0].lot).toBeCloseTo(0.2, 2);
  });

  it('riskPct sizing uses balance and SL distance', () => {
    const state = createEngineState({ startingBalance: 10000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, {
      kind: 'market',
      side: 'BUY',
      riskPct: 1,
      slPips: 20,
      tpR: 2
    });
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].remainingLots).toBeGreaterThan(0);
    expect(state.positions[0].remainingLots).toBeLessThanOrEqual(5);
  });

  it('equity curve tracks balance after closes', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, { kind: 'market', side: 'BUY', lots: 0.1, slPips: 10, tpPips: 20 });
    const entry = state.positions[0].entryPrice;
    advanceBar(state, bar(1060, entry, entry + 25 * PIP, entry - 5 * PIP, entry + 20 * PIP));
    drainClosedTrades(state);
    expect(state.equityCurve.length).toBeGreaterThan(0);
    expect(state.balance).not.toBe(100000);
    expect(state.equity).toBe(state.balance);
  });

  it('modifyPosition updates SL/TP', () => {
    const state = createEngineState({ startingBalance: 100000, pipSize: PIP, symbol: 'EURUSD' });
    advanceBar(state, bar(1000, 1.1, 1.1005, 1.0995, 1.1));
    placeOrder(state, { kind: 'market', side: 'BUY', lots: 0.1, slPips: 10, tpPips: 20 });
    modifyPosition(state, state.positions[0].id, { slPrice: 1.099, tpPrice: 1.103 });
    expect(state.positions[0].slPrice).toBe(1.099);
    expect(state.positions[0].tpPrice).toBe(1.103);
  });
});
