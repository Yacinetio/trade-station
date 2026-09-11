import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { tryExtractJson, normalizePollinationsModel, FREE_TEXT_MODELS } = require('../src/main/freeAiClient.js');

describe('normalizePollinationsModel', () => {
  it('keeps openai', () => {
    expect(normalizePollinationsModel('openai')).toBe('openai');
    expect(normalizePollinationsModel('OPENAI')).toBe('openai');
  });
  it('normalizes known pollinations model ids', () => {
    expect(normalizePollinationsModel('mistral')).toBe('mistral');
    expect(normalizePollinationsModel('openai-fast')).toBe('openai-fast');
  });
  it('falls back for garbage', () => {
    expect(normalizePollinationsModel('')).toBe('openai');
    expect(normalizePollinationsModel('not-a-real-model')).toBe('openai');
  });
  it('FREE_TEXT_MODELS includes openai default', () => {
    expect(FREE_TEXT_MODELS.length).toBeGreaterThanOrEqual(1);
    expect(FREE_TEXT_MODELS.some((m) => m.id === 'openai')).toBe(true);
  });
});

describe('tryExtractJson', () => {
  it('parses plain JSON object', () => {
    expect(tryExtractJson('{"headline":"x","wins":[],"leaks":[],"next_action":"","chartConfidence":5,"tradeNote":""}')).toMatchObject({
      headline: 'x'
    });
  });

  it('parses fenced markdown JSON', () => {
    const raw = 'Sure!\n```json\n{\n  "headline": "Hi",\n  "wins": []\n}\n```';
    expect(tryExtractJson(raw)).toMatchObject({ headline: 'Hi', wins: [] });
  });

  it('parses preamble before JSON object', () => {
    const raw = 'Here is the JSON:\n\n{"confidence":88,"verdict":"allow","reasons":["ok"],"summary":"fine","entryVsChart":"","tfBiasVsStructure":"","adjustHint":""}\nThanks!';
    const j = tryExtractJson(raw);
    expect(j).toMatchObject({ confidence: 88, verdict: 'allow' });
  });

  it('handles trailing commas inside nested arrays/objects', () => {
    const raw = '{"a":1,"b":[2,3,],}';
    expect(tryExtractJson(raw)).toMatchObject({ a: 1, b: [2, 3] });
  });

  it('uses brace-balanced slice when trailing prose contains braces', () => {
    const raw = 'prefix {"headline":"x"} suffix with } junk';
    expect(tryExtractJson(raw)).toMatchObject({ headline: 'x' });
  });

  it('unwraps JSON string that embeds JSON text', () => {
    const inner = JSON.stringify({ confidence: 90 });
    const wrapped = JSON.stringify(inner);
    expect(tryExtractJson(wrapped)).toMatchObject({ confidence: 90 });
  });

  it('returns null for garbage', () => {
    expect(tryExtractJson('no braces here')).toBe(null);
  });

  it('returns null for JSON array root', () => {
    expect(tryExtractJson('[1,2]')).toBe(null);
  });
});
