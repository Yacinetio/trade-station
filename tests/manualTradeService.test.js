import { describe, it, expect } from 'vitest';
const {
  parseTelegramForManual,
  createManualTrade,
  outcomeToStatus,
  MANUAL_TRADE_CHANNEL
} = require('../src/main/manualTradeService');

const SAMPLE = `Signal: BUY EURUSD M10
Time: 2026.05.18 15:16
TF: M10 · 299 ob
Bias: ▲ WEAK BULLISH
Price: 1.16430
Entry: 1.16426
OB edge: 1.16434
Avg ENTRY: 1.16417
SL: 1.16376
TP: 1.16525
R:R: 1:2.0
Lot: 5.03
VWAP: NO
HVN: YES`;

describe('manualTradeService', () => {
  it('parses OB stats telegram block', () => {
    const r = parseTelegramForManual(SAMPLE, {});
    expect(r.ok).toBe(true);
    expect(r.fields.symbol).toMatch(/EURUSD/);
    expect(r.fields.type).toBe('BUY');
    expect(r.fields.entry).toBeCloseTo(1.16426, 5);
    expect(r.fields.sl).toBeCloseTo(1.16376, 5);
    expect(r.fields.tp).toBeCloseTo(1.16525, 5);
    expect(r.fields.lot).toBeCloseTo(5.03, 2);
    expect(r.fields.obEdge).toBeCloseTo(1.16434, 5);
    expect(r.fields.avgEntry).toBeCloseTo(1.16417, 5);
    expect(r.fields.vwapBand).toBe('no');
    expect(r.fields.hvnBand).toBe('yes');
    expect(r.fields.openedAt).toContain('2026-05-18');
  });

  it('creates closed manual trade on Manual channel', () => {
    const trade = createManualTrade(
      {
        telegramText: SAMPLE,
        outcome: 'tp',
        profit: 42.5
      },
      {
        normalizeTradeForStorage: (t) => t,
        account: { key: '1@Demo', login: '1', server: 'Demo' }
      }
    );
    expect(trade.channel).toBe(MANUAL_TRADE_CHANNEL);
    expect(trade.status).toBe(outcomeToStatus('tp'));
    expect(trade.profit).toBeCloseTo(42.5, 2);
    expect(trade.manual).toBe(true);
    expect(trade.symbol).toMatch(/EURUSD/);
  });

  it('BE outcome uses zero profit', () => {
    const trade = createManualTrade(
      {
        fields: {
          symbol: 'EURUSD',
          type: 'BUY',
          entry: 1.1,
          sl: 1.09,
          tp: 1.12,
          lot: 0.1
        },
        outcome: 'be',
        profit: 99
      },
      { normalizeTradeForStorage: (t) => t, account: {} }
    );
    expect(trade.status).toBe('CLOSED_SL');
    expect(trade.profit).toBe(0);
  });
});
