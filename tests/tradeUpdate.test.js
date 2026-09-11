import { it as test } from 'vitest';
const assert = require('node:assert/strict');
const {
  buildTradePatch,
  inheritMissingTradeMetadata,
  isOpenTradeStatus,
  resolveModifyTicket,
  applyAckExecToTrade,
  findMetadataDonorForSync
} = require('../src/main/tradeUpdate');

test('buildTradePatch normalizes OB stats fields', () => {
  const patch = buildTradePatch({
    vwapBand: 'YES',
    hvnBand: 'no',
    trendAlign: 'WITH',
    fundBias: 'bearish',
    entry: '212.5',
    sl: '212.0',
    tp: '213.5'
  });
  assert.equal(patch.vwapBand, 'yes');
  assert.equal(patch.hvnBand, 'no');
  assert.equal(patch.trendAlign, 'with');
  assert.equal(patch.fundBias, 'BEARISH');
  assert.equal(patch.entry, 212.5);
});

test('inheritMissingTradeMetadata fills gaps from source row', () => {
  const target = { symbol: 'GBPJPY', entry: 212.9, fromTelegramSignal: true };
  const source = { vwapBand: 'yes', hvnBand: 'no', trendAlign: 'with', obSize: '12', bias: 'bullish' };
  const out = inheritMissingTradeMetadata(target, source);
  assert.equal(out.vwapBand, 'yes');
  assert.equal(out.obSize, '12');
  assert.equal(out.entry, 212.9);
});

test('resolveModifyTicket prefers position id', () => {
  assert.equal(resolveModifyTicket({ mt5PositionId: '1001', mt5Ticket: '999' }), '1001');
  assert.equal(resolveModifyTicket({}), '');
});

test('applyAckExecToTrade preserves existing prices when ack is zero', () => {
  const trade = { entry: 4012.94, sl: 4022.55, tp: 3993.72, lot: 0.26 };
  applyAckExecToTrade(trade, { entry: 0, sl: 0, tp: 0, lot: 0 });
  assert.equal(trade.entry, 4012.94);
  assert.equal(trade.sl, 4022.55);
});

test('applyAckExecToTrade fills missing prices on user-edited row', () => {
  const trade = { userEdited: true, entry: 0, sl: 0, tp: 0, lot: 0 };
  applyAckExecToTrade(trade, { entry: 4012.94, sl: 4022.55, tp: 3993.72, lot: 0.26 });
  assert.equal(trade.entry, 4012.94);
  assert.equal(trade.lot, 0.26);
});

test('findMetadataDonorForSync matches telegram row by symbol time profit', () => {
  const trades = [{
    id: 'tg1',
    fromTelegramSignal: true,
    symbol: 'XAUUSD',
    type: 'SELL',
    openedAt: '2026-06-25T02:35:00.000Z',
    profit: 485.13,
    bias: 'STRONG BEARISH',
    trendAlign: 'with'
  }];
  const donor = findMetadataDonorForSync(trades, {
    symbol: 'XAUUSD',
    type: 'SELL',
    openedAtIso: '2026-06-25T02:35:00.000Z',
    profit: 485.13
  });
  assert.equal(donor?.id, 'tg1');
});

test('isOpenTradeStatus treats POSITION_UPDATE as open', () => {
  assert.equal(isOpenTradeStatus('POSITION_UPDATE'), true);
  assert.equal(isOpenTradeStatus('CLOSED_SL'), false);
});
