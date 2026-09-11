/**
 * AI chat — persistent session/message store for the dedicated AI page.
 *
 * Data is kept in the shared `electron-store` instance under key `aiChat`:
 *
 *   {
 *     sessions: [
 *       { id, title, createdAt, updatedAt, model, lastSymbol, lastTimeframe }
 *     ],
 *     messages: {
 *       [sessionId]: [
 *         { id, role: 'user'|'assistant', content, model,
 *           attachedSymbol?, attachedTf?, createdAt }
 *       ]
 *     }
 *   }
 *
 * Caps:
 *   - 50 sessions total (oldest dropped when adding new)
 *   - 200 messages per session (oldest dropped when appending)
 *
 * All exported helpers are pure functions of `store` so tests can pass a tiny
 * mock object exposing `get(key, fallback)` and `set(key, value)`.
 */

const STORE_KEY = 'aiChat';
const SESSION_LIMIT = 50;
const MESSAGE_LIMIT_PER_SESSION = 200;
const TITLE_MAX = 80;
const CONTENT_MAX = 8000;

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

function emptyBlob() {
  return { sessions: [], messages: {} };
}

function readBlob(store) {
  if (!store) return emptyBlob();
  const raw = store.get(STORE_KEY, null);
  if (!raw || typeof raw !== 'object') return emptyBlob();
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  const messages = raw.messages && typeof raw.messages === 'object' ? raw.messages : {};
  return { sessions, messages };
}

function writeBlob(store, blob) {
  if (!store) return;
  try {
    store.set(STORE_KEY, blob);
  } catch (_) {
    /* best-effort */
  }
}

function cleanTitle(raw) {
  return String(raw || '').slice(0, TITLE_MAX).trim();
}

function autoTitleFromContent(content) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'New chat';
  return flat.slice(0, 48) + (flat.length > 48 ? '…' : '');
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function findSession(sessions, sessionId) {
  if (!sessionId) return null;
  const sid = String(sessionId);
  return sessions.find((s) => String(s.id) === sid) || null;
}

function listSessions(store) {
  const blob = readBlob(store);
  return sortSessions(blob.sessions);
}

function getMessages(store, sessionId) {
  const blob = readBlob(store);
  const sid = String(sessionId || '');
  if (!sid) return [];
  const arr = Array.isArray(blob.messages[sid]) ? blob.messages[sid] : [];
  return arr.slice();
}

function newSession(store, { title, model } = {}) {
  const blob = readBlob(store);
  const session = {
    id: newId('chat'),
    title: cleanTitle(title) || 'New chat',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    model: String(model || 'openai'),
    lastSymbol: '',
    lastTimeframe: ''
  };
  blob.sessions.unshift(session);
  if (blob.sessions.length > SESSION_LIMIT) {
    const dropped = blob.sessions.splice(SESSION_LIMIT);
    for (const d of dropped) {
      if (d?.id) delete blob.messages[d.id];
    }
  }
  blob.messages[session.id] = [];
  writeBlob(store, blob);
  return session;
}

function touchSession(blob, sessionId, patch = {}) {
  const s = findSession(blob.sessions, sessionId);
  if (!s) return null;
  Object.assign(s, patch);
  s.updatedAt = nowIso();
  return s;
}

function appendMessage(store, sessionId, msg) {
  if (!sessionId || !msg) return null;
  const blob = readBlob(store);
  const sid = String(sessionId);
  if (!findSession(blob.sessions, sid)) return null;

  const role = msg.role === 'assistant' ? 'assistant' : 'user';
  const content = String(msg.content || '').slice(0, CONTENT_MAX);
  if (!content.trim()) return null;

  const record = {
    id: newId(role === 'assistant' ? 'a' : 'u'),
    role,
    content,
    model: String(msg.model || ''),
    attachedSymbol: msg.attachedSymbol ? String(msg.attachedSymbol).slice(0, 24) : '',
    attachedTf: msg.attachedTf ? String(msg.attachedTf).slice(0, 12) : '',
    createdAt: nowIso()
  };

  if (!Array.isArray(blob.messages[sid])) blob.messages[sid] = [];
  blob.messages[sid].push(record);
  if (blob.messages[sid].length > MESSAGE_LIMIT_PER_SESSION) {
    blob.messages[sid].splice(0, blob.messages[sid].length - MESSAGE_LIMIT_PER_SESSION);
  }

  const patch = {};
  if (record.attachedSymbol) patch.lastSymbol = record.attachedSymbol;
  if (record.attachedTf) patch.lastTimeframe = record.attachedTf;
  touchSession(blob, sid, patch);

  writeBlob(store, blob);
  return record;
}

function renameSession(store, sessionId, title) {
  const blob = readBlob(store);
  const s = touchSession(blob, sessionId, { title: cleanTitle(title) || 'New chat' });
  if (!s) return null;
  writeBlob(store, blob);
  return s;
}

function ensureTitleFromFirstMessage(store, sessionId, content) {
  const blob = readBlob(store);
  const s = findSession(blob.sessions, sessionId);
  if (!s) return null;
  if (s.title && s.title !== 'New chat') return s;
  s.title = autoTitleFromContent(content);
  s.updatedAt = nowIso();
  writeBlob(store, blob);
  return s;
}

function deleteSession(store, sessionId) {
  const blob = readBlob(store);
  const sid = String(sessionId || '');
  if (!sid) return false;
  const before = blob.sessions.length;
  blob.sessions = blob.sessions.filter((s) => String(s.id) !== sid);
  delete blob.messages[sid];
  const changed = blob.sessions.length !== before;
  if (changed) writeBlob(store, blob);
  return changed;
}

function patchSession(store, sessionId, patch = {}) {
  const blob = readBlob(store);
  const s = touchSession(blob, sessionId, patch);
  if (!s) return null;
  writeBlob(store, blob);
  return s;
}

function clearAll(store) {
  writeBlob(store, emptyBlob());
  return true;
}

function getRecentHistory(store, sessionId, limit = 6) {
  const all = getMessages(store, sessionId);
  return all.slice(Math.max(0, all.length - limit));
}

/** Keyword-selected report/strategy context for conversational AI (Phase 7). */
function buildTradeDataContextBlock({ question, trades, settings } = {}) {
  try {
    const { buildExtraChatContext } = require('./aiAgents/chatContextProviders');
    return buildExtraChatContext({ question, trades, settings }) || '';
  } catch (_) {
    return '';
  }
}

module.exports = {
  STORE_KEY,
  SESSION_LIMIT,
  MESSAGE_LIMIT_PER_SESSION,
  listSessions,
  getMessages,
  newSession,
  appendMessage,
  renameSession,
  patchSession,
  ensureTitleFromFirstMessage,
  deleteSession,
  clearAll,
  getRecentHistory,
  buildTradeDataContextBlock
};
