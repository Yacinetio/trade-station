import { describe, it, expect } from 'vitest';
const { parse, applyReverseSettingsToSignal } = require('../src/main/signalParser');

describe('signalParser.parse', () => {
  it('parses a clean BUY EURUSD signal', () => {
    const msg = `BUY EURUSD\nEntry: 1.1000\nSL: 1.0950\nTP1: 1.1050\nTP2: 1.1100`;
    const out = parse(msg, 'TestChan', {});
    expect(out).toBeTruthy();
    expect(String(out.type).toUpperCase()).toBe('BUY');
    expect(out.symbol).toMatch(/EURUSD/);
    expect(out.entry).toBeCloseTo(1.10, 2);
    expect(out.sl).toBeCloseTo(1.095, 3);
    expect(Array.isArray(out.tp) && out.tp.length).toBeGreaterThan(0);
  });

  it('parses XAUUSD/GOLD aliases', () => {
    const msg = `SELL GOLD @ 2350\nSL 2360\nTP 2330`;
    const out = parse(msg, 'TestChan', {});
    expect(out).toBeTruthy();
    expect(out.symbol).toMatch(/XAUUSD|GOLD/);
    expect(String(out.type).toUpperCase()).toBe('SELL');
  });

  it('returns null for non-signal chatter', () => {
    const out = parse('Good morning everyone, watch the news today.', 'TestChan', {});
    expect(out).toBeNull();
  });

  it.each([2, 3, 12])(
    'parses OB STATS when Signal: is mid-line (Merged OB x%s)',
    (mergeCount) => {
      const msg = [
        `Merged OB x${mergeCount} | Signal: SELL USDCHF M10`,
        'Bias: ▲▲ STRONG BULLISH',
        'Entry: 0.78541',
        'SL: 0.78607',
        'TP: 0.78439',
        'Lot: 2.95',
      ].join('\n');
      const out = parse(msg, 'OBChan', {});
      expect(out).toBeTruthy();
      expect(out.source).toBe('ob_stats');
      expect(String(out.type).toUpperCase()).toBe('SELL');
      expect(out.symbol).toMatch(/USDCHF/);
    }
  );

  it('parses OB STATS telegram block including Avg ENTRY', () => {
    const msg = [
      'Signal: SELL XAUUSD M30',
      'Entry: 4721.62',
      'Avg ENTRY: 4723.58',
      'SL: 4727.12',
      'TP: 4705.12',
      'Lot: 0.44',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.source).toBe('ob_stats');
    expect(out.avgEntry).toBeCloseTo(4723.58, 2);
    expect(out.entry).toBeCloseTo(4721.62, 2);
  });

  it('parses user-defined custom columns from settings', () => {
    const msg = [
      'BUY EURUSD',
      'Entry: 1.1000',
      'SL: 1.0950',
      'TP: 1.1050',
      'Zone: London open',
      'Setup: 2',
    ].join('\n');
    const settings = {
      customTradeColumns: [
        { parseKey: 'Zone', label: 'ZONE' },
        { parseKey: 'Setup', label: 'SETUP', mapToPresetTags: true }
      ],
      tradePresets: ['2', 'London']
    };
    const out = parse(msg, 'TestChan', settings);
    expect(out).toBeTruthy();
    expect(out.customFields.zone).toBe('London open');
    expect(out.customFields.custom_setup).toBe('2');
    expect(out.presetTags).toContain('2');
  });

  it('parses OB STATS VWAP and HVN lines', () => {
    const msg = [
      'Signal: BUY EURUSD M15',
      'Entry: 1.05',
      'SL: 1.04',
      'TP: 1.07',
      'VWAP: YES',
      'HVN: NO',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.source).toBe('ob_stats');
    expect(out.vwapBand).toBe('yes');
    expect(out.hvnBand).toBe('no');
  });

  it('parses OB STATS trend alignment and OB size lines', () => {
    const msg = [
      'Signal: BUY EURUSD M15',
      'Bias: ▲▲ STRONG BULLISH',
      'Entry: 1.05',
      'SL: 1.04',
      'TP: 1.07',
      'VWAP: YES',
      'HVN: NO',
      'Trend: WITH',
      'OB size: 42 pips',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.source).toBe('ob_stats');
    expect(out.trendAlign).toBe('with');
    expect(out.obSize).toBe('42 pips');
  });

  it('parses OB STATS SMC meta lines (confluence, rej, wr, top1, session)', () => {
    const msg = [
      'Signal: BUY XAUUSD H4',
      'TF: H4 · 42 ob',
      'Bias: ▲▲ STRONG BULLISH',
      'Entry: 2650.00',
      'SL: 2640.00',
      'TP: 2670.00',
      'Rej: 55%',
      'WR: 48%',
      'Lot: 0.10',
      'VWAP: YES',
      'HVN: NO',
      'Trend: WITH',
      'OB size: 35 pips',
      'Confluence: 3',
      'Rej: 72%',
      'WR: 61%',
      'Top1: YES',
      'Session: London',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.source).toBe('ob_stats');
    expect(out.confluence).toBe(3);
    expect(out.rejPct).toBeCloseTo(72, 0);
    expect(out.obWinRate).toBeCloseTo(61, 0);
    expect(out.top1).toBe(true);
    expect(out.signalSession).toBe('london');
  });

  it('OB STATS SMC meta lines omitted when absent', () => {
    const msg = [
      'Signal: BUY EURUSD M15',
      'Entry: 1.05',
      'SL: 1.04',
      'TP: 1.07',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.confluence).toBeUndefined();
    expect(out.rejPct).toBeUndefined();
    expect(out.obWinRate).toBeUndefined();
    expect(out.top1).toBeUndefined();
    expect(out.signalSession).toBeUndefined();
  });

  it('OB STATS SMC meta lines omitted when malformed', () => {
    const msg = [
      'Signal: BUY EURUSD M15',
      'Entry: 1.05',
      'SL: 1.04',
      'TP: 1.07',
      'Confluence: abc',
      'Rej: xyz%',
      'WR: n/a',
      'Top1: MAYBE',
      'Session: Mars',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.confluence).toBeUndefined();
    expect(out.rejPct).toBeUndefined();
    expect(out.obWinRate).toBeUndefined();
    expect(out.top1).toBeUndefined();
    expect(out.signalSession).toBeUndefined();
  });

  it('parses OB STATS trend AGAINST on bearish bias sell', () => {
    const msg = [
      'Signal: SELL EURUSD M15',
      'Bias: ▲▲ STRONG BULLISH',
      'Entry: 1.05',
      'SL: 1.06',
      'TP: 1.03',
      'Trend: AGAINST',
      'OB size: 18 pips',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.trendAlign).toBe('against');
    expect(out.obSize).toBe('18 pips');
  });

  it('parses OB STATS block with OB edge and Avg ENTRY', () => {
    const msg = [
      'Signal: BUY US100.cash M5',
      'Entry: 29070.08',
      'OB edge: 29073.25',
      'Avg ENTRY: 29066.91',
      'SL: 29050.75',
      'TP: 29108.74',
      'Lot: 12.93',
    ].join('\n');
    const out = parse(msg, 'OBChan', {});
    expect(out).toBeTruthy();
    expect(out.source).toBe('ob_stats');
    expect(out.entry).toBeCloseTo(29070.08, 2);
    expect(out.obEdge).toBeCloseTo(29073.25, 2);
    expect(out.avgEntry).toBeCloseTo(29066.91, 2);
    expect(out.orderType).toBe('AUTO');
  });

  it('OB STATS keeps MARKET orderType when settings force market-only', () => {
    const msg = [
      'Signal: BUY US100.cash M5',
      'Entry: 29070.08',
      'OB edge: 29073.25',
      'Avg ENTRY: 29066.91',
      'SL: 29050.75',
      'TP: 29108.74',
    ].join('\n');
    const out = parse(msg, 'OBChan', { orderType: 'market' });
    expect(out).toBeTruthy();
    expect(out.orderType).toBe('MARKET');
  });

  it('keeps primary ENTRY separate when AVG ENTRY line appears first (blend setting uses both)', () => {
    const msg = [
      'BUY GER40',
      'Avg ENTRY: 4506',
      'ENTRY: 4510',
      'SL: 4490',
      'TP: 4550',
    ].join('\n');
    const out = parse(msg, 'TestChan', {});
    expect(out).toBeTruthy();
    expect(out.avgEntry).toBeCloseTo(4506, 2);
    expect(out.entry).toBeCloseTo(4510, 2);
  });
});

describe('signalParser reverse modes', () => {
  const buyMsg = `BUY EURUSD\nEntry: 1.1000\nSL: 1.0950\nTP: 1.1050`;

  it("'all' flips direction and mirrors SL↔TP1", () => {
    const out = parse(buyMsg, 'TestChan', { reverseMode: 'all' });
    expect(String(out.type).toUpperCase()).toBe('SELL');
    expect(out.sl).toBeCloseTo(1.1050, 4);
    expect(out.tp[0]).toBeCloseTo(1.0950, 4);
  });

  it("'flip' behaves exactly like 'all'", () => {
    const all = parse(buyMsg, 'TestChan', { reverseMode: 'all' });
    const flip = parse(buyMsg, 'TestChan', { reverseMode: 'flip' });
    expect(flip.type).toBe(all.type);
    expect(flip.sl).toBeCloseTo(all.sl, 5);
    expect(flip.tp[0]).toBeCloseTo(all.tp[0], 5);
  });

  it("'sl_tp_only' keeps direction but swaps SL↔TP1", () => {
    const out = parse(buyMsg, 'TestChan', { reverseMode: 'sl_tp_only' });
    expect(String(out.type).toUpperCase()).toBe('BUY');
    expect(out.sl).toBeCloseTo(1.1050, 4);
    expect(out.tp[0]).toBeCloseTo(1.0950, 4);
  });

  it("'buy'/'sell' keep flipping only the matching side", () => {
    const flipped = parse(buyMsg, 'TestChan', { reverseMode: 'buy' });
    expect(String(flipped.type).toUpperCase()).toBe('SELL');
    const untouched = parse(buyMsg, 'TestChan', { reverseMode: 'sell' });
    expect(String(untouched.type).toUpperCase()).toBe('BUY');
    expect(untouched.sl).toBeCloseTo(1.0950, 4);
  });

  it('applyReverseSettingsToSignal only swaps the first TP for sl_tp_only', () => {
    const out = applyReverseSettingsToSignal('sl_tp_only', 'SELL', 2360, [2330, 2310]);
    expect(out.type).toBe('SELL');
    expect(out.sl).toBe(2330);
    expect(out.tp).toEqual([2360, 2310]);
  });

  it('applyReverseSettingsToSignal leaves unknown modes untouched', () => {
    const out = applyReverseSettingsToSignal('none', 'BUY', 1.09, [1.11]);
    expect(out).toEqual({ type: 'BUY', sl: 1.09, tp: [1.11] });
  });
});
