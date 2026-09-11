import { describe, it, expect } from 'vitest';
const {
  applySignalExecutionTransforms,
  resolveExecutionEntry,
  applySpreadEntryOffset,
  isExecutionEntryAdjustEnabled,
  resolveOrderTypeForSignal,
  isLivePriceAtOrBetterThanBlendEntry
} = require('../src/main/signalExecutionApply');

describe('isExecutionEntryAdjustEnabled', () => {
  it('is false when lot mode is signal', () => {
    expect(isExecutionEntryAdjustEnabled({ lotMode: 'signal', executionEntryAdjust: true })).toBe(false);
  });

  it('is false when executionEntryAdjust is off', () => {
    expect(isExecutionEntryAdjustEnabled({ lotMode: 'risk', executionEntryAdjust: false })).toBe(false);
  });

  it('is true for risk lot with adjust on', () => {
    expect(isExecutionEntryAdjustEnabled({ lotMode: 'risk', executionEntryAdjust: true })).toBe(true);
  });
});

describe('isLivePriceAtOrBetterThanBlendEntry', () => {
  it('BUY: Ask at or below blend entry → true (market at EA)', () => {
    expect(isLivePriceAtOrBetterThanBlendEntry('BUY', 4540, 4545)).toBe(true);
    expect(isLivePriceAtOrBetterThanBlendEntry('BUY', 4545, 4545)).toBe(true);
    expect(isLivePriceAtOrBetterThanBlendEntry('BUY', 4548, 4545)).toBe(false);
  });

  it('SELL: Bid at or above blend entry → true', () => {
    expect(isLivePriceAtOrBetterThanBlendEntry('SELL', 2650, 2645)).toBe(true);
    expect(isLivePriceAtOrBetterThanBlendEntry('SELL', 2640, 2645)).toBe(false);
  });
});

describe('resolveOrderTypeForSignal', () => {
  it('returns AUTO when pending at entry enabled and entry set', () => {
    expect(
      resolveOrderTypeForSignal(
        { entry: 1.1, orderType: 'MARKET' },
        { pendingAtEntry: true, forceMarket: false }
      )
    ).toBe('AUTO');
  });

  it('returns MARKET when forceMarket', () => {
    expect(
      resolveOrderTypeForSignal(
        { entry: 1.1 },
        { pendingAtEntry: true, forceMarket: true }
      )
    ).toBe('MARKET');
  });
});

describe('resolveExecutionEntry', () => {
  it('skips blend when execution entry adjust disabled', () => {
    const r = resolveExecutionEntry(
      { entry: 29070.08, obEdge: 29073.25, avgEntry: 29066.91 },
      { executionEntryMode: 'blend', executionEntryBlendPct: 50, executionEntryAdjust: false, lotMode: 'risk' }
    );
    expect(r.entry).toBeCloseTo(29070.08, 2);
    expect(r.adjusted).toBe(false);
  });

  it('signal mode keeps telegram entry', () => {
    const r = resolveExecutionEntry(
      { entry: 1.1, avgEntry: 1.105 },
      { executionEntryMode: 'signal' }
    );
    expect(r.entry).toBeCloseTo(1.1);
    expect(r.adjusted).toBe(false);
  });

  it('avg mode prefers avgEntry', () => {
    const r = resolveExecutionEntry(
      { entry: 1.1, avgEntry: 1.105 },
      { executionEntryMode: 'avg' }
    );
    expect(r.entry).toBeCloseTo(1.105);
    expect(r.adjusted).toBe(true);
  });

  it('avg mode falls back when avg missing', () => {
    const r = resolveExecutionEntry({ entry: 1.1 }, { executionEntryMode: 'avg' });
    expect(r.entry).toBeCloseTo(1.1);
    expect(r.adjusted).toBe(false);
  });

  it('blend mode interpolates toward avgEntry', () => {
    const r = resolveExecutionEntry(
      { entry: 1.1, avgEntry: 1.12 },
      { executionEntryMode: 'blend', executionEntryBlendPct: 50 }
    );
    expect(r.entry).toBeCloseTo(1.11);
    expect(r.adjusted).toBe(true);
  });

  it('blend 0% equals signal entry', () => {
    const r = resolveExecutionEntry(
      { entry: 1.1, avgEntry: 1.12 },
      { executionEntryMode: 'blend', executionEntryBlendPct: 0 }
    );
    expect(r.entry).toBeCloseTo(1.1);
    expect(r.adjusted).toBe(false);
  });

  it('blend 100% equals avg entry', () => {
    const r = resolveExecutionEntry(
      { entry: 1.1, avgEntry: 1.12 },
      { executionEntryMode: 'blend', executionEntryBlendPct: 100 }
    );
    expect(r.entry).toBeCloseTo(1.12);
    expect(r.adjusted).toBe(true);
  });

  it('blend 50% is midpoint between ENTRY and AVG ENTRY (indices)', () => {
    const r = resolveExecutionEntry(
      { entry: 4510, avgEntry: 4506 },
      { executionEntryMode: 'blend', executionEntryBlendPct: 50 }
    );
    expect(r.entry).toBeCloseTo(4508, 6);
    expect(r.adjusted).toBe(true);
  });

  it('blend 50% uses OB edge → AVG when obEdge present (Telegram ENTRY already midpoint)', () => {
    const r = resolveExecutionEntry(
      { entry: 29070.08, obEdge: 29073.25, avgEntry: 29066.91 },
      { executionEntryMode: 'blend', executionEntryBlendPct: 50 }
    );
    expect(r.entry).toBeCloseTo(29070.08, 2);
    expect(r.adjusted).toBe(false);
  });
});

describe('applySpreadEntryOffset', () => {
  it('BUY subtracts spread pips from entry', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, spreadPips: 2 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'EURUSD' }] }
    );
    expect(r.adjusted).toBe(true);
    expect(r.entry).toBeCloseTo(1.0998, 6);
    expect(r.spreadPipsApplied).toBe(2);
  });

  it('SELL adds spread pips to entry', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'EURUSD', type: 'SELL', entry: 1.1, spreadPips: 2 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'EURUSD' }] }
    );
    expect(r.adjusted).toBe(true);
    expect(r.entry).toBeCloseTo(1.1002, 6);
  });

  it('matches broker suffix on symbol key', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'US100.cash', type: 'BUY', entry: 21000, spreadPips: 10 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'US100' }] }
    );
    expect(r.adjusted).toBe(true);
    expect(r.entry).toBeCloseTo(20999.9, 1);
  });

  it('uses fallback pips when live spread missing', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'XAUUSD', type: 'BUY', entry: 2000 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'XAUUSD', spreadPips: 8 }] }
    );
    expect(r.adjusted).toBe(true);
    expect(r.entry).toBeCloseTo(1999.92, 2);
    expect(r.spreadEntrySource).toBe('fallback');
  });

  it('skips pairs not in the list', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1 },
      { enableSpreadEntryAdjust: true, spreadEntryRules: [{ symbol: 'US100', spreadPips: 10 }] }
    );
    expect(r.adjusted).toBe(false);
    expect(r.entry).toBeCloseTo(1.1);
  });

  it('all pairs mode applies spread without a rule row', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, spreadPips: 1.2 },
      { enableSpreadEntryAdjust: true, spreadEntryAllPairs: true, spreadEntryRules: [] }
    );
    expect(r.adjusted).toBe(true);
    expect(r.entry).toBeCloseTo(1.09988, 5);
  });

  it('skips when feature disabled', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1 },
      { enableSpreadEntryAdjust: false, spreadEntryRules: [{ symbol: 'EURUSD', spreadPips: 2 }] }
    );
    expect(r.adjusted).toBe(false);
    expect(r.entry).toBeCloseTo(1.1);
  });
});

describe('applySignalExecutionTransforms', () => {
  it('sets signalEntry only when execution entry differs', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.095, tp: [1.15] },
      { executionEntryMode: 'blend', executionEntryBlendPct: 100, lotMode: 'fixed', useRR: false, useDefaultSlTp: false, tpMode: 'first' }
    );
    expect(s.signalEntry).toBeCloseTo(1.1);
    expect(s.entry).toBeCloseTo(1.12);
    expect(s.tp[0]).toBeCloseTo(1.17);
  });

  it('recalculates TP with useRR from execution entry to SL', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.09, tp: [9] },
      {
        executionEntryMode: 'avg',
        rrEntryAnchor: 'execution',
        useRR: true,
        rrRatio: 2,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.entry).toBeCloseTo(1.12);
    const risk = Math.abs(1.12 - 1.09);
    expect(s.tp[0]).toBeCloseTo(1.12 + risk * 2);
  });

  it('useRR with rrEntryAnchor signal measures TP from Telegram line × RR', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.09, tp: [9] },
      {
        executionEntryMode: 'avg',
        rrEntryAnchor: 'signal',
        useRR: true,
        rrRatio: 2,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.signalEntry).toBeCloseTo(1.1);
    expect(s.entry).toBeCloseTo(1.12);
    const risk = Math.abs(1.1 - 1.09);
    expect(s.tp[0]).toBeCloseTo(1.1 + risk * 2);
  });

  it('useRR auto uses signal anchor when lotMode is not signal', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.17042, avgEntry: 1.17051, sl: 1.16909, tp: [1.18] },
      {
        executionEntryMode: 'signal',
        lotMode: 'percentage',
        rrEntryAnchor: 'auto',
        useRR: true,
        rrRatio: 2,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.signalEntry).toBeUndefined();
    expect(s.entry).toBeCloseTo(1.17042);
    const risk = Math.abs(1.17042 - 1.16909);
    expect(s.tp[0]).toBeCloseTo(1.17042 + risk * 2);
  });

  it('useRR auto uses signal anchor when lot mode is signal (EXEC adjust off, ENTRY unchanged)', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.09, tp: [9] },
      {
        executionEntryMode: 'avg',
        lotMode: 'signal',
        rrEntryAnchor: 'auto',
        useRR: true,
        rrRatio: 2,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.entry).toBeCloseTo(1.1);
    const riskSig = Math.abs(1.1 - 1.09);
    expect(s.tp[0]).toBeCloseTo(1.1 + riskSig * 2);
  });

  it('useRR auto keeps execution anchor when lot and EXEC both follow signal ENTRY', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.09, tp: [9] },
      {
        executionEntryMode: 'signal',
        lotMode: 'signal',
        rrEntryAnchor: 'auto',
        useRR: true,
        rrRatio: 2,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.signalEntry).toBeUndefined();
    expect(s.entry).toBeCloseTo(1.1);
    const risk = Math.abs(1.1 - 1.09);
    expect(s.tp[0]).toBeCloseTo(1.1 + risk * 2);
  });

  it('does not set signalEntry when entry unchanged', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.09, tp: [1.13] },
      { executionEntryMode: 'signal', lotMode: 'fixed', useRR: false, useDefaultSlTp: false, tpMode: 'first' }
    );
    expect(s.signalEntry).toBeUndefined();
    expect(s.entry).toBeCloseTo(1.1);
  });

  it('blend with obEdge keeps entry and telegram TP when ENTRY is already midpoint', () => {
    const s = applySignalExecutionTransforms(
      {
        symbol: 'US100.cash',
        type: 'BUY',
        entry: 29070.08,
        obEdge: 29073.25,
        avgEntry: 29066.91,
        sl: 29050.75,
        tp: [29108.74]
      },
      {
        executionEntryMode: 'blend',
        executionEntryBlendPct: 50,
        lotMode: 'fixed',
        useRR: false,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.signalEntry).toBeUndefined();
    expect(s.entry).toBeCloseTo(29070.08, 2);
    expect(s.tp[0]).toBeCloseTo(29108.74, 2);
  });

  it('rebases telegram TPs when blend moves entry and useRR off', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'EURUSD', type: 'BUY', entry: 1.1, avgEntry: 1.12, sl: 1.095, tp: [1.15] },
      {
        executionEntryMode: 'blend',
        executionEntryBlendPct: 50,
        lotMode: 'fixed',
        useRR: false,
        useDefaultSlTp: false,
        tpMode: 'separate'
      }
    );
    expect(s.signalEntry).toBeCloseTo(1.1);
    expect(s.entry).toBeCloseTo(1.11);
    expect(s.tp[0]).toBeCloseTo(1.16);
  });

  it('spread offset keeps telegram TP (absolute chart target)', () => {
    const s = applySignalExecutionTransforms(
      {
        symbol: 'US100.cash',
        type: 'BUY',
        entry: 21000,
        sl: 20950,
        tp: [21100],
        spreadPips: 150,
        spreadAsk: 21001.5,
        spreadBid: 21000
      },
      {
        enableSpreadEntryAdjust: true,
        spreadEntryRules: [{ symbol: 'US100' }],
        lotMode: 'fixed',
        useRR: false,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.signalEntry).toBeCloseTo(21000);
    expect(s.entry).toBeCloseTo(20998.5);
    expect(s.spreadEntryOffsetPips).toBe(150);
    expect(s.tp[0]).toBeCloseTo(21100);
  });

  it('US100: broker pip fallback avoids 100x spread over-shift', () => {
    const r = applySpreadEntryOffset(
      { symbol: 'US100.cash', type: 'BUY', entry: 20080, sl: 20020.23, spreadPips: 150 },
      { enableSpreadEntryAdjust: true, spreadEntryAllPairs: true, spreadEntryRules: [] }
    );
    expect(r.adjusted).toBe(true);
    expect(r.entry).toBeCloseTo(20078.5);
  });

  it('US100: skips spread when it would invalidate SL', () => {
    const r = applySpreadEntryOffset(
      {
        symbol: 'US100.cash',
        type: 'BUY',
        entry: 20080,
        sl: 20020,
        spreadPips: 6100
      },
      { enableSpreadEntryAdjust: true, spreadEntryAllPairs: true, spreadEntryRules: [] }
    );
    expect(r.adjusted).toBe(false);
    expect(r.spreadSkippedInvalidSl).toBe(true);
    expect(r.entry).toBeCloseTo(20080);
  });

  it('GBPJPY SELL: spread + useRR execution anchor keeps 2R from Telegram line', () => {
    const s = applySignalExecutionTransforms(
      {
        symbol: 'GBPJPY',
        type: 'SELL',
        entry: 214.195,
        obEdge: 214.165,
        avgEntry: 214.225,
        sl: 214.377,
        tp: [213.832],
        spreadPips: 3
      },
      {
        executionEntryMode: 'blend',
        executionEntryBlendPct: 50,
        executionEntryAdjust: true,
        enableSpreadEntryAdjust: true,
        spreadEntryRules: [{ symbol: 'GBPJPY' }],
        useRR: true,
        rrRatio: 2,
        rrEntryAnchor: 'execution',
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    expect(s.entry).toBeCloseTo(214.225);
    expect(s.signalEntry).toBeCloseTo(214.195);
    expect(s.tp[0]).toBeCloseTo(213.831, 2);
    const risk = Math.abs(214.195 - 214.377);
    expect(Math.abs(s.tp[0] - (214.195 - risk * 2))).toBeLessThan(0.002);
  });

  it('auto-applies RR TP when lotMode is risk even if useRR setting is off', () => {
    const s = applySignalExecutionTransforms(
      { symbol: 'GBPJPY', type: 'BUY', entry: 213.669, sl: 213.58, tp: [213.913] },
      {
        lotMode: 'risk',
        riskAmount: 250,
        useRR: false,
        rrRatio: 2,
        useDefaultSlTp: false,
        tpMode: 'first'
      }
    );
    const risk = Math.abs(213.669 - 213.58);
    expect(s.tp[0]).toBeCloseTo(213.669 + risk * 2, 2);
  });

  it('attachRrSnapForMt5 snaps market orders whenever RR TP is active', () => {
    const { attachRrSnapForMt5 } = require('../src/main/signalExecutionApply');
    const out = attachRrSnapForMt5(
      { symbol: 'GBPJPY', type: 'BUY', entry: 213.669, orderType: 'MARKET', spreadEntryOffsetPips: 3 },
      { lotMode: 'risk', useRR: false, rrRatio: 2 }
    );
    expect(out.rrSnapTpToFill).toBe(true);
    expect(out.rrRatio).toBe(2);
  });
});
