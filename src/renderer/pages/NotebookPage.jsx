import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../utils/miniMarkdown.js';
import '../styles/notebook.css';

const AUTOSAVE_DELAY_MS = 800;

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function firstBodyLine(body) {
  const line = String(body || '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0);
  return line || 'Empty note';
}

export default function NotebookPage({ routeVisible = true }) {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | pending | saving | saved | error
  const [showPreview, setShowPreview] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState({});

  const textareaRef = useRef(null);
  const autosaveTimer = useRef(null);
  const editorStateRef = useRef({ selectedId: '', title: '', body: '', dirty: false });
  editorStateRef.current = { selectedId, title, body, dirty };

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) || null,
    [notes, selectedId]
  );

  const refreshList = useCallback(async () => {
    try {
      const res = await window.electronAPI?.listNotebookNotes?.({});
      if (Array.isArray(res?.notes)) setNotes(res.notes);
      if (Array.isArray(res?.folders)) setFolders(res.folders);
    } catch { /* list refresh is best-effort */ }
  }, []);

  useEffect(() => {
    if (!routeVisible) return;
    refreshList();
    window.electronAPI?.listNotebookTemplates?.()
      .then((res) => { if (Array.isArray(res?.templates)) setTemplates(res.templates); })
      .catch(() => {});
  }, [routeVisible, refreshList]);

  // Search (store-side, case-insensitive over title+body)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      window.electronAPI?.searchNotebook?.(q)
        .then((res) => { if (!cancelled) setSearchResults(Array.isArray(res?.notes) ? res.notes : []); })
        .catch(() => { if (!cancelled) setSearchResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const visibleNotes = useMemo(() => {
    const base = searchResults !== null ? searchResults : notes;
    const filtered = selectedFolder ? base.filter((n) => n.folder === selectedFolder) : base;
    return [...filtered].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [notes, searchResults, selectedFolder]);

  const persistNote = useCallback(async (noteId, patch) => {
    setSaveState('saving');
    try {
      const res = await window.electronAPI?.saveNotebookNote?.({ id: noteId, ...patch });
      if (res?.success && res.note) {
        setNotes((prev) => prev.map((n) => (n.id === res.note.id ? res.note : n)));
        setSaveState('saved');
        setDirty(false);
        refreshList();
        return res.note;
      }
      setSaveState('error');
    } catch {
      setSaveState('error');
    }
    return null;
  }, [refreshList]);

  const saveNow = useCallback(async () => {
    const cur = editorStateRef.current;
    if (!cur.selectedId || !cur.dirty) return;
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    await persistNote(cur.selectedId, { title: cur.title, body: cur.body });
  }, [persistNote]);

  const scheduleAutosave = useCallback(() => {
    setSaveState('pending');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  // Flush pending changes when unmounting or navigating away.
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const cur = editorStateRef.current;
    if (cur.selectedId && cur.dirty) {
      window.electronAPI?.saveNotebookNote?.({ id: cur.selectedId, title: cur.title, body: cur.body }).catch(() => {});
    }
  }, []);

  const selectNote = useCallback(async (note) => {
    await saveNow();
    setSelectedId(note.id);
    setTitle(note.title || '');
    setBody(note.body || '');
    setDirty(false);
    setSaveState('idle');
    setShowPreview(false);
  }, [saveNow]);

  const createNote = useCallback(async (templateId) => {
    setTemplateMenuOpen(false);
    await saveNow();
    try {
      const input = templateId
        ? { templateId }
        : { title: '', folder: selectedFolder || 'Journal', body: '' };
      if (templateId && selectedFolder) input.folder = selectedFolder;
      const res = await window.electronAPI?.saveNotebookNote?.(input);
      if (res?.success && res.note) {
        await refreshList();
        setSelectedId(res.note.id);
        setTitle(res.note.title || '');
        setBody(res.note.body || '');
        setDirty(false);
        setSaveState('idle');
        setShowPreview(false);
      }
    } catch { /* creation errors leave the list unchanged */ }
  }, [saveNow, refreshList, selectedFolder]);

  const deleteNote = useCallback(async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      await window.electronAPI?.deleteNotebookNote?.(selectedId);
    } catch { /* refresh below reflects the real state */ }
    setSelectedId('');
    setTitle('');
    setBody('');
    setDirty(false);
    setSaveState('idle');
    refreshList();
  }, [selectedId, refreshList]);

  const changeFolderOfNote = useCallback(async (folder) => {
    if (!selectedId) return;
    await persistNote(selectedId, { title, body, folder });
  }, [selectedId, title, body, persistNote]);

  const insertAtCursor = useCallback((text) => {
    const el = textareaRef.current;
    setBody((prev) => {
      const start = el ? el.selectionStart : prev.length;
      const end = el ? el.selectionEnd : prev.length;
      const next = `${prev.slice(0, start)}${text}${prev.slice(end)}`;
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          const pos = start + text.length;
          el.setSelectionRange(pos, pos);
        }
      });
      return next;
    });
    setDirty(true);
    scheduleAutosave();
  }, [scheduleAutosave]);

  const insertTodayStats = useCallback(async () => {
    try {
      const res = await window.electronAPI?.getTodayStatsBlock?.();
      if (res?.markdown) insertAtCursor(`\n${res.markdown}\n`);
    } catch { /* stats unavailable — nothing to insert */ }
  }, [insertAtCursor]);

  const handlePaste = useCallback(async (e) => {
    if (!selectedId) return;
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((it) => it.type && it.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const ext = (imageItem.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
    if (!base64) return;
    try {
      const res = await window.electronAPI?.saveNotebookAttachment?.({ noteId: selectedId, base64, ext });
      if (res?.success) {
        if (res.note) setNotes((prev) => prev.map((n) => (n.id === res.note.id ? res.note : n)));
        insertAtCursor(`\n_[image attached: ${res.name}]_\n`);
      } else if (res?.error === 'TOO_LARGE') {
        window.alert('Image is larger than 5 MB — paste a smaller screenshot.');
      }
    } catch { /* attachment save failed; note body unchanged */ }
  }, [selectedId, insertAtCursor]);

  // Fetch data URLs for the selected note's attachments (image strip).
  useEffect(() => {
    const atts = selectedNote?.attachments || [];
    if (!selectedNote || atts.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const relPath of atts) {
        if (attachmentUrls[relPath]) continue;
        const name = String(relPath).split('/').pop();
        try {
          const res = await window.electronAPI?.readNotebookAttachment?.({ noteId: selectedNote.id, name });
          if (!cancelled && res?.success && res.dataUrl) {
            setAttachmentUrls((prev) => ({ ...prev, [relPath]: res.dataUrl }));
          }
        } catch { /* missing attachment renders as placeholder */ }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedNote, attachmentUrls]);

  const folderOptions = useMemo(() => folders.map((f) => f.name), [folders]);

  const saveLabel = {
    idle: '',
    pending: 'Unsaved changes…',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed — retry'
  }[saveState];

  return (
    <div className="dashboard-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon">📓</span>
          <span className="brand-name">Notebook</span>
          <span className="subtitle">Plans, recaps, reviews and trading notes — markdown with templates</span>
        </div>
      </div>

      <div className="notebook-layout">
        {/* Folders pane */}
        <div className="notebook-pane notebook-folders">
          <div className="notebook-pane-title">Folders</div>
          <button
            type="button"
            className={`notebook-folder-item ${selectedFolder === '' ? 'active' : ''}`}
            onClick={() => setSelectedFolder('')}
          >
            <span>All notes</span>
            <span className="notebook-folder-count">{notes.length}</span>
          </button>
          {folders.map((f) => (
            <button
              key={f.name}
              type="button"
              className={`notebook-folder-item ${selectedFolder === f.name ? 'active' : ''}`}
              onClick={() => setSelectedFolder(f.name)}
            >
              <span>{f.name}</span>
              <span className="notebook-folder-count">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Note list pane */}
        <div className="notebook-pane notebook-list">
          <div className="notebook-list-header">
            <input
              className="notebook-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              spellCheck={false}
            />
            <div className="notebook-new-wrap">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setTemplateMenuOpen((v) => !v)}
              >
                + New note
              </button>
              {templateMenuOpen && (
                <div className="notebook-template-menu">
                  <button type="button" onClick={() => createNote('')}>
                    <strong>Blank note</strong>
                    <span>Empty markdown note</span>
                  </button>
                  {templates.map((t) => (
                    <button key={t.id} type="button" onClick={() => createNote(t.id)}>
                      <strong>{t.name}</strong>
                      <span>{t.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="notebook-note-items">
            {visibleNotes.length === 0 && (
              <div className="notebook-empty-hint">
                {query.trim() ? 'No notes match your search.' : 'No notes yet — create one from a template.'}
              </div>
            )}
            {visibleNotes.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notebook-note-item ${n.id === selectedId ? 'active' : ''}`}
                onClick={() => selectNote(n)}
              >
                <div className="notebook-note-item-top">
                  <span className="notebook-note-item-title">{n.title || 'Untitled'}</span>
                  <span className="notebook-note-item-when">{formatWhen(n.updatedAt)}</span>
                </div>
                <div className="notebook-note-item-preview">{firstBodyLine(n.body)}</div>
                <div className="notebook-note-item-meta">
                  <span className="notebook-note-item-folder">{n.folder}</span>
                  {n.attachments?.length > 0 && <span>🖼 {n.attachments.length}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor pane */}
        <div className="notebook-pane notebook-editor">
          {!selectedNote ? (
            <div className="notebook-editor-empty">
              <div style={{ fontSize: 28 }}>📓</div>
              <div>Select a note or create a new one.</div>
              <div className="notebook-empty-hint">
                Templates: pre-market plan, daily recap, weekly review, watchlist, strategy idea, loss autopsy.
              </div>
            </div>
          ) : (
            <>
              <div className="notebook-editor-header">
                <input
                  className="notebook-title-input"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setDirty(true); scheduleAutosave(); }}
                  placeholder="Note title…"
                  spellCheck={false}
                />
                <select
                  className="filter-select notebook-folder-select"
                  value={selectedNote.folder}
                  onChange={(e) => changeFolderOfNote(e.target.value)}
                  title="Move note to folder"
                >
                  {folderOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div className="notebook-toolbar">
                <button
                  type="button"
                  className={`btn btn-sm ${showPreview ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={insertTodayStats} disabled={showPreview}>
                  Insert today's stats
                </button>
                <span className={`notebook-saved-indicator notebook-saved-${saveState}`}>{saveLabel}</span>
                <div className="notebook-toolbar-spacer" />
                <button type="button" className="btn btn-sm btn-outline" onClick={saveNow} disabled={!dirty}>
                  Save
                </button>
                <button type="button" className="btn btn-sm btn-outline notebook-delete-btn" onClick={deleteNote}>
                  Delete
                </button>
              </div>

              {showPreview ? (
                <div className="notebook-preview mini-md">{renderMarkdown(body)}</div>
              ) : (
                <textarea
                  ref={textareaRef}
                  className="notebook-body-textarea"
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setDirty(true); scheduleAutosave(); }}
                  onPaste={handlePaste}
                  placeholder={'Write in markdown…\n\nPaste an image to attach it to this note.'}
                  spellCheck={false}
                />
              )}

              {selectedNote.attachments?.length > 0 && (
                <div className="notebook-attachments">
                  {selectedNote.attachments.map((relPath) => (
                    attachmentUrls[relPath]
                      ? <img key={relPath} src={attachmentUrls[relPath]} alt="attachment" className="notebook-attachment-img" />
                      : <div key={relPath} className="notebook-attachment-placeholder">…</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
