import { describe, it, expect } from 'vitest';

const {
  normalizeCustomTradeColumns,
  extractCustomFieldsFromText,
  applyCustomFieldsToSignal,
  resolvePresetTagsFromCustomFields
} = require('../src/main/customTradeFields');

describe('customTradeFields', () => {
  it('normalizes column defs and avoids builtin id collisions', () => {
    const out = normalizeCustomTradeColumns([
      { parseKey: 'Bias', label: 'MY BIAS' },
      { parseKey: 'Zone', label: 'ZONE', width: 120 }
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toMatch(/^custom_/);
    expect(out[1].parseKey).toBe('Zone');
    expect(out[1].width).toBe(120);
  });

  it('extracts labeled lines from signal text', () => {
    const text = 'Signal: BUY EURUSD\nZone: London\nSetup: 2\nEntry: 1.1\nSL: 1.0\nTP: 1.2';
    const defs = normalizeCustomTradeColumns([
      { parseKey: 'Zone', label: 'ZONE' },
      { parseKey: 'Setup', label: 'SETUP' }
    ]);
    const fields = extractCustomFieldsFromText(text, defs);
    expect(fields[defs[0].id]).toBe('London');
    expect(fields[defs[1].id]).toBe('2');
  });

  it('maps parsed values to preset tags when enabled', () => {
    const defs = normalizeCustomTradeColumns([
      { parseKey: 'Setup', label: 'SETUP', mapToPresetTags: true, tags: ['2', 'London'] }
    ]);
    const tags = resolvePresetTagsFromCustomFields({ [defs[0].id]: '2' }, defs, ['London', '2']);
    expect(tags).toEqual(['2']);
  });

  it('applyCustomFieldsToSignal merges fields and tags', () => {
    const settings = {
      customTradeColumns: [{ parseKey: 'Setup', label: 'SETUP', mapToPresetTags: true }],
      tradePresets: ['London', '2']
    };
    const text = 'BUY EURUSD\nSetup: London\nEntry: 1.1\nSL: 1.0\nTP: 1.2';
    const signal = { symbol: 'EURUSD', type: 'BUY' };
    const out = applyCustomFieldsToSignal(signal, text, settings);
    expect(out.customFields[normalizeCustomTradeColumns(settings.customTradeColumns)[0].id]).toBe('London');
    expect(out.presetTags).toContain('London');
  });
});
