import { describe, it, expect } from 'vitest';
const {
  applyLotSizingToSignal,
  computeLotsFromSlRisk,
  computePlannedRR,
  computeTradeRiskUsd,
  usdPerPipPerStandardLot
} = require('../src/main/lotSizing');
const {
  applySignalExecutionTransforms,
  estimatePipSize
} = require('../src/main/signalExecutionApply');

const SIGNAL_BUY_EU = { type: 'BUY', symbol: 'EURUSD', entry: 1.10, sl: 1.095, tp: [1.110] };

describe('applyLotSizingToSignal', () => {
  it('respects fixed-lot mode and clamps to maxLot', () => {
    const out = applyLotSizingToSignal(SIGNAL_BUY_EU, { lotMode: 'fixed', fixedLot: 0.5, maxLot: 0.2 });
    expect(out.lot).toBeCloseTo(0.2, 2);
    expect(out.lotMode).toBe('fixed');
  });

  it('falls back to 0.01 when lot mode is signal but no signal lot present', () => {
    const out = applyLotSizingToSignal(SIGNAL_BUY_EU, { lotMode: 'signal' }, { balance: 0 });
    expect(out.lot).toBeCloseTo(0.01, 2);
  });

  it('computes risk % sizing for SL-based modes', () => {
    const out = applyLotSizingToSignal(SIGNAL_BUY_EU, { lotMode: 'riskpct', riskPct: 1, maxLot: 100 }, { balance: 10000, equity: 10000 });
    // 1% of 10k = $100 risked over 50 pips at $10/pip/lot ≈ 0.20 lots
    expect(out.lot).toBeGreaterThan(0.05);
    expect(out.lot).toBeLessThan(1);
  });

  it('computes percent-of-balance sizing', () => {
    const out = applyLotSizingToSignal(SIGNAL_BUY_EU, { lotMode: 'percentage', lotPercentage: 1, maxLot: 100 }, { balance: 10000 });
    expect(out.lot).toBeGreaterThan(0);
    expect(out.lotMode).toBe('percentage');
  });

  it('always returns lot ≥ 0.01 for buy signals with valid SL', () => {
    const out = applyLotSizingToSignal(SIGNAL_BUY_EU, { lotMode: 'risk', riskAmount: 1, maxLot: 100 }, { balance: 100 });
    expect(out.lot).toBeGreaterThanOrEqual(0.01);
  });

  it('risk$ XAUUSD uses contract-sized $/pip (~$10/pip/lot), not spot-scaled fudge', () => {
    const sig = {
      type: 'SELL',
      symbol: 'XAUUSD',
      entry: 4719.5,
      sl: 4730.68,
      tp: [4702.96]
    };
    const out = applyLotSizingToSignal(sig, { lotMode: 'risk', riskAmount: 250, maxLot: 30 }, {});
    // SL ~11.18 pts → ~111.8 “pips” of 0.1; $250 / (111.8 × ~10) ≈ 0.22 lots → ~$246 at SL
    expect(out.lot).toBeGreaterThanOrEqual(0.21);
    expect(out.lot).toBeLessThanOrEqual(0.24);
  });

  it('risk $ uses avg-only baseline when primary entry was missing before transforms', () => {
    const settings = {
      lotMode: 'risk',
      riskAmount: 250,
      maxLot: 30,
      executionEntryMode: 'blend',
      executionEntryBlendPct: 70,
      useRR: false,
      useDefaultSlTp: false,
      tpMode: 'separate'
    };
    const xf = applySignalExecutionTransforms(
      {
        type: 'SELL',
        symbol: 'XAUUSD',
        entry: 0,
        avgEntry: 4722.21,
        sl: 4730.68,
        tp: [4702.957],
        lot: 0.06,
        orderType: 'MARKET'
      },
      settings
    );
    expect(Number(xf.entry)).toBeGreaterThan(0);
    const out = applyLotSizingToSignal(xf, settings, {});
    expect(out.lot).toBeGreaterThan(0.15);
    expect(out.lot).toBeLessThan(0.45);
  });

  it('risk $ recomputes desk entry from signalEntry when entry was stale at SIG @', () => {
    const settings = {
      lotMode: 'risk',
      riskAmount: 250,
      maxLot: 30,
      executionEntryMode: 'blend',
      executionEntryBlendPct: 70
    };
    const xf = applySignalExecutionTransforms(
      {
        type: 'SELL',
        symbol: 'US100.cash',
        entry: 23050.63,
        avgEntry: 23058.63,
        sl: 23079.38,
        tp: [23008.93]
      },
      settings
    );
    expect(xf.signalEntry).toBeCloseTo(23050.63, 2);
    expect(xf.entry).toBeCloseTo(23056.23, 2);
    const corrupted = { ...xf, entry: xf.signalEntry };
    const out = applyLotSizingToSignal(corrupted, settings, {});
    expect(out.lot).toBeGreaterThan(10);
    expect(out.lot).toBeLessThan(12);
  });

  it('sizes GER40 risk-$ using index points (≈26 pt SL, $250 risk → multi-lot, not microscopic)', () => {
    const sig = {
      type: 'BUY',
      symbol: 'GER40.cash',
      entry: 24010.021,
      sl: 23984.21,
      tp: [24061.643]
    };
    const out = applyLotSizingToSignal(sig, { lotMode: 'risk', riskAmount: 250, maxLot: 30 }, {});
    expect(out.lot).toBeGreaterThan(5);
    expect(out.lot).toBeLessThan(16);
  });

  it('risk$ uses EXEC entry→SL after blend; RR TP does not affect lots', () => {
    const parsed = {
      type: 'BUY',
      symbol: 'GER40',
      entry: 4510,
      avgEntry: 4506,
      sl: 4490,
      tp: [4800]
    };
    const xf = applySignalExecutionTransforms(parsed, {
      executionEntryMode: 'blend',
      executionEntryBlendPct: 50,
      rrEntryAnchor: 'execution',
      useRR: true,
      rrRatio: 2,
      useDefaultSlTp: false,
      tpMode: 'separate'
    });
    expect(xf.entry).toBeCloseTo(4508);
    const riskDist = Math.abs(4508 - 4490);
    expect(xf.tp[0]).toBeCloseTo(4508 + riskDist * 2);
    const hugeFakeTp = 4800 + (4508 - 4510);
    const outSame = applyLotSizingToSignal(xf, { lotMode: 'risk', riskAmount: 250, maxLot: 30 }, {});
    const outFake = applyLotSizingToSignal(
      { ...xf, tp: [hugeFakeTp] },
      { lotMode: 'risk', riskAmount: 250, maxLot: 30 },
      {}
    );
    expect(outSame.lot).toBeCloseTo(outFake.lot, 4);
  });
});

/** $250 SL risk · 2R TP · 70% ENTRY→AVG blend · rr anchored on execution fill price */
const SETTINGS_RR_BLEND_250 = {
  lotMode: 'risk',
  riskAmount: 250,
  maxLot: 50,
  executionEntryMode: 'blend',
  executionEntryBlendPct: 70,
  useRR: true,
  rrRatio: 2,
  rrEntryAnchor: 'execution',
  useDefaultSlTp: false,
  tpMode: 'separate'
};

function blendedExecutionEntry(entry, avgEntry, pct = 70) {
  return entry + (avgEntry - entry) * (pct / 100);
}

function expectedRrTp(isBuy, exec, sl, rr = 2) {
  const dist = Math.abs(exec - sl);
  return isBuy ? exec + dist * rr : exec - dist * rr;
}

function impliedUsdRiskAtSl(symbol, execEntry, sl, lot) {
  const pip = estimatePipSize(symbol);
  const stopPips = Math.abs(execEntry - sl) / pip;
  const usdPer = usdPerPipPerStandardLot(symbol, execEntry);
  return stopPips * usdPer * lot;
}

describe('pair matrix: $250 risk + 2R + 70% blend (execution RR anchor)', () => {
  /**
   * Synthetic ENTRY + AVG + SL; Telegram TP is irrelevant (useRR replaces).
   * BTC uses a tight SL so sized volume stays near the 0.01 floor — wide stops would clamp up implied risk.
   */
  const cases = [
    { name: 'EURUSD BUY', type: 'BUY', symbol: 'EURUSD', entry: 1.1, avgEntry: 1.101, sl: 1.095 },
    { name: 'GBPUSD BUY', type: 'BUY', symbol: 'GBPUSD', entry: 1.265, avgEntry: 1.266, sl: 1.26 },
    { name: 'AUDUSD BUY', type: 'BUY', symbol: 'AUDUSD', entry: 0.655, avgEntry: 0.656, sl: 0.65 },
    { name: 'NZDUSD BUY', type: 'BUY', symbol: 'NZDUSD', entry: 0.595, avgEntry: 0.596, sl: 0.59 },
    { name: 'USDCHF BUY', type: 'BUY', symbol: 'USDCHF', entry: 0.885, avgEntry: 0.886, sl: 0.88 },
    { name: 'USDCAD BUY', type: 'BUY', symbol: 'USDCAD', entry: 1.355, avgEntry: 1.356, sl: 1.35 },
    { name: 'USDJPY BUY', type: 'BUY', symbol: 'USDJPY', entry: 155.0, avgEntry: 155.1, sl: 154.5 },
    { name: 'EURJPY BUY (cross)', type: 'BUY', symbol: 'EURJPY', entry: 185.0, avgEntry: 185.12, sl: 184.5 },
    { name: 'EURUSD SELL', type: 'SELL', symbol: 'EURUSD', entry: 1.101, avgEntry: 1.1, sl: 1.106 },
    { name: 'XAUUSD BUY', type: 'BUY', symbol: 'XAUUSD', entry: 2650.0, avgEntry: 2655.0, sl: 2620.0 },
    { name: 'XAGUSD BUY', type: 'BUY', symbol: 'XAGUSD', entry: 32.5, avgEntry: 32.65, sl: 30.8 },
    { name: 'GER40.cash BUY', type: 'BUY', symbol: 'GER40.cash', entry: 24000, avgEntry: 24035, sl: 23915 },
    { name: 'US100.cash BUY', type: 'BUY', symbol: 'US100.cash', entry: 21000, avgEntry: 21045, sl: 20920 },
    { name: 'BTCUSD BUY', type: 'BUY', symbol: 'BTCUSD', entry: 98000, avgEntry: 98100, sl: 98020 }
  ];

  for (const c of cases) {
    it(`${c.name}: blend entry, TP = 2×|exec−SL|, lots ≈ $250 at SL`, () => {
      const parsed = {
        type: c.type,
        symbol: c.symbol,
        entry: c.entry,
        avgEntry: c.avgEntry,
        sl: c.sl,
        tp: [c.type === 'BUY' ? c.entry + 9 : c.entry - 9],
        lot: 0.01
      };
      const xf = applySignalExecutionTransforms(parsed, SETTINGS_RR_BLEND_250);
      const ex = blendedExecutionEntry(c.entry, c.avgEntry, 70);
      expect(xf.entry).toBeCloseTo(ex, 6);
      const wantTp = expectedRrTp(c.type === 'BUY', xf.entry, xf.sl, 2);
      expect(xf.tp[0]).toBeCloseTo(wantTp, 6);

      const lotOut = applyLotSizingToSignal(xf, SETTINGS_RR_BLEND_250, {});
      const direct = computeLotsFromSlRisk(c.symbol, xf.entry, xf.sl, 250, 50);
      expect(lotOut.lot).toBeCloseTo(direct, 4);

      const implied = impliedUsdRiskAtSl(c.symbol, xf.entry, xf.sl, lotOut.lot);
      // 0.01 lot steps + broker approximations; keep band practical
      expect(implied).toBeGreaterThan(250 * 0.9);
      expect(implied).toBeLessThan(250 * 1.12);
    });
  }

  it('OIL BUY: same invariants', () => {
    const parsed = {
      type: 'BUY',
      symbol: 'USOIL',
      entry: 72.5,
      avgEntry: 72.65,
      sl: 72.0,
      tp: [74],
      lot: 0.01
    };
    const xf = applySignalExecutionTransforms(parsed, SETTINGS_RR_BLEND_250);
    const ex = blendedExecutionEntry(72.5, 72.65, 70);
    expect(xf.entry).toBeCloseTo(ex, 5);
    expect(xf.tp[0]).toBeCloseTo(expectedRrTp(true, xf.entry, xf.sl, 2), 5);
    const lotOut = applyLotSizingToSignal(xf, SETTINGS_RR_BLEND_250, {});
    const implied = impliedUsdRiskAtSl('USOIL', xf.entry, xf.sl, lotOut.lot);
    expect(implied).toBeGreaterThan(250 * 0.9);
    expect(implied).toBeLessThan(250 * 1.12);
  });
});

describe('computeTradeRiskUsd / computePlannedRR', () => {
  it('risk $ GBPJPY uses MT5 broker pip value so lots match ~$250 at SL on chart', () => {
    const settings = {
      lotMode: 'risk',
      riskAmount: 250,
      maxLot: 50,
      executionEntryMode: 'blend',
      executionEntryBlendPct: 50,
      useRR: false,
      useDefaultSlTp: false
    };
    const xf = applySignalExecutionTransforms(
      {
        type: 'SELL',
        symbol: 'GBPJPY',
        entry: 214.658,
        obEdge: 214.648,
        avgEntry: 214.667,
        sl: 214.722,
        tp: [214.529],
        lot: 6.28,
        usdPerPipPerLot: 7.74
      },
      settings
    );
    const out = applyLotSizingToSignal(xf, settings, {});
    const risk = computeTradeRiskUsd('GBPJPY', xf.entry, xf.sl, out.lot, 7.74);
    expect(out.lot).toBeLessThan(6.28);
    expect(risk).toBeGreaterThan(240);
    expect(risk).toBeLessThan(260);
  });

  it('computes risk USD from lot and SL distance', () => {
    const risk = computeTradeRiskUsd('EURUSD', 1.1, 1.095, 0.2);
    expect(risk).toBeGreaterThan(90);
    expect(risk).toBeLessThan(110);
  });

  it('computes planned R:R from entry, SL, and TP1', () => {
    expect(computePlannedRR(1.1, 1.095, 1.11)).toBeCloseTo(2, 2);
  });

  it('returns null when SL is missing', () => {
    expect(computeTradeRiskUsd('EURUSD', 1.1, 0, 0.1)).toBeNull();
    expect(computePlannedRR(1.1, 0, 1.11)).toBeNull();
  });
});