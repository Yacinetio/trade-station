import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TRADE_FILTERS } from './usePersistedTradeFilters.js';

const STORAGE_KEY = 'ts-saved-filter-presets-v1';
const PRESETS_EVENT = 'ts-filter-presets-changed';
const MAX_PRESETS = 40;

function normalizeFilters(filters = {}) {
  const f = { ...DEFAULT_TRADE_FILTERS, ...filters };
  return {
    filterSymbol: String(f.filterSymbol ?? ''),
    filterType: String(f.filterType ?? 'ALL').toUpperCase(),
    filterStatus: String(f.filterStatus ?? 'ALL').toUpperCase(),
    filterChannel: String(f.filterChannel ?? 'ALL'),
    signalsTab: String(f.signalsTab ?? 'ALL').toUpperCase(),
    sliceTimeframes: Array.isArray(f.sliceTimeframes) ? f.sliceTimeframes.map(String) : [],
    slicePairs: Array.isArray(f.slicePairs) ? f.slicePairs.map(String) : [],
    sliceBiases: Array.isArray(f.sliceBiases) ? f.sliceBiases.map(String) : [],
    sliceSetups: Array.isArray(f.sliceSetups) ? f.sliceSetups.map(String) : [],
    sliceVwapBands: Array.isArray(f.sliceVwapBands) ? f.sliceVwapBands.map(String) : [],
    sliceHvnBands: Array.isArray(f.sliceHvnBands) ? f.sliceHvnBands.map(String) : [],
    sliceSessions: Array.isArray(f.sliceSessions) ? f.sliceSessions.map(String) : [],
    sliceWeekdays: Array.isArray(f.sliceWeekdays)
      ? f.sliceWeekdays.map((x) => Number(x)).filter((n) => Number.isInteger(n))
      : [],
    sliceTags: Array.isArray(f.sliceTags) ? f.sliceTags.map(String) : []
  };
}

export function loadFilterPresets() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePresets(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_PRESETS)));
  } catch {
    /* noop */
  }
}

function persistAndNotify(list) {
  savePresets(list);
  try {
    window.dispatchEvent(new Event(PRESETS_EVENT));
  } catch {
    /* noop */
  }
}

function makeId() {
  return `fp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildPresetRow(entry, existing = null) {
  const name = String(entry?.name || existing?.name || '').trim();
  if (!name) return null;
  return {
    id: existing?.id || makeId(),
    name,
    savedAt: new Date().toISOString(),
    timeScope: String(entry?.timeScope ?? existing?.timeScope ?? 'ALL'),
    scopeFrom: String(entry?.scopeFrom ?? existing?.scopeFrom ?? ''),
    scopeTo: String(entry?.scopeTo ?? existing?.scopeTo ?? ''),
    filters: normalizeFilters(entry?.filters ?? existing?.filters ?? {}),
    results: { ...(entry?.results ?? existing?.results ?? {}) },
    filterSummary: String(entry?.filterSummary ?? existing?.filterSummary ?? '').slice(0, 1200)
  };
}

/** Named filter snapshots — persisted in localStorage, shared across pages. */
export function useSavedFilterPresets() {
  const [presets, setPresetsState] = useState(loadFilterPresets);

  useEffect(() => {
    const sync = () => setPresetsState(loadFilterPresets());
    window.addEventListener(PRESETS_EVENT, sync);
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PRESETS_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const savePreset = useCallback((entry) => {
    const row = buildPresetRow(entry);
    if (!row) return null;
    setPresetsState((prev) => {
      const next = [row, ...prev.filter((p) => p.id !== row.id && p.name.toLowerCase() !== row.name.toLowerCase())].slice(0, MAX_PRESETS);
      persistAndNotify(next);
      return next;
    });
    return row;
  }, []);

  const updatePreset = useCallback((id, entry) => {
    if (!id) return null;
    setPresetsState((prev) => {
      const existing = prev.find((p) => p.id === id);
      if (!existing) return prev;
      const row = buildPresetRow(entry, existing);
      if (!row) return prev;
      const next = prev.map((p) => (p.id === id ? row : p));
      persistAndNotify(next);
      return next;
    });
    return id;
  }, []);

  const deletePreset = useCallback((id) => {
    setPresetsState((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persistAndNotify(next);
      return next;
    });
  }, []);

  const clearPresets = useCallback(() => {
    persistAndNotify([]);
    setPresetsState([]);
  }, []);

  return { presets, savePreset, updatePreset, deletePreset, clearPresets };
}
