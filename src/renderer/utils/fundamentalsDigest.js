/** Compact ticker for dedupe (matches Fundamentals page convention). */
export function compactTicker(sym) {
  return String(sym || '')
    .replace(/\s+/g, '')
    .split('/')
    .join('')
    .replace(/=+$/i, '')
    .toUpperCase();
}

export const DIGEST_ALL_ASSET_CLASSES = ['forex', 'commodities', 'indices', 'crypto'];

/**
 * Normalize user-selected coverage list. Empty or invalid → all classes.
 * @param {string[]|null|undefined} assetClasses
 * @returns {string[]}
 */
export function normalizeDigestAssetClasses(assetClasses) {
  if (!Array.isArray(assetClasses) || assetClasses.length === 0) {
    return [...DIGEST_ALL_ASSET_CLASSES];
  }
  const next = assetClasses
    .map((c) => String(c || '').toLowerCase())
    .filter((c) => DIGEST_ALL_ASSET_CLASSES.includes(c));
  return next.length ? next : [...DIGEST_ALL_ASSET_CLASSES];
}

function assetAllowed(row, allowedSet) {
  const ac = String(row?.assetClass || '').toLowerCase();
  if (!ac) return false;
  return allowedSet.has(ac);
}

function filterRowsByAssets(rows, allowedList) {
  const allowedSet = new Set(normalizeDigestAssetClasses(allowedList));
  return (Array.isArray(rows) ? rows : []).filter((r) => assetAllowed(r, allowedSet));
}

const FOREX_MAJORS_COMPACT = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD']);

function forexOnlyCoverage(assetClasses) {
  const n = normalizeDigestAssetClasses(assetClasses);
  return n.length === 1 && n[0] === 'forex';
}

/** Strip to 6-letter pair for USD majors or crosses (EURGBP, …). */
function forexPairLetters(pairRaw) {
  return String(pairRaw || '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 10);
}

function filterForexMajorsInRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (String(r?.assetClass || '').toLowerCase() !== 'forex') return true;
    return FOREX_MAJORS_COMPACT.has(compactTicker(rowSymbol(r)));
  });
}

function headlineTouchesCoverage(headline, allowedSet) {
  const assets = Array.isArray(headline?.affectedAssets) ? headline.affectedAssets : [];
  if (!assets.length) return true;
  return assets.some((a) => allowedSet.has(String(a.assetClass || '').toLowerCase()));
}

function rowSymbol(row) {
  return String(row?.symbol || row?.id || '').trim() || '—';
}

function directionGlyph(direction) {
  const d = String(direction || '').toUpperCase();
  if (d === 'BULLISH') return '↑';
  if (d === 'BEARISH') return '↓';
  return '·';
}

/**
 * Build a compact intraday fundamentals digest from getFundamentalsDashboard payload.
 * @param {object|null} data
 * @param {{ assetClasses?: string[] }} [opts]
 * @returns {object|null}
 */
export function buildFundamentalsDigest(data, opts = {}) {
  if (!data || typeof data !== 'object') return null;
  if (data.unavailable && !data.hasRealData) return null;

  const assetClasses = normalizeDigestAssetClasses(opts.assetClasses);
  const allowedSet = new Set(assetClasses);
  const fxOnly = forexOnlyCoverage(assetClasses);

  const bestBuyRaw = Array.isArray(data?.opportunities?.bestBuy) ? data.opportunities.bestBuy : [];
  const bestSellRaw = Array.isArray(data?.opportunities?.bestSell) ? data.opportunities.bestSell : [];

  let bestBuy = filterRowsByAssets(bestBuyRaw, assetClasses);
  let bestSell = filterRowsByAssets(bestSellRaw, assetClasses);
  if (fxOnly) {
    bestBuy = filterForexMajorsInRows(bestBuy);
    bestSell = filterForexMajorsInRows(bestSell);
  }

  const focusRaw = bestBuy.slice(0, 6).map((r) => ({
    symbol: rowSymbol(r),
    direction: String(r?.direction || 'NEUTRAL').toUpperCase(),
    trendScore: Number(r?.trendScore),
    assetClass: String(r?.assetClass || '').toLowerCase() || ''
  }));

  const focusKeys = new Set(focusRaw.map((x) => compactTicker(x.symbol)));
  const ignoreRaw = bestSell
    .filter((r) => !focusKeys.has(compactTicker(rowSymbol(r))))
    .slice(0, 6)
    .map((r) => ({
      symbol: rowSymbol(r),
      direction: String(r?.direction || 'NEUTRAL').toUpperCase(),
      trendScore: Number(r?.trendScore),
      assetClass: String(r?.assetClass || '').toLowerCase() || ''
    }));

  const setups = [];
  const csRowsRaw = Array.isArray(data?.currencyStrength?.rows) ? data.currencyStrength.rows : [];
  const currencyStrengthRanked =
    allowedSet.has('forex') && csRowsRaw.length > 0
      ? csRowsRaw.map((r, idx) => ({
          currency: String(r?.currency || '').trim().toUpperCase().slice(0, 4),
          score: Number(r?.score),
          bias: String(r?.bias || 'NEUTRAL').toUpperCase(),
          rank: Number.isFinite(Number(r?.rank)) ? Number(r.rank) : idx + 1
        })).filter((x) => x.currency)
      : [];

  const bestPair = data?.currencyStrength?.bestPair || null;
  if (bestPair?.pair && allowedSet.has('forex')) {
    const fk = forexPairLetters(bestPair.pair);
    const pairMajor = fk.length === 6 && FOREX_MAJORS_COMPACT.has(fk);
    if (!fxOnly || pairMajor) {
      setups.push({
        id: `cs-${bestPair.pair}`,
        title: `${bestPair.pair}`,
        sub: `${bestPair.bias || 'MILD'} · ${bestPair.buy}>${bestPair.sell}`,
        tone: String(bestPair.bias || '').toUpperCase().includes('STRONG') ? 'strong' : 'mod'
      });
    }
  }

  const topBuy = bestBuy[0];
  const topSell = bestSell[0];
  if (topBuy && rowSymbol(topBuy)) {
    const sym = rowSymbol(topBuy);
    const k = compactTicker(sym);
    if (!setups.some((s) => compactTicker(s.title) === k)) {
      setups.push({
        id: `buy-${k}`,
        title: sym,
        sub: `${directionGlyph(topBuy.direction)} trend screen`,
        tone: 'long'
      });
    }
  }
  if (topSell && rowSymbol(topSell)) {
    const sym = rowSymbol(topSell);
    const k = compactTicker(sym);
    if (!setups.some((s) => compactTicker(s.title) === k)) {
      setups.push({
        id: `sell-${k}`,
        title: sym,
        sub: `${directionGlyph(topSell.direction)} weakest screen`,
        tone: 'short'
      });
    }
  }

  const overview = data?.overview || {};
  const checklist = data?.checklist || {};
  const nextHigh = overview?.nextHighImpact || data?.calendar?.nextHighImpact || null;

  const headlineItems = Array.isArray(data?.headlineIntel?.items) ? data.headlineIntel.items : [];
  const pulseHeadlines = headlineItems
    .filter((h) => headlineTouchesCoverage(h, allowedSet))
    .slice(0, 3)
    .map((h) => ({
      id: String(h.id || ''),
      title: String(h.title || '').slice(0, 140),
      summary: String(h.summary || '').slice(0, 360),
      category: String(h.category || '')
    }));

  const checklistItemsSrc = Array.isArray(checklist.items) ? checklist.items : [];
  const checklistItemsTop = checklistItemsSrc.slice(0, 6).map((it) => ({
    key: String(it.key || ''),
    label: String(it.label || '').slice(0, 120),
    status: String(it.status || '').toLowerCase(),
    detail: String(it.detail || '').slice(0, 160)
  }));

  return {
    marketBias: String(overview.marketBias || 'NEUTRAL').toUpperCase(),
    regime: String(overview.sentimentRegime || 'NEUTRAL').toUpperCase(),
    verdict: String(checklist.verdict || 'WAIT').toUpperCase(),
    driver: String(overview.keyDriver || '').trim(),
    checklistSummary: String(checklist.summary || '').trim(),
    checklistItemsTop,
    pulseHeadlines,
    score: Number(overview.score),
    confidence: Number(overview.confidence),
    nextEventLabel: nextHigh
      ? `${String(nextHigh.country || '').trim()} ${String(nextHigh.title || '').trim()}`.trim().slice(0, 72)
      : '',
    nextEventEta: Number.isFinite(Number(nextHigh?.minutesToEvent)) ? Number(nextHigh.minutesToEvent) : null,
    focus: focusRaw.slice(0, 6),
    ignore: ignoreRaw.slice(0, 6),
    currencyStrength: currencyStrengthRanked,
    setups: setups.slice(0, 3),
    stale: !!data.stale,
    unavailable: !!data.unavailable,
    generatedAt: data.generatedAt || null,
    coverage: [...assetClasses]
  };
}

/**
 * Minimal payload for main-process AI note (keep small).
 */
export function buildFundamentalsDigestAiContext(digest, data) {
  if (!digest) return null;
  const nextHigh = data?.overview?.nextHighImpact || data?.calendar?.nextHighImpact || null;
  return {
    marketBias: digest.marketBias,
    regime: digest.regime,
    verdict: digest.verdict,
    driver: digest.driver ? String(digest.driver).slice(0, 400) : '',
    score: digest.score,
    focus: digest.focus.map((x) => x.symbol),
    ignore: digest.ignore.map((x) => x.symbol),
    setups: digest.setups.map((x) => x.title),
    strengthPair: data?.currencyStrength?.bestPair || null,
    coverage: Array.isArray(digest.coverage) ? digest.coverage : null,
    nextEvent: nextHigh
      ? {
          title: String(nextHigh.title || '').slice(0, 80),
          country: nextHigh.country || '',
          minutesToEvent: nextHigh.minutesToEvent
        }
      : null
  };
}
