import { describe, it, expect } from 'vitest';
const { applySignalExecutionTransforms } = require('../src/main/signalExecutionApply');
const { applyLotSizingToSignal, computePlannedRR, usdPerPipPerStandardLot } = require('../src/main/lotSizing');
const { estimatePipSize } = require('../src/main/signalExecutionApply');

function normalizeExecutionEntryAfterSizing(signal, settings) {
  const { executionEntryForLotSizing } = require('../src/main/lotSizing');
  const s = signal;
  if (!s || !(s.signalEntry != null && Number(s.signalEntry) > 0)) return s;
  if (Number(s.spreadEntryOffsetPips) > 0) return s;
  const anchor = executionEntryForLotSizing(s, settings);
  if (Number.isFinite(anchor) && anchor > 0) s.entry = anchor;
  return s;
}

describe('GBPJPY spread + blend + RR pipeline', () => {
  const settings = {
    executionEntryMode: 'blend',
    executionEntryBlendPct: 50,
    executionEntryAdjust: true,
    lotMode: 'risk',
    riskAmount: 250,
    maxLot: 50,
    useRR: true,
    rrRatio: 2,
    rrEntryAnchor: 'execution',
    enableSpreadEntryAdjust: true,
    spreadEntryRules: [{ symbol: 'GBPJPY', spreadPips: 3 }],
    tpMode: 'first',
    useDefaultSlTp: false
  };

  const parsed = {
    type: 'SELL',
    symbol: 'GBPJPY',
    entry: 214.195,
    obEdge: 214.165,
    avgEntry: 214.225,
    sl: 214.377,
    tp: [213.832],
    lot: 2.22,
    spreadPips: 3
  };

  it('preserves 2R TP and ~$500 profit at telegram anchor after full pipeline', () => {
    let xf = applySignalExecutionTransforms(parsed, settings);
    let signal = applyLotSizingToSignal(xf, settings, {});
    signal = normalizeExecutionEntryAfterSizing(signal, settings);

    expect(signal.entry).toBeCloseTo(214.225);
    expect(signal.tp[0]).toBeCloseTo(213.831, 2);
    expect(computePlannedRR(214.195, signal.sl, signal.tp[0])).toBeCloseTo(2, 1);

    const pip = estimatePipSize('GBPJPY');
    const usd = usdPerPipPerStandardLot('GBPJPY', 214.195);
    const rewardPips = Math.abs(214.195 - signal.tp[0]) / pip;
    const profit = 2.22 * usd * rewardPips;
    expect(profit).toBeGreaterThan(420);
    expect(profit).toBeLessThan(560);
  });

  it('BUY risk lots: replaces short telegram TP and requests EA fill snap', () => {
    const buySettings = {
      ...settings,
      useRR: false,
      enableSpreadEntryAdjust: true,
      spreadEntryRules: [{ symbol: 'GBPJPY', spreadPips: 3 }]
    };
    const buyParsed = {
      type: 'BUY',
      symbol: 'GBPJPY',
      entry: 213.669,
      sl: 213.58,
      tp: [213.913],
      lot: 2.22,
      spreadPips: 3
    };
    let xf = applySignalExecutionTransforms(buyParsed, buySettings);
    let signal = applyLotSizingToSignal(xf, buySettings, {});
    signal = normalizeExecutionEntryAfterSizing(signal, settings);
    const { attachRrSnapForMt5 } = require('../src/main/signalExecutionApply');
    signal = attachRrSnapForMt5({ ...signal, orderType: 'MARKET' }, buySettings);

    const risk = Math.abs(213.669 - 213.58);
    expect(signal.tp[0]).toBeCloseTo(213.669 + risk * 2, 2);
    expect(signal.rrSnapTpToFill).toBe(true);
  });
});
