import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  createStrategyStore,
  walkBarsForOutcome,
  suggestStrategyForTrade,
  applyStrategyToTrade,
  applyRuleChecksToTrade
} = require('../src/main/strategyStore');
const { listTemplates, instantiateTemplate } = require('../src/main/strategyTemplates');

describe('strategyStore', () => {
  let tmpRoot;
  let store;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-strategies-'));
    store = createStrategyStore({ dataRoot: tmpRoot });
  });

  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* noop */ }
  });

  describe('strategy CRUD', () => {
    it('creates a strategy with normalized rules and timestamps', () => {
      const s = store.saveStrategy({
        name: '  My Playbook  ',
        rules: ['Rule one', { text: 'Rule two' }, '', null],
        linkedTags: ['ict', 'ict', ' fvg '],
        linkedChannels: ['Gold VIP']
      });
      expect(s.id).toBeTruthy();
      expect(s.name).toBe('My Playbook');
      expect(s.rules).toHaveLength(2);
      expect(s.rules[0].id).toBeTruthy();
      expect(s.rules[0].text).toBe('Rule one');
      expect(s.linkedTags).toEqual(['ict', 'fvg']);
      expect(s.linkedChannels).toEqual(['Gold VIP']);
      expect(s.archived).toBe(false);
      expect(s.createdAt).toBeTruthy();
      expect(s.updatedAt).toBeTruthy();
    });

    it('updates an existing strategy in place, preserving createdAt and rule ids', () => {
      const created = store.saveStrategy({ name: 'A', rules: ['keep me'] });
      const ruleId = created.rules[0].id;
      const updated = store.saveStrategy({ id: created.id, name: 'B', rules: created.rules });
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('B');
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.rules[0].id).toBe(ruleId);
      expect(store.listStrategies()).toHaveLength(1);
    });

    it('deletes a strategy and detaches it from missed trades', () => {
      const s = store.saveStrategy({ name: 'To delete' });
      const m = store.addMissed({ symbol: 'EURUSD', strategyId: s.id });
      expect(store.deleteStrategy(s.id)).toBe(true);
      expect(store.listStrategies()).toHaveLength(0);
      expect(store.getMissed(m.id).strategyId).toBeNull();
      expect(store.deleteStrategy('nope')).toBe(false);
    });

    it('filters archived strategies when asked', () => {
      store.saveStrategy({ name: 'Live' });
      store.saveStrategy({ name: 'Old', archived: true });
      expect(store.listStrategies({ includeArchived: true })).toHaveLength(2);
      expect(store.listStrategies({ includeArchived: false })).toHaveLength(1);
    });
  });

  describe('atomic persistence', () => {
    it('round-trips through a fresh store instance on the same dir', () => {
      const s = store.saveStrategy({ name: 'Persisted', rules: ['r1', 'r2'] });
      store.addMissed({ symbol: 'XAUUSD', direction: 'SELL', plannedEntry: 2400, plannedSl: 2410, plannedTp: 2380 });

      const reopened = createStrategyStore({ dataRoot: tmpRoot });
      const strategies = reopened.listStrategies();
      expect(strategies).toHaveLength(1);
      expect(strategies[0].id).toBe(s.id);
      expect(strategies[0].rules).toHaveLength(2);
      expect(reopened.listMissed()).toHaveLength(1);
      expect(reopened.listMissed()[0].symbol).toBe('XAUUSD');
    });

    it('writes main file + .bak and leaves no .tmp behind', () => {
      store.saveStrategy({ name: 'X' });
      const file = path.join(tmpRoot, 'strategies.json');
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.existsSync(`${file}.bak`)).toBe(true);
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    });

    it('recovers from a corrupted main file via the .bak copy', () => {
      const s = store.saveStrategy({ name: 'Survivor' });
      const file = path.join(tmpRoot, 'strategies.json');
      fs.writeFileSync(file, '{ corrupted json !!!', 'utf8');

      const reopened = createStrategyStore({ dataRoot: tmpRoot });
      const strategies = reopened.listStrategies();
      expect(strategies).toHaveLength(1);
      expect(strategies[0].id).toBe(s.id);
    });
  });

  describe('missed trade CRUD', () => {
    it('adds, updates, and deletes missed trades', () => {
      const m = store.addMissed({
        symbol: 'eurusd', direction: 'sell', plannedEntry: '1.1', plannedSl: 1.11, plannedTp: 1.08, reasonMissed: 'hesitated'
      });
      expect(m.symbol).toBe('EURUSD');
      expect(m.direction).toBe('SELL');
      expect(m.plannedEntry).toBe(1.1);
      expect(m.simulated).toBeNull();

      const updated = store.updateMissed(m.id, { simulated: { outcome: 'TP', pnlR: 2 } });
      expect(updated.simulated.outcome).toBe('TP');
      // other fields untouched
      expect(updated.reasonMissed).toBe('hesitated');

      expect(store.deleteMissed(m.id)).toBe(true);
      expect(store.listMissed()).toHaveLength(0);
    });
  });

  describe('walkBarsForOutcome (missed-trade simulation)', () => {
    const bar = (time, open, high, low, close) => ({ time, open, high, low, close });

    it('BUY: TP hit first → outcome TP with reward R', () => {
      const res = walkBarsForOutcome({
        direction: 'BUY', entry: 100, sl: 95, tp: 110,
        bars: [
          bar(1, 101, 102, 100, 101),  // fills entry (low touches 100)
          bar(2, 101, 105, 99, 104),   // neither level
          bar(3, 104, 111, 103, 110)   // TP 110 hit
        ]
      });
      expect(res.outcome).toBe('TP');
      expect(res.pnlR).toBe(2); // 10 reward / 5 risk
      expect(res.entryFilled).toBe(true);
      expect(res.resolvedAt).toBe(3);
    });

    it('BUY: SL hit first → outcome SL with -1R', () => {
      const res = walkBarsForOutcome({
        direction: 'BUY', entry: 100, sl: 95, tp: 110,
        bars: [bar(1, 100, 101, 100, 100), bar(2, 100, 103, 94, 96)]
      });
      expect(res.outcome).toBe('SL');
      expect(res.pnlR).toBe(-1);
    });

    it('conservative same-bar rule: when one bar spans both SL and TP, SL wins', () => {
      const res = walkBarsForOutcome({
        direction: 'BUY', entry: 100, sl: 95, tp: 110,
        bars: [bar(1, 100, 111, 94, 105)] // fills, hits both — assume SL first
      });
      expect(res.outcome).toBe('SL');
      expect(res.pnlR).toBe(-1);
    });

    it('SELL: TP below entry is detected correctly', () => {
      const res = walkBarsForOutcome({
        direction: 'SELL', entry: 100, sl: 105, tp: 90,
        bars: [bar(1, 100, 101, 99, 100), bar(2, 100, 102, 89, 91)]
      });
      expect(res.outcome).toBe('TP');
      expect(res.pnlR).toBe(2); // 10 / 5
    });

    it('entry never touched → OPEN with 0R and entryFilled=false', () => {
      const res = walkBarsForOutcome({
        direction: 'BUY', entry: 100, sl: 95, tp: 110,
        bars: [bar(1, 104, 106, 103, 105), bar(2, 105, 108, 104, 107)]
      });
      expect(res.outcome).toBe('OPEN');
      expect(res.pnlR).toBe(0);
      expect(res.entryFilled).toBe(false);
    });

    it('filled but unresolved → OPEN with mark-to-market R at last close', () => {
      const res = walkBarsForOutcome({
        direction: 'BUY', entry: 100, sl: 95, tp: 110,
        bars: [bar(1, 101, 102, 100, 101), bar(2, 101, 104, 100, 102.5)]
      });
      expect(res.outcome).toBe('OPEN');
      expect(res.entryFilled).toBe(true);
      expect(res.pnlR).toBe(0.5); // (102.5 - 100) / 5
    });

    it('rejects invalid levels and zero risk', () => {
      expect(walkBarsForOutcome({ direction: 'BUY', entry: 100, sl: NaN, tp: 110, bars: [] }).error).toBe('INVALID_LEVELS');
      expect(walkBarsForOutcome({ direction: 'BUY', entry: 100, sl: 100, tp: 110, bars: [] }).error).toBe('ZERO_RISK');
    });
  });

  describe('attach helpers + auto-suggest', () => {
    it('suggests by linked channel first, then by tag overlap', () => {
      const strategies = [
        { id: 's-tags', archived: false, linkedTags: ['ict', 'fvg'], linkedChannels: [] },
        { id: 's-channel', archived: false, linkedTags: [], linkedChannels: ['Gold VIP'] },
        { id: 's-archived', archived: true, linkedTags: [], linkedChannels: ['Gold VIP'] }
      ];
      expect(suggestStrategyForTrade({ channel: 'gold vip' }, strategies)).toBe('s-channel');
      expect(suggestStrategyForTrade({ channel: 'Other', journal: { tags: ['FVG'] } }, strategies)).toBe('s-tags');
      expect(suggestStrategyForTrade({ channel: 'Other', presetTags: ['ict'] }, strategies)).toBe('s-tags');
      expect(suggestStrategyForTrade({ channel: 'Other' }, strategies)).toBeNull();
    });

    it('applyStrategyToTrade sets and clears strategyId (clearing wipes ruleChecks)', () => {
      const attached = applyStrategyToTrade({ id: 't1' }, 'strat_1');
      expect(attached.strategyId).toBe('strat_1');
      const detached = applyStrategyToTrade({ id: 't1', strategyId: 'strat_1', ruleChecks: { a: true } }, null);
      expect(detached.strategyId).toBeNull();
      expect(detached.ruleChecks).toEqual({});
    });

    it('applyRuleChecksToTrade sanitizes to booleans and restricts to strategy rule ids', () => {
      const strategy = { rules: [{ id: 'r1', text: 'x' }, { id: 'r2', text: 'y' }] };
      const t = applyRuleChecksToTrade({ id: 't1' }, { r1: 1, r2: false, ghost: true }, strategy);
      expect(t.ruleChecks).toEqual({ r1: true, r2: false });
    });
  });

  describe('templates', () => {
    it('ships 25+ complete templates', () => {
      const templates = listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(25);
      for (const tpl of templates) {
        expect(tpl.id).toBeTruthy();
        expect(tpl.name).toBeTruthy();
        expect(tpl.description.length).toBeGreaterThan(20);
        expect(tpl.rules.length).toBeGreaterThanOrEqual(4);
        expect(tpl.rules.length).toBeLessThanOrEqual(8);
        expect(tpl.entryCriteria.length).toBeGreaterThan(20);
        expect(tpl.exitCriteria.length).toBeGreaterThan(20);
        expect(tpl.riskRules.length).toBeGreaterThan(10);
        expect(tpl.suggestedTags.length).toBeGreaterThan(0);
      }
    });

    it('template ids are unique', () => {
      const ids = listTemplates().map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('instantiateTemplate produces a saveable strategy with fresh rule ids', () => {
      const input = instantiateTemplate('tpl-ict-silver-bullet');
      expect(input.name).toContain('Silver Bullet');
      const saved = store.saveStrategy(input);
      expect(saved.rules.length).toBeGreaterThanOrEqual(4);
      expect(saved.rules.every((r) => r.id && r.text)).toBe(true);
      expect(saved.linkedTags).toContain('ict');
      expect(instantiateTemplate('missing')).toBeNull();
    });
  });
});
