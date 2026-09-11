const { app, BrowserWindow, ipcMain, Notification, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const instanceProfile = require('./instanceProfile');
/** Playwright/E2E: isolated profile under tmp + license bypass matching flag (see licenseManager). */
const TRADE_STATION_E2E = process.argv.includes('--trade-station-e2e');
if (TRADE_STATION_E2E) {
  try {
    app.setPath('userData', path.join(os.tmpdir(), 'trade-station-e2e'));
  } catch (_) {
    /* noop */
  }
} else if (instanceProfile.active.isNamedInstance) {
  try {
    app.setPath('userData', instanceProfile.active.userDataRoot);
  } catch (_) {
    /* noop */
  }
}
const telegramClient = require('./telegramClient');
const tcpBridge = require('./tcpBridge');
const bridgeRouter = require('./bridgeRouter');
const cloudBridge = bridgeRouter.cloud;
const mt4FileBridge = require('./mt4FileBridge');
const store = require('./store');
const {
  getLicenseStatus,
  activateLicense,
  resetExpiryWarnings,
} = require('./licenseManager');
const { migrateStoreData, normalizeTradeForStorage, computeAnalytics } = require('./analyticsService');
const { normalizeTradeCustomFields } = require('./customTradeFields');
const { searchBestFilterCombinations } = require('./filterOptimizer');
const { analyzeWorstTrades } = require('./worstTradesAnalyzer');
const { tradeMatchesTimeScope } = require('./timeScope');
const { getFundamentalsDashboard, getNewsGuardStatus, resolveScreenerBiasForSymbol } = require('./fundamentalsService');
const { analyzeHeadlineWithContext } = require('./fundamentalsHeadlineAi');
const { summarizeFundamentalsDigest } = require('./fundamentalsDigestAi');
const { evaluateSignalSchedule } = require('./signalFilters');
const { evaluateAdvancedSignalBlock } = require('./signalBlockFilters');
const { evaluateExecutionGuards } = require('./executionGuards');
const {
  applySignalExecutionTransforms,
  attachRrSnapForMt5,
  priceDistancePips,
  resolveOrderTypeForSignal
} = require('./signalExecutionApply');
const { applyLotSizingToSignal, executionEntryForLotSizing, computeTradeRiskUsd, computePlannedRR } = require('./lotSizing');
const manualTradeService = require('./manualTradeService');
const { getMarketBars } = require('./marketHistoryService');
const { createTradeStore } = require('./tradeStore');
const { trimTradesList } = require('./tradeListTrim');
const mtStatementImport = require('./mtStatementImport');
const { buildSyntheticE2eTrades } = require('./e2eSyntheticTrades');
const secretsVault = require('./secretsVault');
const { exportDataRootToZip, importDataZipToRoot, listAccountFolderKeys, sanitizeAccountKey } = require('./dataBackupService');
const channelOverrides = require('./channelOverrides');
const signalPipeline = require('./signalPipeline');
const tradeExport = require('./tradeExport');
const stealthDelay = require('./stealthDelay');
const drawdownGuardian = require('./drawdownGuardian');
const { applyPerPairOverrides } = require('./perPairLot');
const { attachLiveSpreadForEntryAdjust } = require('./spreadQuoteService');
const signalAiVision = require('./signalAiVision');
const { computeChannelScoreboard } = require('./channelScoreboard');
const signalBacktester = require('./signalBacktester');
const signalConfidence = require('./signalConfidence');
const aiSignalCheck = require('./aiSignalCheck');
const aiUsage = require('./aiUsage');
const {
  tradesClosedBetween,
  buildPerformanceReportLines,
} = require('./performanceReport');
const { debugParseTelegramMessage } = require('./signalParserDebug');
const {
  getDefaultSettings,
  normalizeSettingsSymbolMappings,
  normalizeEndOfDayCloseTime,
  buildManagementControlPayload
} = require('./settingsSchema');
const { generateWeeklyPackFiles: generateWeeklyPackFilesCore } = require('./reportPackExport');
const {
  symbolsLikelySame,
  pickBestAckCandidate: pickBestAckCandidateCore
} = require('./ackTradeMatch');
const {
  buildTradePatch,
  inheritMissingTradeMetadata,
  isOpenTradeStatus,
  resolveModifyTicket,
  applyAckExecToTrade,
  findTradeIndexForUpdate,
  buildRestoredTradeFromHint,
  findSyncMergeTarget,
  findMetadataDonorForSync
} = require('./tradeUpdate');
const { runDataIntegrityAudit } = require('./dataIntegrityAuditor');
const { runMonteCarloSimulation, buildUnderwaterSeries } = require('./monteCarlo');
const aiChat = require('./aiChat');
const freeAiClient = require('./freeAiClient');
const { formatAssistantReply } = require('./aiReplyFormat');
const fileLogger = require('./fileLogger');
fileLogger.init(store.dataRoot);
aiSignalCheck.setStore(store);
aiSignalCheck.setMarketCtxProvider(() => ({
  settings: normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings())),
  dataRoot: store.dataRoot,
  tcpConnected: !!bridgeRouter.getStatus()?.connected,
  requestMt5History: (p) => bridgeRouter.requestMt5History(p)
}));
const APP_INSTANCE = instanceProfile.active;
/** Default profile stays single-instance; named instances (--instance=demo) can run in parallel. */
const singleInstanceLock = APP_INSTANCE.isNamedInstance ? true : app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

function getAppWindowTitle() {
  if (!APP_INSTANCE.isNamedInstance) return 'Trade Station';
  return `Trade Station — ${APP_INSTANCE.label || APP_INSTANCE.id}`;
}

function resolveTcpListenPort(settings = {}) {
  const fromSettings = Number(settings?.serverPort);
  if (Number.isInteger(fromSettings) && fromSettings >= 1 && fromSettings <= 65535) return fromSettings;
  return APP_INSTANCE.defaultTcpPort || 9999;
}

function seedNamedInstanceDefaults() {
  if (!APP_INSTANCE.isNamedInstance) return;
  const existing = store.get('settings');
  if (existing && typeof existing === 'object') return;
  const seeded = normalizeSettingsSymbolMappings({
    ...getDefaultSettings(),
    serverPort: APP_INSTANCE.defaultTcpPort,
    instanceId: APP_INSTANCE.id,
    instanceLabel: APP_INSTANCE.label,
  });
  store.set('settings', seeded);
  store.set('instanceMeta', {
    id: APP_INSTANCE.id,
    label: APP_INSTANCE.label,
    defaultTcpPort: APP_INSTANCE.defaultTcpPort,
    createdAt: new Date().toISOString(),
  });
}

let mainWindow;
let miniOverlayWindow = null;
/** Set in startListening(). */
let handleTelegramIncomingMessage = null;
/**
 * In-flight signal de-dupe: `channel::messageId` → timestamp. Closes the async
 * race where the same Telegram message is delivered/handled twice before the
 * first run has written its PENDING trade row (which isDuplicateTelegramSignal
 * relies on). Without it, two concurrent runs both pass the early dedup check
 * and open two MT5 positions for one signal.
 */
const inFlightSignalKeys = new Map();
const IN_FLIGHT_SIGNAL_TTL_MS = 30000;
let mt5AccountSnapshot = null;
let currentMt5Account = null;
let servicesStarted = false;
let tcpBridgeStarted = false;
let licenseState = getLicenseStatus(store);
const mt5AckLogThrottleMap = new Map();
const desktopNotificationThrottleMap = new Map();
const newsAlertSentMap = new Map();
const newsReleaseSentMap = new Map();
let lastAutoSyncRequestAt = 0;
let newsGuardTimer = null;
let licenseWatchTimer = null;
let shutdownForLicenseExpiryInProgress = false;
let dailyReportEodTimer = null;
let dispatchWatchTimer = null;
let weeklyReportTimer = null;
let monthlyReportTimer = null;
let licenseStatusBroadcastSnap = '';
const LICENSE_EXPIRY_WARN_72_MS = 72 * 60 * 60 * 1000;
const LICENSE_EXPIRY_WARN_24_MS = 24 * 60 * 60 * 1000;
const tradeStore = createTradeStore({
  dataRoot: store?.dataRoot,
  legacyStore: store,
  normalizeTradeForStorage
});

const CURRENCY_IMPACT_PAIRS = {
  USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'US30', 'NAS100'],
  EUR: ['EURUSD', 'EURJPY', 'EURGBP', 'EURCHF', 'EURAUD', 'EURCAD'],
  GBP: ['GBPUSD', 'GBPJPY', 'EURGBP', 'GBPAUD', 'GBPCAD'],
  JPY: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY'],
  CHF: ['USDCHF', 'EURCHF', 'GBPCHF', 'CHFJPY'],
  CAD: ['USDCAD', 'EURCAD', 'GBPCAD', 'CADJPY'],
  AUD: ['AUDUSD', 'AUDJPY', 'EURAUD', 'GBPAUD', 'AUDCAD'],
  NZD: ['NZDUSD', 'NZDJPY', 'EURNZD', 'GBPNZD', 'AUDNZD']
};

// ─── Log Buffer ──────────────────────────────────────────────────────────────
const MAX_LOGS = 500;
let logBuffer = [];
const MAX_NOTIFICATIONS_HISTORY = 500;

function getNotificationHistory() {
  const raw = store.get('notificationHistory', []);
  return Array.isArray(raw) ? raw : [];
}

function saveNotificationHistory(history = []) {
  const normalized = Array.isArray(history) ? history.slice(0, MAX_NOTIFICATIONS_HISTORY) : [];
  store.set('notificationHistory', normalized);
  return normalized;
}

function classifyNotificationKey(key = '') {
  const k = String(key || '').toLowerCase();
  if (k.startsWith('high-news-release:')) return 'NEWS_RELEASE';
  if (k.startsWith('high-news:')) return 'NEWS_ALERT';
  if (k.startsWith('blocked-news:')) return 'NEWS_BLOCKED';
  if (k.startsWith('signal:')) return 'SIGNAL';
  return 'GENERAL';
}

function recordNotificationHistory({ title = '', body = '', key = '' } = {}) {
  const list = getNotificationHistory();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    time: new Date().toISOString(),
    title: String(title || ''),
    body: String(body || ''),
    key: String(key || ''),
    type: classifyNotificationKey(key),
    read: false
  };
  list.unshift(entry);
  const trimmed = list.slice(0, MAX_NOTIFICATIONS_HISTORY);
  saveNotificationHistory(trimmed);
  if (mainWindow) mainWindow.webContents.send('notifications:new', entry);
}

function addLog(level, message, detail = '') {
  const entry = {
    id: Date.now() + Math.random(),
    time: new Date().toISOString(),
    level, // 'info' | 'success' | 'warn' | 'error'
    message,
    detail
  };
  logBuffer.unshift(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.pop();
  fileLogger.writeEntry(entry);
  if (mainWindow) mainWindow.webContents.send('log:new', entry);
}

function sendDesktopNotification(title, body, key = '', throttleMs = 20000) {
  const throttleKey = String(key || `${title}:${body}`);
  const lastAt = desktopNotificationThrottleMap.get(throttleKey) || 0;
  if ((Date.now() - lastAt) < throttleMs) return;
  desktopNotificationThrottleMap.set(throttleKey, Date.now());
  recordNotificationHistory({ title, body, key: throttleKey });
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: String(title || 'Trade Station'),
      body: String(body || ''),
      silent: false,
      urgency: 'normal',
      appID: 'TradeStation'
    });
    n.show();
  } catch {
    // Best-effort only.
  }
}

function formatMinutesForNotification(rawMinutes) {
  const minutes = Math.max(0, Math.round(Number(rawMinutes) || 0));
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getImpactedPairsText(currency = '') {
  const ccy = String(currency || '').toUpperCase();
  const pairs = CURRENCY_IMPACT_PAIRS[ccy] || [];
  if (pairs.length === 0) return '';
  return `Likely impact: ${pairs.slice(0, 5).join(', ')}${pairs.length > 5 ? '…' : ''}`;
}

function buildStableNewsEventId(evt = {}) {
  const country = String(evt?.country || '').trim().toUpperCase();
  const title = String(evt?.title || '').trim().toLowerCase();
  const rawTime = evt?.time;
  const d = rawTime ? new Date(rawTime) : null;
  const timeIsoMinute = (d && Number.isFinite(d.getTime()))
    ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    : String(rawTime || '').trim();
  return `${country}|${title}|${timeIsoMinute}`.toLowerCase();
}

function startNewsGuardMonitor() {
  if (newsGuardTimer) return;
  newsGuardTimer = setInterval(async () => {
    try {
      const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
      const notifications = settings?.notifications || {};
      if (settings.enableHighImpactNewsGuard === false || notifications.highImpactNews === false) return;
      const alertRaw = Number(settings.highImpactNewsAlertBefore ?? settings.highImpactNewsAlertBeforeMinutes ?? settings.highImpactNewsBlockBeforeMinutes ?? 30);
      const alertUnit = String(settings.highImpactNewsAlertUnit || 'MINUTES').toUpperCase();
      const alertBefore = Math.max(5, alertUnit === 'HOURS' ? alertRaw * 60 : alertRaw);
      const repeatEnabled = settings.highImpactNewsRepeatAlertsEnabled === true;
      const repeatIntervalMinutes = Math.max(1, Number(settings.highImpactNewsRepeatIntervalMinutes || 10));
      const dashboard = await getFundamentalsDashboard(settings, { forceRefresh: true });
      const allEvents = Array.isArray(dashboard?.calendar?.allEvents) ? dashboard.calendar.allEvents : [];
      const highEvents = allEvents.filter((evt) => Number(evt?.impact || 0) >= 3);
      const seenEventIds = new Set();

      for (const evt of highEvents) {
        const eventId = buildStableNewsEventId(evt);
        if (!eventId || seenEventIds.has(eventId)) continue;
        seenEventIds.add(eventId);
        const minutes = Number(evt?.minutesToEvent);
        if (!Number.isFinite(minutes)) continue;

        // 1) Pre-news warning
        if (minutes >= 0 && minutes <= alertBefore) {
          const lastSentAt = Number(newsAlertSentMap.get(eventId) || 0);
          const canRepeat = repeatEnabled && (Date.now() - lastSentAt) >= (repeatIntervalMinutes * 60 * 1000);
          if (!lastSentAt || canRepeat) {
            newsAlertSentMap.set(eventId, Date.now());
            const eta = formatMinutesForNotification(minutes);
            const impacted = getImpactedPairsText(evt.country);
            const text = `${evt.country} ${evt.title} in ${eta}. Copy guard active.${impacted ? ` ${impacted}` : ''}`;
            addLog('warn', 'High-impact news alert', text);
            sendDesktopNotification('High-impact News Alert', text, `high-news:${eventId}`, 10 * 60 * 1000);
          }
        }

        // 2) Release notification with result (better/worse for currency)
        if (minutes <= 0 && minutes >= -15 && !newsReleaseSentMap.has(eventId)) {
          const actual = Number(evt?.actual);
          const forecast = Number(evt?.forecast);
          if (Number.isFinite(actual) && Number.isFinite(forecast)) {
            const delta = actual - forecast;
            const absDelta = Math.abs(delta);
            const verdict = absDelta < 1e-9 ? 'IN LINE' : delta > 0 ? 'BETTER THAN FORECAST' : 'WORSE THAN FORECAST';
            const currencyImpact = absDelta < 1e-9 ? `Neutral for ${evt.country}` : delta > 0 ? `Positive for ${evt.country}` : `Negative for ${evt.country}`;
            const impacted = getImpactedPairsText(evt.country);
            const body = `${evt.country} ${evt.title}: A ${actual} vs F ${forecast} -> ${verdict}. ${currencyImpact}.${impacted ? ` ${impacted}` : ''}`;
            newsReleaseSentMap.set(eventId, Date.now());
            addLog('info', 'High-impact news released', body);
            sendDesktopNotification('High-impact News Result', body, `high-news-release:${eventId}`, 10 * 60 * 1000);
          }
        }
      }
    } catch {
      // keep monitor alive silently
    }
  }, 60000);
}

global.appLog = addLog;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Prefer broker unix `*Ts` over string times (imports / stale strings must not override DEAL_TIME). */
function extractAckOpenedAtRaw(ack) {
  const ts = toNumber(ack?.trade?.openedAtTs ?? ack?.openedAtTs);
  if (ts != null && ts > 0) return ts;
  const s = ack?.trade?.openedAt ?? ack?.openedAt;
  if (s != null && String(s).trim() !== '') return s;
  return null;
}

function extractAckClosedAtRaw(ack) {
  const ts = toNumber(ack?.trade?.closedAtTs ?? ack?.closedAtTs);
  if (ts != null && ts > 0) return ts;
  const s = ack?.trade?.closedAt ?? ack?.closedAt;
  if (s != null && String(s).trim() !== '') return s;
  return null;
}

function ackTimeToIso(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return '';
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || rawValue <= 0) return '';
    const ms = rawValue > 1e12 ? rawValue : rawValue * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const s = String(rawValue).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return '';
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function isoToClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 8);
}

function getStoredTrades() {
  return tradeStore.getAllTrades();
}

function saveStoredTrades(trades) {
  return tradeStore.saveAllTrades(trades);
}

function buildJournalForNewTradeFromAi(aiVerdict, persistAi) {
  const base = {
    notes: '',
    tags: [],
    mistakes: [],
    checklist: [],
    confidence: null
  };
  if (!persistAi || !aiVerdict?.ok) return base;
  const stamp = new Date().toISOString();
  const score = Math.max(0, Math.min(100, Math.round(Number(aiVerdict.score) || 0)));
  const reasons = Array.isArray(aiVerdict.reasons) ? aiVerdict.reasons.filter(Boolean) : [];
  const lines = [
    '--- AI signal check ---',
    `When: ${stamp}`,
    `Chart confidence: ${score}% (${String(aiVerdict.action || 'allow')})`,
    aiVerdict.summary ? `Summary: ${String(aiVerdict.summary).slice(0, 500)}` : '',
    aiVerdict.entryVsChart ? `Entry vs chart: ${String(aiVerdict.entryVsChart).slice(0, 320)}` : '',
    aiVerdict.tfBiasVsStructure ? `TF bias vs structure: ${String(aiVerdict.tfBiasVsStructure).slice(0, 320)}` : '',
    aiVerdict.adjustHint ? `Adjust hint: ${String(aiVerdict.adjustHint).slice(0, 320)}` : '',
    reasons.length ? `Reasons:\n${reasons.map((r) => `- ${String(r).slice(0, 220)}`).join('\n')}` : '',
    '---'
  ].filter(Boolean).join('\n');
  return {
    ...base,
    notes: lines,
    aiChartConfidence: score,
    aiReviewAt: stamp
  };
}

function buildAiTradeReviewNoteBlock(summaryResult, isoStamp) {
  const body = [
    summaryResult.headline,
    summaryResult.tradeNote,
    (summaryResult.wins_list || []).length ? `Working: ${summaryResult.wins_list.join('; ')}` : '',
    (summaryResult.leaks || []).length ? `Leaking: ${summaryResult.leaks.join('; ')}` : '',
    summaryResult.next_action ? `Next: ${summaryResult.next_action}` : ''
  ].filter(Boolean).join('\n\n');
  const hdrLines = [
    '--- AI trade review ---',
    `When: ${isoStamp}`,
    summaryResult.chartConfidence != null && Number.isFinite(Number(summaryResult.chartConfidence))
      ? `Chart confidence: ${Math.round(Number(summaryResult.chartConfidence))}%`
      : null
  ].filter(Boolean);
  return `${hdrLines.join('\n')}\n\n${body}\n---`;
}

function applyAiTradeReviewToStoredTrade(tradeId, summaryResult) {
  const trades = getStoredTrades();
  const idx = trades.findIndex((t) => String(t.id) === String(tradeId));
  if (idx < 0) return false;
  const t = trades[idx];
  const stamp = new Date().toISOString();
  const block = buildAiTradeReviewNoteBlock(summaryResult, stamp);
  const prevNotes = String(t.journal?.notes || '');
  const mergedNotes = prevNotes.trim() ? `${block}\n\n${prevNotes.trim()}` : block;
  let nextAiConf = null;
  if (summaryResult.chartConfidence != null && Number.isFinite(Number(summaryResult.chartConfidence))) {
    nextAiConf = Math.max(0, Math.min(100, Math.round(Number(summaryResult.chartConfidence))));
  } else if (t.journal?.aiChartConfidence != null && Number.isFinite(Number(t.journal.aiChartConfidence))) {
    nextAiConf = Math.round(Number(t.journal.aiChartConfidence));
  }
  const updatedTrade = normalizeTradeForStorage({
    ...t,
    journal: {
      ...(t.journal || {}),
      notes: mergedNotes,
      ...(nextAiConf != null ? { aiChartConfidence: nextAiConf } : {}),
      aiReviewAt: stamp
    },
    lastUpdateAt: stamp
  });
  trades[idx] = updatedTrade;
  saveStoredTrades(trades);
  if (mainWindow) mainWindow.webContents.send('trade:update', updatedTrade);  return true;
}

function tradeJournalHasAiClose(trade) {
  return String(trade?.journal?.notes || '').includes('[AI_CLOSE]');
}

function applyAiCloseInsightToStoredTrade(tradeId, summaryResult) {
  const trades = getStoredTrades();
  const idx = trades.findIndex((t) => String(t.id) === String(tradeId));
  if (idx < 0) return false;
  const t = trades[idx];
  if (tradeJournalHasAiClose(t)) return false;
  const stamp = new Date().toISOString();
  const inner = buildAiTradeReviewNoteBlock(summaryResult, stamp);
  const block = `[AI_CLOSE]\n${inner}`;
  const prevNotes = String(t.journal?.notes || '');
  const mergedNotes = prevNotes.trim() ? `${block}\n\n${prevNotes.trim()}` : block;
  let nextAiConf = null;
  if (summaryResult.chartConfidence != null && Number.isFinite(Number(summaryResult.chartConfidence))) {
    nextAiConf = Math.max(0, Math.min(100, Math.round(Number(summaryResult.chartConfidence))));
  } else if (t.journal?.aiChartConfidence != null && Number.isFinite(Number(t.journal.aiChartConfidence))) {
    nextAiConf = Math.round(Number(t.journal.aiChartConfidence));
  }
  const updatedTrade = normalizeTradeForStorage({
    ...t,
    journal: {
      ...(t.journal || {}),
      notes: mergedNotes,
      ...(nextAiConf != null ? { aiChartConfidence: nextAiConf } : {}),
      aiReviewAt: stamp,
      aiCloseInsightAt: stamp
    },
    lastUpdateAt: stamp
  });
  trades[idx] = updatedTrade;
  saveStoredTrades(trades);
  if (mainWindow) mainWindow.webContents.send('trade:update', updatedTrade);  return true;
}

async function maybeRunAiCloseInsight(trade) {
  try {
    const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
    if (!settings?.aiCheck?.enabled || settings.autoAiCloseInsight === false) return;
    if (!trade?.id || tradeJournalHasAiClose(trade)) return;
    if (!licenseState?.licensed) return;

    const r = await aiSignalCheck.summarizePerformance({
      trades: getStoredTrades(),
      settings,
      accountSnapshot: mt5AccountSnapshot,
      limit: 12,
      tradeIds: [trade.id]
    });
    if (!r?.ok) return;
    applyAiCloseInsightToStoredTrade(trade.id, r);
  } catch (e) {
    addLog('warn', 'AI close insight failed', e?.message || String(e));
  }
}

function normalizeAccountIdentity(raw = {}) {
  const login = String(
    raw.login
    ?? raw.account
    ?? raw.accountNumber
    ?? raw.accountId
    ?? ''
  ).trim();
  const server = String(raw.server ?? raw.broker ?? '').trim();
  const name = String(raw.name ?? raw.accountName ?? '').trim();
  const key = login ? (server ? `${login}@${server}` : login) : '';
  return { key, login, server, name };
}

function getBestAccountIdentity(ack = {}) {
  const fromAck = normalizeAccountIdentity(ack);
  if (fromAck.key) return fromAck;
  return currentMt5Account || normalizeAccountIdentity();
}

function getAccountSyncState() {
  return store.get('accountSyncState', {});
}

function getKnownMt5Accounts() {
  const raw = store.get('knownMt5Accounts', []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const norm = normalizeAccountIdentity(item || {});
      if (!norm.key) return null;
      return {
        ...norm,
        lastSeenAt: item?.lastSeenAt || new Date().toISOString()
      };
    })
    .filter(Boolean);
}

function upsertKnownMt5Account(identity = {}) {
  if (!identity?.key) return;
  const existing = getKnownMt5Accounts();
  const idx = existing.findIndex((acc) => acc.key === identity.key);
  const merged = {
    key: identity.key,
    login: identity.login || '',
    server: identity.server || '',
    name: identity.name || '',
    lastSeenAt: new Date().toISOString()
  };
  if (idx >= 0) existing[idx] = { ...existing[idx], ...merged };
  else existing.push(merged);
  store.set('knownMt5Accounts', existing);
}

function broadcastKnownMt5Accounts() {
  try {
    if (!mainWindow || mainWindow.isDestroyed?.()) return;
    mainWindow.webContents.send('mt5:knownAccounts', getKnownMt5Accounts());
  } catch (_) {
    // noop
  }
}

function forgetKnownMt5Account(accountKey = '', options = {}) {
  const key = String(accountKey || '').trim();
  if (!key) return { success: false, reason: 'MISSING_ACCOUNT_KEY' };
  const existing = getKnownMt5Accounts();
  const next = existing.filter((acc) => acc.key !== key);
  store.set('knownMt5Accounts', next);
  if (!options.skipBroadcast) broadcastKnownMt5Accounts();
  return { success: true, removed: existing.length !== next.length };
}

function seedKnownMt5AccountsFromTrades() {
  const trades = getStoredTrades();
  for (const t of trades) {
    const identity = normalizeAccountIdentity({
      login: t.accountLogin,
      server: t.accountServer,
      name: t.accountName,
      account: t.accountKey
    });
    if (identity.key) upsertKnownMt5Account(identity);
  }
}

function normalizeBrokerConnection(raw = {}) {
  const id = String(raw.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
  const providerRaw = String(raw.provider || 'MT5').trim().toUpperCase();
  const provider = providerRaw === 'MT4' ? 'MT4' : 'MT5';
  const name = String(raw.name || '').trim() || `${provider} Account`;
  const type = String(raw.type || 'Auto Sync').trim() || 'Auto Sync';
  const status = String(raw.status || 'Saved').trim() || 'Saved';
  const inputAuth = raw && typeof raw.auth === 'object' && raw.auth ? { ...raw.auth } : {};
  const auth = {
    login: String(inputAuth.login || inputAuth.accountId || '').trim(),
    server: String(inputAuth.server || '').trim(),
    password: String(inputAuth.password || '').trim()
  };
  return {
    id,
    provider,
    name,
    type,
    status,
    balance: Number.isFinite(Number(raw.balance)) ? Number(raw.balance) : null,
    profitMethod: String(raw.profitMethod || 'FIFO').trim() || 'FIFO',
    lastUpdate: raw.lastUpdate || null,
    nextUpdate: raw.nextUpdate || null,
    auth,
    transport: String(raw.transport || 'ea_tcp').trim() === 'cloud' ? 'cloud' : 'ea_tcp',
    cloudAccountId: String(raw.cloudAccountId || '').trim(),
    region: String(raw.region || 'eu-west').trim() || 'eu-west',
    mode: String(raw.mode || 'full').trim() === 'sync_only' ? 'sync_only' : 'full',
    cloudState: String(raw.cloudState || '').trim(),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Never send stored broker passwords to the renderer. The UI only needs to know
 * whether a password exists (`auth.hasPassword`); editing without retyping keeps
 * the stored one (see connections:upsert).
 */
function redactConnectionsForRenderer(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const auth = row.auth && typeof row.auth === 'object' ? row.auth : {};
    return {
      ...row,
      auth: {
        ...auth,
        password: '',
        hasPassword: !!String(auth.password || '').trim()
      }
    };
  });
}

function getCloudBridgeSettings() {
  const settings = store.get('settings', getDefaultSettings());
  const cloud = settings.cloudBridge && typeof settings.cloudBridge === 'object' ? settings.cloudBridge : {};
  return {
    apiBase: String(cloud.apiBase || process.env.TS_BRIDGE_API_URL || 'http://127.0.0.1:8787').trim(),
    wsBase: String(cloud.wsBase || process.env.TS_BRIDGE_WS_URL || 'ws://127.0.0.1:8788').trim(),
    token: String(cloud.token || '').trim(),
    tenantId: String(cloud.tenantId || 'dev-tenant').trim(),
    enabled: cloud.enabled !== false
  };
}

function configureCloudBridgeFromSettings() {
  const cfg = getCloudBridgeSettings();
  cloudBridge.configure({
    apiBase: cfg.apiBase,
    wsBase: cfg.wsBase,
    token: cfg.token
  });
  bridgeRouter.setPreferCloud(cfg.enabled);
  return cfg;
}

async function ensureCloudToken() {
  configureCloudBridgeFromSettings();
  const cfg = getCloudBridgeSettings();
  if (cfg.token) return cfg.token;
  const token = await cloudBridge.ensureDevToken(cfg.tenantId);
  const settings = store.get('settings', getDefaultSettings());
  store.set('settings', {
    ...settings,
    cloudBridge: { ...(settings.cloudBridge || {}), token }
  });
  return token;
}

function updateConnectionCloudState(connectionId, patch = {}) {
  const rows = getBrokerConnections();
  const idx = rows.findIndex((r) => r.id === connectionId);
  if (idx < 0) return null;
  rows[idx] = normalizeBrokerConnection({ ...rows[idx], ...patch });
  saveBrokerConnections(rows);
  return rows[idx];
}

function getBrokerConnections() {
  const rawRows = store.get('brokerConnections', []);
  const rows = secretsVault.decryptArrayField(Array.isArray(rawRows) ? rawRows : [], 'auth.password');
  if (!Array.isArray(rows)) return [];
  const live = currentMt5Account || {};
  const bridgeStatus = bridgeRouter.getStatus();
  const mt5Connected = !!bridgeStatus?.connected;
  const cloudConnected = !!bridgeStatus?.cloudConnected;
  return rows.map((row) => {
    const normalized = normalizeBrokerConnection(row);
    const login = String(normalized?.auth?.login || '').trim();
    const server = String(normalized?.auth?.server || '').trim();
    const password = String(normalized?.auth?.password || '').trim();
    if (!login || !server || !password) {
      normalized.status = 'Missing Credentials';
      return normalized;
    }
    if (normalized.transport === 'cloud') {
      const cloudState = String(normalized.cloudState || '').toUpperCase();
      if (cloudState === 'CONNECTED' && cloudConnected && normalized.cloudAccountId === bridgeStatus.cloudAccountId) {
        normalized.status = 'Connected';
      } else if (cloudState) {
        normalized.status = cloudState.charAt(0) + cloudState.slice(1).toLowerCase();
      } else {
        normalized.status = 'Cloud Saved';
      }
      return normalized;
    }
    if (normalized.provider === 'MT5') {
      const sameAccount = String(live.login || '').trim() === login
        && String(live.server || '').trim() === server;
      normalized.status = sameAccount && mt5Connected ? 'Connected' : 'Saved';
      return normalized;
    }
    normalized.status = 'Saved';
    return normalized;
  });
}

function saveBrokerConnections(rows = []) {
  const normalized = Array.isArray(rows) ? rows.map((row) => normalizeBrokerConnection(row)) : [];
  const persisted = secretsVault.encryptArrayField(normalized, 'auth.password');
  store.set('brokerConnections', persisted);
  return normalized;
}

function markAccountSynced(accountKey, meta = {}) {
  if (!accountKey) return;
  const map = getAccountSyncState();
  map[accountKey] = {
    ...(map[accountKey] || {}),
    lastSyncAt: new Date().toISOString(),
    ...meta
  };
  store.set('accountSyncState', map);
}

function computeIncrementalLookbackHours(accountKey, fallbackHours = 24) {
  const map = getAccountSyncState();
  const state = map[accountKey];
  if (!state?.lastSyncAt) return fallbackHours;
  const lastMs = new Date(state.lastSyncAt).getTime();
  if (!Number.isFinite(lastMs) || lastMs <= 0) return fallbackHours;
  const nowMs = Date.now();
  const deltaHours = (nowMs - lastMs) / (1000 * 60 * 60);
  // Add a safety overlap to avoid missing trades around reconnect boundaries.
  const withOverlap = Math.ceil(Math.max(0, deltaHours) + 6);
  return Math.min(24 * 30, Math.max(1, withOverlap));
}

const SYNC_LOOKBACK_UNITS = new Set(['HOURS', 'DAYS', 'MONTHS', 'ALL']);

function normalizeSyncLookbackUnit(unit) {
  const u = String(unit || '').toUpperCase();
  return SYNC_LOOKBACK_UNITS.has(u) ? u : 'HOURS';
}

/** Reads sync window from settings; legacy syncLookbackHours maps to HOURS when unit unset. */
function resolveSyncLookbackFromSettings(settings = {}) {
  const rawUnit = String(settings?.syncLookbackUnit || '').toUpperCase();
  if (SYNC_LOOKBACK_UNITS.has(rawUnit)) {
    let amount = Number(settings?.syncLookbackAmount);
    if (!Number.isFinite(amount) || amount < 1) amount = 1;
    if (rawUnit === 'ALL') return { unit: 'ALL', amount: 1 };
    return { unit: rawUnit, amount };
  }
  const legacy = Number(settings?.syncLookbackHours);
  const amount = Number.isFinite(legacy) && legacy > 0 ? legacy : 24;
  return { unit: 'HOURS', amount };
}

function baselineLookbackHoursFromUnit(unit, amount) {
  if (unit === 'ALL') return 24 * 365 * 5;
  if (unit === 'HOURS') return Math.max(1, amount);
  if (unit === 'DAYS') return Math.max(1, amount) * 24;
  return Math.max(1, amount) * 30 * 24;
}

function buildSyncRequestPayload(settings = {}, accountKey = '') {
  const { unit: syncUnit, amount: syncAmount } = resolveSyncLookbackFromSettings(settings);
  if (syncUnit === 'ALL') {
    return {
      payload: {
        lookbackUnit: 'ALL',
        lookbackAmount: 1,
        lookbackHours: 24 * 30
      },
      summary: 'all available history',
      accountTradeCount: 0
    };
  }

  const baselineHours = baselineLookbackHoursFromUnit(syncUnit, syncAmount);
  const baselineLookback = Math.max(24, baselineHours);
  const trades = getStoredTrades();
  const accountTradeCount = accountKey
    ? trades.filter(t => (t.accountKey || 'unknown') === accountKey).length
    : trades.length;
  const incrementalLookback = accountKey
    ? computeIncrementalLookbackHours(accountKey, baselineLookback)
    : baselineLookback;
  // Bootstrap wide sync for newly connected accounts with no local history yet.
  const bootstrapLookback = accountTradeCount === 0 ? 24 * 30 : incrementalLookback;
  const lookbackHours = Math.max(baselineLookback, bootstrapLookback);
  const cappedHours = Math.min(24 * 365 * 10, Math.round(lookbackHours));

  return {
    payload: {
      lookbackHours: cappedHours,
      lookbackUnit: 'HOURS',
      lookbackAmount: cappedHours
    },
    summary: `last ${cappedHours}h equivalent`,
    accountTradeCount
  };
}

function requestMt5Sync(reason = 'manual') {
  const status = bridgeRouter.getStatus();
  if (!status.connected && !status.cloudConnected) return { success: false, reason: 'MT5_NOT_CONNECTED' };

  const settings = store.get('settings', getDefaultSettings());
  const accountKey = currentMt5Account?.key || store.get('currentMt5Account', null)?.key || '';
  const plan = buildSyncRequestPayload(settings, accountKey);
  const ok = bridgeRouter.sendControl('SYNC_REQUEST', plan.payload);
  if (!ok) return { success: false, reason: 'SYNC_SEND_FAILED' };

  if (accountKey) {
    markAccountSynced(accountKey, {
      lastSyncRequestReason: reason,
      lastSyncRequestAt: new Date().toISOString()
    });
  }

  if (reason === 'manual') {
    addLog('info', 'Manual refresh requested', `Requesting ${plan.summary} from MT5`);
  } else {
    addLog('info', 'Automatic MT5 sync requested', `${reason} -> ${plan.summary}`);
  }

  if (accountKey && plan.accountTradeCount !== undefined) {
    addLog('info', 'Incremental sync window', `${accountKey} -> ${plan.summary} (local trades: ${plan.accountTradeCount})`);
  }
  return { success: true };
}

function shouldLogMt5Ack(ack = {}) {
  const status = String(ack?.status || '').toUpperCase();
  if (!status) return true;
  const settings = store.get('settings', getDefaultSettings());
  const intervalSecRaw = Number(settings?.mt5AckLogIntervalSec);
  const intervalSec = Number.isFinite(intervalSecRaw) ? Math.max(0, intervalSecRaw) : 5;
  if (intervalSec <= 0) return true;

  const symbol = String(ack?.trade?.symbol || ack?.symbol || '*').toUpperCase();
  const key = `${status}:${symbol}`;
  const nowMs = Date.now();
  const lastMs = mt5AckLogThrottleMap.get(key) || 0;
  if ((nowMs - lastMs) < intervalSec * 1000) return false;
  mt5AckLogThrottleMap.set(key, nowMs);
  return true;
}

function isClosedStatus(status = '') {
  const s = String(status || '').toUpperCase();
  return (
    s.includes('CLOSED')
    || s.includes('SL_HIT')
    || s.includes('TP_HIT')
    || s.includes('STOP_LOSS')
    || s.includes('TAKE_PROFIT')
  );
}

/** Open legs eligible for POSITION_UPDATE / sync ACK matching (excludes failed/blocked ghosts). */
function isAckMatchableOpenStatus(status = '') {
  const s = String(status || '').toUpperCase();
  if (isClosedStatus(s)) return false;
  if (s.startsWith('FAILED')) return false;
  if (s.startsWith('BLOCKED')) return false;
  if (s === 'SIMULATED' || s === 'CLOSING') return false;
  return true;
}

function pickBestAckCandidate(candidates = [], ack = {}) {
  return pickBestAckCandidateCore(candidates, ack, { isAckMatchableOpenStatus });
}

/** When one signal leg fills, mark sibling rows from the same Telegram message as duplicate ghosts. */
function collapseDuplicateSignalTrades(trades, winningTrade) {
  const msgId = winningTrade?.tgMessageId;
  if (msgId === undefined || msgId === null || msgId === '') return false;
  const chan = String(winningTrade?.channel || '');
  let changed = false;
  for (const t of trades) {
    if (!t || t.id === winningTrade.id) continue;
    if (t.tgMessageId !== msgId) continue;
    if (String(t.channel || '') !== chan) continue;
    const st = String(t.status || '').toUpperCase();
    if (!st.startsWith('FAILED') && st !== 'PENDING' && st !== 'DISPATCHED' && st !== 'NO_MT5_QUEUED') continue;
    t.status = 'FAILED_DUPLICATE';
    t.blockedReason = t.blockedReason || 'Duplicate dispatch for the same Telegram signal — only one leg was executed';
    t.lastUpdateAt = new Date().toISOString();
    changed = true;
  }
  return changed;
}

/** Drop orphan MT5 Auto sync rows once the Telegram leg owns the same broker ticket. */
function collapseMt5SyncDuplicate(trades, primaryTrade) {
  if (!primaryTrade?.fromTelegramSignal) return { changed: false, removedIds: [] };
  const pid = cleanBrokerId(primaryTrade.mt5PositionId || primaryTrade.mt5Ticket);
  const removedIds = [];
  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i];
    if (!t || t.id === primaryTrade.id || t.fromTelegramSignal) continue;
    const ch = String(t.channel || '');
    if (ch !== 'MT5 Auto' && ch !== 'MT5 Manual') continue;
    const tPid = cleanBrokerId(t.mt5PositionId || t.mt5Ticket);
    const sameTicket = pid && tPid && pid === tPid;
    const sameOpenLeg =
      symbolsLikelySame(t.symbol, primaryTrade.symbol)
      && String(t.type || '').toUpperCase() === String(primaryTrade.type || '').toUpperCase()
      && String(t.status || '').toUpperCase() === 'POSITION_UPDATE';
    if (sameTicket || (sameOpenLeg && pid)) {
      Object.assign(primaryTrade, inheritMissingTradeMetadata(primaryTrade, t));
      if (t.id != null && t.id !== '') removedIds.push(t.id);
      trades.splice(i, 1);
    }
  }
  return { changed: removedIds.length > 0, removedIds };
}

function notifyTradesRemovedFromUi(removedIds = []) {
  const ids = (Array.isArray(removedIds) ? removedIds : []).filter((id) => id != null && id !== '');
  if (!ids.length || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('trades:removed', ids);
  } catch {
    /* noop */
  }
}

function formatBrokerFailureReason(status = '') {
  const s = String(status || '').toUpperCase();
  const m = s.match(/^FAILED_(.+)$/);
  if (!m) return 'Broker rejected the order';
  const code = m[1];
  const known = {
    4756: 'MT5 lost network connection during order (4756)',
    10004: 'Requote — price moved',
    10006: 'Order rejected by server',
    10013: 'Invalid order request',
    10018: 'Market is closed',
    10019: 'Not enough money / margin',
    10031: 'No connection to trade server',
    10026: 'Automated trading disabled by broker/server'
  };
  return known[code] || known[Number(code)] || `Broker error (${code})`;
}

function applyTradeDispatchCallback(trade, ack = {}) {
  signalPipeline.applyTradeDispatchStatus(trade, ack);
  const st = String(ack.status || '').toUpperCase();
  if (st === 'QUEUE_EXPIRED' || st === 'QUEUE_OVERFLOW') {
    addLog('warn', `Queued signal dropped (${st}): ${trade.type || ''} ${trade.symbol || ''}`, trade.blockedReason || '');
  }
}

function tickStaleDispatchTrades() {
  const trades = getStoredTrades();
  let changed = false;
  const now = Date.now();
  for (const t of trades) {
    if (String(t?.status || '').toUpperCase() !== 'DISPATCHED') continue;
    if (cleanBrokerId(t.mt5Ticket) || cleanBrokerId(t.mt5PositionId)) continue;
    const at = new Date(t.dispatchedAt || t.lastUpdateAt || t.openedAt || 0).getTime();
    if (!Number.isFinite(at) || (now - at) < 120000) continue;
    t.status = 'FAILED_DISPATCH_TIMEOUT';
    t.blockedReason = 'No broker confirmation within 2 minutes (network or EA issue). Use Resend to MT5.';
    t.lastUpdateAt = new Date().toISOString();
    changed = true;
    addLog('warn', 'Trade dispatch timed out', `${t.type || ''} ${t.symbol || ''}`);
    if (mainWindow) mainWindow.webContents.send('trade:update', t);
  }
  if (changed) saveStoredTrades(trades);
}

function normalizeTradeStatus(status = '') {
  const s = String(status || '').toUpperCase();
  if (!s) return 'SENT';
  if (s === 'POSITION_UPDATE') return 'POSITION_UPDATE';
  if (s === 'EXECUTED') return 'SENT';
  if (s === 'SUBMITTED') return 'DISPATCHED';
  if (s === 'PENDING_PLACED') return 'PENDING';
  if (isClosedStatus(s)) {
    if (s.includes('CLOSED_EOD')) return 'CLOSED_EOD';
    // Must be before generic "SL" / "PROFIT" checks (EA may send CLOSED_SL_PROFIT).
    if (s.includes('CLOSED_SL_PROFIT') || s.includes('SL_PROFIT')) return 'CLOSED_SL_PROFIT';
    if (s.includes('SL')) return 'CLOSED_SL';
    if (s.includes('TP') || (s.includes('PROFIT') && !s.includes('CLOSED_SL'))) return 'CLOSED_TP';
    return 'CLOSED';
  }
  return s;
}

/**
 * MT5 DEAL_REASON_SL covers any stop fill: initial SL, trailing SL, BE lock. Optional EA label
 * CLOSED_SL_PROFIT. For older EAs, upgrade CLOSED_SL when P/L clearly exceeds BE band.
 */
function refineClosedStatusFromProfit(rawNormalized, profit, ackRaw = '') {
  const base = String(rawNormalized || '');
  if (base === 'CLOSED_EOD') return base;
  if (base === 'CLOSED_SL_PROFIT') return base;
  let th = 50;
  try {
    const merged = { ...getDefaultSettings(), ...(store.get('settings', {}) || {}) };
    const t = Number(merged.analyticsBreakEvenAmount);
    if (Number.isFinite(t) && t >= 0) th = t;
  } catch {
    th = 50;
  }
  const p = toNumber(profit);
  const raw = String(ackRaw || '').toUpperCase();
  const isSlLike = base === 'CLOSED_SL' || base === 'SL_HIT' || raw.includes('CLOSED_SL') || raw.includes('SL_HIT');
  if (!isSlLike || !Number.isFinite(p)) return base;
  if (p > th) return 'CLOSED_SL_PROFIT';
  return base;
}

function extractAckProfit(ack) {
  return (
    toNumber(ack?.profit)
    ?? toNumber(ack?.pnl)
    ?? toNumber(ack?.trade?.profit)
    ?? toNumber(ack?.trade?.pnl)
    ?? null
  );
}

function getAckTradeIds(ack) {
  return [
    ack?.trade?.tradeId,
    ack?.tradeId,
    ack?.signal?.tradeId,
    ack?.trade?.id,
    ack?.id
  ]
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(v => String(v));
}

/** MT5 sends "0" for unused ids — ignore so POSITION_UPDATE matches real ticket */
function cleanBrokerId(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '0') return '';
  return s;
}

/** All broker identifiers on this ACK (position ticket, deal, order, …) */
function getAckBrokerIdSet(ack) {
  const raw = [
    ack?.positionId,
    ack?.trade?.positionId,
    ack?.dealId,
    ack?.trade?.dealId,
    ack?.orderId,
    ack?.trade?.orderId,
    ack?.ticket,
    ack?.trade?.ticket
  ];
  const set = new Set();
  for (const v of raw) {
    const s = cleanBrokerId(v);
    if (s) set.add(s);
  }
  return set;
}

function getAckTickets(ack) {
  return [
    ack?.ticket,
    ack?.dealId,
    ack?.positionId,
    ack?.orderId,
    ack?.trade?.ticket,
    ack?.trade?.dealId,
    ack?.trade?.positionId,
    ack?.trade?.orderId
  ]
    .map((v) => cleanBrokerId(v))
    .filter(Boolean);
}

/**
 * Before removing a trade from local storage: cancel pending orders or close positions on MT5 when linked.
 */
function requestBrokerCancelTrade(trade) {
  if (!trade) return;
  const status = String(trade.status || '').toUpperCase();
  if (status.includes('BLOCKED')) return;

  const connected = !!bridgeRouter.getStatus()?.connected;
  if (!connected) {
    addLog('warn', 'MT5 offline — broker cancel skipped', `${trade.symbol || ''}`);
    return;
  }

  const sym = String(trade.symbol || '').trim();
  const pendingTickets = [];
  if (Array.isArray(trade.mt5PendingOrderTickets) && trade.mt5PendingOrderTickets.length) {
    pendingTickets.push(...trade.mt5PendingOrderTickets.map((x) => String(x).trim()).filter(Boolean));
  }

  const isPending = status === 'PENDING' || status.includes('PENDING');
  if (pendingTickets.length === 0 && isPending && trade.mt5Ticket) {
    const tid = String(trade.mt5Ticket).trim();
    if (/^\d+$/.test(tid)) pendingTickets.push(tid);
  }

  if (isPending && pendingTickets.length > 0) {
    bridgeRouter.sendControl('CANCEL_ORDER', { orderTickets: pendingTickets.join(','), symbol: sym });
    addLog('info', `MT5 cancel pending → ${pendingTickets.join(',')}`, sym);
  }
}

const SCREENSHOT_STAGE_RANK = {
  ENTRY: 0,
  PENDING: 1,
  OPEN: 2,
  SENT: 3,
  SL: 10,
  TP: 15,
  BE: 20,
  CLOSE: 30,
  EXIT: 30,
  CLOSED: 30,
  SHOT: 99
};

function sortTradeScreenshotsStorage(shots) {
  if (!Array.isArray(shots)) return [];
  return [...shots].sort((a, b) => {
    const sa = String(a?.stage || '').toUpperCase();
    const sb = String(b?.stage || '').toUpperCase();
    const ra = SCREENSHOT_STAGE_RANK[sa] ?? 50;
    const rb = SCREENSHOT_STAGE_RANK[sb] ?? 50;
    if (ra !== rb) return ra - rb;
    return String(a?.capturedAt || '').localeCompare(String(b?.capturedAt || ''));
  });
}

function getAckScreenshot(ack) {
  const shot = ack?.screenshot;
  if (!shot || typeof shot !== 'object') return null;

  const rawPath = String(shot.path || '').trim();
  const rawFile = String(shot.file || '').trim();
  if (!rawPath && !rawFile) return null;

  const capturedAt = String(shot.capturedAt || new Date().toISOString());
  const stage = String(shot.stage || 'SHOT').toUpperCase();
  const symbol = String(shot.symbol || ack?.trade?.symbol || ack?.symbol || '');
  const file = rawFile || rawPath.split(/[\\/]/).pop() || '';
  const id = String(shot.id || `${stage}-${capturedAt}-${file || rawPath}`);

  return {
    id,
    stage,
    symbol,
    file,
    path: rawPath,
    capturedAt
  };
}

function mergeTradeScreenshot(trade, ack) {
  const shot = getAckScreenshot(ack);
  if (!shot) return false;

  const existing = Array.isArray(trade.screenshots) ? trade.screenshots : [];
  const alreadyExists = existing.some((s) =>
    (s?.id && shot.id && s.id === shot.id)
    || (s?.path && shot.path && s.path === shot.path)
  );
  if (alreadyExists) {
    trade.screenshots = existing;
    return false;
  }

  trade.screenshots = sortTradeScreenshotsStorage([shot, ...existing]).slice(0, 20);
  return true;
}

function resolveTradeForAck(ack, trades) {
  const ackTradeIds = getAckTradeIds(ack);
  if (ackTradeIds.length > 0) {
    const byId = trades.find(t => ackTradeIds.includes(String(t.id)));
    if (byId) return byId;
  }

  const brokerSet = getAckBrokerIdSet(ack);
  if (brokerSet.size > 0) {
    const byBroker = trades.filter((t) => {
      if (brokerSet.has(cleanBrokerId(t.mt5Ticket))) return true;
      if (brokerSet.has(cleanBrokerId(t.mt5PositionId))) return true;
      if (brokerSet.has(cleanBrokerId(t.mt5DealId))) return true;
      const pend = Array.isArray(t.mt5PendingOrderTickets) ? t.mt5PendingOrderTickets : [];
      return pend.some((p) => brokerSet.has(cleanBrokerId(p)));
    });
    if (byBroker.length > 0) {
      const tg = byBroker.filter((t) => t.fromTelegramSignal);
      const pool = tg.length > 0 ? tg : byBroker;
      if (pool.length === 1) return pool[0];
      return pickBestAckCandidate(pool, ack);
    }
  }

  const symbol = String(ack?.trade?.symbol || ack?.symbol || '').toUpperCase();
  const type = String(ack?.trade?.type || ack?.type || '').toUpperCase();
  const ackEntry = toNumber(ack?.trade?.entry);
  const ackLot = toNumber(ack?.trade?.lot);

  // Same symbol+direction but distinct legs (hedging): match EA snapshot by entry + volume
  if (symbol && Number.isFinite(ackEntry) && ackLot > 0) {
    const entryLotHits = trades.filter((t) => {
      if (!isAckMatchableOpenStatus(t.status)) return false;
      if (!symbolsLikelySame(t.symbol, symbol)) return false;
      if (type && String(t.type || '').toUpperCase() !== type) return false;
      const te = toNumber(t.entry);
      const tl = toNumber(t.lot);
      if (!Number.isFinite(te) || !(tl > 0)) return false;
      return Math.abs(te - ackEntry) < 0.0002 && Math.abs(tl - ackLot) < 0.0001;
    });
    const picked = pickBestAckCandidate(entryLotHits, ack);
    if (picked) return picked;
  }

  if (symbol) {
    const candidates = trades.filter((t) => {
      if (!isAckMatchableOpenStatus(t.status)) return false;
      if (!symbolsLikelySame(t.symbol, symbol)) return false;
      return type ? String(t.type || '').toUpperCase() === type : true;
    });
    return pickBestAckCandidate(candidates, ack);
  }

  return null;
}

function upsertSyncedTradeFromAck(ack, trades) {
  const positionId = cleanBrokerId(ack?.positionId || ack?.trade?.positionId);
  const dealId = cleanBrokerId(ack?.dealId || ack?.trade?.dealId);
  const ticket =
    dealId
    || positionId
    || [...getAckBrokerIdSet(ack)][0]
    || `${Date.now()}-${Math.random()}`;
  const symbol = ack?.trade?.symbol || ack?.symbol || 'UNKNOWN';
  const type = ack?.trade?.type || ack?.type || 'SYNC';
  const profit = extractAckProfit(ack) ?? 0;
  const status = refineClosedStatusFromProfit(
    normalizeTradeStatus(ack.status || 'SYNCED'),
    profit,
    ack.status
  );
  const origin = String(ack?.origin || '').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'AUTO';
  const nowIso = new Date().toISOString();
  const nowTime = new Date().toTimeString().slice(0, 8);
  const closedAtIso = ackTimeToIso(extractAckClosedAtRaw(ack));
  // History-synced closed deals only carry the close time (DEAL_TIME). Without an
  // open timestamp, fall back to the close time — never to "now" — so re-synced
  // history keeps its real date instead of all collapsing onto today.
  const openedAtIso = ackTimeToIso(extractAckOpenedAtRaw(ack)) || closedAtIso || nowIso;
  const account = getBestAccountIdentity(ack);
  const entry = toNumber(ack?.trade?.entry) ?? 0;
  const sl = toNumber(ack?.trade?.sl) ?? 0;
  const tp = toNumber(ack?.trade?.tp) ?? 0;
  const lot = toNumber(ack?.trade?.lot) ?? 0;
  const ackTypeNorm = String(type || '').toUpperCase();

  let trade = findSyncMergeTarget(trades, ack, {
    symbol,
    type,
    dealId,
    positionId,
    ticket,
    openedAtIso,
    profit
  });
  const priorStatusSnap = trade ? String(trade.status || '') : '';
  let isNew = !trade;

  if (!trade && status === 'POSITION_UPDATE') {
    const openTelegram = trades.find((t) => {
      if (!t?.fromTelegramSignal || !isAckMatchableOpenStatus(t.status)) return false;
      if (symbol && symbol !== 'UNKNOWN' && !symbolsLikelySame(t.symbol, symbol)) return false;
      if (ackTypeNorm && ackTypeNorm !== 'SYNC' && String(t.type || '').toUpperCase() !== ackTypeNorm) return false;
      return true;
    });
    if (openTelegram) trade = openTelegram;
    isNew = !trade;
  }

  const metadataDonor = findMetadataDonorForSync(trades, { symbol, type, openedAtIso, profit });

  if (!trade) {
    trade = {
      id: `mt5-${ticket}`,
      time: isoToClock(openedAtIso) || nowTime,
      openedAt: openedAtIso,
      lastUpdateAt: nowIso,
      channel: origin === 'MANUAL' ? 'MT5 Manual' : 'MT5 Auto',
      symbol,
      type,
      orderType: 'MARKET',
      entry,
      sl,
      tp,
      lot,
      status,
      profit,
      mt5Ticket: String(ticket),
      mt5PositionId: positionId || undefined,
      mt5DealId: dealId || undefined,
      origin,
      accountKey: account.key || 'unknown',
      accountLogin: account.login || 'Unknown',
      accountServer: account.server || '',
      accountName: account.name || '',
      screenshots: [],
      journal: {
        notes: '',
        tags: [],
        mistakes: [],
        checklist: [],
        confidence: null
      }
    };
    if (metadataDonor) inheritMissingTradeMetadata(trade, metadataDonor);
    trades.unshift(trade);
    isNew = true;
    if (trades.length > 200) trimTradesList(trades);
  } else {
    if (metadataDonor && metadataDonor.id !== trade.id) {
      inheritMissingTradeMetadata(trade, metadataDonor);
    }
    if (trade.userEdited !== true) {
      trade.symbol = symbol || trade.symbol;
      trade.type = type || trade.type;
    } else {
      if (!String(trade.symbol || '').trim()) trade.symbol = symbol || trade.symbol;
      if (!String(trade.type || '').trim()) trade.type = type || trade.type;
    }
    if (status !== 'POSITION_UPDATE') trade.status = status || trade.status;
    else if (String(trade.status || '').toUpperCase() === 'DISPATCHED') trade.status = 'SENT';
    trade.profit = profit;
    trade.lastUpdateAt = nowIso;
    applyAckExecToTrade(trade, { entry, sl, tp, lot });
    trade.channel = origin === 'MANUAL' ? 'MT5 Manual' : (trade.channel || 'MT5 Auto');
    trade.origin = origin;
    if (positionId) {
      trade.mt5PositionId = positionId;
      trade.mt5Ticket = positionId;
    }
    if (dealId) {
      trade.mt5DealId = dealId;
      if (!positionId) trade.mt5Ticket = dealId;
    }
    if (account.key) {
      trade.accountKey = account.key;
      trade.accountLogin = account.login;
      trade.accountServer = account.server;
      trade.accountName = account.name;
    }
    if (openedAtIso) {
      const explicitOpenTs = toNumber(ack?.trade?.openedAtTs ?? ack?.openedAtTs);
      const currentOpenedMs = new Date(trade.openedAt || '').getTime();
      const nextOpenedMs = new Date(openedAtIso).getTime();
      const takeOpen =
        (explicitOpenTs != null && explicitOpenTs > 0)
        || !Number.isFinite(currentOpenedMs)
        || (Number.isFinite(nextOpenedMs) && nextOpenedMs < currentOpenedMs);
      if (takeOpen) {
        trade.openedAt = openedAtIso;
      }
      if (!trade.time || String(trade.time).trim().length <= 8) {
        trade.time = isoToClock(trade.openedAt || openedAtIso) || trade.time || nowTime;
      }
    }
  }

  mergeTradeScreenshot(trade, ack);

  if (isClosedStatus(ack.status)) {
    trade.closedAt = closedAtIso || trade.closedAt || nowIso;
    trade.closeTime = isoToClock(trade.closedAt) || nowTime;
  }

  if (trade.fromTelegramSignal) {
    const dup = collapseMt5SyncDuplicate(trades, trade);
    notifyTradesRemovedFromUi(dup.removedIds);
  }

  const transitionedToClosed = isClosedStatus(trade.status) && !isClosedStatus(priorStatusSnap);

  return { trade, isNew, transitionedToClosed };
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, '../../public/icon.ico'),
    path.join(__dirname, '../../public/icon.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {
      /* noop */
    }
  }
  return candidates[0];
}

/** Lock a window down: no window.open popups, no navigation away from our own content. */
function hardenWindowNavigation(win) {
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      const isDevServer = !app.isPackaged && process.env.NODE_ENV === 'dev' && url.startsWith('http://localhost:5173');
      const isLocalFile = url.startsWith('file://');
      if (!isDevServer && !isLocalFile) event.preventDefault();
    });
  } catch (_) {
    /* best-effort */
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1117',
    titleBarStyle: 'default',
    title: getAppWindowTitle(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    icon: resolveAppIconPath()
  });
  hardenWindowNavigation(mainWindow);

  mainWindow.once('ready-to-show', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    } catch (_) {
      /* noop */
    }
  });

  // Always load from dist/renderer (built by vite)
  const distPath = path.join(__dirname, '../../dist/renderer/index.html');
  if (!app.isPackaged && process.env.NODE_ENV === 'dev') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(distPath);
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createMiniOverlayWindow() {
  if (miniOverlayWindow && !miniOverlayWindow.isDestroyed()) {
    miniOverlayWindow.focus();
    return miniOverlayWindow;
  }
  miniOverlayWindow = new BrowserWindow({
    width: 300,
    height: 130,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWindowNavigation(miniOverlayWindow);
  const distPath = path.join(__dirname, '../../dist/renderer/index.html');
  if (!app.isPackaged && process.env.NODE_ENV === 'dev') {
    miniOverlayWindow.loadURL('http://localhost:5173/?mini=1');
  } else {
    miniOverlayWindow.loadFile(distPath, { query: { mini: '1' } });
  }
  miniOverlayWindow.on('closed', () => { miniOverlayWindow = null; });
  return miniOverlayWindow;
}

function toggleMiniOverlayWindow() {
  if (miniOverlayWindow && !miniOverlayWindow.isDestroyed()) {
    miniOverlayWindow.close();
    miniOverlayWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    return { open: false };
  }
  createMiniOverlayWindow();
  return { open: true };
}

function refreshLicenseState() {
  licenseState = getLicenseStatus(store);
  return licenseState;
}

/** Remove legacy trial-expiry QA keys from older builds. */
function purgeLegacyLicenseQaStoreKeys() {
  try {
    store.delete('license.devOverrideExpiresAt');
    store.delete('license.enableTrialQaTools');
  } catch (_) {
    /* noop */
  }
}

function getPublicLicenseStatus() {
  const s = licenseState || {};
  return {
    licensed: !!s?.licensed,
    appVersion: s?.appVersion || '1.1.0',
    deviceId: s?.deviceId || '',
    reason: s?.reason || 'UNKNOWN',
    payload: s?.payload ?? null,
    expiresAt: s?.expiresAt ?? null,
    expiresInMs:
      typeof s?.expiresInMs === 'number' && Number.isFinite(s.expiresInMs)
        ? s.expiresInMs
        : null,
  };
}

function notifyLicenseEndingSoon(stage /* '72h' | '24h' */, expireIso = '') {
  const keyBase = expireIso ? `:${expireIso}` : '';
  if (stage === '72h') {
    const k = `license:expirysoon:72${keyBase}`;
    sendDesktopNotification(
      'Trade Station — Trial ending soon',
      'Less than 3 days remain on your license. Activate a new license before it expires.',
      k,
      6 * 60 * 60 * 1000
    );
    addLog(
      'warn',
      'License expiring (<72h)',
      expireIso || 'unknown expiry timestamp'
    );
  } else if (stage === '24h') {
    const k = `license:expirysoon:24${keyBase}`;
    sendDesktopNotification(
      'Trade Station — Trial ending tomorrow',
      'Less than 24 hours remain on your license. Activate a new license to avoid interruption.',
      k,
      3 * 60 * 60 * 1000
    );
    addLog(
      'warn',
      'License expiring (<24h)',
      expireIso || 'unknown expiry timestamp'
    );
  }
}

function tickLicenseExpiryWatch() {
  if (shutdownForLicenseExpiryInProgress) return;

  const wasLicensed = !!licenseState?.licensed;
  refreshLicenseState();

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const pub = getPublicLicenseStatus();
      const snap = JSON.stringify({
        licensed: !!pub?.licensed,
        reason: pub?.reason ?? '',
        expiresAt: pub?.expiresAt ?? null,
      });
      if (snap !== licenseStatusBroadcastSnap) {
        licenseStatusBroadcastSnap = snap;
        mainWindow.webContents.send('license:statusChanged', pub);
      }
    } catch (_) {
      /* ignore */
    }
  }

  const nowLic = !!licenseState?.licensed;
  if (!wasLicensed && nowLic) {
    scheduleDailyReportAfterEodLoop();
    scheduleWeeklyReportLoop();
    scheduleMonthlyReportLoop();
  }
  const msRem =
    typeof licenseState?.expiresInMs === 'number' && Number.isFinite(licenseState.expiresInMs)
      ? licenseState.expiresInMs
      : null;
  const expKey = licenseState?.expiresAt || '';

  if (nowLic && expKey && msRem != null && msRem > 0) {
    const k72 = `72:${expKey}`;
    const k24 = `24:${expKey}`;
    if (msRem <= LICENSE_EXPIRY_WARN_72_MS && store.get('license.warn72', '') !== k72) {
      store.set('license.warn72', k72);
      notifyLicenseEndingSoon('72h', expKey);
    }
    if (msRem <= LICENSE_EXPIRY_WARN_24_MS && store.get('license.warn24', '') !== k24) {
      store.set('license.warn24', k24);
      notifyLicenseEndingSoon('24h', expKey);
    }
  }

  if (wasLicensed && !nowLic && licenseState.reason === 'LICENSE_EXPIRED') {
    performLicenseExpiryShutdown();
  }
}

function performLicenseExpiryShutdown() {
  if (shutdownForLicenseExpiryInProgress) return;
  shutdownForLicenseExpiryInProgress = true;

  try {
    telegramClient.removeAllMessageHandlers();
  } catch (_) {
    /* noop */
  }

  if (newsGuardTimer) {
    try {
      clearInterval(newsGuardTimer);
    } catch (_) {
      /* noop */
    }
    newsGuardTimer = null;
  }
  servicesStarted = false;

  if (dailyReportEodTimer) {
    try {
      clearTimeout(dailyReportEodTimer);
    } catch (_) {
      /* noop */
    }
    dailyReportEodTimer = null;
  }
  if (weeklyReportTimer) {
    try {
      clearTimeout(weeklyReportTimer);
    } catch (_) {
      /* noop */
    }
    weeklyReportTimer = null;
  }
  if (monthlyReportTimer) {
    try {
      clearTimeout(monthlyReportTimer);
    } catch (_) {
      /* noop */
    }
    monthlyReportTimer = null;
  }

  sendDesktopNotification(
    'Trade Station — license ended',
    'Your trial or subscription has expired. The app will close. Restart Trade Station and enter a new license to continue.',
    'license:auto-shutdown-expired',
    60 * 60 * 1000
  );
  recordNotificationHistory({
    title: 'License expired',
    body: 'Application will shut down.',
    key: 'license:auto-shutdown-expired',
  });

  if (licenseWatchTimer) {
    try {
      clearInterval(licenseWatchTimer);
    } catch (_) {
      /* noop */
    }
    licenseWatchTimer = null;
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      licenseStatusBroadcastSnap = '';
      mainWindow.webContents.send('license:statusChanged', getPublicLicenseStatus());
      dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: 'Trade Station — License',
        message: 'Your license period has ended.',
        detail:
          'The application will close. When you open Trade Station again, enter a valid activation key.',
      });
    } else {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Trade Station — License',
        message: 'Your license period has ended.',
        detail:
          'The application will close. When you open Trade Station again, enter a valid activation key.',
      });
    }
  } catch (_) {
    /* noop */
  }

  setImmediate(() => {
    try {
      app.quit();
    } catch (_) {
      process.exit(0);
    }
  });
}

function ensureLicensed(handler) {
  return handler;
}

/** Inbound PARTIAL_CLOSE from the EA: record on the matching trade row + notify. */
function handlePartialCloseMessage(msg = {}) {
  const idSet = new Set([cleanBrokerId(msg?.ticket), cleanBrokerId(msg?.positionId)].filter(Boolean));
  if (idSet.size === 0) {
    addLog('warn', 'PARTIAL_CLOSE without ticket/positionId — ignored', JSON.stringify(msg).slice(0, 120));
    return;
  }
  const trades = getStoredTrades();
  const trade = trades.find((t) =>
    idSet.has(cleanBrokerId(t.mt5PositionId))
    || idSet.has(cleanBrokerId(t.mt5Ticket))
    || idSet.has(cleanBrokerId(t.mt5DealId))
  );
  if (!trade) {
    addLog('warn', 'PARTIAL_CLOSE could not be matched to a trade', `ticket ${[...idSet].join('/')}`);
    return;
  }

  const closedVolume = toNumber(msg.closedVolume) ?? 0;
  const remainingVolume = toNumber(msg.remainingVolume) ?? 0;
  const price = toNumber(msg.price) ?? 0;
  const profit = toNumber(msg.profit) ?? 0;

  if (!Array.isArray(trade.partialCloses)) trade.partialCloses = [];
  trade.partialCloses.push({
    closedVolume,
    remainingVolume,
    price,
    profit,
    at: new Date().toISOString()
  });
  if (remainingVolume > 0) trade.lot = remainingVolume;
  trade.lastUpdateAt = new Date().toISOString();
  saveStoredTrades(trades);
  if (mainWindow) mainWindow.webContents.send('trade:update', trade);

  const totalVolume = closedVolume + remainingVolume;
  const pct = totalVolume > 0 ? Math.round((closedVolume / totalVolume) * 100) : 0;
  const sym = msg?.trade?.symbol || trade.symbol || '';
  const profitTxt = `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(2)}`;
  const body = `Partial close: ${pct}% of ${sym} at ${price}, ${profitTxt}`;
  addLog('info', body, `remaining ${remainingVolume.toFixed(2)} lot`);
  sendDesktopNotification('Partial Close', body, `partial-close:${[...idSet][0]}`, 4000);
}

function handleTcpBridgeEvent(event, data) {
  if (mainWindow) mainWindow.webContents.send(event, data);
  if (event === 'connection:status') {
    if (data.mt5 === true)  addLog('success', 'MT5 connected');
    if (data.mt5 === false) addLog('warn', 'MT5 disconnected');
  }
  if (event === 'bridge:authFailed') {
    addLog(
      'warn',
      'EA bridge rejected an unauthenticated client',
      `${data?.remoteAddress || 'unknown'} (${data?.reason || ''}) — check the EA SharedSecret input matches Settings → Connection.`
    );
  }
  if (event === 'signal:dropped') {
    addLog(
      'warn',
      `Signal dropped from offline queue (${data?.reason || 'UNKNOWN'})`,
      `${data?.signal?.type || ''} ${data?.signal?.symbol || ''}`.trim()
    );
    return;
  }
  if (event === 'trade:partialClose') {
    handlePartialCloseMessage(data);
    return;
  }
  if (event === 'mt5:hello') {
    const identity = normalizeAccountIdentity(data || {});
    if (identity.key) {
      currentMt5Account = identity;
      store.set('currentMt5Account', identity);
      upsertKnownMt5Account(identity);
      markAccountSynced(identity.key, { lastHelloAt: new Date().toISOString() });
      if (mainWindow) mainWindow.webContents.send('mt5:accountIdentity', identity);
      addLog('success', 'MT5 account connected', identity.key);
    }
    const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
    const mgmtPayload = buildManagementControlPayload(settings);
    bridgeRouter.sendControl('SETTINGS_UPDATE', mgmtPayload);
    bridgeRouter.recordSettingsUpdate(mgmtPayload);
    const nowMs = Date.now();
    // Auto-sync shortly after connection so restart/resume restores missing history.
    if ((nowMs - lastAutoSyncRequestAt) > 30000) {
      lastAutoSyncRequestAt = nowMs;
      requestMt5Sync('connect-auto');
    }
    return;
  }

  if (event === 'trade:ack') {
    const ack = data;
    if (!ack) return;
    const ackOpenedAtIso = ackTimeToIso(extractAckOpenedAtRaw(ack));
    const ackClosedAtIso = ackTimeToIso(extractAckClosedAtRaw(ack));
    if (mainWindow) {
      mainWindow.webContents.send('mt5:activity', {
        time: new Date().toISOString(),
        status: ack.status || '',
        symbol: ack?.trade?.symbol || ack?.symbol || '',
        detail: ack
      });
    }
    if (shouldLogMt5Ack(ack)) {
      addLog('info', `MT5 → APP [${ack.status || 'ACK'}]`, `${ack?.trade?.symbol || ack?.symbol || ''}`);
    }

    if (ack.status === 'ACCOUNT_SNAPSHOT') {
      const identity = getBestAccountIdentity(ack);
      if (identity.key) {
        currentMt5Account = identity;
        store.set('currentMt5Account', identity);
        upsertKnownMt5Account(identity);
        markAccountSynced(identity.key, { lastSnapshotAt: new Date().toISOString() });
        if (mainWindow) mainWindow.webContents.send('mt5:accountIdentity', identity);
      }
      mt5AccountSnapshot = {
        time: new Date().toISOString(),
        balance: toNumber(ack.balance) ?? 0,
        equity: toNumber(ack.equity) ?? 0,
        margin: toNumber(ack.margin) ?? 0,
        freeMargin: toNumber(ack.freeMargin) ?? 0,
        accountKey: identity.key || '',
        accountLogin: identity.login || '',
        accountServer: identity.server || '',
        accountName: identity.name || ''
      };
      store.set('mt5AccountSnapshot', mt5AccountSnapshot);
      try {
        drawdownGuardian.recordEquitySample(store, mt5AccountSnapshot.accountKey || identity.key, mt5AccountSnapshot);
      } catch (_) { /* noop */ }
      if (mainWindow) mainWindow.webContents.send('mt5:account', mt5AccountSnapshot);
      addLog('success', 'MT5 account snapshot updated', `Balance: ${mt5AccountSnapshot.balance.toFixed(2)}`);
      return;
    }

    // Handle trade-disabled ACKs (no tradeId) — just log
    if (ack.status === 'TRADE_DISABLED_TERMINAL') {
      addLog('error', '❌ MT5: AutoTrading is DISABLED', 'Click the "Algo Trading" button in MT5 toolbar');
      return;
    }
    if (ack.status === 'TRADE_DISABLED_EA') {
      addLog('error', '❌ MT5: EA trading not allowed', 'Right-click chart → Expert Advisors → Allow Algo Trading');
      return;
    }

    const trades = getStoredTrades();
    const trade = resolveTradeForAck(ack, trades);
    if (!trade) {
      if (ack.status === 'POSITION_UPDATE' || isClosedStatus(ack.status)) {
        const synced = upsertSyncedTradeFromAck(ack, trades);
        require('./excursionStore').applyExcursionPayload(trades, ack, { preferTrade: synced.trade });
        saveStoredTrades(trades);
        if (synced.trade?.accountKey) {
          markAccountSynced(synced.trade.accountKey, {
            lastImportedStatus: synced.trade.status || '',
            lastImportedDealId: synced.trade.mt5DealId || ''
          });
        }
        if (mainWindow) {
          const syncEvent = ack.status === 'POSITION_UPDATE' ? 'trade:update' : (synced.isNew ? 'trade:new' : 'trade:update');
          mainWindow.webContents.send(syncEvent, synced.trade);
        }        if (synced.transitionedToClosed && synced.trade) {
          void maybeRunAiCloseInsight(synced.trade);
        }
        addLog(
          synced.trade.status === 'POSITION_UPDATE' ? 'info' : 'success',
          `MT5 sync imported trade [${synced.trade.status}]`,
          `${synced.trade.symbol} ${synced.trade.profit >= 0 ? '+' : ''}${synced.trade.profit.toFixed(2)}$ (${synced.trade.origin || 'AUTO'})`
        );
        return;
      }
      addLog('warn', 'MT5 ACK could not be matched to a trade', JSON.stringify(ack).slice(0, 180));
      return;
    }

    const prevStatus = trade.status;
    const profit = extractAckProfit(ack);
    let nextStatus = normalizeTradeStatus(ack.status);
    nextStatus = refineClosedStatusFromProfit(nextStatus, profit, ack.status);
    const ackStatusUpper = String(ack.status || '').toUpperCase();
    if (ackStatusUpper === 'POSITION_UPDATE') {
      const prev = String(prevStatus || '').toUpperCase();
      if (prev === 'DISPATCHED' || prev === 'NO_MT5_QUEUED' || prev === 'SUBMITTED') {
        trade.status = 'SENT';
      }
    } else if (nextStatus !== 'POSITION_UPDATE') {
      trade.status = nextStatus;
    }
    if (ackStatusUpper.startsWith('FAILED_')) {
      trade.blockedReason = formatBrokerFailureReason(ackStatusUpper);
    } else if (ackStatusUpper === 'BLOCKED_SPREAD') {
      const sp = toNumber(ack?.spreadPips);
      const cap = toNumber(ack?.maxSpreadPips);
      trade.blockedReason = `Spread ${sp != null ? sp.toFixed(1) : '?'} pips exceeded limit ${cap != null ? cap.toFixed(1) : '?'} pips`;
    } else if (ackStatusUpper === 'BLOCKED_EA_NO_SL') {
      trade.blockedReason = 'EA safety net: signal has no valid stop loss';
    } else if (ackStatusUpper === 'BLOCKED_EA_MAX_CONCURRENT') {
      trade.blockedReason = 'EA safety net: max concurrent trades reached';
    } else if (ackStatusUpper === 'BLOCKED_EA_DAILY_LOSS') {
      trade.blockedReason = 'EA safety net: daily loss limit reached';
    } else if (trade.status === 'SENT' && ackStatusUpper === 'EXECUTED') {
      trade.blockedReason = '';
    }
    trade.lastUpdateAt = new Date().toISOString();
    mergeTradeScreenshot(trade, ack);

    // EA execution telemetry (any ACK that carries it)
    const ackSpreadPips = toNumber(ack?.spreadPips);
    if (ackSpreadPips != null) trade.spreadAtFill = ackSpreadPips;
    const ackSlippagePoints = toNumber(ack?.slippagePoints);
    if (ackSlippagePoints != null) trade.slippagePoints = ackSlippagePoints;
    // Multi-TP split: per-TP sub-orders for the UI
    if (Array.isArray(ack?.ordersDetail) && ack.ordersDetail.length > 0) {
      trade.subOrders = ack.ordersDetail.map((o) => ({
        lot: toNumber(o?.lot) ?? 0,
        tp: toNumber(o?.tp) ?? 0,
        ...(cleanBrokerId(o?.positionId) ? { positionId: cleanBrokerId(o.positionId) } : {}),
        ...(cleanBrokerId(o?.orderId) ? { orderId: cleanBrokerId(o.orderId) } : {}),
        ...(cleanBrokerId(o?.dealId) ? { dealId: cleanBrokerId(o.dealId) } : {})
      }));
    }

    if (profit !== null) trade.profit = profit;

    const ackEntry = toNumber(ack?.trade?.entry);
    const ackSl = toNumber(ack?.trade?.sl);
    const ackTp = toNumber(ack?.trade?.tp);
    const ackLot = toNumber(ack?.trade?.lot);
    if (ackStatusUpper === 'POSITION_UPDATE' || ackStatusUpper === 'EXECUTED') {
      applyAckExecToTrade(trade, {
        entry: ackEntry,
        sl: ackSl,
        tp: ackTp,
        lot: ackLot
      });
    }

    const pid = cleanBrokerId(ack?.positionId ?? ack?.trade?.positionId);
    const did = cleanBrokerId(ack?.dealId ?? ack?.trade?.dealId);
    if (pid) trade.mt5PositionId = pid;
    if (did) trade.mt5DealId = did;
    require('./excursionStore').applyExcursionPayload(trades, ack, { preferTrade: trade });

    const explicitT = cleanBrokerId(ack?.ticket ?? ack?.trade?.ticket);
    if (explicitT) {
      trade.mt5Ticket = explicitT;
    } else {
      const bs = getAckBrokerIdSet(ack);
      if (ackStatusUpper === 'POSITION_UPDATE' && pid) {
        trade.mt5Ticket = pid;
      } else if (bs.size === 1) {
        trade.mt5Ticket = [...bs][0];
      } else if (bs.size > 0 && !cleanBrokerId(trade.mt5Ticket)) {
        trade.mt5Ticket = [...bs][0];
      }
    }
    if (ackStatusUpper === 'PENDING_PLACED') {
      if (ack.pendingOrders) {
        trade.mt5PendingOrderTickets = String(ack.pendingOrders)
          .split(',')
          .map((x) => String(x).trim())
          .filter(Boolean);
      } else if (ack.orderId) {
        trade.mt5PendingOrderTickets = [String(ack.orderId)];
      }
    }
    if (ack?.origin) trade.origin = String(ack.origin).toUpperCase() === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const account = getBestAccountIdentity(ack);
    if (account.key) {
      trade.accountKey = account.key;
      trade.accountLogin = account.login;
      trade.accountServer = account.server;
      trade.accountName = account.name;
    }
    if (ackOpenedAtIso) {
      const explicitOpenTs = toNumber(ack?.trade?.openedAtTs ?? ack?.openedAtTs);
      const currentOpenedMs = new Date(trade.openedAt || '').getTime();
      const nextOpenedMs = new Date(ackOpenedAtIso).getTime();
      const takeOpen =
        (explicitOpenTs != null && explicitOpenTs > 0)
        || !Number.isFinite(currentOpenedMs)
        || (Number.isFinite(nextOpenedMs) && nextOpenedMs < currentOpenedMs);
      if (takeOpen) {
        trade.openedAt = ackOpenedAtIso;
      }
      if (!trade.time || String(trade.time).trim().length <= 8) {
        trade.time = isoToClock(trade.openedAt || ackOpenedAtIso) || trade.time || new Date().toTimeString().slice(0, 8);
      }
    }

    if (isClosedStatus(ack.status)) {
      trade.closedAt = ackClosedAtIso || trade.closedAt || new Date().toISOString();
      trade.closeTime = isoToClock(trade.closedAt) || new Date().toTimeString().slice(0, 8);
    }

    if (
      trade.fromTelegramSignal
      && (ackStatusUpper === 'EXECUTED' || ackStatusUpper === 'POSITION_UPDATE')
      && isAckMatchableOpenStatus(trade.status)
    ) {
      collapseDuplicateSignalTrades(trades, trade);
      const dup = collapseMt5SyncDuplicate(trades, trade);
      notifyTradesRemovedFromUi(dup.removedIds);
    }

    saveStoredTrades(trades);
    if (trade?.accountKey) {
      markAccountSynced(trade.accountKey, {
        lastImportedStatus: trade.status || '',
        lastImportedDealId: trade.mt5DealId || ''
      });
    }
    if (mainWindow) mainWindow.webContents.send('trade:update', trade);
    const transitionedToClosed = isClosedStatus(trade.status) && !isClosedStatus(prevStatus);
    if (transitionedToClosed) {
      maybeSetRealizedR(trade);
      void maybeRunAiCloseInsight(trade);
    }

    const lvl = trade.status.startsWith('FAILED') ? 'error' : 'success';
    addLog(lvl, `MT5 ACK [${trade.status}]: ${trade.type} ${trade.symbol}`,
           `was ${prevStatus}`);
  }
}

function ensureTcpBridgeStarted() {
  if (tcpBridgeStarted) return;
  tcpBridgeStarted = true;
  const bridgeSettings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const listenPort = resolveTcpListenPort(bridgeSettings);
  const bindHost = bridgeSettings.tcpBindHost || '127.0.0.1';
  const eaSharedSecret = String(bridgeSettings.eaSharedSecret || '').trim();
  const isLoopback = bindHost === '127.0.0.1' || bindHost === '::1' || bindHost === 'localhost';
  if (!isLoopback && !eaSharedSecret) {
    addLog(
      'warn',
      `EA bridge exposed on ${bindHost}:${listenPort} WITHOUT authentication`,
      'Anyone on the network can read signals and spoof the EA. Set an EA shared secret in Settings → Connection, or bind to 127.0.0.1.'
    );
    sendDesktopNotification(
      'EA bridge exposed on network',
      `The EA port ${listenPort} is reachable from the network without authentication. Set an EA shared secret or bind to 127.0.0.1.`,
      'tcp-bridge:unsafe-bind',
      30 * 60 * 1000
    );
  }
  bridgeRouter.start(handleTcpBridgeEvent, {
    bindHost,
    port: listenPort,
    queueTtlMs: Number(bridgeSettings.queueTtlMs) > 0 ? Number(bridgeSettings.queueTtlMs) : 120000,
    sharedSecret: eaSharedSecret
  });
  configureCloudBridgeFromSettings();
  if (!dispatchWatchTimer) {
    dispatchWatchTimer = setInterval(() => tickStaleDispatchTrades(), 30000);
  }
  addLog('info', 'TCP bridge listening', `Port ${listenPort} for MT4/MT5 EA (runs whenever Trade Station is open).`);
}

/** Shared folder file bridge for branded MT4 that blocks Winsock (WSA 10051). Same absolute path as MT4 MQL4/Files/subfolder. */
function configureMt4FileBridgeFromSettings(settings) {
  const dir = typeof settings?.mt4FileBridgeDir === 'string' ? settings.mt4FileBridgeDir.trim() : '';
  if (!dir) {
    mt4FileBridge.stop();
    return;
  }
  try {
    mt4FileBridge.start(dir, tcpBridge);
    addLog('info', 'MT4 file bridge folder', dir);
  } catch (e) {
    addLog('error', 'MT4 file bridge failed', e.message || String(e));
    mt4FileBridge.stop();
  }
}

function ensureLicensedServicesStarted() {
  if (servicesStarted) return;
  servicesStarted = true;
  startNewsGuardMonitor();
  addLog('success', 'Services started', 'Trading services ready');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId(APP_INSTANCE.isNamedInstance ? `TradeStation.${APP_INSTANCE.id}` : 'TradeStation');

  seedNamedInstanceDefaults();

  // safeStorage requires app ready before isEncryptionAvailable() can be queried.
  let secretsEncryptionAvailable = false;
  try {
    secretsEncryptionAvailable = secretsVault.init();
    secretsVault.migrateKnownSecrets(store);
  } catch (e) {
    console.warn('[secretsVault] init/migrate failed:', e?.message || e);
  }

  // Window paints ASAP; heavy startup yields so Windows stays responsive ("Ne répond pas").
  createWindow();

  currentMt5Account = store.get('currentMt5Account', null);
  mt5AccountSnapshot = store.get('mt5AccountSnapshot', null);
  if (currentMt5Account?.key) upsertKnownMt5Account(currentMt5Account);

  migrateStoreData(store);
  purgeLegacyLicenseQaStoreKeys();
  const tradeMigration = tradeStore.migrateFromLegacyIfNeeded();

  refreshLicenseState();

  function finishWarmStartup() {
    setTimeout(() => {
      seedKnownMt5AccountsFromTrades();
    }, 400);

    addLog('info', 'TradeSync started', `v${app.getVersion?.() || '?'} | pid ${process.pid}`);
    if (!secretsEncryptionAvailable) {
      addLog(
        'warn',
        'OS secret encryption unavailable — secrets stored in plaintext',
        'Telegram session, license token and broker passwords are not encrypted at rest on this machine.'
      );
    }
    if (APP_INSTANCE.isNamedInstance) {
      addLog('info', 'Named instance profile', `${APP_INSTANCE.label || APP_INSTANCE.id} (EA port ${resolveTcpListenPort(store.get('settings', getDefaultSettings()))})`);
    }
    if (store?.dataRoot) addLog('info', 'Persistent data folder', store.dataRoot);
    if (tradeStore?.accountsRoot) addLog('info', 'Per-account trades folder', tradeStore.accountsRoot);

    // Auto-update: only attempt in packaged builds; dev runs skip silently.
    if (app.isPackaged && process.env.NODE_ENV !== 'dev' && !TRADE_STATION_E2E) {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on('update-available', (info) => addLog('info', 'Update available', `v${info?.version || '?'}`));
        autoUpdater.on('update-downloaded', (info) => {
          addLog('success', `Update downloaded — install on next quit (v${info?.version || '?'})`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:updateReady', { version: info?.version || '' });
          }
        });
        autoUpdater.on('error', (err) => addLog('warn', 'Updater error', err?.message || String(err)));
        autoUpdater.checkForUpdates().catch((err) => addLog('warn', 'Update check failed', err?.message || String(err)));
        // Background re-check every 6h
        setInterval(() => {
          autoUpdater.checkForUpdates().catch(() => {});
        }, 6 * 60 * 60 * 1000);
      } catch (updErr) {
        addLog('warn', 'electron-updater not available', updErr?.message || String(updErr));
      }
    }
    if (tradeMigration?.migrated) {
      addLog('success', 'Migrated legacy trades to per-account files', String(tradeMigration.count || 0));
    }

    ensureTcpBridgeStarted();
    configureMt4FileBridgeFromSettings(normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings())));

    ensureLicensedServicesStarted();
    startListening();

    scheduleDailyReportAfterEodLoop();
    scheduleWeeklyReportLoop();
    scheduleMonthlyReportLoop();
    setTimeout(() => { void maybeCatchUpMissedReports(); }, 8000);
  }

  setImmediate(finishWarmStartup);
});

app.on('second-instance', () => {
  if (APP_INSTANCE.isNamedInstance) return;
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (newsGuardTimer) clearInterval(newsGuardTimer);
  if (licenseWatchTimer) {
    clearInterval(licenseWatchTimer);
    licenseWatchTimer = null;
  }
  if (dailyReportEodTimer) {
    try {
      clearTimeout(dailyReportEodTimer);
    } catch (_) {
      /* noop */
    }
    dailyReportEodTimer = null;
  }
  if (weeklyReportTimer) {
    try {
      clearTimeout(weeklyReportTimer);
    } catch (_) {
      /* noop */
    }
    weeklyReportTimer = null;
  }
  if (monthlyReportTimer) {
    try {
      clearTimeout(monthlyReportTimer);
    } catch (_) {
      /* noop */
    }
    monthlyReportTimer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (licenseWatchTimer) {
    clearInterval(licenseWatchTimer);
    licenseWatchTimer = null;
  }
  if (dailyReportEodTimer) {
    try {
      clearTimeout(dailyReportEodTimer);
    } catch (_) {
      /* noop */
    }
    dailyReportEodTimer = null;
  }
  if (weeklyReportTimer) {
    try {
      clearTimeout(weeklyReportTimer);
    } catch (_) {
      /* noop */
    }
    weeklyReportTimer = null;
  }
  if (monthlyReportTimer) {
    try {
      clearTimeout(monthlyReportTimer);
    } catch (_) {
      /* noop */
    }
    monthlyReportTimer = null;
  }
  fileLogger.writeEntry({ level: 'info', message: 'App quitting' });
  fileLogger.shutdown();
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error
    ? `${reason.message}\n${(reason.stack || '').slice(0, 600)}`
    : String(reason).slice(0, 400);
  try {
    addLog('error', 'Unhandled promise rejection', message);
  } catch (_) {
    fileLogger.writeEntry({ level: 'error', message: 'Unhandled promise rejection', detail: message });
    console.error('[unhandledRejection]', message);
  }
});

process.on('uncaughtException', (err) => {
  const message = err instanceof Error
    ? `${err.message}\n${(err.stack || '').slice(0, 600)}`
    : String(err).slice(0, 400);
  try {
    addLog('error', 'Uncaught main exception', message);
  } catch (_) {
    fileLogger.writeEntry({ level: 'error', message: 'Uncaught main exception', detail: message });
    console.error('[uncaughtException]', message);
  }
});

// ─── Telegram IPC Handlers ───────────────────────────────────────────────────

ipcMain.handle('telegram:checkSession', ensureLicensed(async () => {
  const result = await telegramClient.checkSession();
  if (result.authenticated) {
    addLog('success', 'Telegram session restored', result.user?.phone || '');
    startListening();
  } else {
    addLog('info', 'No active Telegram session');
  }
  return result;
}));

ipcMain.handle('telegram:sendCode', ensureLicensed(async (_, phone) => {
  return await telegramClient.sendCode(phone);
}));

ipcMain.handle('telegram:signIn', ensureLicensed(async (_, phone, phoneCodeHash, code) => {
  const result = await telegramClient.signIn(phone, phoneCodeHash, code);
  if (result.success) {
    addLog('success', 'Telegram signed in', phone);
    startListening();
  } else {
    addLog('error', 'Telegram sign-in failed', result.error || '');
  }
  return result;
}));

ipcMain.handle('telegram:signInWith2FA', ensureLicensed(async (_, password) => {
  const result = await telegramClient.signInWith2FA(password);
  if (result.success) {
    addLog('success', 'Telegram 2FA passed');
    startListening();
  } else {
    addLog('error', 'Telegram 2FA failed');
  }
  return result;
}));

ipcMain.handle('telegram:signOut', ensureLicensed(async () => {
  await telegramClient.signOut();
  addLog('info', 'Telegram signed out');
  return { success: true };
}));

ipcMain.handle('telegram:getChannels', ensureLicensed(async (_e, opts = {}) => {
  return await telegramClient.getChannels(opts);
}));

ipcMain.handle('telegram:reconnect', ensureLicensed(async () => {
  const result = await telegramClient.reconnect();
  if (mainWindow) {
    mainWindow.webContents.send('connection:status', {
      telegram: !!result?.authenticated,
      mt5: !!bridgeRouter.getStatus()?.connected
    });
  }
  return result;
}));

ipcMain.handle('telegram:enableChannel', ensureLicensed(async (_, channelId, enabled) => {
  const channels = store.get('enabledChannels', []);
  if (enabled && !channels.includes(channelId)) {
    channels.push(channelId);
  } else if (!enabled) {
    const idx = channels.indexOf(channelId);
    if (idx > -1) channels.splice(idx, 1);
  }
  store.set('enabledChannels', channels);
  return { success: true };
}));

ipcMain.handle('telegram:getEnabledChannels', ensureLicensed(async () => {
  return store.get('enabledChannels', []);
}));

/** Monday 00:00 local of the ISO week containing `date` (week runs Mon–Sun). */
function mondayOfWeekContaining(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Mon 00:00 through `now` end-of-day (manual weekly) or through Sunday (scheduled). */
function weekBoundsForDate(now, throughSunday = false) {
  const monday = mondayOfWeekContaining(now);
  let weekEnd;
  if (throughSunday) {
    weekEnd = new Date(monday);
    weekEnd.setDate(monday.getDate() + 6);
  } else {
    weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  weekEnd.setHours(23, 59, 59, 999);
  return { monday, weekStartMs: monday.getTime(), weekEndMs: weekEnd.getTime() };
}

const REPORT_RETRY_MS = 15 * 60 * 1000;
/** Node clamps setTimeout delays above 2^31-1 ms to 1ms — chunk long report waits. */
const MAX_TIMEOUT_MS = 2147483647;

async function deliverTelegramPerformanceMessage(channelId, message) {
  try {
    const telegram = require('./telegramClient');
    const tgClient = await telegram.getClient();
    let targetEntity;
    if (channelId === 'me') {
      const me = await tgClient.getMe();
      targetEntity = me.id;
    } else {
      targetEntity = BigInt(channelId);
    }
    await tgClient.sendMessage(targetEntity, { message });
    return { success: true };
  } catch (e) {
    console.error('[TelegramReport] send error:', e.message);
    return { success: false, error: e.message };
  }
}

async function sendTelegramPerformanceReport(channelId, periodClosedTrades, headerLines) {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const reportSettings = store.get('dailyReportSettings', {
    includePnl: true,
    includeWinRate: true,
    includeDrawdown: true,
    includeOpenCount: true,
    includeTrades: true,
    includeTopPerformers: true,
    includeOutcomes: true,
  });
  const allTrades = getStoredTrades();
  const message = buildPerformanceReportLines(
    periodClosedTrades,
    allTrades,
    reportSettings,
    headerLines,
    { breakEvenAmount: settings.analyticsBreakEvenAmount }
  );
  return deliverTelegramPerformanceMessage(channelId, message);
}

function msUntilNextDailyReportAfterEodMs(settingsRaw) {
  const merged = normalizeSettingsSymbolMappings(settingsRaw || store.get('settings', getDefaultSettings()));
  if (!merged.dailyReportAutoAfterEod) return null;
  const delayMins = merged.dailyReportAfterEodMinutes;
  const t = normalizeEndOfDayCloseTime(merged.endOfDayCloseTime);
  const parts = t.split(':');
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  target = new Date(target.getTime() + delayMins * 60 * 1000);
  if (target.getTime() < now.getTime()) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }
  return Math.max(1, target.getTime() - now.getTime());
}

function scheduleDailyReportAfterEodLoop() {
  if (dailyReportEodTimer) {
    try {
      clearTimeout(dailyReportEodTimer);
    } catch (_) {
      /* noop */
    }
    dailyReportEodTimer = null;
  }
  const ms = msUntilNextDailyReportAfterEodMs(store.get('settings', getDefaultSettings()));
  if (ms == null || !Number.isFinite(ms)) {
    return;
  }
  /** Never skip: previously `ms < 5000` dropped the timer so no daily report ran until restart. */
  const delayMs = Math.max(1, ms);
  // Node setTimeout clamps delays > 2^31-1 ms (~24.8 days) to 1ms, which would
  // spin this loop. Sleep a chunk and recompute instead.
  if (delayMs > MAX_TIMEOUT_MS) {
    dailyReportEodTimer = setTimeout(() => {
      dailyReportEodTimer = null;
      scheduleDailyReportAfterEodLoop();
    }, MAX_TIMEOUT_MS);
    return;
  }
  dailyReportEodTimer = setTimeout(() => {
    dailyReportEodTimer = null;
    void (async () => {
      const settingsNow = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
      if (!settingsNow.dailyReportAutoAfterEod) {
        scheduleDailyReportAfterEodLoop();
        return;
      }
      if (!licenseState?.licensed) {
        scheduleDailyReportAfterEodLoop();
        return;
      }
      const ch = String(store.get('dailyReportTelegramTarget', 'me') || 'me');
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const allTrades = getStoredTrades();
      const dayClosed = tradesClosedBetween(allTrades, dayStart.getTime(), dayEnd.getTime());
      const result = await sendTelegramPerformanceReport(ch, dayClosed, [
        '📊 *Trade Station Daily Report*',
        `*Date:* ${now.toLocaleDateString()}`
      ]);
      if (!result.success) {
        addLog('warn', 'Daily Telegram report failed', String(result.error || 'unknown'));
        console.error('[DailyReport] scheduled send failed:', result.error);
      } else {
        addLog('success', 'Daily Telegram report sent', ch === 'me' ? 'Saved Messages' : `channel ${ch}`);
      }
      scheduleDailyReportAfterEodLoop();
    })();
  }, delayMs);
}

function msUntilNextSundayAfterEodMs(settingsRaw) {
  const merged = normalizeSettingsSymbolMappings(settingsRaw || store.get('settings', getDefaultSettings()));
  if (!merged.weeklyReportAutoEndOfWeek) return null;
  const delayMins = merged.dailyReportAfterEodMinutes;
  const t = normalizeEndOfDayCloseTime(merged.endOfDayCloseTime);
  const parts = t.split(':');
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const nowMs = Date.now();
  const base = new Date();
  for (let add = 0; add <= 21; add++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add);
    if (d.getDay() !== 0) continue;
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
    target.setTime(target.getTime() + delayMins * 60 * 1000);
    const delta = target.getTime() - nowMs;
    if (delta >= 0) return Math.max(1, delta);
  }
  return null;
}

function scheduleWeeklyReportRetryOrLoop(sentKey, attemptSend) {
  const now = new Date();
  const stillSunday = now.getDay() === 0;
  const alreadySent = store.get('lastWeeklyReportSentKey', '') === sentKey;
  if (!alreadySent && stillSunday) {
    weeklyReportTimer = setTimeout(() => {
      weeklyReportTimer = null;
      void attemptSend();
    }, REPORT_RETRY_MS);
    return;
  }
  scheduleWeeklyReportLoop();
}

function scheduleMonthlyReportRetryOrLoop(ym, attemptSend) {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const lastDom = new Date(y, mo + 1, 0).getDate();
  const stillMonthEnd = now.getDate() === lastDom;
  const alreadySent = store.get('lastMonthlyReportSentYm', '') === ym;
  if (!alreadySent && stillMonthEnd) {
    monthlyReportTimer = setTimeout(() => {
      monthlyReportTimer = null;
      void attemptSend();
    }, REPORT_RETRY_MS);
    return;
  }
  scheduleMonthlyReportLoop();
}

async function runScheduledWeeklyReportSend() {
  const settingsNow = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  if (!settingsNow.weeklyReportAutoEndOfWeek) {
    scheduleWeeklyReportLoop();
    return;
  }
  if (!licenseState?.licensed) {
    scheduleWeeklyReportLoop();
    return;
  }
  const now = new Date();
  if (now.getDay() !== 0) {
    scheduleWeeklyReportLoop();
    return;
  }
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const sentKey = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
  if (store.get('lastWeeklyReportSentKey', '') === sentKey) {
    scheduleWeeklyReportLoop();
    return;
  }
  const { monday, weekStartMs, weekEndMs } = weekBoundsForDate(now, true);
  const allTrades = getStoredTrades();
  const weekClosed = tradesClosedBetween(allTrades, weekStartMs, weekEndMs);
  const ch = String(store.get('dailyReportTelegramTarget', 'me') || 'me');
  const result = await sendTelegramPerformanceReport(ch, weekClosed, [
    '📊 *Trade Station Weekly Report*',
    `*Week:* ${monday.toLocaleDateString()} – ${sunday.toLocaleDateString()}`
  ]);
  if (result.success) {
    store.set('lastWeeklyReportSentKey', sentKey);
    addLog('success', 'Weekly Telegram report sent', ch === 'me' ? 'Saved Messages' : `channel ${ch}`);
    scheduleWeeklyReportLoop();
    return;
  }
  addLog('warn', 'Weekly Telegram report failed', String(result.error || 'unknown'));
  console.error('[WeeklyReport] scheduled send failed:', result.error);
  scheduleWeeklyReportRetryOrLoop(sentKey, runScheduledWeeklyReportSend);
}

async function runScheduledMonthlyReportSend() {
  const settingsNow = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  if (!settingsNow.monthlyReportAutoEndOfMonth) {
    scheduleMonthlyReportLoop();
    return;
  }
  if (!licenseState?.licensed) {
    scheduleMonthlyReportLoop();
    return;
  }
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const lastDom = new Date(y, mo + 1, 0).getDate();
  if (now.getDate() !== lastDom) {
    scheduleMonthlyReportLoop();
    return;
  }
  const ym = `${y}-${String(mo + 1).padStart(2, '0')}`;
  if (store.get('lastMonthlyReportSentYm', '') === ym) {
    scheduleMonthlyReportLoop();
    return;
  }
  const monthStartMs = new Date(y, mo, 1).getTime();
  const monthEndMs = new Date(y, mo, lastDom, 23, 59, 59, 999).getTime();
  const allTrades = getStoredTrades();
  const monthClosed = tradesClosedBetween(allTrades, monthStartMs, monthEndMs);
  const monthLabel = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const ch = String(store.get('dailyReportTelegramTarget', 'me') || 'me');
  const result = await sendTelegramPerformanceReport(ch, monthClosed, [
    '📊 *Trade Station Monthly Report*',
    `*Month:* ${monthLabel}`
  ]);
  if (result.success) {
    store.set('lastMonthlyReportSentYm', ym);
    addLog('success', 'Monthly Telegram report sent', ch === 'me' ? 'Saved Messages' : `channel ${ch}`);
    scheduleMonthlyReportLoop();
    return;
  }
  addLog('warn', 'Monthly Telegram report failed', String(result.error || 'unknown'));
  console.error('[MonthlyReport] scheduled send failed:', result.error);
  scheduleMonthlyReportRetryOrLoop(ym, runScheduledMonthlyReportSend);
}

function scheduleWeeklyReportLoop() {
  if (weeklyReportTimer) {
    try {
      clearTimeout(weeklyReportTimer);
    } catch (_) {
      /* noop */
    }
    weeklyReportTimer = null;
  }
  const ms = msUntilNextSundayAfterEodMs(store.get('settings', getDefaultSettings()));
  if (ms == null || !Number.isFinite(ms)) {
    return;
  }
  const delayMs = Math.max(1, ms);
  if (delayMs > MAX_TIMEOUT_MS) {
    weeklyReportTimer = setTimeout(() => {
      weeklyReportTimer = null;
      scheduleWeeklyReportLoop();
    }, MAX_TIMEOUT_MS);
    return;
  }
  weeklyReportTimer = setTimeout(() => {
    weeklyReportTimer = null;
    void runScheduledWeeklyReportSend();
  }, delayMs);
}

function msUntilNextMonthEndAfterEodMs(settingsRaw) {
  const merged = normalizeSettingsSymbolMappings(settingsRaw || store.get('settings', getDefaultSettings()));
  if (!merged.monthlyReportAutoEndOfMonth) return null;
  const delayMins = merged.dailyReportAfterEodMinutes;
  const t = normalizeEndOfDayCloseTime(merged.endOfDayCloseTime);
  const parts = t.split(':');
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const nowMs = Date.now();
  const start = new Date();
  for (let add = 0; add < 400; add++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + add);
    const y = d.getFullYear();
    const mo = d.getMonth();
    const lastDom = new Date(y, mo + 1, 0).getDate();
    if (d.getDate() !== lastDom) continue;
    const target = new Date(y, mo, lastDom, hh, mm, 0, 0);
    target.setTime(target.getTime() + delayMins * 60 * 1000);
    const delta = target.getTime() - nowMs;
    if (delta >= 0) return Math.max(1, delta);
  }
  return null;
}

function scheduleMonthlyReportLoop() {
  if (monthlyReportTimer) {
    try {
      clearTimeout(monthlyReportTimer);
    } catch (_) {
      /* noop */
    }
    monthlyReportTimer = null;
  }
  const ms = msUntilNextMonthEndAfterEodMs(store.get('settings', getDefaultSettings()));
  if (ms == null || !Number.isFinite(ms)) {
    return;
  }
  const delayMs = Math.max(1, ms);
  if (delayMs > MAX_TIMEOUT_MS) {
    monthlyReportTimer = setTimeout(() => {
      monthlyReportTimer = null;
      scheduleMonthlyReportLoop();
    }, MAX_TIMEOUT_MS);
    return;
  }
  monthlyReportTimer = setTimeout(() => {
    monthlyReportTimer = null;
    void runScheduledMonthlyReportSend();
  }, delayMs);
}

async function maybeCatchUpMissedReports() {
  const settingsNow = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  if (!licenseState?.licensed) return;

  const now = new Date();
  const ch = String(store.get('dailyReportTelegramTarget', 'me') || 'me');

  if (settingsNow.weeklyReportAutoEndOfWeek && now.getDay() !== 0) {
    const lastSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const sentKey = `${lastSunday.getFullYear()}-${String(lastSunday.getMonth() + 1).padStart(2, '0')}-${String(lastSunday.getDate()).padStart(2, '0')}`;
    if (store.get('lastWeeklyReportSentKey', '') !== sentKey) {
      const { monday, weekStartMs, weekEndMs } = weekBoundsForDate(lastSunday, true);
      const weekClosed = tradesClosedBetween(getStoredTrades(), weekStartMs, weekEndMs);
      const result = await sendTelegramPerformanceReport(ch, weekClosed, [
        '📊 *Trade Station Weekly Report*',
        `*Week:* ${monday.toLocaleDateString()} – ${lastSunday.toLocaleDateString()} (catch-up)`
      ]);
      if (result.success) {
        store.set('lastWeeklyReportSentKey', sentKey);
        addLog('success', 'Weekly catch-up report sent', sentKey);
      }
    }
  }

  if (settingsNow.monthlyReportAutoEndOfMonth && now.getDate() <= 3) {
    const prevMo = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const ym = `${prevY}-${String(prevMo + 1).padStart(2, '0')}`;
    if (store.get('lastMonthlyReportSentYm', '') !== ym) {
      const lastDom = new Date(prevY, prevMo + 1, 0).getDate();
      const monthStartMs = new Date(prevY, prevMo, 1).getTime();
      const monthEndMs = new Date(prevY, prevMo, lastDom, 23, 59, 59, 999).getTime();
      const monthClosed = tradesClosedBetween(getStoredTrades(), monthStartMs, monthEndMs);
      const monthLabel = new Date(prevY, prevMo, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
      const result = await sendTelegramPerformanceReport(ch, monthClosed, [
        '📊 *Trade Station Monthly Report*',
        `*Month:* ${monthLabel} (catch-up)`
      ]);
      if (result.success) {
        store.set('lastMonthlyReportSentYm', ym);
        addLog('success', 'Monthly catch-up report sent', ym);
      }
    }
  }
}

async function sendDailyReportToTelegram(channelId = 'me') {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const dayClosed = tradesClosedBetween(getStoredTrades(), dayStart.getTime(), dayEnd.getTime());
  return sendTelegramPerformanceReport(channelId, dayClosed, [
    '📊 *Trade Station Daily Report*',
    `*Date:* ${now.toLocaleDateString()}`
  ]);
}

async function sendWeeklyReportToTelegram(channelId = 'me') {
  const now = new Date();
  const { monday, weekStartMs, weekEndMs } = weekBoundsForDate(now, false);
  const weekEndDate = new Date(weekEndMs);
  const weekClosed = tradesClosedBetween(getStoredTrades(), weekStartMs, weekEndMs);
  return sendTelegramPerformanceReport(channelId, weekClosed, [
    '📊 *Trade Station Weekly Report*',
    `*Week:* ${monday.toLocaleDateString()} – ${weekEndDate.toLocaleDateString()}`
  ]);
}

async function sendMonthlyReportToTelegram(channelId = 'me') {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const lastDom = new Date(y, mo + 1, 0).getDate();
  const monthStartMs = new Date(y, mo, 1).getTime();
  const monthEndMs = new Date(y, mo, lastDom, 23, 59, 59, 999).getTime();
  const monthClosed = tradesClosedBetween(getStoredTrades(), monthStartMs, monthEndMs);
  const monthLabel = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  return sendTelegramPerformanceReport(channelId, monthClosed, [
    '📊 *Trade Station Monthly Report*',
    `*Month:* ${monthLabel}`
  ]);
}

ipcMain.handle('telegram:sendDailyReport', ensureLicensed(async (_, channelId = 'me') => {
  return sendDailyReportToTelegram(channelId);
}));

ipcMain.handle('telegram:sendWeeklyReport', ensureLicensed(async (_, channelId = 'me') => {
  return sendWeeklyReportToTelegram(channelId);
}));

ipcMain.handle('telegram:sendMonthlyReport', ensureLicensed(async (_, channelId = 'me') => {
  return sendMonthlyReportToTelegram(channelId);
}));

ipcMain.handle('telegram:getDailyReportTarget', ensureLicensed(async () => {
  return { target: String(store.get('dailyReportTelegramTarget', 'me') || 'me') };
}));

ipcMain.handle('telegram:setDailyReportTarget', ensureLicensed(async (_, target = 'me') => {
  const t = target === 'me' || target == null || target === '' ? 'me' : String(target);
  store.set('dailyReportTelegramTarget', t);
  scheduleDailyReportAfterEodLoop();
  scheduleWeeklyReportLoop();
  scheduleMonthlyReportLoop();
  return { success: true, target: t };
}));

ipcMain.handle('telegram:getReportSettings', ensureLicensed(async () => {
  return store.get('dailyReportSettings', {
    includePnl: true,
    includeWinRate: true,
    includeDrawdown: true,
    includeOpenCount: true,
    includeTrades: true,
    includeTopPerformers: true,
    includeOutcomes: true,
  });
}));

ipcMain.handle('telegram:saveReportSettings', ensureLicensed(async (_, settings) => {
  store.set('dailyReportSettings', settings);
  return { success: true };
}));

ipcMain.handle('parser:debugMessage', ensureLicensed(async (_, { text, settings: settingsOverride, channel } = {}) => {
  const settings = normalizeSettingsSymbolMappings(settingsOverride || store.get('settings', getDefaultSettings()));
  return debugParseTelegramMessage(text, settings, channel || 'Parser Debugger');
}));

ipcMain.handle('audit:runDataIntegrity', ensureLicensed(async () => {
  return runDataIntegrityAudit(getStoredTrades(), mt5AccountSnapshot || store.get('mt5AccountSnapshot', null));
}));

ipcMain.handle('analytics:monteCarlo', ensureLicensed(async (_, opts = {}) => {
  const closed = getStoredTrades().filter((t) => {
    const s = String(t?.status || '').toUpperCase();
    return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || t?.closeTime;
  });
  const pnls = closed.map((t) => Number(t.profit || 0)).filter((n) => Number.isFinite(n));
  return runMonteCarloSimulation(pnls, Number(opts?.iterations) || 1000);
}));

ipcMain.handle('analytics:underwaterSeries', ensureLicensed(async () => {
  const closed = getStoredTrades()
    .filter((t) => {
      const s = String(t?.status || '').toUpperCase();
      return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || t?.closeTime;
    })
    .sort((a, b) => new Date(a.closeTime || a.closedAt || 0) - new Date(b.closeTime || b.closedAt || 0));
  return buildUnderwaterSeries(closed);
}));

ipcMain.handle('bridge:getEaHealth', ensureLicensed(async () => {
  const health = bridgeRouter.getEaHealth();
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const currentHash = (() => {
    try {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(JSON.stringify(buildManagementControlPayload(settings))).digest('hex').slice(0, 12);
    } catch (_) {
      return '';
    }
  })();
  return {
    ...health,
    expectedSettingsHash: currentHash,
    settingsMismatch: health.settingsHash && currentHash && health.settingsHash !== currentHash,
  };
}));

ipcMain.handle('bridge:forceSettingsUpdate', ensureLicensed(async () => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const payload = buildManagementControlPayload(settings);
  const ok = bridgeRouter.sendControl('SETTINGS_UPDATE', payload);
  if (ok !== false) bridgeRouter.recordSettingsUpdate(payload);
  return { success: ok !== false };
}));

/** EA setup diagnostic checklist for the Connections page. */
ipcMain.handle('bridge:runEaDiagnostic', ensureLicensed(async (_evt, opts = {}) => {
  const status = bridgeRouter.getStatus();
  const health = bridgeRouter.getEaHealth();
  const checks = [];

  checks.push({
    id: 'bridge-listening',
    label: 'Bridge listening',
    ok: Number.isInteger(status.port) && status.port > 0,
    detail: status.port ? `${status.bindHost}:${status.port}${status.authRequired ? ' (auth required)' : ''}` : 'Not listening',
    hint: status.port ? '' : 'Restart the app; check the port is not used by another program.'
  });

  const connected = !!status.connected;
  checks.push({
    id: 'ea-connected',
    label: 'EA connected (HELLO handshake)',
    ok: connected,
    detail: connected ? 'Connected' : 'No EA connection',
    hint: connected
      ? ''
      : 'Attach SignalCopierEA to any chart in MetaTrader 5, allow "Algo Trading", and make sure the EA ServerPort input matches the app port.'
  });

  checks.push({
    id: 'heartbeat',
    label: 'EA heartbeat fresh',
    ok: connected && !health.heartbeatStale,
    detail: health.lastHeartbeatAgeSec != null ? `Last heartbeat ${health.lastHeartbeatAgeSec}s ago` : 'No heartbeat yet',
    hint: connected && health.heartbeatStale ? 'Connection may be dead — restart the EA or MetaTrader.' : ''
  });

  let diag = null;
  if (connected) {
    diag = await bridgeRouter.requestEaDiagnostic({ symbol: String(opts.symbol || 'EURUSD') }, 6000);
    if (diag?.success) {
      checks.push({
        id: 'algo-trading',
        label: 'Algo Trading enabled (terminal)',
        ok: diag.terminalTradeAllowed === true,
        detail: diag.terminalTradeAllowed ? 'Enabled' : 'Disabled',
        hint: diag.terminalTradeAllowed ? '' : 'Click the "Algo Trading" button in the MetaTrader toolbar.'
      });
      checks.push({
        id: 'ea-trade-permission',
        label: 'EA trade permission',
        ok: diag.eaTradeAllowed === true,
        detail: diag.eaTradeAllowed ? 'Allowed' : 'Blocked',
        hint: diag.eaTradeAllowed ? '' : 'Right-click the chart → Expert Advisors → tick "Allow Algo Trading".'
      });
      checks.push({
        id: 'account-trading',
        label: 'Account allows trading',
        ok: diag.accountTradeAllowed === true,
        detail: diag.accountTradeAllowed ? 'Allowed' : 'Restricted',
        hint: diag.accountTradeAllowed ? '' : 'Possibly logged in with the investor (read-only) password or a prop-firm restriction.'
      });
      checks.push({
        id: 'broker-connection',
        label: 'MetaTrader connected to broker',
        ok: diag.terminalConnected === true,
        detail: diag.terminalConnected ? 'Connected' : 'No broker connection',
        hint: diag.terminalConnected ? '' : 'Check the MetaTrader connection status (bottom-right corner).'
      });
      checks.push({
        id: 'quote-flow',
        label: `Quote flow (${diag.symbol || 'EURUSD'})`,
        ok: diag.quoteFlowOk === true,
        detail: diag.symbolFound === false
          ? 'Symbol not found on this broker'
          : diag.quoteFlowOk
            ? `Live — last tick ${diag.quoteAgeSec}s ago (ask ${diag.ask})`
            : `Stale — last tick ${diag.quoteAgeSec != null ? `${diag.quoteAgeSec}s ago` : 'unknown'}`,
        hint: diag.quoteFlowOk ? '' : 'Open the symbol in Market Watch; if the market is closed, quotes will be stale — that is expected on weekends.'
      });
    } else {
      checks.push({
        id: 'ea-diagnostic',
        label: 'EA diagnostic reply',
        ok: false,
        detail: diag?.error || 'No reply',
        hint: 'The connected EA is older than v1.3 and does not support diagnostics — update SignalCopierEA.'
      });
    }
  }

  return {
    success: true,
    at: new Date().toISOString(),
    allOk: checks.every((c) => c.ok),
    checks,
    diag: diag && diag.success ? diag : null
  };
}));

ipcMain.handle('settings:getProfiles', ensureLicensed(async () => {
  return store.get('settingsProfiles', { activeProfileId: 'default', profiles: [] });
}));

ipcMain.handle('settings:saveProfile', ensureLicensed(async (_, { id, name, settings: profileSettings } = {}) => {
  const cur = store.get('settingsProfiles', { activeProfileId: 'default', profiles: [] });
  const pid = String(id || `profile-${Date.now()}`);
  const profiles = Array.isArray(cur.profiles) ? [...cur.profiles] : [];
  const idx = profiles.findIndex((p) => p.id === pid);
  const entry = { id: pid, name: String(name || 'Profile').slice(0, 80), settings: profileSettings, updatedAt: new Date().toISOString() };
  if (idx >= 0) profiles[idx] = entry;
  else profiles.push(entry);
  store.set('settingsProfiles', { ...cur, profiles: profiles.slice(0, 20) });
  return { success: true, profile: entry };
}));

ipcMain.handle('settings:applyProfile', ensureLicensed(async (_, profileId) => {
  const cur = store.get('settingsProfiles', { activeProfileId: 'default', profiles: [] });
  const profile = (cur.profiles || []).find((p) => p.id === profileId);
  if (!profile?.settings) return { success: false, error: 'Profile not found' };
  const normalized = normalizeSettingsSymbolMappings(profile.settings);
  store.set('settings', normalized);
  store.set('settingsProfiles', { ...cur, activeProfileId: profileId });
  configureMt4FileBridgeFromSettings(normalized);
  bridgeRouter.sendControl('SETTINGS_UPDATE', buildManagementControlPayload(normalized));
  bridgeRouter.recordSettingsUpdate(buildManagementControlPayload(normalized));
  scheduleDailyReportAfterEodLoop();
  scheduleWeeklyReportLoop();
  scheduleMonthlyReportLoop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:updated', normalized);
  }
  return { success: true, settings: normalized };
}));

ipcMain.handle('miniMode:toggle', ensureLicensed(async () => {
  return toggleMiniOverlayWindow();
}));

ipcMain.handle('app:isTradeStationE2e', async () => TRADE_STATION_E2E);

ipcMain.handle('ai:getRecentVerdicts', ensureLicensed(async (_e, opts = {}) => {
  const limit = Math.max(1, Math.min(100, Number(opts?.limit) || 20));
  return { rows: aiSignalCheck.getRecentVerdicts(limit) };
}));

ipcMain.handle('ai:clearVerdictHistory', ensureLicensed(async () => {
  aiSignalCheck.clearHistory();
  return { ok: true };
}));

ipcMain.handle('ai:summarizePerformance', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const tradeIds = Array.isArray(opts?.tradeIds) ? opts.tradeIds.filter((x) => x != null) : null;
  const r = await aiSignalCheck.summarizePerformance({
    trades: getStoredTrades(),
    settings,
    accountSnapshot: mt5AccountSnapshot,
    limit: Math.max(5, Math.min(60, Number(opts?.limit) || 30)),
    tradeIds: tradeIds && tradeIds.length ? tradeIds : null
  });
  if (r?.ok && r.scope === 'selected' && tradeIds?.length === 1) {
    try {
      if (applyAiTradeReviewToStoredTrade(tradeIds[0], r)) {
        return { ...r, journalSaved: true };
      }
    } catch (e) {
      addLog('warn', 'AI review journal save failed', e?.message || String(e));
    }
  }
  return r;
}));

/** Re Analyse a single closed trade — forces fresh AI analysis and saves to journal. */
ipcMain.handle('ai:analyzeClosedTrade', ensureLicensed(async (_e, tradeId) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  if (!settings?.aiCheck?.enabled) return { ok: false, error: 'AI_DISABLED' };
  if (!tradeId) return { ok: false, error: 'MISSING_TRADE_ID' };
  const idStr = String(tradeId);
  const trades = getStoredTrades();
  const exists = trades.some((t) => String(t.id) === idStr);
  if (!exists) return { ok: false, error: 'TRADE_NOT_FOUND' };
  const r = await aiSignalCheck.summarizePerformance({
    trades,
    settings,
    accountSnapshot: mt5AccountSnapshot,
    limit: 12,
    tradeIds: [idStr]
  });
  if (r?.ok) {
    applyAiTradeReviewToStoredTrade(idStr, r);
    return { ...r, journalSaved: true };
  }
  return r;
}));

/** AI summary for a month (or custom range) of trades — used by CalendarStatsPage. */
ipcMain.handle('ai:getMonthSummary', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  if (!settings?.aiCheck?.enabled) return { ok: false, error: 'AI_DISABLED' };
  const fromTs = Number(opts?.fromTs) || 0;
  const toTs = Number(opts?.toTs) || Date.now();
  const accountKeys = Array.isArray(opts?.accountKeys) ? opts.accountKeys : [];
  if (!fromTs || fromTs >= toTs) return { ok: false, error: 'INVALID_RANGE' };
  const allTrades = getStoredTrades();
  const scoped = allTrades.filter((t) => {
    if (accountKeys.length > 0 && !(accountKeys.includes(t.accountKey || 'unknown'))) return false;
    const opened = new Date(t.openedAt || t.time || 0).getTime();
    return opened >= fromTs && opened <= toTs;
  });
  if (!scoped.length) return { ok: false, error: 'NO_TRADES' };
  const closed = scoped.filter((t) => {
    const s = String(t.status || '').toUpperCase();
    return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT');
  });
  if (!closed.length) return { ok: false, error: 'NO_CLOSED_TRADES' };
  const byChannel = {};
  for (const t of closed) {
    const ch = String(t.channel || 'Unknown');
    if (!byChannel[ch]) byChannel[ch] = { count: 0, pnl: 0, wins: 0 };
    byChannel[ch].count += 1;
    byChannel[ch].pnl += Number(t.profit || 0);
    if (Number(t.profit) > 0) byChannel[ch].wins += 1;
  }
  const channelLines = Object.entries(byChannel)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([ch, s]) => `- ${ch}: ${s.count} trades, ${s.wins}W/${s.count - s.wins}L, ${s.pnl.toFixed(2)}$`)
    .join('\n');
  const wins = closed.filter((t) => Number(t.profit) > 0).length;
  const losses = closed.filter((t) => Number(t.profit) < 0).length;
  const totalPnl = closed.reduce((s, t) => s + Number(t.profit || 0), 0);
  const symbols = [...new Set(closed.map((t) => String(t.symbol || '').toUpperCase()).filter(Boolean))];
  const fromLabel = new Date(fromTs).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const toLabel = new Date(toTs).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const dateRange = fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`;
  const prompt = [
    `You are a trading coach. Review the closed trades listed below for the period ${dateRange}.`,
    '',
    'STRICT RULES:',
    '1. Use ONLY the data provided below — do not invent symbols, win rates, pip counts, or dates.',
    '2. If the sample is too small or noisy, say so instead of making up patterns.',
    '3. Keep each bullet under 20 words. Be specific — cite real symbols or channels.',
    `Period: ${dateRange}`,
    `Sample: ${closed.length} closed trades — ${wins}W / ${losses}L, net ${totalPnl.toFixed(2)}$`,
    `Symbols: ${symbols.join(', ')}`,
    '',
    'Per-channel breakdown:',
    channelLines || '- (none)',
    '',
    `STATS_JSON: ${JSON.stringify({
      trades: closed.length, wins, losses,
      totalPnl: Number(totalPnl.toFixed(2)),
      winRate: closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0,
      symbols: symbols.slice(0, 6)
    })}`,
    '',
    'Output ONLY a single-line JSON object with these keys:',
    '{"headline":"<=28 words","wins":["..."],"leaks":["..."],"best_pairs":["..."],"worst_pairs":["..."],"next_action":"<= 25 words","caution":"<= 28 words or empty"}'
  ].join('\n');
  const aiRes = await aiSignalCheck.freeAi.ask({
    prompt,
    model: settings?.aiCheck?.model || 'openai',
    json: true,
    timeoutMs: 22000,
    apiKey: freeAiClient.pollinationsKeyFromSettings(settings)
  });
  if (!aiRes.ok || !aiRes.json) return { ok: false, error: aiRes.error || 'ai_offline', rateLimited: aiRes.rateLimited };
  const j = aiRes.json;
  return {
    ok: true,
    dateRange,
    sample: closed.length,
    totalPnl: Number(totalPnl.toFixed(2)),
    wins,
    losses,
    symbols,
    headline: String(j.headline || '').slice(0, 280),
    wins_list: Array.isArray(j.wins) ? j.wins.slice(0, 4) : [],
    leaks: Array.isArray(j.leaks) ? j.leaks.slice(0, 4) : [],
    best_pairs: Array.isArray(j.best_pairs) ? j.best_pairs.slice(0, 5) : [],
    worst_pairs: Array.isArray(j.worst_pairs) ? j.worst_pairs.slice(0, 5) : [],
    next_action: String(j.next_action || '').slice(0, 240),
    caution: String(j.caution || '').slice(0, 320)
  };
}));

ipcMain.handle('ai:summarizeDashboardStats', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const tradeIds = Array.isArray(opts?.tradeIds) ? opts.tradeIds.filter((x) => x != null) : [];
  const filterSummary = String(opts?.filterSummary || '').slice(0, 1200);
  if (tradeIds.length === 0) {
    return { ok: false, error: 'NO_TRADES' };
  }
  const idSet = new Set(tradeIds.map(String));
  const trades = getStoredTrades().filter((t) => idSet.has(String(t?.id)));
  return aiSignalCheck.summarizeDashboardStats({
    settings,
    filterSummary,
    trades
  });
}));

ipcMain.handle('filters:searchBestCombinations', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const tradeIds = Array.isArray(opts?.tradeIds) ? opts.tradeIds.filter((x) => x != null) : [];
  if (tradeIds.length === 0) {
    return { ok: false, error: 'NO_TRADES', results: [] };
  }
  const idSet = new Set(tradeIds.map(String));
  const trades = getStoredTrades().filter((t) => idSet.has(String(t?.id)));
  return searchBestFilterCombinations(trades, {
    breakEvenAmount: settings?.analyticsBreakEvenAmount,
    minDecisive: opts?.minDecisive,
    maxResults: opts?.maxResults,
    anchorSymbol: opts?.anchorSymbol,
    lockedFilters: opts?.lockedFilters,
    rankBy: opts?.rankBy,
    disabledDimensions: opts?.disabledDimensions
  });
}));

ipcMain.handle('ai:summarizeFilterOptimizer', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const optimizerResult = opts?.optimizerResult;
  if (!optimizerResult?.results?.length) {
    return { ok: false, error: 'NO_RESULTS' };
  }
  return aiSignalCheck.summarizeFilterOptimizer({
    settings,
    context: String(opts?.context || '').slice(0, 1200),
    optimizerResult
  });
}));

ipcMain.handle('filters:analyzeWorstTrades', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const tradeIds = Array.isArray(opts?.tradeIds) ? opts.tradeIds.filter((x) => x != null) : [];
  if (tradeIds.length === 0) {
    return { ok: false, error: 'NO_TRADES' };
  }
  const idSet = new Set(tradeIds.map(String));
  const trades = getStoredTrades().filter((t) => idSet.has(String(t?.id)));
  return analyzeWorstTrades(trades, {
    breakEvenAmount: settings?.analyticsBreakEvenAmount,
    minDecisive: opts?.minDecisive,
    maxTrades: opts?.maxTrades,
    disabledDimensions: opts?.disabledDimensions
  });
}));

ipcMain.handle('ai:summarizeWorstTrades', ensureLicensed(async (_e, opts = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const analysisResult = opts?.analysisResult;
  if (!analysisResult?.ok) {
    return { ok: false, error: 'NO_ANALYSIS' };
  }
  return aiSignalCheck.summarizeWorstTrades({
    settings,
    context: String(opts?.context || '').slice(0, 1200),
    analysisResult
  });
}));

ipcMain.handle('ai:ping', ensureLicensed(async () => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const model = settings?.aiCheck?.model || 'openai';
  return aiSignalCheck.freeAi.ping({
    model,
    apiKey: freeAiClient.pollinationsKeyFromSettings(settings)
  });
}));

ipcMain.handle('ai:getUsage', ensureLicensed(async () => {
  const settings = store.get('settings', getDefaultSettings());
  return aiUsage.getStatus(store, settings);
}));

ipcMain.handle('ai:resetUsage', ensureLicensed(async () => {
  return aiUsage.reset(store);
}));

ipcMain.handle('ai:getFreeTextModels', ensureLicensed(async () => ({
  models: freeAiClient.FREE_TEXT_MODELS,
  defaultModel: freeAiClient.DEFAULT_MODEL
})));

ipcMain.handle('aiChat:listSessions', ensureLicensed(async () => {
  return { sessions: aiChat.listSessions(store) };
}));

ipcMain.handle('aiChat:getMessages', ensureLicensed(async (_e, sessionId) => {
  return { messages: aiChat.getMessages(store, sessionId) };
}));

ipcMain.handle('aiChat:newSession', ensureLicensed(async (_e, opts = {}) => {
  const settings = store.get('settings', getDefaultSettings());
  const model = freeAiClient.normalizePollinationsModel(opts?.model || settings?.aiCheck?.model);
  return { session: aiChat.newSession(store, { title: opts?.title, model }) };
}));

ipcMain.handle('aiChat:patchSession', ensureLicensed(async (_e, sessionId, patch = {}) => {
  const p = {};
  if (patch && patch.model != null) {
    p.model = freeAiClient.normalizePollinationsModel(patch.model);
  }
  const s = aiChat.patchSession(store, sessionId, p);
  return s ? { ok: true, session: s } : { ok: false, error: 'SESSION_NOT_FOUND' };
}));

ipcMain.handle('aiChat:renameSession', ensureLicensed(async (_e, sessionId, title) => {
  const s = aiChat.renameSession(store, sessionId, title);
  return s ? { ok: true, session: s } : { ok: false, error: 'SESSION_NOT_FOUND' };
}));

ipcMain.handle('aiChat:deleteSession', ensureLicensed(async (_e, sessionId) => {
  const ok = aiChat.deleteSession(store, sessionId);
  return { ok };
}));

ipcMain.handle('aiChat:clearAll', ensureLicensed(async () => {
  aiChat.clearAll(store);
  return { ok: true };
}));

ipcMain.handle('aiChat:sendMessage', ensureLicensed(async (_e, payload = {}) => {
  const settings = store.get('settings', getDefaultSettings());
  const model = freeAiClient.normalizePollinationsModel(
    payload?.model || settings?.aiCheck?.model
  );
  const content = String(payload?.content || '').trim();
  if (!content) return { ok: false, error: 'EMPTY_MESSAGE' };

  let sessionId = String(payload?.sessionId || '').trim();
  let session = null;
  const existing = aiChat.listSessions(store);
  if (sessionId) {
    session = existing.find((s) => String(s.id) === sessionId) || null;
  }
  if (!session) {
    session = aiChat.newSession(store, { model });
    sessionId = session.id;
  } else {
    aiChat.patchSession(store, sessionId, { model });
  }

  const attachedSymbol = String(payload?.attach?.symbol || '').trim().toUpperCase().slice(0, 24);
  const attachedTf = String(payload?.attach?.tf || '').trim().toUpperCase().slice(0, 12);
  const chartContext = String(payload?.chartContext || '').slice(0, 1200).trim();

  const userMessage = aiChat.appendMessage(store, sessionId, {
    role: 'user',
    content,
    model,
    attachedSymbol,
    attachedTf
  });
  aiChat.ensureTitleFromFirstMessage(store, sessionId, content);

  const history = aiChat.getRecentHistory(store, sessionId, 8)
    .filter((m) => m.id !== userMessage?.id);

  const historyBlock = history.length
    ? history
        .map((m) => `${m.role === 'assistant' ? 'AI' : 'USER'}: ${String(m.content || '').slice(0, 800)}`)
        .join('\n')
    : '';

  const promptParts = [
    'You are a focused trading assistant inside a desktop app. Keep replies short, structured, and grounded in any CHART_CTX numbers you are given. Use plain text (no markdown headings). Never invent prices, levels, or candles.'
  ];
  if (attachedSymbol || attachedTf || chartContext) {
    promptParts.push(`CONTEXT: symbol=${attachedSymbol || '?'} tf=${attachedTf || '?'}`);
    if (chartContext) promptParts.push(`CHART_CTX: ${chartContext}`);
  }
  try {
    const tradeDataCtx = aiChat.buildTradeDataContextBlock({
      question: content,
      trades: getStoredTrades(),
      settings
    });
    if (tradeDataCtx) promptParts.push(`TRADE_DATA:\n${tradeDataCtx}`);
  } catch (_) {
    /* chat must never break if trade context fails */
  }
  if (historyBlock) {
    promptParts.push('CONVERSATION SO FAR:');
    promptParts.push(historyBlock);
  }
  promptParts.push('NEW USER MESSAGE:');
  promptParts.push(content);
  const prompt = promptParts.join('\n');

  const aiRes = await aiSignalCheck.freeAi.ask({
    prompt,
    model,
    json: false,
    apiKey: freeAiClient.pollinationsKeyFromSettings(settings),
    // Long structured prompts + Pollinations cold starts need more than a few seconds.
    timeoutMs: 120_000
  });

  if (!aiRes.ok) {
    return {
      ok: false,
      sessionId,
      session: aiChat.listSessions(store).find((s) => String(s.id) === String(sessionId)) || session,
      userMessage,
      error: aiRes.error || 'ai_offline',
      status: aiRes.status
    };
  }

  const reply = formatAssistantReply(String(aiRes.text || '').trim());
  const assistantMessage = aiChat.appendMessage(store, sessionId, {
    role: 'assistant',
    content: reply || '(empty reply)',
    model
  });

  const updatedSession = aiChat.listSessions(store).find((s) => String(s.id) === String(sessionId)) || session;

  return {
    ok: true,
    sessionId,
    session: updatedSession,
    userMessage,
    assistantMessage
  };
}));

ipcMain.handle('channels:getScoreboard', ensureLicensed(async (_e, opts = {}) => {
  const trades = getStoredTrades();
  const filteredByAccount = (opts?.accountKeys && Array.isArray(opts.accountKeys) && opts.accountKeys.length > 0)
    ? trades.filter((t) => opts.accountKeys.includes(t.accountKey || 'unknown'))
    : trades;
  return {
    rows: computeChannelScoreboard(filteredByAccount, { minClosedTrades: Number(opts?.minClosedTrades) || 0 })
  };
}));

ipcMain.handle('backtest:runChannel', ensureLicensed(async (_e, opts = {}) => {
  const trades = getStoredTrades();
  return signalBacktester.runChannelReplay(trades, opts);
}));

ipcMain.handle('drawdownGuard:getStatus', ensureLicensed(async () => {
  const accountKey = currentMt5Account?.key || 'unknown';
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  return {
    accountKey,
    state: drawdownGuardian.buildGuardianStatus({
      store,
      settings,
      accountKey,
      accountSnapshot: getMt5AccountSnapshotForSizing(),
      todayClosedPnl: sumTodayClosedPnlSafe(getStoredTrades())
    })
  };
}));

ipcMain.handle('drawdownGuard:clear', ensureLicensed(async () => {
  const accountKey = currentMt5Account?.key || 'unknown';
  drawdownGuardian.clearHalt(store, accountKey);
  addLog('info', 'Drawdown guardian halt cleared', accountKey);
  return { success: true };
}));

ipcMain.handle('app:reportRendererError', async (_event, payload = {}) => {
  const message = String(payload?.message || 'Unknown renderer error').slice(0, 400);
  const component = String(payload?.component || '').slice(0, 600);
  addLog('error', `Renderer error: ${message}`, component || undefined);
  return { success: true };
});

// ─── Trades IPC Handlers ─────────────────────────────────────────────────────

ipcMain.handle('trades:getAll', ensureLicensed(async () => {
  tradeStore.invalidateCache();
  return getStoredTrades();
}));

async function importMtStatementFromAbsolutePath(filePath, opts = {}) {
  const known = getKnownMt5Accounts();
  const target =
    typeof opts?.targetAccountKey === 'string'
      ? opts.targetAccountKey.trim()
      : '';
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const broff = settings.mtHtmlReportBrokerOffsetMinutes;
  const brokerOffsetMinutes =
    typeof broff === 'number' && Number.isFinite(broff) ? Math.round(broff) : null;
  const parsed = mtStatementImport.parseDetailedStatementFromFile(filePath, {
    targetAccountKey: target,
    knownAccounts: known,
    brokerOffsetMinutes,
  });
  const existing = getStoredTrades();
  const { trades, added, skippedDup } = mtStatementImport.mergeStatementImports(
    existing,
    parsed.trades,
  );
  saveStoredTrades(trades);

  const at = parsed.accountKey.indexOf('@');
  const serverPart = at > 0 ? parsed.accountKey.slice(at + 1) : 'MT4-Statement';
  upsertKnownMt5Account({
    key: parsed.accountKey,
    login: parsed.login,
    server: serverPart,
    name: parsed.displayName || '',
  });
  broadcastKnownMt5Accounts();

  addLog(
    'success',
    `Imported ${added} closed trade(s) from HTML`,
    `Login ${parsed.login} · skipped ${skippedDup} duplicate ticket(s)`,
  );

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('trades:statementImported', { added, skippedDup });
    } catch (_) {
      /* noop */
    }
  }

  return {
    success: true,
    added,
    skippedDup,
    skippedRows: parsed.skippedRows,
    parsedRowCount: parsed.parsedRowCount,
    accountKey: parsed.accountKey,
    login: parsed.login,
  };
}

ipcMain.handle('trades:parseManualTelegram', ensureLicensed(async (_, { text, settings } = {}) => {
  try {
    const merged = {
      ...getDefaultSettings(),
      ...(settings || store.get('settings', getDefaultSettings()) || {})
    };
    return manualTradeService.parseTelegramForManual(text, merged);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}));

ipcMain.handle('trades:addManual', ensureLicensed(async (_, payload = {}) => {
  try {
    const merged = { ...getDefaultSettings(), ...(store.get('settings', getDefaultSettings()) || {}) };
    const trade = manualTradeService.createManualTrade(payload, {
      settings: merged,
      normalizeTradeForStorage,
      account: currentMt5Account || {
        key: 'manual',
        login: 'Manual',
        server: '',
        name: 'Manual entry'
      }
    });
    const trades = getStoredTrades();
    trades.unshift(trade);
    if (trades.length > 200) trimTradesList(trades);
    saveStoredTrades(trades);
    addLog(
      'success',
      `Manual trade: ${trade.type} ${trade.symbol} (${trade.status})`,
      `Channel ${manualTradeService.MANUAL_TRADE_CHANNEL} · P/L ${trade.profit}`
    );
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trade:new', trade);
    }    return { success: true, trade };
  } catch (e) {
    addLog('warn', 'Manual trade failed', e.message || String(e));
    return { success: false, error: e.message || String(e), code: e.code || 'MANUAL_TRADE_FAILED' };
  }
}));

ipcMain.handle('trades:importMtStatementDialog', ensureLicensed(async (_, opts = {}) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const picked = await dialog.showOpenDialog(win || undefined, {
    title: 'Import MetaTrader HTML (MT4 statement or MT5 report)',
    filters: [{ name: 'HTML statement', extensions: ['htm', 'html'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true };

  const filePath = picked.filePaths[0];
  try {
    return await importMtStatementFromAbsolutePath(filePath, opts);
  } catch (e) {
    addLog('error', 'Statement import failed', e.message || String(e));
    return {
      success: false,
      error: e.message || String(e),
      code: e.code || 'IMPORT_FAILED',
    };
  }
}));

/** Playwright: import bundled HTML fixture (no OS file dialog). */
ipcMain.handle('trades:e2eFixtureImportMtStatement', ensureLicensed(async (_, opts = {}) => {
  if (!TRADE_STATION_E2E) {
    return { success: false, error: 'E2E only', code: 'FORBIDDEN' };
  }
  const fixturePath = path.join(__dirname, '..', '..', 'e2e', 'fixtures', 'mt5-report-demo.htm');
  if (!fs.existsSync(fixturePath)) {
    addLog('error', 'Statement import failed', `Missing fixture ${fixturePath}`);
    return {
      success: false,
      error: 'Fixture HTML missing',
      code: 'FIXTURE_MISSING',
    };
  }
  try {
    return await importMtStatementFromAbsolutePath(fixturePath, opts || {});
  } catch (e) {
    addLog('error', 'Statement import failed', e.message || String(e));
    return {
      success: false,
      error: e.message || String(e),
      code: e.code || 'IMPORT_FAILED',
    };
  }
}));

ipcMain.handle('trades:clear', ensureLicensed(async () => {
  saveStoredTrades([]);
  return { success: true };
}));

/** TEMP E2E/marketing: inject diverse rows (ids e2e-synthetic-*). Not for production users. */
ipcMain.handle('trades:e2eSeedSyntheticTrades', ensureLicensed(async () => {
  if (!TRADE_STATION_E2E) return { success: false, code: 'FORBIDDEN' };
  const synthetic = buildSyntheticE2eTrades(
    Date.now(),
    normalizeTradeForStorage,
    path.join(__dirname, '..', '..'),
  );
  const existing = getStoredTrades().filter(
    (t) => !String(t.id || '').startsWith('e2e-synthetic-'),
  );
  saveStoredTrades([...existing, ...synthetic]);
  return { success: true, count: synthetic.length };
}));

ipcMain.handle('trades:e2eClearSyntheticTrades', ensureLicensed(async () => {
  if (!TRADE_STATION_E2E) return { success: false, code: 'FORBIDDEN' };
  const before = getStoredTrades();
  const next = before.filter((t) => !String(t.id || '').startsWith('e2e-synthetic-'));
  saveStoredTrades(next);
  return { success: true, deleted: before.length - next.length };
}));

ipcMain.handle('trades:resend', ensureLicensed(async (_, ids) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const schedule = evaluateSignalSchedule(settings);
  if (!schedule.allowed) {
    addLog('warn', 'Resend blocked by schedule', schedule.reason || '');
    return { success: false, sent: 0, reason: 'SCHEDULE_BLOCKED', scheduleReason: schedule.reason };
  }
  const trades = getStoredTrades();
  const toResend = trades.filter(t => ids.includes(t.id));
  let sent = 0;

  function inferResendOrderType(trade) {
    const savedOrderType = String(trade.orderType || '').toUpperCase();
    if (savedOrderType.includes('LIMIT') || savedOrderType.includes('STOP')) {
      return savedOrderType;
    }

    // If original type was MARKET, let EA auto-detect pending vs market by entry/current price.
    if (!savedOrderType || savedOrderType === 'MARKET') return '';

    return savedOrderType;
  }

  for (const trade of toResend) {
    const resendOrderType = inferResendOrderType(trade);
    const channelMerge = channelOverrides.applyChannelOverrides(settings, trade.channel);
    if (channelMerge.channelDisabled) {
      addLog('info', `↺ Resend skipped — channel disabled for [${trade.channel || 'unknown'}]`, trade.symbol || '');
      continue;
    }
    const effectiveSettings = applyPerPairOverrides(channelMerge.merged, trade.symbol);

    const telegramEntry =
      trade.signalEntry != null && Number(trade.signalEntry) > 0
        ? Number(trade.signalEntry)
        : Number(trade.entry);
    const rawResend = {
      tradeId: trade.id,
      symbol: trade.symbol,
      type: trade.type,
      orderType: resendOrderType,
      entry: telegramEntry,
      sl: trade.sl,
      tp: [trade.tp].filter(Boolean),
      lot: trade.lot || 0,
      ...(trade.avgEntry != null && Number(trade.avgEntry) > 0 ? { avgEntry: Number(trade.avgEntry) } : {})
    };
    const resendWithSpread = await attachLiveSpreadForEntryAdjust(
      rawResend,
      effectiveSettings,
      (payload) => bridgeRouter.requestMt5Spread(payload)
    );
    let signal = applySignalExecutionTransforms(resendWithSpread, effectiveSettings);
    signal = applyLotSizingToSignal(signal, effectiveSettings, getMt5AccountSnapshotForSizing());
    signal = normalizeExecutionEntryAfterSizing(signal, effectiveSettings);
    signal.orderType = resolveOrderTypeForSignal(signal, effectiveSettings);
    const resendTier = drawdownGuardian.applyTierLotReduction(signal, {
      store,
      settings: effectiveSettings,
      accountKey: trade.accountKey || currentMt5Account?.key || 'unknown',
      accountSnapshot: mt5AccountSnapshot,
      todayClosedPnl: sumTodayClosedPnlSafe(getStoredTrades()),
      logFn: (msg) => addLog('info', msg)
    });
    signal = resendTier.signal;

    const resendFilterRow = {
      symbol: trade.symbol,
      type: trade.type,
      channel: trade.channel,
      timeframe: trade.timeframe,
      bias: trade.bias,
      vwapBand: trade.vwapBand,
      hvnBand: trade.hvnBand,
      presetTags: trade.presetTags,
      setup: trade.setup
    };
    const resendSf = evaluateAdvancedSignalBlock(settings, resendFilterRow, new Date());
    if (resendSf.blocked) {
      trade.status = 'BLOCKED_SIGNAL_FILTERS';
      trade.blockedReason = resendSf.reason || '';
      trade.lastUpdateAt = new Date().toISOString();
      addLog('warn', `↺ Resend blocked — signal filters (${trade.symbol})`, resendSf.reason || '');
      if (settings?.notifications?.signalBlockedBySignalFilters !== false) {
        sendDesktopNotification(
          'Resend blocked: Filters',
          `${trade.symbol}: ${resendSf.reason || 'advanced filters'}`,
          `blocked-resend-filters:${trade.id}`,
          8000
        );
      }
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      continue;
    }

    let execGuard = { allowed: true, reason: '', code: '' };
    try {
      execGuard = evaluateExecutionGuards({
        settings: effectiveSettings,
        signal,
        trades: getStoredTrades(),
        accountSnapshot: mt5AccountSnapshot,
        accountKey: trade.accountKey || currentMt5Account?.key || 'unknown',
        store,
        helpers: { priceDistancePips }
      });
    } catch (egErr) {
      addLog('warn', 'Resend execution guard failed', egErr?.message || String(egErr));
      if (signalPipeline.resolveGuardFailMode(effectiveSettings) === 'closed') {
        execGuard = {
          allowed: false,
          reason: `Execution guard error (${egErr?.message || egErr}) — blocked by fail-closed mode`,
          code: 'BLOCKED_GUARD'
        };
      }
    }

    if (!execGuard.allowed) {
      trade.status = execGuard.code || 'BLOCKED_EXEC_GUARD';
      trade.blockedReason = execGuard.reason || '';
      trade.lastUpdateAt = new Date().toISOString();
      addLog('warn', `↺ Resend blocked (${trade.symbol})`, execGuard.reason || '');
      if (settings?.notifications?.signalBlockedByGuard !== false) {
        sendDesktopNotification(
          'Resend blocked',
          `${trade.symbol}: ${execGuard.reason || 'execution guard'}`,
          `blocked-resend:${trade.id}`,
          8000
        );
      }
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      continue;
    }

    addLog(
      'info',
      `↺ Resending ${trade.type} ${trade.symbol}`,
      `entry:${signal.entry}${rawResend.entry != null && Number(rawResend.entry) > 0 && Math.abs(Number(rawResend.entry) - Number(signal.entry)) > 1e-8 ? ` (base ${Number(rawResend.entry).toFixed(5)})` : ''} SL:${signal.sl} TP:${(signal.tp || []).join('/')} mode:${resendOrderType || 'AUTO'}`
    );
    trade.status = 'PENDING';
    trade.blockedReason = '';
    trade.dispatchedAt = null;
    if (resendTier.ddTierApplied) trade.ddTierApplied = resendTier.ddTierApplied;
    attachTradeRiskFields(trade, signal);
    const resendSpreadCapPips = signalPipeline.resolveMaxSpreadPips(effectiveSettings);
    const resendPendingExpirySeconds = signalPipeline.resolvePendingExpirySeconds(effectiveSettings);
    if (signalPipeline.shouldSimulateDispatch({ dryRunMode: effectiveSettings?.dryRunMode, blocked: false, status: 'PENDING' })) {
      trade.status = 'SIMULATED';
      trade.simulated = true;
      trade.lastUpdateAt = new Date().toISOString();
      addLog('info', '🧪 Dry run — resend simulated (not sent to MetaTrader)', `${trade.symbol}`);
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);
      sent++;
      continue;
    }
    if (mainWindow) mainWindow.webContents.send('trade:update', trade);    bridgeRouter.sendSignal(attachRrSnapForMt5({
      ...signal,
      tradeId: trade.id,
      ...(resendSpreadCapPips > 0 ? { maxSpreadPips: resendSpreadCapPips } : {}),
      ...(resendPendingExpirySeconds > 0 ? { pendingExpirySeconds: resendPendingExpirySeconds } : {})
    }, effectiveSettings), (ack) => {
      applyTradeDispatchCallback(trade, ack);
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      addLog(
        ack.status === 'DISPATCHED' ? 'info' : 'warn',
        ack.status === 'DISPATCHED' ? `↺ Resend dispatched: ${trade.symbol}` : `↺ Resend ack: ${ack.status} — ${trade.symbol}`
      );
    });
    sent++;
  }
  saveStoredTrades(trades);
  addLog('info', `↺ Resend triggered for ${sent} trade(s)`);
  return { success: true, sent };
}));

ipcMain.handle('trades:updateJournal', ensureLicensed(async (_, tradeId, journalPatch = {}) => {
  const trades = getStoredTrades();
  const idx = trades.findIndex((t) => String(t.id) === String(tradeId));
  if (idx < 0) return { success: false, reason: 'TRADE_NOT_FOUND' };

  const { presetTags: presetTagsIn, ...journalFields } = journalPatch || {};

  const updatedTrade = normalizeTradeForStorage({
    ...trades[idx],
    journal: {
      ...(trades[idx].journal || {}),
      ...journalFields
    },
    ...(presetTagsIn !== undefined
      ? { presetTags: Array.isArray(presetTagsIn) ? presetTagsIn : [] }
      : {}),
    lastUpdateAt: new Date().toISOString()
  });

  trades[idx] = updatedTrade;
  saveStoredTrades(trades);
  if (mainWindow) mainWindow.webContents.send('trade:update', updatedTrade);  return { success: true, trade: updatedTrade };
}));

ipcMain.handle('trades:updateComment', ensureLicensed(async (_, tradeId, comment) => {
  const trades = getStoredTrades();
  const idx = trades.findIndex((t) => String(t.id) === String(tradeId));
  if (idx < 0) return { success: false, reason: 'TRADE_NOT_FOUND' };

  const updatedTrade = normalizeTradeForStorage({
    ...trades[idx],
    comment: String(comment || '').trim(),
    lastUpdateAt: new Date().toISOString()
  });

  trades[idx] = updatedTrade;
  saveStoredTrades(trades);
  if (mainWindow) mainWindow.webContents.send('trade:update', updatedTrade);
  return { success: true, trade: updatedTrade };
}));

ipcMain.handle('trades:update', ensureLicensed(async (_, tradeId, payload = {}) => {
  tradeStore.invalidateCache();
  const trades = getStoredTrades();
  const hintTrade = payload?.hintTrade && typeof payload.hintTrade === 'object' ? payload.hintTrade : {};
  let idx = findTradeIndexForUpdate(trades, tradeId, hintTrade);
  let restored = false;
  if (idx < 0 && String(hintTrade.symbol || '').trim()) {
    const row = buildRestoredTradeFromHint(tradeId, hintTrade);
    if (row) {
      trades.unshift(normalizeTradeForStorage(row));
      idx = 0;
      restored = true;
    }
  }
  if (idx < 0) return { success: false, reason: 'TRADE_NOT_FOUND' };

  const { patch: rawPatch = {}, journalPatch = {}, applyToMt5 = false } = payload || {};
  const patch = buildTradePatch(rawPatch);
  const { presetTags: presetTagsIn, ...journalFields } = journalPatch || {};

  let updatedTrade = normalizeTradeForStorage({
    ...trades[idx],
    ...patch,
    userEdited: true,
    journal: {
      ...(trades[idx].journal || {}),
      ...journalFields
    },
    ...(presetTagsIn !== undefined
      ? { presetTags: Array.isArray(presetTagsIn) ? presetTagsIn : [] }
      : {}),
    lastUpdateAt: new Date().toISOString()
  });

  trades[idx] = updatedTrade;

  let mt5Modify = null;
  if (applyToMt5 && isOpenTradeStatus(updatedTrade.status)) {
    const ticket = resolveModifyTicket(updatedTrade);
    const sl = toNumber(updatedTrade.sl);
    const tp = toNumber(updatedTrade.tp);
    if (ticket && (sl > 0 || tp > 0)) {
      const sent = bridgeRouter.sendControl('MODIFY_TRADE', {
        ticket,
        tradeId: updatedTrade.id,
        symbol: updatedTrade.symbol,
        sl: sl > 0 ? sl : null,
        tp: tp > 0 ? tp : null
      });
      mt5Modify = { sent: !!sent, ticket };
      if (sent) {
        addLog('info', `🔧 MODIFY sent → ${updatedTrade.type} ${updatedTrade.symbol}`, `ticket ${ticket} SL:${sl || '—'} TP:${tp || '—'}`);
      } else {
        addLog('warn', 'MODIFY not sent (bridge unavailable)', `${updatedTrade.symbol}`);
      }
    }
  }

  saveStoredTrades(trades);
  if (restored) {
    addLog('info', 'Restored missing trade for edit', `${updatedTrade.symbol} · id ${updatedTrade.id}`);
  }
  if (mainWindow) mainWindow.webContents.send('trade:update', updatedTrade);
  return { success: true, trade: updatedTrade, mt5Modify, restored };
}));

ipcMain.handle('trades:deleteMany', ensureLicensed(async (_, ids = []) => {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map((v) => String(v)));
  if (idSet.size === 0) return { success: true, deleted: 0 };

  const trades = getStoredTrades();
  const removing = trades.filter((t) => idSet.has(String(t.id)));
  for (const t of removing) {
    try {
      requestBrokerCancelTrade(t);
    } catch (e) {
      addLog('warn', 'Broker cancel on delete failed', e?.message || String(e));
    }
  }

  const next = trades.filter((t) => !idSet.has(String(t.id)));
  const deleted = trades.length - next.length;
  saveStoredTrades(next);
  return { success: true, deleted };
}));

ipcMain.handle('trades:deleteByAccount', ensureLicensed(async (_, accountKey = '') => {
  const key = String(accountKey || '').trim();
  if (!key) return { success: false, reason: 'ACCOUNT_REQUIRED' };

  const currentKey = String(currentMt5Account?.key || '').trim();
  if (currentKey && key === currentKey) {
    return { success: false, reason: 'CANNOT_DELETE_CURRENT_ACCOUNT' };
  }

  const trades = getStoredTrades();
  const next = trades.filter((t) => String(t.accountKey || 'unknown') !== key);
  const deleted = trades.length - next.length;
  saveStoredTrades(next);
  tradeStore.deleteByAccount(key);
  forgetKnownMt5Account(key);
  return { success: true, deleted };
}));

ipcMain.handle('trades:deleteAccounts', ensureLicensed(async (_, keys = []) => {
  const raw = [...new Set((Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (raw.length === 0) return { success: false, reason: 'ACCOUNTS_REQUIRED' };

  const currentKey = String(currentMt5Account?.key || '').trim();
  const skippedKeys = currentKey ? raw.filter((k) => k === currentKey) : [];
  const toDelete = raw.filter((k) => !skippedKeys.includes(k));

  if (toDelete.length === 0) {
    return { success: false, reason: 'CANNOT_DELETE_CURRENT_ACCOUNT', skippedKeys };
  }

  const trades = getStoredTrades();
  const keySet = new Set(toDelete);
  const next = trades.filter((t) => !keySet.has(String(t.accountKey || 'unknown')));
  saveStoredTrades(next);

  for (const key of toDelete) {
    tradeStore.deleteByAccount(key);
    forgetKnownMt5Account(key, { skipBroadcast: true });
  }
  broadcastKnownMt5Accounts();

  return {
    success: true,
    deletedAccounts: toDelete.length,
    deletedKeys: toDelete,
    skippedKeys
  };
}));

ipcMain.handle('analytics:getSummary', ensureLicensed(async (_, filters = {}) => {
  const trades = getStoredTrades();
  return computeAnalytics(trades, filters || {});
}));

ipcMain.handle('analytics:validateLive', ensureLicensed(async () => {
  const trades = getStoredTrades();
  const week = computeAnalytics(trades, { timeScope: 'WEEK' });
  const closed = trades.filter((t) => isClosedStatus(t?.status || '') || String(t?.status || '').toUpperCase().includes('CLOSED'));
  const rawClosedPnl = closed.reduce((sum, t) => sum + Number(t.profit || 0), 0);
  return {
    success: true,
    checkedAt: new Date().toISOString(),
    checks: {
      weekTotalsFinite: Number.isFinite(Number(week?.totals?.totalPnl)),
      weekWinRateFinite: Number.isFinite(Number(week?.totals?.winRate)),
      weekClosedCountFinite: Number.isFinite(Number(week?.closedCount)),
      rawClosedPnl: Number(rawClosedPnl.toFixed(2)),
      analyticsClosedPnl: Number((week?.totals?.totalPnl || 0).toFixed(2))
    }
  };
}));

ipcMain.handle('exports:weeklyPack', ensureLicensed(async (_, filters = {}) => {
  const allTrades = getStoredTrades();
  const analytics = computeAnalytics(allTrades, {
    ...(filters || {}),
    timeScope: 'WEEK'
  });
  const accountKeys = Array.isArray(filters?.accountKeys) ? filters.accountKeys : [];
  const symbol = String(filters?.symbol || '').toLowerCase();
  const channel = String(filters?.channel || 'ALL');
  const type = String(filters?.type || 'ALL').toUpperCase();
  const status = String(filters?.status || 'ALL').toUpperCase();
  const scopedTrades = allTrades.filter((t) => {
    if (!tradeMatchesTimeScope(t, 'WEEK')) return false;
    if (accountKeys.length > 0 && !accountKeys.includes(t.accountKey || 'unknown')) return false;
    if (symbol && !String(t.symbol || '').toLowerCase().includes(symbol)) return false;
    if (channel !== 'ALL' && String(t.channel || '') !== channel) return false;
    if (type !== 'ALL' && String(t.type || '').toUpperCase() !== type) return false;
    if (status !== 'ALL') {
      const s = String(t.status || '').toUpperCase();
      if (status === 'CLOSED' && !(s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT'))) return false;
      if (status === 'PENDING' && s !== 'PENDING') return false;
      if (status === 'SENT' && s !== 'SENT') return false;
    }
    return true;
  });
  const files = await generateWeeklyPackFilesCore({ trades: scopedTrades, analytics, documentsDir: app.getPath('documents') });
  addLog('success', 'Weekly export generated', `${files.baseDir}`);
  return { success: true, ...files, tradeCount: scopedTrades.length };
}));

/**
 * Export a renderer-selected slice of trades (the currently filtered table) to
 * CSV / JSON / PDF via a native save dialog.
 */
ipcMain.handle('trades:export', ensureLicensed(async (_, { format, tradeIds } = {}) => {
  const fmt = String(format || 'csv').toLowerCase();
  if (!['csv', 'json', 'pdf'].includes(fmt)) return { success: false, reason: 'BAD_FORMAT' };

  const ids = new Set((Array.isArray(tradeIds) ? tradeIds : []).map((id) => String(id)));
  const all = getStoredTrades();
  const rows = ids.size > 0 ? all.filter((t) => ids.has(String(t?.id))) : all;
  if (rows.length === 0) return { success: false, reason: 'NO_TRADES' };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const filters = {
    csv: [{ name: 'CSV', extensions: ['csv'] }],
    json: [{ name: 'JSON', extensions: ['json'] }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }]
  }[fmt];
  const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
    title: `Export ${rows.length} trade(s) as ${fmt.toUpperCase()}`,
    defaultPath: path.join(app.getPath('documents'), `trades-${stamp}.${fmt}`),
    filters
  });
  if (saveResult.canceled || !saveResult.filePath) return { success: false, canceled: true };
  let filePath = String(saveResult.filePath).trim();
  if (!new RegExp(`\\.${fmt}$`, 'i').test(filePath)) filePath += `.${fmt}`;

  try {
    if (fmt === 'csv') fs.writeFileSync(filePath, tradeExport.buildTradesCsv(rows), 'utf8');
    else if (fmt === 'json') fs.writeFileSync(filePath, tradeExport.buildTradesJson(rows), 'utf8');
    else await tradeExport.writeTradesPdf(rows, filePath);
  } catch (err) {
    addLog('error', 'Trade export failed', err?.message || String(err));
    return { success: false, reason: err?.message || 'WRITE_FAILED' };
  }

  addLog('success', `Exported ${rows.length} trade(s) as ${fmt.toUpperCase()}`, filePath);
  shell.showItemInFolder(filePath);
  return { success: true, filePath, tradeCount: rows.length };
}));

ipcMain.handle('fundamentals:getDashboard', ensureLicensed(async (_, options = {}) => {
  const settings = store.get('settings', getDefaultSettings());
  const timeoutMs = 8000;
  let dashboard;
  try {
    dashboard = await Promise.race([
      getFundamentalsDashboard(settings, options || {}),
      new Promise((resolve) => {
        setTimeout(() => resolve({
          unavailable: true,
          unavailableReason: 'Fundamentals request timed out',
          stale: true,
          staleReason: 'timeout',
          calendar: { events: [] }
        }), timeoutMs);
      })
    ]);
  } catch (err) {
    dashboard = {
      unavailable: true,
      unavailableReason: err?.message || 'Fundamentals fetch failed',
      calendar: { events: [] }
    };
  }
  if (dashboard?.unavailable) {
    addLog('warn', 'Fundamentals data unavailable', dashboard?.unavailableReason || '');
  } else if (dashboard?.stale) {
    addLog('warn', 'Fundamentals live fetch failed', dashboard?.staleReason || 'Using cached real data');
  }
  return dashboard;
}));

ipcMain.handle('fundamentals:analyzeHeadlineAi', ensureLicensed(async (_, payload = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const focus = payload?.focus || {};
  const prior = Array.isArray(payload?.prior) ? payload.prior : [];
  return analyzeHeadlineWithContext(focus, prior, settings);
}));

ipcMain.handle('fundamentals:getDigestAi', ensureLicensed(async (_, payload = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
  return summarizeFundamentalsDigest(context, settings);
}));

ipcMain.handle('trades:refresh', ensureLicensed(async () => {
  const result = requestMt5Sync('manual');
  if (!result.success && result.reason === 'MT5_NOT_CONNECTED') {
    addLog('warn', 'Refresh skipped: MT5 not connected');
  }
  return result;
}));

// ─── Settings IPC Handlers ─────────────────────────────────────────────────--

/** Prefer in-memory MT5 snapshot; fall back to persisted store after restart before ACCOUNT_SNAPSHOT arrives. */
function getMt5AccountSnapshotForSizing() {
  const snap = mt5AccountSnapshot || store.get('mt5AccountSnapshot', null);
  return snap && typeof snap === 'object' ? snap : {};
}

/** Keep `signal.entry` aligned with execution-entry mode whenever `signalEntry` holds the Telegram line. */
function normalizeExecutionEntryAfterSizing(signal, settings) {
  const s = signal;
  if (!s || !(s.signalEntry != null && Number(s.signalEntry) > 0)) return s;
  if (Number(s.spreadEntryOffsetPips) > 0) return s;
  const anchor = executionEntryForLotSizing(s, settings);
  if (Number.isFinite(anchor) && anchor > 0) s.entry = anchor;
  return s;
}

// normalizeSettingsSymbolMappings / buildManagementControlPayload / getDefaultSettings
// live in settingsSchema.js (imported at the top of this file).

ipcMain.handle('settings:getDefaults', ensureLicensed(async () => {
  // Fresh factory defaults — keeps instance/port identity so a reset never
  // silently rebinds the EA bridge.
  const current = store.get('settings', {});
  const defaults = getDefaultSettings();
  return {
    ...defaults,
    serverPort: current?.serverPort ?? defaults.serverPort,
    tcpBindHost: current?.tcpBindHost ?? defaults.tcpBindHost,
    eaSharedSecret: current?.eaSharedSecret ?? defaults.eaSharedSecret,
    instanceId: current?.instanceId ?? defaults.instanceId,
    instanceLabel: current?.instanceLabel ?? defaults.instanceLabel
  };
}));

ipcMain.handle('settings:get', ensureLicensed(async () => {
  const raw = store.get('settings', getDefaultSettings());
  const normalized = normalizeSettingsSymbolMappings(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    store.set('settings', normalized);
  }
  return normalized;
}));

ipcMain.handle('onboarding:getStatus', ensureLicensed(async () => {
  const settings = store.get('settings', getDefaultSettings());
  return {
    completed: settings?.onboardingCompleted || false,
    currentStep: settings?.onboardingStep || 0
  };
}));

ipcMain.handle('onboarding:complete', ensureLicensed(async (_, step) => {
  const settings = store.get('settings', getDefaultSettings());
  if (step === 'finish') {
    settings.onboardingCompleted = true;
    settings.onboardingStep = 0;
  } else {
    settings.onboardingStep = step;
  }
  store.set('settings', settings);
  return { success: true };
}));

ipcMain.handle('onboarding:skip', ensureLicensed(async (_, opts = {}) => {
  const persist = opts?.persist !== false;
  if (!persist) {
    return { success: true, persisted: false };
  }
  const settings = store.get('settings', getDefaultSettings());
  settings.onboardingCompleted = true;
  settings.onboardingStep = 0;
  store.set('settings', settings);
  return { success: true, persisted: true };
}));

ipcMain.handle('settings:save', ensureLicensed(async (_, settings) => {
  const normalized = normalizeSettingsSymbolMappings(settings);
  store.set('settings', normalized);
  configureMt4FileBridgeFromSettings(normalized);
  bridgeRouter.sendControl('SETTINGS_UPDATE', buildManagementControlPayload(normalized));
  bridgeRouter.recordSettingsUpdate(buildManagementControlPayload(normalized));
  scheduleDailyReportAfterEodLoop();
  scheduleWeeklyReportLoop();
  scheduleMonthlyReportLoop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:updated', normalized);
  }
  return { success: true, settings: normalized };
}));

ipcMain.handle('storage:getInfo', ensureLicensed(async () => {
  return {
    dataRoot: store?.dataRoot || '',
    dataFile: store?.dataFile || '',
    accountsRoot: tradeStore?.accountsRoot || '',
    instance: APP_INSTANCE.isNamedInstance ? {
      id: APP_INSTANCE.id,
      label: APP_INSTANCE.label,
      defaultTcpPort: APP_INSTANCE.defaultTcpPort,
    } : null,
  };
}));

ipcMain.handle('instance:getInfo', async () => ({
  id: APP_INSTANCE.id || null,
  label: APP_INSTANCE.label || null,
  defaultTcpPort: APP_INSTANCE.defaultTcpPort,
  isNamedInstance: APP_INSTANCE.isNamedInstance,
  dataRoot: store?.dataRoot || '',
}));

ipcMain.handle('storage:openDataFolder', ensureLicensed(async () => {
  const target = store?.dataRoot || '';
  if (!target) return { success: false, reason: 'DATA_ROOT_MISSING' };
  const err = await shell.openPath(target);
  return err ? { success: false, reason: err } : { success: true, path: target };
}));

function reloadElectronStoreFromDisk() {
  const filePath = store?.path || store?.dataFile || '';
  if (!filePath || !fs.existsSync(filePath)) return;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  store.store = parsed && typeof parsed === 'object' ? parsed : {};
}

function listDataBackupAccounts() {
  const dataRoot = store?.dataRoot || '';
  const folderKeys = listAccountFolderKeys(dataRoot);
  const knownByFolder = new Map();
  for (const account of getKnownMt5Accounts()) {
    knownByFolder.set(sanitizeAccountKey(account.key), account);
  }
  return folderKeys.map((folderKey) => {
    const known = knownByFolder.get(folderKey);
    const login = String(known?.login || '').trim();
    const server = String(known?.server || '').trim();
    const name = String(known?.name || '').trim();
    let label = folderKey;
    if (name) label = name;
    else if (login && server) label = `${login} @ ${server}`;
    else if (login) label = login;
    return {
      key: folderKey,
      label,
      login,
      server,
      name
    };
  });
}

ipcMain.handle('storage:listBackupAccounts', ensureLicensed(async () => ({
  accounts: listDataBackupAccounts()
})));

ipcMain.handle('storage:exportDataZip', ensureLicensed(async (_, opts = {}) => {
  const dataRoot = store?.dataRoot || '';
  if (!dataRoot || !fs.existsSync(dataRoot)) {
    return { success: false, reason: 'DATA_ROOT_MISSING' };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const parentDir = path.dirname(dataRoot);
  const defaultPath = path.join(parentDir, `TradeStation-backup-${stamp}.zip`);
  const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
    title: 'Save Trade Station data backup',
    defaultPath,
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false, canceled: true };
  }
  let zipPath = String(saveResult.filePath || '').trim();
  if (!zipPath) return { success: false, reason: 'ZIP_PATH_MISSING' };
  if (!/\.zip$/i.test(zipPath)) zipPath += '.zip';

  const licenseStatus = getLicenseStatus(store);
  const includeAccountKeys = Array.isArray(opts?.includeAccountKeys) ? opts.includeAccountKeys : null;
  const exported = await exportDataRootToZip({
    dataRoot,
    zipPath,
    appVersion: app.getVersion?.() || licenseStatus?.appVersion || '1.1.0',
    deviceId: licenseStatus?.deviceId || '',
    includeAccountKeys
  });
  addLog('success', 'Data backup exported', zipPath);
  return {
    success: true,
    canceled: false,
    ...exported
  };
}));

ipcMain.handle('storage:importDataZip', ensureLicensed(async () => {
  const dataRoot = store?.dataRoot || '';
  if (!dataRoot) return { success: false, reason: 'DATA_ROOT_MISSING' };

  const pickResult = await dialog.showOpenDialog(mainWindow || undefined, {
    title: 'Restore Trade Station data from backup ZIP',
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    properties: ['openFile']
  });
  if (pickResult.canceled || !pickResult.filePaths?.length) {
    return { success: false, canceled: true };
  }
  const zipPath = String(pickResult.filePaths[0] || '').trim();
  if (!zipPath) return { success: false, reason: 'ZIP_PATH_MISSING' };

  const confirm = await dialog.showMessageBox(mainWindow || undefined, {
    type: 'warning',
    buttons: ['Cancel', 'Restore backup'],
    defaultId: 0,
    cancelId: 0,
    title: 'Restore data backup',
    message: 'Restore data from this ZIP?',
    detail:
      'Files from the backup will be merged into your live data folder. Matching files are overwritten; nothing is deleted.\n\n'
      + 'A safety backup of your current data is created first.'
  });
  if (confirm.response !== 1) {
    return { success: false, canceled: true };
  }

  const licenseStatus = getLicenseStatus(store);
  const restored = await importDataZipToRoot({
    dataRoot,
    zipPath,
    createSafetyBackup: true,
    appVersion: app.getVersion?.() || licenseStatus?.appVersion || '1.1.0',
    deviceId: licenseStatus?.deviceId || ''
  });

  reloadElectronStoreFromDisk();
  tradeStore.invalidateCache?.();
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  configureMt4FileBridgeFromSettings(settings);
  bridgeRouter.sendControl('SETTINGS_UPDATE', buildManagementControlPayload(settings));
  bridgeRouter.recordSettingsUpdate(buildManagementControlPayload(settings));
  const tradeCount = getStoredTrades().length;

  addLog(
    'success',
    'Data backup restored',
    `${restored.copied} files merged (${restored.overwritten} overwritten)`
  );

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:updated', settings);
    mainWindow.webContents.send('data:restored', {
      ...restored,
      tradeCount
    });
  }

  return {
    success: true,
    canceled: false,
    ...restored,
    tradeCount
  };
}));

ipcMain.handle('connections:getAll', ensureLicensed(async () => {
  return redactConnectionsForRenderer(getBrokerConnections());
}));

ipcMain.handle('connections:upsert', ensureLicensed(async (_evt, payload = {}) => {
  const nextRow = normalizeBrokerConnection(payload || {});
  const rows = getBrokerConnections();
  const idx = rows.findIndex((row) => row.id === nextRow.id);
  if (idx >= 0) {
    // Renderer never receives the stored password; an empty submit means "keep it".
    if (!nextRow.auth.password && rows[idx]?.auth?.password) {
      nextRow.auth.password = rows[idx].auth.password;
    }
    rows[idx] = { ...rows[idx], ...nextRow, id: rows[idx].id, createdAt: rows[idx].createdAt };
  } else {
    rows.push(nextRow);
  }
  const saved = saveBrokerConnections(rows);
  if (mainWindow) mainWindow.webContents.send('connections:changed', redactConnectionsForRenderer(saved));
  const [connection] = redactConnectionsForRenderer([idx >= 0 ? rows[idx] : nextRow]);
  return { success: true, connection };
}));

ipcMain.handle('connections:delete', ensureLicensed(async (_evt, id = '') => {
  const key = String(id || '').trim();
  if (!key) return { success: false, reason: 'ID_REQUIRED' };
  const rows = getBrokerConnections();
  const next = rows.filter((row) => row.id !== key);
  const saved = saveBrokerConnections(next);
  if (mainWindow) mainWindow.webContents.send('connections:changed', redactConnectionsForRenderer(saved));
  return { success: true, deleted: rows.length - next.length };
}));

ipcMain.handle('connections:test', ensureLicensed(async (_evt, id = '') => {
  const key = String(id || '').trim();
  if (!key) return { success: false, reason: 'ID_REQUIRED' };
  const rows = getBrokerConnections();
  const idx = rows.findIndex((row) => row.id === key);
  if (idx < 0) return { success: false, reason: 'NOT_FOUND' };
  const row = rows[idx];
  const nowIso = new Date().toISOString();
  const login = String(row?.auth?.login || '').trim();
  const server = String(row?.auth?.server || '').trim();
  if (!login || !server || !String(row?.auth?.password || '').trim()) {
    row.status = 'Missing Credentials';
  } else if (row.provider === 'MT5') {
    const live = currentMt5Account || {};
    const sameAccount = String(live.login || '').trim() === login
      && String(live.server || '').trim() === server;
    row.status = sameAccount && !!bridgeRouter.getStatus()?.connected ? 'Connected' : 'Saved';
  } else {
    // MT4 bridge is not wired yet; keep honest status.
    row.status = 'Saved';
  }
  row.lastUpdate = nowIso;
  row.nextUpdate = null;
  rows[idx] = normalizeBrokerConnection(row);
  const saved = saveBrokerConnections(rows);
  if (mainWindow) mainWindow.webContents.send('connections:changed', redactConnectionsForRenderer(saved));
  const [connection] = redactConnectionsForRenderer([rows[idx]]);
  return { success: true, status: rows[idx].status, connection };
}));

// ─── Cloud Bridge IPC ────────────────────────────────────────────────────────

ipcMain.handle('cloudBridge:getConfig', ensureLicensed(async () => {
  // Bearer token stays main-process-only; the renderer only needs to know one exists.
  const { token, ...rest } = getCloudBridgeSettings();
  return { ...rest, hasToken: !!token };
}));

ipcMain.handle('cloudBridge:saveConfig', ensureLicensed(async (_evt, patch = {}) => {
  const settings = store.get('settings', getDefaultSettings());
  const next = {
    ...settings,
    cloudBridge: {
      ...(settings.cloudBridge || {}),
      ...patch
    }
  };
  store.set('settings', next);
  configureCloudBridgeFromSettings();
  return { success: true, config: getCloudBridgeSettings() };
}));

ipcMain.handle('cloudBridge:ensureToken', ensureLicensed(async () => {
  const token = await ensureCloudToken();
  return { success: true, token };
}));

async function ensureCloudRowReady(connectionId) {
  const id = String(connectionId || '').trim();
  if (!id) return { success: false, reason: 'ID_REQUIRED' };
  const rows = getBrokerConnections();
  const row = rows.find((r) => r.id === id);
  if (!row) return { success: false, reason: 'NOT_FOUND' };

  await ensureCloudToken();
  configureCloudBridgeFromSettings();

  let cloudAccountId = row.cloudAccountId;
  if (!cloudAccountId) {
    const acc = await cloudBridge.createAccount({
      name: row.name,
      platform: row.provider === 'MT4' ? 'mt4' : 'mt5',
      login: row.auth.login,
      server: row.auth.server,
      password: row.auth.password,
      region: row.region || 'eu-west',
      mode: row.mode || 'full'
    });
    cloudAccountId = acc.id;
    updateConnectionCloudState(id, { cloudAccountId, transport: 'cloud', cloudState: acc.state || 'CREATED' });
  }

  let remote = null;
  try {
    remote = await cloudBridge.getAccount(cloudAccountId);
  } catch {
    remote = null;
  }

  if (!remote || remote.state === 'STOPPED' || remote.state === 'CREATED') {
    remote = await cloudBridge.deployAccount(cloudAccountId);
    updateConnectionCloudState(id, { cloudState: remote.state || 'DEPLOYING', transport: 'cloud' });
    // Allow worker to pick up DEPLOY job before sync
    await new Promise((r) => setTimeout(r, 2500));
  }

  const wsStatus = cloudBridge.getStatus();
  if (!wsStatus.connected || wsStatus.accountId !== cloudAccountId) {
    const connected = await cloudBridge.connect(cloudAccountId);
    if (!connected?.success) {
      return { success: false, reason: connected?.reason || 'WS_CONNECT_FAILED', row, cloudAccountId };
    }
  }

  bridgeRouter.setPreferCloud(true);
  updateConnectionCloudState(id, { cloudState: remote?.state === 'CONNECTED' ? 'CONNECTED' : (remote?.state || 'DEPLOYING') });
  return { success: true, row: { ...row, cloudAccountId }, cloudAccountId, remote };
}

ipcMain.handle('cloudBridge:deploy', ensureLicensed(async (_evt, connectionId = '') => {
  const ready = await ensureCloudRowReady(connectionId);
  if (!ready.success) return ready;
  return {
    success: true,
    account: ready.remote,
    connected: { success: true, accountId: ready.cloudAccountId }
  };
}));

ipcMain.handle('cloudBridge:stop', ensureLicensed(async (_evt, connectionId = '') => {
  const id = String(connectionId || '').trim();
  const rows = getBrokerConnections();
  const row = rows.find((r) => r.id === id);
  if (!row?.cloudAccountId) return { success: false, reason: 'NO_CLOUD_ACCOUNT' };
  await ensureCloudToken();
  const stopped = await cloudBridge.stopAccount(row.cloudAccountId);
  cloudBridge.disconnect();
  bridgeRouter.setPreferCloud(false);
  updateConnectionCloudState(id, { cloudState: stopped.state || 'STOPPED' });
  return { success: true, account: stopped };
}));

ipcMain.handle('cloudBridge:restart', ensureLicensed(async (_evt, connectionId = '') => {
  const id = String(connectionId || '').trim();
  const rows = getBrokerConnections();
  const row = rows.find((r) => r.id === id);
  if (!row?.cloudAccountId) return { success: false, reason: 'NO_CLOUD_ACCOUNT' };
  await ensureCloudToken();
  const restarted = await cloudBridge.restartAccount(row.cloudAccountId);
  updateConnectionCloudState(id, { cloudState: restarted.state || 'DEPLOYING' });
  const connected = await cloudBridge.connect(row.cloudAccountId);
  bridgeRouter.setPreferCloud(true);
  return { success: true, account: restarted, connected };
}));

ipcMain.handle('cloudBridge:sync', ensureLicensed(async (_evt, connectionId = '') => {
  const ready = await ensureCloudRowReady(connectionId);
  if (!ready.success) return ready;

  const { row, cloudAccountId } = ready;
  const accountKey = `${String(row.auth?.login || '').trim()}@${String(row.auth?.server || '').trim()}`;
  const settings = store.get('settings', getDefaultSettings());
  const plan = buildSyncRequestPayload(settings, accountKey);

  const sent = cloudBridge.sendControl('SYNC_REQUEST', plan.payload);
  if (!sent) {
    return { success: false, reason: 'SYNC_SEND_FAILED' };
  }

  try {
    await cloudBridge.syncAccount(cloudAccountId);
  } catch {
    /* worker job is optional fallback */
  }

  if (accountKey && accountKey !== '@') {
    markAccountSynced(accountKey, {
      lastSyncRequestReason: 'cloud-manual',
      lastSyncRequestAt: new Date().toISOString()
    });
  }

  updateConnectionCloudState(connectionId, { cloudState: 'CONNECTED' });
  addLog('info', 'Cloud sync requested', `${row.name || accountKey} → ${plan.summary}`);
  return { success: true, accountKey, summary: plan.summary };
}));

ipcMain.handle('cloudBridge:credentialLink', ensureLicensed(async (_evt, connectionId = '') => {
  const id = String(connectionId || '').trim();
  const rows = getBrokerConnections();
  const row = rows.find((r) => r.id === id);
  if (!row?.cloudAccountId) return { success: false, reason: 'NO_CLOUD_ACCOUNT' };
  await ensureCloudToken();
  const url = await cloudBridge.getCredentialLink(row.cloudAccountId);
  return { success: true, url };
}));

// ─── TCP IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('tcp:status', ensureLicensed(async () => {
  return bridgeRouter.getStatus();
}));

ipcMain.handle('mt5:getAccountSnapshot', ensureLicensed(async () => {
  return mt5AccountSnapshot;
}));

ipcMain.handle('mt5:getCurrentAccount', ensureLicensed(async () => {
  if (currentMt5Account?.key) return currentMt5Account;
  return store.get('currentMt5Account', null);
}));

ipcMain.handle('mt5:getKnownAccounts', ensureLicensed(async () => {
  return getKnownMt5Accounts();
}));

ipcMain.handle('mt5:forgetKnownAccount', ensureLicensed(async (_evt, accountKey) => {
  return forgetKnownMt5Account(accountKey);
}));

ipcMain.handle('marketHistory:getBars', ensureLicensed(async (_evt, query = {}) => {
  const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));
  const st = bridgeRouter.getStatus();
  return getMarketBars(
    {
      brokerSymbol: query.symbol,
      resolutionMinutes: query.resolutionMinutes ?? 5,
      fromIso: query.from,
      toIso: query.to
    },
    {
      settings,
      dataRoot: store.dataRoot,
      tcpConnected: !!st?.connected,
      requestMt5History: (p) => bridgeRouter.requestMt5History(p)
    }
  );
}));

// ─── Logs IPC Handlers ───────────────────────────────────────────────────────

ipcMain.handle('logs:getAll', ensureLicensed(async () => logBuffer));

ipcMain.handle('logs:clear', ensureLicensed(async () => {
  logBuffer = [];
  return { success: true };
}));

// ─── Notifications history IPC ───────────────────────────────────────────────
ipcMain.handle('notifications:getHistory', ensureLicensed(async () => {
  return getNotificationHistory();
}));

ipcMain.handle('notifications:clearHistory', ensureLicensed(async () => {
  saveNotificationHistory([]);
  return { success: true };
}));

ipcMain.handle('notifications:removeByIds', ensureLicensed(async (_, ids = []) => {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)));
  if (idSet.size === 0) return { success: true, removed: 0 };
  const history = getNotificationHistory();
  const next = history.filter((entry) => !idSet.has(String(entry?.id || '')));
  const removed = history.length - next.length;
  saveNotificationHistory(next);
  return { success: true, removed };
}));

ipcMain.handle('notifications:markRead', ensureLicensed(async (_, ids = [], read = true) => {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)));
  if (idSet.size === 0) return { success: true, updated: 0 };
  const history = getNotificationHistory();
  let updated = 0;
  const next = history.map((entry) => {
    if (!idSet.has(String(entry?.id || ''))) return entry;
    updated += 1;
    return { ...entry, read: !!read };
  });
  saveNotificationHistory(next);
  return { success: true, updated };
}));

// ─── License IPC Handlers ────────────────────────────────────────────────────
ipcMain.handle('license:getStatus', async () => {
  refreshLicenseState();
  return getPublicLicenseStatus();
});

ipcMain.handle('license:activate', async (_, token) => {
  const result = activateLicense(store, token);
  refreshLicenseState();
  ensureTcpBridgeStarted();
  configureMt4FileBridgeFromSettings(normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings())));
  if (licenseState.licensed) {
    resetExpiryWarnings(store);
    ensureLicensedServicesStarted();
    startListening();
  }
  return {
    success: !!result.ok,
    reason: result.reason || licenseState.reason,
    license: getPublicLicenseStatus(),
  };
});

function sumTodayClosedPnlSafe(trades = []) {
  try {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let sum = 0;
    for (const t of trades || []) {
      if (!t) continue;
      const status = String(t.status || '').toUpperCase();
      const closedish = status.includes('CLOSED') || status.includes('TP_HIT') || status.includes('SL_HIT');
      if (!closedish) continue;
      const when = t.closeTime || t.closedAt || t.lastUpdateAt;
      if (!when) continue;
      const d = new Date(when);
      if (Number.isNaN(d.getTime())) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (k !== day) continue;
      const p = Number(t.profit);
      if (Number.isFinite(p)) sum += p;
    }
    return sum;
  } catch (_) {
    return 0;
  }
}

function attachTradeRiskFields(trade, signal) {
  if (!trade) return;
  const symbol = trade.symbol || signal?.symbol;
  const entry = Number(signal?.entry) || Number(trade.entry);
  const sl = Number(signal?.sl) || Number(trade.sl);
  const lot = Number(signal?.lot) || Number(trade.lot);
  const tpRaw = Array.isArray(signal?.tp) ? signal.tp[0] : (trade.tp ?? signal?.tp);
  const riskUsd = computeTradeRiskUsd(
    symbol,
    entry,
    sl,
    lot,
    Number(signal?.usdPerPipPerLot) > 0 ? Number(signal.usdPerPipPerLot) : undefined
  );
  const plannedRR = computePlannedRR(entry, sl, tpRaw);
  if (riskUsd != null) trade.riskUsd = riskUsd;
  if (plannedRR != null) trade.plannedRR = plannedRR;
}

function maybeSetRealizedR(trade) {
  const risk = Number(trade?.riskUsd);
  const profit = Number(trade?.profit);
  if (Number.isFinite(risk) && risk > 0 && Number.isFinite(profit)) {
    trade.realizedR = Math.round((profit / risk) * 1000) / 1000;
  }
}

/** Cap slow guard I/O so Telegram→MT5 path stays sub-second when caches are warm. */
function promiseWithTimeout(promise, ms, fallback) {
  const cap = Number(ms);
  if (!Number.isFinite(cap) || cap <= 0) return Promise.resolve(promise);
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), cap))
  ]);
}

/**
 * Close-keyword command from Telegram ("close", "close all", optionally with a
 * symbol): send CLOSE_TRADE to the EA for every live position opened from this
 * channel. The EA's normal close-update pipeline (OnTradeTransaction) records
 * the final CLOSED_* status.
 */
const CLOSEABLE_STATUSES = new Set(['SENT', 'EXECUTED', 'POSITION_UPDATE', 'OPEN', 'LIVE', 'DISPATCHED', 'SUBMITTED']);

function handleCloseKeywordCommand(closeCmd, channelName) {
  const scope = closeCmd.symbol ? `${closeCmd.symbol} ` : '';
  addLog('info', `🔒 Close command from [${channelName}]: "${closeCmd.keyword}"`, `${scope}matching open trades`.trim());

  const trades = getStoredTrades();
  const targets = trades.filter((t) => {
    if (!t || String(t.channel || '') !== String(channelName)) return false;
    const st = String(t.status || '').toUpperCase();
    if (isClosedStatus(st) || st.includes('BLOCKED') || st.startsWith('FAILED') || st === 'CLOSING') return false;
    if (!CLOSEABLE_STATUSES.has(st)) return false;
    if (closeCmd.symbol && !symbolsLikelySame(t.symbol, closeCmd.symbol)) return false;
    return Boolean(cleanBrokerId(t.mt5PositionId) || cleanBrokerId(t.mt5Ticket));
  });

  if (targets.length === 0) {
    addLog('info', `Close command: no matching open trades for [${channelName}]${closeCmd.symbol ? ` (${closeCmd.symbol})` : ''}`);
    return;
  }
  if (!bridgeRouter.getStatus()?.connected) {
    addLog('warn', 'Close command skipped — MT5 offline', `${targets.length} trade(s) not closed`);
    return;
  }

  let sent = 0;
  for (const t of targets) {
    const ticket = cleanBrokerId(t.mt5PositionId) || cleanBrokerId(t.mt5Ticket);
    const ok = bridgeRouter.sendControl('CLOSE_TRADE', { ticket });
    if (ok === false) {
      addLog('warn', `CLOSE_TRADE not sent (bridge unavailable) — ${t.symbol}`, `ticket ${ticket}`);
      continue;
    }
    sent += 1;
    t.status = 'CLOSING';
    t.lastUpdateAt = new Date().toISOString();
    addLog('info', `🔒 CLOSE_TRADE sent → ${t.type} ${t.symbol}`, `ticket ${ticket}`);
    if (mainWindow) mainWindow.webContents.send('trade:update', t);
  }
  if (sent > 0) saveStoredTrades(trades);
  addLog('success', `Close command executed: ${sent}/${targets.length} close request(s) sent to MT5`);
}

/**
 * Trade-management keyword command from Telegram: partial close ("close half",
 * "partials 30%") or move SL to break-even ("BE", "sl to entry"). Targets the
 * same open trades a close keyword would, scoped to this channel (and symbol
 * when the message names one).
 */
function handleManagementKeywordCommand(cmd, channelName) {
  const isBreakEven = cmd.action === 'break_even';
  const label = isBreakEven ? 'Break-even' : `Partial close ${cmd.percent}%`;
  const scope = cmd.symbol ? `${cmd.symbol} ` : '';
  addLog('info', `🛠️ ${label} command from [${channelName}]: "${cmd.keyword}"`, `${scope}matching open trades`.trim());

  const trades = getStoredTrades();
  const targets = trades.filter((t) => {
    if (!t || String(t.channel || '') !== String(channelName)) return false;
    const st = String(t.status || '').toUpperCase();
    if (isClosedStatus(st) || st.includes('BLOCKED') || st.startsWith('FAILED') || st === 'CLOSING') return false;
    if (!CLOSEABLE_STATUSES.has(st)) return false;
    if (cmd.symbol && !symbolsLikelySame(t.symbol, cmd.symbol)) return false;
    return Boolean(cleanBrokerId(t.mt5PositionId) || cleanBrokerId(t.mt5Ticket));
  });

  if (targets.length === 0) {
    addLog('info', `${label}: no matching open trades for [${channelName}]${cmd.symbol ? ` (${cmd.symbol})` : ''}`);
    return;
  }
  if (!bridgeRouter.getStatus()?.connected) {
    addLog('warn', `${label} skipped — MT5 offline`, `${targets.length} trade(s) untouched`);
    return;
  }

  let sent = 0;
  for (const t of targets) {
    const ticket = cleanBrokerId(t.mt5PositionId) || cleanBrokerId(t.mt5Ticket);
    let ok;
    if (isBreakEven) {
      // slToEntry: the EA sets SL to each position's own open price, so multi-TP
      // sub-positions each get their exact entry (the app's entry may be stale).
      ok = bridgeRouter.sendControl('MODIFY_TRADE', { ticket, tradeId: t.id, slToEntry: true, applyAll: true });
    } else {
      ok = bridgeRouter.sendControl('CLOSE_TRADE', { ticket, percent: cmd.percent });
    }
    if (ok === false) {
      addLog('warn', `${label} not sent (bridge unavailable) — ${t.symbol}`, `ticket ${ticket}`);
      continue;
    }
    sent += 1;
    t.lastUpdateAt = new Date().toISOString();
    addLog('info', `🛠️ ${label} sent → ${t.type} ${t.symbol}`, `ticket ${ticket}`);
    if (mainWindow) mainWindow.webContents.send('trade:update', t);
  }
  if (sent > 0) saveStoredTrades(trades);
  addLog('success', `${label} executed: ${sent}/${targets.length} request(s) sent to MT5`);
}

// ─── Signal listener setup ───────────────────────────────────────────────────
function startListening() {
  if (!licenseState?.licensed) return;
  try {
    telegramClient.removeAllMessageHandlers();
  } catch (_) {
    /* noop */
  }
  const signalParser = require('./signalParser');

  handleTelegramIncomingMessage = async (message, channelName, extra = {}) => {
    const enabledChannels = store.get('enabledChannels', []);
    const settings = normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings()));

    if (extra?.edited) {
      addLog('info', `✏️ Edited message from [${channelName}]`, String(message || '').slice(0, 80) || '(image-only)');
      // Try to map message id → trade id and emit a MODIFY control. Best-effort; the EA
      // can ignore unknown trade ids cleanly.
      try {
        const trades = getStoredTrades();
        const candidate = trades.find((t) => t?.tgMessageId === extra.messageId && String(t?.channel || '') === String(channelName));
        if (candidate) {
          const reparsed = require('./signalParser').parse(message, channelName, settings);
          if (reparsed) {
            const tps = (Array.isArray(reparsed.tp) ? reparsed.tp : [reparsed.tp])
              .map((v) => Number(v))
              .filter((v) => Number.isFinite(v) && v > 0);
            bridgeRouter.sendControl('MODIFY_TRADE', {
              tradeId: candidate.id,
              symbol: reparsed.symbol,
              sl: reparsed.sl || null,
              tp: tps[0] ?? null,
              // Multi-TP trades open one position per TP; the EA maps tps[i]
              // to the i-th position carrying this tradeId (open order).
              tps,
              cancelPending: false
            });
            addLog('success', `🔧 MODIFY sent for trade #${candidate.id}`,
              `SL:${reparsed.sl ?? '—'} TP:${tps.length ? tps.join('/') : '—'}`);
          }
        }
      } catch (modErr) {
        addLog('warn', 'MODIFY dispatch failed', modErr?.message || String(modErr));
      }
      return;
    }

    addLog('info', `📨 Message from [${channelName}]`, String(message || '').slice(0, 80) || '(image-only)');

    // Telegram redeliveries / reconnect replays: a trade for this exact message already exists.
    if (signalPipeline.isDuplicateTelegramSignal(getStoredTrades(), {
      messageId: extra?.messageId,
      channelName
    })) {
      addLog('info', `Duplicate Telegram message #${extra.messageId} from [${channelName}] — skipping (trade already recorded)`);
      return;
    }

    // Concurrent-delivery guard: the PENDING row that isDuplicateTelegramSignal
    // checks is written late in this async pipeline, so two near-simultaneous
    // deliveries of the same message could both get here. Reserve the key now.
    const inFlightKey = (extra?.messageId !== undefined && extra?.messageId !== null && extra?.messageId !== '')
      ? `${channelName}::${extra.messageId}`
      : null;
    if (inFlightKey) {
      const now = Date.now();
      for (const [k, ts] of inFlightSignalKeys) {
        if (now - ts > IN_FLIGHT_SIGNAL_TTL_MS) inFlightSignalKeys.delete(k);
      }
      const reservedAt = inFlightSignalKeys.get(inFlightKey);
      if (reservedAt && now - reservedAt <= IN_FLIGHT_SIGNAL_TTL_MS) {
        addLog('info', `Duplicate Telegram message #${extra.messageId} from [${channelName}] — already processing, skipping`);
        return;
      }
      inFlightSignalKeys.set(inFlightKey, now);
    }

    // Management keywords (partial close / break-even) run before close keywords:
    // "close half" must not be swallowed by a generic "close" close-keyword.
    const mgmtCmd = signalPipeline.detectManagementCommand(message, {
      partialCloseKeywords: settings?.partialCloseKeywords,
      breakEvenKeywords: settings?.breakEvenKeywords,
      defaultPartialPercent: settings?.partialClosePercentDefault
    });
    if (mgmtCmd.matched) {
      handleManagementKeywordCommand(mgmtCmd, channelName);
      return;
    }

    // Close commands (Settings → Close Keywords) are handled before signal parsing.
    const closeCmd = signalPipeline.detectCloseCommand(message, settings?.closeKeywords);
    if (closeCmd.matched) {
      handleCloseKeywordCommand(closeCmd, channelName);
      return;
    }

    let parsedSignal = signalParser.parse(message, channelName, settings);

    if (!parsedSignal && extra?.imageBuffer && signalAiVision.isAiVisionEnabled(settings)) {
      addLog('info', `🖼️ Trying AI vision parse for image-only signal from [${channelName}]`);
      try {
        const visionResult = await signalAiVision.parseSignalFromImage({
          imageBuffer: extra.imageBuffer,
          mimeType: 'image/jpeg',
          settings
        });
        if (visionResult && !visionResult.error) {
          parsedSignal = {
            ...visionResult,
            // Reuse same downstream path; mark provenance for the activity log.
            channel: channelName
          };
          addLog('success', `🖼️ AI vision extracted ${visionResult.type} ${visionResult.symbol}`,
            `confidence ${(visionResult.visionConfidence * 100).toFixed(0)}%`);
        } else if (visionResult?.error) {
          addLog('warn', 'AI vision parse failed', `${visionResult.error}: ${visionResult.detail || ''}`);
        }
      } catch (visionErr) {
        addLog('warn', 'AI vision parse error', visionErr?.message || String(visionErr));
      }
    }

    if (!parsedSignal) {
      addLog('warn', `No signal parsed from [${channelName}]`);
      return;
    }

    const pipelineRecorder = signalPipeline.createPipelineStageRecorder();
    pipelineRecorder.stamp('parse', `${parsedSignal.type || ''} ${parsedSignal.symbol || ''}`.trim());

    const channelMerge = channelOverrides.applyChannelOverrides(settings, channelName);
    if (channelMerge.channelDisabled) {
      addLog('info', `Channel [${channelName}] disabled by per-channel rules — skipping signal`);
      return;
    }
    const effectiveSettings = applyPerPairOverrides(channelMerge.merged, parsedSignal?.symbol);

    parsedSignal = await attachLiveSpreadForEntryAdjust(
      parsedSignal,
      effectiveSettings,
      (payload) => bridgeRouter.requestMt5Spread(payload)
    );
    if (parsedSignal.spreadPips > 0) {
      addLog(
        'info',
        `📏 Spread ${Number(parsedSignal.spreadPips).toFixed(2)} pips for entry offset (${parsedSignal.symbol})`,
        parsedSignal.spreadEntrySource === 'fallback' ? 'MT5 offline — using fallback pips' : 'live from MT5'
      );
    }

    let signal = applySignalExecutionTransforms(parsedSignal, effectiveSettings);
    signal = applyLotSizingToSignal(signal, effectiveSettings, getMt5AccountSnapshotForSizing());
    signal = normalizeExecutionEntryAfterSizing(signal, effectiveSettings);
    signal.orderType = resolveOrderTypeForSignal(signal, effectiveSettings);
    signal.lot = stealthDelay.applyStealthLotJitter(signal.lot, effectiveSettings);

    const tierLot = drawdownGuardian.applyTierLotReduction(signal, {
      store,
      settings: effectiveSettings,
      accountKey: currentMt5Account?.key || 'unknown',
      accountSnapshot: mt5AccountSnapshot,
      todayClosedPnl: sumTodayClosedPnlSafe(getStoredTrades()),
      logFn: (msg) => addLog('info', msg)
    });
    signal = tierLot.signal;
    const ddTierApplied = tierLot.ddTierApplied;

    if (settings?.notifications?.newSignal !== false) {
      const parts = [`${signal.type} ${signal.symbol}`];
      if (signal.avgEntry != null && Number(signal.avgEntry) > 0) {
        parts.push(`Avg ${Number(signal.avgEntry).toFixed(5)}`);
      }
      const exec = signal.entry != null && Number(signal.entry) > 0 ? Number(signal.entry).toFixed(5) : 'MKT';
      parts.push(`@ ${exec}`);
      if (
        signal.signalEntry != null
        && Number(signal.signalEntry) > 0
        && signal.entry != null
        && Number(signal.entry) > 0
        && Math.abs(Number(signal.signalEntry) - Number(signal.entry)) > 1e-8
      ) {
        parts.push(`(signal ${Number(signal.signalEntry).toFixed(5)})`);
      }
      if (signal.spreadEntryOffsetPips != null && Number(signal.spreadEntryOffsetPips) > 0) {
        parts.push(`spread −${Number(signal.spreadEntryOffsetPips).toFixed(1)}p`);
      }
      sendDesktopNotification('New Signal', parts.join(' '), `signal:${channelName}:${signal.symbol}:${signal.type}`, 4000);
    }

    addLog(
      'success',
      `✅ Signal: ${signal.type} ${signal.symbol} @ ${signal.entry}`,
      `Lot:${signal.lot} SL:${signal.sl} TP:${(signal.tp || []).join('/')}`
    );

    if (mainWindow) mainWindow.webContents.send('signal:new', signal);

    const schedule = evaluateSignalSchedule(settings);
    pipelineRecorder.stamp('schedule', schedule.allowed ? 'Allowed' : (schedule.reason || 'Blocked'));

    const signalFilterBlockRow = {
      symbol: signal.symbol,
      type: signal.type,
      channel: channelName,
      timeframe: signal.timeframe,
      bias: signal.bias,
      vwapBand: signal.vwapBand,
      hvnBand: signal.hvnBand,
      presetTags: signal.presetTags,
      setup: signal.setup,
      trendAlign: signal.trendAlign,
      top1: signal.top1,
      confluence: signal.confluence,
      rejPct: signal.rejPct,
      signalSession: signal.signalSession
    };
    const signalFilterEval = schedule.allowed
      ? evaluateAdvancedSignalBlock(settings, signalFilterBlockRow, new Date())
      : { blocked: false, reason: '' };
    const blockedBySignalFilters = signalFilterEval.blocked === true;
    if (schedule.allowed) {
      pipelineRecorder.stamp(
        'signalFilters',
        blockedBySignalFilters ? (signalFilterEval.reason || 'Blocked') : 'Passed'
      );
    }

    const blockedBySchedule = !schedule.allowed;

    let execGuard = { allowed: true, reason: '', code: '' };
    if (schedule.allowed && !blockedBySignalFilters) {
      try {
        execGuard = evaluateExecutionGuards({
          settings: effectiveSettings,
          signal,
          trades: getStoredTrades(),
          accountSnapshot: mt5AccountSnapshot,
          accountKey: currentMt5Account?.key || 'unknown',
          store,
          helpers: { priceDistancePips }
        });
      } catch (egErr) {
        addLog('warn', 'Execution guard failed', egErr?.message || String(egErr));
        if (signalPipeline.resolveGuardFailMode(effectiveSettings) === 'closed') {
          execGuard = {
            allowed: false,
            reason: `Execution guard error (${egErr?.message || egErr}) — blocked by fail-closed mode`,
            code: 'BLOCKED_GUARD'
          };
        } else {
          execGuard = { allowed: true, reason: '', code: '' };
        }
      }
    }
    const blockedByExec = schedule.allowed && !blockedBySignalFilters && !execGuard.allowed;
    if (schedule.allowed && !blockedBySignalFilters) {
      pipelineRecorder.stamp(
        'execGuards',
        blockedByExec ? (execGuard.reason || 'Blocked') : 'Passed'
      );
    }

    let drawdownHalt = { halted: false, reason: '' };
    if (!blockedBySchedule && !blockedBySignalFilters && !blockedByExec) {
      try {
        drawdownHalt = drawdownGuardian.evaluateGuard({
          store,
          settings: effectiveSettings,
          accountKey: currentMt5Account?.key || 'unknown',
          accountSnapshot: mt5AccountSnapshot,
          todayClosedPnl: sumTodayClosedPnlSafe(getStoredTrades()),
          onTierEscalation: ({ from, to, lossPct }) => {
            const labels = { yellow: 'Yellow', orange: 'Orange', red: 'Red' };
            addLog('warn', `Drawdown tier escalated ${from} → ${to}`, `Daily loss ${lossPct.toFixed(2)}%`);
            if (settings?.notifications?.drawdown !== false) {
              sendDesktopNotification(
                `Drawdown tier: ${labels[to] || to}`,
                `Daily loss ${lossPct.toFixed(2)}% — ${to === 'red' ? 'new signals halted' : 'lot size reduced'}`,
                `dd-tier:${to}:${currentMt5Account?.key || 'unknown'}`,
                10000
              );
            }
          }
        });
        if (drawdownHalt?.staleFallback) {
          addLog('warn', 'Equity snapshot stale (>60s) — drawdown guard using realized P&L fallback');
        }
      } catch (ddErr) {
        addLog('warn', 'Drawdown guardian failed', ddErr?.message || String(ddErr));
      }
    }
    const blockedByDrawdown = drawdownHalt?.halted === true;
    if (!blockedBySchedule && !blockedBySignalFilters && !blockedByExec) {
      pipelineRecorder.stamp(
        'drawdown',
        blockedByDrawdown ? (drawdownHalt.reason || 'Halted') : 'Passed'
      );
    }
    if (blockedByDrawdown) {
      execGuard = { allowed: false, reason: drawdownHalt.reason, code: 'BLOCKED_DRAWDOWN_GUARD' };
    }

    const syncGateOpen = !blockedBySchedule && !blockedBySignalFilters && !blockedByDrawdown && !blockedByExec;

    // Short unique id (base36 time + random suffix) — stays within the EA's
    // "TS:<id>" MQL5 comment truncation (~31 chars) while never colliding when
    // two signals land in the same millisecond.
    const tradeId = signalPipeline.generateTradeId();
    let trades = getStoredTrades();
    let trade = null;
    let earlyTradeEmitted = false;

    if (syncGateOpen) {
      trade = {
        id: tradeId,
        time: new Date().toTimeString().slice(0, 8),
        openedAt: new Date().toISOString(),
        lastUpdateAt: new Date().toISOString(),
        channel: channelName,
        tgMessageId: extra?.messageId ?? null,
        symbol: signal.symbol,
        type: signal.type,
        orderType: signal.orderType || 'MARKET',
        entry: signal.entry,
        sl: signal.sl,
        tp: signal.tp[0] || 0,
        lot: signal.lot || 0,
        timeframe: signal.timeframe || '',
        fundBias: resolveScreenerBiasForSymbol(signal.symbol) || '',
        ...(signal.customFields && typeof signal.customFields === 'object'
          ? (() => {
            const cf = normalizeTradeCustomFields({ customFields: signal.customFields });
            return cf ? { customFields: cf } : {};
          })()
          : {}),
        presetTags: Array.isArray(signal.presetTags)
          ? [...new Set(signal.presetTags.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50)
          : [],
        status: 'PENDING',
        profit: 0,
        accountKey: currentMt5Account?.key || 'unknown',
        accountLogin: currentMt5Account?.login || 'Unknown',
        accountServer: currentMt5Account?.server || '',
        accountName: currentMt5Account?.name || '',
        screenshots: [],
        journal: [],
        blockedReason: '',
        fromTelegramSignal: true,
        pipelineStages: [...pipelineRecorder.stages]
      };
      trades.unshift(trade);
      if (trades.length > 200) trimTradesList(trades);
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:new', trade);
      earlyTradeEmitted = true;
    }

    let newsGuard = { blocked: false, reason: '' };
    let aiVerdict = null;
    let fundamentalsGuard = { verdict: 'WAIT', timedOut: false };
    if (syncGateOpen) {
      const newsPromise = promiseWithTimeout(
        getNewsGuardStatus(settings, { symbol: signal.symbol }).catch((guardErr) => {
          addLog('warn', 'News guard lookup failed', guardErr?.message || String(guardErr));
          return { blocked: false, reason: '' };
        }),
        2000,
        { blocked: false, reason: '', timedOut: true }
      );
      const aiPromise = effectiveSettings?.aiCheck?.enabled === true
        ? promiseWithTimeout(
          aiSignalCheck.checkSignal({
            signal,
            channelName,
            trades: getStoredTrades(),
            newsGuard: { blocked: false },
            settings: effectiveSettings,
            fastPath: true
          }).catch((aiErr) => {
            addLog('warn', 'AI signal-check failed', aiErr?.message || String(aiErr));
            return { action: 'allow', ok: false, score: 0, lotMultiplier: 1 };
          }),
          4000,
          { action: 'allow', ok: false, score: 0, lotMultiplier: 1, timedOut: true }
        )
        : Promise.resolve(null);
      const fundamentalsPromise = effectiveSettings?.enableFundamentalsGate === true
        ? promiseWithTimeout(
          getFundamentalsDashboard(settings, { selectedPair: signal.symbol }).catch((fundErr) => {
            addLog('warn', 'Fundamentals gate lookup failed', fundErr?.message || String(fundErr));
            return { checklist: { verdict: 'WAIT' } };
          }),
          2000,
          { checklist: { verdict: 'WAIT' }, timedOut: true }
        )
        : Promise.resolve(null);
      const [newsResult, aiResult, fundamentalsResult] = await Promise.all([
        newsPromise,
        aiPromise,
        fundamentalsPromise
      ]);
      newsGuard = newsResult || newsGuard;
      aiVerdict = aiResult;
      if (fundamentalsResult) {
        fundamentalsGuard = {
          verdict: fundamentalsResult?.checklist?.verdict || 'WAIT',
          timedOut: fundamentalsResult?.timedOut === true
        };
      }
      pipelineRecorder.stamp(
        'newsGuard',
        newsGuard?.blocked
          ? (newsGuard.reason || 'Blocked')
          : newsGuard?.timedOut
            ? 'Timeout'
            : 'Passed'
      );
      pipelineRecorder.stamp(
        'aiCheck',
        aiVerdict?.action === 'block'
          ? (aiVerdict.summary || `Blocked (${aiVerdict.score || 0}%)`)
          : aiVerdict?.timedOut
            ? 'Timeout'
            : aiVerdict?.ok
              ? `${aiVerdict.score || 0}% → ${aiVerdict.action || 'allow'}`
              : effectiveSettings?.aiCheck?.enabled === true
                ? 'Skipped'
                : 'Off'
      );
      pipelineRecorder.stamp(
        'fundamentalsGate',
        effectiveSettings?.enableFundamentalsGate !== true
          ? 'Off'
          : fundamentalsGuard.verdict === 'NO_GO'
            ? 'NO-GO'
            : fundamentalsGuard.timedOut
              ? 'Timeout'
              : fundamentalsGuard.verdict || 'Passed'
      );
    }

    // Fail-closed mode: a timed-out news/AI/fundamentals check blocks instead of allowing.
    const guardFailMode = signalPipeline.resolveGuardFailMode(effectiveSettings);
    const failClosedReason = syncGateOpen
      ? signalPipeline.evaluateFailClosedTimeouts({
        guardFailMode,
        newsTimedOut: newsGuard?.timedOut === true,
        aiTimedOut: aiVerdict?.timedOut === true,
        // AI enabled but provider errored/rate-limited (not a timeout) — fail-closed blocks too.
        aiUnavailable: aiVerdict != null && aiVerdict.ok === false && aiVerdict.timedOut !== true,
        fundamentalsTimedOut: fundamentalsGuard?.timedOut === true
      })
      : '';
    const blockedByFailClosed = !!failClosedReason;
    if (syncGateOpen && newsGuard?.timedOut) {
      addLog(
        blockedByFailClosed ? 'warn' : 'info',
        blockedByFailClosed
          ? 'News guard timed out — blocking trade (fail-closed mode)'
          : 'News guard skipped (timeout) — allowing trade'
      );
    }
    if (syncGateOpen && aiVerdict?.timedOut) {
      addLog(
        blockedByFailClosed ? 'warn' : 'info',
        blockedByFailClosed
          ? 'AI signal-check timed out — blocking trade (fail-closed mode)'
          : 'AI signal-check skipped (timeout) — allowing trade'
      );
    }
    if (syncGateOpen && fundamentalsGuard?.timedOut) {
      addLog(
        blockedByFailClosed ? 'warn' : 'info',
        blockedByFailClosed
          ? 'Fundamentals gate timed out — blocking trade (fail-closed mode)'
          : 'Fundamentals gate skipped (timeout) — allowing trade'
      );
    }

    const blockedByNews = syncGateOpen && newsGuard?.blocked;
    const blockedByFundamentals = syncGateOpen
      && !blockedByFailClosed
      && effectiveSettings?.enableFundamentalsGate === true
      && fundamentalsGuard.verdict === 'NO_GO';
    if (syncGateOpen && effectiveSettings?.enableFundamentalsGate === true && fundamentalsGuard.verdict === 'WAIT') {
      addLog('info', 'Fundamentals checklist WAIT — allowing trade');
    }

    /** AI signal-check results (ran in parallel with news guard above). */
    if (aiVerdict && syncGateOpen && !blockedByNews && !blockedByFundamentals && !blockedByFailClosed) {
      try {
        if (aiVerdict?.ok) {
          const reasonsText = (aiVerdict.reasons || []).join(' · ');
          addLog(
            aiVerdict.action === 'block' ? 'warn' : 'info',
            `🤖 AI ${aiVerdict.score}% → ${aiVerdict.action}`,
            aiVerdict.summary ? `${aiVerdict.summary}${reasonsText ? ' — ' + reasonsText : ''}` : reasonsText
          );
        } else {
          addLog('warn', 'AI signal-check unreachable, allowing by default', aiVerdict?.error || '');
        }
        if (aiVerdict?.action === 'block') {
          execGuard = {
            allowed: false,
            reason: `AI confidence ${aiVerdict.score}% < ${effectiveSettings?.aiCheck?.minConfidence || 70}% — ${aiVerdict.summary || (aiVerdict.reasons || []).join(', ')}`,
            code: 'BLOCKED_AI_CHECK'
          };
        } else if (aiVerdict?.action === 'reduce' && aiVerdict.lotMultiplier > 0 && aiVerdict.lotMultiplier < 1) {
          const before = Number(signal.lot) || 0;
          signal.lot = Math.max(0.01, Math.round(before * aiVerdict.lotMultiplier * 100) / 100);
          addLog('info', `🤖 AI reducing lot ${before.toFixed(2)} → ${signal.lot.toFixed(2)} (${(aiVerdict.lotMultiplier * 100).toFixed(0)}%)`);
        }
      } catch (aiErr) {
        addLog('warn', 'AI signal-check post-process failed', aiErr?.message || String(aiErr));
      }
    }

    /** Legacy local-heuristic confidence path (kept for users who prefer offline rules). */
    let confidenceResult = null;
    if (syncGateOpen && !blockedByNews && !blockedByFundamentals && !blockedByFailClosed
        && !aiVerdict?.action
        && effectiveSettings?.signalConfidence?.enabled === true) {
      try {
        confidenceResult = signalConfidence.scoreSignal({
          signal,
          trades: getStoredTrades(),
          channelName,
          newsGuard,
          settings: effectiveSettings
        });
        addLog('info', `🤖 Heuristic confidence ${(confidenceResult.score * 100).toFixed(0)}% → ${confidenceResult.action}`,
          confidenceResult.reasons.join(' · '));
        if (confidenceResult.action === 'block') {
          execGuard = { allowed: false, reason: `Confidence too low (${(confidenceResult.score * 100).toFixed(0)}%)`, code: 'BLOCKED_LOW_CONFIDENCE' };
        } else if (confidenceResult.action === 'reduce' && confidenceResult.lotMultiplier > 0 && confidenceResult.lotMultiplier < 1) {
          const before = Number(signal.lot) || 0;
          signal.lot = Math.max(0.01, Math.round(before * confidenceResult.lotMultiplier * 100) / 100);
          addLog('info', `🤖 Reducing lot ${before.toFixed(2)} → ${signal.lot.toFixed(2)} (${(confidenceResult.lotMultiplier * 100).toFixed(0)}%)`);
        }
      } catch (cfErr) {
        addLog('warn', 'Confidence scorer failed', cfErr?.message || String(cfErr));
      }
    }
    const blockedByConfidence = aiVerdict?.action === 'block' || confidenceResult?.action === 'block';

    const initialStatus = blockedBySchedule
      ? 'BLOCKED_SCHEDULE'
      : blockedBySignalFilters
        ? 'BLOCKED_SIGNAL_FILTERS'
        : blockedByNews
          ? 'BLOCKED_HIGH_NEWS'
          : blockedByFundamentals
            ? 'BLOCKED_FUNDAMENTALS'
          : blockedByFailClosed
            ? 'BLOCKED_GUARD'
            : blockedByDrawdown
              ? 'BLOCKED_DRAWDOWN_GUARD'
              : blockedByConfidence
                ? (aiVerdict?.action === 'block' ? 'BLOCKED_AI_CHECK' : 'BLOCKED_LOW_CONFIDENCE')
                : blockedByExec
                  ? (execGuard.code || 'BLOCKED_EXEC_GUARD')
                  : 'PENDING';
    const blockedReason = blockedBySchedule
      ? (schedule.reason || 'Outside trading schedule')
      : blockedBySignalFilters
        ? (signalFilterEval.reason || 'Blocked by advanced signal filters (Settings → Filters)')
        : blockedByNews
          ? (newsGuard.reason || 'Blocked by high-impact news guard')
          : blockedByFundamentals
            ? 'Fundamentals checklist: NO-GO'
          : blockedByFailClosed
            ? failClosedReason
            : blockedByExec
              ? (execGuard.reason || 'Blocked by execution guard')
              : '';

    const tradePayload = {
      id: tradeId,
      time: new Date().toTimeString().slice(0, 8),
      openedAt: trade?.openedAt || new Date().toISOString(),
      lastUpdateAt: new Date().toISOString(),
      channel: channelName,
      tgMessageId: extra?.messageId ?? null,
      ...(aiVerdict?.ok && effectiveSettings?.aiCheck?.persistAnalysisOnTrade !== false ? {
        aiCheck: {
          score: aiVerdict.score,
          action: aiVerdict.action,
          reasons: aiVerdict.reasons || [],
          summary: aiVerdict.summary || '',
          entryVsChart: aiVerdict.entryVsChart || '',
          tfBiasVsStructure: aiVerdict.tfBiasVsStructure || '',
          adjustHint: aiVerdict.adjustHint || '',
          model: effectiveSettings?.aiCheck?.model || 'openai',
          at: new Date().toISOString()
        }
      } : {}),
      symbol: signal.symbol,
      type: signal.type,
      orderType: signal.orderType || 'MARKET',
      entry: signal.entry,
      sl: signal.sl,
      tp: signal.tp[0] || 0,
      lot: signal.lot || 0,
      ...(ddTierApplied ? { ddTierApplied } : {}),
      timeframe: signal.timeframe || '',
      // Snapshot the screener fundamentals bias here too so blocked trades (which
      // skip the early-emit path) keep the same FUND column value as live trades.
      fundBias: resolveScreenerBiasForSymbol(signal.symbol) || '',
      ...(signal.signalEntry != null && Number(signal.signalEntry) > 0 ? { signalEntry: signal.signalEntry } : {}),
      ...(signal.avgEntry != null && signal.avgEntry > 0 ? { avgEntry: signal.avgEntry } : {}),
      ...(String(signal.bias || '').trim() ? { bias: String(signal.bias).trim().slice(0, 200) } : {}),
      ...(String(signal.vwapBand || '').trim()
        ? { vwapBand: String(signal.vwapBand).trim().toLowerCase().replace(/^n\/a$/i, 'na') }
        : {}),
      ...(String(signal.hvnBand || '').trim()
        ? { hvnBand: String(signal.hvnBand).trim().toLowerCase().replace(/^n\/a$/i, 'na') }
        : {}),
      ...(String(signal.trendAlign || '').trim()
        ? { trendAlign: String(signal.trendAlign).trim().toLowerCase().replace(/^n\/a$/i, 'na') }
        : {}),
      ...(String(signal.obSize || '').trim() ? { obSize: String(signal.obSize).trim().slice(0, 80) } : {}),
      ...(Number.isInteger(signal.confluence) ? { confluence: signal.confluence } : {}),
      ...(Number.isFinite(signal.rejPct) ? { rejPct: signal.rejPct } : {}),
      ...(Number.isFinite(signal.obWinRate) ? { obWinRate: signal.obWinRate } : {}),
      ...(signal.top1 === true || signal.top1 === false ? { top1: signal.top1 } : {}),
      ...(String(signal.signalSession || '').trim() ? { signalSession: String(signal.signalSession).trim() } : {}),
      ...(signal.customFields && typeof signal.customFields === 'object'
        ? (() => {
          const cf = normalizeTradeCustomFields({ customFields: signal.customFields });
          return cf ? { customFields: cf } : {};
        })()
        : {}),
      presetTags: Array.isArray(signal.presetTags)
        ? [...new Set(signal.presetTags.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50)
        : [],
      status: initialStatus,
      profit: 0,
      accountKey: currentMt5Account?.key || 'unknown',
      accountLogin: currentMt5Account?.login || 'Unknown',
      accountServer: currentMt5Account?.server || '',
      accountName: currentMt5Account?.name || '',
      screenshots: [],
      journal: buildJournalForNewTradeFromAi(
        aiVerdict,
        !!(aiVerdict?.ok && effectiveSettings?.aiCheck?.persistAnalysisOnTrade !== false)
      ),
      blockedReason,
      ...(newsGuard?.newsContext ? { newsContext: newsGuard.newsContext } : {}),
      fromTelegramSignal: true,
      pipelineStages: [...pipelineRecorder.stages]
    };

    if (earlyTradeEmitted && trade) {
      Object.assign(trade, tradePayload);
    } else {
      trade = tradePayload;
      trades = getStoredTrades();
      trades.unshift(trade);
      if (trades.length > 200) trimTradesList(trades);
    }
    saveStoredTrades(trades);

    if (!earlyTradeEmitted && mainWindow) mainWindow.webContents.send('trade:new', trade);
    else if (earlyTradeEmitted && mainWindow) mainWindow.webContents.send('trade:update', trade);

    if (blockedBySchedule) {
      const details = `${signal.type} ${signal.symbol} — ${schedule.reason || 'schedule'}`;
      addLog('warn', 'Trade blocked by time / schedule filter', details);
      if (settings?.notifications?.signalBlockedBySchedule !== false) {
        sendDesktopNotification('Trade Blocked: Schedule', details, `blocked-schedule:${signal.symbol}`, 12000);
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    if (blockedBySignalFilters) {
      const details = `${signal.type} ${signal.symbol} — ${trade.blockedReason || signalFilterEval.reason || 'advanced filters'}`;
      addLog('warn', 'Trade blocked by advanced signal filters (Settings → Filters)', details);
      if (settings?.notifications?.signalBlockedBySignalFilters !== false) {
        sendDesktopNotification('Trade Blocked: Filters', details, `blocked-filters:${signal.symbol}`, 12000);
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    if (blockedByNews) {
      const details = `${signal.type} ${signal.symbol} blocked • ${trade.blockedReason}`;
      addLog('warn', 'Trade blocked by high-impact news window', details);
      if (settings?.notifications?.signalBlockedByNews !== false) {
        sendDesktopNotification('Trade Blocked: High News', details, `blocked-news:${signal.symbol}`, 12000);
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    if (blockedByFundamentals) {
      const details = `${signal.type} ${signal.symbol} — Fundamentals checklist: NO-GO`;
      addLog('warn', 'Trade blocked by fundamentals gate', details);
      if (settings?.notifications?.signalBlockedByGuard !== false) {
        sendDesktopNotification('Trade Blocked: Fundamentals', details, `blocked-fundamentals:${signal.symbol}`, 10000);
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    if (blockedByFailClosed) {
      const details = `${signal.type} ${signal.symbol} — ${failClosedReason}`;
      addLog('warn', 'Trade blocked by fail-closed guard mode', details);
      if (settings?.notifications?.signalBlockedByGuard !== false) {
        sendDesktopNotification('Trade Blocked: Fail-closed', details, `blocked-failclosed:${signal.symbol}`, 10000);
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    if (blockedByExec) {
      const details = `${signal.type} ${signal.symbol} — ${trade.blockedReason || execGuard.reason}`;
      addLog('warn', 'Trade blocked by execution guard', details);
      if (settings?.notifications?.signalBlockedByGuard !== false) {
        sendDesktopNotification('Trade Blocked: Guard', details, `blocked-guard:${signal.symbol}`, 10000);
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    if (initialStatus !== 'PENDING') {
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);      return;
    }

    attachTradeRiskFields(trade, signal);

    if (signalPipeline.shouldSimulateDispatch({
      dryRunMode: effectiveSettings?.dryRunMode,
      blocked: false,
      status: initialStatus
    })) {
      pipelineRecorder.stamp('dispatch', 'Simulated (dry run)');
      trade.pipelineStages = [...pipelineRecorder.stages];
      trade.status = 'SIMULATED';
      trade.simulated = true;
      trade.lastUpdateAt = new Date().toISOString();
      addLog('info', '🧪 Dry run — signal simulated (not sent to MetaTrader)', `${signal.type} ${signal.symbol} lot ${signal.lot}`);
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);
      return;
    }

    // Attach tradeId to signal so MT5 echoes it back in ACK; RR mode → EA snaps TP to fill (Ask/Bid vs app entry).
    const spreadCapPips = signalPipeline.resolveMaxSpreadPips(effectiveSettings);
    const pendingExpirySeconds = signalPipeline.resolvePendingExpirySeconds(effectiveSettings);
    const tpLotShares = signalPipeline.resolveTpLotShares(effectiveSettings, signal.tp);
    const signalWithId = attachRrSnapForMt5({
      ...signal,
      tradeId: trade.id,
      ...(spreadCapPips > 0 ? { maxSpreadPips: spreadCapPips } : {}),
      ...(pendingExpirySeconds > 0 ? { pendingExpirySeconds } : {}),
      ...(tpLotShares ? { tpLotShares } : {})
    }, effectiveSettings);

    const stealthMs = stealthDelay.getStealthDelayMs(effectiveSettings, channelMerge?.override?.extraDelayMs || 0);
    if (stealthMs > 0) {
      addLog('info', `🕶️ Stealth delay: waiting ${stealthMs}ms before sending`);
      await stealthDelay.sleep(stealthMs);
    }

    // Send to MT5 via TCP
    bridgeRouter.sendSignal(signalWithId, (ack) => {
      pipelineRecorder.stamp('dispatch', String(ack.status || 'unknown'));
      trade.pipelineStages = [...pipelineRecorder.stages];
      applyTradeDispatchCallback(trade, ack);
      if (ack.status === 'DISPATCHED') {
        addLog('info', `📤 Signal dispatched to EA: ${signal.type} ${signal.symbol} (awaiting broker fill)`);
      } else if (ack.status === 'NO_MT5_QUEUED') {
        addLog('warn', `MT5 offline — signal queued: ${signal.symbol}`, JSON.stringify(ack));
      } else {
        addLog('warn', `MT5 dispatch ack: ${ack.status}`, JSON.stringify(ack));
      }
      saveStoredTrades(trades);
      if (mainWindow) mainWindow.webContents.send('trade:update', trade);    });
  };
  telegramClient.onMessage(handleTelegramIncomingMessage);
  telegramClient.startHealthWatchdog();
}

// Loud alerting for Telegram session health — a silently dead session means missed signals.
telegramClient.onSessionState(({ state, detail, attempts }) => {
  const mt5Connected = !!bridgeRouter.getStatus()?.connected;
  if (state === 'reconnecting') {
    addLog('warn', 'Telegram connection lost — auto-reconnecting', `${detail || ''} (attempt ${attempts})`.trim());
    if (mainWindow) mainWindow.webContents.send('connection:status', { telegram: false, mt5: mt5Connected });
    if (attempts >= 2) {
      sendDesktopNotification(
        'Telegram disconnected',
        'Trade Station lost the Telegram connection and is reconnecting. Signals may be missed.',
        'telegram-session:reconnecting',
        5 * 60 * 1000
      );
    }
  } else if (state === 'ok') {
    addLog('success', 'Telegram connection restored');
    if (mainWindow) mainWindow.webContents.send('connection:status', { telegram: true, mt5: mt5Connected });
  } else if (state === 'dead') {
    addLog('error', 'Telegram session is no longer authorized — sign in again', detail || '');
    if (mainWindow) mainWindow.webContents.send('connection:status', { telegram: false, mt5: mt5Connected });
    sendDesktopNotification(
      'Telegram session expired',
      'Your Telegram session was revoked or expired. Open Trade Station and sign in again — signals are NOT being received.',
      'telegram-session:dead',
      10 * 60 * 1000
    );
  }
});

// getDefaultSettings lives in settingsSchema.js; the weekly CSV/PDF pack
// generator lives in reportPackExport.js (both imported at the top of this file).

// ─── TradeZella-parity feature modules ───────────────────────────────────────
// Each feature ships as src/main/<feature>Ipc.js exporting register(ctx).
// Feature agents: replace ONLY your own [anchor:...] line below with
//   require('./<feature>Ipc').register(featureIpcCtx);
// Do NOT touch other anchors or any other part of this file.
const featureIpcCtx = {
  store,
  dataRoot: store?.dataRoot,
  getStoredTrades,
  saveStoredTrades,
  ensureLicensed,
  addLog,
  getSettings: () => normalizeSettingsSymbolMappings(store.get('settings', getDefaultSettings())),
  getMainWindow: () => mainWindow,
  notify: (title, body, key) => { try { sendDesktopNotification(title, body, key); } catch (_) { /* noop */ } }
};
void featureIpcCtx;
require('./excursionIpc').register(featureIpcCtx);
require('./strategyIpc').register(featureIpcCtx);
require('./reportsIpc').register(featureIpcCtx);
require('./notebookIpc').register(featureIpcCtx);
require('./replayIpc').register(featureIpcCtx);
require('./aiAgentsIpc').register(featureIpcCtx);
require('./propFirmIpc').register(featureIpcCtx);
require('./backtestIpc').register(featureIpcCtx);







