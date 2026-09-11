import { it as test } from 'vitest';
const assert = require('node:assert/strict');
const {
  applyExcursionPayload,
  extractExcursionFromPayload,
  findTradeForExcursion,
  sanitizePnlSeries
} = require('../src/main/excursionStore');

function makeTrades() {
  return [
    {
      id: 'tg-1',
      symbol: 'GBPJPY',
      type: 'BUY',
      status: 'SENT',
      mt5PositionId: '1001',
      mt5Ticket: '1001'
    },
    {
      id: 'tg-2',
      symbol: 'EURUSD',
      type: 'SELL',
      status: 'SENT',
      mt5PositionId: '2002'
    },
    {
      id: 'mt5-3003',
      symbol: 'XAUUSD',
      type: 'BUY',
      status: 'POSITION_UPDATE',
      mt5DealId: '3003'
    }
  ];
}

test('extractExcursionFromPayload: null when the ACK carries no excursion fields', () => {
  assert.equal(extractExcursionFromPayload({ status: 'POSITION_UPDATE', profit: 12 }), null);
  assert.equal(extractExcursionFromPayload({}), null);
});

test('applyExcursionPayload merges by positionId (POSITION_UPDATE shape)', () => {
  const trades = makeTrades();
  const res = applyExcursionPayload(trades, {
    status: 'POSITION_UPDATE',
    positionId: '1001',
    mfePips: 12.5,
    maePips: 3.1,
    mfeMoney: 125.0,
    maeMoney: 31.0
  });
  assert.equal(res.changed, true);
  assert.equal(res.trade.id, 'tg-1');
  assert.equal(res.trade.excursion.mfePips, 12.5);
  assert.equal(res.trade.excursion.maePips, 3.1);
  assert.equal(res.trade.excursion.mfeMoney, 125);
  assert.equal(res.trade.excursion.maeMoney, 31);
  assert.equal(res.trade.excursion.source, 'ea');
  assert.ok(res.trade.excursion.updatedAt);
  assert.equal('pnlSeries' in res.trade.excursion, false);
});

test('applyExcursionPayload matches by app tradeId before broker ids', () => {
  const trades = makeTrades();
  const res = applyExcursionPayload(trades, {
    status: 'POSITION_UPDATE',
    positionId: '9999', // unknown broker id — tradeId must win
    trade: { tradeId: 'tg-2', symbol: 'EURUSD', type: 'SELL' },
    mfePips: 5,
    maePips: 2,
    mfeMoney: 50,
    maeMoney: 20
  });
  assert.equal(res.changed, true);
  assert.equal(res.trade.id, 'tg-2');
});

test('applyExcursionPayload matches by dealId and treats "0" ids as missing', () => {
  const trades = makeTrades();
  const res = applyExcursionPayload(trades, {
    status: 'CLOSED',
    positionId: '0',
    dealId: '3003',
    mfePips: 7,
    maePips: 1,
    mfeMoney: 70,
    maeMoney: 10
  });
  assert.equal(res.changed, true);
  assert.equal(res.trade.id, 'mt5-3003');
});

test('applyExcursionPayload: peaks only grow, close flush attaches pnlSeries', () => {
  const trades = makeTrades();
  const trade = trades[0];

  applyExcursionPayload(trades, { positionId: '1001', mfePips: 20, maePips: 5, mfeMoney: 200, maeMoney: 50 });
  // A later update with LOWER numbers (e.g. money recomputed after partial close) must not shrink peaks.
  applyExcursionPayload(trades, { positionId: '1001', mfePips: 15, maePips: 8, mfeMoney: 150, maeMoney: 80 });
  assert.equal(trade.excursion.mfePips, 20);
  assert.equal(trade.excursion.maePips, 8);
  assert.equal(trade.excursion.mfeMoney, 200);
  assert.equal(trade.excursion.maeMoney, 80);

  // Final close ACK flushes the sampled series.
  const series = [[1750000000, 0], [1750000030, 12.5], [1750000060, -3]];
  const res = applyExcursionPayload(trades, {
    status: 'CLOSED_TP',
    positionId: '1001',
    mfePips: 22,
    maePips: 8,
    mfeMoney: 220,
    maeMoney: 80,
    pnlSeries: series
  });
  assert.equal(res.changed, true);
  assert.deepEqual(trade.excursion.pnlSeries, series);
  assert.equal(trade.excursion.mfePips, 22);

  // A later payload WITHOUT a series keeps the stored one.
  applyExcursionPayload(trades, { positionId: '1001', mfePips: 22, maePips: 8, mfeMoney: 220, maeMoney: 80 });
  assert.deepEqual(trade.excursion.pnlSeries, series);
});

test('applyExcursionPayload: no-op on payloads without excursion data or without a match', () => {
  const trades = makeTrades();
  assert.equal(applyExcursionPayload(trades, { status: 'POSITION_UPDATE', positionId: '1001', profit: 5 }).changed, false);
  assert.equal(trades[0].excursion, undefined);
  assert.equal(applyExcursionPayload(trades, { positionId: 'unknown-1', mfePips: 1, maePips: 1 }).changed, false);
});

test('applyExcursionPayload honours preferTrade resolved by the caller ack matching', () => {
  const trades = makeTrades();
  // No ids the store could match on its own — main.js already resolved the trade.
  const res = applyExcursionPayload(
    trades,
    { status: 'POSITION_UPDATE', mfePips: 4, maePips: 1, mfeMoney: 40, maeMoney: 10 },
    { preferTrade: trades[1] }
  );
  assert.equal(res.changed, true);
  assert.equal(res.trade.id, 'tg-2');
  assert.equal(trades[1].excursion.mfePips, 4);
});

test('sanitizePnlSeries: drops junk, sorts by time and caps to ~400 keeping the last point', () => {
  assert.equal(sanitizePnlSeries(null), null);
  assert.equal(sanitizePnlSeries([['x', 1], [null, 2]]), null);

  const unsorted = [[1750000060, -3], [1750000000, 0], [1750000030, 12.5], ['bad', 1]];
  assert.deepEqual(sanitizePnlSeries(unsorted), [[1750000000, 0], [1750000030, 12.5], [1750000060, -3]]);

  const big = Array.from({ length: 1000 }, (_, i) => [1750000000 + i * 30, i]);
  const capped = sanitizePnlSeries(big);
  assert.ok(capped.length <= 401, `capped length ${capped.length}`);
  assert.deepEqual(capped[0], big[0]);
  assert.deepEqual(capped[capped.length - 1], big[big.length - 1]);
});

test('findTradeForExcursion falls back over positionId/ticket/dealId fields', () => {
  const trades = makeTrades();
  assert.equal(findTradeForExcursion(trades, { ticket: '1001' })?.id, 'tg-1');
  assert.equal(findTradeForExcursion(trades, { trade: { positionId: '2002' } })?.id, 'tg-2');
  assert.equal(findTradeForExcursion(trades, { dealId: '3003' })?.id, 'mt5-3003');
  assert.equal(findTradeForExcursion(trades, { positionId: '0' }), null);
});
