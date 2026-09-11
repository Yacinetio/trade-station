/**
 * Image-signal parsing via OpenAI Vision (gpt-4o-mini by default). Off by default; only runs
 * when the user has enabled `aiVisionEnabled` and supplied `aiOpenAIApiKey` in settings.
 *
 * Inputs an image buffer (PNG/JPEG) and returns a parsed signal object compatible with
 * `signalParser.parse` consumers — or null if the image cannot be parsed confidently.
 */

const VISION_TIMEOUT_MS = 25_000;
const DEFAULT_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are a forex/CFD signal extractor. The user will paste an image of a trading signal posted in a Telegram channel. Output a single JSON object with these exact fields:

{
  "type": "BUY" | "SELL" | null,
  "symbol": string | null,            // e.g. "XAUUSD", "EURUSD", "US30"
  "entry": number | null,             // entry price; null if MARKET
  "sl": number | null,                // stop loss price
  "tp": number[] | null,              // ordered take-profit prices
  "orderType": "MARKET"|"LIMIT"|"STOP"|null,
  "timeframe": string | null,         // e.g. "M15", "H1"
  "bias": string | null,              // optional context
  "confidence": number                // 0..1, your own confidence
}

Rules:
- Use null for any field you cannot read confidently. Never invent prices.
- If multiple TPs are visible, return them in order (TP1 first).
- Output ONLY the JSON object — no prose, no fences.`;

function buildRequestBody({ imageDataUrl, model }) {
  return {
    model: model || DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the trading signal from this image.' },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ]
  };
}

function isAiVisionEnabled(settings) {
  return !!(settings?.aiVisionEnabled && String(settings?.aiOpenAIApiKey || '').trim());
}

async function parseSignalFromImage({ imageBuffer, mimeType = 'image/png', settings }) {
  if (!isAiVisionEnabled(settings)) return null;
  if (!imageBuffer || typeof imageBuffer.toString !== 'function') return null;

  const apiKey = String(settings.aiOpenAIApiKey).trim();
  const model = String(settings.aiVisionModel || DEFAULT_MODEL);
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildRequestBody({ imageDataUrl: dataUrl, model })),
      signal: controller.signal
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { error: `vision_http_${res.status}`, detail: t.slice(0, 200) };
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      return { error: 'vision_parse_failed', detail: String(text).slice(0, 200) };
    }
    return normalizeVisionResponse(parsed);
  } catch (e) {
    const reason = e?.name === 'AbortError' ? `vision_timeout_${VISION_TIMEOUT_MS}ms` : (e?.message || String(e));
    return { error: 'vision_network', detail: reason };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVisionResponse(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = typeof raw.type === 'string' ? raw.type.toUpperCase() : null;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  const entry = Number.isFinite(Number(raw.entry)) ? Number(raw.entry) : null;
  const sl = Number.isFinite(Number(raw.sl)) ? Number(raw.sl) : null;
  let tp = Array.isArray(raw.tp) ? raw.tp.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : null;
  if (Array.isArray(tp) && tp.length === 0) tp = null;
  const orderType = typeof raw.orderType === 'string' ? raw.orderType.toUpperCase() : null;
  const timeframe = typeof raw.timeframe === 'string' ? raw.timeframe.toUpperCase() : null;
  const bias = typeof raw.bias === 'string' ? raw.bias.slice(0, 200) : null;
  const confidence = Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0;

  const looksValid = (type === 'BUY' || type === 'SELL') && symbol && (entry !== null || tp || sl);
  if (!looksValid) return null;

  return {
    type,
    symbol,
    entry: entry || 0,
    sl: sl || 0,
    tp: tp || [],
    orderType: orderType || 'MARKET',
    timeframe: timeframe || '',
    bias: bias || '',
    visionConfidence: confidence,
    parsedBy: 'ai-vision'
  };
}

module.exports = {
  parseSignalFromImage,
  isAiVisionEnabled,
  normalizeVisionResponse
};
