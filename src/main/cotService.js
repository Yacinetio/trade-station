/**
 * CFTC Commitments of Traders (TFF / FinFut weekly) — speculators vs retail positioning.
 * Mirrors mt5/fundamentals/FE_DataManager.mqh + FE_COT.mqh field layout.
 */

const store = require('./store');

const COT_CACHE_KEY = 'fundamentalsCache.cot';
const COT_HISTORY_KEY = 'fundamentalsCache.cotHistory';
const COT_TTL_MS = 24 * 60 * 60 * 1000;
const CFTC_URL = 'https://www.cftc.gov/dea/newcot/FinFutWk.txt';
const HISTORY_WEEKS = 52;
const EXTREME_PCT = 85;

const COT_MARKETS = [
  { needle: 'EURO FX', code: 'EUR' },
  { needle: 'BRITISH POUND', code: 'GBP' },
  { needle: 'JAPANESE YEN', code: 'JPY' },
  { needle: 'SWISS FRANC', code: 'CHF' },
  { needle: 'AUSTRALIAN DOLLAR', code: 'AUD' },
  { needle: 'NEW ZEALAND DOLLAR', code: 'NZD' },
  { needle: 'CANADIAN DOLLAR', code: 'CAD' },
  { needle: 'U.S. DOLLAR INDEX', code: 'USD' },
  { needle: 'DOLLAR INDEX', code: 'USD' },
  { needle: 'GOLD', code: 'XAU' },
];

function clamp(n, lo, hi) {
  if (!Number.isFinite(Number(n))) return lo;
  return Math.max(lo, Math.min(hi, Number(n)));
}

function round(n, d = 2) {
  if (!Number.isFinite(Number(n))) return null;
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
}

function parseIntField(raw) {
  const n = Number(String(raw || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function mergeHistoryRecords(existing = [], incoming = []) {
  const map = new Map();
  for (const r of [...existing, ...incoming]) {
    if (!r?.currency || !r?.date) continue;
    map.set(`${r.currency}|${r.date}`, r);
  }
  return [...map.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function loadHistoryRecords() {
  const entry = store.get(COT_HISTORY_KEY, null);
  return Array.isArray(entry?.records) ? entry.records : [];
}

function saveHistoryRecords(records) {
  store.set(COT_HISTORY_KEY, { savedAt: Date.now(), records: records.slice(0, 520) });
}

function getCacheEntry() {
  const entry = store.get(COT_CACHE_KEY, null);
  if (!entry?.savedAt || !entry?.records) return null;
  return entry;
}

function matchCurrency(line) {
  const upper = String(line || '').toUpperCase();
  for (const m of COT_MARKETS) {
    if (upper.includes(m.needle)) return m.code;
  }
  return '';
}

function parseReportDate(field) {
  const s = String(field || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dp = s.split('/');
  if (dp.length >= 3) {
    return `${dp[2]}-${String(dp[0]).padStart(2, '0')}-${String(dp[1]).padStart(2, '0')}`;
  }
  return null;
}

function parseCftcText(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (ln.length < 30) continue;
    const currency = matchCurrency(ln);
    if (!currency) continue;
    const fields = ln.split(',').map((f) => f.replace(/"/g, '').trim());
    if (fields.length < 23) continue;
    const isoDate = parseReportDate(fields[2]);
    if (!isoDate) continue;
    const specLong = parseIntField(fields[15]);
    const specShort = parseIntField(fields[16]);
    const commLong = parseIntField(fields[9]);
    const commShort = parseIntField(fields[10]);
    const retailLong = parseIntField(fields[21]);
    const retailShort = parseIntField(fields[22]);
    const openInterest = parseIntField(fields[8]);
    out.push({
      date: isoDate,
      currency,
      specLong,
      specShort,
      commLong,
      commShort,
      retailLong,
      retailShort,
      openInterest,
      netSpec: specLong - specShort,
      netComm: commLong - commShort,
      netRetail: retailLong - retailShort
    });
  }
  return out;
}

function scoreFromNetSpecOi(netSpec, openInterest) {
  const oi = Number(openInterest) || 0;
  const net = Number(netSpec) || 0;
  if (oi <= 0) return { oiPct: null, score: 0 };
  const oiPct = clamp((net / oi) * 100, -120, 120);
  const score = round(clamp(oiPct * 2.5, -100, 100), 2);
  return { oiPct: round(oiPct, 2), score };
}

function applyCrossSectionScores(packs = []) {
  const list = packs.filter((p) => p?.historyLimited && Number.isFinite(p.netSpecOiPct));
  if (list.length < 2) return;
  const sorted = [...list].sort((a, b) => a.netSpecOiPct - b.netSpecOiPct);
  for (let i = 0; i < sorted.length; i++) {
    const pack = sorted[i];
    const pct = sorted.length === 1 ? 50 : (i / (sorted.length - 1)) * 100;
    pack.specPercentile = round(pct, 1);
    pack.specScore = round(clamp((pct - 50) * 2, -100, 100), 2);
    if (pct >= EXTREME_PCT) pack.specStance = 'EXTREME_LONG';
    else if (pct <= 100 - EXTREME_PCT) pack.specStance = 'EXTREME_SHORT';
    else if (pct >= 60) pack.specStance = 'LONG';
    else if (pct <= 40) pack.specStance = 'SHORT';
    else pack.specStance = 'NEUTRAL';
  }
}

function enrichCurrencyHistory(records) {
  const sorted = [...records].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const slice = sorted.slice(0, HISTORY_WEEKS);
  if (slice.length === 0) return null;

  let minNet = slice[0].netSpec;
  let maxNet = slice[0].netSpec;
  for (const r of slice) {
    if (r.netSpec < minNet) minNet = r.netSpec;
    if (r.netSpec > maxNet) maxNet = r.netSpec;
  }
  const range = maxNet - minNet;
  const historyLimited = slice.length < 4 || range <= 0;

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const retailTotal = r.retailLong + r.retailShort;
    r.retailLongPct = retailTotal > 0 ? round((r.retailLong / retailTotal) * 100, 1) : null;
    r.weeklySpecChange = i < slice.length - 1 ? r.netSpec - slice[i + 1].netSpec : 0;
    if (range > 0) {
      r.specPercentile = round(((r.netSpec - minNet) / range) * 100, 1);
    } else {
      r.specPercentile = null;
    }
  }

  const latest = slice[0];
  const retailLongPct = latest.retailLongPct;
  let retailSignal = 'MIXED';
  let retailHint = 'Retail positioning balanced.';
  if (retailLongPct != null && retailLongPct >= 60) {
    retailSignal = 'CROWDED_LONG';
    retailHint = `Retail ${retailLongPct}% long — contrarian fade bias.`;
  } else if (retailLongPct != null && retailLongPct <= 40) {
    retailSignal = 'CROWDED_SHORT';
    retailHint = `Retail ${retailLongPct}% long — contrarian buy bias.`;
  }

  const pct = historyLimited ? null : Number(latest.specPercentile);
  let specStance = 'NEUTRAL';
  if (!historyLimited) {
    if (pct >= EXTREME_PCT) specStance = 'EXTREME_LONG';
    else if (pct <= 100 - EXTREME_PCT) specStance = 'EXTREME_SHORT';
    else if (pct >= 60) specStance = 'LONG';
    else if (pct <= 40) specStance = 'SHORT';
  } else {
    const oiScore = scoreFromNetSpecOi(latest.netSpec, latest.openInterest);
    if (oiScore.oiPct != null && oiScore.oiPct >= 25) specStance = 'LONG';
    else if (oiScore.oiPct != null && oiScore.oiPct <= -25) specStance = 'SHORT';
  }

  let specScore;
  let scoreMode;
  const netSpecOiPct = scoreFromNetSpecOi(latest.netSpec, latest.openInterest).oiPct;

  if (historyLimited) {
    specScore = scoreFromNetSpecOi(latest.netSpec, latest.openInterest).score;
    scoreMode = 'cross_section';
  } else {
    specScore = clamp((pct - 50) * 2 + (latest.weeklySpecChange > 0 ? 8 : latest.weeklySpecChange < 0 ? -8 : 0), -100, 100);
    specScore = round(specScore, 2);
    scoreMode = 'percentile';
  }

  let divergence = null;
  if (retailSignal === 'CROWDED_LONG' && latest.weeklySpecChange < 0) {
    divergence = {
      type: 'RETAIL_LONG_SPECS_EXITING',
      label: 'Retail crowded long while specs reduce nets',
      hint: 'Fade rallies — smart money may be distributing.'
    };
  } else if (retailSignal === 'CROWDED_SHORT' && latest.weeklySpecChange > 0) {
    divergence = {
      type: 'RETAIL_SHORT_SPECS_ADDING',
      label: 'Retail crowded short while specs add longs',
      hint: 'Squeeze risk — specs accumulating against retail.'
    };
  }

  return {
    currency: latest.currency,
    reportDate: latest.date,
    netSpec: latest.netSpec,
    netComm: latest.netComm,
    netRetail: latest.netRetail,
    openInterest: latest.openInterest,
    netSpecOiPct,
    specPercentile: latest.specPercentile,
    weeklySpecChange: latest.weeklySpecChange,
    retailLongPct,
    retailSignal,
    retailHint,
    specStance,
    specScore: round(specScore, 2),
    scoreMode,
    historyLimited,
    divergence,
    weeksTracked: slice.length
  };
}

function buildCurrencyMap(records) {
  const byCur = {};
  for (const r of records) {
    if (!byCur[r.currency]) byCur[r.currency] = [];
    byCur[r.currency].push(r);
  }
  const enriched = {};
  for (const [code, rows] of Object.entries(byCur)) {
    const pack = enrichCurrencyHistory(rows);
    if (pack) enriched[code] = pack;
  }
  applyCrossSectionScores(Object.values(enriched));
  return enriched;
}

function pairScoreFromCurrencies(basePack, quotePack) {
  if (!basePack && !quotePack) return null;
  const baseScore = basePack ? Number(basePack.specScore) : 0;
  // CFTC "USD" is the dollar index future — not comparable to FX quote-currency legs.
  if (!quotePack || quotePack.currency === 'USD') {
    return basePack ? round(clamp(baseScore, -100, 100), 2) : null;
  }
  const quoteScore = Number(quotePack.specScore) || 0;
  return round(clamp(baseScore - quoteScore, -100, 100), 2);
}

function stanceFromScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'MIXED_POSITIONING';
  if (s >= 22) return 'RISK_LONGS_DOMINANT';
  if (s <= -22) return 'DEFENSIVE_SHORTS_DOMINANT';
  return 'MIXED_POSITIONING';
}

function buildSpecHistorySeries(records, currency, weeks = 8) {
  if (!currency || !Array.isArray(records)) return [];
  return records
    .filter((r) => r?.currency === currency)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, weeks)
    .reverse()
    .map((r) => {
      const retailTotal = (r.retailLong || 0) + (r.retailShort || 0);
      return {
        date: r.date,
        netSpec: r.netSpec,
        retailLongPct: retailTotal > 0 ? round((r.retailLong / retailTotal) * 100, 1) : null
      };
    });
}

function buildRetailCrowdedAlerts(currencyMap, threshold = 70) {
  if (!currencyMap || typeof currencyMap !== 'object') return [];
  return Object.values(currencyMap)
    .filter((pack) => pack?.retailLongPct != null && Number(pack.retailLongPct) >= threshold)
    .map((pack) => ({
      currency: pack.currency,
      retailLongPct: pack.retailLongPct,
      signal: pack.retailSignal,
      specStance: pack.specStance,
      hint: `Retail ${pack.retailLongPct}% long on ${pack.currency} — crowded long (≥${threshold}%). Contrarian fade bias.`
    }))
    .sort((a, b) => Number(b.retailLongPct) - Number(a.retailLongPct));
}

function buildPositioningForPair(pairInfo, currencyMap) {
  if (!pairInfo?.base || !pairInfo?.quote) {
    return {
      available: false,
      reason: 'COT applies to major FX pairs — select a pair like EURUSD.'
    };
  }
  const base = currencyMap[pairInfo.base] || null;
  const quote = currencyMap[pairInfo.quote] || null;
  if (!base && !quote) {
    return {
      available: false,
      reason: `No CFTC records for ${pairInfo.base}/${pairInfo.quote}.`
    };
  }
  const pairScore = pairScoreFromCurrencies(base, quote);
  const stance = stanceFromScore(pairScore);
  const divergence = base?.divergence || quote?.divergence || null;
  const reportDate = base?.reportDate || quote?.reportDate || null;

  let detail = '';
  if (base) {
    detail += historyLimitedNote(base, `${pairInfo.base} specs`);
  }
  if (quote) {
    detail += `${detail ? ' • ' : ''}${historyLimitedNote(quote, `${pairInfo.quote} specs`)}`;
  }
  if (base?.retailLongPct != null) detail += ` • Retail ${pairInfo.base} ${base.retailLongPct}% long`;

  const historyLimited = !!(base?.historyLimited || quote?.historyLimited);
  const traderGuide = buildTraderActionGuide(pairInfo, base, quote, divergence);

  return {
    available: true,
    source: 'cftc_cot',
    reportDate,
    pair: `${pairInfo.base}${pairInfo.quote}`,
    pairScore,
    stance,
    detail,
    historyLimited,
    scoreMode: historyLimited ? 'cross_section' : 'percentile',
    traderGuide,
    base,
    quote,
    divergence
  };
}

function smartMoneyBias(pack) {
  if (!pack) return 'NEUTRAL';
  const s = Number(pack.specScore);
  if (s >= 22) return 'BULLISH';
  if (s <= -22) return 'BEARISH';
  const stance = String(pack.specStance || '').toUpperCase();
  if (stance.includes('LONG')) return 'BULLISH';
  if (stance.includes('SHORT')) return 'BEARISH';
  return 'NEUTRAL';
}

function retailContrarianBias(pack) {
  if (!pack) return 'NEUTRAL';
  if (pack.retailSignal === 'CROWDED_LONG') return 'BEARISH';
  if (pack.retailSignal === 'CROWDED_SHORT') return 'BULLISH';
  return 'NEUTRAL';
}

function smartMoneyLine(pack, currency) {
  const bias = smartMoneyBias(pack);
  const net = pack.netSpec?.toLocaleString?.() ?? pack.netSpec;
  if (bias === 'BULLISH') return `Institutions net long ${currency} (${net} contracts) — smart money supports ${currency} strength.`;
  if (bias === 'BEARISH') return `Institutions net short or reducing ${currency} (${net} contracts) — smart money does not support ${currency} rallies.`;
  return `Institutions neutral on ${currency} (${net} contracts) — no strong institutional push.`;
}

function retailLine(pack, currency) {
  const pct = pack.retailLongPct;
  if (pack.retailSignal === 'CROWDED_LONG') {
    return `Retail ${pct}% long ${currency} — crowd is crowded long; contrarian traders watch for fades/sells on ${currency}.`;
  }
  if (pack.retailSignal === 'CROWDED_SHORT') {
    return `Retail only ${pct}% long ${currency} — crowd is crowded short; squeeze risk if price rises.`;
  }
  return `Retail ${pct ?? '—'}% long ${currency} — no extreme crowd positioning.`;
}

function buildTraderActionGuide(pairInfo, base, quote, divergence) {
  const pair = `${pairInfo.base}/${pairInfo.quote}`;
  const pairSymbol = `${pairInfo.base}${pairInfo.quote}`;
  const smartBias = smartMoneyBias(base);
  const retailBias = retailContrarianBias(base);

  const reasons = [];
  if (base) {
    reasons.push({ side: 'smart', label: 'Smart money', text: smartMoneyLine(base, pairInfo.base) });
    reasons.push({ side: 'retail', label: 'Retail (crowd)', text: retailLine(base, pairInfo.base) });
  }
  if (quote?.currency === 'USD') {
    reasons.push({
      side: 'note',
      label: 'Note',
      text: 'USD in COT is the dollar-index future — use the base currency (left) for your FX pair direction.'
    });
  } else if (quote) {
    reasons.push({ side: 'smart', label: `Smart money (${pairInfo.quote})`, text: smartMoneyLine(quote, pairInfo.quote) });
    reasons.push({ side: 'retail', label: `Retail (${pairInfo.quote})`, text: retailLine(quote, pairInfo.quote) });
  }

  let verdict = 'WAIT';
  let verdictTone = 'neutral';
  let title = `No clear edge on ${pair}`;
  let doText = `Positioning does not give a strong push on ${pairSymbol}. Trade your usual setup or wait for smart money + retail to align.`;

  if (divergence?.type === 'RETAIL_LONG_SPECS_EXITING') {
    verdict = 'FADE_LONG';
    verdictTone = 'bearish';
    title = `Fade ${pair} longs`;
    doText = `Retail is crowded long while institutions cut ${pairInfo.base} exposure. Look to sell ${pairSymbol} on rallies after rejection — must confirm on chart.`;
  } else if (divergence?.type === 'RETAIL_SHORT_SPECS_ADDING') {
    verdict = 'FADE_SHORT';
    verdictTone = 'bullish';
    title = `Fade ${pair} shorts / watch squeeze`;
    doText = `Retail is crowded short while institutions add ${pairInfo.base} longs. Look to buy ${pairSymbol} on dips if structure holds — must confirm on chart.`;
  } else if (smartBias === 'BEARISH' && retailBias === 'BEARISH') {
    verdict = 'LEAN_SELL';
    verdictTone = 'bearish';
    title = `Lean bearish ${pair}`;
    doText = `Both institutions and the retail crowd point against ${pairInfo.base}. Prefer sell ${pairSymbol} setups when your chart agrees — avoid chasing shorts into support.`;
  } else if (smartBias === 'BULLISH' && retailBias === 'BULLISH') {
    verdict = 'LEAN_BUY';
    verdictTone = 'bullish';
    title = `Lean bullish ${pair}`;
    doText = `Institutions lean long ${pairInfo.base} and retail is not crowded long. Prefer buy ${pairSymbol} setups when your chart agrees — avoid chasing into resistance.`;
  } else if (smartBias === 'BEARISH' && retailBias === 'NEUTRAL') {
    verdict = 'LEAN_SELL';
    verdictTone = 'bearish';
    title = `Smart money bearish ${pairInfo.base}`;
    doText = `Institutions are not supporting ${pairInfo.base} strength. Bias toward selling ${pairSymbol} on rallies if price action confirms.`;
  } else if (smartBias === 'BULLISH' && retailBias === 'NEUTRAL') {
    verdict = 'LEAN_BUY';
    verdictTone = 'bullish';
    title = `Smart money bullish ${pairInfo.base}`;
    doText = `Institutions lean long ${pairInfo.base}. Bias toward buying ${pairSymbol} on dips if price action confirms.`;
  } else if (smartBias === 'NEUTRAL' && retailBias === 'BEARISH') {
    verdict = 'FADE_LONG';
    verdictTone = 'bearish';
    title = `Contrarian fade on ${pair}`;
    doText = `Retail is crowded long ${pairInfo.base} but institutions are not confirming. Consider fading ${pairSymbol} rallies — only with chart confirmation.`;
  } else if (smartBias === 'NEUTRAL' && retailBias === 'BULLISH') {
    verdict = 'FADE_SHORT';
    verdictTone = 'bullish';
    title = `Contrarian squeeze watch on ${pair}`;
    doText = `Retail is crowded short ${pairInfo.base}. Watch for ${pairSymbol} squeeze higher if price breaks structure — confirm before buying.`;
  } else if (smartBias === 'BULLISH' && retailBias === 'BEARISH') {
    verdict = 'WAIT';
    verdictTone = 'warn';
    title = `Conflict: smart money vs retail on ${pair}`;
    doText = `Institutions lean long ${pairInfo.base} but retail is crowded long too (late crowd). Wait for clarity or trade smaller until both align.`;
  } else if (smartBias === 'BEARISH' && retailBias === 'BULLISH') {
    verdict = 'WAIT';
    verdictTone = 'warn';
    title = `Conflict: smart money vs retail on ${pair}`;
    doText = `Institutions lean against ${pairInfo.base} while retail is crowded short (potential squeeze). Wait for confirmation — mixed positioning.`;
  }

  const verdictLabels = {
    LEAN_BUY: 'Bias: BUY',
    LEAN_SELL: 'Bias: SELL',
    FADE_LONG: 'Fade longs',
    FADE_SHORT: 'Fade shorts',
    WAIT: 'Wait / no edge'
  };

  return {
    verdict,
    verdictLabel: verdictLabels[verdict] || verdict,
    verdictTone,
    title,
    doText,
    reasons,
    pair,
    pairSymbol,
    smartMoneyBias: smartBias,
    retailBias,
    holdTimeframe: 'Weekly COT — swing context, not for scalping.',
    disclaimer: 'Not a trade signal. Confirm entries on your chart and risk plan.'
  };
}
function historyLimitedNote(pack, label) {
  if (!pack) return '';
  if (pack.historyLimited) {
    const oi = pack.netSpecOiPct != null ? `${pack.netSpecOiPct}% net/oi` : 'net vs OI';
    return `${label}: ${oi} (ranked vs other currencies this week)`;
  }
  return `${label} ${pack.specPercentile}th %ile`;
}

async function fetchCotRaw() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(CFTC_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'text/plain,*/*' }
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function isCacheFresh(entry) {
  if (!entry?.savedAt) return false;
  return Date.now() - Number(entry.savedAt) <= COT_TTL_MS;
}

async function getCotBundle({ forceRefresh = false } = {}) {
  const cached = getCacheEntry();
  const history = loadHistoryRecords();
  if (!forceRefresh && isCacheFresh(cached) && history.length > 0) {
    return {
      ok: true,
      fromCache: true,
      fetchedAt: cached.savedAt,
      records: history,
      currencyMap: buildCurrencyMap(history)
    };
  }
  try {
    const raw = await fetchCotRaw();
    const weekRecords = parseCftcText(raw);
    if (weekRecords.length === 0) {
      if (history.length > 0) {
        return {
          ok: true,
          fromCache: true,
          stale: true,
          fetchedAt: cached?.savedAt || null,
          records: history,
          currencyMap: buildCurrencyMap(history)
        };
      }
      return { ok: false, error: 'COT_PARSE_EMPTY' };
    }
    const merged = mergeHistoryRecords(history, weekRecords);
    saveHistoryRecords(merged);
    store.set(COT_CACHE_KEY, { savedAt: Date.now(), records: weekRecords });
    return {
      ok: true,
      fromCache: false,
      fetchedAt: Date.now(),
      records: merged,
      currencyMap: buildCurrencyMap(merged)
    };
  } catch (e) {
    if (history.length > 0) {
      return {
        ok: true,
        fromCache: true,
        stale: true,
        fetchedAt: cached?.savedAt || null,
        records: history,
        currencyMap: buildCurrencyMap(history),
        error: e?.message || String(e)
      };
    }
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  getCotBundle,
  buildPositioningForPair,
  buildSpecHistorySeries,
  buildRetailCrowdedAlerts,
  buildTraderActionGuide,
  buildCurrencyMap,
  pairScoreFromCurrencies,
  stanceFromScore,
  COT_MARKETS
};
