/**
 * Strategy (playbook) + missed-trade persistence.
 *
 * Own JSON file `strategies.json` under the data root:
 *
 *   {
 *     strategies: [{ id, name, description, color, rules: [{id, text}],
 *                    entryCriteria, exitCriteria, riskRules,
 *                    linkedTags: [], linkedChannels: [], archived,
 *                    createdAt, updatedAt }],
 *     missed:     [{ id, symbol, direction, plannedEntry, plannedSl, plannedTp,
 *                    strategyId, reasonMissed, at,
 *                    simulated: null | { outcome: 'TP'|'SL'|'OPEN', pnlR, ... } }]
 *   }
 *
 * Write safety mirrors tradeStore.js: serialize to `.tmp`, rename over the
 * main file, then refresh `.bak`. Reads fall back to `.bak` when the main
 * file is missing or corrupt.
 */

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'strategies.json';
const TEXT_MAX = 4000;
const NAME_MAX = 120;

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${t}${r}`;
}

function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return undefined;
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Read main file; if missing/empty/corrupt fall back to the .bak copy of the last good write. */
function safeReadJson(filePath, fallback) {
  const primary = tryReadJson(filePath);
  if (primary !== undefined) return primary;
  const backup = tryReadJson(`${filePath}.bak`);
  if (backup !== undefined) return backup;
  return fallback;
}

/** Crash-safe write: .tmp → rename → refresh .bak (same guarantees as tradeStore). */
function safeWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch {
    // backup refresh is best-effort; the main write already succeeded
  }
}

function cleanText(raw, max = TEXT_MAX) {
  return String(raw ?? '').slice(0, max);
}

function cleanStringArray(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((s) => String(s ?? '').trim()).filter(Boolean))];
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRule(rule) {
  if (typeof rule === 'string') {
    const text = rule.trim();
    return text ? { id: newId('rule'), text: cleanText(text, 500) } : null;
  }
  if (rule && typeof rule === 'object') {
    const text = String(rule.text ?? '').trim();
    if (!text) return null;
    return { id: String(rule.id || newId('rule')), text: cleanText(text, 500) };
  }
  return null;
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map(normalizeRule).filter(Boolean);
}

/** Normalize any partial input into a full strategy record. */
function normalizeStrategy(input = {}, existing = null) {
  const base = existing || {};
  return {
    id: String(input.id || base.id || newId('strat')),
    name: cleanText(input.name ?? base.name ?? 'Untitled strategy', NAME_MAX).trim() || 'Untitled strategy',
    description: cleanText(input.description ?? base.description ?? ''),
    color: cleanText(input.color ?? base.color ?? '#6c8cff', 24),
    rules: normalizeRules(input.rules !== undefined ? input.rules : base.rules),
    entryCriteria: cleanText(input.entryCriteria ?? base.entryCriteria ?? ''),
    exitCriteria: cleanText(input.exitCriteria ?? base.exitCriteria ?? ''),
    riskRules: cleanText(input.riskRules ?? base.riskRules ?? ''),
    linkedTags: cleanStringArray(input.linkedTags !== undefined ? input.linkedTags : base.linkedTags),
    linkedChannels: cleanStringArray(input.linkedChannels !== undefined ? input.linkedChannels : base.linkedChannels),
    archived: input.archived !== undefined ? !!input.archived : !!base.archived,
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeDirection(raw) {
  return String(raw || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

/** Normalize any partial input into a full missed-trade record. */
function normalizeMissed(input = {}, existing = null) {
  const base = existing || {};
  const simulated = input.simulated !== undefined ? input.simulated : (base.simulated ?? null);
  return {
    id: String(input.id || base.id || newId('missed')),
    symbol: cleanText(input.symbol ?? base.symbol ?? '', 32).toUpperCase().trim(),
    direction: normalizeDirection(input.direction ?? base.direction),
    plannedEntry: toFiniteOrNull(input.plannedEntry ?? base.plannedEntry),
    plannedSl: toFiniteOrNull(input.plannedSl ?? base.plannedSl),
    plannedTp: toFiniteOrNull(input.plannedTp ?? base.plannedTp),
    strategyId: input.strategyId !== undefined
      ? (input.strategyId ? String(input.strategyId) : null)
      : (base.strategyId ?? null),
    reasonMissed: cleanText(input.reasonMissed ?? base.reasonMissed ?? '', 500),
    at: cleanText(input.at ?? base.at ?? nowIso(), 40),
    simulated: simulated && typeof simulated === 'object' ? simulated : null
  };
}

/**
 * Walk 1-min (or any resolution) OHLC bars forward from the planned time and
 * decide whether the planned TP or SL would have been hit first.
 *
 * Fill model:
 *  - the trade "fills" on the first bar whose range contains plannedEntry;
 *  - after the fill, SL is checked BEFORE TP on every bar (conservative:
 *    when both sides of a bar reach SL and TP we cannot know intrabar order);
 *  - never filled → outcome OPEN with pnlR 0;
 *  - filled but neither level reached by the last bar → OPEN with the
 *    mark-to-market R at the final close.
 *
 * Bars: ascending `{ time, open, high, low, close }` (marketHistoryService shape).
 * pnlR is expressed in R multiples of |entry − SL|.
 */
function walkBarsForOutcome({ direction = 'BUY', entry, sl, tp, bars = [] } = {}) {
  const dir = normalizeDirection(direction);
  const e = Number(entry);
  const s = Number(sl);
  const t = Number(tp);
  if (![e, s, t].every(Number.isFinite)) {
    return { outcome: 'OPEN', pnlR: 0, entryFilled: false, error: 'INVALID_LEVELS' };
  }
  const risk = Math.abs(e - s);
  if (!(risk > 0)) {
    return { outcome: 'OPEN', pnlR: 0, entryFilled: false, error: 'ZERO_RISK' };
  }
  const rewardR = Number((Math.abs(t - e) / risk).toFixed(2));

  let filled = false;
  let filledAt = null;
  let lastClose = null;

  for (const bar of Array.isArray(bars) ? bars : []) {
    const hi = Number(bar?.high);
    const lo = Number(bar?.low);
    const close = Number(bar?.close);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    if (Number.isFinite(close)) lastClose = close;

    if (!filled) {
      if (lo <= e && e <= hi) {
        filled = true;
        filledAt = bar.time ?? null;
      } else {
        continue;
      }
    }

    if (dir === 'BUY') {
      if (lo <= s) return { outcome: 'SL', pnlR: -1, entryFilled: true, filledAt, resolvedAt: bar.time ?? null };
      if (hi >= t) return { outcome: 'TP', pnlR: rewardR, entryFilled: true, filledAt, resolvedAt: bar.time ?? null };
    } else {
      if (hi >= s) return { outcome: 'SL', pnlR: -1, entryFilled: true, filledAt, resolvedAt: bar.time ?? null };
      if (lo <= t) return { outcome: 'TP', pnlR: rewardR, entryFilled: true, filledAt, resolvedAt: bar.time ?? null };
    }
  }

  if (!filled) return { outcome: 'OPEN', pnlR: 0, entryFilled: false };
  const mark = Number.isFinite(lastClose)
    ? (dir === 'BUY' ? (lastClose - e) / risk : (e - lastClose) / risk)
    : 0;
  return { outcome: 'OPEN', pnlR: Number(mark.toFixed(2)), entryFilled: true, filledAt };
}

function tradeTagsLower(trade = {}) {
  const tags = []
    .concat(Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [])
    .concat(Array.isArray(trade?.presetTags) ? trade.presetTags : []);
  return new Set(tags.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean));
}

/**
 * Suggest the best strategy for a trade using linkedChannels first (strongest
 * signal — the provider defines the playbook) and then linkedTags overlap.
 * Returns a strategyId or null. Archived strategies are never suggested.
 */
function suggestStrategyForTrade(trade = {}, strategies = []) {
  const active = (Array.isArray(strategies) ? strategies : []).filter((s) => s && !s.archived);
  const channel = String(trade?.channel ?? '').trim().toLowerCase();

  if (channel) {
    for (const strat of active) {
      const channels = (strat.linkedChannels || []).map((c) => String(c).trim().toLowerCase());
      if (channels.includes(channel)) return strat.id;
    }
  }

  const tags = tradeTagsLower(trade);
  if (tags.size > 0) {
    let best = null;
    let bestOverlap = 0;
    for (const strat of active) {
      const overlap = (strat.linkedTags || [])
        .filter((tag) => tags.has(String(tag).trim().toLowerCase())).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = strat.id;
      }
    }
    if (best) return best;
  }
  return null;
}

/** Marker helper: returns a copy of the trade with strategyId set (or cleared with null). */
function applyStrategyToTrade(trade = {}, strategyId = null) {
  const next = { ...trade };
  if (strategyId) {
    next.strategyId = String(strategyId);
  } else {
    next.strategyId = null;
    next.ruleChecks = {};
  }
  return next;
}

/**
 * Marker helper: returns a copy of the trade with a sanitized
 * `ruleChecks = { [ruleId]: boolean }` map. When the owning strategy is
 * provided, keys are restricted to its current rule ids so stale/foreign
 * rule ids never accumulate on trades.
 */
function applyRuleChecksToTrade(trade = {}, ruleChecks = {}, strategy = null) {
  const allowed = strategy && Array.isArray(strategy.rules)
    ? new Set(strategy.rules.map((r) => String(r.id)))
    : null;
  const clean = {};
  if (ruleChecks && typeof ruleChecks === 'object') {
    for (const [ruleId, value] of Object.entries(ruleChecks)) {
      const key = String(ruleId);
      if (allowed && !allowed.has(key)) continue;
      clean[key] = !!value;
    }
  }
  return { ...trade, ruleChecks: clean };
}

function createStrategyStore({ dataRoot } = {}) {
  const filePath = path.join(String(dataRoot || process.cwd()), FILE_NAME);

  function emptyBlob() {
    return { strategies: [], missed: [] };
  }

  function readBlob() {
    const raw = safeReadJson(filePath, null);
    if (!raw || typeof raw !== 'object') return emptyBlob();
    return {
      strategies: Array.isArray(raw.strategies) ? raw.strategies : [],
      missed: Array.isArray(raw.missed) ? raw.missed : []
    };
  }

  function writeBlob(blob) {
    safeWriteJson(filePath, blob);
  }

  // ── Strategies ──

  function listStrategies({ includeArchived = true } = {}) {
    const rows = readBlob().strategies;
    return includeArchived ? rows : rows.filter((s) => !s.archived);
  }

  function getStrategy(strategyId) {
    if (!strategyId) return null;
    const sid = String(strategyId);
    return readBlob().strategies.find((s) => String(s.id) === sid) || null;
  }

  /** Create or update (matched by id). Returns the stored record. */
  function saveStrategy(input = {}) {
    const blob = readBlob();
    const sid = input.id ? String(input.id) : '';
    const idx = sid ? blob.strategies.findIndex((s) => String(s.id) === sid) : -1;
    const record = normalizeStrategy(input, idx >= 0 ? blob.strategies[idx] : null);
    if (idx >= 0) blob.strategies[idx] = record;
    else blob.strategies.push(record);
    writeBlob(blob);
    return record;
  }

  function deleteStrategy(strategyId) {
    const sid = String(strategyId || '');
    if (!sid) return false;
    const blob = readBlob();
    const before = blob.strategies.length;
    blob.strategies = blob.strategies.filter((s) => String(s.id) !== sid);
    const changed = blob.strategies.length !== before;
    if (changed) {
      // Detach missed trades that referenced the deleted strategy.
      blob.missed = blob.missed.map((m) => (
        String(m.strategyId || '') === sid ? { ...m, strategyId: null } : m
      ));
      writeBlob(blob);
    }
    return changed;
  }

  // ── Missed trades ──

  function listMissed() {
    return readBlob().missed.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }

  function getMissed(missedId) {
    if (!missedId) return null;
    const mid = String(missedId);
    return readBlob().missed.find((m) => String(m.id) === mid) || null;
  }

  function addMissed(input = {}) {
    const blob = readBlob();
    const record = normalizeMissed({ ...input, id: undefined });
    blob.missed.push(record);
    writeBlob(blob);
    return record;
  }

  function updateMissed(missedId, patch = {}) {
    const mid = String(missedId || '');
    if (!mid) return null;
    const blob = readBlob();
    const idx = blob.missed.findIndex((m) => String(m.id) === mid);
    if (idx < 0) return null;
    const record = normalizeMissed({ ...patch, id: mid }, blob.missed[idx]);
    blob.missed[idx] = record;
    writeBlob(blob);
    return record;
  }

  function deleteMissed(missedId) {
    const mid = String(missedId || '');
    if (!mid) return false;
    const blob = readBlob();
    const before = blob.missed.length;
    blob.missed = blob.missed.filter((m) => String(m.id) !== mid);
    const changed = blob.missed.length !== before;
    if (changed) writeBlob(blob);
    return changed;
  }

  return {
    filePath,
    listStrategies,
    getStrategy,
    saveStrategy,
    deleteStrategy,
    listMissed,
    getMissed,
    addMissed,
    updateMissed,
    deleteMissed
  };
}

module.exports = {
  createStrategyStore,
  normalizeStrategy,
  normalizeMissed,
  walkBarsForOutcome,
  suggestStrategyForTrade,
  applyStrategyToTrade,
  applyRuleChecksToTrade
};
