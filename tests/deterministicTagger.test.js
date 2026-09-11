import { describe, it, expect } from 'vitest';
import {
  computeAutoTags,
  applyAutoTags,
  sessionTagFromUtcHour,
  openMs,
  closeMs
} from '../src/main/aiAgents/deterministicTagger.js';

function trade(overrides = {}) {
  return {
    id: overrides.id || `t_${Math.random().toString(36).slice(2, 8)}`,
    accountKey: 'acc1',
    symbol: 'EURUSD',
    type: 'BUY',
    lot: 0.1,
    sl: 1.08,
    profit: 10,
    status: 'CLOSED',
    openedAt: '2026-07-02T10:00:00.000Z',
    closedAt: '2026-07-02T11:00:00.000Z',
    journal: { tags: [] },
    ...overrides
  };
}

describe('deterministicTagger', () => {
  describe('session boundaries', () => {
    it('maps UTC hours to session tags', () => {
      expect(sessionTagFromUtcHour(0)).toBe('session:asian');
      expect(sessionTagFromUtcHour(6)).toBe('session:asian');
      expect(sessionTagFromUtcHour(7)).toBe('session:london');
      expect(sessionTagFromUtcHour(12)).toBe('session:london');
      expect(sessionTagFromUtcHour(13)).toBe('session:newyork');
      expect(sessionTagFromUtcHour(20)).toBe('session:newyork');
      expect(sessionTagFromUtcHour(21)).toBe('session:late');
      expect(sessionTagFromUtcHour(23)).toBe('session:late');
    });

    it('tags openedAt hour on trade', () => {
      const t = trade({ openedAt: '2026-07-02T08:30:00.000Z' });
      expect(computeAutoTags(t, [t], {})).toContain('session:london');
    });
  });

  describe('no-sl', () => {
    it('flags missing or zero stop loss', () => {
      expect(computeAutoTags(trade({ sl: 0 }), [], {})).toContain('no-sl');
      expect(computeAutoTags(trade({ sl: null }), [], {})).toContain('no-sl');
      expect(computeAutoTags(trade({ sl: 1.05 }), [], {})).not.toContain('no-sl');
    });
  });

  describe('revenge window', () => {
    it('flags entry just under 15 min after a loss on same account', () => {
      const loss = trade({
        id: 'loss1',
        profit: -50,
        closedAt: '2026-07-02T12:00:00.000Z',
        openedAt: '2026-07-02T11:00:00.000Z'
      });
      const revenge = trade({
        id: 'rev1',
        openedAt: '2026-07-02T12:14:59.000Z',
        closedAt: '2026-07-02T13:00:00.000Z'
      });
      const all = [loss, revenge];
      expect(computeAutoTags(revenge, all, {})).toContain('revenge-candidate');
    });

    it('does not flag at or beyond 15 min after loss', () => {
      const loss = trade({
        id: 'loss2',
        profit: -30,
        closedAt: '2026-07-02T12:00:00.000Z'
      });
      const ok = trade({
        id: 'ok1',
        openedAt: '2026-07-02T12:15:00.000Z',
        closedAt: '2026-07-02T13:00:00.000Z'
      });
      expect(computeAutoTags(ok, [loss, ok], {})).not.toContain('revenge-candidate');
    });
  });

  describe('oversized median math', () => {
    it('flags lot > 2× median of last 20 closed same-account trades', () => {
      const prior = [];
      for (let i = 0; i < 20; i += 1) {
        prior.push(trade({
          id: `p${i}`,
          lot: 0.1,
          closedAt: new Date(Date.UTC(2026, 6, 1, 10, i)).toISOString(),
          openedAt: new Date(Date.UTC(2026, 6, 1, 9, i)).toISOString()
        }));
      }
      const big = trade({
        id: 'big',
        lot: 0.25,
        openedAt: '2026-07-02T14:00:00.000Z',
        closedAt: '2026-07-02T15:00:00.000Z'
      });
      expect(computeAutoTags(big, [...prior, big], {})).toContain('oversized');
      const normal = trade({ id: 'norm', lot: 0.15, openedAt: '2026-07-02T16:00:00.000Z', closedAt: '2026-07-02T17:00:00.000Z' });
      expect(computeAutoTags(normal, [...prior, normal], {})).not.toContain('oversized');
    });
  });

  describe('overtrading threshold', () => {
    it('uses settings.aiAgents.overtradingThreshold default 6', () => {
      const day = '2026-07-02T';
      const many = [];
      for (let i = 0; i < 6; i += 1) {
        many.push(trade({
          id: `o${i}`,
          openedAt: `${day}${String(8 + i).padStart(2, '0')}:00:00.000Z`,
          closedAt: `${day}${String(9 + i).padStart(2, '0')}:00:00.000Z`
        }));
      }
      const tags = computeAutoTags(many[5], many, {});
      expect(tags).toContain('overtrading-day');
    });

    it('respects custom threshold', () => {
      const many = [];
      for (let i = 0; i < 4; i += 1) {
        many.push(trade({
          id: `c${i}`,
          openedAt: `2026-07-03T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
          closedAt: `2026-07-03T${String(11 + i).padStart(2, '0')}:00:00.000Z`
        }));
      }
      expect(computeAutoTags(many[3], many, { aiAgents: { overtradingThreshold: 4 } })).toContain('overtrading-day');
      expect(computeAutoTags(many[3], many, { aiAgents: { overtradingThreshold: 10 } })).not.toContain('overtrading-day');
    });
  });

  describe('applyAutoTags dedup and user tags', () => {
    it('preserves user tags and dedupes auto tags', () => {
      const t = trade({
        id: 'u1',
        journal: { tags: ['my-setup', 'no-sl'] },
        sl: 0
      });
      const { updatedTrades, changes } = applyAutoTags([t], {});
      expect(updatedTrades[0].journal.tags).toContain('my-setup');
      expect(updatedTrades[0].journal.tags).toContain('no-sl');
      expect(updatedTrades[0].journal.tags.filter((x) => x === 'no-sl')).toHaveLength(1);
      expect(updatedTrades[0].journal.autoTaggedAt).toBeTruthy();
      expect(changes.some((c) => c.tradeId === 'u1')).toBe(true);
    });

    it('never removes existing user tags', () => {
      const t = trade({ id: 'u2', journal: { tags: ['custom-edge'] }, sl: 1.05 });
      const { updatedTrades } = applyAutoTags([t], {});
      expect(updatedTrades[0].journal.tags).toContain('custom-edge');
    });
  });

  describe('weekend-held and big winner/loser', () => {
    it('flags Friday open closed Monday+', () => {
      const t = trade({
        openedAt: '2026-07-03T15:00:00.000Z',
        closedAt: '2026-07-06T10:00:00.000Z'
      });
      expect(computeAutoTags(t, [t], {})).toContain('weekend-held');
    });

    it('flags big-winner when |profit| > 2× avg |profit| with min 10 closed', () => {
      const base = [];
      for (let i = 0; i < 10; i += 1) {
        base.push(trade({ id: `b${i}`, profit: 10, openedAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, closedAt: `2026-06-${String(i + 1).padStart(2, '0')}T11:00:00.000Z` }));
      }
      const winner = trade({ id: 'win', profit: 50, openedAt: '2026-07-02T10:00:00.000Z', closedAt: '2026-07-02T11:00:00.000Z' });
      expect(computeAutoTags(winner, [...base, winner], {})).toContain('big-winner');
    });
  });

  it('exports openMs and closeMs helpers', () => {
    const t = trade();
    expect(openMs(t)).toBeTruthy();
    expect(closeMs(t)).toBeTruthy();
  });
});
