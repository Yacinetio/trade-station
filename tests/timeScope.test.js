import { describe, expect, it } from 'vitest';

const { tradeMatchesTimeScope, parseTradeDateLikeAnalytics } = require('../src/main/timeScope');

describe('timeScope trade dates', () => {
  const day = new Date(2024, 5, 25, 15, 0, 0);

  it('uses closedAt for closed trades in DAY scope', () => {
    const trade = {
      status: 'CLOSED_SL',
      openedAt: '2024-01-01T10:00:00.000Z',
      closedAt: '2024-06-25T14:00:00.000Z',
      lastUpdateAt: '2026-06-25T11:00:00.000Z'
    };
    expect(tradeMatchesTimeScope(trade, 'DAY', day)).toBe(true);
    expect(parseTradeDateLikeAnalytics(trade).getUTCDate()).toBe(25);
  });

  it('does not use lastUpdateAt for scope', () => {
    const trade = {
      status: 'CLOSED',
      openedAt: '2024-01-01T10:00:00.000Z',
      lastUpdateAt: '2026-06-25T11:00:00.000Z'
    };
    expect(tradeMatchesTimeScope(trade, 'DAY', day)).toBe(false);
  });

  it('uses openedAt for live trades', () => {
    const trade = {
      status: 'SENT',
      openedAt: '2024-06-25T08:00:00.000Z'
    };
    expect(tradeMatchesTimeScope(trade, 'DAY', day)).toBe(true);
  });
});
