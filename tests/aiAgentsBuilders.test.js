import { describe, it, expect, vi } from 'vitest';
import { buildBriefingContext, upcomingHighImpactEvents } from '../src/main/aiAgents/briefingAgent.js';
import { buildSessionReviewContext, dailyLossCapBreached } from '../src/main/aiAgents/sessionReviewAgent.js';
import { buildExtraChatContext } from '../src/main/aiAgents/chatContextProviders.js';
import { parseSuggestionsFromAiReply } from '../src/main/aiAgents/aiTagSuggester.js';

function closedTrade(id, profit, closedAt, extras = {}) {
  return {
    id,
    status: 'CLOSED',
    profit,
    closedAt,
    openedAt: closedAt,
    symbol: 'XAUUSD',
    type: 'BUY',
    journal: { tags: [], ...(extras.journal || {}) },
    ...extras
  };
}

describe('aiAgents builders', () => {
  describe('buildBriefingContext', () => {
    it('assembles open risk, sessions, events, strategies from fixtures', () => {
      const trades = [
        { id: 'o1', status: 'OPEN', symbol: 'EURUSD', type: 'BUY', profit: 5, riskUsd: 100, openedAt: '2026-07-02T08:00:00.000Z' },
        closedTrade('c1', 20, '2026-07-01T15:00:00.000Z', { strategyId: 's1' }),
        closedTrade('c2', -10, '2026-07-01T16:00:00.000Z', { strategyId: 's1' })
      ];
      const fundamentals = {
        calendar: {
          allEvents: [
            { title: 'NFP', currency: 'USD', impact: 3, minutesToEvent: 120 },
            { title: 'Low impact', currency: 'EUR', impact: 1, minutesToEvent: 60 }
          ]
        }
      };
      const strategies = [{ id: 's1', name: 'London Breakout' }];
      const ctx = buildBriefingContext({
        trades,
        settings: {},
        fundamentals,
        strategies,
        notebookDaily: { body: 'Yesterday I overtraded.' }
      });

      expect(ctx.openRisk.openCount).toBe(1);
      expect(ctx.openRisk.totalRiskUsd).toBe(100);
      expect(ctx.lastSessions.length).toBeGreaterThan(0);
      expect(ctx.upcomingEvents).toHaveLength(1);
      expect(ctx.upcomingEvents[0].title).toBe('NFP');
      expect(ctx.topStrategies[0].name).toBe('London Breakout');
      expect(ctx.yesterdayRecap).toContain('overtraded');
    });

    it('filters high-impact events within 24h', () => {
      const events = upcomingHighImpactEvents({
        calendar: {
          allEvents: [
            { title: 'Soon', impact: 3, minutesToEvent: 30 },
            { title: 'Later', impact: 3, minutesToEvent: 2000 },
            { title: 'Low', impact: 1, minutesToEvent: 10 }
          ]
        }
      }, 24);
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Soon');
    });
  });

  describe('buildSessionReviewContext', () => {
    it('flags breach tags and picks best/worst', () => {
      const dateKey = '2026-07-02';
      const trades = [
        closedTrade('a', 50, '2026-07-02T10:00:00.000Z'),
        closedTrade('b', -80, '2026-07-02T14:00:00.000Z', {
          journal: { tags: ['revenge-candidate', 'oversized'], emotion: 'revenge' }
        })
      ];
      const ctx = buildSessionReviewContext({
        dateKey,
        trades,
        settings: { enableDailyLoss: true, maxDailyLoss: 50 },
        briefingMd: '## Focus\nWait for London open.'
      });

      expect(ctx.tradeCount).toBe(2);
      expect(ctx.breachFlags.revengeTrades).toBe(1);
      expect(ctx.breachFlags.oversizedTrades).toBe(1);
      expect(ctx.best.profit).toBe(50);
      expect(ctx.worst.profit).toBe(-80);
      expect(ctx.morningPlanExcerpt).toContain('London open');
    });

    it('dailyLossCapBreached detects cap cross', () => {
      const dayTrades = [closedTrade('x', -60, '2026-07-02T12:00:00.000Z')];
      expect(dailyLossCapBreached(dayTrades, { enableDailyLoss: true, maxDailyLoss: 50 })).toBe(true);
      expect(dailyLossCapBreached(dayTrades, { enableDailyLoss: false, maxDailyLoss: 50 })).toBe(false);
    });
  });

  describe('chatContextProviders', () => {
    const trades = [];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    for (let i = 0; i < 15; i += 1) {
      trades.push(closedTrade(`t${i}`, i % 3 === 0 ? 30 : -10, `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`));
    }

    it('returns non-empty block for day-profitability question', () => {
      const block = buildExtraChatContext({
        question: 'Which day of the week am I most profitable?',
        trades,
        settings: { tagCategories: { mistakes: ['revenge'] } }
      });
      expect(block.length).toBeGreaterThan(0);
      expect(block).toMatch(/day-of-week|Best day/i);
    });

    it('returns empty for unrelated questions', () => {
      const block = buildExtraChatContext({
        question: 'What is the weather in Paris?',
        trades,
        settings: {}
      });
      expect(block).toBe('');
    });
  });

  describe('parseSuggestionsFromAiReply', () => {
    it('extracts JSON from prose-wrapped AI reply', () => {
      const raw = `Here are my thoughts:\n\`\`\`json
{"suggestions":[{"tag":"fomo-entry","confidence":0.82,"reason":"Chased after move"},{"tag":"no-plan","confidence":0.6,"reason":"Notes empty"}]}
\`\`\`\nHope that helps!`;
      const parsed = parseSuggestionsFromAiReply(raw);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].tag).toBe('fomo-entry');
      expect(parsed[0].confidence).toBe(0.82);
    });
  });
});
