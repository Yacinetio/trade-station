/**
 * Pollinations.ai text client (gen.pollinations.ai).
 *
 * As of 2026 the legacy anonymous host `text.pollinations.ai` is heavily rate-limited (HTTP 429).
 * The unified API at `gen.pollinations.ai` requires an API key (free tier: enter.pollinations.ai).
 *
 * With a key we use OpenAI-compatible POST /v1/chat/completions.
 * Without a key we try GET /text/{prompt} (usually 401) then legacy host as last resort.
 */

const DEFAULT_BASE_URL = 'https://gen.pollinations.ai';
const LEGACY_BASE_URL = 'https://text.pollinations.ai';
const DEFAULT_MODEL = 'openai';
const DEFAULT_TIMEOUT_MS = 18_000;

/** @type {{ id: string, label: string }[]} */
const FREE_TEXT_MODELS = [
  { id: 'openai', label: 'OpenAI (Pollinations)' },
  { id: 'openai-fast', label: 'OpenAI fast' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'gemini-fast', label: 'Gemini fast' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'claude-fast', label: 'Claude fast' }
];

const MODEL_ID_SET = new Set(FREE_TEXT_MODELS.map((m) => m.id));

function normalizePollinationsModel(id) {
  const raw = String(id || '').trim().toLowerCase();
  if (MODEL_ID_SET.has(raw)) return raw;
  return DEFAULT_MODEL;
}

const MAX_PROMPT_CHARS = 6000;

function clipPrompt(prompt) {
  const s = String(prompt || '').trim();
  if (s.length <= MAX_PROMPT_CHARS) return s;
  return s.slice(0, MAX_PROMPT_CHARS - 50) + '\n…(truncated)';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapHttpError(status) {
  if (status === 401 || status === 402) return 'auth_required';
  if (status === 429) return 'rate_limited';
  return `http_${status}`;
}

async function askViaChatCompletions({ prompt, model, json, timeoutMs, apiKey, baseUrl }) {
  const cleaned = clipPrompt(prompt);
  const url = `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      messages: [{ role: 'user', content: cleaned }],
      ...(json ? { response_format: { type: 'json_object' } } : {})
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      let retryAfter = null;
      if (res.status === 429) {
        try {
          const ra = res.headers.get('retry-after');
          if (ra && Number.isFinite(Number(ra))) retryAfter = Number(ra);
        } catch (_) { /* ignore */ }
      }
      return { ok: false, error: mapHttpError(res.status), status: res.status, retryAfter };
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { ok: false, error: 'empty_response' };
    if (json) {
      const parsed = tryExtractJson(text);
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, text, json: parsed };
      }
      return { ok: false, error: 'json_parse_failed', text };
    }
    return { ok: true, text };
  } catch (e) {
    const reason = e?.name === 'AbortError' ? `timeout_${timeoutMs}ms` : String(e?.message || e);
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function askViaGetText({ prompt, model, json, timeoutMs, apiKey, baseUrl, legacy = false }) {
  const cleaned = clipPrompt(prompt);
  const host = String(baseUrl || (legacy ? LEGACY_BASE_URL : DEFAULT_BASE_URL)).replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('model', String(model));
  if (json) params.set('json', 'true');
  if (apiKey) params.set('key', apiKey);
  params.set('seed', String(Math.floor(Date.now() / 1000)));
  const path = legacy ? `/${encodeURIComponent(cleaned)}` : `/text/${encodeURIComponent(cleaned)}`;
  const url = `${host}${path}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: json ? 'application/json,text/plain;q=0.9' : 'text/plain' },
      signal: controller.signal
    });
    if (!res.ok) {
      let retryAfter = null;
      if (res.status === 429) {
        try {
          const ra = res.headers.get('retry-after');
          if (ra && Number.isFinite(Number(ra))) retryAfter = Number(ra);
        } catch (_) { /* ignore */ }
      }
      return { ok: false, error: mapHttpError(res.status), status: res.status, retryAfter };
    }
    const text = await res.text();
    if (json) {
      const parsed = tryExtractJson(text);
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, text, json: parsed };
      }
      return { ok: false, error: 'json_parse_failed', text };
    }
    return { ok: true, text };
  } catch (e) {
    const reason = e?.name === 'AbortError' ? `timeout_${timeoutMs}ms` : String(e?.message || e);
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {boolean} [opts.json]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.apiKey] Pollinations key (pk_ or sk_) from enter.pollinations.ai
 */
async function ask({
  prompt,
  model = DEFAULT_MODEL,
  json = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = ''
} = {}) {
  if (!prompt) return { ok: false, error: 'EMPTY_PROMPT' };

  const modelUse = normalizePollinationsModel(model);
  const key = String(apiKey || '').trim();

  if (key) {
    let result = await askViaChatCompletions({ prompt, model: modelUse, json, timeoutMs, apiKey: key, baseUrl });
    if (!result.ok && result.error === 'rate_limited') {
      const waitMs = (result.retryAfter || 3) * 1000;
      await sleep(waitMs);
      result = await askViaChatCompletions({ prompt, model: modelUse, json, timeoutMs, apiKey: key, baseUrl });
    }
    if (!result.ok && result.error === 'json_parse_failed') {
      result = await askViaGetText({ prompt, model: modelUse, json, timeoutMs, apiKey: key, baseUrl });
    }
    return result;
  }

  // No key: try unified GET, then legacy host with one retry on 429.
  let result = await askViaGetText({ prompt, model: modelUse, json, timeoutMs, apiKey: '', baseUrl });
  if (!result.ok && (result.error === 'auth_required' || result.status === 401)) {
    result = await askViaGetText({ prompt, model: modelUse, json, timeoutMs, apiKey: '', legacy: true });
    if (!result.ok && result.error === 'rate_limited') {
      await sleep((result.retryAfter || 5) * 1000);
      result = await askViaGetText({ prompt, model: modelUse, json, timeoutMs, apiKey: '', legacy: true });
    }
  } else if (!result.ok && result.error === 'rate_limited') {
    await sleep((result.retryAfter || 5) * 1000);
    result = await askViaGetText({ prompt, model: modelUse, json, timeoutMs, apiKey: '', baseUrl });
  }
  return result;
}

/** Remove ```json ... ``` or ``` ... ``` wrapper if present. */
function stripMarkdownFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : t;
}

function stripTrailingCommas(jsonSlice) {
  return String(jsonSlice || '').replace(/,\s*([}\]])/g, '$1');
}

function extractBalancedJsonObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonLenient(slice) {
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch (_) {
    try {
      return JSON.parse(stripTrailingCommas(slice));
    } catch (_) {
      return null;
    }
  }
}

function tryExtractJson(text) {
  if (typeof text !== 'string') return null;
  let trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.charCodeAt(0) === 0xfeff) trimmed = trimmed.slice(1);

  trimmed = stripMarkdownFence(trimmed);

  for (let depth = 0; depth < 4; depth++) {
    try {
      const once = JSON.parse(trimmed);
      if (once != null && typeof once === 'object' && !Array.isArray(once)) return once;
      if (typeof once === 'string') {
        trimmed = once.trim();
        continue;
      }
      break;
    } catch (_) {
      break;
    }
  }

  let parsed = parseJsonLenient(trimmed);
  if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;

  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) {
    parsed = parseJsonLenient(balanced);
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    parsed = parseJsonLenient(trimmed.slice(start, end + 1));
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }

  return null;
}

async function ping(opts = {}) {
  const apiKey = String(opts.apiKey || '').trim();
  const result = await ask({
    prompt: 'Reply with the single word "OK" if you can read this.',
    model: normalizePollinationsModel(opts.model || DEFAULT_MODEL),
    timeoutMs: 12000,
    baseUrl: opts.baseUrl,
    apiKey
  });
  if (!result.ok) return { ok: false, error: result.error, status: result.status, retryAfter: result.retryAfter };
  const replied = String(result.text || '').trim().toUpperCase();
  return { ok: replied.includes('OK'), reply: result.text };
}

function pollinationsKeyFromSettings(settings) {
  return String(settings?.aiCheck?.pollinationsApiKey || '').trim();
}

module.exports = {
  ask,
  ping,
  tryExtractJson,
  DEFAULT_BASE_URL,
  LEGACY_BASE_URL,
  DEFAULT_MODEL,
  FREE_TEXT_MODELS,
  normalizePollinationsModel,
  pollinationsKeyFromSettings
};
