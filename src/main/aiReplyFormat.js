/**
 * Normalize assistant model output for storage/display: unwrap JSON blobs,
 * decode literal \\n tokens, strip common ```json fences.
 *
 * Lives under src/main so electron-builder packs it (see package.json "files").
 * Renderer copy: src/renderer/utils/formatAssistantReply.js — keep in sync.
 */

function stripMarkdownFence(s) {
  const t = String(s || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  return m ? m[1].trim() : t;
}

function extractAssistantPayload(j, depth = 0) {
  if (depth > 4 || j == null || typeof j !== 'object') return null;
  if (Array.isArray(j)) {
    const parts = j.map((x) => (typeof x === 'string' ? x : null)).filter(Boolean);
    if (parts.length) return parts.join('\n');
    return null;
  }

  const tryKeys = ['reasoning', 'reasoning_content', 'content', 'message', 'text', 'answer', 'response', 'output', 'result', 'body'];
  for (const k of tryKeys) {
    const v = j[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object') {
      const nested = extractAssistantPayload(v, depth + 1);
      if (nested) return nested;
    }
  }

  const ch0 = j.choices?.[0];
  if (ch0) {
    const c = ch0.message?.content ?? ch0.delta?.content ?? ch0.text;
    if (typeof c === 'string' && c.trim()) return c;
    if (c && typeof c === 'object') {
      const nested = extractAssistantPayload(c, depth + 1);
      if (nested) return nested;
    }
  }

  if (j.data && typeof j.data === 'object') {
    const nested = extractAssistantPayload(j.data, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function unescapeLiteralEscapes(s) {
  const out = String(s || '');
  if (!out || !/\\n|\\r|\\t/.test(out)) return out;
  return out
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

/**
 * @param {string} raw
 * @returns {string}
 */
function formatAssistantReply(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  const peeled = stripMarkdownFence(s);
  if (peeled.startsWith('{') || peeled.startsWith('[')) {
    try {
      const j = JSON.parse(peeled);
      const extracted = extractAssistantPayload(j);
      if (extracted && extracted.trim()) s = extracted.trim();
    } catch (_) { /* keep s */ }
  }

  s = unescapeLiteralEscapes(s);
  return s.trim();
}

module.exports = { formatAssistantReply, extractAssistantPayload, stripMarkdownFence };
