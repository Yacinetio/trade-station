const freeAi = require('./freeAiClient');

/**
 * One short desk note from fundamentals snapshot (for dashboard card).
 * @param {object} context — from renderer buildFundamentalsDigestAiContext
 */
async function summarizeFundamentalsDigest(context = {}, settings = null) {
  const prompt =
    'You are a G10 macro desk. Read SNAPSHOT (JSON) and write ONE line for traders TODAY: '
    + 'bias vs USD / risk tone, what to lean into, what to stand aside from. '
    + 'Max 130 characters. No disclaimers, no "I", no markdown. Return ONLY compact JSON: {"note":"..."}\n\n'
    + `SNAPSHOT:\n${JSON.stringify(context)}`;

  const r = await freeAi.ask({
    prompt,
    json: true,
    timeoutMs: 18_000,
    apiKey: freeAi.pollinationsKeyFromSettings(settings)
  });
  if (!r.ok || !r.json || typeof r.json !== 'object') {
    return { ok: false, error: r.error || 'ai_failed', text: r.text };
  }
  const note = String(r.json.note || '').trim().slice(0, 160);
  if (!note) return { ok: false, error: 'empty_note' };
  return { ok: true, note };
}

module.exports = {
  summarizeFundamentalsDigest
};
