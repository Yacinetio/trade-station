const fs = require('fs');
const path = require('path');

/**
 * Persistent rotating file logger.
 * - One file per day under <dataRoot>/logs/app-YYYY-MM-DD.log
 * - Oldest files pruned beyond MAX_LOG_FILES
 * - Best-effort: logging must never crash the app
 */

const MAX_LOG_FILES = 14;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // per-day hard cap; stop writing when exceeded

let logsDir = '';
let currentDate = '';
let currentStream = null;
let currentBytes = 0;
let capNoticeWritten = false;

function dateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function logFilePathFor(stamp) {
  return path.join(logsDir, `app-${stamp}.log`);
}

function pruneOldFiles() {
  try {
    const files = fs.readdirSync(logsDir)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort();
    while (files.length > MAX_LOG_FILES) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(logsDir, oldest)); } catch (_) { /* best-effort */ }
    }
  } catch (_) {
    // best-effort
  }
}

function closeStream() {
  if (currentStream) {
    try { currentStream.end(); } catch (_) { /* noop */ }
    currentStream = null;
  }
}

function ensureStream() {
  if (!logsDir) return null;
  const stamp = dateStamp();
  if (currentStream && stamp === currentDate) return currentStream;
  closeStream();
  currentDate = stamp;
  capNoticeWritten = false;
  const filePath = logFilePathFor(stamp);
  try {
    currentBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    currentStream = fs.createWriteStream(filePath, { flags: 'a' });
    currentStream.on('error', () => { currentStream = null; });
    pruneOldFiles();
  } catch (_) {
    currentStream = null;
    currentBytes = 0;
  }
  return currentStream;
}

function init(dataRoot = '') {
  try {
    if (!dataRoot) return false;
    logsDir = path.join(dataRoot, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    return true;
  } catch (_) {
    logsDir = '';
    return false;
  }
}

function sanitize(text = '') {
  // Strip control chars except newline/tab so a single entry stays one logical block.
  return String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * @param {{ time?: string, level?: string, message?: string, detail?: string }} entry
 */
function writeEntry(entry = {}) {
  try {
    const stream = ensureStream();
    if (!stream) return;
    if (currentBytes >= MAX_FILE_BYTES) {
      if (!capNoticeWritten) {
        capNoticeWritten = true;
        stream.write(`${new Date().toISOString()} [warn] Daily log size cap reached — further entries dropped for today\n`);
      }
      return;
    }
    const time = entry.time || new Date().toISOString();
    const level = String(entry.level || 'info').toUpperCase().padEnd(7);
    const message = sanitize(entry.message || '');
    const detail = sanitize(entry.detail || '');
    const line = detail
      ? `${time} [${level}] ${message} | ${detail.replace(/\r?\n/g, ' \\n ')}\n`
      : `${time} [${level}] ${message}\n`;
    currentBytes += Buffer.byteLength(line);
    stream.write(line);
  } catch (_) {
    // logging must never throw
  }
}

function getLogsDir() {
  return logsDir;
}

function shutdown() {
  closeStream();
}

module.exports = { init, writeEntry, getLogsDir, shutdown };
