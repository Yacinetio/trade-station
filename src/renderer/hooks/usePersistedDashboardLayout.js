import { useCallback, useState } from 'react';

const STORAGE_KEY_V3 = 'ts-dashboard-layout-v3';
const STORAGE_KEY_V2 = 'ts-dashboard-layout-v2';

export const DASHBOARD_WIDGET_IDS = ['kpis', 'fundamentals', 'calendar', 'middle', 'main', 'breakdown'];

export const DASHBOARD_WIDGET_LABELS = {
  kpis: 'Performance KPIs',
  fundamentals: "Today's fundamentals",
  calendar: 'Compact P&L Calendar',
  middle: 'Heatmap & weekday / pair',
  main: 'Equity curve & summaries',
  breakdown: 'Breakdowns'
};

function normalizeOrder(rawOrder) {
  let order = Array.isArray(rawOrder)
    ? rawOrder.filter((id) => DASHBOARD_WIDGET_IDS.includes(id))
    : [...DASHBOARD_WIDGET_IDS];
  order = [...new Set(order)];
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

/** Optional min-heights only after user drags bottom resize */
function normalizeMinHeights(raw) {
  const src = raw?.minHeights || raw?.heights || {};
  const minHeights = {};
  if (src && typeof src === 'object') {
    for (const id of DASHBOARD_WIDGET_IDS) {
      const n = Number(src[id]);
      if (Number.isFinite(n) && n >= 140 && n <= 1800) minHeights[id] = Math.round(n);
    }
  }
  return minHeights;
}

/** wide[id] === false → half-width tile in 2-column grid; missing/true → full row */
function normalizeWide(raw) {
  const wide = {};
  const src = raw?.wide;
  if (src && typeof src === 'object') {
    for (const id of DASHBOARD_WIDGET_IDS) {
      if (src[id] === false) wide[id] = false;
    }
  }
  return wide;
}

/** halfSide[id]: 'left' | 'right' — column preference when tile is half-width */
function normalizeHalfSide(raw, wideNormalized) {
  const halfSide = {};
  const src = raw?.halfSide;
  if (src && typeof src === 'object') {
    for (const id of DASHBOARD_WIDGET_IDS) {
      if (wideNormalized[id] === false && (src[id] === 'left' || src[id] === 'right')) {
        halfSide[id] = src[id];
      }
    }
  }
  return halfSide;
}

function normalizeLayout(raw) {
  const wide = normalizeWide(raw);
  return {
    order: normalizeOrder(raw?.order),
    minHeights: normalizeMinHeights(raw),
    wide,
    halfSide: normalizeHalfSide(raw, wide)
  };
}

function migrateFromV2(parsed) {
  return normalizeLayout({
    order: parsed?.order,
    minHeights: parsed?.heights,
    wide: {},
    halfSide: {}
  });
}

function loadLayout() {
  try {
    const rawV3 = window.localStorage.getItem(STORAGE_KEY_V3);
    if (rawV3) return normalizeLayout(JSON.parse(rawV3));
    const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const migrated = migrateFromV2(JSON.parse(rawV2));
      saveLayout(migrated);
      try {
        window.localStorage.removeItem(STORAGE_KEY_V2);
      } catch (_) {
        /* noop */
      }
      return migrated;
    }
  } catch (_) {
    /* noop */
  }
  return normalizeLayout(null);
}

function saveLayout(layout) {
  try {
    window.localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(layout));
  } catch (_) {
    /* noop */
  }
}

export function usePersistedDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout);

  const reorderAll = useCallback((nextOrder) => {
    const cleaned = normalizeOrder(nextOrder);
    setLayout((prev) => {
      const next = { ...prev, order: cleaned };
      saveLayout(next);
      return next;
    });
  }, []);

  const setWidgetMinHeight = useCallback((id, px) => {
    const h = Math.round(px);
    if (!DASHBOARD_WIDGET_IDS.includes(id) || h < 140 || h > 1800) return;
    setLayout((prev) => {
      const next = { ...prev, minHeights: { ...prev.minHeights, [id]: h } };
      saveLayout(next);
      return next;
    });
  }, []);

  const clearWidgetMinHeight = useCallback((id) => {
    setLayout((prev) => {
      const minHeights = { ...prev.minHeights };
      delete minHeights[id];
      const next = { ...prev, minHeights };
      saveLayout(next);
      return next;
    });
  }, []);

  const setWidgetWide = useCallback((id, wideVal, halfWhenNarrow = 'left') => {
    if (!DASHBOARD_WIDGET_IDS.includes(id)) return;
    setLayout((prev) => {
      const halfSideBase = { ...(prev.halfSide || {}) };
      const nextWide = { ...prev.wide };
      if (wideVal) {
        delete nextWide[id];
        delete halfSideBase[id];
      } else {
        nextWide[id] = false;
        halfSideBase[id] = halfWhenNarrow === 'right' ? 'right' : 'left';
      }
      const next = { ...prev, wide: nextWide, halfSide: halfSideBase };
      saveLayout(next);
      return next;
    });
  }, []);

  const setWidgetHalfSide = useCallback((id, side) => {
    if (!DASHBOARD_WIDGET_IDS.includes(id) || (side !== 'left' && side !== 'right')) return;
    setLayout((prev) => {
      if (prev.wide?.[id] !== false) return prev;
      const next = { ...prev, halfSide: { ...(prev.halfSide || {}), [id]: side } };
      saveLayout(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    const next = normalizeLayout(null);
    saveLayout(next);
    setLayout(next);
  }, []);

  return {
    layout,
    reorderAll,
    setWidgetMinHeight,
    clearWidgetMinHeight,
    setWidgetWide,
    setWidgetHalfSide,
    resetLayout,
    widgetLabels: DASHBOARD_WIDGET_LABELS
  };
}
