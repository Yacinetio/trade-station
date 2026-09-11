const DATA_SCHEMA_VERSION = 2;

const { getScopeRange, getCustomScopeBounds } = require('./timeScope');
const { getSession, getKillzone } = require('./sessionModel');

const TIME_SCOPES = new Set(['ALL', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM']);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeJournal(journal = {}) {
  const out = {
    notes: String(journal.notes || ''),
    tags: Array.isArray(journal.tags) ? journal.tags.map((v) => String(v || '').trim()).filter(Boolean) : [],
    mistakes: Array.isArray(journal.mistakes) ? journal.mistakes.map((v) => String(v || '').trim()).filter(Boolean) : [],
    checklist: Array.isArray(journal.checklist) ? journal.checklist.map((item) => ({
      id: String(item?.id || `${Date.now()}-${Math.random()}`),
      label: String(item?.label || '').trim(),
      done: !!item?.done
    })).filter((item) => item.label) : [],
    confidence: Number.isFinite(Number(journal.confidence)) ? Math.max(0, Math.min(10, Number(journal.confidence))) : null
  };
  if ('aiChartConfidence' in journal) {
    const n = Number(journal.aiChartConfidence);
    out.aiChartConfidence = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }
  if ('aiReviewAt' in journal) {
    const s = journal.aiReviewAt != null ? String(journal.aiReviewAt).trim() : '';
    if (s) out.aiReviewAt = s.slice(0, 48);
    else out.aiReviewAt = null;
  }
  if ('aiCloseInsightAt' in journal) {
    const s = journal.aiCloseInsightAt != null ? String(journal.aiCloseInsightAt).trim() : '';
    if (s) out.aiCloseInsightAt = s.slice(0, 48);
    else out.aiCloseInsightAt = null;
  }
  if ('emotion' in journal) {
    const s = journal.emotion != null ? String(journal.emotion).trim().toLowerCase().slice(0, 40) : '';
    out.emotion = s || null;
  }
  if ('rating' in journal) {
    const s = journal.rating != null ? String(journal.rating).trim().toUpperCase() : '';
    out.rating = /^[A-F]$/.test(s) ? s : null;
  }
  if ('attachments' in journal) {
    out.attachments = Array.isArray(journal.attachments) ? journal.attachments.map((a) => {
      const p = String(a?.path || '').trim();
      if (!p) return null;
      const entry = { path: p.slice(0, 500), at: String(a?.at || '').trim().slice(0, 48) };
      const label = a?.label != null ? String(a.label).trim().slice(0, 120) : '';
      if (label) entry.label = label;
      return entry;
    }).filter(Boolean).slice(0, 100) : [];
  }
  return out;
}

function normalizeTradeForStorage(trade = {}) {
  const out = {
    ...trade,
    journal: normalizeJournal(trade.journal || {})
  };
  if (trade.bias != null && String(trade.bias).trim()) {
    out.bias = String(trade.bias).trim().slice(0, 200);
  } else {
    delete out.bias;
  }
  if (trade.setup != null && String(trade.setup).trim()) {
    out.setup = String(trade.setup).trim().slice(0, 320);
  } else {
    delete out.setup;
  }
  if (Array.isArray(trade.presetTags) && trade.presetTags.length > 0) {
    out.presetTags = [...new Set(trade.presetTags.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50);
  } else {
    delete out.presetTags;
  }
  if (trade.vwapBand != null && String(trade.vwapBand).trim()) {
    const raw = String(trade.vwapBand).trim().toLowerCase();
    const v = raw === 'n/a' ? 'na' : raw;
    if (v === 'yes' || v === 'no' || v === 'na') out.vwapBand = v;
    else delete out.vwapBand;
  } else {
    delete out.vwapBand;
  }
  if (trade.hvnBand != null && String(trade.hvnBand).trim()) {
    const raw = String(trade.hvnBand).trim().toLowerCase();
    const v = raw === 'n/a' ? 'na' : raw;
    if (v === 'yes' || v === 'no' || v === 'na') out.hvnBand = v;
    else delete out.hvnBand;
  } else {
    delete out.hvnBand;
  }
  if (trade.trendAlign != null && String(trade.trendAlign).trim()) {
    const raw = String(trade.trendAlign).trim().toLowerCase();
    const v = raw === 'n/a' ? 'na' : raw;
    if (v === 'with' || v === 'against' || v === 'neutral' || v === 'na') out.trendAlign = v;
    else delete out.trendAlign;
  } else {
    delete out.trendAlign;
  }
  if (trade.obSize != null && String(trade.obSize).trim()) {
    out.obSize = String(trade.obSize).trim().slice(0, 80);
  } else {
    delete out.obSize;
  }
  if (trade.confluence != null) {
    const c = Number(trade.confluence);
    if (Number.isInteger(c) && c >= 0 && c <= 99) out.confluence = c;
    else delete out.confluence;
  } else {
    delete out.confluence;
  }
  if (trade.rejPct != null) {
    const r = Number(trade.rejPct);
    if (Number.isFinite(r) && r >= 0 && r <= 100) out.rejPct = r;
    else delete out.rejPct;
  } else {
    delete out.rejPct;
  }
  if (trade.obWinRate != null) {
    const w = Number(trade.obWinRate);
    if (Number.isFinite(w) && w >= 0 && w <= 100) out.obWinRate = w;
    else delete out.obWinRate;
  } else {
    delete out.obWinRate;
  }
  if (trade.top1 === true || trade.top1 === false) {
    out.top1 = trade.top1;
  } else {
    delete out.top1;
  }
  if (trade.signalSession != null && String(trade.signalSession).trim()) {
    const s = String(trade.signalSession).trim();
    if (['asian', 'london', 'newYork', 'off'].includes(s)) out.signalSession = s;
    else delete out.signalSession;
  } else {
    delete out.signalSession;
  }
  if (trade.fundBias != null && String(trade.fundBias).trim()) {
    const fb = String(trade.fundBias).trim().toUpperCase();
    if (['BULLISH', 'BEARISH', 'NEUTRAL'].includes(fb)) out.fundBias = fb;
    else delete out.fundBias;
  } else {
    delete out.fundBias;
  }
  if (trade.customFields != null && typeof trade.customFields === 'object' && !Array.isArray(trade.customFields)) {
    const cf = {};
    for (const [k, v] of Object.entries(trade.customFields)) {
      const key = String(k || '').trim().slice(0, 48);
      const val = String(v || '').trim().slice(0, 200);
      if (key && val) cf[key] = val;
    }
    if (Object.keys(cf).length) out.customFields = cf;
    else delete out.customFields;
  } else {
    delete out.customFields;
  }
  if (trade.comment != null && String(trade.comment).trim()) {
    out.comment = String(trade.comment).trim().slice(0, 500);
  }
  return out;
}

function migrateTradesData(trades = []) {
  if (!Array.isArray(trades)) return [];
  return trades.map((trade) => normalizeTradeForStorage(trade));
}

function migrateStoreData(store) {
  const currentVersion = Number(store.get('dataSchemaVersion', 1)) || 1;
  let migrated = false;
  let trades = store.get('trades', []);

  if (currentVersion < DATA_SCHEMA_VERSION || !Array.isArray(trades)) {
    trades = migrateTradesData(trades);
    store.set('trades', trades);
    migrated = true;
  }

  if (currentVersion !== DATA_SCHEMA_VERSION) {
    store.set('dataSchemaVersion', DATA_SCHEMA_VERSION);
    migrated = true;
  }

  return { migrated, version: DATA_SCHEMA_VERSION };
}

function isClosedTrade(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime;
}

function getTradeOutcomeForFilter(trade, breakEvenAmount) {
  const s = String(trade?.status || '').toUpperCase();
  const p = toNumber(trade?.profit);
  const th = Math.max(0, Number(breakEvenAmount) || 0);
  /** Scheduled EOD flatten — not a TP/SL outcome; excluded from win rate & decisive stats. */
  if (s === 'CLOSED_EOD') return 'EOD';
  /** Stop-filled in profit / protective SL — only Settings BE band (±USD) applies: inside → BE, else plain closed (win/loss from P/L). */
  if (s === 'CLOSED_SL_PROFIT') {
    return Math.abs(p) <= th ? 'BE' : 'CLOSED';
  }
  if (s === 'TP_HIT' || s === 'CLOSED_TP') return 'TP';
  if (!isClosedTrade(trade)) return 'OPEN';
  if (s === 'SL_HIT' || s === 'CLOSED_SL') {
    return Math.abs(p) <= th ? 'BE' : 'SL';
  }
  return Math.abs(p) <= th ? 'BE' : 'CLOSED';
}

/** Win for stats — TP hits, plus protective stops filled in profit beyond the BE band (excludes SL, BE, EOD, manual CLOSED). */
function isClosedTradeWinForStats(trade, breakEvenAmount) {
  const outcome = getTradeOutcomeForFilter(trade, breakEvenAmount);
  if (outcome === 'TP') return true;
  if (outcome === 'CLOSED' && String(trade?.status || '').toUpperCase() === 'CLOSED_SL_PROFIT') {
    return toNumber(trade?.profit) > 0;
  }
  return false;
}

/** Loss for stats — SL hits only (excludes TP, BE, EOD, manual CLOSED). */
function isClosedTradeLossForStats(trade, breakEvenAmount) {
  return getTradeOutcomeForFilter(trade, breakEvenAmount) === 'SL';
}

function statusMatchesFilter(trade, filters = {}) {
  const wanted = String(filters.status || 'ALL').toUpperCase();
  if (wanted === 'ALL') return true;
  const beAmt = Math.max(0, Number(filters.analyticsBreakEvenAmount ?? 50) || 50);
  const s = String(trade?.status || '').toUpperCase();

  if (wanted === 'LIVE') return !isClosedTrade(trade) && !(s.includes('BLOCKED') || Boolean(trade?.blockedReason));
  if (wanted === 'BLOCKED') return s.includes('BLOCKED') || Boolean(trade?.blockedReason);

  if (wanted === 'CLOSED') return isClosedTrade(trade);

  if (wanted === 'PENDING') return s === 'PENDING';
  if (wanted === 'SENT') return s === 'SENT';

  if (wanted === 'TP') return getTradeOutcomeForFilter(trade, beAmt) === 'TP';
  if (wanted === 'SL') return getTradeOutcomeForFilter(trade, beAmt) === 'SL';
  if (wanted === 'BE') return getTradeOutcomeForFilter(trade, beAmt) === 'BE';
  if (wanted === 'EOD') return getTradeOutcomeForFilter(trade, beAmt) === 'EOD';

  return s === wanted;
}

function parseTradeDate(trade) {
  const s = String(trade?.status || '').toUpperCase();
  const closed = s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || Boolean(trade?.closeTime);
  const candidates = closed
    ? [trade?.closedAt, trade?.openedAt, trade?.time]
    : [trade?.openedAt, trade?.closedAt, trade?.time];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function bucketKey(date, scope) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');

  if (scope === 'DAY') return `${yyyy}-${mm}-${dd} ${hh}:00`;
  if (scope === 'YEAR') return `${yyyy}-${mm}`;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Canonical UTC session (sessionModel) mapped to the legacy keys the renderer
 * already consumes: 'asia' → 'asian'; 'london'/'newYork' pass through; times
 * between NY close and Asia open land in 'off'.
 */
function getSessionKeyForDate(date) {
  const s = getSession(date);
  if (s === 'asia') return 'asian';
  return s || 'off';
}

function getWeekdayName(date) {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return days[date.getDay()] || 'UNK';
}

function deriveCloseReason(trade = {}, breakEvenAmount = 50) {
  const status = String(trade?.status || '').toUpperCase();
  const p = toNumber(trade?.profit);
  const th = Math.max(0, Number(breakEvenAmount) || 0);
  if (status === 'CLOSED_EOD') return 'EOD_CLOSE';
  if (status === 'CLOSED_SL_PROFIT') {
    return Math.abs(p) <= th ? 'BE' : 'MANUAL_CLOSED';
  }
  if (status === 'TP_HIT' || status === 'CLOSED_TP') return 'TP';
  if (status === 'SL_HIT' || status === 'CLOSED_SL') return 'SL';
  if (status === 'BLOCKED_HIGH_NEWS') return 'BLOCKED_NEWS';
  if (status === 'BLOCKED_SIGNAL_FILTERS') return 'BLOCKED_FILTERS';
  if (status.startsWith('FAILED') || status.includes('NOT_FOUND')) return 'FAILED';
  if (status.includes('CLOSED')) return 'MANUAL_CLOSED';
  if (status === 'SENT') return 'SENT';
  if (status === 'PENDING') return 'PENDING';
  return status || 'UNKNOWN';
}

function summarizeGroup(trades = [], breakEvenAmount = 50) {
  const beAmt = Math.max(0, Number(breakEvenAmount) || 0);
  const closed = trades.filter((t) => t._closed);
  const wins = closed.filter((t) => isClosedTradeWinForStats(t, beAmt));
  const losses = closed.filter((t) => isClosedTradeLossForStats(t, beAmt));
  const pnl = trades.reduce((sum, t) => sum + t._profit, 0);
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t._profit, 0) / wins.length : 0;
  const avgLossAbs = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t._profit, 0) / losses.length) : 0;
  const decisive = wins.length + losses.length;
  const winRate = decisive > 0 ? (wins.length / decisive) * 100 : 0;
  return {
    trades: trades.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    pnl: Number(pnl.toFixed(2)),
    winRate: Number(winRate.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLossAbs.toFixed(2))
  };
}

function summarizeBy(preparedTrades = [], keyFn, breakEvenAmount = 50) {
  const beAmt = Math.max(0, Number(breakEvenAmount) || 0);
  const groups = new Map();
  for (const trade of preparedTrades) {
    const key = String(keyFn(trade) || 'UNKNOWN');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return Array.from(groups.entries()).map(([key, rows]) => ({
    key,
    ...summarizeGroup(rows, beAmt)
  }));
}

function buildChartSeries(trades, scope) {
  const sorted = [...trades]
    .filter((t) => t._date)
    .sort((a, b) => a._date.getTime() - b._date.getTime());
  const grouped = new Map();
  for (const trade of sorted) {
    const key = bucketKey(trade._date, scope);
    const prev = grouped.get(key) || 0;
    grouped.set(key, prev + trade._profit);
  }

  let cumulative = 0;
  const points = [];
  for (const [time, pnl] of grouped.entries()) {
    cumulative += pnl;
    points.push({
      time,
      pnl: Number(cumulative.toFixed(2)),
      delta: Number(pnl.toFixed(2))
    });
  }
  return { points, totalPnl: Number(cumulative.toFixed(2)) };
}

function computeMaxDrawdown(sortedClosedTrades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of sortedClosedTrades) {
    equity += trade._profit;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return Number(maxDrawdown.toFixed(2));
}

function computeStreaks(sortedClosedTrades, breakEvenAmount = 50) {
  const beAmt = Math.max(0, Number(breakEvenAmount) || 0);
  let currentWin = 0;
  let currentLoss = 0;
  let maxWin = 0;
  let maxLoss = 0;

  for (const trade of sortedClosedTrades) {
    const o = getTradeOutcomeForFilter(trade, beAmt);
    if (o === 'BE' || o === 'EOD' || o === 'CLOSED') {
      continue;
    }
    if (isClosedTradeWinForStats(trade, beAmt)) {
      currentWin += 1;
      currentLoss = 0;
    } else if (isClosedTradeLossForStats(trade, beAmt)) {
      currentLoss += 1;
      currentWin = 0;
    }
    if (currentWin > maxWin) maxWin = currentWin;
    if (currentLoss > maxLoss) maxLoss = currentLoss;
  }

  return { currentWin, currentLoss, maxWin, maxLoss };
}

function normalizeFilterStringList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
}

function normalizeVwapBandFilterList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => {
    const s = String(x || '').trim().toLowerCase();
    if (s === 'n/a') return 'na';
    if (s === 'yes' || s === 'no' || s === 'na') return s;
    return '';
  }).filter(Boolean))];
}

function normalizeSessionFilterList(raw) {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(['asian', 'london', 'newYork', 'off']);
  return [...new Set(raw.map((x) => {
    const k = String(x || '').trim();
    return allowed.has(k) ? k : '';
  }).filter(Boolean))];
}

/** Local weekday indices `Date.getDay()` (0=Sun … 6=Sat). Empty = no filter. */
function normalizeWeekdayFilterList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const x of raw) {
    const n = Number(x);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function tradeSessionForFilter(trade) {
  const d = parseTradeDate(trade);
  if (!d) return null;
  return getSessionKeyForDate(d);
}

function tradePresetTagListForFilter(trade) {
  const pts = Array.isArray(trade?.presetTags) ? trade.presetTags : [];
  const out = pts.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  const legacy = String(trade?.setup || '').trim().toLowerCase();
  if (legacy && !out.includes(legacy)) out.push(legacy);
  return out;
}

function passesFilters(trade, filters) {
  if (filters.accountKeys?.length > 0 && !filters.accountKeys.includes(trade.accountKey || 'unknown')) return false;
  if (filters.symbol && !String(trade.symbol || '').toLowerCase().includes(String(filters.symbol).toLowerCase())) return false;
  if (filters.type && filters.type !== 'ALL' && String(trade.type || '').toUpperCase() !== String(filters.type).toUpperCase()) return false;
  if (filters.channel && filters.channel !== 'ALL' && String(trade.channel || '') !== String(filters.channel)) return false;
  if (!statusMatchesFilter(trade, filters)) return false;

  const tfs = filters.timeframes;
  if (Array.isArray(tfs) && tfs.length > 0) {
    const tf = String(trade.timeframe || '').toUpperCase().trim();
    if (!tfs.includes(tf)) return false;
  }
  const syms = filters.symbols;
  if (Array.isArray(syms) && syms.length > 0) {
    const sym = String(trade.symbol || '').toUpperCase().trim();
    if (!syms.includes(sym)) return false;
  }
  const biasPick = filters.biasTerms;
  if (Array.isArray(biasPick) && biasPick.length > 0) {
    const b = String(trade.bias || '').trim().toLowerCase();
    if (!b) return false;
    const want = new Set(biasPick.map((x) => String(x || '').trim().toLowerCase()));
    if (!want.has(b)) return false;
  }
  const setupPick = filters.setupTerms;
  if (Array.isArray(setupPick) && setupPick.length > 0) {
    const tags = tradePresetTagListForFilter(trade);
    if (tags.length === 0) return false;
    const want = new Set(setupPick.map((x) => String(x || '').trim().toLowerCase()));
    if (!tags.some((t) => want.has(t))) return false;
  }
  const vwapPick = filters.vwapBands;
  if (Array.isArray(vwapPick) && vwapPick.length > 0) {
    const raw = String(trade.vwapBand || '').trim().toLowerCase();
    const v = raw === 'n/a' ? 'na' : raw;
    if (!v || (v !== 'yes' && v !== 'no' && v !== 'na')) return false;
    const want = new Set(vwapPick);
    if (!want.has(v)) return false;
  }
  const hvnPick = filters.hvnBands;
  if (Array.isArray(hvnPick) && hvnPick.length > 0) {
    const raw = String(trade.hvnBand || '').trim().toLowerCase();
    const v = raw === 'n/a' ? 'na' : raw;
    if (!v || (v !== 'yes' && v !== 'no' && v !== 'na')) return false;
    const want = new Set(hvnPick);
    if (!want.has(v)) return false;
  }
  const trendPick = filters.trendAligns;
  if (Array.isArray(trendPick) && trendPick.length > 0) {
    const v = dimTrendAlign(trade);
    if (!v || v.startsWith('(')) return false;
    const want = new Set(trendPick.map((x) => String(x || '').trim().toLowerCase()));
    if (!want.has(v)) return false;
  }
  const killzonePick = filters.killzones;
  if (Array.isArray(killzonePick) && killzonePick.length > 0) {
    const kz = dimKillzone(trade);
    if (!kz || kz.startsWith('(')) return false;
    const want = new Set(killzonePick.map((x) => String(x || '').trim()));
    if (!want.has(kz)) return false;
  }
  const confPick = filters.confluenceTiers;
  if (Array.isArray(confPick) && confPick.length > 0) {
    const tier = dimConfluenceTier(trade);
    if (!tier || tier.startsWith('(')) return false;
    const want = new Set(confPick.map((x) => String(x || '').trim()));
    if (!want.has(tier)) return false;
  }
  const top1Pick = filters.top1Values;
  if (Array.isArray(top1Pick) && top1Pick.length > 0) {
    const v = dimTop1(trade);
    if (!v || v.startsWith('(')) return false;
    const want = new Set(top1Pick.map((x) => String(x || '').trim().toLowerCase()));
    if (!want.has(v)) return false;
  }
  const sessionPick = filters.sessionNames;
  if (Array.isArray(sessionPick) && sessionPick.length > 0) {
    const sess = tradeSessionForFilter(trade);
    if (!sess) return false;
    const want = new Set(sessionPick);
    if (!want.has(sess)) return false;
  }
  const weekdayPick = filters.weekdayIndices;
  if (Array.isArray(weekdayPick) && weekdayPick.length > 0) {
    const d = parseTradeDate(trade);
    if (!d) return false;
    if (!weekdayPick.includes(d.getDay())) return false;
  }
  return true;
}

function computeAnalytics(rawTrades = [], inputFilters = {}) {
  const scopeCandidate = String(inputFilters.timeScope || 'ALL').toUpperCase();
  let timeScope = TIME_SCOPES.has(scopeCandidate) ? scopeCandidate : 'ALL';
  const now = new Date();
  /** @type {{ start: Date|null, end: Date|null }} */
  let scopeBounds = { start: null, end: null };
  if (timeScope === 'ALL') {
    scopeBounds = { start: null, end: null };
  } else if (timeScope === 'CUSTOM') {
    const b = getCustomScopeBounds(inputFilters.scopeFrom, inputFilters.scopeTo);
    if (!b) {
      timeScope = 'ALL';
      scopeBounds = { start: null, end: null };
    } else {
      scopeBounds = b;
    }
  } else {
    scopeBounds = getScopeRange(timeScope, now);
  }

  const chartSeriesScope =
    timeScope === 'ALL' ? 'MONTH' : timeScope === 'CUSTOM' ? 'WEEK' : timeScope;

  const filters = {
    accountKeys: Array.isArray(inputFilters.accountKeys) ? inputFilters.accountKeys : [],
    symbol: String(inputFilters.symbol || ''),
    type: String(inputFilters.type || 'ALL'),
    status: String(inputFilters.status || 'ALL'),
    channel: String(inputFilters.channel || 'ALL'),
    analyticsBreakEvenAmount: Math.max(0, Number(inputFilters.analyticsBreakEvenAmount ?? 50) || 50),
    timeframes: normalizeFilterStringList(inputFilters.timeframes).map((x) => x.toUpperCase()),
    symbols: normalizeFilterStringList(inputFilters.symbols).map((x) => x.toUpperCase()),
    biasTerms: normalizeFilterStringList(inputFilters.biasTerms),
    setupTerms: normalizeFilterStringList(inputFilters.setupTerms),
    vwapBands: normalizeVwapBandFilterList(inputFilters.vwapBands),
    hvnBands: normalizeVwapBandFilterList(inputFilters.hvnBands),
    sessionNames: normalizeSessionFilterList(inputFilters.sessionNames),
    weekdayIndices: normalizeWeekdayFilterList(inputFilters.weekdayIndices)
  };

  const prepared = (Array.isArray(rawTrades) ? rawTrades : [])
    .map((trade) => {
      const _date = parseTradeDate(trade);
      return {
        ...trade,
        _date,
        _session: _date ? getSessionKeyForDate(_date) : null,
        _killzone: _date ? getKillzone(_date) : null,
        _profit: toNumber(trade.profit, 0),
        _closed: isClosedTrade(trade)
      };
    })
    .filter((trade) => trade._date && passesFilters(trade, filters))
    .filter((trade) => {
      if (!scopeBounds.start && !scopeBounds.end) return true;
      if (!trade._date) return false;
      if (scopeBounds.start && trade._date < scopeBounds.start) return false;
      if (scopeBounds.end && trade._date > scopeBounds.end) return false;
      return true;
    });

  const closedTrades = prepared.filter((trade) => trade._closed);
  const sortedClosed = [...closedTrades].sort((a, b) => a._date.getTime() - b._date.getTime());
  const beAmt = filters.analyticsBreakEvenAmount;
  const breakevens = closedTrades.filter(
    (t) => getTradeOutcomeForFilter(t, beAmt) === 'BE'
  ).length;
  const eodCloses = closedTrades.filter(
    (t) => getTradeOutcomeForFilter(t, beAmt) === 'EOD'
  ).length;
  const tpHits = closedTrades.filter((t) => getTradeOutcomeForFilter(t, beAmt) === 'TP').length;
  const slHits = closedTrades.filter((t) => getTradeOutcomeForFilter(t, beAmt) === 'SL').length;
  const otherCloses = closedTrades.filter((t) => getTradeOutcomeForFilter(t, beAmt) === 'CLOSED').length;
  const tpSlDecisive = tpHits + slHits;
  const tpSlWinRate = tpSlDecisive > 0 ? (tpHits / tpSlDecisive) * 100 : null;
  const wins = closedTrades.filter((trade) => isClosedTradeWinForStats(trade, beAmt));
  const losses = closedTrades.filter((trade) => isClosedTradeLossForStats(trade, beAmt));
  const grossProfit = wins.reduce((sum, trade) => sum + trade._profit, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + trade._profit, 0));
  const totalPnl = prepared.reduce((sum, trade) => sum + trade._profit, 0);
  const decisiveClosed = wins.length + losses.length;
  const winRate = decisiveClosed > 0 ? (wins.length / decisiveClosed) * 100 : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLossAbs / losses.length : 0;
  const closedPnlSum = closedTrades.reduce((s, t) => s + t._profit, 0);
  const expectancy = closedTrades.length > 0 ? closedPnlSum / closedTrades.length : 0;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0);
  const streaks = computeStreaks(sortedClosed, beAmt);
  const maxDrawdown = computeMaxDrawdown(sortedClosed);

  const holdDurationsMs = closedTrades
    .map((trade) => {
      const openAt = trade.openedAt ? new Date(trade.openedAt).getTime() : NaN;
      const closeAt = trade.lastUpdateAt ? new Date(trade.lastUpdateAt).getTime() : NaN;
      if (!Number.isFinite(openAt) || !Number.isFinite(closeAt) || closeAt < openAt) return null;
      return closeAt - openAt;
    })
    .filter((v) => Number.isFinite(v));
  const avgHoldMs = holdDurationsMs.length > 0
    ? holdDurationsMs.reduce((sum, v) => sum + v, 0) / holdDurationsMs.length
    : 0;

  const sessions = {
    asian: { pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 },
    london: { pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 },
    newYork: { pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 },
    off: { pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 }
  };
  for (const trade of closedTrades) {
    const session = trade._session || getSessionKeyForDate(trade._date);
    sessions[session].pnl += trade._profit;
    sessions[session].trades += 1;
    if (isClosedTradeWinForStats(trade, beAmt)) sessions[session].wins += 1;
    if (isClosedTradeLossForStats(trade, beAmt)) sessions[session].losses += 1;
  }
  Object.values(sessions).forEach((session) => {
    session.pnl = Number(session.pnl.toFixed(2));
    const d = session.wins + session.losses;
    session.winRate = d > 0 ? Number(((session.wins / d) * 100).toFixed(2)) : 0;
  });

  const chart = buildChartSeries(prepared, chartSeriesScope);
  const bySymbol = summarizeBy(prepared, (t) => t.symbol || 'UNKNOWN', beAmt)
    .sort((a, b) => b.pnl - a.pnl);
  const byChannel = summarizeBy(prepared, (t) => t.channel || 'UNKNOWN', beAmt)
    .sort((a, b) => b.pnl - a.pnl);
  const byWeekday = summarizeBy(prepared, (t) => getWeekdayName(t._date), beAmt)
    .sort((a, b) => b.pnl - a.pnl);
  const byHour = summarizeBy(prepared, (t) => String(t._date.getHours()).padStart(2, '0'), beAmt)
    .sort((a, b) => Number(a.key) - Number(b.key));
  const byCloseReason = summarizeBy(prepared, (t) => deriveCloseReason(t, beAmt), beAmt)
    .sort((a, b) => b.trades - a.trades);
  /** ICT killzone slices (UTC, DST-aware — see sessionModel.getKillzone); 'none' = outside every killzone. */
  const byKillzone = summarizeBy(prepared, (t) => t._killzone || 'none', beAmt)
    .sort((a, b) => b.pnl - a.pnl);
  /** Weekday (UTC calendar day) × canonical session cells for the renderer matrix. */
  const byWeekdaySession = summarizeBy(
    prepared,
    (t) => `${WD_SHORT[t._date.getUTCDay()] || 'UNK'}|${t._session || 'off'}`,
    beAmt
  ).map((row) => {
    const [weekday, session] = String(row.key).split('|');
    return { ...row, weekday, session };
  });

  return {
    generatedAt: new Date().toISOString(),
    timeScope,
    filters,
    tradeCount: prepared.length,
    closedCount: closedTrades.length,
    totals: {
      totalPnl: Number(totalPnl.toFixed(2)),
      wins: wins.length,
      losses: losses.length,
      winRate: Number(winRate.toFixed(2)),
      avgWin: Number(avgWin.toFixed(2)),
      avgLoss: Number(avgLoss.toFixed(2)),
      rr: Number((avgLoss > 0 ? avgWin / avgLoss : 0).toFixed(2)),
      breakevens,
      eodCloses,
      otherCloses,
      tpHits,
      slHits,
      tpSlWinRate: tpSlWinRate == null ? null : Number(tpSlWinRate.toFixed(2))
    },
    advanced: {
      expectancy: Number(expectancy.toFixed(2)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : null,
      maxDrawdown,
      streaks,
      avgHoldMs: Number(avgHoldMs.toFixed(0)),
      sessions
    },
    breakdowns: {
      bySymbol,
      byChannel,
      byWeekday,
      byHour,
      byCloseReason,
      byKillzone,
      byWeekdaySession
    },
    chart
  };
}

function canonicalVwapBandBreakdown(trade) {
  const raw = String(trade?.vwapBand || '').trim().toLowerCase();
  const v = raw === 'n/a' ? 'na' : raw;
  if (v === 'yes' || v === 'no' || v === 'na') return v;
  return '(unknown)';
}

function canonicalHvnBandBreakdown(trade) {
  const raw = String(trade?.hvnBand || '').trim().toLowerCase();
  const v = raw === 'n/a' ? 'na' : raw;
  if (v === 'yes' || v === 'no' || v === 'na') return v;
  return '(unknown)';
}

function dimSessionFromTrade(trade) {
  const d = parseTradeDate(trade);
  if (!d) return '(no time)';
  return getSessionKeyForDate(d);
}

function setupPrimaryLabel(trade) {
  const pts = Array.isArray(trade?.presetTags) ? trade.presetTags : [];
  for (const x of pts) {
    const s = String(x || '').trim();
    if (s) return s.length > 40 ? `${s.slice(0, 37)}…` : s;
  }
  const legacy = String(trade?.setup || '').trim();
  if (legacy) return legacy.length > 40 ? `${legacy.slice(0, 37)}…` : legacy;
  return '(no setup)';
}

function dimTimeframe(trade) {
  const tf = String(trade?.timeframe || '').toUpperCase().trim();
  return tf || '(no TF)';
}

function dimBias(trade) {
  const b = String(trade?.bias || '').trim().toLowerCase();
  return b || '(no bias)';
}

function dimSymbol(trade) {
  return String(trade?.symbol || 'UNKNOWN').toUpperCase().trim() || 'UNKNOWN';
}

function dimChannel(trade) {
  const c = String(trade?.channel || '').trim();
  return c || '(no channel)';
}

function dimSide(trade) {
  return String(trade?.type || '').toUpperCase().trim() || '—';
}

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dimWeekday(trade) {
  const d = parseTradeDate(trade);
  if (!d) return '(no time)';
  return WD_SHORT[d.getDay()] || '(no time)';
}

function dimTrendAlign(trade) {
  const raw = String(trade?.trendAlign || '').trim().toLowerCase();
  const v = raw === 'n/a' ? 'na' : raw;
  if (v === 'with' || v === 'against' || v === 'neutral' || v === 'na') return v;
  return '(unknown)';
}

function dimKillzone(trade) {
  const d = parseTradeDate(trade);
  if (!d) return '(no time)';
  return getKillzone(d) || 'none';
}

function confluenceTierLabel(n) {
  const c = Number(n);
  if (!Number.isFinite(c) || c <= 0) return '0';
  if (c <= 2) return '1-2';
  return '3+';
}

function dimConfluenceTier(trade) {
  if (trade?.confluence == null) return '(unknown)';
  return confluenceTierLabel(trade.confluence);
}

function dimTop1(trade) {
  if (trade?.top1 === true) return 'yes';
  if (trade?.top1 === false) return 'no';
  return '(unknown)';
}

/**
 * Compact win-rate / P&amp;L slices for the dashboard “stats + filters” AI card.
 * Uses the same decisive W/L rules as computeAnalytics (excludes BE & EOD from W/L).
 */
function buildDashboardFilterStatsBreakdown(trades = [], breakEvenAmount = 50) {
  const beAmt = Math.max(0, Number(breakEvenAmount) || 50);
  const list = Array.isArray(trades) ? trades : [];

  function metricsFor(rows) {
    const wins = rows.filter((t) => isClosedTradeWinForStats(t, beAmt));
    const losses = rows.filter((t) => isClosedTradeLossForStats(t, beAmt));
    const decisive = wins.length + losses.length;
    const wr = decisive > 0 ? (wins.length / decisive) * 100 : null;
    const pnl = rows.reduce((sum, t) => sum + toNumber(t.profit), 0);
    return {
      trades: rows.length,
      closed: rows.filter((t) => isClosedTrade(t)).length,
      decisive,
      wins: wins.length,
      losses: losses.length,
      winRate: wr == null ? null : Number(wr.toFixed(1)),
      pnl: Number(pnl.toFixed(2))
    };
  }

  function groupBy(rows, keyFn) {
    const m = new Map();
    for (const t of rows) {
      const k = String(keyFn(t) || '—');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()].map(([key, rs]) => ({ key, ...metricsFor(rs) }));
  }

  function groupByPair(rows, keyFn) {
    const m = new Map();
    for (const t of rows) {
      const k = keyFn(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()].map(([key, rs]) => ({ key, ...metricsFor(rs) }));
  }

  function pickExtremes(rows, minDecisive, cap) {
    const elig = rows.filter((r) => r.decisive >= minDecisive && r.winRate != null);
    const hi = [...elig].sort((a, b) => b.winRate - a.winRate || b.decisive - a.decisive);
    const lo = [...elig].sort((a, b) => a.winRate - b.winRate || b.decisive - a.decisive);
    return {
      best: hi.slice(0, cap),
      worst: lo.slice(0, cap)
    };
  }

  const aggregate = metricsFor(list);

  const singleSpecs = [
    { name: 'timeframe', fn: dimTimeframe },
    { name: 'vwap', fn: (t) => canonicalVwapBandBreakdown(t) },
    { name: 'hvn', fn: (t) => canonicalHvnBandBreakdown(t) },
    { name: 'trend', fn: dimTrendAlign },
    { name: 'killzone', fn: dimKillzone },
    { name: 'confluence', fn: dimConfluenceTier },
    { name: 'top1', fn: dimTop1 },
    { name: 'session', fn: (t) => dimSessionFromTrade(t) },
    { name: 'bias', fn: dimBias },
    { name: 'setup', fn: setupPrimaryLabel },
    { name: 'symbol', fn: dimSymbol },
    { name: 'channel', fn: dimChannel },
    { name: 'side', fn: dimSide },
    { name: 'weekday', fn: dimWeekday }
  ];

  const singles = {};
  for (const { name, fn } of singleSpecs) {
    const rows = groupBy(list, fn);
    singles[name] = pickExtremes(rows, 2, 5);
  }

  // Tags are multi-valued (journal tags + setup presets): a trade contributes
  // to every tag bucket it carries, so groupBy(keyFn) doesn't apply.
  {
    const byTag = new Map();
    for (const t of list) {
      const tags = [
        ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
        ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
      ].map((x) => String(x || '').trim()).filter(Boolean);
      for (const tag of new Set(tags.map((x) => x.toLowerCase()))) {
        const display = tags.find((x) => x.toLowerCase() === tag) || tag;
        if (!byTag.has(tag)) byTag.set(tag, { key: display, rows: [] });
        byTag.get(tag).rows.push(t);
      }
    }
    const rows = [...byTag.values()].map(({ key, rows: rs }) => ({ key, ...metricsFor(rs) }));
    singles.tags = pickExtremes(rows, 2, 5);
  }

  const pairSpecs = [
    {
      name: 'tf_vwap',
      fn: (t) => `${dimTimeframe(t)} + vwap:${canonicalVwapBandBreakdown(t)}`
    },
    {
      name: 'tf_session',
      fn: (t) => `${dimTimeframe(t)} + session:${dimSessionFromTrade(t)}`
    },
    {
      name: 'tf_bias',
      fn: (t) => `${dimTimeframe(t)} + bias:${dimBias(t)}`
    },
    {
      name: 'tf_side',
      fn: (t) => `${dimTimeframe(t)} + ${dimSide(t)}`
    },
    {
      name: 'vwap_bias',
      fn: (t) => `vwap:${canonicalVwapBandBreakdown(t)} + bias:${dimBias(t)}`
    },
    {
      name: 'hvn_vwap',
      fn: (t) => `hvn:${canonicalHvnBandBreakdown(t)} + vwap:${canonicalVwapBandBreakdown(t)}`
    },
    {
      name: 'tf_trend',
      fn: (t) => `${dimTimeframe(t)} + trend:${dimTrendAlign(t)}`
    },
    {
      name: 'tf_killzone',
      fn: (t) => `${dimTimeframe(t)} + killzone:${dimKillzone(t)}`
    },
    {
      name: 'tf_setup',
      fn: (t) => `${dimTimeframe(t)} + setup:${setupPrimaryLabel(t)}`
    }
  ];

  const pairBuckets = [];
  for (const { name, fn } of pairSpecs) {
    pairBuckets.push(...groupByPair(list, fn).map((r) => ({ slice: name, ...r })));
  }

  const pairEligible = pairBuckets.filter((r) => r.decisive >= 3 && r.winRate != null);
  const pairHi = [...pairEligible].sort((a, b) => b.winRate - a.winRate || b.decisive - a.decisive);
  const pairLo = [...pairEligible].sort((a, b) => a.winRate - b.winRate || b.decisive - a.decisive);
  const pairs = {
    best: pairHi.slice(0, 7),
    worst: pairLo.slice(0, 7)
  };

  return {
    generatedAt: new Date().toISOString(),
    aggregate,
    singles,
    pairs
  };
}

module.exports = {
  DATA_SCHEMA_VERSION,
  migrateStoreData,
  normalizeTradeForStorage,
  computeAnalytics,
  buildDashboardFilterStatsBreakdown,
  passesFilters,
  isClosedTrade,
  getTradeOutcomeForFilter,
  isClosedTradeWinForStats,
  isClosedTradeLossForStats,
  computeMaxDrawdown,
};
