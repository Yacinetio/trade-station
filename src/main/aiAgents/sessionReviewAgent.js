/**
 * End-of-day session review agent — compares day vs plan, flags breaches.
 */

const freeAi = require('../freeAiClient');
const aiUsage = require('../aiUsage');

function isClosed(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime;
}

function closeDayKeyLocal(trade, dateKey) {
  const raw = trade?.closedAt || trade?.closeTime;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return key === dateKey;
}

function tagsOf(trade) {
  return (Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [])
    .map((t) => String(t || '').trim().toLowerCase())
    .filter(Boolean);
}

function dailyLossCapBreached(dayTrades, settings) {
  if (!settings?.enableDailyLoss) return false;
  const maxMoney = Number(settings.maxDailyLoss) || 0;
  const maxPct = Number(settings.maxDailyLossPct) || 0;
  if (maxMoney <= 0 && maxPct <= 0) return false;
  const net = dayTrades.reduce((a, t) => a + (Number(t.profit) || 0), 0);
  if (maxMoney > 0 && net <= -maxMoney) return true;
  if (maxPct > 0) {
    const balance = Number(settings.accountBalance) || Number(settings.startingBalance) || 0;
    if (balance > 0 && net <= -(balance * maxPct / 100)) return true;
  }
  return net < 0 && maxMoney > 0 && Math.abs(net) >= maxMoney * 0.9;
}

function pickBestWorst(dayTrades) {
  if (!dayTrades.length) return { best: null, worst: null };
  let best = dayTrades[0];
  let worst = dayTrades[0];
  for (const t of dayTrades) {
    if ((Number(t.profit) || 0) > (Number(best.profit) || 0)) best = t;
    if ((Number(t.profit) || 0) < (Number(worst.profit) || 0)) worst = t;
  }
  return {
    best: summarizeTrade(best),
    worst: summarizeTrade(worst)
  };
}

function summarizeTrade(t) {
  return {
    id: t?.id,
    symbol: String(t?.symbol || '?').toUpperCase(),
    type: String(t?.type || '').toUpperCase(),
    profit: Number(t?.profit) || 0,
    tags: Array.isArray(t?.journal?.tags) ? t.journal.tags : [],
    emotion: t?.journal?.emotion || '',
    rating: t?.journal?.rating || ''
  };
}

function buildSessionReviewContext({ dateKey, trades, settings, briefingMd }) {
  const dk = String(dateKey || '').trim();
  const dayClosed = (Array.isArray(trades) ? trades : [])
    .filter(isClosed)
    .filter((t) => closeDayKeyLocal(t, dk));

  const breachFlags = {
    dailyLossCapCrossed: dailyLossCapBreached(dayClosed, settings || {}),
    oversizedTrades: dayClosed.filter((t) => tagsOf(t).includes('oversized')).length,
    revengeTrades: dayClosed.filter((t) => tagsOf(t).includes('revenge-candidate')).length,
    noSlTrades: dayClosed.filter((t) => tagsOf(t).includes('no-sl')).length
  };

  const { best, worst } = pickBestWorst(dayClosed);
  const netPnl = dayClosed.reduce((a, t) => a + (Number(t.profit) || 0), 0);

  return {
    dateKey: dk,
    tradeCount: dayClosed.length,
    netPnl: Math.round(netPnl * 100) / 100,
    trades: dayClosed.map(summarizeTrade),
    breachFlags,
    best,
    worst,
    morningPlanExcerpt: String(briefingMd || '').slice(0, 800)
  };
}

function buildSessionReviewPrompt(context) {
  return [
    {
      role: 'system',
      content: [
        'You are a trading coach writing an end-of-day session review.',
        'Use CONTEXT JSON only. Markdown with ## headings exactly:',
        'What went well, What broke the rules, Best & worst decision, One focus for tomorrow.',
        'Reference breach flags and tags when relevant. Under 400 words.'
      ].join(' ')
    },
    { role: 'user', content: `CONTEXT:\n${JSON.stringify(context)}` }
  ];
}

function messagesToPrompt(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => `${String(m.role || 'user').toUpperCase()}: ${String(m.content || '')}`)
    .join('\n\n');
}

function formatReviewMarkdown(aiText, context) {
  const body = String(aiText || '').trim();
  if (body.includes('## What went well')) return body;
  const bf = context.breachFlags || {};
  return [
    '## What went well',
    context.tradeCount ? `- Closed ${context.tradeCount} trades; net ${context.netPnl >= 0 ? '+' : ''}$${Math.abs(context.netPnl).toFixed(2)}` : '- No closed trades today.',
    '',
    '## What broke the rules',
    bf.dailyLossCapCrossed ? '- Daily loss cap was crossed or approached.' : '- No daily loss cap breach detected.',
    bf.revengeTrades ? `- ${bf.revengeTrades} trade(s) flagged revenge-candidate.` : '',
    bf.oversizedTrades ? `- ${bf.oversizedTrades} oversized position(s).` : '',
    bf.noSlTrades ? `- ${bf.noSlTrades} trade(s) without stop loss.` : '',
    '',
    '## Best & worst decision',
    context.best ? `- Best: ${context.best.symbol} ${context.best.type} ${context.best.profit >= 0 ? '+' : ''}$${context.best.profit.toFixed(2)}` : '- N/A',
    context.worst ? `- Worst: ${context.worst.symbol} ${context.worst.type} ${context.worst.profit >= 0 ? '+' : ''}$${context.worst.profit.toFixed(2)}` : '- N/A',
    '',
    '## One focus for tomorrow',
    body || '- Write one rule to protect before the open.',
    ''
  ].filter(Boolean).join('\n');
}

async function runSessionReview(deps = {}) {
  const {
    store,
    getSettings,
    getStoredTrades,
    notebookStore,
    notify,
    dateKey
  } = deps;

  try {
    const settings = typeof getSettings === 'function' ? getSettings() : {};
    const trades = typeof getStoredTrades === 'function' ? getStoredTrades() : [];
    const dk = String(dateKey || '').trim() || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    let briefingMd = '';
    if (notebookStore?.listNotes) {
      const notes = notebookStore.listNotes('Journal');
      const todayNote = notes.find((n) => n.dateKey === dk);
      if (todayNote?.body) briefingMd = todayNote.body;
    }

    const context = buildSessionReviewContext({ dateKey: dk, trades, settings, briefingMd });
    const prompt = messagesToPrompt(buildSessionReviewPrompt(context));
    const aiRes = await freeAi.ask({
      prompt,
      json: false,
      apiKey: freeAi.pollinationsKeyFromSettings(settings),
      model: freeAi.normalizePollinationsModel(settings?.aiCheck?.model),
      timeoutMs: Number(settings?.aiCheck?.timeoutMs) || 60_000
    });

    if (!aiRes.ok) {
      if (store) aiUsage.record(store, ['errors']);
      return { ok: false, error: aiRes.error || 'ai_failed' };
    }
    if (store) aiUsage.record(store, ['used']);

    const markdown = formatReviewMarkdown(aiRes.text, context);
    if (notebookStore?.upsertDailyNote) {
      notebookStore.upsertDailyNote(dk, 'Session review', markdown);
    }

    const lastReview = { at: new Date().toISOString(), dateKey: dk, ok: true, tradeCount: context.tradeCount };
    if (store) store.set('aiAgents.lastReview', lastReview);

    if (typeof notify === 'function') {
      notify('Session review ready', `Saved to Journal — ${dk}`, 'ai-review');
    }

    return { ok: true, dateKey: dk, markdown, lastReview, context };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = {
  buildSessionReviewContext,
  buildSessionReviewPrompt,
  formatReviewMarkdown,
  runSessionReview,
  dailyLossCapBreached
};
