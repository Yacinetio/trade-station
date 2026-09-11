import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createBacktestSessionStore } from '../src/main/backtestSessionStore.js';

describe('backtestSessionStore', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-session-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('CRUD sessions', () => {
    const store = createBacktestSessionStore({ dataRoot: tmpDir });
    expect(store.listSessions()).toHaveLength(0);

    const created = store.saveSession({
      name: 'Test EURUSD',
      symbol: 'EURUSD',
      timeframe: 'M5',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-07',
      startingBalance: 50000,
      spreadPips: 1.5
    });
    expect(created.id).toBeTruthy();
    expect(store.listSessions()).toHaveLength(1);

    const fetched = store.getSession(created.id);
    expect(fetched.name).toBe('Test EURUSD');

    store.saveSession({ ...fetched, name: 'Renamed' });
    expect(store.getSession(created.id).name).toBe('Renamed');

    expect(store.deleteSession(created.id)).toBe(true);
    expect(store.getSession(created.id)).toBeNull();
  });

  it('snapshot round-trip', () => {
    const store = createBacktestSessionStore({ dataRoot: tmpDir });
    const session = store.saveSession({
      name: 'Snap test',
      symbol: 'GBPUSD',
      dateFrom: '2024-02-01',
      dateTo: '2024-02-02'
    });

    const engineSnapshot = {
      balance: 99000,
      startingBalance: 100000,
      equity: 99100,
      spreadPips: 1,
      pipSize: 0.0001,
      symbol: 'GBPUSD',
      positions: [{ id: 'pos_1', side: 'BUY', entryPrice: 1.27, remainingLots: 0.1 }],
      pendingOrders: [],
      equityCurve: [{ timeSec: 1000, balance: 99000, equity: 99100 }],
      lastBar: { time: 1000, open: 1.27, high: 1.271, low: 1.269, close: 1.2705 },
      seq: 3
    };

    const updated = store.saveSnapshot(session.id, {
      cursorIso: '2024-02-01T10:00:00.000Z',
      engineSnapshot,
      notes: 'Paused at London open'
    });

    expect(updated.cursorIso).toBe('2024-02-01T10:00:00.000Z');
    expect(updated.engineSnapshot.balance).toBe(99000);
    expect(updated.notes).toContain('London open');

    const reloaded = createBacktestSessionStore({ dataRoot: tmpDir }).getSession(session.id);
    expect(reloaded.engineSnapshot.positions).toHaveLength(1);
    expect(reloaded.engineSnapshot.lastBar.time).toBe(1000);
  });

  it('appendClosedTradeIds dedupes', () => {
    const store = createBacktestSessionStore({ dataRoot: tmpDir });
    const session = store.saveSession({ name: 'Ids', symbol: 'EURUSD', dateFrom: '2024-01-01', dateTo: '2024-01-02' });
    store.appendClosedTradeIds(session.id, ['t1', 't2']);
    store.appendClosedTradeIds(session.id, ['t2', 't3']);
    const next = store.getSession(session.id);
    expect(next.closedTradeIds.sort()).toEqual(['t1', 't2', 't3']);
  });

  it('accountKeyForSession', () => {
    const store = createBacktestSessionStore({ dataRoot: tmpDir });
    expect(store.accountKeyForSession('abc123')).toBe('bt:abc123');
  });
});
