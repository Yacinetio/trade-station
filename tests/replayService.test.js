import { it as test } from 'vitest';
const assert = require('node:assert/strict');
const path = require('path');
const {
  buildTradeReplayBundle,
  buildDayReplayBundle,
  sanitizeTradeIdForPath,
  buildSnapshotPath,
  snapToBarTime
} = require('../src/main/replayService');

const BASE = 1750000000; // unix sec anchor, aligned to a minute for M1 fixtures
const iso = (sec) => new Date(sec * 1000).toISOString();

/** count ascending M1 bars starting at BASE + startOffsetSec */
function m1Bars(count, startOffsetSec = 0, price = 1.1) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const drift = i * 0.0001;
    out.push({
      time: BASE + startOffsetSec + i * 60,
      open: price + drift,
      high: price + drift + 0.0005,
      low: price + drift - 0.0005,
      close: price + drift + 0.0002
    });
  }
  return out;
}

// ─── Trade bundle: marker alignment ──────────────────────────────────────────

test('trade bundle: entry/exit markers snap to bar timestamps inside the window', () => {
  const bars = m1Bars(200);
  // entry 100 bars in (+13s off-grid), exit 30 bars later (+41s off-grid)
  const entrySec = BASE + 100 * 60 + 13;
  const exitSec = BASE + 130 * 60 + 41;
  const trade = {
    id: 't1',
    symbol: 'EURUSD',
    type: 'BUY',
    entry: 1.11,
    sl: 1.105,
    tp: 1.12,
    lot: 1,
    profit: 42,
    status: 'CLOSED',
    openedAt: iso(entrySec),
    closedAt: iso(exitSec)
  };

  const b = buildTradeReplayBundle({ trade, bars });
  const barTimes = new Set(b.bars.map((x) => x.time));

  assert.ok(b.markers.length >= 2);
  for (const m of b.markers) {
    assert.ok(barTimes.has(m.timeSec), `marker ${m.kind} at ${m.timeSec} must land on a bar`);
  }
  const entry = b.markers.find((m) => m.kind === 'entry');
  const exit = b.markers.find((m) => m.kind === 'exit');
  assert.ok(entry && exit);
  // nearest M1 bar to +13s is the bar at +0s; nearest to +41s is the next bar
  assert.equal(entry.timeSec, BASE + 100 * 60);
  assert.equal(exit.timeSec, BASE + 131 * 60);
  assert.ok(entry.timeSec <= exit.timeSec);
  // markers stay within the returned window
  assert.ok(entry.timeSec >= b.windowStartSec && exit.timeSec <= b.windowEndSec);
});

test('trade bundle: window spans 60 pre-entry to 20 post-exit bars when available', () => {
  const bars = m1Bars(300);
  const entrySec = BASE + 100 * 60;
  const exitSec = BASE + 150 * 60;
  const trade = {
    id: 't2', symbol: 'EURUSD', type: 'BUY', entry: 1.11, lot: 1,
    profit: 10, status: 'CLOSED', openedAt: iso(entrySec), closedAt: iso(exitSec)
  };
  const b = buildTradeReplayBundle({ trade, bars });
  assert.equal(b.windowStartSec, BASE + (100 - 60) * 60);
  assert.equal(b.windowEndSec, BASE + (150 + 20) * 60);
  assert.equal(b.bars.length, 60 + (150 - 100) + 20 + 1);
});

test('trade bundle: window clamps when few pre-entry bars exist', () => {
  // Only 5 bars of pre-entry context; 3 bars after exit
  const bars = m1Bars(20);
  const entrySec = BASE + 5 * 60;
  const exitSec = BASE + 16 * 60;
  const trade = {
    id: 't3', symbol: 'EURUSD', type: 'BUY', entry: 1.1005, lot: 0.5,
    profit: 5, status: 'CLOSED', openedAt: iso(entrySec), closedAt: iso(exitSec)
  };
  const b = buildTradeReplayBundle({ trade, bars });
  assert.equal(b.windowStartSec, BASE); // clamped to the first bar
  assert.equal(b.windowEndSec, BASE + 19 * 60); // clamped to the last bar
  assert.equal(b.bars.length, 20);
  const entry = b.markers.find((m) => m.kind === 'entry');
  assert.equal(entry.timeSec, entrySec);
});

test('trade bundle: SELL trade gets sell entry label, SL/TP lines and sl exit kind', () => {
  const bars = m1Bars(120);
  const entrySec = BASE + 70 * 60;
  const exitSec = BASE + 90 * 60;
  const trade = {
    id: 't4',
    symbol: 'GBPUSD',
    type: 'SELL',
    entry: 1.27,
    sl: 1.275,
    tps: [1.265, 1.26],
    lot: 1,
    profit: -50,
    status: 'SL_HIT',
    openedAt: iso(entrySec),
    closedAt: iso(exitSec)
  };
  const b = buildTradeReplayBundle({ trade, bars });
  const entry = b.markers.find((m) => m.kind === 'entry');
  assert.ok(entry.label.includes('SELL'));
  assert.equal(entry.price, 1.27);
  const exit = b.markers.find((m) => m.kind === 'sl');
  assert.ok(exit, 'SL_HIT close maps to an sl-kind exit marker');
  assert.equal(b.markers.find((m) => m.kind === 'exit'), undefined);
  assert.deepEqual(b.slLine, { price: 1.275, label: 'SL' });
  assert.deepEqual(b.tpLines.map((t) => t.price), [1.265, 1.26]);
  assert.equal(b.tpLines[0].label, 'TP1');
  assert.equal(b.pnlModel.direction, -1);
  assert.ok(b.pnlModel.pipSize > 0);
});

test('trade bundle: partial closes become partial markers snapped to bars', () => {
  const bars = m1Bars(120);
  const entrySec = BASE + 60 * 60;
  const exitSec = BASE + 100 * 60;
  const trade = {
    id: 't5', symbol: 'EURUSD', type: 'BUY', entry: 1.106, lot: 1,
    profit: 30, status: 'CLOSED', openedAt: iso(entrySec), closedAt: iso(exitSec),
    partialCloses: [{ closedVolume: 0.5, remainingVolume: 0.5, price: 1.1085, profit: 12.5, at: iso(BASE + 80 * 60 + 22) }]
  };
  const b = buildTradeReplayBundle({ trade, bars });
  const partial = b.markers.find((m) => m.kind === 'partial');
  assert.ok(partial);
  assert.equal(partial.timeSec, BASE + 80 * 60);
  assert.equal(partial.price, 1.1085);
});

test('trade bundle: excursion series is passed through sorted and sanitized', () => {
  const bars = m1Bars(120);
  const trade = {
    id: 't6', symbol: 'EURUSD', type: 'BUY', entry: 1.105, lot: 1,
    profit: 20, status: 'CLOSED',
    openedAt: iso(BASE + 60 * 60), closedAt: iso(BASE + 90 * 60),
    excursion: { pnlSeries: [[BASE + 70 * 60, 5], [BASE + 65 * 60, 2], ['bad', 1], [BASE + 80 * 60, 11]] }
  };
  const b = buildTradeReplayBundle({ trade, bars });
  assert.deepEqual(b.excursionSeries, [[BASE + 65 * 60, 2], [BASE + 70 * 60, 5], [BASE + 80 * 60, 11]]);
});

test('trade bundle: empty bars produce an empty but well-shaped bundle', () => {
  const b = buildTradeReplayBundle({ trade: { id: 'x', symbol: 'EURUSD', type: 'BUY' }, bars: [] });
  assert.deepEqual(b.bars, []);
  assert.deepEqual(b.markers, []);
  assert.equal(b.windowStartSec, null);
});

// ─── Day bundle ──────────────────────────────────────────────────────────────

const DAY_KEY = '2026-06-15';
const daySec = (h, m = 0) => Math.floor(Date.parse(`${DAY_KEY}T00:00:00Z`) / 1000) + h * 3600 + m * 60;

const DAY_TRADES = [
  {
    id: 'd1', symbol: 'EURUSD', type: 'BUY', entry: 1.1, lot: 1, profit: 100,
    status: 'CLOSED', openedAt: iso(daySec(8)), closedAt: iso(daySec(10))
  },
  {
    id: 'd2', symbol: 'XAUUSD', type: 'SELL', entry: 2300, lot: 0.2, profit: -40,
    status: 'SL_HIT', openedAt: iso(daySec(9)), closedAt: iso(daySec(9, 30))
  },
  {
    id: 'd3', symbol: 'GBPUSD', type: 'BUY', entry: 1.27, lot: 0.5, profit: 25,
    status: 'CLOSED',
    // opened the day BEFORE, closed within the day → still belongs to the day
    openedAt: iso(daySec(0) - 3600 * 5), closedAt: iso(daySec(14))
  },
  {
    id: 'd4', symbol: 'USDJPY', type: 'BUY', entry: 155, lot: 1, profit: 0,
    // still open → open event only, no P&L contribution
    status: 'EXECUTED', openedAt: iso(daySec(15))
  },
  {
    id: 'other-day', symbol: 'EURUSD', type: 'BUY', entry: 1.1, lot: 1, profit: 999,
    status: 'CLOSED', openedAt: iso(daySec(0) - 86400), closedAt: iso(daySec(0) - 80000)
  }
];

test('day bundle: events are chronological and only in-day trades included', () => {
  const b = buildDayReplayBundle({ dateKey: DAY_KEY, trades: DAY_TRADES, barsBySymbol: {} });

  assert.deepEqual(b.trades.map((t) => t.id).sort(), ['d1', 'd2', 'd3', 'd4']);

  for (let i = 1; i < b.events.length; i++) {
    assert.ok(b.events[i].atSec >= b.events[i - 1].atSec, 'events must be sorted by time');
  }
  assert.deepEqual(
    b.events.map((e) => `${e.type}:${e.tradeId}`),
    ['open:d1', 'open:d2', 'close:d2', 'close:d1', 'close:d3', 'open:d4']
  );
  // d3 opened the previous day → only its close event lands inside the day
  assert.equal(b.events.filter((e) => e.tradeId === 'd3').length, 1);
  // open trade d4 has no close event
  assert.equal(b.events.filter((e) => e.tradeId === 'd4' && e.type === 'close').length, 0);
  assert.deepEqual(b.symbols.sort(), ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']);
});

test('day bundle: running P&L accumulates close events in order', () => {
  const b = buildDayReplayBundle({ dateKey: DAY_KEY, trades: DAY_TRADES });
  // closes: d2 (-40) at 09:30, d1 (+100) at 10:00, d3 (+25) at 14:00
  assert.deepEqual(b.runningPnl, [
    [daySec(9, 30), -40],
    [daySec(10), 60],
    [daySec(14), 85]
  ]);
});

test('day bundle: bad dateKey yields empty bundle', () => {
  const b = buildDayReplayBundle({ dateKey: 'nope', trades: DAY_TRADES });
  assert.deepEqual(b.events, []);
  assert.deepEqual(b.trades, []);
  assert.deepEqual(b.runningPnl, []);
});

// ─── Snapshot path safety ────────────────────────────────────────────────────

test('sanitizeTradeIdForPath strips traversal and unsafe characters', () => {
  assert.equal(sanitizeTradeIdForPath('trade-123_ok'), 'trade-123_ok');
  assert.equal(sanitizeTradeIdForPath('../../etc/passwd'), 'etc_passwd');
  assert.equal(sanitizeTradeIdForPath('..\\..\\win\\path'), 'win_path');
  assert.equal(sanitizeTradeIdForPath('a b/c:d*e'), 'a_b_c_d_e');
  assert.equal(sanitizeTradeIdForPath(''), 'unknown');
  assert.equal(sanitizeTradeIdForPath(null), 'unknown');
  assert.equal(sanitizeTradeIdForPath('....'), 'unknown');
  assert.ok(sanitizeTradeIdForPath('x'.repeat(300)).length <= 80);
});

test('buildSnapshotPath stays under dataRoot/attachments/trades', () => {
  const root = path.join('C:', 'data-root');
  const p = buildSnapshotPath(root, '../../evil', new Date('2026-06-15T12:00:00Z'));
  const expectedDir = path.join(root, 'attachments', 'trades', 'evil');
  assert.ok(p.startsWith(expectedDir + path.sep), `${p} must stay inside ${expectedDir}`);
  assert.ok(p.endsWith('.png'));
  assert.ok(path.basename(p).startsWith('replay-'));
});

// ─── snap helper ─────────────────────────────────────────────────────────────

test('snapToBarTime picks the nearest bar and handles empties', () => {
  const bars = m1Bars(3); // BASE, BASE+60, BASE+120
  assert.equal(snapToBarTime(BASE + 29, bars), BASE);
  assert.equal(snapToBarTime(BASE + 31, bars), BASE + 60);
  assert.equal(snapToBarTime(BASE + 10000, bars), BASE + 120);
  assert.equal(snapToBarTime(BASE, []), null);
});
