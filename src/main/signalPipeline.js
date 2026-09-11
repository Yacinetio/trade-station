/**
 * Pure helpers for the Telegram → MT5 signal pipeline (main.js).
 * Extracted so dedup / dispatch-status / close-command / share-validation logic is unit-testable.
 */

const DEDUPE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const DEDUPE_MAX_ROWS = 500;

/**
 * True when a trade with the same Telegram message id + channel already exists
 * in the recent stored trades (last 500 rows, max 48h old). Edited messages are
 * handled upstream (MODIFY flow) and never reach this check.
 */
function isDuplicateTelegramSignal(trades, { messageId, channelName, now = Date.now() } = {}) {
  if (messageId === undefined || messageId === null || messageId === '') return false;
  const msgId = String(messageId);
  const chan = String(channelName || '');
  const list = Array.isArray(trades) ? trades.slice(0, DEDUPE_MAX_ROWS) : [];
  for (const t of list) {
    if (!t || t.tgMessageId === undefined || t.tgMessageId === null) continue;
    if (String(t.tgMessageId) !== msgId) continue;
    if (String(t.channel || '') !== chan) continue;
    const openedMs = new Date(t.openedAt || t.lastUpdateAt || 0).getTime();
    if (Number.isFinite(openedMs) && openedMs > 0 && (now - openedMs) > DEDUPE_MAX_AGE_MS) continue;
    return true;
  }
  return false;
}

const ID_RAND_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Short unique trade id: base36 timestamp + 4 random chars (~13 chars).
 * Kept short on purpose — the EA writes "TS:<tradeId>" into the MT5 order
 * comment which is truncated around 31 characters.
 */
function generateTradeId(now = Date.now()) {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += ID_RAND_CHARS[Math.floor(Math.random() * ID_RAND_CHARS.length)];
  }
  return `${now.toString(36)}-${suffix}`;
}

/**
 * Map a bridge dispatch ACK onto the trade row (status + blockedReason).
 * QUEUE_EXPIRED / QUEUE_OVERFLOW come from tcpBridge when an offline-queued
 * signal is dropped before MT5 reconnects.
 */
function applyTradeDispatchStatus(trade, ack = {}) {
  const st = String(ack.status || '').toUpperCase();
  if (st === 'DISPATCHED') {
    trade.status = 'DISPATCHED';
    trade.dispatchedAt = trade.dispatchedAt || new Date().toISOString();
  } else if (st === 'NO_MT5_QUEUED') {
    trade.status = 'NO_MT5_QUEUED';
    trade.blockedReason = trade.blockedReason || 'MT5 offline — queued until EA reconnects';
  } else if (st === 'QUEUE_EXPIRED') {
    trade.status = 'BLOCKED_QUEUE';
    trade.blockedReason = 'Signal expired in offline queue before MT5 reconnected — not executed';
  } else if (st === 'QUEUE_OVERFLOW') {
    trade.status = 'BLOCKED_QUEUE';
    trade.blockedReason = 'Offline queue was full — oldest signal dropped before MT5 reconnected, not executed';
  } else if (st === 'WRITE_FAILED') {
    trade.status = 'FAILED_DISPATCH';
    trade.blockedReason = 'Could not write signal to MT5 bridge';
  } else {
    trade.status = st || 'DISPATCHED';
  }
  trade.lastUpdateAt = new Date().toISOString();
  return trade;
}

/** 'closed' → guard failures/timeouts block the trade; anything else → 'open' (allow). */
function resolveGuardFailMode(settings) {
  return String(settings?.guardFailMode || 'open').trim().toLowerCase() === 'closed' ? 'closed' : 'open';
}

/**
 * Fail-closed verdict for the parallel news/AI checks. Returns a blockedReason
 * string when the trade must be blocked, '' when it may proceed.
 */
function evaluateFailClosedTimeouts({ guardFailMode = 'open', newsTimedOut = false, aiTimedOut = false, aiUnavailable = false, fundamentalsTimedOut = false } = {}) {
  if (String(guardFailMode).toLowerCase() !== 'closed') return '';
  if (newsTimedOut) return 'News check timed out — blocked by fail-closed mode';
  if (aiTimedOut) return 'AI check timed out — blocked by fail-closed mode';
  if (aiUnavailable) return 'AI check unavailable (provider error) — blocked by fail-closed mode';
  if (fundamentalsTimedOut) return 'Fundamentals check timed out — blocked by fail-closed mode';
  return '';
}

/** When dry-run is on and the trade would dispatch, simulate instead of sending to MT5. */
function shouldSimulateDispatch({ dryRunMode = false, blocked = false, status = 'PENDING' } = {}) {
  if (!dryRunMode) return false;
  if (blocked) return false;
  return String(status || '').toUpperCase() === 'PENDING';
}

/** Spread cap to send to the EA. Channel overrides already merged into settings.maxSpreadPips. 0 = off. */
function resolveMaxSpreadPips(settings) {
  const v = Number(settings?.maxSpreadPips);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Validate custom per-TP lot shares (percentages). Returns a clean numeric
 * array when usable, null otherwise (EA then falls back to equal split).
 */
function validateTpLotShares(shares, tpCount) {
  if (!Array.isArray(shares) || !Number.isInteger(tpCount) || tpCount < 2) return null;
  if (shares.length !== tpCount) return null;
  const nums = shares.map(Number);
  if (nums.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum < 90 || sum > 110) return null;
  return nums.map((v) => Math.round(v * 100) / 100);
}

/** tpLotShares to attach to a multi-TP SIGNAL ('custom' mode only; 'equal' → omit, EA splits equally). */
function resolveTpLotShares(settings, tps) {
  if (String(settings?.tpLotMode || 'equal') !== 'custom') return null;
  const tpCount = Array.isArray(tps) ? tps.length : 0;
  return validateTpLotShares(settings?.tpCustomShares, tpCount);
}

/** Seconds for EA pending-order expiry (ORDER_TIME_SPECIFIED). 0 = disabled. UI stores hours. */
function resolvePendingExpirySeconds(settings) {
  if (settings?.enablePendingExpiry !== true) return 0;
  const hours = Number(settings?.pendingExpiry);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 3600);
}

const CLOSE_SYMBOL_LIST = [
  'XAUUSD', 'GOLD', 'XAGUSD', 'SILVER',
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'EURAUD', 'EURCHF', 'GBPCAD', 'CADJPY',
  'AUDJPY', 'AUDNZD', 'NZDJPY', 'GBPAUD', 'GBPNZD', 'EURCAD', 'NZDCAD',
  'AUDCAD', 'AUDCHF', 'NZDCHF', 'CADCHF', 'GBPCHF', 'CHFJPY',
  'US100', 'US30', 'US500', 'SPX500', 'NAS100', 'DJ30', 'GER40', 'UK100',
  'BTCUSD', 'ETHUSD', 'USOIL', 'UKOIL', 'NATGAS'
];
const CLOSE_SYMBOL_ALIASES = { GOLD: 'XAUUSD', SILVER: 'XAGUSD' };

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect a "close trades" command in a Telegram message.
 * Keywords match case-insensitively on word boundaries so e.g. keyword "close"
 * does not fire on "Closed at TP". Returns { matched, keyword, symbol } where
 * symbol is an optional explicit symbol mention (normalized, e.g. GOLD → XAUUSD).
 */
const PIPELINE_STAGE_LABELS = {
  parse: 'Parsed',
  schedule: 'Schedule',
  signalFilters: 'Signal filters',
  execGuards: 'Execution guards',
  drawdown: 'Drawdown guard',
  newsGuard: 'News guard',
  aiCheck: 'AI check',
  fundamentalsGate: 'Fundamentals gate',
  dispatch: 'Dispatch to MT5'
};

/**
 * Records { stage, ms, at, detail? } entries with Date.now() deltas between stamps.
 */
function createPipelineStageRecorder(startAt = Date.now()) {
  let lastAt = startAt;
  const stages = [];
  return {
    stages,
    stamp(stage, detail) {
      const at = Date.now();
      const ms = at - lastAt;
      const entry = { stage: String(stage), ms, at: new Date(at).toISOString() };
      if (detail != null && detail !== '') entry.detail = String(detail);
      stages.push(entry);
      lastAt = at;
      return entry;
    }
  };
}

/** Append a stage onto an existing trade row (e.g. async dispatch ACK). */
function appendPipelineStage(trade, stage, detail) {
  if (!trade || typeof trade !== 'object') return trade;
  const prev = Array.isArray(trade.pipelineStages) ? trade.pipelineStages : [];
  const lastAt = prev.length > 0 ? new Date(prev[prev.length - 1].at).getTime() : Date.now();
  const at = Date.now();
  const entry = { stage: String(stage), ms: at - lastAt, at: new Date(at).toISOString() };
  if (detail != null && detail !== '') entry.detail = String(detail);
  trade.pipelineStages = [...prev, entry];
  return trade;
}

function formatPipelineDurationMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function tsMsFromIso(raw) {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Infer step state from stage name, detail text, and overall trade status. */
function inferPipelineStageState(stage, detail, tradeStatus) {
  const st = String(tradeStatus || '').toUpperCase();
  const d = String(detail || '').toLowerCase();
  const blockedDetail = /block|halt|no-go|timeout|fail|reject|expired|overflow|simulated|high-impact/i.test(d);
  if (stage === 'dispatch') {
    if (st.startsWith('FAILED') || st === 'BLOCKED_QUEUE') return 'failed';
    if (d.includes('simulated')) return 'done';
    if (st === 'DISPATCHED' || st === 'NO_MT5_QUEUED' || st === 'SENT') return 'done';
    if (st === 'PENDING' || st === 'SIMULATED') return st === 'SIMULATED' ? 'done' : 'pending';
    return blockedDetail ? 'failed' : 'done';
  }
  if (blockedDetail) return 'failed';
  if (stage === 'aiCheck' && d.includes('block')) return 'failed';
  return 'done';
}

/**
 * Format raw pipelineStages telemetry into UI step objects for TradeDetailModal.
 * @returns {Array<{id:string, label:string, state:string, detail:string, at:number|null, duration?:string}>}
 */
function formatPipelineStagesForDisplay(pipelineStages, trade = {}) {
  const list = Array.isArray(pipelineStages) ? pipelineStages : [];
  if (list.length === 0) return [];
  const status = String(trade?.status || '').toUpperCase();
  const steps = list.map((entry) => {
    const id = String(entry?.stage || 'unknown');
    const detail = String(entry?.detail || '');
    return {
      id,
      label: PIPELINE_STAGE_LABELS[id] || id,
      state: inferPipelineStageState(id, detail, status),
      detail: detail || PIPELINE_STAGE_LABELS[id] || id,
      at: tsMsFromIso(entry?.at)
    };
  });
  for (let i = 1; i < steps.length; i++) {
    const ms = list[i]?.ms;
    if (ms != null && Number.isFinite(ms)) steps[i].duration = formatPipelineDurationMs(ms);
  }
  return steps;
}

function detectCloseCommand(text, closeKeywords) {
  const none = { matched: false, keyword: '', symbol: null };
  const msg = String(text || '').trim();
  if (!msg) return none;
  const list = Array.isArray(closeKeywords)
    ? closeKeywords
    : String(closeKeywords || '').split(',');
  const keywords = list.map((k) => String(k || '').trim()).filter(Boolean);
  if (keywords.length === 0) return none;

  const upper = msg.toUpperCase();
  let hit = '';
  for (const kw of keywords) {
    const re = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(kw.toUpperCase())}([^A-Z0-9]|$)`);
    if (re.test(upper)) { hit = kw; break; }
  }
  if (!hit) return none;

  let symbol = null;
  for (const sym of CLOSE_SYMBOL_LIST) {
    const re = new RegExp(`(^|[^A-Z0-9.])${escapeRegExp(sym)}([^A-Z0-9.]|$)`);
    if (re.test(upper)) {
      symbol = CLOSE_SYMBOL_ALIASES[sym] || sym;
      break;
    }
  }
  return { matched: true, keyword: hit, symbol };
}

/**
 * Trade-management keyword commands from Telegram messages:
 * - partial close ("close half", "partial 50%", …) → { action: 'partial_close', percent }
 * - move SL to break-even ("BE", "move sl to entry", …) → { action: 'break_even' }
 * Percent is taken from the message when present ("30%"), else defaultPartialPercent.
 */
function detectManagementCommand(text, {
  partialCloseKeywords = [],
  breakEvenKeywords = [],
  defaultPartialPercent = 50
} = {}) {
  const none = { matched: false, action: '', keyword: '', symbol: null, percent: 0 };
  const msg = String(text || '').trim();
  if (!msg) return none;

  const matchKeyword = (rawList) => {
    const list = Array.isArray(rawList) ? rawList : String(rawList || '').split(',');
    const keywords = list.map((k) => String(k || '').trim()).filter(Boolean);
    const upper = msg.toUpperCase();
    for (const kw of keywords) {
      const re = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(kw.toUpperCase())}([^A-Z0-9]|$)`);
      if (re.test(upper)) return kw;
    }
    return '';
  };

  const findSymbol = () => {
    const upper = msg.toUpperCase();
    for (const sym of CLOSE_SYMBOL_LIST) {
      const re = new RegExp(`(^|[^A-Z0-9.])${escapeRegExp(sym)}([^A-Z0-9.]|$)`);
      if (re.test(upper)) return CLOSE_SYMBOL_ALIASES[sym] || sym;
    }
    return null;
  };

  // Break-even takes priority: "move SL to BE" messages often also contain "close"-like words.
  const beHit = matchKeyword(breakEvenKeywords);
  if (beHit) {
    return { matched: true, action: 'break_even', keyword: beHit, symbol: findSymbol(), percent: 0 };
  }

  const pcHit = matchKeyword(partialCloseKeywords);
  if (pcHit) {
    let percent = Number(defaultPartialPercent) || 50;
    const pctMatch = msg.match(/(?<!\d)(\d{1,2}(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      const fromMsg = Number(pctMatch[1]);
      if (Number.isFinite(fromMsg) && fromMsg > 0 && fromMsg < 100) percent = fromMsg;
    } else if (/\bhalf\b/i.test(msg)) {
      percent = 50;
    }
    percent = Math.min(95, Math.max(1, percent));
    return { matched: true, action: 'partial_close', keyword: pcHit, symbol: findSymbol(), percent };
  }

  return none;
}

module.exports = {
  isDuplicateTelegramSignal,
  generateTradeId,
  applyTradeDispatchStatus,
  resolveGuardFailMode,
  evaluateFailClosedTimeouts,
  shouldSimulateDispatch,
  resolveMaxSpreadPips,
  validateTpLotShares,
  resolveTpLotShares,
  resolvePendingExpirySeconds,
  detectCloseCommand,
  detectManagementCommand,
  createPipelineStageRecorder,
  appendPipelineStage,
  formatPipelineStagesForDisplay,
  formatPipelineDurationMs,
  PIPELINE_STAGE_LABELS,
  DEDUPE_MAX_AGE_MS,
  DEDUPE_MAX_ROWS
};
