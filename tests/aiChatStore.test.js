import { describe, it, expect } from 'vitest';
const aiChat = require('../src/main/aiChat.js');

function makeMemoryStore() {
  const map = new Map();
  return {
    get: (k, fb) => (map.has(k) ? map.get(k) : fb),
    set: (k, v) => { map.set(k, v); },
    delete: (k) => map.delete(k)
  };
}

describe('aiChat store', () => {
  it('starts with no sessions', () => {
    const store = makeMemoryStore();
    expect(aiChat.listSessions(store)).toEqual([]);
  });

  it('creates sessions, lists them newest-first, and persists messages', () => {
    const store = makeMemoryStore();
    const a = aiChat.newSession(store, { title: 'First' });
    const b = aiChat.newSession(store, { title: 'Second' });
    const list = aiChat.listSessions(store);
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);

    const userMsg = aiChat.appendMessage(store, a.id, {
      role: 'user',
      content: 'hello',
      attachedSymbol: 'XAUUSD',
      attachedTf: 'H1'
    });
    expect(userMsg).toBeTruthy();
    const aiMsg = aiChat.appendMessage(store, a.id, {
      role: 'assistant',
      content: 'hi',
      model: 'openai'
    });
    expect(aiMsg).toBeTruthy();

    const msgs = aiChat.getMessages(store, a.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].attachedSymbol).toBe('XAUUSD');
    expect(msgs[1].role).toBe('assistant');
  });

  it('drops empty content and unknown sessions', () => {
    const store = makeMemoryStore();
    const s = aiChat.newSession(store, {});
    expect(aiChat.appendMessage(store, s.id, { role: 'user', content: '' })).toBeNull();
    expect(aiChat.appendMessage(store, 'unknown', { role: 'user', content: 'x' })).toBeNull();
  });

  it('caps messages per session at 200 (drops oldest first)', () => {
    const store = makeMemoryStore();
    const s = aiChat.newSession(store, {});
    for (let i = 0; i < 205; i++) {
      aiChat.appendMessage(store, s.id, { role: 'user', content: `msg ${i}` });
    }
    const msgs = aiChat.getMessages(store, s.id);
    expect(msgs.length).toBe(200);
    expect(msgs[0].content).toBe('msg 5');
    expect(msgs[msgs.length - 1].content).toBe('msg 204');
  });

  it('renames and deletes sessions', () => {
    const store = makeMemoryStore();
    const s = aiChat.newSession(store, { title: 'First' });
    const renamed = aiChat.renameSession(store, s.id, 'Renamed chat');
    expect(renamed.title).toBe('Renamed chat');
    expect(aiChat.deleteSession(store, s.id)).toBe(true);
    expect(aiChat.listSessions(store)).toHaveLength(0);
    expect(aiChat.getMessages(store, s.id)).toEqual([]);
  });

  it('auto-titles from first user message when title is still "New chat"', () => {
    const store = makeMemoryStore();
    const s = aiChat.newSession(store, {});
    aiChat.appendMessage(store, s.id, { role: 'user', content: 'What is the range on XAUUSD H1 today?' });
    const after = aiChat.ensureTitleFromFirstMessage(store, s.id, 'What is the range on XAUUSD H1 today?');
    expect(after.title).toContain('What is the range');
    aiChat.appendMessage(store, s.id, { role: 'user', content: 'Another message' });
    const after2 = aiChat.ensureTitleFromFirstMessage(store, s.id, 'Another message');
    expect(after2.title).toContain('What is the range');
  });

  it('returns getRecentHistory tail with the requested limit', () => {
    const store = makeMemoryStore();
    const s = aiChat.newSession(store, {});
    for (let i = 0; i < 10; i++) {
      aiChat.appendMessage(store, s.id, { role: 'user', content: `n${i}` });
    }
    const tail = aiChat.getRecentHistory(store, s.id, 3);
    expect(tail.map((m) => m.content)).toEqual(['n7', 'n8', 'n9']);
  });

  it('clearAll wipes everything', () => {
    const store = makeMemoryStore();
    const s = aiChat.newSession(store, {});
    aiChat.appendMessage(store, s.id, { role: 'user', content: 'hi' });
    aiChat.clearAll(store);
    expect(aiChat.listSessions(store)).toEqual([]);
    expect(aiChat.getMessages(store, s.id)).toEqual([]);
  });

  it('caps total sessions at 50 (drops oldest)', () => {
    const store = makeMemoryStore();
    for (let i = 0; i < 55; i++) {
      aiChat.newSession(store, { title: `s${i}` });
    }
    const list = aiChat.listSessions(store);
    expect(list.length).toBe(50);
    expect(list[0].title).toBe('s54');
  });
});
