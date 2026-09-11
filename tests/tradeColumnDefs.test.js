import { describe, it, expect } from 'vitest';
import {
  buildTradeColumnDefs,
  normalizeTradeBuiltinColumns
} from '../src/renderer/utils/tradeColumnDefs.js';

describe('tradeColumnDefs', () => {
  it('hides disabled built-in columns', () => {
    const defs = buildTradeColumnDefs([], [
      { id: 'replay', enabled: false },
      { id: 'shots', enabled: false }
    ]);
    expect(defs.some((c) => c.id === 'replay')).toBe(false);
    expect(defs.some((c) => c.id === 'shots')).toBe(false);
    expect(defs.some((c) => c.id === 'symbol')).toBe(true);
  });

  it('applies built-in label and width overrides', () => {
    const rows = normalizeTradeBuiltinColumns([
      { id: 'symbol', label: 'PAIR', width: 100 }
    ]);
    const sym = rows.find((c) => c.id === 'symbol');
    expect(sym.label).toBe('PAIR');
    expect(sym.width).toBe(100);
  });

  it('merges enabled custom columns after builtins', () => {
    const defs = buildTradeColumnDefs([
      { parseKey: 'Zone', label: 'ZONE', enabled: true, id: 'zone' }
    ]);
    const custom = defs.filter((c) => !c.builtin);
    expect(custom).toHaveLength(1);
    expect(custom[0].label).toBe('ZONE');
  });
});
