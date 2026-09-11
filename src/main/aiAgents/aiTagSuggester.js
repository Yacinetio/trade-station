/**
 * AI-powered setup/mistake tag suggestions for a single trade (read-only until accepted).
 */

const freeAi = require('../freeAiClient');
const aiUsage = require('../aiUsage');

function buildTradeFacts(trade) {
  return {
    id: trade?.id,
    symbol: String(trade?.symbol || '').toUpperCase(),
    type: String(trade?.type || '').toUpperCase(),
    status: String(trade?.status || ''),
    profit: Number(trade?.profit) || 0,
    lot: Number(trade?.lot) || null,
    sl: Number(trade?.sl) || null,
    tp: Number(trade?.tp) || null,
    openedAt: trade?.openedAt || trade?.time || null,
    closedAt: trade?.closedAt || trade?.closeTime || null,
    strategyId: trade?.strategyId || null,
    existingTags: Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [],
    presetTags: Array.isArray(trade?.presetTags) ? trade.presetTags : [],
    notes: String(trade?.journal?.notes || '').slice(0, 500),
    emotion: trade?.journal?.emotion || '',
    rating: trade?.journal?.rating || '',
    confidence: trade?.journal?.confidence ?? null,
    realizedR: trade?.realizedR ?? null,
    efficiency: trade?.excursion?.efficiencyPct ?? null
  };
}

function buildSuggestPrompt(trade) {
  const facts = buildTradeFacts(trade);
  return [
    'Suggest up to 4 setup or mistake tags for this closed trade.',
    'Return ONLY JSON: {"suggestions":[{"tag":"kebab-case","confidence":0.0-1.0,"reason":"short"}]}',
    'Tags should be lowercase kebab-case. confidence 0-1. Skip tags already in existingTags.',
    `TRADE:\n${JSON.stringify(facts)}`
  ].join('\n');
}

function parseSuggestionsFromAiReply(text) {
  const parsed = freeAi.tryExtractJson(String(text || ''));
  const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const out = [];
  for (const item of raw.slice(0, 4)) {
    const tag = String(item?.tag || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag) continue;
    let conf = Number(item?.confidence);
    if (!Number.isFinite(conf)) conf = 0.5;
    conf = Math.max(0, Math.min(1, conf));
    out.push({
      tag,
      confidence: Math.round(conf * 100) / 100,
      reason: String(item?.reason || '').slice(0, 120)
    });
  }
  return out;
}

async function suggestTagsForTrade(trade, deps = {}) {
  const { store, getSettings } = deps;
  if (!trade || !trade.id) return { ok: false, error: 'TRADE_REQUIRED' };

  try {
    const settings = typeof getSettings === 'function' ? getSettings() : {};
    const prompt = buildSuggestPrompt(trade);
    const aiRes = await freeAi.ask({
      prompt,
      json: true,
      apiKey: freeAi.pollinationsKeyFromSettings(settings),
      model: freeAi.normalizePollinationsModel(settings?.aiCheck?.model),
      timeoutMs: Number(settings?.aiCheck?.timeoutMs) || 30_000
    });

    if (!aiRes.ok) {
      if (store) aiUsage.record(store, ['errors']);
      return { ok: false, error: aiRes.error || 'ai_failed', text: aiRes.text };
    }
    if (store) aiUsage.record(store, ['used']);

    const fromJson = aiRes.json ? parseSuggestionsFromAiReply(JSON.stringify(aiRes.json)) : [];
    const suggestions = fromJson.length ? fromJson : parseSuggestionsFromAiReply(aiRes.text);
    const existing = new Set(
      (Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [])
        .map((t) => String(t).trim().toLowerCase())
    );
    const filtered = suggestions.filter((s) => !existing.has(s.tag));

    return { ok: true, tradeId: trade.id, suggestions: filtered };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = {
  buildTradeFacts,
  buildSuggestPrompt,
  parseSuggestionsFromAiReply,
  suggestTagsForTrade
};
