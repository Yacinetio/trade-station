import { describe, it, expect } from 'vitest';
import {
  getDefaultLayout,
  normalizeLayout,
  resetLayout,
  cycleSize,
  reorderLayout,
  patchLayoutItem,
  hiddenAvailableWidgets,
  normalizeSize
} from '../src/renderer/utils/dashboardLayout.js';

const REGISTRY = [
  { id: 'kpi-core', label: 'KPIs', defaultSize: 'lg', defaultVisible: true },
  { id: 'equity-curve', label: 'Equity', defaultSize: 'lg', defaultVisible: true },
  { id: 'efficiency', label: 'Efficiency', defaultSize: 'md', defaultVisible: false },
  { id: 'calendar-mini', label: 'Calendar', defaultSize: 'md', defaultVisible: false },
  { id: 'report-snapshot', label: 'Report', defaultSize: 'md', defaultVisible: false },
  { id: 'prop-rules', label: 'Prop', defaultSize: 'md', defaultVisible: false },
  { id: 'strategy-top', label: 'Strategies', defaultSize: 'sm', defaultVisible: false },
  { id: 'recent-trades', label: 'Recent', defaultSize: 'md', defaultVisible: false }
];

describe('dashboardLayout', () => {
  it('getDefaultLayout marks optional widgets hidden', () => {
    const layout = getDefaultLayout(REGISTRY);
    expect(layout.find((i) => i.id === 'kpi-core')?.visible).toBe(true);
    expect(layout.find((i) => i.id === 'equity-curve')?.visible).toBe(true);
    expect(layout.find((i) => i.id === 'efficiency')?.visible).toBe(false);
    expect(layout.find((i) => i.id === 'calendar-mini')?.visible).toBe(false);
    expect(layout.find((i) => i.id === 'report-snapshot')?.config?.dimension).toBe('day-of-week');
  });

  it('normalizeLayout drops unknown widget ids', () => {
    const stored = [
      { id: 'kpi-core', size: 'md', visible: true },
      { id: 'ghost-widget', size: 'lg', visible: true },
      { id: 'equity-curve', size: 'lg', visible: true }
    ];
    const out = normalizeLayout(stored, REGISTRY);
    expect(out.map((i) => i.id)).toEqual(['kpi-core', 'equity-curve', 'efficiency', 'calendar-mini', 'report-snapshot', 'prop-rules', 'strategy-top', 'recent-trades']);
    expect(out.find((i) => i.id === 'ghost-widget')).toBeUndefined();
  });

  it('normalizeLayout preserves stored order for known ids', () => {
    const stored = [
      { id: 'recent-trades', size: 'sm', visible: true },
      { id: 'kpi-core', size: 'lg', visible: true }
    ];
    const out = normalizeLayout(stored, REGISTRY);
    expect(out.slice(0, 2).map((i) => i.id)).toEqual(['recent-trades', 'kpi-core']);
  });

  it('normalizeLayout appends missing registry widgets as hidden', () => {
    const stored = [{ id: 'kpi-core', size: 'lg', visible: true }];
    const out = normalizeLayout(stored, REGISTRY);
    expect(out).toHaveLength(REGISTRY.length);
    expect(out.filter((i) => !i.visible).length).toBe(REGISTRY.length - 1);
  });

  it('normalizeLayout merges report-snapshot config with defaults', () => {
    const stored = [{ id: 'report-snapshot', size: 'md', visible: true, config: { dimension: 'hour-of-day' } }];
    const out = normalizeLayout(stored, REGISTRY);
    const item = out.find((i) => i.id === 'report-snapshot');
    expect(item?.config?.dimension).toBe('hour-of-day');
  });

  it('resetLayout returns fresh defaults', () => {
    const mutated = normalizeLayout([{ id: 'recent-trades', size: 'sm', visible: true }], REGISTRY);
    const fresh = resetLayout(REGISTRY);
    expect(fresh).toEqual(getDefaultLayout(REGISTRY));
    expect(mutated.find((i) => i.id === 'recent-trades')?.visible).toBe(true);
    expect(fresh.find((i) => i.id === 'recent-trades')?.visible).toBe(false);
  });

  it('cycleSize rotates sm → md → lg', () => {
    expect(cycleSize('sm')).toBe('md');
    expect(cycleSize('md')).toBe('lg');
    expect(cycleSize('lg')).toBe('sm');
    expect(cycleSize('weird')).toBe('lg');
  });

  it('normalizeSize coerces invalid values to md', () => {
    expect(normalizeSize(undefined)).toBe('md');
    expect(normalizeSize('xl')).toBe('md');
  });

  it('reorderLayout moves item to target index', () => {
    const base = getDefaultLayout(REGISTRY);
    const out = reorderLayout(base, 'kpi-core', 3);
    expect(out[3].id).toBe('kpi-core');
    expect(out).toHaveLength(base.length);
  });

  it('patchLayoutItem updates size, visibility, and config', () => {
    const base = getDefaultLayout(REGISTRY);
    const out = patchLayoutItem(base, 'report-snapshot', {
      visible: true,
      config: { dimension: 'symbol' }
    });
    const item = out.find((i) => i.id === 'report-snapshot');
    expect(item?.visible).toBe(true);
    expect(item?.config?.dimension).toBe('symbol');
  });

  it('hiddenAvailableWidgets lists registry entries not currently visible', () => {
    const layout = getDefaultLayout(REGISTRY);
    const hidden = hiddenAvailableWidgets(layout, REGISTRY);
    expect(hidden.map((w) => w.id)).toContain('calendar-mini');
    expect(hidden.map((w) => w.id)).not.toContain('kpi-core');
  });

  it('normalizeLayout accepts { items: [] } wrapper', () => {
    const out = normalizeLayout({ items: [{ id: 'efficiency', size: 'sm', visible: true }] }, REGISTRY);
    expect(out[0].id).toBe('efficiency');
    expect(out[0].size).toBe('sm');
  });
});
