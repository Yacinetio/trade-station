import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createTradeStore } = require('../src/main/tradeStore');

function normalizeTradeForStorage(trade = {}) {
  return { ...trade, accountKey: String(trade.accountKey || 'unknown') };
}

function makeStore(root, legacyStore = null) {
  return createTradeStore({ dataRoot: root, legacyStore, normalizeTradeForStorage });
}

function tradesFile(root, accountKey) {
  return path.join(root, 'accounts', accountKey, 'trades.json');
}

describe('tradeStore', () => {
  let tmpRoot = '';

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-tradestore-test-'));
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('writes valid JSON atomically and refreshes the .bak copy', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([{ id: 't1', accountKey: 'demo', symbol: 'EURUSD' }]);

    const file = tradesFile(tmpRoot, 'demo');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.existsSync(`${file}.bak`)).toBe(true);

    const main = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bak = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
    expect(main).toEqual(bak);
    expect(main[0].id).toBe('t1');
  });

  it('keeps the main file valid after a simulated crash mid-write (tmp written, never renamed)', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([{ id: 'good', accountKey: 'demo', symbol: 'EURUSD' }]);

    const file = tradesFile(tmpRoot, 'demo');
    // Simulate a crash between "write tmp" and "rename": a partial tmp is left behind.
    fs.writeFileSync(`${file}.tmp`, '[{"id":"partial', 'utf8');

    const fresh = makeStore(tmpRoot);
    const trades = fresh.getAllTrades();
    expect(trades.length).toBe(1);
    expect(trades[0].id).toBe('good');
  });

  it('recovers from a corrupted main file via the .bak copy', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([{ id: 'keep-me', accountKey: 'demo', symbol: 'XAUUSD' }]);

    const file = tradesFile(tmpRoot, 'demo');
    fs.writeFileSync(file, '{"truncated": tru', 'utf8');

    const fresh = makeStore(tmpRoot);
    const trades = fresh.getAllTrades();
    expect(trades.length).toBe(1);
    expect(trades[0].id).toBe('keep-me');
  });

  it('recovers from an emptied main file via the .bak copy', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([{ id: 'still-here', accountKey: 'demo' }]);

    const file = tradesFile(tmpRoot, 'demo');
    fs.writeFileSync(file, '', 'utf8');

    const fresh = makeStore(tmpRoot);
    expect(fresh.getAllTrades().map((t) => t.id)).toEqual(['still-here']);
  });

  it('serializes rapid saves — final state is the last save and valid JSON', () => {
    const store = makeStore(tmpRoot);
    for (let i = 0; i < 25; i += 1) {
      store.saveAllTrades([{ id: `t${i}`, accountKey: 'demo', seq: i }]);
    }
    const file = tradesFile(tmpRoot, 'demo');
    const main = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(main.length).toBe(1);
    expect(main[0].id).toBe('t24');
    expect(main[0].seq).toBe(24);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    // .bak mirrors the last good write
    const bak = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
    expect(bak[0].id).toBe('t24');
  });

  it('returns the normalized array from saveAllTrades (sync contract)', () => {
    const store = makeStore(tmpRoot);
    const result = store.saveAllTrades([{ id: 'a', accountKey: 'demo' }]);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe('a');
  });

  it('deleteByAccount removes trades.json plus .bak/.tmp sidecars (no resurrection)', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([{ id: 'gone', accountKey: 'demo' }]);
    const file = tradesFile(tmpRoot, 'demo');
    expect(fs.existsSync(`${file}.bak`)).toBe(true);

    store.deleteByAccount('demo');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
    expect(fs.existsSync(path.dirname(file))).toBe(false);

    const fresh = makeStore(tmpRoot);
    expect(fresh.getAllTrades()).toEqual([]);
  });

  it('preserves manual account trades when a save batch omits them', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([
      { id: 'm1', accountKey: 'manual', channel: 'Manual' },
      { id: 'l1', accountKey: 'demo' }
    ]);
    store.saveAllTrades([{ id: 'l1', accountKey: 'demo' }]);
    store.invalidateCache();
    const ids = store.getAllTrades().map((t) => t.id);
    expect(ids).toContain('m1');
    expect(ids).toContain('l1');
  });

  it('preserves user-edited trades on disk when omitted from save batch', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([
      { id: 'edited', accountKey: 'demo', userEdited: true, trendAlign: 'with' },
      { id: 'plain', accountKey: 'demo' }
    ]);
    store.saveAllTrades([{ id: 'plain', accountKey: 'demo' }]);
    store.invalidateCache();
    const edited = store.getAllTrades().find((t) => t.id === 'edited');
    expect(edited).toBeTruthy();
    expect(edited.trendAlign).toBe('with');
  });

  it('removes stale account files (and sidecars) on saveAllTrades cleanup', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([
      { id: '1', accountKey: 'alpha' },
      { id: '2', accountKey: 'beta' }
    ]);
    // Re-save without beta — its folder must be cleaned up entirely.
    store.saveAllTrades([{ id: '1', accountKey: 'alpha' }]);
    expect(fs.existsSync(path.join(tmpRoot, 'accounts', 'beta'))).toBe(false);
    expect(fs.existsSync(tradesFile(tmpRoot, 'alpha'))).toBe(true);
  });

  it('migrates legacy trades from the legacy store', () => {
    const legacyData = { trades: [{ id: 'legacy-1', accountKey: 'old' }] };
    const legacyStore = {
      dataFile: path.join(tmpRoot, 'tradesync-config.json'),
      get: (key, fallback) => (key === 'trades' ? legacyData.trades : fallback),
      set: () => {}
    };
    const store = makeStore(tmpRoot, legacyStore);
    const result = store.migrateFromLegacyIfNeeded();
    expect(result.migrated).toBe(true);
    expect(result.count).toBe(1);
    expect(result.source).toBe('CURRENT_STORE');
    expect(store.getAllTrades().map((t) => t.id)).toEqual(['legacy-1']);
  });

  it('skips migration when account dirs already exist', () => {
    const store = makeStore(tmpRoot);
    store.saveAllTrades([{ id: 'x', accountKey: 'demo' }]);
    const result = store.migrateFromLegacyIfNeeded();
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('ALREADY_MIGRATED');
  });

  it('runSerialized processes concurrent mutations without losing rows', async () => {
    const store = makeStore(tmpRoot);
    const jobs = [];
    for (let i = 0; i < 8; i += 1) {
      const id = `burst-${i}`;
      jobs.push(
        store.runSerialized(() => {
          store.invalidateCache();
          const rows = store.getAllTrades();
          rows.unshift({ id, accountKey: 'demo', symbol: 'EURUSD' });
          store.saveAllTrades(rows);
        })
      );
    }
    await Promise.all(jobs);
    store.invalidateCache();
    const all = store.getAllTrades();
    expect(all.length).toBe(8);
    const ids = new Set(all.map((t) => t.id));
    expect(ids.size).toBe(8);
  });
});
