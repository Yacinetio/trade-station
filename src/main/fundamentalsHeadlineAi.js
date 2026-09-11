const freeAi = require('./freeAiClient');

function formatPriorLine(h) {
  const sur = Number(h?.surprise);
  const s = Number.isFinite(sur) ? String(sur) : 'n/a';
  return `- ${String(h?.title || '').slice(0, 140)} (${h?.country || ''}) surprise=${s}`;
}

/**
 * @param {object} focus - headline row from fundamentals dashboard
 * @param {object[]} prior - earlier headlines (oldest first), same shape
 */
async function analyzeHeadlineWithContext(focus = {}, prior = [], settings = null) {
  const priorLines = (Array.isArray(prior) ? prior : []).slice(-12).map(formatPriorLine).join('\n');
  const prompt =
    'You are a G10 macro trader. Read PRIOR headlines (oldest first) for context, then the FOCUS data release.\n'
    + 'Infer directional bias for liquid markets. Return ONLY compact JSON, no markdown:\n'
    + '{"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","rationale":"max 380 chars","pairs":['
    + '{"symbol":"EURUSD","bias":"bullish|bearish|neutral","weight":0-100}]}\n'
    + 'Include 6-16 symbols when relevant: EURUSD GBPUSD USDJPY AUDUSD NZDUSD USDCAD USDCHF EURJPY GBPJPY '
    + 'XAUUSD XAGUSD BTCUSD ETHUSD US500 US30 UK100 DE40 WTI BRENT. bias must be lowercase.\n\n'
    + `PRIOR:\n${priorLines || '(none)'}\n\n`
    + `FOCUS:\nTitle: ${String(focus.title || '').slice(0, 200)}\n`
    + `Country: ${focus.country || ''}\n`
    + `Forecast: ${focus.forecast != null ? focus.forecast : 'n/a'} Actual: ${focus.actual != null ? focus.actual : 'n/a'} `
    + `Surprise: ${Number.isFinite(Number(focus.surprise)) ? focus.surprise : 'n/a'}\n`
    + `Category: ${focus.category || ''}`;

  const r = await freeAi.ask({
    prompt,
    json: true,
    timeoutMs: 22_000,
    apiKey: freeAi.pollinationsKeyFromSettings(settings)
  });
  if (!r.ok || !r.json || typeof r.json !== 'object') {
    return { ok: false, error: r.error || 'ai_failed', text: r.text };
  }
  const j = r.json;
  const verdict = String(j.verdict || 'NEUTRAL').toUpperCase();
  const safeVerdict = ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(verdict) ? verdict : 'NEUTRAL';
  const pairsRaw = Array.isArray(j.pairs) ? j.pairs : [];
  const pairs = pairsRaw
    .map((p) => ({
      symbol: String(p?.symbol || '').trim(),
      bias: String(p?.bias || 'neutral').toLowerCase(),
      weight: Number(p?.weight) || 0
    }))
    .filter((p) => p.symbol && ['bullish', 'bearish', 'neutral'].includes(p.bias))
    .slice(0, 20);
  return {
    ok: true,
    verdict: safeVerdict,
    rationale: String(j.rationale || '').slice(0, 600),
    pairs
  };
}

module.exports = {
  analyzeHeadlineWithContext
};
