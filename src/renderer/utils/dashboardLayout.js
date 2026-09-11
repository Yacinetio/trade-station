/** @typedef {{ id: string, label: string, defaultSize?: 'sm'|'md'|'lg', defaultVisible?: boolean }} WidgetRegistryEntry */
/** @typedef {{ id: string, size: 'sm'|'md'|'lg', visible: boolean, config?: Record<string, unknown> }} LayoutItem */

export const LAYOUT_STORAGE_KEY = 'ts-dashboard-layout';
export const SIZE_CYCLE = ['sm', 'md', 'lg'];

/**
 * @param {WidgetRegistryEntry[]} registry
 * @returns {LayoutItem[]}
 */
export function getDefaultLayout(registry) {
  const list = Array.isArray(registry) ? registry : [];
  return list.map((entry) => ({
    id: entry.id,
    size: entry.defaultSize === 'sm' || entry.defaultSize === 'lg' ? entry.defaultSize : 'md',
    visible: entry.defaultVisible !== false,
    ...(entry.id === 'report-snapshot' ? { config: { dimension: 'day-of-week' } } : {})
  }));
}

/**
 * @param {unknown} size
 * @returns {'sm'|'md'|'lg'}
 */
export function normalizeSize(size) {
  return size === 'sm' || size === 'lg' ? size : 'md';
}

/**
 * Merge stored layout with registry: drop unknown ids, append missing as hidden, preserve order.
 * @param {unknown} stored
 * @param {WidgetRegistryEntry[]} registry
 * @returns {LayoutItem[]}
 */
export function normalizeLayout(stored, registry) {
  const regList = Array.isArray(registry) ? registry : [];
  const regById = new Map(regList.map((r) => [r.id, r]));
  const defaults = getDefaultLayout(regList);
  const defaultById = new Map(defaults.map((d) => [d.id, d]));

  const rawItems = Array.isArray(stored) ? stored : (stored && typeof stored === 'object' && Array.isArray(stored.items) ? stored.items : []);
  const seen = new Set();
  const merged = [];

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '').trim();
    if (!id || !regById.has(id) || seen.has(id)) continue;
    seen.add(id);
    const def = defaultById.get(id) || { size: 'md', visible: false, config: {} };
    merged.push({
      id,
      size: normalizeSize(raw.size),
      visible: raw.visible === true,
      config: {
        ...(typeof def.config === 'object' && def.config ? def.config : {}),
        ...(typeof raw.config === 'object' && raw.config ? raw.config : {})
      }
    });
  }

  for (const entry of regList) {
    if (seen.has(entry.id)) continue;
    const def = defaultById.get(entry.id);
    if (def) {
      merged.push({ ...def, visible: false });
    }
  }

  return merged.length > 0 ? merged : defaults;
}

/**
 * @param {WidgetRegistryEntry[]} registry
 * @returns {LayoutItem[]}
 */
export function resetLayout(registry) {
  return getDefaultLayout(registry);
}

/**
 * @param {'sm'|'md'|'lg'} size
 * @returns {'sm'|'md'|'lg'}
 */
export function cycleSize(size) {
  const idx = SIZE_CYCLE.indexOf(normalizeSize(size));
  return SIZE_CYCLE[(idx + 1) % SIZE_CYCLE.length];
}

/**
 * @param {LayoutItem[]} layout
 * @param {string} id
 * @param {number} toIndex
 * @returns {LayoutItem[]}
 */
export function reorderLayout(layout, id, toIndex) {
  const list = Array.isArray(layout) ? [...layout] : [];
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) return list;
  const [item] = list.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, list.length));
  list.splice(clamped, 0, item);
  return list;
}

/**
 * @param {LayoutItem[]} layout
 * @param {string} id
 * @param {Partial<LayoutItem>} patch
 * @returns {LayoutItem[]}
 */
export function patchLayoutItem(layout, id, patch) {
  return (Array.isArray(layout) ? layout : []).map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      ...patch,
      config: patch.config != null
        ? { ...(item.config || {}), ...patch.config }
        : item.config
    };
  });
}

/**
 * @param {LayoutItem[]} layout
 * @param {WidgetRegistryEntry[]} registry
 * @returns {LayoutItem[]}
 */
export function hiddenAvailableWidgets(layout, registry) {
  const visibleIds = new Set((layout || []).filter((i) => i.visible).map((i) => i.id));
  return (registry || []).filter((r) => !visibleIds.has(r.id));
}

export function loadLayoutFromStorage(registry) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return getDefaultLayout(registry);
  }
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return getDefaultLayout(registry);
    const parsed = JSON.parse(raw);
    return normalizeLayout(parsed, registry);
  } catch {
    return getDefaultLayout(registry);
  }
}

export function saveLayoutToStorage(layout) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* noop */
  }
}
