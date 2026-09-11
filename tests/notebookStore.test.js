import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createNotebookStore, ATTACHMENT_MAX_BYTES } = require('../src/main/notebookStore');
const { instantiateTemplate, listTemplates } = require('../src/main/notebookTemplates');

describe('notebookStore', () => {
  let dataRoot;
  let store;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-test-'));
    store = createNotebookStore({ dataRoot });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  describe('CRUD', () => {
    it('creates a note with defaults and persists it to notebook.json', () => {
      const note = store.saveNote({ title: 'My plan', folder: 'Plans', body: '# Plan' });
      expect(note.id).toMatch(/^note_/);
      expect(note.title).toBe('My plan');
      expect(note.folder).toBe('Plans');
      expect(note.createdAt).toBeTruthy();
      expect(fs.existsSync(path.join(dataRoot, 'notebook.json'))).toBe(true);

      const again = createNotebookStore({ dataRoot });
      expect(again.getNote(note.id)?.title).toBe('My plan');
    });

    it('updates only provided fields and preserves the rest', () => {
      const note = store.saveNote({ title: 'A', folder: 'Reviews', body: 'body', linkedTradeIds: ['t1'] });
      const updated = store.saveNote({ id: note.id, body: 'new body' });
      expect(updated.id).toBe(note.id);
      expect(updated.title).toBe('A');
      expect(updated.folder).toBe('Reviews');
      expect(updated.body).toBe('new body');
      expect(updated.linkedTradeIds).toEqual(['t1']);
      expect(updated.createdAt).toBe(note.createdAt);
    });

    it('lists notes, optionally filtered by folder, sorted by updatedAt desc', () => {
      store.saveNote({ title: 'One', folder: 'Journal' });
      store.saveNote({ title: 'Two', folder: 'Plans' });
      expect(store.listNotes()).toHaveLength(2);
      const plans = store.listNotes('Plans');
      expect(plans).toHaveLength(1);
      expect(plans[0].title).toBe('Two');
    });

    it('deletes a note and reports false for unknown ids', () => {
      const note = store.saveNote({ title: 'Bye' });
      expect(store.deleteNote(note.id)).toBe(true);
      expect(store.getNote(note.id)).toBeNull();
      expect(store.deleteNote('nope')).toBe(false);
    });

    it('defaults invalid folders to Journal and lists builtin folders with counts', () => {
      store.saveNote({ title: 'x', folder: '' });
      store.saveNote({ title: 'y', folder: 'CustomFolder' });
      const folders = store.listFolders();
      const byName = Object.fromEntries(folders.map((f) => [f.name, f]));
      expect(byName.Journal.count).toBe(1);
      expect(byName.Plans.count).toBe(0);
      expect(byName.CustomFolder.count).toBe(1);
      expect(byName.CustomFolder.builtin).toBe(false);
    });
  });

  describe('search', () => {
    it('matches case-insensitively over title and body', () => {
      store.saveNote({ title: 'Gold Watchlist', body: 'levels here' });
      store.saveNote({ title: 'Recap', body: 'Traded XAUUSD and EURUSD today' });
      store.saveNote({ title: 'Unrelated', body: 'nothing' });

      expect(store.search('gold')).toHaveLength(1);
      expect(store.search('xauusd')).toHaveLength(1);
      expect(store.search('GOLD').concat(store.search('eurusd'))).toHaveLength(2);
      expect(store.search('zzz')).toHaveLength(0);
      // Empty query returns everything
      expect(store.search('')).toHaveLength(3);
    });
  });

  describe('upsertDailyNote', () => {
    it('creates the daily Journal note on first call, appends on the next', () => {
      const first = store.upsertDailyNote('2026-07-02', 'Morning plan', 'Stay flat before NFP.');
      expect(first.success).toBe(true);
      expect(first.created).toBe(true);
      expect(first.note.folder).toBe('Journal');
      expect(first.note.dateKey).toBe('2026-07-02');
      expect(first.note.body).toContain('## Morning plan');
      expect(first.note.body).toContain('Stay flat before NFP.');

      const second = store.upsertDailyNote('2026-07-02', 'Session review', 'Took 2 trades.');
      expect(second.success).toBe(true);
      expect(second.created).toBe(false);
      expect(second.note.id).toBe(first.note.id);
      expect(second.note.body).toContain('## Morning plan');
      expect(second.note.body).toContain('## Session review');
      expect(second.note.body).toContain('Took 2 trades.');

      // Only one daily note exists for that day
      expect(store.listNotes('Journal')).toHaveLength(1);
    });

    it('rejects invalid date keys and empty content', () => {
      expect(store.upsertDailyNote('bad-date', 'X', 'y').success).toBe(false);
      expect(store.upsertDailyNote('2026-07-02', '', '').success).toBe(false);
    });
  });

  describe('templates', () => {
    it('lists all built-in templates', () => {
      const ids = listTemplates().map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining([
        'pre-market-plan', 'daily-recap', 'weekly-review', 'watchlist', 'strategy-idea', 'loss-autopsy'
      ]));
    });

    it('fills {{date}} placeholders at instantiation', () => {
      const now = new Date(2026, 6, 2); // 2026-07-02 local
      const tpl = instantiateTemplate('pre-market-plan', now);
      expect(tpl.templateId).toBe('pre-market-plan');
      expect(tpl.title).toBe('Pre-market plan — 2026-07-02');
      expect(tpl.body).toContain('2026-07-02');
      expect(tpl.body).not.toContain('{{date}}');
    });

    it('fills week range placeholders in the weekly review', () => {
      const now = new Date(2026, 6, 2); // Thursday → week Mon 2026-06-29 .. Sun 2026-07-05
      const tpl = instantiateTemplate('weekly-review', now);
      expect(tpl.title).toContain('2026-06-29');
      expect(tpl.title).toContain('2026-07-05');
      expect(tpl.body).not.toContain('{{weekStart}}');
    });

    it('returns null for unknown template ids', () => {
      expect(instantiateTemplate('nope')).toBeNull();
    });
  });

  describe('attachments', () => {
    const tinyPngBase64 = Buffer.from('fake-png-bytes').toString('base64');

    it('saves an attachment under the note folder and records the relative path', () => {
      const note = store.saveNote({ title: 'With image' });
      const res = store.saveAttachment(note.id, tinyPngBase64, 'png');
      expect(res.success).toBe(true);
      expect(res.relPath).toMatch(new RegExp(`^attachments/notebook/${note.id}/att_.+\\.png$`));
      expect(fs.existsSync(path.join(dataRoot, res.relPath))).toBe(true);
      expect(store.getNote(note.id).attachments).toContain(res.relPath);
    });

    it('rejects path traversal in note ids and attachment names', () => {
      const note = store.saveNote({ title: 'Safe' });
      expect(store.saveAttachment('../escape', tinyPngBase64, 'png').error).toBe('INVALID_NOTE_ID');
      expect(store.saveAttachment('..\\escape', tinyPngBase64, 'png').error).toBe('INVALID_NOTE_ID');
      expect(store.readAttachment(note.id, '../../notebook.json').error).toBe('INVALID_PATH');
      expect(store.readAttachment('..', 'a.png').error).toBe('INVALID_PATH');
    });

    it('rejects disallowed extensions and oversized payloads', () => {
      const note = store.saveNote({ title: 'Limits' });
      expect(store.saveAttachment(note.id, tinyPngBase64, 'exe').error).toBe('INVALID_EXT');
      const big = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 1).toString('base64');
      expect(store.saveAttachment(note.id, big, 'png').error).toBe('TOO_LARGE');
    });

    it('reads a saved attachment back as a data URL', () => {
      const note = store.saveNote({ title: 'Roundtrip' });
      const saved = store.saveAttachment(note.id, `data:image/png;base64,${tinyPngBase64}`, 'png');
      const name = saved.relPath.split('/').pop();
      const read = store.readAttachment(note.id, name);
      expect(read.success).toBe(true);
      expect(read.dataUrl).toBe(`data:image/png;base64,${tinyPngBase64}`);
    });

    it('removes the attachment directory when the note is deleted', () => {
      const note = store.saveNote({ title: 'Cleanup' });
      const saved = store.saveAttachment(note.id, tinyPngBase64, 'png');
      const dir = path.join(dataRoot, 'attachments', 'notebook', note.id);
      expect(fs.existsSync(path.join(dataRoot, saved.relPath))).toBe(true);
      store.deleteNote(note.id);
      expect(fs.existsSync(dir)).toBe(false);
    });
  });
});
