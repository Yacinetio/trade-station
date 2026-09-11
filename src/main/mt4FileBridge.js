/**
 * Fallback transport when branded MT4 blocks Winsock (WSA 10051 on localhost).
 * Uses two UTF-8 text files in a shared folder:
 *   app_to_ea.txt — Trade Station appends lines (JSON + newline)
 *   ea_to_app.txt — EA appends lines
 * Point Trade Station at the same folder as MT4's MQL4/Files/<FileBridgeFolder>/.
 */
const fs = require('fs');
const path = require('path');

let pollTimer = null;
let pingTimer = null;
let fromEaOffset = 0;
let bridgeDir = '';
/** @type {null | import('./tcpBridge')} */
let tcpMod = null;

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  if (pingTimer) clearInterval(pingTimer);
  pollTimer = pingTimer = null;
  fromEaOffset = 0;
  bridgeDir = '';
  if (tcpMod?.setFileOutboundAppender) tcpMod.setFileOutboundAppender(null);
  tcpMod = null;
}

function appendAppToEa(line) {
  fs.appendFileSync(path.join(bridgeDir, 'app_to_ea.txt'), line, 'utf8');
}

/**
 * @param {string} dir absolute directory path
 * @param {import('./tcpBridge')} tcpBridge module (processInboundLine + setFileOutboundAppender)
 */
function start(dir, tcpBridge) {
  stop();
  tcpMod = tcpBridge;
  bridgeDir = path.resolve(dir);
  fs.mkdirSync(bridgeDir, { recursive: true });
  tcpBridge.setFileOutboundAppender((line) => {
    appendAppToEa(line);
  });

  pollTimer = setInterval(() => {
    try {
      const p = path.join(bridgeDir, 'ea_to_app.txt');
      if (!fs.existsSync(p)) return;
      const sz = fs.statSync(p).size;
      if (sz < fromEaOffset) fromEaOffset = 0;
      if (sz <= fromEaOffset) return;
      const len = sz - fromEaOffset;
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(p, 'r');
      fs.readSync(fd, buf, 0, len, fromEaOffset);
      fs.closeSync(fd);
      fromEaOffset = sz;
      const chunk = buf.toString('utf8');
      for (const raw of chunk.split('\n')) {
        const t = raw.trim();
        if (!t) continue;
        tcpBridge.processInboundLine(t, (line) => appendAppToEa(line));
      }
    } catch (e) {
      console.error('[MT4FileBridge] poll error:', e.message);
    }
  }, 250);

  pingTimer = setInterval(() => {
    try {
      if (!bridgeDir) return;
      appendAppToEa(JSON.stringify({ type: 'PING' }) + '\n');
    } catch (_) {}
  }, 5000);

  console.log('[MT4FileBridge] Watching', bridgeDir);
}

module.exports = { start, stop };
