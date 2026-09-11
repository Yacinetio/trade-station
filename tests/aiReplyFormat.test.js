import { describe, it, expect } from 'vitest';
import { formatAssistantReply } from '../src/renderer/utils/formatAssistantReply.js';

describe('formatAssistantReply', () => {
  it('returns plain text unchanged (trimmed)', () => {
    expect(formatAssistantReply('  hello  ')).toBe('hello');
  });

  it('unwraps JSON with reasoning and decodes escapes', () => {
    const raw = JSON.stringify({
      role: 'assistant',
      reasoning: 'Line one\\nLine two\\n'
    });
    expect(formatAssistantReply(raw)).toBe('Line one\nLine two');
  });

  it('strips markdown json fence', () => {
    const inner = JSON.stringify({ content: 'A\\nB' });
    const raw = '```json\n' + inner + '\n```';
    expect(formatAssistantReply(raw)).toBe('A\nB');
  });

  it('turns literal \\n on one line into newlines', () => {
    expect(formatAssistantReply('foo\\nbar')).toBe('foo\nbar');
  });
});
