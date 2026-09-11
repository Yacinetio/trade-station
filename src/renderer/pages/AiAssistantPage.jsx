import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TradingViewChart from '../components/TradingViewChart.jsx';
import AiLevelsChart from '../components/AiLevelsChart.jsx';
import AiAgentsPanel from '../components/AiAgentsPanel.jsx';
import { formatAssistantReply } from '../utils/formatAssistantReply.js';
import { extractEntrySlTpFromAnalysis } from '../utils/extractLevelsFromAnalysis.js';

const TF_OPTIONS = [
  { id: 'M5', label: 'M5', tvInterval: '5', minutes: 5 },
  { id: 'M15', label: 'M15', tvInterval: '15', minutes: 15 },
  { id: 'M30', label: 'M30', tvInterval: '30', minutes: 30 },
  { id: 'H1', label: 'H1', tvInterval: '60', minutes: 60 },
  { id: 'H4', label: 'H4', tvInterval: '240', minutes: 240 },
  { id: 'D1', label: 'D1', tvInterval: 'D', minutes: 1440 }
];

const RANGE_OPTIONS = [
  { id: '1d', label: '1D', hours: 24 },
  { id: '3d', label: '3D', hours: 72 },
  { id: '1w', label: '1W', hours: 24 * 7 },
  { id: '1m', label: '1M', hours: 24 * 30 }
];

const LS_SYMBOL = 'ts-ai-page-symbol';
const LS_TF = 'ts-ai-page-tf';
const LS_RANGE = 'ts-ai-page-range';
const LS_ATTACH = 'ts-ai-page-attach';
const LS_SESSION = 'ts-ai-page-session';
const LS_TV_PREFIX = 'ts-ai-page-tv-prefix';
const LS_ANALYSIS_TEMPLATE = 'ts-ai-analysis-template';
const LS_ANALYSIS_TEMPLATE_OPEN = 'ts-ai-analysis-template-open';
const LS_ANALYSIS_TEMPLATE_TEXTAREA_H = 'ts-ai-analysis-template-textarea-h';
const LS_CHART_TAB = 'ts-ai-page-chart-tab';
const LS_AI_MODEL = 'ts-ai-page-chat-model';

const MAX_ANALYSIS_TEMPLATE_CHARS = 4500;
const TEMPLATE_TEXTAREA_H_MIN = 120;
const TEMPLATE_TEXTAREA_H_MAX = 900;
const TEMPLATE_TEXTAREA_H_DEFAULT = 280;

function clampTemplateTextareaHeight(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return TEMPLATE_TEXTAREA_H_DEFAULT;
  return Math.min(TEMPLATE_TEXTAREA_H_MAX, Math.max(TEMPLATE_TEXTAREA_H_MIN, Math.round(n)));
}

/**
 * Preset prompts for Quick analysis. [PAIR], [TF], [BARS] are substituted on send.
 * Custom template (editable panel) defaults to the first preset when reset.
 */
const ANALYSIS_PRESETS = [
  {
    id: 'full',
    label: 'Full MTF',
    description: 'Macro → HTF structure → liquidity → zones → execution (institutional order)',
    template: `Perform a professional multi-timeframe analysis of [PAIR]. Primary chart timeframe for numeric context: [TF] (CHART_CTX includes [BARS] OHLC bars when “Attach chart context” is on).

Session and data:
- Assume a normal liquid session unless the chart shows dead chop; say when low volume makes levels unreliable.
- If CHART_CTX is missing, thin, or stale, say so and avoid inventing prices—give structure without fake levels.

Cover:
- Macro / fundamental bias (short, no essay)
- Market structure: swings, trend, breaks of structure vs internal structure
- Liquidity: equal highs/lows, obvious stop-runs, resting liquidity (tie to structure, not buzzwords)
- Support / resistance and decision zones (use CHART_CTX numbers when present)
- Smart-money ideas only where they clarify structure or liquidity
- Momentum and volatility regime (trend vs range, expanding vs compressing)
- Bullish and bearish scenarios (both explicit)
- One high-probability setup only—not a menu of trades
- Risk: max adverse excursion, event risk if relevant
- Trade plan: entry style, stop, targets; invalidation must be a specific price OR a clear structure break (not “if it feels wrong”)

Answer in this order:
1) Macro bias
2) HTF structure (conceptual HTF unless higher-TF data is given)
3) Liquidity map
4) Key zones
5) LTF execution (aligned with [TF])
6) Risk management
7) Trade execution

Rules:
- Ground prices in CHART_CTX when provided; never fabricate OHLC.
- Do not lead with indicators; mention them only if they confirm structure you already stated.
- Plain text, no markdown headings or markdown lists.
- Tone: institutional, concise, no hype.`
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Price action, structure, liquidity, levels—minimal macro',
    template: `Technical analysis for [PAIR] on [TF]. CHART_CTX has [BARS] OHLC bars when attached—anchor every price to it; if context is missing say so and avoid invented levels.

Deliver in order:
1) Regime: clear trend vs balanced range on this timeframe
2) Structure: last material swings, BOS vs internal structure, higher highs/lows or compression
3) Liquidity: obvious EQH/EQL, prior session extremes, recent sweep or failure to sweep
4) Zones: nearest support/resistance and decision bands using only CHART_CTX numbers
5) Momentum/volatility: expansion vs contraction, failure tests
6) Bullish path vs bearish path (both concrete)
7) One trade idea only: entry approach, stop, targets, invalidation as exact level or clean structure break

Indicators only as a one-line footnote if they confirm the above. Plain text, no markdown.`
  },
  {
    id: 'macro',
    label: 'Macro',
    description: 'Drivers, bias, themes—then check price alignment with CHART_CTX',
    template: `Macro and fundamental-led view on [PAIR], chart [TF], CHART_CTX [BARS] bars when attached.

Cover in order:
1) Macro bias: rates, growth, inflation tilt, USD/risk tone, and what matters most for this instrument (keep concise)
2) Cross-asset read only if it clarifies bias (e.g. yields, DXY, risk proxies) without a lecture
3) Scheduled risk: notable macro prints or events if they realistically matter this week; otherwise say “no major known tape bombs”
4) How that bias should look on price (directional expectations) without fabricating levels
5) Technical reality check: using ONLY CHART_CTX numbers, does price agree, diverge, or sit in no-man’s land?
6) Bullish vs bearish macro-led scenario
7) At most one trade idea if macro + CHART_CTX align; otherwise say wait/fade/news flat

Label uncertainty. No fake OHLC. Plain text, no markdown. Institutional tone.`
  },
  {
    id: 'intraday',
    label: 'Intraday',
    description: 'Session, local structure, tactical plan, tight invalidation',
    template: `Intraday tactical analysis for [PAIR] on [TF]. CHART_CTX: [BARS] bars when attached—use those prices only.

Assume an active session unless the chart proves dead chop; call out thin tape.

In order:
1) Session posture (e.g. balance vs trend day) and intraday structure
2) Key intraday liquidity: prior highs/lows, opening drift, obvious stops from recent swings (grounded in CHART_CTX)
3) Immediate support/resistance and where a breakout vs fade makes sense
4) Volatility: is range expanding or compressing into a decision?
5) Two scenarios: continuation vs mean-reversion for the rest of the session
6) One primary tactical plan (scalp or day trade style): entry style, stop, targets
7) Invalidation: tight—specific level or micro structure break

Plain text, no markdown. No invented prices.`
  },
  {
    id: 'swing',
    label: 'Swing',
    description: 'Longer horizon bias, major zones, patience, wider invalidation',
    template: `Swing outlook for [PAIR] with chart [TF] and CHART_CTX of [BARS] bars when attached.

Focus on holding-period trades (multi-day to weeks conceptually) without pretending you see unseen higher timeframes—label HTF views as inferred.

In order:
1) Big-picture directional bias (conceptual HTF) and what would challenge it
2) Major structural story: dominant leg, consolidation, breakout vs range
3) Key decision zones using ONLY CHART_CTX numbers; flag if the window is too short to trust “weekly” claims
4) Pullback vs continuation playbook
5) Vol and trend quality for swing holds
6) Bullish swing path vs bearish swing path
7) One swing setup: entry concept, stop placement philosophy, logical targets
8) Invalidation: major structure break or loss of a named level from context

No fabricated OHLC. Plain text, no markdown.`
  },
  {
    id: 'risk',
    label: 'Risk review',
    description: 'Scenarios, falsification, sizing checklist—minimal directional hype',
    template: `Pre-trade risk and plan audit for [PAIR] on [TF]. CHART_CTX: [BARS] bars if attached—do not invent levels.

Stay neutral-diagnostics first; no cheerleading.

Provide:
1) Three scenarios (bull / bear / chop) with what evidence from CHART_CTX would confirm each
2) Falsification: what observation would kill each thesis
3) Liquidity and execution risks (gaps, thin sessions) for this instrument class
4) Correlation or headline vectors that could gaps through stops
5) Position sizing mindset: define risk in R or % terms conceptually, max adverse excursion to respect
6) Short checklist before clicking buy/sell: news window, spread/slippage, invalidation written, size
7) Optional lean: one tactical bias ONLY if CHART_CTX clearly supports it; otherwise “no edge / stand aside”

Plain text, no markdown.`
  }
];

const TV_PREFIX_DEFAULTS = {
  FX: 'OANDA',
  CRYPTO: 'BINANCE',
  INDEX: 'OANDA',
  METAL: 'OANDA'
};

function readLs(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function writeLs(key, value) {
  try { window.localStorage.setItem(key, String(value)); } catch (_) { /* noop */ }
}

function fillAnalysisTemplate(tmpl, { pair, tf, bars }) {
  const p = String(pair || '').trim() || '?';
  const t = String(tf || '').trim() || '?';
  const b = Number.isFinite(Number(bars)) ? String(Math.max(0, Math.floor(Number(bars)))) : '0';
  return String(tmpl || '')
    .split('[PAIR]').join(p)
    .split('[TF]').join(t)
    .split('[BARS]').join(b);
}

function inferDefaultTvPrefix(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (/(USD|USDT|USDC)$/.test(s) && /^(BTC|ETH|SOL|XRP|BNB|DOGE|LTC)/.test(s)) return TV_PREFIX_DEFAULTS.CRYPTO;
  if (/^(XAU|XAG|XPT)/.test(s)) return TV_PREFIX_DEFAULTS.METAL;
  if (/^(US30|NAS100|SPX500|GER40|GER30|UK100|JPN225)/.test(s)) return 'OANDA';
  return TV_PREFIX_DEFAULTS.FX;
}

function tvSymbolFor(symbol, prefix) {
  const raw = String(symbol || '').trim();
  if (!raw) return '';
  if (raw.includes(':')) return raw.toUpperCase();
  const p = String(prefix || inferDefaultTvPrefix(raw)).trim().toUpperCase() || 'OANDA';
  return `${p}:${raw.toUpperCase()}`;
}

function marketSymbolFor(symbol) {
  const raw = String(symbol || '').trim();
  if (!raw) return '';
  if (raw.includes(':')) return raw.split(':').pop().toUpperCase();
  return raw.toUpperCase();
}

function fmtPx(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  const dec = Math.abs(v) > 50 ? 3 : 5;
  return v.toFixed(dec);
}

function buildChartContextText(bars, { symbol, tf }) {
  const arr = Array.isArray(bars) ? bars : [];
  if (arr.length < 3) return '';
  const last = arr[arr.length - 1];
  const slice = arr.slice(-Math.min(100, arr.length));
  const hi = Math.max(...slice.map((b) => Number(b.high) || -Infinity));
  const lo = Math.min(...slice.map((b) => Number(b.low) || Infinity));
  const close = Number(last?.close);
  const open100 = Number(slice[0]?.open);
  const change = Number.isFinite(close) && Number.isFinite(open100) ? close - open100 : NaN;
  const range = hi - lo;
  const posInRange = range > 0 && Number.isFinite(close) ? ((close - lo) / range) * 100 : NaN;
  const recent = arr.slice(-6).map((b) => `${fmtPx(b.open)}/${fmtPx(b.high)}/${fmtPx(b.low)}/${fmtPx(b.close)}`).join(' | ');
  const lines = [
    `${symbol} ${tf} bars=${arr.length}`,
    `range[${slice.length}]=${fmtPx(lo)}..${fmtPx(hi)} close=${fmtPx(close)}`,
    Number.isFinite(posInRange) ? `pos_in_range=${posInRange.toFixed(0)}%` : '',
    Number.isFinite(change) ? `delta_last_${slice.length}=${change >= 0 ? '+' : ''}${fmtPx(change)}` : '',
    recent ? `last6 O/H/L/C: ${recent}` : ''
  ].filter(Boolean);
  return lines.join(' | ');
}

function fmtTime(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '';
  return t.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit' });
}

function chatBubbleBodyText(content, role) {
  if (role === 'assistant') return formatAssistantReply(content);
  return String(content ?? '');
}

export default function AiAssistantPage({ routeVisible = true }) {
  const [modelOptions, setModelOptions] = useState(() => [{ id: 'openai', label: 'OpenAI (balanced)' }]);
  const [chatModel, setChatModel] = useState(() => readLs(LS_AI_MODEL, 'openai'));

  const [symbol, setSymbol] = useState(() => readLs(LS_SYMBOL, 'XAUUSD').toUpperCase());
  const [tfId, setTfId] = useState(() => readLs(LS_TF, 'H1'));
  const [rangeId, setRangeId] = useState(() => readLs(LS_RANGE, '1w'));
  const [tvPrefix] = useState(() => readLs(LS_TV_PREFIX, '') || '');

  const tf = useMemo(() => TF_OPTIONS.find((t) => t.id === tfId) || TF_OPTIONS[3], [tfId]);
  const range = useMemo(() => RANGE_OPTIONS.find((r) => r.id === rangeId) || RANGE_OPTIONS[2], [rangeId]);
  const tvSymbol = useMemo(() => tvSymbolFor(symbol, tvPrefix), [symbol, tvPrefix]);
  const marketSymbol = useMemo(() => marketSymbolFor(symbol), [symbol]);

  const [bars, setBars] = useState([]);

  const chartContextText = useMemo(
    () => buildChartContextText(bars, { symbol: marketSymbol, tf: tf.id }),
    [bars, marketSymbol, tf.id]
  );

  useEffect(() => { writeLs(LS_SYMBOL, symbol); }, [symbol]);
  useEffect(() => { writeLs(LS_TF, tfId); }, [tfId]);
  useEffect(() => { writeLs(LS_RANGE, rangeId); }, [rangeId]);
  useEffect(() => { writeLs(LS_TV_PREFIX, tvPrefix); }, [tvPrefix]);

  const onTradingViewSymbolChange = useCallback((next) => {
    const s = String(next || '').trim();
    if (!s) return;
    setSymbol(s);
  }, []);

  const loadBars = useCallback(async () => {
    if (!window.electronAPI?.getMarketBars || !marketSymbol) {
      setBars([]);
      return;
    }
    try {
      const now = Date.now();
      const from = new Date(now - range.hours * 3600 * 1000).toISOString();
      const to = new Date(now + 60 * 60 * 1000).toISOString();
      const res = await window.electronAPI.getMarketBars({
        symbol: marketSymbol,
        resolutionMinutes: tf.minutes,
        from,
        to
      });
      if (res?.success && Array.isArray(res.bars)) {
        setBars(res.bars);
      } else {
        setBars([]);
      }
    } catch (e) {
      setBars([]);
    }
  }, [marketSymbol, tf.minutes, range.hours]);

  useEffect(() => {
    if (!routeVisible) return undefined;
    loadBars();
    return undefined;
  }, [routeVisible, loadBars]);

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() => readLs(LS_SESSION, ''));
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [draft, setDraft] = useState('');
  const [attach, setAttach] = useState(() => readLs(LS_ATTACH, '1') !== '0');
  const [analysisTemplate, setAnalysisTemplate] = useState(() => {
    const saved = readLs(LS_ANALYSIS_TEMPLATE, '');
    return saved.trim() ? saved.slice(0, MAX_ANALYSIS_TEMPLATE_CHARS) : ANALYSIS_PRESETS[0].template;
  });
  const [analysisTemplateOpen, setAnalysisTemplateOpen] = useState(
    () => readLs(LS_ANALYSIS_TEMPLATE_OPEN, '0') === '1'
  );
  const messagesScrollRef = useRef(null);
  const composerRef = useRef(null);
  const templateTextareaRef = useRef(null);
  const [templateTextareaPx, setTemplateTextareaPx] = useState(() =>
    clampTemplateTextareaHeight(Number(readLs(LS_ANALYSIS_TEMPLATE_TEXTAREA_H, '')))
  );

  useEffect(() => { writeLs(LS_ATTACH, attach ? '1' : '0'); }, [attach]);
  useEffect(() => { writeLs(LS_SESSION, activeSessionId || ''); }, [activeSessionId]);
  useEffect(() => { writeLs(LS_ANALYSIS_TEMPLATE_OPEN, analysisTemplateOpen ? '1' : '0'); }, [analysisTemplateOpen]);

  useEffect(() => {
    const el = templateTextareaRef.current;
    if (!el || !analysisTemplateOpen) return undefined;
    const ro = new ResizeObserver(() => {
      const h = clampTemplateTextareaHeight(el.offsetHeight);
      writeLs(LS_ANALYSIS_TEMPLATE_TEXTAREA_H, String(h));
      setTemplateTextareaPx((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [analysisTemplateOpen]);

  const refreshSessions = useCallback(async () => {
    if (!window.electronAPI?.getAiChatSessions) return [];
    try {
      const r = await window.electronAPI.getAiChatSessions();
      const list = Array.isArray(r?.sessions) ? r.sessions : [];
      setSessions(list);
      return list;
    } catch (_) {
      return [];
    }
  }, []);

  const loadMessages = useCallback(async (sid) => {
    if (!sid || !window.electronAPI?.getAiChatMessages) {
      setMessages([]);
      return;
    }
    try {
      const r = await window.electronAPI.getAiChatMessages(sid);
      setMessages(Array.isArray(r?.messages) ? r.messages : []);
    } catch (_) {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (!routeVisible) return;
    (async () => {
      const list = await refreshSessions();
      if (!activeSessionId && list.length > 0) {
        setActiveSessionId(list[0].id);
      } else if (activeSessionId && !list.some((s) => String(s.id) === String(activeSessionId))) {
        setActiveSessionId(list[0]?.id || '');
      }
    })();
  }, [routeVisible, refreshSessions, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    loadMessages(activeSessionId);
  }, [activeSessionId, loadMessages]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  const [pageTab, setPageTab] = useState('chat');
  const [chartTab, setChartTab] = useState(() => (readLs(LS_CHART_TAB, 'tv') === 'levels' ? 'levels' : 'tv'));
  useEffect(() => { writeLs(LS_CHART_TAB, chartTab); }, [chartTab]);

  useEffect(() => {
    if (!routeVisible) return undefined;
    let cancel = false;
    (async () => {
      try {
        const r = await window.electronAPI?.getFreeTextModels?.();
        if (!cancel && Array.isArray(r?.models) && r.models.length > 0) {
          setModelOptions(r.models);
          const def = String(r.defaultModel || '').trim();
          const saved = readLs(LS_AI_MODEL, '');
          if (!saved && def) {
            setChatModel(def);
            writeLs(LS_AI_MODEL, def);
          }
        }
      } catch (_) {
        /* keep defaults */
      }
    })();
    return () => { cancel = true; };
  }, [routeVisible]);

  useEffect(() => {
    if (!modelOptions.length) return;
    if (modelOptions.some((m) => m.id === chatModel)) return;
    const fix = modelOptions[0].id;
    setChatModel(fix);
    writeLs(LS_AI_MODEL, fix);
  }, [modelOptions, chatModel]);

  useEffect(() => {
    const s = sessions.find((x) => String(x.id) === String(activeSessionId));
    if (s?.model && String(s.model).trim()) {
      setChatModel(String(s.model).trim());
    }
  }, [activeSessionId, sessions]);

  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') {
        return chatBubbleBodyText(messages[i].content, 'assistant');
      }
    }
    return '';
  }, [messages]);

  const barRangeForLevels = useMemo(() => {
    if (!bars.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of bars) {
      lo = Math.min(lo, Number(b.low));
      hi = Math.max(hi, Number(b.high));
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return { lo, hi };
  }, [bars]);

  const extractedLevels = useMemo(
    () => extractEntrySlTpFromAnalysis(lastAssistantText, barRangeForLevels),
    [lastAssistantText, barRangeForLevels]
  );

  const onChatModelChange = useCallback((e) => {
    const v = String(e.target.value || 'openai');
    setChatModel(v);
    writeLs(LS_AI_MODEL, v);
    if (activeSessionId && window.electronAPI?.patchAiChatSession) {
      window.electronAPI.patchAiChatSession(activeSessionId, { model: v }).then(() => {
        refreshSessions();
      }).catch(() => { /* noop */ });
    }
  }, [activeSessionId, refreshSessions]);

  const onNewChat = useCallback(async () => {
    if (!window.electronAPI?.newAiChatSession) return;
    setChatError('');
    try {
      const r = await window.electronAPI.newAiChatSession({ model: chatModel });
      if (r?.session?.id) {
        await refreshSessions();
        setActiveSessionId(r.session.id);
        setMessages([]);
      }
    } catch (e) {
      setChatError(String(e?.message || e));
    }
  }, [refreshSessions, chatModel]);

  const onDeleteChat = useCallback(async () => {
    if (!activeSessionId || !window.electronAPI?.deleteAiChatSession) return;
    if (!window.confirm('Delete this chat permanently?')) return;
    try {
      await window.electronAPI.deleteAiChatSession(activeSessionId);
      const list = await refreshSessions();
      setActiveSessionId(list[0]?.id || '');
    } catch (e) {
      setChatError(String(e?.message || e));
    }
  }, [activeSessionId, refreshSessions]);

  const onRenameChat = useCallback(async () => {
    if (!activeSessionId || !window.electronAPI?.renameAiChatSession) return;
    const current = sessions.find((s) => String(s.id) === String(activeSessionId));
    const next = window.prompt('Rename chat:', current?.title || 'New chat');
    if (next == null) return;
    try {
      await window.electronAPI.renameAiChatSession(activeSessionId, next);
      await refreshSessions();
    } catch (e) {
      setChatError(String(e?.message || e));
    }
  }, [activeSessionId, sessions, refreshSessions]);

  const onSend = useCallback(async (overrideText) => {
    const text = String(overrideText != null ? overrideText : draft).trim();
    if (!text || sending || !window.electronAPI?.sendAiChatMessage) return;
    setChatError('');
    setSending(true);
    try {
      const r = await window.electronAPI.sendAiChatMessage({
        sessionId: activeSessionId || undefined,
        model: chatModel,
        content: text,
        chartContext: attach ? chartContextText : '',
        attach: attach ? { symbol: marketSymbol, tf: tf.id } : null
      });
      if (r?.ok) {
        const newSid = r.sessionId || activeSessionId;
        await refreshSessions();
        if (!activeSessionId && newSid) setActiveSessionId(newSid);
        await loadMessages(newSid);
        setDraft('');
      } else {
        const hint =
          r?.error === 'rate_limited' || Number(r?.status) === 429
            ? 'Service busy (HTTP 429). Try again in a moment or switch model.'
            : '';
        setChatError([hint || `Request failed: ${r?.error || 'unknown'}`, Number(r?.status) > 0 ? `(HTTP ${r.status})` : ''].filter(Boolean).join(' '));
        await refreshSessions();
        if (r?.sessionId) await loadMessages(r.sessionId);
      }
    } catch (e) {
      setChatError(String(e?.message || e));
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  }, [draft, sending, activeSessionId, chatModel, attach, chartContextText, marketSymbol, tf.id, refreshSessions, loadMessages]);

  const persistAnalysisTemplate = useCallback((next) => {
    const clipped = String(next || '').slice(0, MAX_ANALYSIS_TEMPLATE_CHARS);
    setAnalysisTemplate(clipped);
    writeLs(LS_ANALYSIS_TEMPLATE, clipped);
  }, []);

  const resetAnalysisTemplate = useCallback(() => {
    persistAnalysisTemplate(ANALYSIS_PRESETS[0].template);
  }, [persistAnalysisTemplate]);

  const runFilledTemplate = useCallback((tmpl) => {
    const raw = String(tmpl || '').trim();
    if (!raw) return;
    const text = fillAnalysisTemplate(raw, {
      pair: marketSymbol,
      tf: tf.id,
      bars: bars.length
    }).trim();
    if (!text) return;
    setDraft(text);
    onSend(text);
  }, [marketSymbol, tf.id, bars.length, onSend]);

  const runCustomTemplate = useCallback(() => {
    const raw = String(analysisTemplate || '').trim() || ANALYSIS_PRESETS[0].template;
    runFilledTemplate(raw);
  }, [analysisTemplate, runFilledTemplate]);

  const onComposerKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const activeSession = sessions.find((s) => String(s.id) === String(activeSessionId)) || null;

  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <div className="ai-page-head-text">
          <div className="ai-page-kicker">Trade Station · AI</div>
          <h1 className="ai-page-title">AI Assistant</h1>
          <p className="ai-page-lede">
            Chat with Pollinations; <strong>TradingView</strong> for browsing. <strong>AI levels</strong> draws only <strong>Entry / SL / TP</strong> from the last reply (same OHLC as chart context). Set <strong>pair</strong> and <strong>timeframe</strong> above the chart for both panes.
          </p>
        </div>
        <div className="ai-page-head-actions">
          <select
            className="select-field ai-page-session-select"
            value={activeSessionId || ''}
            onChange={(e) => setActiveSessionId(e.target.value)}
            disabled={!sessions.length}
            title="Switch chat"
          >
            {sessions.length === 0 ? <option value="">No chats yet</option> : null}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.title || 'Untitled'}</option>
            ))}
          </select>
          <button type="button" className="btn btn-outline" onClick={onNewChat} title="Start a new chat">New chat</button>
          <button type="button" className="btn btn-outline" onClick={onRenameChat} disabled={!activeSession} title="Rename chat">Rename</button>
          <button type="button" className="btn btn-outline ai-page-delete-btn" onClick={onDeleteChat} disabled={!activeSession} title="Delete chat">Delete</button>
        </div>
      </div>

      <div className="ai-page-tabs" role="tablist" aria-label="AI sections">
        <button type="button" role="tab" aria-selected={pageTab === 'chat'} className={`ai-page-chart-tab ${pageTab === 'chat' ? 'is-active' : ''}`} onClick={() => setPageTab('chat')}>Chat</button>
        <button type="button" role="tab" aria-selected={pageTab === 'agents'} className={`ai-page-chart-tab ${pageTab === 'agents' ? 'is-active' : ''}`} onClick={() => setPageTab('agents')}>Agents</button>
      </div>

      {pageTab === 'agents' ? (
        <AiAgentsPanel />
      ) : (
      <div className="ai-page-body">
        <section className="ai-page-chart-col">
          <div className="ai-page-chart-meta-row">
            <label className="ai-page-symbol-field">
              <span className="ai-page-chart-tf-label">Pair</span>
              <input
                className="filter-input ai-page-symbol-input"
                data-testid="ai-page-symbol-input"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9.:\-]/g, ''))}
                placeholder="e.g. EURUSD"
                spellCheck={false}
                autoCapitalize="characters"
                title="Edit the symbol or change it in TradingView — Quick analysis and chart context follow this pair"
              />
            </label>
            <label className="ai-page-chart-tf-field">
              <span className="ai-page-chart-tf-label">Timeframe</span>
              <select
                className="select-field ai-page-chart-tf-select"
                value={tfId}
                onChange={(e) => setTfId(e.target.value)}
                title="OHLC bars and AI levels chart use this timeframe; TradingView updates too"
              >
                {TF_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="ai-page-chart-tf-field">
              <span className="ai-page-chart-tf-label">Range</span>
              <select
                className="select-field ai-page-chart-tf-select"
                value={rangeId}
                onChange={(e) => setRangeId(e.target.value)}
                title="How many OHLC bars to load for AI levels chart"
              >
                {RANGE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="ai-page-chart-tabstrip" role="tablist" aria-label="Chart view">
            <button
              type="button"
              role="tab"
              aria-selected={chartTab === 'tv'}
              className={`ai-page-chart-tab ${chartTab === 'tv' ? 'is-active' : ''}`}
              onClick={() => setChartTab('tv')}
            >
              TradingView
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartTab === 'levels'}
              className={`ai-page-chart-tab ${chartTab === 'levels' ? 'is-active' : ''}`}
              onClick={() => setChartTab('levels')}
              title="Entry, SL, TP only — parsed from the latest AI reply"
            >
              AI levels
              {extractedLevels.length > 0 ? (
                <span className="ai-page-chart-tab-badge">{extractedLevels.length}</span>
              ) : null}
            </button>
          </div>
          {chartTab === 'levels' && lastAssistantText && extractedLevels.length === 0 ? (
            <div className="ai-page-levels-hint">
              No Entry / SL / TP prices found in the last AI reply. Ask for explicit levels (e.g. &quot;Entry 1.1775, SL 1.1760, TP 1.1805&quot;).
            </div>
          ) : null}
          <div className="ai-page-chart-frame">
            {chartTab === 'tv' ? (
              tvSymbol ? (
                <TradingViewChart
                  symbol={tvSymbol}
                  interval={tf.tvInterval}
                  studies={['Volume@tv-basicstudies']}
                  className="ai-page-chart-inner"
                  onSymbolChange={onTradingViewSymbolChange}
                />
              ) : (
                <div className="ai-page-chart-empty">Enter a symbol to load the chart.</div>
              )
            ) : bars.length >= 2 ? (
              <div className="ai-page-levels-stack">
                <div className="ai-page-levels-head">
                  <span className="ai-page-levels-tf-badge">{tf.id}</span>
                  <span className="ai-page-levels-caption">Last AI plan · {marketSymbol}</span>
                </div>
                <AiLevelsChart bars={bars} levels={extractedLevels} className="ai-page-chart-inner" />
              </div>
            ) : (
              <div className="ai-page-chart-empty">
                Need OHLC bars for this symbol — open this page while the app can load market history, or check your data connection.
              </div>
            )}
          </div>
        </section>

        <section className="ai-page-chat-col">
          <div className="ai-page-chat-head">
            <div className="ai-page-chat-title">
              {activeSession?.title || 'Chat'}
              {activeSession?.updatedAt ? <span className="ai-page-chat-time"> · {fmtTime(activeSession.updatedAt)}</span> : null}
            </div>
            <div className="ai-page-chat-sub">{messages.length} message{messages.length === 1 ? '' : 's'}</div>
          </div>

          <div className="ai-page-chat-scroll" ref={messagesScrollRef}>
            {messages.length === 0 ? (
              <div className="ai-page-chat-empty">
                <div className="ai-page-chat-empty-title">Ready when you are.</div>
                <p>
                  Set the <strong>pair</strong> above (or change symbol in TradingView), then ask anything—or use <strong>Quick analysis</strong>. Open the <strong>AI levels</strong> tab to plot Entry / SL / TP from the last reply on OHLC data (not on the TradingView iframe).
                </p>
              </div>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={`ai-chat-bubble ai-chat-bubble--${m.role}`}>
                <div className="ai-chat-bubble-head">
                  <span className="ai-chat-bubble-role">{m.role === 'assistant' ? 'AI' : 'You'}</span>
                  {m.attachedSymbol ? <span className="ai-chat-bubble-tag">{m.attachedSymbol} {m.attachedTf || ''}</span> : null}
                  {m.model ? <span className="ai-chat-bubble-model">{m.model}</span> : null}
                  <span className="ai-chat-bubble-time">{fmtTime(m.createdAt)}</span>
                </div>
                <div className="ai-chat-bubble-body">{chatBubbleBodyText(m.content, m.role)}</div>
              </div>
            ))}
            {sending ? (
              <div className="ai-chat-bubble ai-chat-bubble--assistant ai-chat-bubble--pending">
                <div className="ai-chat-bubble-head"><span className="ai-chat-bubble-role">AI</span></div>
                <div className="ai-chat-bubble-body">Thinking…</div>
              </div>
            ) : null}
          </div>

          {chatError ? <div className="ai-page-banner ai-page-banner--error">{chatError}</div> : null}

          <div className="ai-page-composer">
            {modelOptions.length > 1 ? (
              <div className="ai-page-composer-row ai-page-model-row">
                <label className="ai-page-model-field">
                  <span className="ai-page-chart-tf-label">Model</span>
                  <select
                    className="select-field ai-page-model-select"
                    value={modelOptions.some((m) => m.id === chatModel) ? chatModel : modelOptions[0]?.id}
                    onChange={onChatModelChange}
                    disabled={sending}
                    title="Pollinations free text (anonymous tier)"
                  >
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="ai-page-composer-row ai-page-model-row ai-page-model-row--static">
                <span className="ai-page-chart-tf-label" title="Pollinations anonymous API exposes one free route">
                  Model: {modelOptions[0]?.label || 'OpenAI free (Pollinations)'}
                </span>
              </div>
            )}
            <div className="ai-page-composer-row">
              <label className="ai-page-attach-toggle" title="Send the current symbol, timeframe, and a compact OHLC summary with each message">
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                <span>Attach chart context</span>
                {attach && chartContextText ? (
                  <span className="ai-page-attach-preview" title={chartContextText}>
                    {marketSymbol} {tf.id} · {bars.length} bars
                  </span>
                ) : null}
              </label>
            </div>
            <div className="ai-page-template-run-row" role="group" aria-label="Quick analysis templates">
              <span className="ai-page-template-run-label">Quick analysis</span>
              <div className="ai-page-template-chips">
                {ANALYSIS_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn btn-outline ai-page-tpl-chip"
                    onClick={() => runFilledTemplate(p.template)}
                    disabled={sending || !marketSymbol}
                    title={p.description}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-outline ai-page-tpl-chip ai-page-tpl-chip--custom"
                  onClick={runCustomTemplate}
                  disabled={sending || !marketSymbol}
                  title="Runs the editable custom template below ([PAIR], [TF], [BARS] filled in)"
                >
                  Custom
                </button>
              </div>
            </div>
            <div className="ai-page-template-panel">
              <button
                type="button"
                className="ai-page-template-toggle"
                onClick={() => setAnalysisTemplateOpen((o) => !o)}
                aria-expanded={analysisTemplateOpen}
              >
                {analysisTemplateOpen ? '▼' : '▶'} Custom template (for Custom button)
              </button>
              {analysisTemplateOpen ? (
                <div className="ai-page-template-body">
                  <p className="ai-page-template-hint">
                    Saved locally. Placeholders <code>[PAIR]</code>, <code>[TF]</code>, <code>[BARS]</code> are filled when you click Custom. Preset buttons use fixed prompts. Drag the textarea corner to resize; height is remembered.
                  </p>
                  <textarea
                    ref={templateTextareaRef}
                    className="ai-page-template-input"
                    value={analysisTemplate}
                    onChange={(e) => persistAnalysisTemplate(e.target.value)}
                    spellCheck={false}
                    disabled={sending}
                    style={{ height: templateTextareaPx }}
                  />
                  <div className="ai-page-template-actions">
                    <button
                      type="button"
                      className="btn btn-outline ai-page-template-reset"
                      onClick={resetAnalysisTemplate}
                      disabled={sending}
                    >
                      Reset custom to Full MTF
                    </button>
                    <span className="ai-page-template-counter">
                      {analysisTemplate.length}/{MAX_ANALYSIS_TEMPLATE_CHARS}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <textarea
              ref={composerRef}
              className="ai-page-composer-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={3}
              placeholder="Ask anything. Enter sends, Shift+Enter for a new line."
              disabled={sending}
            />
            <div className="ai-page-composer-foot">
              <span className="ai-page-composer-hint">Free Pollinations (pick model above). Not financial advice.</span>
              <button
                type="button"
                className="btn btn-primary ai-page-send-btn"
                onClick={() => onSend()}
                disabled={sending || !draft.trim()}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </section>
      </div>
      )}
    </div>
  );
}
