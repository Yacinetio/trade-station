import { it as test } from 'vitest';
const assert = require('node:assert/strict');
const {
  symbolsLikelySame,
  pickBestAckCandidate,
  filterCandidatesByAckSymbolType
} = require('../src/main/ackTradeMatch');

const isAckMatchableOpenStatus = (status) => {
  const s = String(status || '').toUpperCase();
  if (s.startsWith('BLOCKED')) return false;
  if (s === 'SIMULATED' || s === 'CLOSING') return false;
  return true;
};

const deps = { isAckMatchableOpenStatus };

test('symbolsLikelySame matches broker suffix variants', () => {
  assert.equal(symbolsLikelySame('XAUUSD', 'XAUUSDm'), true);
  assert.equal(symbolsLikelySame('US100.c', 'US100CASH'), true);
  assert.equal(symbolsLikelySame('GBPJPY', 'USDCHF'), false);
});

test('pickBestAckCandidate refuses cross-symbol merge when ack has symbol', () => {
  const gbpjpy = {
    id: 'tg-1',
    symbol: 'GBPJPY',
    type: 'BUY',
    status: 'SENT',
    fromTelegramSignal: true,
    openedAt: '2026-06-22T10:00:00.000Z'
  };
  const xau = {
    id: 'tg-2',
    symbol: 'XAUUSD',
    type: 'BUY',
    status: 'SENT',
    fromTelegramSignal: true,
    openedAt: '2026-06-22T10:05:00.000Z'
  };
  const ack = {
    symbol: 'USDCHF',
    type: 'SELL',
    trade: { symbol: 'USDCHF', type: 'SELL', entry: 0.81314, sl: 0.81188, tp: 0.81551 }
  };

  const picked = pickBestAckCandidate([gbpjpy, xau], ack, deps);
  assert.equal(picked, null);
});

test('pickBestAckCandidate picks same-symbol row when multiple open signals exist', () => {
  const gbpjpyOld = {
    id: 'tg-1',
    symbol: 'GBPJPY',
    type: 'BUY',
    status: 'SENT',
    fromTelegramSignal: true,
    openedAt: '2026-06-22T09:00:00.000Z'
  };
  const gbpjpyNew = {
    id: 'tg-2',
    symbol: 'GBPJPY',
    type: 'BUY',
    status: 'SENT',
    fromTelegramSignal: true,
    openedAt: '2026-06-22T10:00:00.000Z'
  };
  const usdchf = {
    id: 'tg-3',
    symbol: 'USDCHF',
    type: 'SELL',
    status: 'SENT',
    fromTelegramSignal: true,
    openedAt: '2026-06-22T10:05:00.000Z'
  };
  const ack = {
    trade: { symbol: 'GBPJPY', type: 'BUY', entry: 212.5, sl: 212.0, tp: 213.5 }
  };

  const picked = pickBestAckCandidate([gbpjpyOld, gbpjpyNew, usdchf], ack, deps);
  assert.equal(picked.id, 'tg-2');
});

test('pickBestAckCandidate prefers Telegram row when broker id matches both', () => {
  const telegram = {
    id: 'tg-1',
    symbol: 'GBPJPY',
    type: 'BUY',
    status: 'SENT',
    fromTelegramSignal: true,
    mt5PositionId: '1001',
    openedAt: '2026-06-22T09:00:00.000Z'
  };
  const mt5Sync = {
    id: 'mt5-1001',
    symbol: 'GBPJPY',
    type: 'BUY',
    status: 'POSITION_UPDATE',
    channel: 'MT5 Auto',
    mt5PositionId: '1001',
    openedAt: '2026-06-22T10:00:00.000Z'
  };
  const ack = {
    positionId: '1001',
    trade: { symbol: 'GBPJPY', type: 'BUY', entry: 212.5, sl: 212.0, tp: 213.5 }
  };

  const picked = pickBestAckCandidate([mt5Sync, telegram], ack, deps);
  assert.equal(picked.id, 'tg-1');
});
