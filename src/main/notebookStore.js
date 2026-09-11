/**
 * Notebook store — file-backed markdown notes for the Notebook page.
 *
 * Notes live in a single `notebook.json` under the instance data root:
 *
 *   { notes: [ { id, title, folder, templateId, dateKey?, body,
 *                linkedTradeIds: [], attachments: [], createdAt, updatedAt } ] }
 *
 * Writes are crash-safe (.tmp rename + .bak refresh, same scheme as tradeStore).
 * Image attachments are stored under `<dataRoot>/attachments/notebook/<noteId>/`
 * and referenced from `note.attachments` as forward-slash relative paths.
 */

const fs = require('fs');
const path = require('path');

const BUILTIN_FOLDERS = ['Journal', 'Plans', 'Watchlists', 'Reviews'];
const TITLE_MAX = 160;
const FOLDER_MAX = 40;
const BODY_MAX = 400000;
const NOTE_LIMIT = 2000;
const ATTACHMENT_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function newNoteId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `note_${t}${r}`;
}

function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return undefined;
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function safeReadJson(filePath, fallback) {
  const primary = tryReadJson(filePath);
  if (primary !== undefined) return primary;
  const backup = tryReadJson(`${filePath}.bak`);
  if (backup !== undefined) return backup;
  return fallback;
}

function safeWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch {
    // backup refresh is best-effort; the main write already succeeded
  }
}

function normalizeDateKey(raw) {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function normalizeFolder(raw) {
  const s = String(raw || '').trim().slice(0, FOLDER_MAX);
  return s || 'Journal';
}

/** Note ids double as attachment directory names, so they must stay path-safe. */
function isSafeNoteId(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''));
}

/** Attachment file names: single path segment, no traversal, sane charset. */
function isSafeAttachmentName(name) {
  const s = String(name || '');
  if (!s || s.includes('..')) return false;
  return /^[A-Za-z0-9._-]{1,120}$/.test(s);
}

function normalizeAttachmentExt(raw) {
  const ext = String(raw || '').trim().toLowerCase().replace(/^\./, '');
  return ATTACHMENT_EXTS.has(ext) ? ext : '';
}

function normalizeNote(raw = {}) {
  const id = isSafeNoteId(raw.id) ? String(raw.id) : newNoteId();
  return {
    id,
    title: String(raw.title || '').slice(0, TITLE_MAX),
    folder: normalizeFolder(raw.folder),
    templateId: raw.templateId ? String(raw.templateId).slice(0, 60) : '',
    dateKey: normalizeDateKey(raw.dateKey),
    body: String(raw.body || '').slice(0, BODY_MAX),
    linkedTradeIds: Array.isArray(raw.linkedTradeIds)
      ? raw.linkedTradeIds.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 200)
      : [],
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 100)
      : [],
    createdAt: raw.createdAt ? String(raw.createdAt) : nowIso(),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : nowIso()
  };
}

function sortByUpdatedDesc(notes) {
  return [...notes].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function attachmentMime(ext) {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

function createNotebookStore({ dataRoot } = {}) {
  const root = String(dataRoot || process.cwd());
  const dataFile = path.join(root, 'notebook.json');
  const attachmentsRoot = path.join(root, 'attachments', 'notebook');

  function readAll() {
    const parsed = safeReadJson(dataFile, { notes: [] });
    const rows = Array.isArray(parsed?.notes) ? parsed.notes : [];
    return rows.map(normalizeNote);
  }

  function writeAll(notes) {
    safeWriteJson(dataFile, { notes: notes.slice(0, NOTE_LIMIT) });
  }

  function listNotes(folder) {
    const all = sortByUpdatedDesc(readAll());
    if (!folder) return all;
    const f = String(folder);
    return all.filter((n) => n.folder === f);
  }

  function getNote(id) {
    const sid = String(id || '');
    if (!sid) return null;
    return readAll().find((n) => n.id === sid) || null;
  }

  /**
   * Create or update. When `input.id` matches an existing note only the
   * provided fields are patched; otherwise a new note is created.
   */
  function saveNote(input = {}) {
    const notes = readAll();
    const sid = input.id != null ? String(input.id) : '';
    const idx = sid ? notes.findIndex((n) => n.id === sid) : -1;
    if (idx >= 0) {
      const cur = notes[idx];
      const next = normalizeNote({
        ...cur,
        ...(input.title !== undefined ? { title: input.title } : null),
        ...(input.folder !== undefined ? { folder: input.folder } : null),
        ...(input.dateKey !== undefined ? { dateKey: input.dateKey } : null),
        ...(input.body !== undefined ? { body: input.body } : null),
        ...(input.linkedTradeIds !== undefined ? { linkedTradeIds: input.linkedTradeIds } : null),
        ...(input.attachments !== undefined ? { attachments: input.attachments } : null),
        id: cur.id,
        createdAt: cur.createdAt
      });
      next.updatedAt = nowIso();
      notes[idx] = next;
      writeAll(notes);
      return next;
    }
    const created = normalizeNote({ ...input, id: undefined });
    created.createdAt = nowIso();
    created.updatedAt = created.createdAt;
    notes.unshift(created);
    writeAll(notes);
    return created;
  }

  function deleteNote(id) {
    const sid = String(id || '');
    if (!sid) return false;
    const notes = readAll();
    const next = notes.filter((n) => n.id !== sid);
    if (next.length === notes.length) return false;
    writeAll(next);
    if (isSafeNoteId(sid)) {
      try {
        fs.rmSync(path.join(attachmentsRoot, sid), { recursive: true, force: true });
      } catch {
        // attachment cleanup is best-effort
      }
    }
    return true;
  }

  function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return listNotes();
    return sortByUpdatedDesc(readAll()).filter((n) =>
      n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    );
  }

  /**
   * Create or append a section to the daily Journal note for `dateKey`.
   * Used by the Notebook page and by future AI agents (briefing / recap).
   */
  function upsertDailyNote(dateKey, sectionTitle, markdownBlock) {
    const dk = normalizeDateKey(dateKey);
    if (!dk) return { success: false, error: 'INVALID_DATE_KEY' };
    const heading = String(sectionTitle || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const block = String(markdownBlock || '').trim();
    const section = heading ? `## ${heading}\n\n${block}`.trim() : block;
    if (!section) return { success: false, error: 'EMPTY_CONTENT' };

    const notes = readAll();
    const idx = notes.findIndex((n) => n.folder === 'Journal' && n.dateKey === dk);
    if (idx >= 0) {
      const cur = notes[idx];
      cur.body = `${String(cur.body || '').replace(/\s+$/, '')}\n\n${section}\n`.replace(/^\n+/, '').slice(0, BODY_MAX);
      cur.updatedAt = nowIso();
      notes[idx] = normalizeNote(cur);
      notes[idx].updatedAt = cur.updatedAt;
      writeAll(notes);
      return { success: true, created: false, note: notes[idx] };
    }
    const created = normalizeNote({
      title: `Journal — ${dk}`,
      folder: 'Journal',
      dateKey: dk,
      body: `# ${dk}\n\n${section}\n`
    });
    notes.unshift(created);
    writeAll(notes);
    return { success: true, created: true, note: created };
  }

  /** Built-in folders always listed (even empty) + any custom folders in use. */
  function listFolders() {
    const counts = new Map(BUILTIN_FOLDERS.map((f) => [f, 0]));
    for (const n of readAll()) {
      counts.set(n.folder, (counts.get(n.folder) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({
      name,
      count,
      builtin: BUILTIN_FOLDERS.includes(name)
    }));
  }

  /**
   * Persist a pasted image for a note. `base64` may include a data-URL prefix.
   * Returns `{ success, relPath, name }`; rejects unsafe ids/exts and >5MB payloads.
   */
  function saveAttachment(noteId, base64, ext) {
    const sid = String(noteId || '');
    if (!isSafeNoteId(sid)) return { success: false, error: 'INVALID_NOTE_ID' };
    const note = getNote(sid);
    if (!note) return { success: false, error: 'NOTE_NOT_FOUND' };
    const safeExt = normalizeAttachmentExt(ext);
    if (!safeExt) return { success: false, error: 'INVALID_EXT' };

    const raw = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!raw) return { success: false, error: 'EMPTY_DATA' };
    let buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      return { success: false, error: 'INVALID_BASE64' };
    }
    if (!buffer.length) return { success: false, error: 'EMPTY_DATA' };
    if (buffer.length > ATTACHMENT_MAX_BYTES) return { success: false, error: 'TOO_LARGE' };

    const name = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const dir = path.join(attachmentsRoot, sid);
    const filePath = path.resolve(dir, name);
    if (!filePath.startsWith(path.resolve(attachmentsRoot) + path.sep)) {
      return { success: false, error: 'PATH_ESCAPE' };
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    const relPath = `attachments/notebook/${sid}/${name}`;
    const updated = saveNote({ id: sid, attachments: [...note.attachments, relPath] });
    return { success: true, relPath, name, note: updated };
  }

  /** Read an attachment back as a data URL for inline rendering. */
  function readAttachment(noteId, name) {
    const sid = String(noteId || '');
    const rawName = String(name || '');
    if (rawName.includes('..') || rawName.includes('\\')) {
      return { success: false, error: 'INVALID_PATH' };
    }
    const file = rawName.split('/').pop();
    if (!isSafeNoteId(sid) || !isSafeAttachmentName(file)) {
      return { success: false, error: 'INVALID_PATH' };
    }
    const filePath = path.resolve(attachmentsRoot, sid, file);
    if (!filePath.startsWith(path.resolve(attachmentsRoot) + path.sep)) {
      return { success: false, error: 'PATH_ESCAPE' };
    }
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'NOT_FOUND' };
      const buffer = fs.readFileSync(filePath);
      const ext = normalizeAttachmentExt(path.extname(file)) || 'png';
      return { success: true, dataUrl: `data:${attachmentMime(ext)};base64,${buffer.toString('base64')}` };
    } catch {
      return { success: false, error: 'READ_FAILED' };
    }
  }

  return {
    dataFile,
    attachmentsRoot,
    listNotes,
    getNote,
    saveNote,
    deleteNote,
    search,
    upsertDailyNote,
    listFolders,
    saveAttachment,
    readAttachment
  };
}

module.exports = {
  createNotebookStore,
  normalizeNote,
  normalizeDateKey,
  isSafeNoteId,
  isSafeAttachmentName,
  BUILTIN_FOLDERS,
  ATTACHMENT_MAX_BYTES
};
