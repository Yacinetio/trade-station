/**
 * Pre-market briefing agent — context builder + AI run + notebook delivery.
 */

const freeAi = require('../freeAiClient');
const aiUsage = require('../aiUsage');

function isClosed(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime;
}

function isOpen(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('OPEN') || s.includes('PENDING') || (!isClosed(trade) && !!trade?.openedAt);
}

function utcDayKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function closeDayKey(trade) {
  const raw = trade?.closedAt || trade?.closeTime;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return utcDayKey(d);
}

function money(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
}

function buildOpenRiskSummary(trades) {
  const open = (Array.isArray(trades) ? trades : []).filter(isOpen);
  let riskUsd = 0;
  for (const t of open) {
    const r = Number(t?.riskUsd);
    if (Number.isFinite(r) && r > 0) riskUsd += r;
  }
  return {
    openCount: open.length,
    totalRiskUsd: Math.round(riskUsd * 100) / 100,
    positions: open.slice(0, 12).map((t) => ({
      symbol: String(t?.symbol || '?').toUpperCase(),
      type: String(t?.type || '').toUpperCase(),
      lot: Number(t?.lot) || null,
      profit: Number(t?.profit) || 0,
      riskUsd: Number(t?.riskUsd) || null
    }))
  };
}

function buildLastSessionsStats(trades, count = 5) {
  const closed = (Array.isArray(trades) ? trades : []).filter(isClosed);
  const byDay = new Map();
  for (const t of closed) {
    const dk = closeDayKey(t);
    if (!dk) continue;
    if (!byDay.has(dk)) byDay.set(dk, []);
    byDay.get(dk).push(t);
  }
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a)).slice(0, count);
  return days.map((dayKey) => {
    const items = byDay.get(dayKey) || [];
    const pnls = items.map((t) => Number(t.profit) || 0);
    const net = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter((p) => p > 0).length;
    return {
      dayKey,
      trades: items.length,
      netPnl: Math.round(net * 100) / 100,
      winRate: items.length ? Math.round((wins / items.length) * 100) : 0
    };
  });
}

function upcomingHighImpactEvents(fundamentals, hours = 24) {
  const events = fundamentals?.calendar?.allEvents
    || fundamentals?.calendar?.events
    || [];
  const maxMin = hours * 60;
  return (Array.isArray(events) ? events : [])
    .filter((e) => {
      const impact = Number(e?.impact ?? e?.normalizedImpact ?? 0);
      const mins = Number(e?.minutesToEvent);
      return impact >= 3 && Number.isFinite(mins) && mins >= 0 && mins <= maxMin;
    })
    .slice(0, 8)
    .map((e) => ({
      title: String(e?.title || e?.event || 'Event').slice(0, 80),
      currency: String(e?.currency || e?.country || '').slice(0, 8),
      minutesToEvent: Number(e?.minutesToEvent),
      impact: Number(e?.impact ?? 3)
    }));
}

function topRecentStrategies(trades, strategies, limit = 3) {
  const stratMap = new Map((Array.isArray(strategies) ? strategies : []).map((s) => [String(s.id), s]));
  const usage = new Map();
  for (const t of (Array.isArray(trades) ? trades : []).filter(isClosed)) {
    const sid = String(t?.strategyId || '');
    if (!sid) continue;
    const ms = new Date(t?.closedAt || t?.closeTime || 0).getTime();
    const prev = usage.get(sid);
    if (!prev || ms > prev.lastMs) {
      usage.set(sid, { lastMs: ms, count: (prev?.count || 0) + 1 });
    } else {
      usage.set(sid, { ...prev, count: prev.count + 1 });
    }
  }
  return [...usage.entries()]
    .sort((a, b) => b[1].lastMs - a[1].lastMs)
    .slice(0, limit)
    .map(([id, meta]) => ({
      id,
      name: stratMap.get(id)?.name || id,
      recentClosedCount: meta.count
    }));
}

function extractYesterdayRecap(notebookDaily) {
  if (!notebookDaily) return '';
  const body = String(notebookDaily?.body || notebookDaily?.note?.body || '').trim();
  return body.slice(0, 1200);
}

function buildBriefingContext({ trades, settings, fundamentals, strategies, notebookDaily }) {
  return {
    dateKey: localDateKey(),
    openRisk: buildOpenRiskSummary(trades),
    lastSessions: buildLastSessionsStats(trades, 5),
    upcomingEvents: upcomingHighImpactEvents(fundamentals, 24),
    topStrategies: topRecentStrategies(trades, strategies, 3),
    yesterdayRecap: extractYesterdayRecap(notebookDaily),
    macroNote: String(fundamentals?.headlineIntel?.items?.[0]?.summary || fundamentals?.biasNote || '').slice(0, 200)
  };
}

function buildBriefingPrompt(context) {
  const system = [
    'You are a disciplined trading coach writing a concise pre-market briefing.',
    'Use ONLY facts from CONTEXT JSON. Plain markdown with ## headings exactly:',
    'Market watch, Your risk right now, Recent form, Focus for today.',
    'Be specific, actionable, under 450 words total.'
  ].join(' ');
  const user = `CONTEXT:\n${JSON.stringify(context)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function messagesToPrompt(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => `${String(m.role || 'user').toUpperCase()}: ${String(m.content || '')}`)
    .join('\n\n');
}

function formatBriefingMarkdown(aiText, context) {
  const body = String(aiText || '').trim();
  if (body.includes('## Market watch')) return body;
  const lines = [
    '## Market watch',
    context.upcomingEvents?.length
      ? context.upcomingEvents.map((e) => `- ${e.currency} ${e.title} (~${e.minutesToEvent}m)`).join('\n')
      : '- No major high-impact events flagged in the next 24h.',
    '',
    '## Your risk right now',
    `- Open positions: ${context.openRisk?.openCount ?? 0}`,
    `- Aggregate risk (USD): ${money(context.openRisk?.totalRiskUsd ?? 0)}`,
    '',
    '## Recent form',
    ...(context.lastSessions?.length
      ? context.lastSessions.map((s) => `- ${s.dayKey}: ${s.trades} trades, ${money(s.netPnl)}, ${s.winRate}% WR`)
      : ['- No recent closed-trade sessions on record.']),
    '',
    '## Focus for today',
    body || '- Review your plan before the first entry.',
    '',
    context.yesterdayRecap ? `_Yesterday's note excerpt:_ ${context.yesterdayRecap.slice(0, 280)}…` : ''
  ];
  return lines.filter((l) => l !== '').join('\n');
}

async function runPreMarketBriefing(deps = {}) {
  const {
    store,
    getSettings,
    getStoredTrades,
    getFundamentals,
    listStrategies,
    notebookStore,
    notify
  } = deps;

  try {
    const settings = typeof getSettings === 'function' ? getSettings() : {};
    const trades = typeof getStoredTrades === 'function' ? getStoredTrades() : [];
    let fundamentals = {};
    if (typeof getFundamentals === 'function') {
      try {
        fundamentals = await getFundamentals(settings) || {};
      } catch (_) {
        fundamentals = {};
      }
    }
    const strategies = typeof listStrategies === 'function' ? listStrategies() : [];

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDateKey(yesterday);
    let notebookDaily = null;
    if (notebookStore?.listNotes) {
      const notes = notebookStore.listNotes('Journal');
      notebookDaily = notes.find((n) => n.dateKey === yesterdayKey) || null;
    }

    const context = buildBriefingContext({
      trades,
      settings,
      fundamentals,
      strategies,
      notebookDaily
    });

    const messages = buildBriefingPrompt(context);
    const prompt = messagesToPrompt(messages);
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

    const markdown = formatBriefingMarkdown(aiRes.text, context);
    const todayKey = localDateKey();
    let noteResult = { success: false };
    if (notebookStore?.upsertDailyNote) {
      noteResult = notebookStore.upsertDailyNote(todayKey, 'Pre-market briefing', markdown);
    }

    const lastBriefing = {
      at: new Date().toISOString(),
      dateKey: todayKey,
      ok: true,
      noteSuccess: !!noteResult?.success
    };
    if (store) store.set('aiAgents.lastBriefing', lastBriefing);

    if (typeof notify === 'function') {
      notify('Pre-market briefing ready', `Saved to Journal — ${todayKey}`, 'ai-briefing');
    }

    return { ok: true, noteDateKey: todayKey, markdown, lastBriefing };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = {
  buildBriefingContext,
  buildBriefingPrompt,
  formatBriefingMarkdown,
  runPreMarketBriefing,
  localDateKey,
  upcomingHighImpactEvents
};
