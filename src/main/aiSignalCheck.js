/**
 * AI signal-check — uses the free AI client (no user API key) to score each
 * incoming signal and decide whether to allow, reduce, or block it.
 *
 * Settings shape:
 *   settings.aiCheck = {
 *     enabled: bool,
 *     minConfidence: 0..100,    // below this → block (or reduce)
 *     onLowConfidence: 'block' | 'reduce' | 'allow',
 *     persistAnalysisOnTrade: bool, // false = never attach aiCheck blob to stored trades (logs / verdict strip unchanged)
 *     reduceFactor: 0..1,       // when onLowConfidence === 'reduce'
 *     model: 'openai' | 'mistral' | 'llama' | 'gemini',
 *     extraInstructions: string, // optional user prompt addendum
 *     useChartContext: bool      // false = skip OHLC enrichment (default true)
 *   }
 *
 * Each verdict is also persisted to a recent-history ring (in-memory) so the
 * dashboard "AI Insights" panel can render the last N decisions without an
 * extra round-trip.
 */

const freeAi = require('./freeAiClient');
const aiUsage = require('./aiUsage');

function aiAskBase(settings = {}, cfg = {}, extra = {}) {
  return {
    model: cfg.model || 'openai',
    apiKey: freeAi.pollinationsKeyFromSettings(settings),
    ...extra
  };
}
const { getMarketBars } = require('./marketHistoryService');
const { buildDashboardFilterStatsBreakdown } = require('./analyticsService');

const HISTORY_LIMIT = 50;
let history = [];

/** Injected by main.js so this module stays unit-test friendly. */
let storeRef = null;
function setStore(store) { storeRef = store; }

/** Returns MT5/market-data ctx for getMarketBars — injected by main.js. */
let marketCtxProvider = null;
function setMarketCtxProvider(fn) {
  marketCtxProvider = typeof fn === 'function' ? fn : null;
}
function recordUsage(kinds) {
  if (!storeRef) return null;
  try { return aiUsage.record(storeRef, kinds); } catch (_) { return null; }
}
function getUsageStatus(settings) {
  if (!storeRef) return null;
  try { return aiUsage.getStatus(storeRef, settings); } catch (_) { return null; }
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(Number(n))) return lo;
  return Math.max(lo, Math.min(hi, Number(n)));
}

function firstTakeProfit(rawTp) {
  if (Array.isArray(rawTp)) return Number(rawTp[0]);
  return Number(rawTp);
}

function isBuyType(type) {
  const s = String(type || '').toUpperCase();
  return s.includes('BUY') || s.includes('LONG');
}

function tfToMinutes(tf) {
  const s = String(tf || '').toUpperCase().trim();
  const m = s.match(/^M(\d+)$/);
  if (m) return Math.min(240, Math.max(1, Number(m[1]) || 5));
  if (/^H1$/.test(s)) return 60;
  if (/^H4$/.test(s)) return 240;
  if (/^D1$/.test(s) || /^W1$/.test(s)) return 1440;
  return 5;
}

function fmtPx(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '?';
  const dec = Math.abs(n) > 50 ? 3 : 5;
  return n.toFixed(dec);
}

function screenshotCount(obj) {
  return Array.isArray(obj?.screenshots) ? obj.screenshots.length : 0;
}

function setupLabel(t) {
  if (Array.isArray(t?.presetTags) && t.presetTags.length) {
    return t.presetTags.map((x) => String(x || '').trim()).filter(Boolean).join(';').slice(0, 48);
  }
  return String(t?.setup || '').slice(0, 48);
}

function planGeometrySummary(entry, sl, rawTp, type) {
  const tp = firstTakeProfit(rawTp);
  const risk = Number.isFinite(entry) && Number.isFinite(sl) ? Math.abs(entry - sl) : NaN;
  const rew = Number.isFinite(entry) && Number.isFinite(tp) ? Math.abs(tp - entry) : NaN;
  const rr = risk > 0 && Number.isFinite(rew) ? (rew / risk).toFixed(2) : '?';
  let slSide = '?';
  if (Number.isFinite(entry) && Number.isFinite(sl)) {
    if (isBuyType(type)) slSide = sl < entry ? 'ok_below' : 'wrong_side';
    else slSide = sl > entry ? 'ok_above' : 'wrong_side';
  }
  return `RR=${rr} SL_side=${slSide}`;
}

async function tryGetBars(query, settings, timeoutMs = 9000) {
  const ctx = typeof marketCtxProvider === 'function' ? marketCtxProvider() : null;
  if (!ctx || settings?.aiCheck?.useChartContext === false) return null;
  if (!String(query.brokerSymbol || '').trim()) return null;
  try {
    const res = await Promise.race([
      getMarketBars(query, ctx),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), timeoutMs))
    ]);
    return res;
  } catch (e) {
    return {
      success: false,
      code: e?.code === 'TIMEOUT' ? 'TIMEOUT' : 'FETCH_ERR',
      message: e?.message || String(e)
    };
  }
}

function summarizeBarsVsLevels(bars, { entry, sl, tp, type }) {
  const slice = bars.slice(-Math.min(100, bars.length));
  if (slice.length < 3) return 'bars_too_few';
  const hi = Math.max(...slice.map((b) => b.high));
  const lo = Math.min(...slice.map((b) => b.low));
  const parts = [`rng[${slice.length}]=${fmtPx(lo)}-${fmtPx(hi)}`];
  if (Number.isFinite(entry)) {
    parts.push(`entry=${fmtPx(entry)}`);
    parts.push(`entry_in_rng=${entry >= lo && entry <= hi}`);
  }
  if (Number.isFinite(sl)) parts.push(`SL=${fmtPx(sl)} in_rng=${lo <= sl && sl <= hi}`);
  if (Number.isFinite(tp)) parts.push(`TP=${fmtPx(tp)} in_rng=${lo <= tp && tp <= hi}`);
  const risk = Number.isFinite(entry) && Number.isFinite(sl) ? Math.abs(entry - sl) : NaN;
  if (Number.isFinite(risk) && risk > 0) parts.push(`rng_vs_R=${((hi - lo) / risk).toFixed(2)}x`);
  return parts.join(' ');
}

function coarseResolutionMinutes(sigMin) {
  const m = Number(sigMin);
  if (!Number.isFinite(m) || m < 1) return 240;
  if (m < 240) return 240;
  if (m < 1440) return 1440;
  return null;
}

async function ohlcSnippetForIncomingSignal(signal, settings) {
  const now = Date.now();
  const pad = 72 * 3600 * 1000;
  const fromIso = new Date(now - pad).toISOString();
  const toIso = new Date(now + pad).toISOString();
  const brokerSymbol = String(signal?.symbol || '').trim();
  const sigMin = tfToMinutes(signal?.timeframe);
  const coarseMin = coarseResolutionMinutes(sigMin);
  const entry = Number(signal?.entry);
  const sl = Number(signal?.sl);
  const tp = firstTakeProfit(signal?.tp);
  const type = signal?.type;

  const qPrimary = tryGetBars({
    brokerSymbol,
    resolutionMinutes: sigMin,
    fromIso,
    toIso
  }, settings);

  const qCoarse = coarseMin != null && coarseMin !== sigMin
    ? tryGetBars({
      brokerSymbol,
      resolutionMinutes: coarseMin,
      fromIso,
      toIso
    }, settings)
    : Promise.resolve(null);

  const [res, resCoarse] = await Promise.all([qPrimary, qCoarse]);

  const parts = [];
  if (!res) return '';
  if (!res.success || !Array.isArray(res.bars) || res.bars.length < 3) {
    return `CHART_CONTEXT unavailable:${res?.code || res?.message || '?'}`;
  }
  parts.push(`CHART_SIGNAL_TF (${res.source}) ${summarizeBarsVsLevels(res.bars, { entry, sl, tp, type })}`);

  if (resCoarse && resCoarse.success && Array.isArray(resCoarse.bars) && resCoarse.bars.length >= 3) {
    parts.push(`CHART_COARSE_${coarseMin}m (${resCoarse.source}) ${summarizeBarsVsLevels(resCoarse.bars, { entry, sl, tp, type })}`);
  }

  return parts.join(' | ');
}

async function ohlcSnippetForClosedTrade(trade, settings) {
  const openMs = new Date(trade?.openedAt || trade?.time || 0).getTime();
  const closeMs = new Date(trade?.closedAt || trade?.closeTime || trade?.lastUpdateAt || Date.now()).getTime();
  if (!Number.isFinite(openMs)) return '';
  const pad = 48 * 3600 * 1000;
  const endMs = Number.isFinite(closeMs) ? closeMs : openMs;
  const res = await tryGetBars({
    brokerSymbol: String(trade?.symbol || '').trim(),
    resolutionMinutes: tfToMinutes(trade?.timeframe),
    fromIso: new Date(openMs - pad).toISOString(),
    toIso: new Date(endMs + pad).toISOString()
  }, settings);
  if (!res?.success || !Array.isArray(res.bars) || res.bars.length < 3) {
    return `CHART_CTX:${res?.code || res?.message || 'n/a'}`;
  }
  const entry = Number(trade?.entry);
  const sl = Number(trade?.sl);
  const tp = firstTakeProfit(trade?.tp);
  return `CHART_CTX(${res.source}) ${summarizeBarsVsLevels(res.bars, { entry, sl, tp, type: trade?.type })}`;
}

function pickTopImpactTrades(trades, maxN) {
  return [...trades]
    .filter((t) => String(t?.symbol || '').trim())
    .sort((a, b) => Math.abs(Number(b.profit) || 0) - Math.abs(Number(a.profit) || 0))
    .slice(0, maxN);
}

function isClosed(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('TP_HIT') || s.includes('SL_HIT') || !!t?.closeTime;
}

function recentClosedForChannel(trades, channel, limit = 20) {
  return (trades || [])
    .filter((t) => String(t?.channel || '') === String(channel || '') && isClosed(t))
    .sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')))
    .slice(0, limit);
}

function channelStatsLine(trades, channel) {
  const closed = recentClosedForChannel(trades, channel, 20);
  if (!closed.length) return 'no prior closed trades for this channel';
  const wins = closed.filter((t) => Number(t.profit) > 0).length;
  const wr = (wins / closed.length) * 100;
  const totalPnl = closed.reduce((acc, t) => acc + (Number(t.profit) || 0), 0);
  return `last ${closed.length} closed: WR ${wr.toFixed(0)}%, net ${totalPnl.toFixed(2)}$`;
}

function buildPrompt({ signal, channelName, trades, newsGuard, extraInstructions, chartContext }) {
  const entry = Number(signal?.entry);
  const sl = Number(signal?.sl);
  const tp = firstTakeProfit(signal?.tp);
  const risk = Number.isFinite(entry) && Number.isFinite(sl) ? Math.abs(entry - sl) : 0;
  const reward = Number.isFinite(entry) && Number.isFinite(tp) ? Math.abs(tp - entry) : 0;
  const rr = risk > 0 ? (reward / risk).toFixed(2) : 'unknown';
  const newsLine = newsGuard?.blocked
    ? `news guard says: BLOCKED — ${String(newsGuard.reason || '').slice(0, 80)}`
    : 'news guard says: clear';

  const shots = screenshotCount(signal);
  const geom = planGeometrySummary(entry, sl, signal?.tp, signal?.type);

  const lines = [
    'You are a strict trading risk analyst. Score the trading signal below from 0-100 confidence.',
    'Ground reasoning in: signal timeframe, setup/tags, VWAP, plan geometry, channel stats, and OHLC snippets CHART_SIGNAL_TF / CHART_COARSE_* when present (numeric facts only — no invented candlestick pictures).',
    'IMPORTANT: The "TF bias" field is bias on the SIGNAL timeframe only — not a higher-timeframe trend label. Use CHART_COARSE_* (when present) to discuss broader pressure vs that TF bias; if coarse snippet missing say HTF read is limited.',
    'Comment on ENTRY quality vs recent OHLC in CHART_SIGNAL_TF (and coarse line if present): extreme vs middle of range, chop risk. Use only numeric facts — if unavailable say insufficient_data.',
    'Flag structural risks: wrong-side SL, tiny SL vs recent range (rng_vs_R), fighting the edge of the recent range without justification, missing tags/VWAP context.',
    'You CANNOT see chart screenshots; if Screenshots linked > 0, mention files exist but never describe pixels.',
    'Penalize: missing/wrong-side SL, R:R below 1, news conflicts, weak channel history, entry/plan inconsistent with OHLC snippets.',
    'Reward: R:R >= 2 with valid SL, coherent entry vs OHLC snapshots, TF bias aligned with recent price direction implied by bars when data supports it.',
    '',
    'Signal:',
    `- Channel: ${channelName}`,
    `- Type: ${signal?.type || '?'}`,
    `- Symbol: ${signal?.symbol || '?'}`,
    `- Signal timeframe: ${signal?.timeframe || '?'}`,
    `- TF bias (not HTF trend): ${signal?.bias || '?'}`,
    `- Setup/tags: ${setupLabel(signal) || '?'}`,
    `- VWAP band: ${signal?.vwapBand || '?'}`,
    `- HVN (volume node): ${signal?.hvnBand || '?'}`,
    `- Trend alignment: ${signal?.trendAlign || '?'}`,
    `- OB confluence (multi-TF): ${signal?.confluence != null ? signal.confluence : '?'}`,
    `- OB rejection %: ${signal?.rejPct != null ? `${signal.rejPct}%` : '?'}`,
    `- OB bucket win rate: ${signal?.obWinRate != null ? `${signal.obWinRate}%` : '?'}`,
    `- Top-1 scored zone: ${signal?.top1 === true ? 'YES' : signal?.top1 === false ? 'NO' : '?'}`,
    `- Entry: ${Number.isFinite(entry) ? entry : 'MARKET/unknown'}`,
    `- SL: ${Number.isFinite(sl) ? sl : 'missing'}`,
    `- TP: ${Number.isFinite(tp) ? tp : 'missing'}`,
    `- Plan geometry: ${geom}`,
    `- R:R (reward/risk): ${rr}`,
    `- Screenshots linked: ${shots}`,
    chartContext ? `- ${chartContext}` : '',
    `- ${channelStatsLine(trades, channelName)}`,
    `- ${newsLine}`,
    extraInstructions ? `Extra: ${String(extraInstructions).slice(0, 300)}` : ''
  ].filter(Boolean);

  lines.push(
    '',
    'Output ONLY one JSON object (single line). Required keys:',
    'confidence (int 0-100), verdict ("allow" or "block"), reasons (array of short strings), summary (one sentence),',
    'entryVsChart (<=160 chars), tfBiasVsStructure (<=160 chars), adjustHint (<=160 chars or "").',
    'entryVsChart: entry vs CHART_SIGNAL_TF / CHART_COARSE facts only; use insufficient_data if bars missing.',
    'tfBiasVsStructure: bias is TF-only; compare to coarse OHLC lines when present; else unknown.',
    'adjustHint: optional tweak grounded in numbers (wait, skip, SL width) or "".'
  );

  return lines.join('\n');
}

function persistVerdict(record) {
  history.unshift(record);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

function getRecentVerdicts(limit = HISTORY_LIMIT) {
  return history.slice(0, Math.max(0, Math.min(limit, history.length)));
}

function clearHistory() {
  history = [];
}

/**
 * @param {object} param0
 * @param {object} param0.signal
 * @param {string} param0.channelName
 * @param {object[]} param0.trades
 * @param {object} param0.newsGuard
 * @param {object} param0.settings
 * @returns {Promise<{ enabled: boolean, ok: boolean, score: number, action: 'allow'|'reduce'|'block', reasons: string[], summary?: string, lotMultiplier: number, error?: string }>}
 */
async function checkSignal({ signal, channelName, trades, newsGuard, settings, fastPath = false }) {
  const cfg = settings?.aiCheck || {};
  if (!cfg.enabled) {
    return { enabled: false, ok: true, score: 100, action: 'allow', reasons: [], lotMultiplier: 1 };
  }

  let chartContext = '';
  if (!fastPath && cfg.useChartContext !== false) {
    try {
      chartContext = await ohlcSnippetForIncomingSignal(signal, settings);
    } catch (_) {
      chartContext = '';
    }
  }

  const prompt = buildPrompt({
    signal,
    channelName,
    trades,
    newsGuard,
    extraInstructions: cfg.extraInstructions,
    chartContext
  });

  const defaultTimeout = fastPath ? 3500 : 18000;
  const aiRes = await freeAi.ask({
    prompt,
    json: true,
    ...aiAskBase(settings, cfg, {
      timeoutMs: fastPath
        ? clamp(cfg.fastPathTimeoutMs, 1500, 8000) || defaultTimeout
        : clamp(cfg.timeoutMs, 5000, 25000) || defaultTimeout
    })
  });

  const minConfidence = clamp(cfg.minConfidence, 0, 100) || 70;
  const reduceFactor = clamp(cfg.reduceFactor, 0.05, 1) || 0.5;

  if (!aiRes.ok || !aiRes.json) {
    const isRateLimited = aiRes.error === 'rate_limited' || aiRes.status === 429;
    recordUsage(isRateLimited ? ['rateLimited'] : ['errors']);
    // Note: final allow/block is decided by guardFailMode in the pipeline (fail-closed blocks).
    const reason = isRateLimited
      ? `Provider rate-limited (HTTP 429). Retrying later. No AI verdict.`
      : `AI unreachable (${aiRes.error || 'unknown'}) — no AI verdict.`;
    persistVerdict({
      at: new Date().toISOString(),
      channel: channelName,
      symbol: signal?.symbol,
      type: signal?.type,
      score: null,
      action: 'allow',
      reasons: [reason],
      summary: isRateLimited ? 'Provider rate-limited' : 'AI offline',
      error: aiRes.error
    });
    return {
      enabled: true,
      ok: false,
      score: 0,
      action: 'allow',
      reasons: [reason],
      lotMultiplier: 1,
      error: aiRes.error || 'AI unreachable',
      rateLimited: isRateLimited
    };
  }

  const raw = aiRes.json;
  let score = clamp(Number(raw.confidence), 0, 100);
  if (!Number.isFinite(score)) score = 0;
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.map((r) => String(r || '').slice(0, 160)).filter(Boolean).slice(0, 6)
    : [];
  const summary = String(raw.summary || '').slice(0, 240);
  const entryVsChart = String(raw.entryVsChart || '').slice(0, 200).trim();
  const tfBiasVsStructure = String(raw.tfBiasVsStructure || '').slice(0, 200).trim();
  const adjustHint = String(raw.adjustHint || '').slice(0, 200).trim();
  const aiSaysBlock = String(raw.verdict || '').toLowerCase() === 'block';

  let action = 'allow';
  let lotMultiplier = 1;
  if (score < minConfidence || aiSaysBlock) {
    const mode = cfg.onLowConfidence || 'block';
    if (mode === 'allow') {
      action = 'allow';
      lotMultiplier = 1;
    } else if (mode === 'reduce') {
      action = 'reduce';
      lotMultiplier = reduceFactor;
    } else {
      action = 'block';
    }
  }

  const record = {
    at: new Date().toISOString(),
    channel: channelName,
    symbol: signal?.symbol,
    type: signal?.type,
    score,
    action,
    reasons,
    summary,
    ...(entryVsChart ? { entryVsChart } : {}),
    ...(tfBiasVsStructure ? { tfBiasVsStructure } : {}),
    ...(adjustHint ? { adjustHint } : {}),
    threshold: minConfidence,
    model: cfg.model || 'openai'
  };
  persistVerdict(record);

  recordUsage(['used', action === 'block' ? 'blocked' : action === 'reduce' ? 'reduced' : 'allowed']);

  return {
    enabled: true,
    ok: true,
    score,
    action,
    reasons,
    summary,
    entryVsChart,
    tfBiasVsStructure,
    adjustHint,
    lotMultiplier
  };
}

/**
 * AI commentary on a sample of trades — drives the Dashboard "AI Insights" panel.
 *
 * Sends actual trade rows (not just aggregates) so the model can cite real data,
 * and is wrapped in a strict "ground truth" instruction so the model does NOT
 * invent symbols, dates, strategies or numbers that aren't in the rows.
 *
 * @param {object}   p
 * @param {object[]} p.trades             - all known trades (caller filters)
 * @param {object}   p.settings
 * @param {object}   [p.accountSnapshot]
 * @param {number}   [p.limit=30]         - max trade rows to include in the prompt
 * @param {(number|string)[]} [p.tradeIds] - optional explicit subset to analyse
 */
async function summarizePerformance({ trades = [], settings = {}, accountSnapshot = null, limit = 30, tradeIds = null }) {
  const cfg = settings?.aiCheck || {};
  if (!cfg.enabled) {
    return { ok: false, error: 'AI_DISABLED' };
  }

  let candidate = Array.isArray(trades) ? trades.slice() : [];
  let scope = 'recent_closed';
  if (Array.isArray(tradeIds) && tradeIds.length > 0) {
    const idSet = new Set(tradeIds.map(String));
    candidate = candidate.filter((t) => idSet.has(String(t?.id)));
    scope = 'selected';
  } else {
    candidate = candidate.filter(isClosed);
  }

  if (!candidate.length) {
    return { ok: false, error: scope === 'selected' ? 'NO_SELECTED_TRADES' : 'NO_CLOSED_TRADES' };
  }

  const sorted = candidate
    .slice()
    .sort((a, b) => String(b.openedAt || b.time || '').localeCompare(String(a.openedAt || a.time || '')))
    .slice(0, limit);

  const wins = sorted.filter((t) => Number(t.profit) > 0).length;
  const losses = sorted.filter((t) => Number(t.profit) < 0).length;
  const totalPnl = sorted.reduce((acc, t) => acc + (Number(t.profit) || 0), 0);

  const byChannel = {};
  for (const t of sorted) {
    const ch = String(t.channel || 'Unknown');
    if (!byChannel[ch]) byChannel[ch] = { count: 0, pnl: 0, wins: 0 };
    byChannel[ch].count += 1;
    byChannel[ch].pnl += Number(t.profit) || 0;
    if (Number(t.profit) > 0) byChannel[ch].wins += 1;
  }
  const channelLines = Object.entries(byChannel)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([ch, s]) => `- ${ch}: ${s.count} trades, ${s.wins}W / ${s.count - s.wins}L, ${s.pnl.toFixed(2)}$`)
    .slice(0, 10)
    .join('\n');

  const enrichTargets = pickTopImpactTrades(sorted, 4);
  const chartById = new Map();
  await Promise.all(
    enrichTargets.map(async (t) => {
      const line = await ohlcSnippetForClosedTrade(t, settings);
      if (line) chartById.set(String(t.id), line);
    })
  );

  /** Compact trade list — geometry + optional OHLC snapshot on highest-|P/L| rows. */
  const tradeLines = sorted.map((t, i) => {
    const sym = String(t?.symbol || '?').slice(0, 12);
    const side = String(t?.type || '?').slice(0, 6);
    const tf = String(t?.timeframe || '?').slice(0, 10);
    const bias = String(t?.bias || '?').slice(0, 14);
    const setup = setupLabel(t) || '?';
    const vwap = String(t?.vwapBand || '?').slice(0, 12);
    const hvn = String(t?.hvnBand || '?').slice(0, 12);
    const entry = Number(t?.entry);
    const sl = Number(t?.sl);
    const tp = firstTakeProfit(t?.tp);
    const entryS = Number.isFinite(entry) ? fmtPx(entry) : '?';
    const slS = Number.isFinite(sl) ? fmtPx(sl) : '?';
    const tpS = Number.isFinite(tp) ? fmtPx(tp) : '?';
    const geom = planGeometrySummary(entry, sl, t?.tp, t?.type);
    const open = String(t?.openedAt || t?.time || '').slice(0, 16).replace('T', ' ');
    const close = String(t?.closedAt || t?.closeTime || '').slice(0, 16).replace('T', ' ');
    const profit = Number.isFinite(Number(t?.profit)) ? Number(t.profit).toFixed(2) : '0.00';
    const pips = Number.isFinite(Number(t?.pips)) ? Number(t.pips).toFixed(1) : '';
    const status = String(t?.status || '').slice(0, 16);
    const channel = String(t?.channel || '').slice(0, 24);
    const shots = screenshotCount(t);
    const cx = chartById.get(String(t.id));
    return [
      `${i + 1}. ${sym} ${side}`,
      `tf=${tf} bias=${bias} setup="${setup}" vwap=${vwap} hvn=${hvn}`,
      `entry=${entryS} sl=${slS} tp=${tpS} ${geom}`,
      `ch="${channel}" P/L=${profit}$${pips ? ` (${pips}p)` : ''} status=${status}`,
      `open=${open || '?'} close=${close || '-'}`,
      shots ? `shots=${shots} (AI cannot view images)` : '',
      cx ? cx : ''
    ].filter(Boolean).join(' | ');
  }).join('\n');

  /** Detect which symbols actually appear so we can list them explicitly to anchor the model. */
  const uniqueSymbols = Array.from(new Set(sorted.map((t) => String(t?.symbol || '').toUpperCase()).filter(Boolean)));
  const uniqueChannels = Array.from(new Set(sorted.map((t) => String(t?.channel || '').trim()).filter(Boolean)));

  const balance = accountSnapshot?.balance ? Number(accountSnapshot.balance).toFixed(2) : 'unknown';
  const equity = accountSnapshot?.equity ? Number(accountSnapshot.equity).toFixed(2) : 'unknown';

  const prompt = [
    'You are an honest trading coach. Your job is to review ONLY the trades listed below and surface concrete patterns.',
    '',
    'STRICT RULES — read carefully:',
    '1. Use ONLY the data provided in the TRADES section. Do not invent symbols, channels, dates, prices, pip counts, or strategies that are not in the list.',
    '2. If you cite a number, it must come from the data (or be derived from it).',
    '3. The user trades only the symbols listed under "Symbols in sample" — never assume they trade anything else (e.g. do not mention BTC, ETH, stocks, breakouts, or any concept not visible in the data).',
    '4. If the sample is too small or noisy to draw a conclusion, say so plainly instead of making one up.',
    '5. Keep each bullet under 22 words. Be specific (mention a real symbol or channel when relevant).',
    '6. For wins[] and leaks[], explain WHY using outcome P/L + plan geometry (entry/SL/TP, RR, SL_side) and optional CHART_CTX facts — not vague psychology.',
    '7. CHART_CTX lines are OHLC summaries only (range vs levels); do not invent candlestick patterns or "what the chart looked like". You cannot view screenshots.',
    '',
    `Account: balance ${balance}$, equity ${equity}$`,
    `Sample scope: ${scope === 'selected' ? 'user-selected trades' : 'most recent closed trades'}`,
    `Sample size: ${sorted.length} trades — ${wins}W / ${losses}L, net ${totalPnl.toFixed(2)}$`,
    `Symbols in sample: ${uniqueSymbols.length ? uniqueSymbols.join(', ') : '(none)'}`,
    `Channels in sample: ${uniqueChannels.length ? uniqueChannels.slice(0, 8).join(', ') : '(none)'}`,
    '',
    'Per-channel breakdown:',
    channelLines || '- (none)',
    '',
    'TRADES (one per line):',
    tradeLines || '(empty)',
    '',
    sorted.length === 1
      ? 'Also include chartConfidence (0-100 integer): how well this retrospective fits the single trade row + any CHART_CTX facts.'
      : 'Also include chartConfidence (0-100 integer): confidence in this batch diagnosis.',
    sorted.length === 1
      ? 'Include tradeNote (plain text, <= 500 chars): one journal-ready paragraph summarizing what worked / failed for that trade.'
      : 'Set tradeNote to empty string "".',
    '',
    'Output ONLY a single-line JSON object with these keys:',
    '{"headline":"<= 25 words","wins":["..."],"leaks":["..."],"next_action":"<= 25 words","chartConfidence":72,"tradeNote":"..."}'
  ].join('\n');

  const aiRes = await freeAi.ask({
    prompt,
    json: true,
    ...aiAskBase(settings, cfg, { timeoutMs: 24_000 })
  });
  if (!aiRes.ok || !aiRes.json) {
    const isRateLimited = aiRes.error === 'rate_limited' || aiRes.status === 429;
    recordUsage(isRateLimited ? ['rateLimited'] : ['errors']);
    return {
      ok: false,
      error: aiRes.error || 'ai_offline',
      rateLimited: isRateLimited,
      retryAfter: aiRes.retryAfter
    };
  }
  recordUsage(['used']);
  const j = aiRes.json;
  let chartConfidence = null;
  const cc = Number(j.chartConfidence);
  if (Number.isFinite(cc)) chartConfidence = clamp(cc, 0, 100);
  const tradeNote = sorted.length === 1 ? String(j.tradeNote || '').slice(0, 600).trim() : '';
  return {
    ok: true,
    scope,
    sample: sorted.length,
    totalPnl: Number(totalPnl.toFixed(2)),
    wins,
    losses,
    symbols: uniqueSymbols,
    channels: uniqueChannels,
    headline: String(j.headline || '').slice(0, 240),
    wins_list: Array.isArray(j.wins) ? j.wins.map((x) => String(x)).slice(0, 4) : [],
    leaks: Array.isArray(j.leaks) ? j.leaks.map((x) => String(x)).slice(0, 4) : [],
    next_action: String(j.next_action || '').slice(0, 240),
    chartConfidence,
    tradeNote
  };
}

/**
 * AI reads pre-aggregated win-rate slices for the trades currently visible on the dashboard
 * (all filters + slice pickers applied). No per-trade narrative — stats only.
 */
async function summarizeDashboardStats({ settings = {}, filterSummary = '', trades = [] }) {
  const cfg = settings?.aiCheck || {};
  if (!cfg.enabled) {
    return { ok: false, error: 'AI_DISABLED' };
  }
  const list = Array.isArray(trades) ? trades : [];
  if (list.length === 0) {
    return { ok: false, error: 'NO_TRADES' };
  }
  const beAmt = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);
  const breakdown = buildDashboardFilterStatsBreakdown(list, beAmt);
  if (!breakdown.aggregate.decisive || breakdown.aggregate.decisive < 1) {
    return { ok: false, error: 'NO_DECISIVE_OUTCOMES' };
  }

  const statsJson = JSON.stringify(breakdown);
  const prompt = [
    'You are a concise trading stats analyst. The user filtered their trade log; JSON below is the ONLY source of truth.',
    '',
    'RULES:',
    '1. Use ONLY numbers and slice labels from STATS_JSON. Never invent trades, timeframes, or win rates.',
    '2. Win rate = wins / (wins+losses) for each row; BE/EOD excluded from decisive counts (already reflected).',
    '3. If sample sizes are small (decisive < 8 overall, or a slice has decisive < 5), say conclusions are weak.',
    '4. "pairs" are two dimensions combined (e.g. timeframe + VWAP, timeframe + session, HVN + VWAP). Prefer these when the user combined filters.',
    '5. Suggest 1–3 practical filter experiments (e.g. try another TF or vwap:no) using only labels present in the JSON.',
    '6. Each bullet max 24 words.',
    '',
    `FILTER_CONTEXT: ${String(filterSummary || '').slice(0, 900)}`,
    '',
    `STATS_JSON: ${statsJson}`,
    '',
    'Output ONLY a single-line JSON object:',
    '{"headline":"<=28 words","best_slices":["..."],"worst_slices":["..."],"avoid":["..."],"try_filters":["..."],"caution":"<=28 words or empty"}'
  ].join('\n');

  const aiRes = await freeAi.ask({
    prompt,
    json: true,
    ...aiAskBase(settings, cfg, { timeoutMs: 22_000 })
  });
  if (!aiRes.ok || !aiRes.json) {
    const isRateLimited = aiRes.error === 'rate_limited' || aiRes.status === 429;
    recordUsage(isRateLimited ? ['rateLimited'] : ['errors']);
    return {
      ok: false,
      error: aiRes.error || 'ai_offline',
      rateLimited: isRateLimited,
      retryAfter: aiRes.retryAfter
    };
  }
  recordUsage(['used']);
  const j = aiRes.json;
  return {
    ok: true,
    headline: String(j.headline || '').slice(0, 280),
    best_slices: Array.isArray(j.best_slices) ? j.best_slices.map((x) => String(x)).slice(0, 6) : [],
    worst_slices: Array.isArray(j.worst_slices) ? j.worst_slices.map((x) => String(x)).slice(0, 6) : [],
    avoid: Array.isArray(j.avoid) ? j.avoid.map((x) => String(x)).slice(0, 5) : [],
    try_filters: Array.isArray(j.try_filters) ? j.try_filters.map((x) => String(x)).slice(0, 5) : [],
    caution: String(j.caution || '').slice(0, 320),
    breakdownMeta: {
      trades: breakdown.aggregate.trades,
      decisive: breakdown.aggregate.decisive,
      winRate: breakdown.aggregate.winRate,
      pnl: breakdown.aggregate.pnl
    }
  };
}

/**
 * AI narrative for filter-optimizer top combinations (ranked by WR + P&L).
 */
async function summarizeFilterOptimizer({ settings = {}, context = '', optimizerResult = null }) {
  const cfg = settings?.aiCheck || {};
  if (!cfg.enabled) {
    return { ok: false, error: 'AI_DISABLED' };
  }
  const results = Array.isArray(optimizerResult?.results) ? optimizerResult.results : [];
  if (results.length === 0) {
    return { ok: false, error: 'NO_RESULTS' };
  }

  const payload = {
    anchorSymbol: optimizerResult.anchorSymbol || null,
    poolSize: optimizerResult.poolSize,
    aggregate: optimizerResult.aggregate,
    top: results.slice(0, 10).map((r) => ({
      label: r.label,
      kind: r.kind,
      winRate: r.metrics?.winRate,
      pnl: r.metrics?.pnl,
      decisive: r.metrics?.decisive,
      filterPatch: r.filterPatch
    }))
  };

  const prompt = [
    'You are a trading filter analyst. JSON below lists the best-performing filter combinations for the user\'s trade history in the selected period.',
    '',
    'RULES:',
    '1. Use ONLY numbers and labels from OPTIMIZER_JSON. Never invent stats.',
    '2. Rankings already reflect win rate + P&L + sample size — explain WHY the top 2–3 stand out.',
    '3. If anchorSymbol is set, focus recommendations on filters that work WITH that pair (not changing the pair).',
    '4. Suggest 1–3 concrete filter setups the user can apply (reference label + WR/P&L).',
    '5. Warn when decisive count < 8 on a combo.',
    '6. Each bullet max 22 words.',
    '',
    `CONTEXT: ${String(context || '').slice(0, 900)}`,
    '',
    `OPTIMIZER_JSON: ${JSON.stringify(payload)}`,
    '',
    'Output ONLY a single-line JSON object:',
    '{"headline":"<=28 words","best_combos":["..."],"pair_specific":["..."],"avoid":["..."],"apply_first":"<=32 words","caution":"<=28 words or empty"}'
  ].join('\n');

  const aiRes = await freeAi.ask({
    prompt,
    json: true,
    ...aiAskBase(settings, cfg, { timeoutMs: 22_000 })
  });
  if (!aiRes.ok || !aiRes.json) {
    const isRateLimited = aiRes.error === 'rate_limited' || aiRes.status === 429;
    recordUsage(isRateLimited ? ['rateLimited'] : ['errors']);
    return {
      ok: false,
      error: aiRes.error || 'ai_offline',
      rateLimited: isRateLimited,
      retryAfter: aiRes.retryAfter
    };
  }
  recordUsage(['used']);
  const j = aiRes.json;
  return {
    ok: true,
    headline: String(j.headline || '').slice(0, 280),
    best_combos: Array.isArray(j.best_combos) ? j.best_combos.map((x) => String(x)).slice(0, 6) : [],
    pair_specific: Array.isArray(j.pair_specific) ? j.pair_specific.map((x) => String(x)).slice(0, 5) : [],
    avoid: Array.isArray(j.avoid) ? j.avoid.map((x) => String(x)).slice(0, 5) : [],
    apply_first: String(j.apply_first || '').slice(0, 320),
    caution: String(j.caution || '').slice(0, 320)
  };
}

/**
 * AI narrative for worst trades / underperforming filter buckets.
 */
async function summarizeWorstTrades({ settings = {}, context = '', analysisResult = null }) {
  const cfg = settings?.aiCheck || {};
  if (!cfg.enabled) {
    return { ok: false, error: 'AI_DISABLED' };
  }
  if (!analysisResult?.ok) {
    return { ok: false, error: 'NO_ANALYSIS' };
  }

  const payload = {
    poolSize: analysisResult.poolSize,
    lossCount: analysisResult.lossCount,
    aggregate: analysisResult.aggregate,
    worstTrades: (analysisResult.worstTrades || []).slice(0, 8),
    worstBuckets: (analysisResult.worstBuckets || []).slice(0, 8),
    patterns: analysisResult.patterns || [],
    avoid: analysisResult.avoid || []
  };

  const prompt = [
    'You are a trading risk analyst. JSON below lists the worst individual losses and underperforming filter buckets for the user\'s current trade scope.',
    '',
    'RULES:',
    '1. Use ONLY data from WORST_JSON. Never invent trades or stats.',
    '2. Explain WHY these trades/buckets hurt performance — reference WR, P&L, and decisive counts.',
    '3. Give 2–4 concrete avoidance rules (sessions, TF, pair combos, etc.) the user can apply as filters.',
    '4. If sample sizes are tiny (decisive < 5), say conclusions are weak.',
    '5. Each bullet max 24 words.',
    '',
    `FILTER_CONTEXT: ${String(context || '').slice(0, 900)}`,
    '',
    `WORST_JSON: ${JSON.stringify(payload)}`,
    '',
    'Output ONLY a single-line JSON object:',
    '{"headline":"<=28 words","worst_trades":["..."],"leak_patterns":["..."],"avoid_filters":["..."],"apply_first":"<=25 words","caution":"<=28 words or empty"}'
  ].join('\n');

  const aiRes = await freeAi.ask({
    prompt,
    json: true,
    ...aiAskBase(settings, cfg, { timeoutMs: 22_000 })
  });
  if (!aiRes.ok || !aiRes.json) {
    const isRateLimited = aiRes.error === 'rate_limited' || aiRes.status === 429;
    recordUsage(isRateLimited ? ['rateLimited'] : ['errors']);
    return {
      ok: false,
      error: aiRes.error || 'ai_offline',
      rateLimited: isRateLimited,
      retryAfter: aiRes.retryAfter
    };
  }
  recordUsage(['used']);
  const j = aiRes.json;
  return {
    ok: true,
    headline: String(j.headline || '').slice(0, 280),
    worst_trades: Array.isArray(j.worst_trades) ? j.worst_trades.map((x) => String(x)).slice(0, 6) : [],
    leak_patterns: Array.isArray(j.leak_patterns) ? j.leak_patterns.map((x) => String(x)).slice(0, 6) : [],
    avoid_filters: Array.isArray(j.avoid_filters) ? j.avoid_filters.map((x) => String(x)).slice(0, 6) : [],
    apply_first: String(j.apply_first || '').slice(0, 320),
    caution: String(j.caution || '').slice(0, 320)
  };
}

module.exports = {
  checkSignal,
  summarizePerformance,
  summarizeDashboardStats,
  summarizeFilterOptimizer,
  summarizeWorstTrades,
  getRecentVerdicts,
  clearHistory,
  freeAi,
  setStore,
  setMarketCtxProvider,
  getUsageStatus,
  summarizeBarsVsLevels,
  fmtPx,
  tfToMinutes
};
