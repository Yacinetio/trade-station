const store = require('./store');
const cotService = require('./cotService');

const CACHE_ROOT = 'fundamentalsCache';
const DASHBOARD_CACHE_KEY = `${CACHE_ROOT}.dashboard`;
const DEFAULT_DASHBOARD_TTL_MS = 3 * 60 * 1000;
const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const WB_API = 'https://api.worldbank.org/v2';

const FRED_SERIES_IDS = [
  { id: 'UNRATE', label: 'US unemployment rate', unit: '%' },
  { id: 'FEDFUNDS', label: 'Fed funds effective', unit: '%' },
  { id: 'DGS10', label: '10Y Treasury yield', unit: '%' },
  { id: 'T10Y2Y', label: '10Y minus 2Y Treasury spread', unit: 'ppt' },
];

const MAJOR_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY']);
const RISK_CURRENCIES = new Set(['EUR', 'GBP', 'AUD', 'NZD', 'CAD']);
const SAFE_CURRENCIES = new Set(['USD', 'JPY', 'CHF']);

const INSTRUMENTS = [
  { id: 'EURUSD', symbol: 'EURUSD=X', label: 'EUR/USD', assetClass: 'forex' },
  { id: 'GBPUSD', symbol: 'GBPUSD=X', label: 'GBP/USD', assetClass: 'forex' },
  { id: 'USDJPY', symbol: 'USDJPY=X', label: 'USD/JPY', assetClass: 'forex' },
  { id: 'USDCHF', symbol: 'USDCHF=X', label: 'USD/CHF', assetClass: 'forex' },
  { id: 'USDCAD', symbol: 'USDCAD=X', label: 'USD/CAD', assetClass: 'forex' },
  { id: 'AUDUSD', symbol: 'AUDUSD=X', label: 'AUD/USD', assetClass: 'forex' },
  { id: 'NZDUSD', symbol: 'NZDUSD=X', label: 'NZD/USD', assetClass: 'forex' },
  { id: 'EURJPY', symbol: 'EURJPY=X', label: 'EUR/JPY', assetClass: 'forex' },
  { id: 'GBPJPY', symbol: 'GBPJPY=X', label: 'GBP/JPY', assetClass: 'forex' },

  { id: 'SPX', symbol: '^GSPC', label: 'S&P 500', assetClass: 'indices' },
  { id: 'NDX', symbol: '^NDX', label: 'NASDAQ 100', assetClass: 'indices' },
  { id: 'DJI', symbol: '^DJI', label: 'Dow Jones', assetClass: 'indices' },
  { id: 'DAX', symbol: '^GDAXI', label: 'DAX', assetClass: 'indices' },
  { id: 'FTSE', symbol: '^FTSE', label: 'FTSE 100', assetClass: 'indices' },
  { id: 'NIKKEI', symbol: '^N225', label: 'Nikkei 225', assetClass: 'indices' },
  { id: 'HSI', symbol: '^HSI', label: 'Hang Seng', assetClass: 'indices' },

  { id: 'XAU', symbol: 'GC=F', label: 'Gold', assetClass: 'commodities' },
  { id: 'XAG', symbol: 'SI=F', label: 'Silver', assetClass: 'commodities' },
  { id: 'BRENT', symbol: 'BZ=F', label: 'Brent Oil', assetClass: 'commodities' },
  { id: 'WTI', symbol: 'CL=F', label: 'WTI Oil', assetClass: 'commodities' },
  { id: 'NATGAS', symbol: 'NG=F', label: 'Natural Gas', assetClass: 'commodities' },
  { id: 'COPPER', symbol: 'HG=F', label: 'Copper', assetClass: 'commodities' },

  { id: 'BTC', symbol: 'BTC-USD', label: 'Bitcoin', assetClass: 'crypto' },
  { id: 'ETH', symbol: 'ETH-USD', label: 'Ethereum', assetClass: 'crypto' },
  { id: 'SOL', symbol: 'SOL-USD', label: 'Solana', assetClass: 'crypto' }
];

const PROXY_SYMBOLS = [
  { id: 'VIX', symbol: '^VIX' },
  { id: 'VIX3M', symbol: '^VIX3M' },
  { id: 'DXY', symbol: 'DX-Y.NYB' },
  { id: 'US10Y', symbol: '^TNX' }
];

/** Headlines list: always try to show at least this many rows (releases + pad with upcoming if needed). */
const HEADLINE_FEED_MIN_ITEMS = 5;
/** Wider than "this week" edge so older prints in the JSON still flow into Headlines / cache. */
const CALENDAR_PAST_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const CALENDAR_FUTURE_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** ForexFactory / mixed feeds: text, digits, or numeric. */
function normalizeCalendarImpact(raw) {
  const num = Number(raw);
  if (num === 3 || num === 2 || num === 1) return num;
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return 1;
  if (t.includes('high')) return 3;
  if (t.includes('medium')) return 2;
  if (t.includes('low')) return 1;
  const m = t.match(/^(\d)/);
  if (m) {
    const v = Number(m[1]);
    if (v >= 3) return 3;
    if (v === 2) return 2;
    return 1;
  }
  return 1;
}

function eventMinutesToNow(evt) {
  const t = evt?.time;
  if (t) {
    const when = new Date(t).getTime();
    if (Number.isFinite(when)) return Math.round((when - Date.now()) / 60000);
  }
  return safeNumber(evt?.minutesToEvent, null);
}

function isReleasedHeadlineEvent(evt) {
  const m = eventMinutesToNow(evt);
  if (!Number.isFinite(m) || m > 0) return false;
  return true;
}

function isUpcomingHeadlineEvent(evt) {
  const m = eventMinutesToNow(evt);
  return Number.isFinite(m) && m > 0;
}

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'n/a') return null;
  const sign = raw.startsWith('-') ? -1 : 1;
  const cleaned = raw.replace(/[,%\s]/g, '').replace(/^\+/, '').replace(/^-/, '');
  const suffix = cleaned.slice(-1).toUpperCase();
  const base = (suffix >= 'A' && suffix <= 'Z') ? cleaned.slice(0, -1) : cleaned;
  const num = Number(base);
  if (!Number.isFinite(num)) return null;
  const scale = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1;
  return sign * num * scale;
}

function getReturns(closes = []) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = safeNumber(closes[i - 1], null);
    const curr = safeNumber(closes[i], null);
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
    out.push((curr - prev) / prev);
  }
  return out;
}

function standardDeviation(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + ((v - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function pearsonCorrelation(a = [], b = []) {
  const len = Math.min(a.length, b.length);
  if (len < 4) return null;
  const xs = a.slice(a.length - len);
  const ys = b.slice(b.length - len);
  const meanX = xs.reduce((acc, v) => acc + v, 0) / len;
  const meanY = ys.reduce((acc, v) => acc + v, 0) / len;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < len; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX <= 0 || denY <= 0) return null;
  return num / Math.sqrt(denX * denY);
}

function parseForexPair(id = '') {
  const raw = String(id || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (raw.length !== 6) return null;
  const base = raw.slice(0, 3);
  const quote = raw.slice(3, 6);
  if (!MAJOR_CURRENCIES.has(base) || !MAJOR_CURRENCIES.has(quote)) return null;
  return { base, quote };
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function getCache(cacheKey) {
  const entry = store.get(cacheKey, null);
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.savedAt || !entry.data) return null;
  return entry;
}

function setCache(cacheKey, data) {
  store.set(cacheKey, {
    savedAt: Date.now(),
    data
  });
}

function isCacheFresh(entry, ttlMs) {
  if (!entry?.savedAt) return false;
  return (Date.now() - Number(entry.savedAt)) <= ttlMs;
}

async function fetchChartSymbol(symbol) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=6mo&interval=1d`;
  const payload = await fetchJson(url, 10000);
  const node = payload?.chart?.result?.[0];
  if (!node) return null;
  const closes = Array.isArray(node?.indicators?.quote?.[0]?.close)
    ? node.indicators.quote[0].close
      .filter((x) => x != null && Number.isFinite(Number(x)) && Number(x) > 0)
      .map(Number)
    : [];
  const timestamps = Array.isArray(node?.timestamp) ? node.timestamp : [];
  if (closes.length < 2) return null;
  return {
    symbol,
    closes,
    timestamps,
    meta: node?.meta || {}
  };
}

async function fetchSpark(symbols = []) {
  const tasks = symbols.map((symbol) => fetchChartSymbol(symbol));
  const settled = await Promise.allSettled(tasks);
  const out = {};
  for (let i = 0; i < settled.length; i++) {
    const state = settled[i];
    if (state.status !== 'fulfilled' || !state.value) continue;
    const packet = state.value;
    out[packet.symbol] = packet;
  }
  return out;
}

function instrumentRow(meta, sparkMap) {
  const packet = sparkMap[meta.symbol];
  if (!packet || !Array.isArray(packet.closes) || packet.closes.length < 2) return null;
  const closes = packet.closes;
  const latest = closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return null;

  const pctChange = ((latest - previous) / previous) * 100;
  const returns = getReturns(closes.slice(-8));
  const vol = standardDeviation(returns);
  const volatilityPct = Number.isFinite(vol) ? vol * 100 : null;
  const momentum3 = closes.length >= 4 && closes[closes.length - 4] !== 0
    ? ((latest - closes[closes.length - 4]) / closes[closes.length - 4]) * 100
    : pctChange;
  const trendScore = clamp((pctChange * 9) + (momentum3 * 4), -100, 100);
  const direction = trendScore >= 15 ? 'BULLISH' : trendScore <= -15 ? 'BEARISH' : 'NEUTRAL';

  return {
    id: meta.id,
    symbol: meta.label,
    sourceSymbol: meta.symbol,
    assetClass: meta.assetClass,
    latest: round(latest, 5),
    previous: round(previous, 5),
    priceChange: round(pctChange, 3),
    volatility: round(volatilityPct, 3),
    trendScore: round(trendScore, 2),
    direction
  };
}

function parseCalendarEvents(rawEvents = [], maxEvents = 18, impactFloor = 1) {
  const now = Date.now();
  const futureEvents = [];
  const weightedByCurrency = {};
  const countByCurrency = {};

  for (const item of rawEvents) {
    const country = String(item?.country || '').toUpperCase();
    if (!MAJOR_CURRENCIES.has(country)) continue;
    const impact = normalizeCalendarImpact(item?.impact);
    if (impact < impactFloor) continue;
    const when = new Date(item?.date || item?.dateUtc || item?.date_utc || '').getTime();
    if (!Number.isFinite(when)) continue;

    const forecast = parseNumeric(item?.forecast);
    const previous = parseNumeric(item?.previous);
    const actual = parseNumeric(item?.actual);

    let surprisePct = null;
    if (Number.isFinite(actual)) {
      if (Number.isFinite(forecast) && Math.abs(forecast) > 1e-12) {
        surprisePct = clamp(((actual - forecast) / Math.abs(forecast)) * 100, -200, 200);
      } else if (Number.isFinite(previous) && Math.abs(previous) > 1e-12) {
        surprisePct = clamp(((actual - previous) / Math.abs(previous)) * 100, -200, 200);
      } else {
        surprisePct = 0;
      }
    }

    const hadNumericSurpriseSample =
      Number.isFinite(actual) && Number.isFinite(surprisePct);
    if (hadNumericSurpriseSample && when <= now) {
      const weight = impact === 3 ? 1.8 : impact === 2 ? 1.15 : 0.7;
      weightedByCurrency[country] = (weightedByCurrency[country] || 0) + (surprisePct * weight);
      countByCurrency[country] = (countByCurrency[country] || 0) + 1;
    }

    if (when >= now - CALENDAR_PAST_LOOKBACK_MS && when <= now + CALENDAR_FUTURE_LOOKAHEAD_MS) {
      futureEvents.push({
        id: `${country}-${when}-${String(item?.title || '')}`,
        time: new Date(when).toISOString(),
        minutesToEvent: Math.round((when - now) / 60000),
        country,
        title: String(item?.title || 'Event'),
        impact,
        forecast,
        previous,
        actual: Number.isFinite(actual) ? actual : null,
        surprise: surprisePct
      });
    }
  }

  futureEvents.sort((a, b) => {
    const af = a.minutesToEvent >= 0 ? 0 : 1;
    const bf = b.minutesToEvent >= 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.minutesToEvent - b.minutesToEvent;
  });

  const nextHigh = futureEvents.find((e) => e.impact >= 3 && e.minutesToEvent >= 0) || null;
  const currencySurprise = Object.keys(weightedByCurrency).map((ccy) => {
    const avg = weightedByCurrency[ccy] / Math.max(1, countByCurrency[ccy] || 1);
    return {
      currency: ccy,
      score: round(clamp(avg, -100, 100), 2),
      samples: countByCurrency[ccy] || 0
    };
  }).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const maxSlice = Math.max(1, maxEvents);

  return {
    events: futureEvents.slice(0, maxSlice),
    eventsFullWindow: futureEvents,
    nextHighImpact: nextHigh,
    currencySurprise
  };
}

function scoreFromCalendar(currencySurprise = []) {
  if (!Array.isArray(currencySurprise) || currencySurprise.length === 0) {
    return { score: 0, detail: 'No recent actual/forecast surprises.' };
  }
  let riskScore = 0;
  let safeScore = 0;
  let riskCount = 0;
  let safeCount = 0;

  for (const row of currencySurprise) {
    const ccy = row.currency;
    const score = safeNumber(row.score, 0);
    if (RISK_CURRENCIES.has(ccy)) {
      riskScore += score;
      riskCount++;
    }
    if (SAFE_CURRENCIES.has(ccy)) {
      safeScore += score;
      safeCount++;
    }
  }
  const riskAvg = riskCount > 0 ? riskScore / riskCount : 0;
  const safeAvg = safeCount > 0 ? safeScore / safeCount : 0;
  const blended = clamp((riskAvg - safeAvg) * 1.2, -100, 100);
  return {
    score: round(blended, 2),
    detail: `Risk currencies avg ${round(riskAvg, 1)}, safe-havens avg ${round(safeAvg, 1)}`
  };
}

function scoreFromScreener(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { score: 0, detail: 'No screener rows available.', breadth: { up: 0, down: 0, total: 0 } };
  }
  const primary = rows.filter((r) => r.assetClass !== 'crypto');
  const target = primary.length > 0 ? primary : rows;
  const avgTrend = target.reduce((acc, row) => acc + safeNumber(row.trendScore, 0), 0) / target.length;
  const up = target.filter((r) => safeNumber(r.priceChange, 0) > 0).length;
  const down = target.filter((r) => safeNumber(r.priceChange, 0) < 0).length;
  const breadth = { up, down, total: target.length };
  return {
    score: round(clamp(avgTrend, -100, 100), 2),
    detail: `${up}/${target.length} instruments positive`,
    breadth
  };
}

function scoreFromVolatility(proxyRows = {}) {
  const vix = safeNumber(proxyRows?.VIX?.latest, null);
  if (!Number.isFinite(vix)) {
    return { score: 0, detail: 'VIX data unavailable.', regime: 'UNKNOWN', rawVix: null };
  }
  let score = 0;
  let regime = 'NORMAL';
  if (vix >= 28) {
    score = -85;
    regime = 'EXTREME';
  } else if (vix >= 22) {
    score = -50;
    regime = 'HIGH';
  } else if (vix <= 13) {
    score = 35;
    regime = 'LOW';
  } else {
    score = 5;
    regime = 'NORMAL';
  }
  return {
    score,
    detail: `VIX ${round(vix, 2)} (${regime})`,
    regime,
    rawVix: round(vix, 2)
  };
}

function scoreFromCommodities(rows = []) {
  const gold = rows.find((r) => r.id === 'XAU');
  const brent = rows.find((r) => r.id === 'BRENT');
  const wti = rows.find((r) => r.id === 'WTI');
  if (!gold && !brent && !wti) {
    return { score: 0, detail: 'Commodity signals unavailable.' };
  }
  const oilChange = safeNumber(brent?.priceChange, safeNumber(wti?.priceChange, 0)) || 0;
  const goldChange = safeNumber(gold?.priceChange, 0) || 0;
  const score = clamp((oilChange * 8) - (goldChange * 5), -100, 100);
  return {
    score: round(score, 2),
    detail: `Oil ${round(oilChange, 2)}%, Gold ${round(goldChange, 2)}%`
  };
}

function scoreFromSentimentProxy(proxyRows = {}, fearGreedValue = null) {
  const dxyChange = safeNumber(proxyRows?.DXY?.priceChange, 0) || 0;
  const spxChange = safeNumber(proxyRows?.SPX?.priceChange, 0) || 0;
  const ndxChange = safeNumber(proxyRows?.NDX?.priceChange, 0) || 0;
  const goldChange = safeNumber(proxyRows?.XAU?.priceChange, 0) || 0;
  const usdjpyChange = safeNumber(proxyRows?.USDJPY?.priceChange, 0) || 0;

  let score = 0;
  score += spxChange * 16;
  score += ndxChange * 14;
  score += usdjpyChange * 12;
  score -= dxyChange * 18;
  score -= goldChange * 9;

  if (Number.isFinite(fearGreedValue)) {
    const fgScore = ((fearGreedValue - 50) / 50) * 100;
    score = (score * 0.75) + (fgScore * 0.25);
  }
  score = clamp(score, -100, 100);
  const regime = score >= 25 ? 'RISK_ON' : score <= -25 ? 'RISK_OFF' : 'NEUTRAL';
  return {
    score: round(score, 2),
    detail: `S&P ${round(spxChange, 2)}%, DXY ${round(dxyChange, 2)}%, Gold ${round(goldChange, 2)}%`,
    regime
  };
}

function scoreCalendarForPair(currencySurprise = [], pairInfo = null) {
  if (!pairInfo) return { score: 0, detail: 'Pair is not FX-major pair.' };
  const base = currencySurprise.find((x) => x.currency === pairInfo.base)?.score ?? 0;
  const quote = currencySurprise.find((x) => x.currency === pairInfo.quote)?.score ?? 0;
  const score = clamp((base - quote) * 1.4, -100, 100);
  return {
    score: round(score, 2),
    detail: `${pairInfo.base} ${round(base, 1)} vs ${pairInfo.quote} ${round(quote, 1)}`
  };
}

function scoreSentimentForPair(globalSentimentScore = 0, pairInfo = null) {
  const score = round(clamp(globalSentimentScore, -100, 100), 2);
  if (!pairInfo) {
    return { score, detail: 'Cross-asset sentiment (S&P, DXY, VIX, Fear/Greed).' };
  }
  return {
    score,
    detail: `${pairInfo.base}/${pairInfo.quote}: cross-asset sentiment (live market inputs, not retail poll).`
  };
}

function buildPairNews(events = [], pairInfo = null, maxEvents = 18) {
  const allEvents = Array.isArray(events) ? events : [];
  const pairScoped = pairInfo
    ? allEvents.filter((evt) => evt.country === pairInfo.base || evt.country === pairInfo.quote)
    : allEvents;
  return (pairScoped.length > 0 ? pairScoped : allEvents).slice(0, Math.max(6, Number(maxEvents || 18)));
}

function headlineCategoryFromTitle(title = '') {
  const t = String(title || '').toLowerCase();
  if (/(cpi|inflation|ppi|pce)/.test(t)) return 'INFLATION';
  if (/(nfp|employment|payroll|jobless|unemployment)/.test(t)) return 'LABOR';
  if (/(gdp|growth|retail|manufacturing|pmi|ism|consumer confidence)/.test(t)) return 'GROWTH';
  if (/(rate|fomc|ecb|boe|boj|rba|rbnz|snb|bank of)/.test(t)) return 'CENTRAL_BANK';
  if (/(oil|opec|brent|wti|gas)/.test(t)) return 'ENERGY';
  return 'MACRO';
}

function scoreHeadlineSignal(evt = {}) {
  const impact = normalizeCalendarImpact(evt?.impact);
  const surprise = safeNumber(evt?.surprise, null);
  if (!Number.isFinite(surprise)) return 0;
  const strength = clamp(Math.abs(surprise) * (impact >= 3 ? 1.6 : impact >= 2 ? 1.25 : 0.95), 0, 100);
  return surprise >= 0 ? strength : -strength;
}

function directionFromSignal(signal = 0) {
  if (signal >= 18) return 'BULLISH';
  if (signal <= -18) return 'BEARISH';
  return 'NEUTRAL';
}

function assetSignalForEvent(row = {}, evt = {}, eventSignal = 0) {
  if (!Number.isFinite(eventSignal) || eventSignal === 0) return 0;
  const country = String(evt?.country || '').toUpperCase();
  const rowId = String(row?.id || '').toUpperCase();
  const pair = parseForexPair(rowId);
  if (pair) {
    if (pair.base === country) return eventSignal;
    if (pair.quote === country) return -eventSignal;
    return 0;
  }

  // USD macro spills into common risk assets.
  if (country === 'USD') {
    if (['XAU', 'XAG', 'BTC', 'ETH', 'SOL'].includes(rowId)) return -eventSignal * 0.85;
    if (['SPX', 'NDX', 'DJI', 'DAX', 'FTSE', 'NIKKEI', 'HSI'].includes(rowId)) return -eventSignal * 0.55;
    if (['WTI', 'BRENT'].includes(rowId)) return -eventSignal * 0.25;
  }

  if (country === 'CAD' && ['WTI', 'BRENT'].includes(rowId)) return eventSignal * 0.55;
  if (country === 'JPY' && ['NIKKEI'].includes(rowId)) return eventSignal * 0.45;
  return 0;
}

function buildHeadlineNarrative(evt = {}, selectedPair = null, topAssets = []) {
  const cat = headlineCategoryFromTitle(evt?.title);
  const imp = normalizeCalendarImpact(evt?.impact);
  const impactLabel = imp >= 3 ? 'high impact' : imp >= 2 ? 'medium impact' : 'lower impact';
  const signal = scoreHeadlineSignal(evt);
  const signalDir = directionFromSignal(signal);
  const pairTxt = selectedPair?.symbol || selectedPair?.id || 'major FX and risk assets';
  const top = topAssets.slice(0, 4).map((a) => `${a.symbol} ${a.direction}`).join(', ');
  const m = eventMinutesToNow(evt);
  const isPast = Number.isFinite(m) && m <= 0;
  if (!Number.isFinite(evt?.surprise)) {
    if (isPast) {
      return `${impactLabel} ${cat} headline for ${evt?.country || 'N/A'}. No beat/miss math in the feed — treat as qualitative risk; cross-asset read-through${top ? `: ${top}.` : '.'}`;
    }
    return `Pending release (${impactLabel}, ${cat}). Treat as event-risk window for ${pairTxt}${top ? `; watch ${top}.` : '.'}`;
  }
  const bias = signalDir === 'NEUTRAL' ? 'mixed directional implications' : `${signalDir.toLowerCase()} impulse`;
  return `${cat} print from ${evt?.country || 'N/A'} shows ${bias} (${impactLabel}). Cross-asset read-through${top ? `: ${top}.` : '.'}`;
}

function buildAiHeadlines(events = [], rows = [], selectedRow = null, maxItems = 30) {
  const instruments = Array.isArray(rows) ? rows : [];
  const selectedId = String(selectedRow?.id || '').toUpperCase();
  const rawSource = Array.isArray(events) ? events : [];
  const released = rawSource
    .filter(isReleasedHeadlineEvent)
    .slice()
    .sort((a, b) => {
      const ma = eventMinutesToNow(a);
      const mb = eventMinutesToNow(b);
      const fa = Number.isFinite(ma) ? ma : -1e9;
      const fb = Number.isFinite(mb) ? mb : -1e9;
      return fb - fa;
    });
  const upcoming = rawSource
    .filter(isUpcomingHeadlineEvent)
    .slice()
    .sort((a, b) => eventMinutesToNow(a) - eventMinutesToNow(b));
  const cap = Math.max(HEADLINE_FEED_MIN_ITEMS, Number(maxItems || 30));
  let source = released.slice(0, cap);
  if (source.length < HEADLINE_FEED_MIN_ITEMS) {
    const have = new Set(source.map((e) => e.id));
    for (const u of upcoming) {
      if (source.length >= HEADLINE_FEED_MIN_ITEMS) break;
      if (have.has(u.id)) continue;
      source.push(u);
      have.add(u.id);
    }
  }
  source = source.slice(0, cap);
  const assetOptionsSet = new Set();
  const items = source.map((evt, idx) => {
    const signal = scoreHeadlineSignal(evt);
    const eventDirection = directionFromSignal(signal);
    const impacted = [];
    const spilloverFloor = 4;
    for (const row of instruments) {
      const s = assetSignalForEvent(row, evt, signal);
      if (Math.abs(s) < spilloverFloor) continue;
      impacted.push({
        id: row.id,
        symbol: row.symbol,
        assetClass: row.assetClass,
        score: round(s, 2),
        direction: directionFromSignal(s)
      });
    }
    impacted.sort((a, b) => Math.abs(safeNumber(b.score, 0)) - Math.abs(safeNumber(a.score, 0)));
    let topImpacted = impacted.slice(0, 14);
    const country = String(evt?.country || '').toUpperCase();
    if (topImpacted.length === 0 && country && MAJOR_CURRENCIES.has(country)) {
      topImpacted = instruments
        .filter((row) => row.assetClass === 'forex')
        .map((row) => ({ row, pair: parseForexPair(row.id) }))
        .filter((x) => x.pair && (x.pair.base === country || x.pair.quote === country))
        .slice(0, 12)
        .map(({ row }) => ({
          id: row.id,
          symbol: row.symbol,
          assetClass: row.assetClass,
          score: 0,
          direction: eventDirection !== 'NEUTRAL' ? eventDirection : 'NEUTRAL'
        }));
    }
    if (topImpacted.length === 0 && selectedRow) {
      topImpacted = [{
        id: selectedRow.id,
        symbol: selectedRow.symbol,
        assetClass: selectedRow.assetClass,
        score: round(clamp(signal, -100, 100), 2),
        direction: eventDirection
      }];
    }
    for (const a of topImpacted) assetOptionsSet.add(a.id);
    const selectedImpact = topImpacted.find((a) => String(a.id || '').toUpperCase() === selectedId) || null;
    const imp = normalizeCalendarImpact(evt?.impact);
    const confidence = round(clamp((imp * 24) + Math.abs(signal) * 0.65, 0, 99), 0);
    const directionForSelected = selectedImpact?.direction || eventDirection;
    const mins = eventMinutesToNow(evt);
    const headlineFeedKind = Number.isFinite(mins) && mins > 0 ? 'UPCOMING' : 'RELEASED';
    return {
      id: evt?.id || `headline-${idx}`,
      time: evt?.time || null,
      minutesToEvent: mins,
      headlineFeedKind,
      country: evt?.country || 'N/A',
      impact: imp,
      category: headlineCategoryFromTitle(evt?.title),
      title: evt?.title || 'Macro event',
      summary: buildHeadlineNarrative(evt, selectedRow, topImpacted),
      eventDirection,
      direction: directionForSelected,
      confidence,
      surprise: safeNumber(evt?.surprise, null),
      forecast: safeNumber(evt?.forecast, null),
      actual: safeNumber(evt?.actual, null),
      affectedAssets: topImpacted
    };
  });

  const assetOptions = instruments
    .filter((row) => assetOptionsSet.has(row.id))
    .map((row) => ({ id: row.id, label: row.symbol, assetClass: row.assetClass }));

  return {
    generatedAt: new Date().toISOString(),
    items,
    assetOptions,
    stats: {
      total: items.length,
      highImpact: items.filter((x) => normalizeCalendarImpact(x?.impact) >= 3).length,
      pending: items.filter((x) => x.headlineFeedKind === 'UPCOMING').length
    }
  };
}

function buildPairCorrelations(selectedRow, rows, sparkMap) {
  if (!selectedRow) return [];
  const selectedPacket = sparkMap[selectedRow.sourceSymbol];
  const selectedReturns = getReturns(selectedPacket?.closes || []);
  if (selectedReturns.length < 4) return [];

  const peers = rows.filter((row) => row.id !== selectedRow.id && row.assetClass === selectedRow.assetClass);
  const output = [];
  for (const peer of peers) {
    const peerPacket = sparkMap[peer.sourceSymbol];
    const corr = pearsonCorrelation(selectedReturns, getReturns(peerPacket?.closes || []));
    if (!Number.isFinite(corr)) continue;
    output.push({
      id: peer.id,
      symbol: peer.symbol,
      correlation: round(corr, 3),
      relation: corr >= 0.5 ? 'POSITIVE' : corr <= -0.5 ? 'INVERSE' : 'WEAK'
    });
  }
  return output
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 6);
}

function buildCurrencyStrength(rows = []) {
  const fxRows = rows.filter((row) => row.assetClass === 'forex');
  const bucket = {};
  for (const row of fxRows) {
    const pair = parseForexPair(row.id);
    if (!pair) continue;
    const impulse = (safeNumber(row.trendScore, 0) * 0.55) + (safeNumber(row.priceChange, 0) * 14);
    bucket[pair.base] = (bucket[pair.base] || 0) + impulse;
    bucket[pair.quote] = (bucket[pair.quote] || 0) - impulse;
  }
  const list = Array.from(MAJOR_CURRENCIES).map((currency) => {
    const score = round(clamp(safeNumber(bucket[currency], 0), -100, 100), 2);
    return {
      currency,
      score,
      bias: score >= 20 ? 'STRONG' : score >= 8 ? 'BULLISH' : score <= -20 ? 'WEAK' : score <= -8 ? 'BEARISH' : 'NEUTRAL'
    };
  }).sort((a, b) => safeNumber(b.score, 0) - safeNumber(a.score, 0))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
  const strongest = list[0] || null;
  const weakest = list[list.length - 1] || null;
  let bestPair = null;
  if (strongest && weakest && strongest.currency !== weakest.currency) {
    const pair = `${strongest.currency}${weakest.currency}`;
    const spread = round(Math.abs(safeNumber(strongest.score, 0) - safeNumber(weakest.score, 0)), 2);
    bestPair = {
      pair,
      buy: strongest.currency,
      sell: weakest.currency,
      spread,
      bias: spread >= 35 ? 'STRONG' : spread >= 18 ? 'MODERATE' : 'MILD'
    };
  }
  return {
    rows: list,
    strongest,
    weakest,
    bestPair
  };
}

function buildSessionIntelligence(proxyRows = {}, events = []) {
  const now = new Date();
  const utcHour = now.getUTCHours() + (now.getUTCMinutes() / 60);
  const inAsia = utcHour >= 0 && utcHour < 9;
  const inLondon = utcHour >= 8 && utcHour < 17;
  const inNewYork = utcHour >= 13 && utcHour < 22;
  const overlapLondonNy = utcHour >= 13 && utcHour < 17;
  const openCount = [inAsia, inLondon, inNewYork].filter(Boolean).length;
  const liquidityScore = round(clamp(openCount * 36 + (overlapLondonNy ? 18 : 0), 0, 100), 1);
  const vix = safeNumber(proxyRows?.VIX?.latest, null);
  const volPenalty = Number.isFinite(vix) ? clamp((vix - 16) * 2.8, -20, 42) : 0;
  const sessionEdge = round(clamp(liquidityScore - volPenalty, -100, 100), 1);
  const activeLabel = overlapLondonNy ? 'LONDON_NEWYORK_OVERLAP' : inLondon ? 'LONDON' : inNewYork ? 'NEW_YORK' : inAsia ? 'ASIA' : 'OFF_HOURS';
  const sessionHighEvents = (Array.isArray(events) ? events : [])
    .filter((evt) => safeNumber(evt?.impact, 0) >= 3 && safeNumber(evt?.minutesToEvent, 99999) >= 0 && safeNumber(evt?.minutesToEvent, 99999) <= 240);
  return {
    utcTime: now.toISOString(),
    activeSession: activeLabel,
    overlap: overlapLondonNy,
    liquidityScore,
    volatilityPenalty: round(volPenalty, 1),
    edgeScore: sessionEdge,
    highImpactNext4h: sessionHighEvents.length,
    utcHour: round(utcHour, 2),
    sessions: [
      { id: 'asia', label: 'Asia', startUtc: 0, endUtc: 9, active: inAsia },
      { id: 'london', label: 'London', startUtc: 8, endUtc: 17, active: inLondon },
      { id: 'newYork', label: 'New York', startUtc: 13, endUtc: 22, active: inNewYork },
      { id: 'overlap', label: 'London × NY', startUtc: 13, endUtc: 17, active: overlapLondonNy }
    ]
  };
}

function buildVixTermStructure(vix, vix3m) {
  const spot = safeNumber(vix, null);
  const term = safeNumber(vix3m, null);
  if (!Number.isFinite(spot) || !Number.isFinite(term)) return null;
  const spread = round(term - spot, 2);
  let label = 'Contango (calm)';
  let tone = 'neutral';
  if (spread > 2) {
    label = 'Backwardation (near-term stress)';
    tone = 'stress';
  } else if (spread > 0.5) {
    label = 'Mild backwardation';
    tone = 'warn';
  } else if (spread < -1) {
    label = 'Steep contango';
    tone = 'calm';
  }
  return {
    vix: round(spot, 2),
    vix3m: round(term, 2),
    spread,
    label,
    tone
  };
}

function buildProviderHealth({
  sparkResult,
  calendarResult,
  altBundleResult,
  wbResult,
  fredResult,
  cgResult,
  cotResult,
  cotBundle
}) {
  const row = (id, label, type, settled, extra = {}) => {
    const fulfilled = settled?.status === 'fulfilled';
    const rejected = settled?.status === 'rejected';
    let status = 'ok';
    if (rejected) status = 'error';
    else if (extra.stale) status = 'stale';
    else if (!fulfilled) status = 'error';
    return {
      id,
      label,
      type,
      status,
      error: rejected ? String(settled.reason?.message || settled.reason || 'Failed') : (extra.error || null)
    };
  };
  return [
    row('yahoo_chart', 'Yahoo Finance Chart API', 'market_data', sparkResult),
    row('forexfactory_calendar', 'ForexFactory Weekly Calendar', 'calendar', calendarResult),
    row('alternative_me', 'Alternative.me Fear/Greed', 'sentiment', altBundleResult),
    row('world_bank', 'World Bank Open Data', 'macro', wbResult),
    row('fred_stlouisfed', 'FRED economic data', 'macro', fredResult, { stale: fredResult?.status === 'fulfilled' && fredResult.value?.configured === false }),
    row('coingecko', 'CoinGecko API', 'crypto_reference', cgResult, { stale: cgResult?.status === 'fulfilled' && !cgResult.value?.ok }),
    row('cftc_cot', 'CFTC Commitments of Traders', 'positioning', cotResult, { stale: !!cotBundle?.stale, error: cotBundle?.error || null })
  ];
}

function buildNewsImpactZones(events = [], pairInfo = null) {
  const list = Array.isArray(events) ? events : [];
  const scoped = pairInfo
    ? list.filter((evt) => evt.country === pairInfo.base || evt.country === pairInfo.quote)
    : list;
  const highOnly = scoped.filter((evt) => safeNumber(evt?.impact, 0) >= 3);
  const windows = [15, 30, 60, 120].map((minutes) => ({
    windowMinutes: minutes,
    upcoming: highOnly.filter((evt) => safeNumber(evt?.minutesToEvent, 99999) >= 0 && safeNumber(evt?.minutesToEvent, 99999) <= minutes).length
  }));
  const recentHigh = highOnly.filter((evt) => safeNumber(evt?.minutesToEvent, -99999) < 0 && safeNumber(evt?.minutesToEvent, -99999) >= -120).length;
  return {
    windows,
    highUpcomingTotal: highOnly.filter((evt) => safeNumber(evt?.minutesToEvent, 99999) >= 0).length,
    recentHighPast2h: recentHigh
  };
}

function buildCarryProxy(pairInfo = null, currencyStrength = [], currencySurprise = [], macroFed = null) {
  if (!pairInfo) {
    return { available: false, score: null, detail: 'Select a major FX pair for rate context.' };
  }
  if (macroFed?.configured !== true || !Array.isArray(macroFed.rows) || macroFed.rows.length === 0) {
    return {
      available: false,
      score: null,
      detail: 'Live rate differential unavailable — set FRED_API_KEY for US macro series (Fed funds, yields).'
    };
  }
  const fedFunds = macroFed.rows.find((r) => r.id === 'FEDFUNDS');
  if (!fedFunds || !Number.isFinite(Number(fedFunds.value))) {
    return { available: false, score: null, detail: 'FRED configured but Fed funds observation missing.' };
  }
  const baseStrength = safeNumber(currencyStrength.find((r) => r.currency === pairInfo.base)?.score, 0);
  const quoteStrength = safeNumber(currencyStrength.find((r) => r.currency === pairInfo.quote)?.score, 0);
  const baseMacro = safeNumber(currencySurprise.find((r) => r.currency === pairInfo.base)?.score, 0);
  const quoteMacro = safeNumber(currencySurprise.find((r) => r.currency === pairInfo.quote)?.score, 0);
  const usdIsQuote = pairInfo.quote === 'USD';
  const usdIsBase = pairInfo.base === 'USD';
  let rateEdge = 0;
  if (usdIsQuote) rateEdge = Number(fedFunds.value) * 8;
  else if (usdIsBase) rateEdge = -Number(fedFunds.value) * 8;
  const score = clamp(rateEdge + ((baseStrength - quoteStrength) * 0.35) + ((baseMacro - quoteMacro) * 0.55), -100, 100);
  return {
    available: true,
    score: round(score, 2),
    detail: `FRED Fed funds ${round(fedFunds.value, 2)}% (${fedFunds.date || 'latest'}) • strength ${pairInfo.base}-${pairInfo.quote}`,
    source: 'fred_fed_funds'
  };
}

function buildCotSummary(cotPositioning = null) {
  if (cotPositioning?.available && Number.isFinite(Number(cotPositioning.pairScore))) {
    return {
      available: true,
      score: cotPositioning.pairScore,
      stance: cotPositioning.stance,
      detail: cotPositioning.detail,
      source: 'cftc_cot',
      reportDate: cotPositioning.reportDate || null
    };
  }
  return {
    available: false,
    score: null,
    stance: null,
    detail: cotPositioning?.reason || 'CFTC COT data unavailable — select a major FX pair (e.g. EURUSD).',
    source: 'unavailable',
    reportDate: null
  };
}

function buildSeasonality(selectedRow = null, packet = null) {
  const timestamps = Array.isArray(packet?.timestamps) ? packet.timestamps : [];
  const closes = Array.isArray(packet?.closes) ? packet.closes : [];
  if (!selectedRow || timestamps.length < 20 || closes.length < 20) {
    return { available: false, bestWeekday: null, worstWeekday: null, bestMonth: null, worstMonth: null, weekdayRows: [], monthRows: [] };
  }
  const byWeekday = Array.from({ length: 7 }, () => []);
  const byMonth = Array.from({ length: 12 }, () => []);
  const len = Math.min(timestamps.length, closes.length);
  for (let i = 1; i < len; i++) {
    const prev = safeNumber(closes[i - 1], null);
    const curr = safeNumber(closes[i], null);
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
    const dt = new Date(Number(timestamps[i]) * 1000);
    const retPct = ((curr - prev) / prev) * 100;
    byWeekday[dt.getUTCDay()].push(retPct);
    byMonth[dt.getUTCMonth()].push(retPct);
  }
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdayRows = byWeekday.map((vals, idx) => ({
    key: weekdayNames[idx],
    mean: round(vals.length ? vals.reduce((acc, v) => acc + v, 0) / vals.length : 0, 3),
    samples: vals.length
  }));
  const monthRows = byMonth.map((vals, idx) => ({
    key: monthNames[idx],
    mean: round(vals.length ? vals.reduce((acc, v) => acc + v, 0) / vals.length : 0, 3),
    samples: vals.length
  }));
  const bestWeekday = weekdayRows.slice().sort((a, b) => safeNumber(b.mean, 0) - safeNumber(a.mean, 0))[0] || null;
  const worstWeekday = weekdayRows.slice().sort((a, b) => safeNumber(a.mean, 0) - safeNumber(b.mean, 0))[0] || null;
  const bestMonth = monthRows.slice().sort((a, b) => safeNumber(b.mean, 0) - safeNumber(a.mean, 0))[0] || null;
  const worstMonth = monthRows.slice().sort((a, b) => safeNumber(a.mean, 0) - safeNumber(b.mean, 0))[0] || null;
  return {
    available: true,
    bestWeekday,
    worstWeekday,
    bestMonth,
    worstMonth,
    weekdayRows,
    monthRows
  };
}

function composeScoreBreakdown(modules = []) {
  const valid = modules
    .filter((m) => Number.isFinite(Number(m?.score)) && Number.isFinite(Number(m?.weight)))
    .map((m) => ({ ...m, score: Number(m.score), weight: Number(m.weight) }));

  const weightSum = valid.reduce((acc, item) => acc + item.weight, 0) || 1;
  const normalized = valid.map((item) => {
    const normalizedWeight = (item.weight / weightSum) * 100;
    return {
      ...item,
      normalizedWeight: round(normalizedWeight, 2),
      contribution: round(item.score * (normalizedWeight / 100), 2),
      direction: item.score >= 0 ? 'BULLISH' : 'BEARISH'
    };
  });

  const totalScore = normalized.reduce((acc, item) => acc + item.contribution, 0);
  const clamped = clamp(totalScore, -100, 100);
  const signPositive = clamped >= 0;
  const agree = normalized.filter((item) => (item.score >= 0) === signPositive).length;
  const agreementFactor = normalized.length > 0 ? agree / normalized.length : 0;
  const confidence = clamp(Math.abs(clamped) * agreementFactor, 0, 100);
  const keyDriver = normalized
    .slice()
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]?.name || 'N/A';

  return {
    totalScore: round(clamped, 2),
    bias: clamped >= 30 ? 'STRONG_BULL' : clamped >= 12 ? 'MODERATE_BULL' : clamped <= -30 ? 'STRONG_BEAR' : clamped <= -12 ? 'MODERATE_BEAR' : 'NEUTRAL',
    confidence: round(confidence, 2),
    modulesAgree: agree,
    modulesTotal: normalized.length,
    keyDriver,
    modules: normalized
  };
}

function buildChecklist({ nextHighImpact, volatilityRegime, sentimentRegime, scoreSummary, dataCoverage, cotPositioning }) {
  const items = [];

  const minToHigh = safeNumber(nextHighImpact?.minutesToEvent, null);
  if (Number.isFinite(minToHigh)) {
    if (minToHigh <= 30) items.push({ key: 'news_window', label: `High-impact event in ${minToHigh}m`, status: 'fail', detail: 'Too close to event risk.' });
    else if (minToHigh <= 120) items.push({ key: 'news_window', label: `High-impact event in ${minToHigh}m`, status: 'warn', detail: 'Reduce risk ahead of event.' });
    else items.push({ key: 'news_window', label: 'No immediate high-impact event', status: 'pass', detail: '' });
  } else {
    items.push({ key: 'news_window', label: 'No high-impact event detected', status: 'pass', detail: '' });
  }

  if (volatilityRegime === 'EXTREME') {
    items.push({ key: 'volatility', label: 'Volatility regime: EXTREME', status: 'fail', detail: 'Execution risk elevated.' });
  } else if (volatilityRegime === 'HIGH') {
    items.push({ key: 'volatility', label: 'Volatility regime: HIGH', status: 'warn', detail: 'Use tighter risk limits.' });
  } else {
    items.push({ key: 'volatility', label: `Volatility regime: ${volatilityRegime || 'NORMAL'}`, status: 'pass', detail: '' });
  }

  if (scoreSummary.confidence >= 60 && Math.abs(scoreSummary.totalScore) >= 25) {
    items.push({ key: 'confidence', label: `Confidence ${scoreSummary.confidence}%`, status: 'pass', detail: 'Signal quality acceptable.' });
  } else if (scoreSummary.confidence >= 35) {
    items.push({ key: 'confidence', label: `Confidence ${scoreSummary.confidence}%`, status: 'warn', detail: 'Mixed module agreement.' });
  } else {
    items.push({ key: 'confidence', label: `Confidence ${scoreSummary.confidence}%`, status: 'fail', detail: 'Insufficient alignment.' });
  }

  if (sentimentRegime === 'NEUTRAL') {
    items.push({ key: 'sentiment_regime', label: 'Sentiment regime: NEUTRAL', status: 'warn', detail: 'No strong risk regime edge.' });
  } else {
    items.push({ key: 'sentiment_regime', label: `Sentiment regime: ${sentimentRegime}`, status: 'pass', detail: '' });
  }

  if (dataCoverage >= 0.7) {
    items.push({ key: 'coverage', label: `Data coverage ${(dataCoverage * 100).toFixed(0)}%`, status: 'pass', detail: '' });
  } else if (dataCoverage >= 0.45) {
    items.push({ key: 'coverage', label: `Data coverage ${(dataCoverage * 100).toFixed(0)}%`, status: 'warn', detail: 'Some feeds unavailable.' });
  } else {
    items.push({ key: 'coverage', label: `Data coverage ${(dataCoverage * 100).toFixed(0)}%`, status: 'fail', detail: 'Not enough live inputs.' });
  }

  if (cotPositioning?.available) {
    const div = cotPositioning.divergence;
    if (div) {
      items.push({
        key: 'cot_divergence',
        label: div.label || 'Spec vs retail divergence',
        status: 'warn',
        detail: div.hint || 'Positioning conflict — confirm with structure.'
      });
    } else if (Math.abs(Number(cotPositioning.pairScore)) >= 35) {
      items.push({
        key: 'cot_bias',
        label: `COT specs ${cotPositioning.stance?.replace(/_/g, ' ') || 'biased'}`,
        status: 'pass',
        detail: cotPositioning.detail || ''
      });
    } else {
      items.push({
        key: 'cot_neutral',
        label: 'COT positioning mixed',
        status: 'warn',
        detail: 'No strong speculator edge from weekly CFTC data.'
      });
    }
  }

  const failCount = items.filter((item) => item.status === 'fail').length;
  const passCount = items.filter((item) => item.status === 'pass').length;
  let verdict = 'WAIT';
  if (failCount > 0) verdict = 'NO_GO';
  else if (passCount >= Math.ceil(items.length * 0.7) && scoreSummary.confidence >= 55) verdict = 'GO';

  return {
    items,
    verdict,
    summary: `${passCount} pass / ${items.length - passCount - failCount} warn / ${failCount} fail`
  };
}

async function fetchAlternativeSentimentBundle() {
  const empty = {
    fearGreed: null,
    fearGreedHistory: [],
    globalCryptoUsd: null,
  };
  try {
    const [fgSettled, globSettled] = await Promise.allSettled([
      fetchJson('https://api.alternative.me/fng/?limit=14', 9000),
      fetchJson('https://api.alternative.me/v2/global/', 9000),
    ]);

    let fearGreed = null;
    let fearGreedHistory = [];
    if (fgSettled.status === 'fulfilled' && Array.isArray(fgSettled.value?.data)) {
      fearGreedHistory = fgSettled.value.data
        .map((item) => {
          const value = safeNumber(item?.value, null);
          if (!Number.isFinite(value)) return null;
          return {
            value: round(value, 2),
            classification: String(item?.value_classification || ''),
            timestamp: item?.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null,
          };
        })
        .filter(Boolean);
      const row = fgSettled.value.data[0];
      const v = safeNumber(row?.value, null);
      if (Number.isFinite(v)) {
        fearGreed = {
          value: round(v, 2),
          classification: String(row?.value_classification || '').toUpperCase() || null,
          timestamp: row?.timestamp ? new Date(Number(row.timestamp) * 1000).toISOString() : null,
        };
      }
    }

    let globalCryptoUsd = null;
    if (globSettled.status === 'fulfilled') {
      const q = globSettled.value?.data?.quotes?.USD;
      const d = globSettled.value?.data;
      if (q && typeof q === 'object') {
        const domRaw = safeNumber(d?.bitcoin_percentage_of_market_cap, null);
        const domPct = Number.isFinite(domRaw) ? (domRaw <= 1 ? domRaw * 100 : domRaw) : null;
        globalCryptoUsd = {
          totalMarketCap: round(safeNumber(q.total_market_cap, null), 0),
          totalVolume24h: round(safeNumber(q.total_volume_24h, null), 0),
          btcDominancePct: round(domPct, 2),
        };
      }
    }

    return { fearGreed, fearGreedHistory, globalCryptoUsd };
  } catch {
    return empty;
  }
}

async function fetchWorldBankSnapshot() {
  const countries = 'USA;GBR;JPN;DEU;CHN;AUS;CAN;CHE';
  const indicators = [
    { id: 'NY.GDP.MKTP.KD.ZG', key: 'gdpGrowth', label: 'GDP growth (annual %)' },
    { id: 'FP.CPI.TOTL.ZG', key: 'inflation', label: 'Inflation CPI (annual %)' },
  ];
  try {
    const byCountry = {};
    await Promise.all(
      indicators.map(async (ind) => {
        const url = `${WB_API}/country/${countries}/indicator/${ind.id}?format=json&date=2019:2026&per_page=500`;
        const data = await fetchJson(url, 16000);
        const observations = Array.isArray(data?.[1]) ? data[1] : [];
        for (const r of observations) {
          const id3 = String(r?.countryiso3code || r?.country?.id || '').trim();
          if (!id3 || r?.value === null || r?.value === undefined || String(r.value).trim() === '') continue;
          const year = Number.parseInt(String(r.date || ''), 10);
          const val = Number(r.value);
          if (!Number.isFinite(year) || !Number.isFinite(val)) continue;
          const name = String(r?.country?.value || id3);
          if (!byCountry[id3]) {
            byCountry[id3] = { countryCode: id3, countryName: name, indicators: {} };
          }
          const prev = byCountry[id3].indicators[ind.key];
          if (!prev || year > prev.year) {
            byCountry[id3].indicators[ind.key] = {
              label: ind.label,
              value: round(val, 2),
              year,
            };
          }
        }
      }),
    );

    const rows = Object.values(byCountry).sort((a, b) =>
      String(a.countryName).localeCompare(String(b.countryName)),
    );
    return {
      ok: true,
      rows,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: error?.message || 'worldbank_failed',
      fetchedAt: new Date().toISOString(),
    };
  }
}

async function fetchFredSnapshot() {
  const apiKey = String(process.env.FRED_API_KEY || '').trim();
  if (!apiKey) {
    return {
      configured: false,
      rows: [],
      hint: 'Set environment variable FRED_API_KEY for US macro series.',
    };
  }

  async function latestObservation(seriesId) {
    const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=1`;
    const j = await fetchJson(u, 12000);
    const obs = Array.isArray(j?.observations) ? j.observations[0] : null;
    if (!obs || obs.value === '.' || obs.value === undefined || obs.value === null) return null;
    const v = Number(obs.value);
    if (!Number.isFinite(v)) return null;
    return { date: String(obs.date || ''), value: round(v, 4) };
  }

  try {
    const rows = [];
    await Promise.all(
      FRED_SERIES_IDS.map(async (series) => {
        try {
          const obs = await latestObservation(series.id);
          if (obs) rows.push({
            id: series.id,
            label: series.label,
            unit: series.unit,
            date: obs.date,
            value: obs.value,
          });
        } catch {
          /* series skipped */
        }
      }),
    );
    rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return {
      configured: true,
      rows,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return { configured: true, rows: [], error: 'fred_batch_failed', fetchedAt: new Date().toISOString() };
  }
}

async function fetchCoinGeckoBundle() {
  const empty = () => ({
    ok: false,
    global: null,
    trending: [],
    spot: {},
    fetchedAt: new Date().toISOString(),
  });
  try {
    const settled = await Promise.allSettled([
      fetchJson('https://api.coingecko.com/api/v3/global', 12000),
      fetchJson('https://api.coingecko.com/api/v3/search/trending', 10000),
      fetchJson(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
        10000,
      ),
    ]);
    let globalAgg = null;
    if (settled[0].status === 'fulfilled' && settled[0].value?.data) {
      const g = settled[0].value.data;
      globalAgg = {
        totalMarketCapUsd: round(safeNumber(g?.total_market_cap?.usd, null), 0),
        totalVolume24hUsd: round(safeNumber(g?.total_volume?.usd, null), 0),
        btcDominancePct: round(safeNumber(g?.market_cap_percentage?.btc, null), 2),
        activeCryptocurrencies: safeNumber(g?.active_cryptocurrencies, null),
      };
    }
    let trending = [];
    if (settled[1].status === 'fulfilled' && Array.isArray(settled[1].value?.coins)) {
      trending = settled[1].value.coins.slice(0, 10).map((c) => {
        const item = c?.item || {};
        return {
          rank: typeof item?.score === 'number' ? item.score : null,
          symbol: String(item?.symbol || '').toUpperCase(),
          name: String(item?.name || ''),
          id: String(item?.id || ''),
        };
      });
    }
    const spot =
      settled[2].status === 'fulfilled' && settled[2].value && typeof settled[2].value === 'object'
        ? settled[2].value
        : {};

    const ok =
      !!(globalAgg && Number.isFinite(globalAgg.totalMarketCapUsd)) ||
      trending.length > 0 ||
      Object.keys(spot).length > 0;
    return {
      ok,
      global: globalAgg,
      trending,
      spot,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return empty();
  }
}

async function buildLiveDashboard(settings = {}, options = {}) {
  const maxEvents = Math.max(8, Number(settings?.fundamentalsMaxEvents || 18));
  const impactFloor = String(settings?.fundamentalsCalendarImpact || 'MEDIUM').toUpperCase() === 'HIGH' ? 3 : 2;
  const includeCrypto = settings?.fundamentalsIncludeCrypto !== false;

  const allSymbols = [
    ...INSTRUMENTS.filter((i) => includeCrypto || i.assetClass !== 'crypto').map((i) => i.symbol),
    ...PROXY_SYMBOLS.map((p) => p.symbol)
  ];
  const [
    sparkResult,
    calendarResult,
    altBundleResult,
    wbResult,
    fredResult,
    cgResult,
    cotResult,
  ] = await Promise.allSettled([
    fetchSpark(allSymbols),
    fetchJson(CALENDAR_URL, 10000),
    fetchAlternativeSentimentBundle(),
    fetchWorldBankSnapshot(),
    fetchFredSnapshot(),
    fetchCoinGeckoBundle(),
    cotService.getCotBundle({ forceRefresh: !!options?.forceRefresh }),
  ]);
  const sparkMap = sparkResult.status === 'fulfilled' ? (sparkResult.value || {}) : {};
  const rawCalendar = calendarResult.status === 'fulfilled' ? (calendarResult.value || []) : [];
  const altBundle =
    altBundleResult.status === 'fulfilled'
      ? (altBundleResult.value || {})
      : { fearGreed: null, fearGreedHistory: [], globalCryptoUsd: null };
  const fearGreed = altBundle.fearGreed || null;
  const macroWorldBank = wbResult.status === 'fulfilled' ? wbResult.value : { ok: false, rows: [] };
  const macroFed = fredResult.status === 'fulfilled' ? fredResult.value : { configured: false, rows: [] };
  const cryptoMarket = cgResult.status === 'fulfilled' ? cgResult.value : { ok: false };
  const cotBundle = cotResult.status === 'fulfilled' ? cotResult.value : { ok: false };

  const rows = INSTRUMENTS
    .filter((meta) => includeCrypto || meta.assetClass !== 'crypto')
    .map((meta) => instrumentRow(meta, sparkMap))
    .filter(Boolean);

  const rowById = rows.reduce((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const proxyRows = {};
  for (const proxy of PROXY_SYMBOLS) {
    const packet = sparkMap[proxy.symbol];
    if (!packet || !Array.isArray(packet.closes) || packet.closes.length < 2) continue;
    const latest = packet.closes[packet.closes.length - 1];
    const previous = packet.closes[packet.closes.length - 2];
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) continue;
    proxyRows[proxy.id] = {
      latest: round(latest, 4),
      priceChange: round(((latest - previous) / previous) * 100, 3)
    };
  }

  // expose a few important rows into proxy context for sentiment explanations
  proxyRows.SPX = rowById.SPX || null;
  proxyRows.NDX = rowById.NDX || null;
  proxyRows.XAU = rowById.XAU || null;
  proxyRows.USDJPY = rowById.USDJPY || null;

  let calendarPack = parseCalendarEvents(Array.isArray(rawCalendar) ? rawCalendar : [], maxEvents, impactFloor);
  if (calendarPack.events.length === 0) {
    calendarPack = parseCalendarEvents(Array.isArray(rawCalendar) ? rawCalendar : [], maxEvents, 1);
  }
  const calWindowArr = calendarPack.eventsFullWindow || calendarPack.events;
  const calendarScore = scoreFromCalendar(calendarPack.currencySurprise);
  const screenerScore = scoreFromScreener(rows);
  const volScore = scoreFromVolatility(proxyRows);
  const commodityScore = scoreFromCommodities(rows);
  const sentimentProxy = scoreFromSentimentProxy(proxyRows, fearGreed?.value ?? null);

  const scoreSummary = composeScoreBreakdown([
    { key: 'calendar', name: 'Macro Surprise', score: calendarScore.score, weight: 24, detail: calendarScore.detail },
    { key: 'sentiment', name: 'Cross-Asset Sentiment', score: sentimentProxy.score, weight: 24, detail: sentimentProxy.detail },
    { key: 'breadth', name: 'Market Breadth', score: screenerScore.score, weight: 20, detail: screenerScore.detail },
    { key: 'volatility', name: 'Volatility Regime', score: volScore.score, weight: 18, detail: volScore.detail },
    { key: 'commodities', name: 'Commodities Pulse', score: commodityScore.score, weight: 14, detail: commodityScore.detail }
  ]);

  const totalExpected = INSTRUMENTS.filter((i) => includeCrypto || i.assetClass !== 'crypto').length;
  const coverageRatio = totalExpected > 0 ? rows.length / totalExpected : 0;
  const nowIso = new Date().toISOString();
  const topBullish = rows
    .filter((r) => r.assetClass !== 'crypto')
    .slice()
    .sort((a, b) => safeNumber(b.trendScore, 0) - safeNumber(a.trendScore, 0))
    .slice(0, 6);
  const topBearish = rows
    .filter((r) => r.assetClass !== 'crypto')
    .slice()
    .sort((a, b) => safeNumber(a.trendScore, 0) - safeNumber(b.trendScore, 0))
    .slice(0, 6);
  const cryptoSnapshot = rows
    .filter((r) => r.assetClass === 'crypto')
    .slice()
    .sort((a, b) => Math.abs(safeNumber(b.priceChange, 0)) - Math.abs(safeNumber(a.priceChange, 0)));

  const preferredPair = String(options?.selectedPair || options?.pair || '').trim().toUpperCase();
  const selectedRow = preferredPair ? (rowById[preferredPair] || null) : null;
  const selectedPairInfo = preferredPair ? parseForexPair(preferredPair) : null;
  const cotPositioning = cotBundle?.ok && cotBundle.currencyMap
    ? cotService.buildPositioningForPair(selectedPairInfo, cotBundle.currencyMap)
  : { available: false, reason: cotBundle?.error || 'COT data unavailable' };
  if (cotPositioning?.available && Array.isArray(cotBundle?.records)) {
    if (cotPositioning.base) {
      cotPositioning.baseSpecHistory = cotService.buildSpecHistorySeries(cotBundle.records, selectedPairInfo?.base, 8);
    }
    if (selectedPairInfo?.quote && selectedPairInfo.quote !== 'USD') {
      cotPositioning.quoteSpecHistory = cotService.buildSpecHistorySeries(cotBundle.records, selectedPairInfo.quote, 8);
    }
    cotPositioning.retailCrowdedAlerts = cotService.buildRetailCrowdedAlerts(cotBundle.currencyMap, 70);
  }
  const cotCurrencyRows = cotBundle?.ok && cotBundle.currencyMap
    ? Object.values(cotBundle.currencyMap).sort((a, b) => Math.abs(Number(b.specScore)) - Math.abs(Number(a.specScore)))
    : [];

  const aggregateSentimentRegime =
    scoreSummary.totalScore >= 25 ? 'RISK_ON' : scoreSummary.totalScore <= -25 ? 'RISK_OFF' : 'NEUTRAL';

  let pairScoreSummary;
  let overviewSentimentRegime;
  let sentimentPanelScore;
  let sentimentPanelRegime;

  if (selectedRow) {
    const pairCalendarScore = scoreCalendarForPair(calendarPack.currencySurprise, selectedPairInfo);
    const pairSentimentScore = scoreSentimentForPair(sentimentProxy.score, selectedPairInfo);
    const pairMomentumScore = {
      score: round(clamp((safeNumber(selectedRow.trendScore, 0) * 0.7) + (safeNumber(selectedRow.priceChange, 0) * 12), -100, 100), 2),
      detail: `${selectedRow.symbol} trend ${round(selectedRow.trendScore || 0, 1)}`
    };
    const pairVolatilityScore = {
      score: round(clamp(-(safeNumber(selectedRow.volatility, 0) * 18) + (volScore.score * 0.4), -100, 100), 2),
      detail: `${selectedRow.symbol} volatility ${round(selectedRow.volatility || 0, 2)}%`
    };
    pairScoreSummary = composeScoreBreakdown([
      { key: 'pair_calendar', name: 'Pair Macro Surprise', score: pairCalendarScore.score, weight: 26, detail: pairCalendarScore.detail },
      { key: 'pair_sentiment', name: 'Pair Sentiment Alignment', score: pairSentimentScore.score, weight: 24, detail: pairSentimentScore.detail },
      { key: 'pair_momentum', name: 'Pair Momentum', score: pairMomentumScore.score, weight: 28, detail: pairMomentumScore.detail },
      { key: 'pair_volatility', name: 'Pair Volatility Control', score: pairVolatilityScore.score, weight: 22, detail: pairVolatilityScore.detail }
    ]);
    const ps = pairSentimentScore.score;
    overviewSentimentRegime = ps >= 25 ? 'RISK_ON' : ps <= -25 ? 'RISK_OFF' : 'NEUTRAL';
    sentimentPanelScore = pairSentimentScore.score;
    sentimentPanelRegime = overviewSentimentRegime;
  } else {
    pairScoreSummary = scoreSummary;
    overviewSentimentRegime = aggregateSentimentRegime;
    sentimentPanelScore = sentimentProxy.score;
    sentimentPanelRegime = aggregateSentimentRegime;
  }

  const pairNews = buildPairNews(calWindowArr, selectedPairInfo, maxEvents);
  const pairNextImpact = pairNews.find((evt) => {
    const mn = eventMinutesToNow(evt);
    return Number.isFinite(mn) && mn >= 0 && evt.impact >= 2;
  }) || calendarPack.nextHighImpact || null;
  const headlineIntel = buildAiHeadlines(calWindowArr, rows, null, Math.max(maxEvents, 30));
  const currencyStrengthPack = buildCurrencyStrength(rows);
  const sessionIntelligence = buildSessionIntelligence(proxyRows, calWindowArr);
  const newsImpactZones = buildNewsImpactZones(calWindowArr, selectedPairInfo);
  const carryProxy = buildCarryProxy(
    selectedPairInfo,
    currencyStrengthPack.rows,
    calendarPack.currencySurprise,
    macroFed
  );
  const checklist = buildChecklist({
    nextHighImpact: pairNextImpact,
    volatilityRegime: volScore.regime,
    sentimentRegime: overviewSentimentRegime,
    scoreSummary: pairScoreSummary,
    dataCoverage: coverageRatio,
    cotPositioning
  });
  const correlations = buildPairCorrelations(selectedRow, rows, sparkMap);
  const cotProxy = buildCotSummary(cotPositioning);
  const seasonality = buildSeasonality(selectedRow, sparkMap[selectedRow?.sourceSymbol]);
  const vixTerm = buildVixTermStructure(proxyRows?.VIX?.latest, proxyRows?.VIX3M?.latest);
  const providerHealth = buildProviderHealth({
    sparkResult,
    calendarResult,
    altBundleResult,
    wbResult,
    fredResult,
    cgResult,
    cotResult,
    cotBundle
  });

  const data = {
    generatedAt: nowIso,
    hasRealData: rows.length > 0 || calWindowArr.length > 0,
    stale: false,
    unavailable: false,
    overview: {
      marketBias: pairScoreSummary.bias,
      sentimentRegime: overviewSentimentRegime,
      score: pairScoreSummary.totalScore,
      confidence: pairScoreSummary.confidence,
      keyDriver: pairScoreSummary.keyDriver,
      nextHighImpact: pairNextImpact,
      dataCoverage: round(coverageRatio * 100, 1),
      breadth: screenerScore.breadth,
      selectedPair: selectedRow?.id || selectedPairInfo ? preferredPair : null,
      selectedPairLabel: selectedRow?.symbol || (selectedPairInfo ? `${selectedPairInfo.base}/${selectedPairInfo.quote}` : null),
      portfolioScope: !selectedPairInfo
    },
    calendar: {
      events: pairNews,
      allEvents: calWindowArr,
      nextHighImpact: pairNextImpact,
      currencySurprise: calendarPack.currencySurprise
    },
    headlineIntel,
    screener: {
      rows,
      topBullish,
      topBearish
    },
    sentiment: {
      score: sentimentPanelScore,
      regime: sentimentPanelRegime,
      fearGreed,
      fearGreedHistory: Array.isArray(altBundle.fearGreedHistory) ? altBundle.fearGreedHistory : [],
      aggregateCryptoUsd: altBundle.globalCryptoUsd || null,
      dxyChange: safeNumber(proxyRows?.DXY?.priceChange, null),
      vix: safeNumber(proxyRows?.VIX?.latest, null),
      vix3m: safeNumber(proxyRows?.VIX3M?.latest, null),
      vixTerm,
      volatilityRegime: volScore.regime
    },
    macroWorldBank,
    macroFed,
    cryptoMarket,
    scoreBreakdown: pairScoreSummary,
    checklist,
    selectedPair: selectedRow ? {
      id: selectedRow.id,
      symbol: selectedRow.symbol,
      assetClass: selectedRow.assetClass,
      latest: selectedRow.latest,
      priceChange: selectedRow.priceChange,
      trendScore: selectedRow.trendScore,
      volatility: selectedRow.volatility
    } : (selectedPairInfo ? {
      id: preferredPair,
      symbol: `${selectedPairInfo.base}/${selectedPairInfo.quote}`,
      assetClass: 'forex',
      latest: null,
      priceChange: null,
      trendScore: null,
      volatility: null
    } : null),
    opportunities: {
      bestBuy: topBullish,
      bestSell: topBearish
    },
    currencyStrength: currencyStrengthPack,
    sessionIntelligence,
    newsImpactZones,
    carryProxy,
    cotProxy,
    cotPositioning: {
      ...cotPositioning,
      stale: !!cotBundle?.stale,
      fetchedAt: cotBundle?.fetchedAt || null,
      currencyRows: cotCurrencyRows
    },
    seasonality,
    macroSurpriseIndex: calendarPack.currencySurprise,
    correlations,
    cryptoSnapshot,
    sources: [
      { id: 'yahoo_chart', label: 'Yahoo Finance Chart API', type: 'market_data' },
      { id: 'forexfactory_calendar', label: 'ForexFactory Weekly Calendar Feed', type: 'calendar' },
      { id: 'alternative_me', label: 'Alternative.me (Fear/Greed index)', type: 'sentiment' },
      { id: 'world_bank', label: 'World Bank Open Data API', type: 'macro' },
      { id: 'coingecko', label: 'CoinGecko API', type: 'crypto_reference' },
      { id: 'cftc_cot', label: 'CFTC Commitments of Traders (weekly TFF)', type: 'positioning' },
      ...(macroFed?.configured === true ? [{ id: 'fred_stlouisfed', label: 'FRED economic data API', type: 'macro' }] : []),
    ],
    providerHealth,
  };
  return data;
}

function buildUnavailablePayload(reason, cacheEntry = null) {
  if (cacheEntry?.data) {
    return {
      ...cacheEntry.data,
      stale: true,
      unavailable: false,
      staleReason: reason || 'Live providers unavailable. Showing cached real data.'
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    hasRealData: false,
    stale: false,
    unavailable: true,
    unavailableReason: reason || 'Live providers unavailable and no cached real data exists.',
    overview: null,
    calendar: { events: [], allEvents: [], nextHighImpact: null, currencySurprise: [] },
    headlineIntel: { generatedAt: new Date().toISOString(), items: [], assetOptions: [], stats: { total: 0, highImpact: 0, pending: 0 } },
    screener: { rows: [], topBullish: [], topBearish: [] },
    sentiment: {
      score: null,
      regime: 'NEUTRAL',
      fearGreed: null,
      fearGreedHistory: [],
      aggregateCryptoUsd: null,
      dxyChange: null,
      vix: null,
      volatilityRegime: 'UNKNOWN'
    },
    macroWorldBank: { ok: false, rows: [] },
    macroFed: { configured: false, rows: [] },
    cryptoMarket: { ok: false, global: null, trending: [], spot: {} },
    scoreBreakdown: { totalScore: 0, bias: 'NEUTRAL', confidence: 0, modulesAgree: 0, modulesTotal: 0, keyDriver: 'N/A', modules: [] },
    checklist: { items: [], verdict: 'WAIT', summary: 'No real data available.' },
    selectedPair: null,
    opportunities: { bestBuy: [], bestSell: [] },
    currencyStrength: { rows: [], strongest: null, weakest: null, bestPair: null },
    sessionIntelligence: null,
    newsImpactZones: { windows: [], highUpcomingTotal: 0, recentHighPast2h: 0 },
    carryProxy: { available: false, score: null, detail: 'Unavailable' },
    cotProxy: { available: false, score: null, stance: null, detail: 'Unavailable', source: 'unavailable' },
    cotPositioning: { available: false, reason: 'Unavailable', currencyRows: [] },
    seasonality: { available: false, bestWeekday: null, worstWeekday: null, bestMonth: null, worstMonth: null, weekdayRows: [], monthRows: [] },
    macroSurpriseIndex: [],
    correlations: [],
    cryptoSnapshot: [],
    sources: []
  };
}

async function getFundamentalsDashboard(settings = {}, options = {}) {
  const ttlMs = Math.max(60, Number(settings?.fundamentalsRefreshSeconds || 180)) * 1000;
  const refresh = !!options?.forceRefresh;
  const requestedPair = String(options?.selectedPair || options?.pair || '').trim().toUpperCase();
  const cacheEntry = getCache(DASHBOARD_CACHE_KEY);
  const cachedPair = String(cacheEntry?.data?.overview?.selectedPair || cacheEntry?.data?.selectedPair?.id || '').trim().toUpperCase();
  const pairChanged = requestedPair !== cachedPair;

  if (!refresh && !pairChanged && isCacheFresh(cacheEntry, ttlMs)) {
    return {
      ...cacheEntry.data,
      stale: false,
      fromCache: true
    };
  }

  try {
    let live = await buildLiveDashboard(settings, options);
    const liveEvents = Array.isArray(live?.calendar?.events) ? live.calendar.events : [];
    if (liveEvents.length === 0) {
      const cachedAllEvents = Array.isArray(cacheEntry?.data?.calendar?.allEvents) ? cacheEntry.data.calendar.allEvents : [];
      const cachedPairEvents = Array.isArray(cacheEntry?.data?.calendar?.events) ? cacheEntry.data.calendar.events : [];
      const fallbackEvents = cachedAllEvents.length > 0 ? cachedAllEvents : cachedPairEvents;
      if (fallbackEvents.length > 0) {
        const maxEvents = Math.max(8, Number(settings?.fundamentalsMaxEvents || 18));
        const fallbackPairInfo = parseForexPair(live?.selectedPair?.id || requestedPair);
        const repairedPairNews = buildPairNews(fallbackEvents, fallbackPairInfo, maxEvents);
        const repairedNextImpact = repairedPairNews.find((evt) => evt.minutesToEvent >= 0 && evt.impact >= 2) || null;
        const repairedRows = Array.isArray(live?.screener?.rows) ? live.screener.rows : [];
        const repairedHeadlineIntel = buildAiHeadlines(fallbackEvents, repairedRows, null, Math.max(maxEvents, 30));
        live = {
          ...live,
          stale: true,
          staleReason: 'Live calendar temporarily unavailable. Showing cached calendar events.',
          overview: {
            ...live.overview,
            nextHighImpact: repairedNextImpact || live?.overview?.nextHighImpact || null
          },
          calendar: {
            ...live.calendar,
            events: repairedPairNews,
            allEvents: fallbackEvents,
            nextHighImpact: repairedNextImpact || live?.calendar?.nextHighImpact || null
          },
          headlineIntel: repairedHeadlineIntel
        };
      }
    }
    setCache(DASHBOARD_CACHE_KEY, live);
    return { ...live, fromCache: false };
  } catch (error) {
    return buildUnavailablePayload(
      error?.message || 'Failed to load fundamentals providers.',
      cacheEntry
    );
  }
}

/** Broker/trade symbol → screener instrument id (mirror of renderer fundamentalsSymbolMap). */
const TRADE_TO_INSTRUMENT_ID = {
  XAUUSD: 'XAU', GOLD: 'XAU', XAU: 'XAU',
  XAGUSD: 'XAG', SILVER: 'XAG', XAG: 'XAG',
  US100: 'NDX', NAS100: 'NDX', NAS: 'NDX', USTEC: 'NDX', NDX: 'NDX',
  US500: 'SPX', SPX500: 'SPX', SPX: 'SPX',
  US30: 'DJI', DJ30: 'DJI', DJI: 'DJI', DOW: 'DJI',
  GER40: 'DAX', DE40: 'DAX', DAX: 'DAX',
  UK100: 'FTSE', FTSE: 'FTSE',
  NIKKEI225: 'NIKKEI', N225: 'NIKKEI', JP225: 'NIKKEI',
  HANGSENG: 'HSI', HSI: 'HSI',
  BRENT: 'BRENT', UKOIL: 'BRENT', USOIL: 'WTI', WTI: 'WTI', CRUDE: 'WTI',
  NATGAS: 'NATGAS', NGAS: 'NATGAS', COPPER: 'COPPER',
  BTCUSD: 'BTC', BTCUSDT: 'BTC', BTC: 'BTC',
  ETHUSD: 'ETH', ETHUSDT: 'ETH', ETH: 'ETH',
  SOLUSD: 'SOL', SOLUSDT: 'SOL', SOL: 'SOL'
};

function normalizeTradeSymbolKey(symbol = '') {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return '';
  const dotted = raw.match(/^([A-Z0-9]{3,8})[._-][A-Z0-9]{1,5}$/);
  if (dotted) return dotted[1];
  const letterSuffix = raw.match(/^([A-Z]{6})([A-Z])$/);
  if (letterSuffix) return letterSuffix[1];
  const plain = raw.match(/^([A-Z0-9]{3,8})$/);
  if (plain) return plain[1];
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function resolveFundInstrumentId(symbol = '') {
  const key = normalizeTradeSymbolKey(symbol);
  if (!key) return '';
  return TRADE_TO_INSTRUMENT_ID[key] || key;
}

/**
 * Resolve the screener bias (BULLISH/BEARISH/NEUTRAL) for a trade symbol from the
 * cached fundamentals dashboard. Reads cache only — never blocks signal processing.
 * @param {string} symbol broker/trade symbol (e.g. XAUUSD, US100.cash)
 * @returns {string} direction or '' when unavailable
 */
function resolveScreenerBiasForSymbol(symbol = '') {
  const entry = getCache(DASHBOARD_CACHE_KEY);
  const rows = Array.isArray(entry?.data?.screener?.rows) ? entry.data.screener.rows : [];
  if (rows.length === 0) return '';
  const key = normalizeTradeSymbolKey(symbol);
  if (!key) return '';
  const instId = resolveFundInstrumentId(symbol);
  const row = rows.find((r) => String(r?.id || '').toUpperCase() === instId)
    || rows.find((r) => String(r?.symbol || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === key);
  return row?.direction || '';
}

function normalizeSymbolForNews(symbol = '') {
  return String(symbol || '')
    .trim()
    .toUpperCase()
    .replace(/\.(CASH|I)$/i, '')
    .replace(/[^A-Z0-9]/g, '');
}

function resolveNewsCurrenciesForSymbol(symbol = '') {
  const core = normalizeSymbolForNews(symbol);
  const pair = parseForexPair(core.length === 6 ? core : '');
  if (pair) return [pair.base, pair.quote];
  if (/^(US100|US500|US30|NAS100|NDX|SPX|DJI|USTEC|SPX500)/.test(core)) return ['USD'];
  if (/^(XAU|XAG|GOLD|SILVER)/.test(core)) return ['USD'];
  if (/^(BTC|ETH|SOL)/.test(core) && /USD$/.test(core)) return ['USD'];
  if (/^(GER40|DE40|DAX|STOXX)/.test(core)) return ['EUR'];
  if (/^UK100/.test(core)) return ['GBP'];
  if (/^(JP225|NI225|NIKKEI)/.test(core)) return ['JPY'];
  return [];
}

function filterHighImpactEventsForSymbol(events = [], symbol = '', maxEvents = 18) {
  const list = Array.isArray(events) ? events : [];
  const currencies = new Set(resolveNewsCurrenciesForSymbol(symbol));
  const scoped = currencies.size > 0
    ? list.filter((evt) => currencies.has(String(evt?.country || '').toUpperCase()))
    : list;
  return scoped
    .filter((evt) => safeNumber(evt?.impact, 0) >= 3)
    .slice(0, Math.max(6, Number(maxEvents || 18)));
}

function buildTradeNewsContext(event, {
  minutes,
  phase,
  blocked = false,
  beforeMinutes = 0,
  afterMinutes = 0,
  contextAfterMinutes = 0
} = {}) {
  if (!event || typeof event !== 'object') return null;
  const title = String(event?.title || 'High-impact event').trim();
  const country = String(event?.country || '').trim().toUpperCase();
  const impact = safeNumber(event?.impact, 3);
  const rounded = Math.round(Number(minutes) || 0);
  const absMin = Math.abs(rounded);
  const label = phase === 'BEFORE'
    ? `${country} ${title} in ${absMin}m`
    : `${country} ${title} was ${absMin}m ago`;
  return {
    title,
    country,
    impact,
    minutesToEvent: rounded,
    minutesAgo: phase === 'AFTER' ? absMin : null,
    minutesUntil: phase === 'BEFORE' ? absMin : null,
    phase,
    blocked: Boolean(blocked),
    label,
    eventTime: event?.time || event?.date || null,
    capturedAt: new Date().toISOString(),
    blockBeforeMinutes: beforeMinutes,
    blockAfterMinutes: afterMinutes,
    contextAfterMinutes
  };
}

function pickPostBlockNewsContext(relevant = [], {
  beforeMinutes = 0,
  afterMinutes = 0,
  contextAfterMinutes = 0
} = {}) {
  const candidate = relevant
    .filter((evt) => {
      const minutes = safeNumber(evt?.minutesToEvent, null);
      return Number.isFinite(minutes) && minutes < -afterMinutes && minutes >= -contextAfterMinutes;
    })
    .sort((a, b) => safeNumber(b?.minutesToEvent, 0) - safeNumber(a?.minutesToEvent, 0))[0] || null;
  if (!candidate) return null;
  const minutes = safeNumber(candidate?.minutesToEvent, 0);
  return buildTradeNewsContext(candidate, {
    minutes,
    phase: 'AFTER',
    blocked: false,
    beforeMinutes,
    afterMinutes,
    contextAfterMinutes
  });
}

async function getNewsGuardStatus(settings = {}, options = {}) {
  const enabled = settings?.enableHighImpactNewsGuard !== false;
  const beforeMinutes = Math.max(0, Number(settings?.highImpactNewsBlockBeforeMinutes ?? 30));
  const afterMinutes = Math.max(0, Number(settings?.highImpactNewsBlockAfterMinutes ?? 15));
  const contextAfterMinutes = Math.max(
    afterMinutes,
    Number(settings?.highImpactNewsTradeContextAfterMinutes ?? 120)
  );
  if (!enabled) {
    return { enabled: false, blocked: false, reason: 'High-impact news guard disabled.', newsContext: null };
  }
  const selectedSymbol = normalizeSymbolForNews(options?.symbol || options?.selectedPair || '');
  const dashboardPair = selectedSymbol.length === 6 ? selectedSymbol : undefined;
  const dashboard = await getFundamentalsDashboard(settings, { selectedPair: dashboardPair });
  const allEvents = Array.isArray(dashboard?.calendar?.allEvents) ? dashboard.calendar.allEvents : [];
  const relevant = filterHighImpactEventsForSymbol(
    allEvents,
    selectedSymbol,
    Number(settings?.fundamentalsMaxEvents || 18)
  );
  const blockingEvent = relevant.find((evt) => {
    const minutes = safeNumber(evt?.minutesToEvent, null);
    if (!Number.isFinite(minutes)) return false;
    return minutes <= beforeMinutes && minutes >= -afterMinutes;
  }) || null;
  if (blockingEvent) {
    const minutes = safeNumber(blockingEvent?.minutesToEvent, 0);
    const phase = minutes >= 0 ? 'BEFORE' : 'AFTER';
    const reason = phase === 'BEFORE'
      ? `Blocked: high-impact event "${blockingEvent.title}" in ${minutes}m.`
      : `Blocked: high-impact event "${blockingEvent.title}" happened ${Math.abs(minutes)}m ago.`;
    return {
      enabled: true,
      blocked: true,
      beforeMinutes,
      afterMinutes,
      contextAfterMinutes,
      phase,
      event: blockingEvent,
      reason,
      newsContext: buildTradeNewsContext(blockingEvent, {
        minutes,
        phase,
        blocked: true,
        beforeMinutes,
        afterMinutes,
        contextAfterMinutes
      })
    };
  }
  const newsContext = pickPostBlockNewsContext(relevant, { beforeMinutes, afterMinutes, contextAfterMinutes });
  return {
    enabled: true,
    blocked: false,
    beforeMinutes,
    afterMinutes,
    contextAfterMinutes,
    event: newsContext ? relevant.find((evt) => evt?.title === newsContext.title && evt?.country === newsContext.country) || null : null,
    newsContext
  };
}

module.exports = {
  getFundamentalsDashboard,
  getNewsGuardStatus,
  resolveScreenerBiasForSymbol,
  normalizeSymbolForNews,
  resolveNewsCurrenciesForSymbol,
  filterHighImpactEventsForSymbol,
  buildTradeNewsContext,
  pickPostBlockNewsContext
};
