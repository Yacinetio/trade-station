import { DEFAULT_TRADE_FILTERS } from '../hooks/usePersistedTradeFilters.js';
import { tradeIsClosed as isClosedTrade, getTradeOutcome } from './tradeStatus.js';
import { formatWeekdaySliceOption } from './tradeSliceFilters.js';

const SCALAR_MERGE_FIELDS = [
  { key: 'filterSymbol', defaultValue: '', label: 'Symbol', isDefault: (v) => !String(v || '').trim() },
  { key: 'filterType', defaultValue: 'ALL', label: 'Type', isDefault: (v) => String(v || 'ALL').toUpperCase() === 'ALL' },
  { key: 'filterStatus', defaultValue: 'ALL', label: 'Status', isDefault: (v) => String(v || 'ALL').toUpperCase() === 'ALL' },
  { key: 'filterChannel', defaultValue: 'ALL', label: 'Channel', isDefault: (v) => String(v || 'ALL').toUpperCase() === 'ALL' },
  { key: 'signalsTab', defaultValue: 'ALL', label: 'Tab', isDefault: (v) => String(v || 'ALL').toUpperCase() === 'ALL' }
];

const SLICE_MERGE_LABELS = {
  sliceTimeframes: 'TF',
  slicePairs: 'Pairs',
  sliceBiases: 'Bias',
  sliceSetups: 'Setup',
  sliceVwapBands: 'VWAP',
  sliceHvnBands: 'HVN',
  sliceSessions: 'Session',
  sliceWeekdays: 'Weekdays',
  sliceTags: 'Tags'
};

function normalizeFilters(filters = {}) {
  const f = { ...DEFAULT_TRADE_FILTERS, ...filters };
  return {
    ...f,
    sliceWeekdays: Array.isArray(f.sliceWeekdays)
      ? f.sliceWeekdays.map((x) => Number(x)).filter((n) => Number.isInteger(n)).sort((a, b) => a - b)
      : []
  };
}

function arraysEqual(a, b) {
  const left = Array.isArray(a) ? a.map(String) : [];
  const right = Array.isArray(b) ? b.map(String) : [];
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

/** True when live filters match a saved preset snapshot. */
export function filtersMatchPreset(liveFilters = {}, presetFilters = {}) {
  const live = normalizeFilters(liveFilters);
  const preset = normalizeFilters(presetFilters);
  return Object.keys(DEFAULT_TRADE_FILTERS).every((key) => {
    const a = live[key];
    const b = preset[key];
    if (Array.isArray(DEFAULT_TRADE_FILTERS[key])) return arraysEqual(a, b);
    return String(a ?? '') === String(b ?? '');
  });
}

export function findMatchingPreset(presets = [], liveFilters = {}) {
  return presets.find((p) => filtersMatchPreset(liveFilters, p.filters)) || null;
}

function unionArrayField(key, lists = []) {
  const out = new Set();
  let anyRestricted = false;
  for (const list of lists) {
    const arr = Array.isArray(list) ? list : [];
    if (arr.length) anyRestricted = true;
    for (const val of arr) {
      if (key === 'sliceWeekdays') {
        const n = Number(val);
        if (Number.isInteger(n)) out.add(n);
      } else {
        out.add(String(val));
      }
    }
  }
  if (!anyRestricted) return [];
  if (key === 'sliceWeekdays') {
    return [...out].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  }
  return [...out].map(String).sort();
}

function formatSliceValues(key, values = []) {
  if (!values.length) return '';
  if (key === 'sliceWeekdays') {
    return values.map((d) => formatWeekdaySliceOption(d)).join(', ');
  }
  if (key === 'sliceVwapBands' || key === 'sliceHvnBands') {
    return values.map((v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : v)).join(', ');
  }
  if (key === 'sliceSessions') {
    return values.map((s) => (s === 'asian' ? 'Asian' : s === 'london' ? 'London' : s === 'newYork' ? 'NY' : s)).join(', ');
  }
  return values.join(', ');
}

function buildMergeSummary(presets, merged, unionedKeys, conflicts) {
  if (conflicts.length) return conflicts.join(' ');
  const names = presets.map((p) => p.name).join(' + ');
  const parts = unionedKeys
    .map((key) => {
      const vals = merged[key];
      if (!Array.isArray(vals) || vals.length === 0) return '';
      const label = SLICE_MERGE_LABELS[key] || key;
      return `${label}: ${formatSliceValues(key, vals)}`;
    })
    .filter(Boolean);
  if (parts.length) return `Combined “${names}” → ${parts.join(' · ')}`;
  return `Applied “${names}”`;
}

/**
 * Merge multiple saved templates into one filter set (union per slice dimension).
 * Scalar filters must agree or be unrestricted; otherwise returns conflicts.
 */
export function mergeFilterPresets(presets = []) {
  const items = (Array.isArray(presets) ? presets : []).filter((p) => p?.filters);
  if (!items.length) {
    return { ok: false, error: 'Select at least one template.', conflicts: [], summary: '' };
  }

  const normalized = items.map((p) => ({
    id: p.id,
    name: String(p.name || 'Template'),
    filters: normalizeFilters(p.filters),
    timeScope: String(p.timeScope || 'ALL').toUpperCase(),
    scopeFrom: String(p.scopeFrom || ''),
    scopeTo: String(p.scopeTo || '')
  }));

  if (normalized.length === 1) {
    const one = normalized[0];
    return {
      ok: true,
      filters: { ...one.filters },
      timeScope: one.timeScope,
      scopeFrom: one.scopeFrom,
      scopeTo: one.scopeTo,
      conflicts: [],
      summary: `Applied “${one.name}”`,
      presetIds: [one.id],
      presetNames: [one.name],
      unionedKeys: []
    };
  }

  const conflicts = [];
  const merged = { ...DEFAULT_TRADE_FILTERS };
  const unionedKeys = [];

  for (const field of SCALAR_MERGE_FIELDS) {
    const rawVals = normalized.map((n) => n.filters[field.key]);
    const specific = rawVals.filter((v) => !field.isDefault(v));
    const unique = [...new Set(specific.map((v) => String(field.key === 'filterSymbol' ? v : String(v).toUpperCase())))];
    if (unique.length > 1) {
      conflicts.push(
        `${field.label} conflicts (${unique.join(' vs ')}) — templates must use the same ${field.label.toLowerCase()}, or leave it as All.`
      );
      merged[field.key] = field.defaultValue;
    } else if (unique.length === 1) {
      merged[field.key] = field.key === 'filterSymbol' ? specific[0] : String(specific[0]).toUpperCase();
    } else {
      merged[field.key] = field.defaultValue;
    }
  }

  for (const key of Object.keys(DEFAULT_TRADE_FILTERS).filter((k) => Array.isArray(DEFAULT_TRADE_FILTERS[k]))) {
    const perPreset = normalized.map((n) => n.filters[key] || []);
    const unioned = unionArrayField(key, perPreset);
    merged[key] = unioned;
    const hadRestriction = perPreset.some((arr) => arr.length > 0);
    const allSame = perPreset.every((arr) => arraysEqual(arr, perPreset[0]));
    if (hadRestriction && !allSame) unionedKeys.push(key);
  }

  const scopes = [...new Set(normalized.map((n) => n.timeScope))];
  let timeScope = normalized[0].timeScope;
  let scopeFrom = normalized[0].scopeFrom;
  let scopeTo = normalized[0].scopeTo;

  if (scopes.length > 1) {
    conflicts.push(`Date scope conflicts (${scopes.join(' vs ')}) — save templates with the same Year/Month/Week scope.`);
  } else if (timeScope === 'CUSTOM') {
    const ranges = [...new Set(normalized.map((n) => `${n.scopeFrom}|${n.scopeTo}`))];
    if (ranges.length > 1) {
      conflicts.push('Custom date range differs between templates — use the same range or the same preset scope.');
    }
  }

  const summary = buildMergeSummary(normalized, merged, unionedKeys, conflicts);

  return {
    ok: conflicts.length === 0,
    error: conflicts[0] || '',
    filters: merged,
    timeScope,
    scopeFrom,
    scopeTo,
    conflicts,
    summary,
    presetIds: normalized.map((n) => n.id),
    presetNames: normalized.map((n) => n.name),
    unionedKeys
  };
}

const APPLIED_TEMPLATE_IDS_KEY = 'ts-applied-filter-template-ids';

export function loadAppliedTemplateIds() {
  try {
    const raw = window.sessionStorage.getItem(APPLIED_TEMPLATE_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function persistAppliedTemplateIds(ids = []) {
  try {
    const list = Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
    if (list.length) window.sessionStorage.setItem(APPLIED_TEMPLATE_IDS_KEY, JSON.stringify(list));
    else window.sessionStorage.removeItem(APPLIED_TEMPLATE_IDS_KEY);
  } catch {
    /* noop */
  }
}

/** Detect if live filters match a prior multi-template merge. */
export function findMatchingPresetMerge(presets = [], liveFilters = {}, appliedIds = []) {
  const ids = Array.isArray(appliedIds) ? appliedIds.filter(Boolean) : [];
  if (ids.length < 2) return null;
  const selected = ids.map((id) => presets.find((p) => p.id === id)).filter(Boolean);
  if (selected.length !== ids.length) return null;
  const merged = mergeFilterPresets(selected);
  if (!merged.ok) return null;
  return filtersMatchPreset(liveFilters, merged.filters) ? merged : null;
}

export function computeTemplateResults(trades = [], breakEvenAmount = 50) {
  const be = Math.max(0, Number(breakEvenAmount ?? 50) || 50);
  const closed = trades.filter((t) => isClosedTrade(t));
  let wins = 0;
  let losses = 0;
  for (const t of closed) {
    const o = getTradeOutcome(t, be);
    if (o === 'TP' || (o === 'CLOSED' && Number(t.profit) > be)) wins += 1;
    else if (o === 'SL' || (o === 'CLOSED' && Number(t.profit) < -be)) losses += 1;
  }
  const decisive = wins + losses;
  const pnl = trades.reduce((s, t) => s + Number(t.profit || 0), 0);
  return {
    tradeCount: trades.length,
    closedCount: closed.length,
    wins,
    losses,
    decisive,
    winRate: decisive > 0 ? Number(((wins / decisive) * 100).toFixed(1)) : null,
    pnl: Number(pnl.toFixed(2))
  };
}
