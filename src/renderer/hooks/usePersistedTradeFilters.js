import { useCallback, useState } from 'react';
import { persistAppliedTemplateIds } from '../utils/filterPresetMatch.js';

const STORAGE_KEY = 'ts-global-trade-filters-v1';

export const DEFAULT_TRADE_FILTERS = {
  filterSymbol: '',
  filterType: 'ALL',
  filterStatus: 'ALL',
  filterChannel: 'ALL',
  /** ALL | LIVE | CLOSED | BLOCKED — shared between Dashboard and Trades */
  signalsTab: 'ALL',
  sliceTimeframes: [],
  slicePairs: [],
  sliceBiases: [],
  sliceSetups: [],
  sliceVwapBands: [],
  sliceHvnBands: [],
  sliceSessions: [],
  sliceWeekdays: [],
  sliceTags: []
};

function normalizeArrayField(value) {
  return Array.isArray(value) ? value.map((x) => String(x)) : [];
}

function loadTradeFilters() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TRADE_FILTERS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_TRADE_FILTERS };
    return {
      ...DEFAULT_TRADE_FILTERS,
      filterSymbol: String(parsed.filterSymbol ?? ''),
      filterType: String(parsed.filterType ?? 'ALL').toUpperCase(),
      filterStatus: String(parsed.filterStatus ?? 'ALL').toUpperCase(),
      filterChannel: String(parsed.filterChannel ?? 'ALL'),
      signalsTab: String(parsed.signalsTab ?? 'ALL').toUpperCase(),
      sliceTimeframes: normalizeArrayField(parsed.sliceTimeframes),
      slicePairs: normalizeArrayField(parsed.slicePairs),
      sliceBiases: normalizeArrayField(parsed.sliceBiases),
      sliceSetups: normalizeArrayField(parsed.sliceSetups),
      sliceVwapBands: normalizeArrayField(parsed.sliceVwapBands),
      sliceHvnBands: normalizeArrayField(parsed.sliceHvnBands),
      sliceSessions: normalizeArrayField(parsed.sliceSessions),
      sliceWeekdays: normalizeArrayField(parsed.sliceWeekdays).map((x) => Number(x)).filter((n) => Number.isInteger(n)),
      sliceTags: normalizeArrayField(parsed.sliceTags)
    };
  } catch {
    return { ...DEFAULT_TRADE_FILTERS };
  }
}

function saveTradeFilters(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

function arraysEqual(a, b) {
  const left = Array.isArray(a) ? a.map(String) : [];
  const right = Array.isArray(b) ? b.map(String) : [];
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

/** True when every filter matches defaults (nothing active). */
export function tradeFiltersAreDefault(filters = {}) {
  const f = { ...DEFAULT_TRADE_FILTERS, ...filters };
  return Object.entries(DEFAULT_TRADE_FILTERS).every(([key, def]) => {
    const val = f[key];
    if (Array.isArray(def)) return arraysEqual(val, def);
    return String(val ?? '') === String(def);
  });
}

/** App-level trade filters — persisted in localStorage, shared across Dashboard ↔ Trades. */
export function usePersistedTradeFilters() {
  const [filters, setFiltersState] = useState(loadTradeFilters);

  const setFilters = useCallback((patch) => {
    setFiltersState((prev) => {
      const delta = typeof patch === 'function' ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveTradeFilters(next);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    const next = { ...DEFAULT_TRADE_FILTERS };
    saveTradeFilters(next);
    setFiltersState(next);
    persistAppliedTemplateIds([]);
  }, []);

  return { filters, setFilters, resetFilters };
}
