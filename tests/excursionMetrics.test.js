import { it as test } from 'vitest';
const assert = require('node:assert/strict');
const {
  computeEfficiencyPct,
  computeEdgeRatio,
  computeExcursionFromBars,
  simulateBestExits
} = require('../src/main/excursionMetrics');

const BASE = 1750000000; // unix sec anchor for synthetic bars
const iso = (sec) => new Date(sec * 1000).toISOString();
const bar = (offsetSec, o, h, l, c) => ({ time: BASE + offsetSec, open: o, high: h, low: l, close: c });

// BUY EURUSD 1.00 lot, entry 1.1000, SL 1.0950 (50 pips = 1R), $10/pip/lot.
// Path: +10p → +30p → +60p (1R prints) → +105p peak (2R prints) → retrace → close flat.
const BUY_BARS = [
  bar(0, 1.1000, 1.1010, 1.0995, 1.1005),
  bar(60, 1.1005, 1.1030, 1.1000, 1.1025),
  bar(120, 1.1025, 1.1060, 1.1020, 1.1050),
  bar(180, 1.1050, 1.1105, 1.1040, 1.1100),
  bar(240, 1.1100, 1.1080, 1.1010, 1.1015),
  bar(300, 1.1015, 1.1030, 1.0990, 1.1000)
];

const BUY_TRADE = {
  id: 't-buy',
  symbol: 'EURUSD',
  type: 'BUY',
  entry: 1.1,
  sl: 1.095,
  lot: 1.0,
  profit: 150,
  status: 'CLOSED',
  openedAt: iso(BASE),
  closedAt: iso(BASE + 300)
};

test('computeEfficiencyPct: basic, clamp, loss and null cases', () => {
  assert.equal(computeEfficiencyPct({ profit: 60, excursion: { mfeMoney: 100 } }), 60);
  // clamped to 150 when realized exceeds MFE (partial fills / swap noise)
  assert.equal(computeEfficiencyPct({ profit: 300, excursion: { mfeMoney: 100 } }), 150);
  // loss trades clamp to 0, not negative
  assert.equal(computeEfficiencyPct({ profit: -50, excursion: { mfeMoney: 100 } }), 0);
  // MFE <= 0 or missing → null
  assert.equal(computeEfficiencyPct({ profit: 50, excursion: { mfeMoney: 0 } }), null);
  assert.equal(computeEfficiencyPct({ profit: 50 }), null);
  assert.equal(computeEfficiencyPct({ excursion: { mfeMoney: 100 } }), null);
});

test('computeEdgeRatio: ratio, zero-MAE and missing cases', () => {
  assert.equal(computeEdgeRatio({ excursion: { mfePips: 30, maePips: 10 } }), 3);
  assert.equal(computeEdgeRatio({ excursion: { mfePips: 30, maePips: 0 } }), null);
  assert.equal(computeEdgeRatio({ excursion: { mfePips: 30 } }), null);
  assert.equal(computeEdgeRatio({}), null);
});

test('computeExcursionFromBars: BUY uses highs for MFE, lows for MAE', () => {
  const r = computeExcursionFromBars(BUY_TRADE, BUY_BARS);
  assert.ok(r);
  // max high 1.1105 → +105 pips; min low 1.0990 → −10 pips
  assert.equal(r.mfePips, 105);
  assert.equal(r.maePips, 10);
  // $10/pip/lot × 1.00 lot
  assert.equal(r.mfeMoney, 1050);
  assert.equal(r.maeMoney, 100);
  assert.equal(r.barCount, BUY_BARS.length);
});

test('computeExcursionFromBars: SELL inverts favorable/adverse sides', () => {
  const sellBars = [
    bar(0, 1.25, 1.2530, 1.2480, 1.2490),
    bar(60, 1.2490, 1.2500, 1.2440, 1.2450)
  ];
  const r = computeExcursionFromBars(
    {
      symbol: 'GBPUSD',
      type: 'SELL',
      entry: 1.25,
      lot: 0.5,
      openedAt: iso(BASE),
      closedAt: iso(BASE + 60)
    },
    sellBars
  );
  assert.ok(r);
  // favorable: entry − min low = 60 pips; adverse: max high − entry = 30 pips
  assert.equal(r.mfePips, 60);
  assert.equal(r.maePips, 30);
  // $10/pip/lot × 0.5 lot = $5/pip
  assert.equal(r.mfeMoney, 300);
  assert.equal(r.maeMoney, 150);
});

test('computeExcursionFromBars: gold pip convention (0.1)', () => {
  const r = computeExcursionFromBars(
    {
      symbol: 'XAUUSD',
      type: 'BUY',
      entry: 2400,
      lot: 0.1,
      openedAt: iso(BASE),
      closedAt: iso(BASE + 60)
    },
    [bar(0, 2400, 2405, 2398, 2404)]
  );
  assert.ok(r);
  assert.equal(r.mfePips, 50); // +$5.00 move / 0.1 pip
  assert.equal(r.maePips, 20);
});

test('computeExcursionFromBars: ignores bars outside the trade window and rejects unusable trades', () => {
  const withOutliers = [
    bar(-3600, 1.0, 2.0, 0.5, 1.0), // long before open — must be ignored
    ...BUY_BARS,
    bar(7200, 1.0, 2.0, 0.5, 1.0) // long after close — must be ignored
  ];
  const r = computeExcursionFromBars(BUY_TRADE, withOutliers);
  assert.equal(r.mfePips, 105);
  assert.equal(r.maePips, 10);

  assert.equal(computeExcursionFromBars({ ...BUY_TRADE, entry: 0 }, BUY_BARS), null);
  assert.equal(computeExcursionFromBars({ ...BUY_TRADE, type: 'SYNC' }, BUY_BARS), null);
  assert.equal(computeExcursionFromBars(BUY_TRADE, []), null);
});

test('simulateBestExits: hand-computed BUY fixture (1R/2R/3R, BE, trailing)', () => {
  const r = simulateBestExits(BUY_TRADE, BUY_BARS, { trailPips: 25 });
  assert.equal(r.ok, true);
  assert.equal(r.actualProfit, 150);
  assert.equal(r.riskPips, 50);

  const byId = Object.fromEntries(r.variants.map((v) => [v.id, v]));

  // 1R target 1.1050 hit on bar 3 → +50 pips → $500
  assert.equal(byId['fixed-1r'].profit, 500);
  assert.equal(byId['fixed-1r'].deltaVsActual, 350);
  assert.equal(byId['fixed-1r'].exitReason, 'target');

  // 2R target 1.1100 hit on bar 4 → $1000
  assert.equal(byId['fixed-2r'].profit, 1000);
  assert.equal(byId['fixed-2r'].deltaVsActual, 850);

  // 3R never hit, SL never hit → exits at final close 1.1000 → $0
  assert.equal(byId['fixed-3r'].profit, 0);
  assert.equal(byId['fixed-3r'].exitReason, 'end');
  assert.equal(byId['fixed-3r'].deltaVsActual, -150);

  // BE armed on bar 3 (+1R prints), stop → entry, hit on bar 6 low 1.0990 → $0
  assert.equal(byId['be-after-1r'].profit, 0);
  assert.equal(byId['be-after-1r'].exitReason, 'breakeven');

  // Trailing 25 pips: stop ratchets to 1.1080 after bar-4 peak 1.1105, hit on bar 5 → +80p → $800
  assert.equal(byId['trail-pips'].profit, 800);
  assert.equal(byId['trail-pips'].deltaVsActual, 650);
  assert.equal(byId['trail-pips'].exitReason, 'stop');
});

test('simulateBestExits: SELL stop-first conservatism within one bar', () => {
  // SELL entry 1.2500, SL 1.2530 (30 pips), 1R target 1.2470.
  // Single wide bar touches BOTH the stop and the target → conservative model exits at the stop.
  const trade = {
    symbol: 'GBPUSD',
    type: 'SELL',
    entry: 1.25,
    sl: 1.253,
    lot: 1,
    profit: 0,
    openedAt: iso(BASE),
    closedAt: iso(BASE + 60)
  };
  const wideBar = [bar(0, 1.25, 1.2540, 1.2460, 1.2500)];
  const r = simulateBestExits(trade, wideBar);
  const fixed1r = r.variants.find((v) => v.id === 'fixed-1r');
  assert.equal(fixed1r.exitReason, 'stop');
  assert.equal(fixed1r.profit, -300); // −30 pips × $10/pip
});

test('simulateBestExits: no SL → R variants unavailable, trailing still runs', () => {
  const noSl = { ...BUY_TRADE, sl: 0 };
  const r = simulateBestExits(noSl, BUY_BARS, { trailPips: 25 });
  assert.equal(r.ok, true);
  assert.equal(r.riskPips, null);
  const byId = Object.fromEntries(r.variants.map((v) => [v.id, v]));
  assert.equal(byId['fixed-1r'].profit, null);
  assert.equal(byId['fixed-1r'].exitReason, 'unavailable');
  assert.equal(byId['be-after-1r'].profit, null);
  assert.equal(byId['trail-pips'].profit, 800);
});

test('simulateBestExits: unusable inputs return ok:false', () => {
  assert.equal(simulateBestExits({ symbol: 'EURUSD', type: 'BUY' }, BUY_BARS).ok, false);
  assert.equal(simulateBestExits(BUY_TRADE, []).ok, false);
});
