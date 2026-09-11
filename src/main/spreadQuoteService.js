/**
 * Live spread + broker pip value from MT5 via SPREAD_REQUEST before execution transforms.
 */

const { normalizeSymbolKey } = require('./perPairLot');

function getSpreadEntryRule(settings, symbol) {
  const rules = settings?.spreadEntryRules;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const key = normalizeSymbolKey(symbol);
  if (!key) return null;
  for (const rule of rules) {
    if (rule && normalizeSymbolKey(rule.symbol) === key) return rule;
  }
  return null;
}

function isSpreadEntryAllPairs(settings) {
  return settings?.enableSpreadEntryAdjust !== false && settings?.spreadEntryAllPairs === true;
}

function isSpreadEntryPair(settings, symbol) {
  if (settings?.enableSpreadEntryAdjust === false) return false;
  if (isSpreadEntryAllPairs(settings)) return Boolean(normalizeSymbolKey(symbol));
  return getSpreadEntryRule(settings, symbol) != null;
}

/**
 * @param {object} signal - parser output (shallow copy returned)
 * @param {object} settings
 * @param {(payload: { symbol: string }) => Promise<{ success?: boolean, spreadPips?: number, usdPerPipPerLot?: number, error?: string }>} requestSpread
 */
async function attachLiveSpreadForEntryAdjust(signal, settings, requestSpread) {
  if (!signal) return signal;
  const symbol = String(signal.symbol || '').trim();
  if (!symbol) return signal;

  const applySpreadOffset = isSpreadEntryPair(settings, signal.symbol);
  const rule = applySpreadOffset ? getSpreadEntryRule(settings, signal.symbol) : null;

  let spreadPips = 0;
  let source = '';
  let brokerUsdPerPip = 0;
  let spreadAsk;
  let spreadBid;
  let spreadPrice;

  try {
    const live = await requestSpread({ symbol });
    const pip = Number(live?.usdPerPipPerLot);
    if (live?.success && Number.isFinite(pip) && pip > 0) brokerUsdPerPip = pip;
    if (applySpreadOffset && live?.success && Number(live.spreadPips) > 0) {
      spreadPips = Number(live.spreadPips);
      source = 'live';
    }
    if (live?.success) {
      const ask = Number(live.ask);
      const bid = Number(live.bid);
      if (Number.isFinite(ask) && Number.isFinite(bid) && ask > bid) {
        spreadAsk = ask;
        spreadBid = bid;
        spreadPrice = ask - bid;
      } else {
        const sp = Number(live.spreadPrice);
        if (Number.isFinite(sp) && sp > 0) spreadPrice = sp;
      }
    }
  } catch (_) {
    /* fall through to optional spread fallback */
  }

  if (applySpreadOffset && !(spreadPips > 0)) {
    const fallback = Number(rule?.spreadPips);
    if (Number.isFinite(fallback) && fallback > 0) {
      spreadPips = fallback;
      source = 'fallback';
    }
  }

  if (!(spreadPips > 0) && !(brokerUsdPerPip > 0) && !(spreadPrice > 0)) return signal;

  const out = { ...signal };
  if (spreadPips > 0) {
    out.spreadPips = spreadPips;
    out.spreadEntrySource = source;
  }
  if (spreadAsk != null) out.spreadAsk = spreadAsk;
  if (spreadBid != null) out.spreadBid = spreadBid;
  if (spreadPrice > 0) out.spreadPrice = spreadPrice;
  if (brokerUsdPerPip > 0) out.usdPerPipPerLot = brokerUsdPerPip;
  return out;
}

module.exports = {
  getSpreadEntryRule,
  isSpreadEntryAllPairs,
  isSpreadEntryPair,
  attachLiveSpreadForEntryAdjust
};
