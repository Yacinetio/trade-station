import { describe, expect, it } from 'vitest';
import {
  buildOverviewRowGroups,
  computeOverviewGridPlacement
} from '../src/renderer/utils/dashboardOverviewPlacement.js';

describe('computeOverviewGridPlacement', () => {
  it('assigns explicit columns for consecutive half tiles / full rows', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    const wide = { a: false, b: false, c: false, d: false, e: false };
    const halfSide = { a: 'left', b: 'left', c: 'left', d: 'right', e: 'left' };
    const g = computeOverviewGridPlacement(order, wide, halfSide);
    expect(g.a.gridColumn).toBe('1 / 2');
    expect(g.b.gridColumn).toBe('2 / 3');
    expect(g.a.gridRow).toBe('1');
    expect(g.b.gridRow).toBe('1');
    expect(g.c.gridColumn).toBe('1 / 2');
    expect(g.d.gridColumn).toBe('2 / 3');
    expect(g.c.gridRow).toBe('2');
    expect(g.d.gridRow).toBe('2');
    expect(g.e.gridColumn).toBe('1 / 2');
    expect(g.e.gridRow).toBe('3');
  });

  it('fills the free column when preference matches sibling', () => {
    const order = ['x', 'y'];
    const wide = { x: false, y: false };
    const halfSide = { x: 'left', y: 'left' };
    const g = computeOverviewGridPlacement(order, wide, halfSide);
    expect(g.x.gridColumn).toBe('1 / 2');
    expect(g.y.gridColumn).toBe('2 / 3');
    expect(g.x.gridRow).toBe('1');
    expect(g.y.gridRow).toBe('1');
  });

  it('uses full row for wide tiles', () => {
    const order = ['a', 'b'];
    const wide = {};
    const g = computeOverviewGridPlacement(order, wide, {});
    expect(g.a.gridColumn).toBe('1 / -1');
    expect(g.b.gridColumn).toBe('1 / -1');
    expect(g.a.gridRow).toBe('1');
    expect(g.b.gridRow).toBe('2');
  });

  it('pairs half tiles into open rows before starting a new row', () => {
    const order = ['h1', 'f', 'h2', 'h3'];
    const wide = { h1: false, f: true, h2: false, h3: false };
    const halfSide = { h1: 'left', h2: 'left', h3: 'left' };
    const g = computeOverviewGridPlacement(order, wide, halfSide);
    expect(g.h1.gridColumn).toBe('1 / 2');
    expect(g.f.gridColumn).toBe('1 / -1');
    expect(g.h2.gridColumn).toBe('2 / 3');
    expect(g.h3.gridColumn).toBe('1 / 2');
    expect(g.h1.gridRow).toBe('1');
    expect(g.h2.gridRow).toBe('1');
    expect(g.f.gridRow).toBe('2');
    expect(g.h3.gridRow).toBe('3');
  });

  it('pairs distant half tiles and respects left/right preference', () => {
    const order = ['fundamentals', 'calendar', 'middle', 'kpis'];
    const wide = { fundamentals: false, kpis: false };
    const halfSide = { fundamentals: 'left', kpis: 'right' };
    const g = computeOverviewGridPlacement(order, wide, halfSide);
    expect(g.fundamentals.gridColumn).toBe('1 / 2');
    expect(g.kpis.gridColumn).toBe('2 / 3');
    expect(g.fundamentals.gridRow).toBe(g.kpis.gridRow);
    expect(g.calendar.gridRow).toBe('2');
  });

  it('moves a solo half tile when side preference changes', () => {
    const order = ['middle'];
    const wide = { middle: false };
    const left = computeOverviewGridPlacement(order, wide, { middle: 'left' });
    const right = computeOverviewGridPlacement(order, wide, { middle: 'right' });
    expect(left.middle.gridColumn).toBe('1 / 2');
    expect(right.middle.gridColumn).toBe('2 / 3');
  });

  it('swaps columns when both half tiles prefer the same side', () => {
    const order = ['a', 'b'];
    const wide = { a: false, b: false };
    const g = computeOverviewGridPlacement(order, wide, { a: 'right', b: 'right' });
    expect(g.a.gridColumn).toBe('2 / 3');
    expect(g.b.gridColumn).toBe('1 / 2');
    expect(g.a.gridRow).toBe('1');
    expect(g.b.gridRow).toBe('1');
  });
});

describe('buildOverviewRowGroups', () => {
  it('groups left/right ids on the same row', () => {
    const order = ['middle', 'calendar', 'main'];
    const wide = { middle: false, main: false };
    const halfSide = { middle: 'left', main: 'right' };
    const groups = buildOverviewRowGroups(order, wide, halfSide);
    const pair = groups.find((g) => g.leftId === 'middle' && g.rightId === 'main');
    expect(pair).toBeTruthy();
    expect(pair.fullId).toBeNull();
  });
});
