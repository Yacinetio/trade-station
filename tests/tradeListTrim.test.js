import { describe, it } from 'vitest';
const assert = require('node:assert/strict');
const { trimTradesList, isProtectedFromTradeEviction } = require('../src/main/tradeListTrim');

describe('tradeListTrim', () => {
  it('never evicts manual or user-edited trades', () => {
    const manual = { id: 'm1', manual: true, channel: 'Manual' };
    const edited = { id: 'e1', userEdited: true, channel: 'Telegram' };
    const sync = { id: 'mt5-1', channel: 'MT5 Auto' };
    const filler = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, channel: 'MT5 Auto' }));
    const trades = [sync, ...filler, manual, edited];
    trimTradesList(trades, 200);
    assert.ok(trades.some((t) => t.id === 'm1'));
    assert.ok(trades.some((t) => t.id === 'e1'));
  });

  it('prefers removing MT5 Auto rows first', () => {
    const telegram = { id: 'tg1', fromTelegramSignal: true, channel: 'OB' };
    const syncRows = Array.from({ length: 201 }, (_, i) => ({ id: `s${i}`, channel: 'MT5 Auto' }));
    const trades = [telegram, ...syncRows];
    trimTradesList(trades, 200);
    assert.ok(trades.some((t) => t.id === 'tg1'));
    assert.ok(trades.length <= 200);
  });

  it('isProtectedFromTradeEviction covers manual channel', () => {
    assert.equal(isProtectedFromTradeEviction({ channel: 'Manual' }), true);
    assert.equal(isProtectedFromTradeEviction({ channel: 'MT5 Auto' }), false);
  });
});
