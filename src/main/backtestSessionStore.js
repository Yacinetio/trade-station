/**
 * Backtest session persistence — `backtestSessions.json` under dataRoot.
 * Write safety mirrors tradeStore.js (.tmp → rename → .bak).
 */

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'backtestSessions.json';

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `bts_${t}${r}`;
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
    /* best effort */
  }
}

function normalizeSession(raw = {}) {
  const id = String(raw.id || newId());
  return {
    id,
    name: String(raw.name || 'Backtest session').slice(0, 120),
    symbol: String(raw.symbol || 'EURUSD').trim().slice(0, 32),
    timeframe: String(raw.timeframe || 'M1').toUpperCase(),
    dateFrom: String(raw.dateFrom || '').slice(0, 32),
    dateTo: String(raw.dateTo || '').slice(0, 32),
    startingBalance: Number(raw.startingBalance) || 100000,
    spreadPips: Math.max(0, Number(raw.spreadPips) || 0),
    pipSize: Number(raw.pipSize) > 0 ? Number(raw.pipSize) : null,
    strategyId: raw.strategyId ? String(raw.strategyId) : null,
    cursorIso: raw.cursorIso ? String(raw.cursorIso) : null,
    engineSnapshot: raw.engineSnapshot && typeof raw.engineSnapshot === 'object' ? raw.engineSnapshot : null,
    notes: String(raw.notes || '').slice(0, 8000),
    closedTradeIds: Array.isArray(raw.closedTradeIds) ? raw.closedTradeIds.map(String) : [],
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso(),
    status: raw.status === 'archived' ? 'archived' : 'active'
  };
}

function createBacktestSessionStore({ dataRoot }) {
  const root = String(dataRoot || process.cwd());
  const filePath = path.join(root, FILE_NAME);

  function readAll() {
    const parsed = safeReadJson(filePath, { sessions: [] });
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return { sessions: sessions.map(normalizeSession) };
  }

  function writeAll(data) {
    safeWriteJson(filePath, { sessions: data.sessions.map(normalizeSession) });
  }

  function listSessions(opts = {}) {
    const { sessions } = readAll();
    const includeArchived = opts.includeArchived === true;
    return sessions
      .filter((s) => includeArchived || s.status !== 'archived')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function getSession(sessionId) {
    const { sessions } = readAll();
    return sessions.find((s) => String(s.id) === String(sessionId)) || null;
  }

  function saveSession(input = {}) {
    const { sessions } = readAll();
    const idx = sessions.findIndex((s) => String(s.id) === String(input.id));
    const base = idx >= 0 ? sessions[idx] : normalizeSession({ ...input, id: input.id || newId() });
    const next = normalizeSession({
      ...base,
      ...input,
      id: base.id,
      createdAt: base.createdAt,
      updatedAt: nowIso()
    });
    if (idx >= 0) sessions[idx] = next;
    else sessions.push(next);
    writeAll({ sessions });
    return next;
  }

  function deleteSession(sessionId) {
    const { sessions } = readAll();
    const before = sessions.length;
    const next = sessions.filter((s) => String(s.id) !== String(sessionId));
    if (next.length === before) return false;
    writeAll({ sessions: next });
    return true;
  }

  function saveSnapshot(sessionId, { cursorIso, engineSnapshot, notes } = {}) {
    const existing = getSession(sessionId);
    if (!existing) return null;
    return saveSession({
      ...existing,
      cursorIso: cursorIso != null ? String(cursorIso) : existing.cursorIso,
      engineSnapshot: engineSnapshot != null ? engineSnapshot : existing.engineSnapshot,
      notes: notes != null ? String(notes) : existing.notes
    });
  }

  function appendClosedTradeIds(sessionId, ids = []) {
    const existing = getSession(sessionId);
    if (!existing) return null;
    const merged = [...new Set([...existing.closedTradeIds, ...ids.map(String)])];
    return saveSession({ ...existing, closedTradeIds: merged });
  }

  return {
    listSessions,
    getSession,
    saveSession,
    deleteSession,
    saveSnapshot,
    appendClosedTradeIds,
    accountKeyForSession(sessionId) {
      return `bt:${sessionId}`;
    }
  };
}

module.exports = {
  createBacktestSessionStore,
  normalizeSession
};
