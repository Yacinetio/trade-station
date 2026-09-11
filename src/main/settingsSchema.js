/**
 * Settings schema: factory defaults, load-time normalization, and the
 * EA management/risk control payload derived from settings.
 * Extracted from main.js — pure functions, no Electron/IPC dependencies.
 */
const instanceProfile = require('./instanceProfile');
const { defaultSignalBlockFilters } = require('./signalBlockFilters');
const { upgradeCorrelationGroups } = require('./correlationGroups');
const { normalizeCustomTradeColumns } = require('./customTradeFields');
const { normalizeTradeBuiltinColumns, serializeTradeBuiltinColumns } = require('./tradeColumnConfig');
const freeAiClient = require('./freeAiClient');

const APP_INSTANCE = instanceProfile.active;

function getDefaultSettings() {
  return {
    /**
     * 'guided' (default) ships with safe caps for first-time users: 1% risk sizing,
     * daily loss cap, concurrent-trade cap, spread cap, news guard ON.
     * 'pro' is an explicit opt-out chosen in Settings → Guard; it never changes
     * values by itself, it just records that the user accepted managing their own risk.
     */
    experienceMode: 'guided',
    tradeType: 'both',
    orderType: 'all',
    tpMode: 'separate',
    forceMarket: false,
    lotMode: 'percentage',
    lotPercentage: 1.0,
    fixedLot: 0.01,
    riskAmount: 100,
    riskPct: 1,
    maxLot: 20.0,
    tpLotMode: 'equal',
    /** Custom per-TP lot share percentages (used when tpLotMode = 'custom'; must match TP count, sum ≈ 100). */
    tpCustomShares: [],
    enableTimeFilter: false,
    timeFrom: '00:00',
    timeTo: '23:59',
    enableSessionFilter: false,
    sessions: { asian: true, london: true, newYork: true },
    enableDaysFilter: false,
    tradingDays: [1,2,3,4,5],
    maxDailyTrades: 10,
    minPips: 0,
    syncLookbackHours: 24,
    syncLookbackUnit: 'HOURS',
    syncLookbackAmount: 24,
    fundamentalsRefreshSeconds: 180,
    fundamentalsMaxEvents: 18,
    fundamentalsCalendarImpact: 'MEDIUM',
    fundamentalsIncludeCrypto: true,
    enableHighImpactNewsGuard: true,
    highImpactNewsBlockBeforeMinutes: 30,
    highImpactNewsBlockAfterMinutes: 15,
    highImpactNewsTradeContextAfterMinutes: 120,
    highImpactNewsAlertBefore: 45,
    highImpactNewsAlertUnit: 'MINUTES',
    highImpactNewsAlertBeforeMinutes: 45,
    highImpactNewsRepeatAlertsEnabled: false,
    highImpactNewsRepeatIntervalMinutes: 10,
    analyticsBreakEvenAmount: 50,
    enableAdvancedSignalBlockFilters: false,
    signalBlockFilters: defaultSignalBlockFilters(),
    mt5AckLogIntervalSec: 5,
    enableBreakEven: true,
    breakEvenUnit: 'rr',
    breakEvenTriggerPips: 1,
    breakEvenOffsetPips: 0,
    enableTrailingStop: false,
    trailingUnit: 'pips',
    trailingStartPips: 20,
    trailingDistancePips: 10,
    trailingStepPips: 2,
    enablePartialClose: false,
    partialCloseUnit: 'pips',
    partialCloseAtPips: 25,
    partialClosePercent: 50,
    /** Flatten EA-managed positions at this time daily (MT5 trade server time). */
    enableEndOfDayClose: false,
    endOfDayCloseTime: '21:55',
    /** After local wall-clock hits end-of-day time + delay: auto-send Telegram daily report. */
    dailyReportAutoAfterEod: true,
    dailyReportAfterEodMinutes: 5,
    /** Sunday local (same EOD clock + delay): weekly rollup */
    weeklyReportAutoEndOfWeek: true,
    /** Last calendar day of month (same EOD clock + delay): monthly rollup */
    monthlyReportAutoEndOfMonth: true,
    /** When AI signal-check is on, append post-close insight to trade Notes (TP/SL/etc.). */
    autoAiCloseInsight: true,
    customKeywords: { buy: ['BUY', 'LONG', 'BULL'], sell: ['SELL', 'SHORT', 'BEAR'] },
    notifications: {
      newSignal: true,
      tradeClosed: true,
      mtDisconnect: true,
      highImpactNews: true,
      signalBlockedByNews: true,
      signalBlockedBySchedule: true,
      signalBlockedByGuard: true,
      signalBlockedBySignalFilters: true
    },
    // Safe first-run caps (guided mode). Existing installs keep their saved values.
    enableTradeLimit: true,
    maxConcurrentTrades: 3,
    enableDailyLoss: true,
    maxDailyLoss: 0,
    maxDailyLossPct: 5,
    enableBlockOppositeSameSymbol: false,
    enableBlockCorrelatedOpposite: false,
    /** When true (default), block send/resend if SL is missing or on wrong side of entry for BUY/SELL. */
    blockInvalidOrMissingStopLoss: true,
    correlationGroups: [
      ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'],
      ['EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY'],
      ['US100', 'US30', 'US500'],
      ['XAUUSD', 'XAGUSD']
    ],
    useDefaultSlTp: true,
    defaultSl: 50,
    defaultTp: 100,
    useRR: false,
    rrRatio: 2,
    /** R:R TP anchor: auto | execution | signal (auto → signal when lot≠signal or ENTRY avg/blend). */
    rrEntryAnchor: 'auto',
    /** When false (or lot mode = signal), ENTRY/AVG/blend is skipped — Telegram ENTRY only. */
    executionEntryAdjust: true,
    /** Entry price used for execution when signal lists ENTRY + AVG ENTRY: signal | avg | blend */
    executionEntryMode: 'signal',
    /** For blend: 0 = signal ENTRY only, 100 = AVG ENTRY only */
    executionEntryBlendPct: 50,
    /** When true, EA uses AUTO (limit/stop at entry) if live price ≠ entry; off if force market. */
    pendingAtEntry: true,
    /** Shift EXEC entry by spread (BUY − spread, SELL + spread). */
    enableSpreadEntryAdjust: true,
    /** When true, every symbol uses live MT5 spread; when false, only spreadEntryRules list. */
    spreadEntryAllPairs: false,
    /** Per-symbol spread offset rules: { symbol, spreadPips? } — spreadPips = offline fallback only */
    spreadEntryRules: [],
    marketData: {
      enableTwelveData: true,
      enableAlphaVantage: true,
      twelveDataKey: '',
      alphaVantageKey: '',
      fallbackMt5: true,
      cacheTtlMinutes: 1440
    },
    /** Absolute Windows path shared with MT4 EA FILE transport (MQL4 Files subfolder). Empty = disabled. */
    mt4FileBridgeDir: '',
    /**
     * MT4/MT5 HTML reports use broker wall time with no TZ. Default (null) = interpret as this PC local (legacy).
     * If imports are ~1–3h off vs MT5, set broker offset **east of UTC** in minutes (e.g. 120 EET, 180 MSK).
     */
    mtHtmlReportBrokerOffsetMinutes: null,
    /** Reusable labels for journal tags + Setup slice filter (Settings → Trading). */
    tradePresets: [],
    /** User-defined table columns parsed from Telegram lines (Settings → Columns). */
    customTradeColumns: [],
    /** Per-column overrides for built-in trade table columns (enable, label, width). */
    tradeBuiltinColumns: [],
    /** Has completed onboarding wizard */
    onboardingCompleted: false,
    /** Stealth execution: jitter delay + tiny lot rounding to avoid copy-trade detection. */
    stealthMode: false,
    stealthMinDelayMs: 200,
    stealthMaxDelayMs: 2500,
    stealthLotJitterPct: 0,
    /** Drawdown guardian: halts execution when daily loss / peak DD limits are hit. */
    enableDrawdownGuard: false,
    maxPeakDrawdownPct: 0,
    maxAbsoluteDailyLoss: 0,
    /** Tiered drawdown: reduce lots at yellow/orange, halt at red. */
    enableTieredDrawdown: false,
    ddTierYellowPct: 2,
    ddTierOrangePct: 3,
    ddTierRedPct: 5,
    ddTierYellowLotFactor: 0.5,
    ddTierOrangeLotFactor: 0.25,
    /** Daily loss basis for execution guard + drawdown guardian: realized | equity. */
    dailyLossBasis: 'realized',
    /** Full pipeline, no MT5 dispatch — trades get status SIMULATED. */
    dryRunMode: false,
    /** Block when fundamentals checklist verdict is NO-GO. */
    enableFundamentalsGate: false,
    /** Spread cap (pips). 0 = no cap. Guided default: 3 pips. */
    maxSpreadPips: 3,
    /** Guard fail mode: 'open' = allow on guard timeout/error (default), 'closed' = block. */
    guardFailMode: 'open',
    /** TCP bridge bind host (loopback by default — only change to expose on LAN deliberately). */
    tcpBindHost: '127.0.0.1',
    /**
     * Optional shared secret for the EA TCP handshake. When set, the EA must send it in
     * HELLO (`SharedSecret` EA input) or the connection is rejected. Empty = no auth
     * (backward compatible with older EA builds).
     */
    eaSharedSecret: '',
    /** EA TCP port (Trade Station listens; EA connects as client). Named instances seed a unique default. */
    serverPort: APP_INSTANCE.defaultTcpPort || 9999,
    /** Set when launched with --instance=<id> */
    instanceId: APP_INSTANCE.id || '',
    instanceLabel: APP_INSTANCE.label || '',
    /** Offline-queue TTL (ms): queued signals older than this are dropped instead of executing stale. */
    queueTtlMs: 120000,
    /** Telegram keywords that close this channel's open trades (e.g. "close", "close all"). */
    closeKeywords: [],
    /** Telegram keywords that partially close this channel's open trades (e.g. "close half", "partials"). */
    partialCloseKeywords: [],
    /** Percent used for partial-close keywords when the message doesn't specify one ("30%"). */
    partialClosePercentDefault: 50,
    /** Telegram keywords that move SL to entry on this channel's open trades (e.g. "breakeven", "sl to entry"). */
    breakEvenKeywords: [],
    /** Pending order expiry (EA ORDER_TIME_SPECIFIED). pendingExpiry is in hours. */
    enablePendingExpiry: false,
    pendingExpiry: 24,
    /** Per-channel strategy overrides keyed by channel name / id. */
    channelStrategies: {},
    /** Per-symbol lot/risk overrides. */
    perPairOverrides: {},
    /** AI image-signal parsing via OpenAI Vision (advanced; off by default — keeps API-key flow optional). */
    aiVisionEnabled: false,
    aiOpenAIApiKey: '',
    aiVisionModel: 'gpt-4o-mini',
    /** AI signal-check (free, no API key — uses Pollinations.ai). */
    aiCheck: {
      enabled: false,
      minConfidence: 70,
      onLowConfidence: 'block',
      reduceFactor: 0.5,
      model: 'openai',
      /** Pollinations API key (pk_ or sk_) from enter.pollinations.ai — required since anonymous tier is rate-limited */
      pollinationsApiKey: '',
      timeoutMs: 18000,
      extraInstructions: '',
      /** When false, trades are never saved with an `aiCheck` field (dashboard verdict feed still updates). Default true. */
      persistAnalysisOnTrade: true,
      /** When false, AI prompts skip OHLC fetches (MT5 / market data). Default true. */
      useChartContext: true
    },
    // ─── TradeZella-parity feature defaults — agents: replace ONLY your own anchor
    // line with your defaults (each property line ends with a comma). ───
    excursion: { sampleSeconds: 30 },
    tagCategories: { mistakes: ['fomo', 'revenge', 'oversized', 'no-sl', 'early-exit', 'chased-entry'], emotions: [] },
    reports: { defaultDimension: 'day-of-week' },
    notebook: { defaultFolder: 'Journal' },
    replay: { preEntryBars: 60, postExitBars: 20 },
    aiAgents: { briefingEnabled: false, briefingTime: '07:30', sessionReviewEnabled: false, reviewTime: '22:30', autoTagEnabled: true, overtradingThreshold: 6 },
    propFirm: { defaultRiskScale: 1 },
    backtest: { defaultSpreadPips: 1, defaultBalance: 100000 },
    __zellaParity: true
  };
}

function normalizeLotMode(raw) {
  const u = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (u === 'from_signal' || u === 'use_signal' || u === 'parsed' || u === 'telegram') return 'signal';
  if (u === 'percentage' || u === 'fixed' || u === 'risk' || u === 'riskpct' || u === 'signal') return u;
  return 'percentage';
}

function normalizeManagementUnit(value, fallback = 'pips') {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === 'percent' || normalized === 'money') return normalized;
  if (normalized === 'rr' || normalized === 'r' || normalized === '1r' || normalized === '1rr' ||
      normalized === 'risk' || normalized === 'risk_r') return 'rr';
  return 'pips';
}

/** HH:MM for EA end-of-day close (MetaTrader trade server time). */
function normalizeEndOfDayCloseTime(raw) {
  const s = String(raw ?? '21:55').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return '21:55';
  let h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  let min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  if (!Number.isFinite(h)) h = 21;
  if (!Number.isFinite(min)) min = 55;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeSettingsSymbolMappings(settings) {
  const defaults = getDefaultSettings();
  const merged = { ...defaults, ...(settings || {}) };
  merged.lotMode = normalizeLotMode(merged.lotMode);
  merged.notifications = { ...(defaults.notifications || {}), ...((settings || {}).notifications || {}) };
  merged.sessions = { ...(defaults.sessions || {}), ...((settings || {}).sessions || {}) };
  merged.customKeywords = {
    ...(defaults.customKeywords || {}),
    ...((settings || {}).customKeywords || {})
  };
  merged.correlationGroups = upgradeCorrelationGroups(settings?.correlationGroups);
  merged.marketData = {
    ...(defaults.marketData || {}),
    ...((settings || {}).marketData || {})
  };
  merged.highImpactNewsAlertUnit = String(merged.highImpactNewsAlertUnit || 'MINUTES').toUpperCase() === 'HOURS' ? 'HOURS' : 'MINUTES';
  if (!Number.isFinite(Number(merged.highImpactNewsAlertBefore))) {
    const fallbackFromMinutes = Number(merged.highImpactNewsAlertBeforeMinutes);
    merged.highImpactNewsAlertBefore = Number.isFinite(fallbackFromMinutes) ? fallbackFromMinutes : 45;
  }
  merged.highImpactNewsRepeatAlertsEnabled = merged.highImpactNewsRepeatAlertsEnabled === true;
  const repeatRaw = Number(merged.highImpactNewsRepeatIntervalMinutes);
  merged.highImpactNewsRepeatIntervalMinutes = Number.isFinite(repeatRaw) ? Math.max(1, Math.round(repeatRaw)) : 10;
  const htmlOff = merged.mtHtmlReportBrokerOffsetMinutes;
  if (htmlOff === null || htmlOff === undefined || htmlOff === '') {
    merged.mtHtmlReportBrokerOffsetMinutes = null;
  } else {
    const ho = Number(htmlOff);
    merged.mtHtmlReportBrokerOffsetMinutes = Number.isFinite(ho) ? Math.round(ho) : null;
  }
  const presetSrc = settings?.tradePresets;
  merged.tradePresets = Array.isArray(presetSrc)
    ? [...new Set(presetSrc.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 200)
    : (Array.isArray(defaults.tradePresets) ? defaults.tradePresets : []);
  merged.customTradeColumns = normalizeCustomTradeColumns(
    Array.isArray(settings?.customTradeColumns) ? settings.customTradeColumns : defaults.customTradeColumns
  );
  merged.tradeBuiltinColumns = serializeTradeBuiltinColumns(
    normalizeTradeBuiltinColumns(
      Array.isArray(settings?.tradeBuiltinColumns) ? settings.tradeBuiltinColumns : defaults.tradeBuiltinColumns
    )
  );
  merged.enableEndOfDayClose = merged.enableEndOfDayClose === true;
  merged.endOfDayCloseTime = normalizeEndOfDayCloseTime(merged.endOfDayCloseTime);
  merged.dailyReportAutoAfterEod = merged.dailyReportAutoAfterEod === true;
  merged.weeklyReportAutoEndOfWeek = merged.weeklyReportAutoEndOfWeek === true;
  merged.monthlyReportAutoEndOfMonth = merged.monthlyReportAutoEndOfMonth === true;
  merged.autoAiCloseInsight = merged.autoAiCloseInsight !== false;
  const drm = Number(merged.dailyReportAfterEodMinutes);
  merged.dailyReportAfterEodMinutes = Number.isFinite(drm) ? Math.min(120, Math.max(1, Math.round(drm))) : 5;
  merged.aiCheck = {
    ...(defaults.aiCheck || {}),
    ...(typeof merged.aiCheck === 'object' && merged.aiCheck ? merged.aiCheck : {})
  };
  merged.aiCheck.model = freeAiClient.normalizePollinationsModel(merged.aiCheck.model);
  merged.aiCheck.pollinationsApiKey = String(merged.aiCheck.pollinationsApiKey || '').trim();
  const sbDef = defaultSignalBlockFilters();
  const sbIn = settings?.signalBlockFilters;
  const sb = typeof sbIn === 'object' && sbIn ? sbIn : {};
  merged.enableAdvancedSignalBlockFilters = merged.enableAdvancedSignalBlockFilters === true;
  merged.signalBlockFilters = {
    ...sbDef,
    ...sb,
    symbolContains: String(sb.symbolContains ?? sbDef.symbolContains).trim(),
    types: Array.isArray(sb.types) ? sb.types : sbDef.types,
    channels: Array.isArray(sb.channels) ? sb.channels : sbDef.channels,
    timeframes: Array.isArray(sb.timeframes) ? sb.timeframes : sbDef.timeframes,
    symbols: Array.isArray(sb.symbols) ? sb.symbols : sbDef.symbols,
    biasTerms: Array.isArray(sb.biasTerms) ? sb.biasTerms : sbDef.biasTerms,
    setupTerms: Array.isArray(sb.setupTerms) ? sb.setupTerms : sbDef.setupTerms,
    vwapBands: Array.isArray(sb.vwapBands) ? sb.vwapBands : sbDef.vwapBands,
    hvnBands: Array.isArray(sb.hvnBands) ? sb.hvnBands : sbDef.hvnBands,
    sessionNames: Array.isArray(sb.sessionNames) ? sb.sessionNames : sbDef.sessionNames,
    weekdayIndices: Array.isArray(sb.weekdayIndices) ? sb.weekdayIndices : sbDef.weekdayIndices
  };
  if (!Array.isArray(merged.symbolMappings)) return merged;
  return {
    ...merged,
    symbolMappings: merged.symbolMappings
      .map((m) => {
        const from = String(m?.from || '').trim().toUpperCase();
        const to = String(m?.to || '').trim().replace(/\.CASH$/i, '.cash');
        return { from, to };
      })
      .filter(m => m.from && m.to)
  };
}

function buildManagementControlPayload(settings = {}) {
  return {
    enableBreakEven: !!settings.enableBreakEven,
    breakEvenUnit: normalizeManagementUnit(settings.breakEvenUnit, 'pips'),
    breakEvenTrigger: Number(settings.breakEvenTriggerPips || 0),
    breakEvenOffset: Number(settings.breakEvenOffsetPips || 0),
    enableTrailingStop: !!settings.enableTrailingStop,
    trailingUnit: normalizeManagementUnit(settings.trailingUnit, 'pips'),
    trailingStart: Number(settings.trailingStartPips || 0),
    trailingDistance: Number(settings.trailingDistancePips || 0),
    trailingStep: Number(settings.trailingStepPips || 0),
    enablePartialClose: !!settings.enablePartialClose,
    partialCloseUnit: normalizeManagementUnit(settings.partialCloseUnit, 'pips'),
    partialCloseTrigger: Number(settings.partialCloseAtPips || 0),
    partialClosePercent: Number(settings.partialClosePercent || 0),
    enableEndOfDayClose: !!settings.enableEndOfDayClose,
    endOfDayCloseTime: normalizeEndOfDayCloseTime(settings.endOfDayCloseTime),
    // EA-side risk safety net: mirrors the app's pre-trade guards inside the EA
    // so caps survive an app crash/disconnect (EA v1.3+ honors these fields).
    riskGuardEnabled: !!(
      settings.enableTradeLimit
      || settings.enableDailyLoss
      || settings.blockInvalidOrMissingStopLoss
      || Number(settings.maxSpreadPips) > 0
    ),
    riskMaxConcurrent: settings.enableTradeLimit ? Math.max(0, Number(settings.maxConcurrentTrades) || 0) : 0,
    riskMaxDailyLossMoney: settings.enableDailyLoss ? Math.max(0, Number(settings.maxDailyLoss) || 0) : 0,
    riskMaxDailyLossPct: settings.enableDailyLoss ? Math.max(0, Number(settings.maxDailyLossPct) || 0) : 0,
    riskMaxSpreadPips: Math.max(0, Number(settings.maxSpreadPips) || 0),
    riskRequireStopLoss: settings.blockInvalidOrMissingStopLoss !== false
  };
}

module.exports = {
  getDefaultSettings,
  normalizeLotMode,
  normalizeManagementUnit,
  normalizeEndOfDayCloseTime,
  normalizeSettingsSymbolMappings,
  buildManagementControlPayload
};
