/**
 * Pure pip/lot math for renderer-safe backtest engine.
 * Copied from src/main/signalExecutionApply.js (estimatePipSize) and
 * src/main/lotSizing.js (usdPerPipPerStandardLot, computeLotsFromSlRisk,
 * computeTradeRiskUsd, clampLotVol) so backtest behavior matches live trading.
 */

/**
 * @param {string} symbol
 * @returns {number} one pip in price for the symbol
 */
export function estimatePipSize(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (/(JPY|JPy)/.test(s)) return 0.01;
  if (/(XAU|GOLD|XAG|SILVER)/.test(s)) return 0.1;
  // Equity index CFDs: distances are in full index points. Using 0.1 here inflated "pips" 10× and
  // made risk-$ lot sizing an order of magnitude too small (e.g. GER40 ~26 pt stop read as ~260 pips).
  if (/\b(US30|US100|US500|NAS100|NAS\d*|NDX|SPX|GER\d*|DE\d+|UK100|STOXX|DOW|DJI?)\b/i.test(s)) return 1.0;
  if (/(BTC|ETH|LTC|XRP|BNB)/.test(s)) return 0.1;
  if (/(OIL|GAS|USOIL|UKOIL|WTI|BRENT)/.test(s)) return 0.01;
  return 0.0001;
}

function clampLotVol(raw, maxLot) {
  const max = Math.min(500, Math.max(0.01, Number(maxLot) || 20));
  if (!Number.isFinite(raw) || raw <= 0) return Math.min(0.01, max);
  const step = 0.01;
  const capped = Math.min(Math.max(step, raw), max);
  return Math.round(capped / step) * step;
}

/**
 * Approximate account P&L in USD per 1.00 standard lot when price moves by ONE pip (pip size from estimatePipSize).
 * Used with: lots = riskUsd / (stopPips * usdPerPipPerLot).
 * Prefer `brokerUsdPerPipPerLot` from MT5 SYMBOL_TRADE_TICK_VALUE when available — retail approximations
 * undershoot JPY crosses (~40%) and oversize risk-$ lots.
 */
export function usdPerPipPerStandardLot(symbol, entryPrice, brokerUsdPerPipPerLot) {
  const broker = Number(brokerUsdPerPipPerLot);
  if (Number.isFinite(broker) && broker > 0) return broker;

  const raw = String(symbol || '');
  const u = raw.toUpperCase().replace(/\./g, '');
  const e = Math.max(1e-9, Number(entryPrice) || 1);

  // Index CFDs — $/move uses full index points (see estimatePipSize = 1.0). Retail DAX/US etc. often ~0.5–2 USD/pt/lot.
  if (/\.CASH$/i.test(raw) || /\b(US30|US100|US500|NAS100|NAS\d*|NDX|SPX|GER\d*|DE\d+|UK100|STOXX|DOW|DJI?)\b/i.test(u)) {
    return Math.max(0.5, Math.min(15, e / 24000));
  }

  // XAUUSD (typical MT5): 100 troy oz per 1.00 lot → ~$100 P&L per $1.00 price move per standard lot.
  // estimatePipSize uses 0.1 on gold → $10 per pip per lot (not ~$40+ from scaling by spot — that undersized lots ~4×).
  if (/XAU|GOLD/.test(u)) {
    const pip = estimatePipSize(symbol);
    const usdPerPriceUnitPerLot = 100;
    return Math.max(5, Math.min(150, pip * usdPerPriceUnitPerLot));
  }
  if (/XAG|SILVER/.test(u)) return Math.max(1, Math.min(80, 50 / Math.max(1, e / 25)));

  if (/BTC|ETH/.test(u)) return Math.max(0.05, Math.min(50, e / 1000));

  // JPY pairs: pip = 0.01, contract 100k → ~1000 quote JPY per pip per lot → USD / USDJPY
  if (/JPY$/.test(u)) {
    if (/^USDJPY/.test(u)) return (100000 * 0.01) / e;
    return (100000 * 0.01) / Math.max(50, e * 0.85);
  }

  // USD as quote (EURUSD, GBPUSD, AUDUSD, NZDUSD…)
  if (/(EURUSD|GBPUSD|AUDUSD|NZDUSD)$/.test(u) || /^EURUSD|^GBPUSD|^AUDUSD|^NZDUSD/.test(u)) return 10;

  // USD as base
  if (/^USD(CHF|CAD)/.test(u)) return 10 / e;
  if (/^USD/.test(u)) return 10 / Math.max(0.5, e);

  // Fallback crosses / metals mix
  return 10;
}

/**
 * Core: risk amount in USD, stop measured as |entry − SL| in "pips" (price ÷ estimatePipSize).
 */
export function computeLotsFromSlRisk(symbol, entry, sl, riskUsd, maxLot, brokerUsdPerPipPerLot) {
  const pip = estimatePipSize(symbol);
  const en = Number(entry);
  const stop = Number(sl);
  // SL must be a real price — sl=0 used to mean "missing" but produced |entry−0|/pip → enormous fake stop → 0.01 lots.
  if (
    !riskUsd ||
    riskUsd <= 0 ||
    !Number.isFinite(en) ||
    en <= 0 ||
    !Number.isFinite(stop) ||
    stop <= 0 ||
    pip <= 0
  ) {
    return null;
  }
  const stopPips = Math.abs(en - stop) / pip;
  if (!Number.isFinite(stopPips) || stopPips < 1e-6) return null;

  const usdPerPipPerLot = usdPerPipPerStandardLot(symbol, en, brokerUsdPerPipPerLot);
  if (!usdPerPipPerLot || usdPerPipPerLot <= 0) return null;

  const rawLots = riskUsd / (stopPips * usdPerPipPerLot);
  return clampLotVol(rawLots, maxLot);
}

/** USD at risk for a filled volume: lot × stop pips × $/pip/lot. */
export function computeTradeRiskUsd(symbol, entry, sl, lot, brokerUsdPerPipPerLot) {
  const en = Number(entry);
  const stop = Number(sl);
  const vol = Number(lot);
  if (!Number.isFinite(en) || en <= 0 || !Number.isFinite(stop) || stop <= 0 || !Number.isFinite(vol) || vol <= 0) {
    return null;
  }
  const pip = estimatePipSize(symbol);
  if (!pip || pip <= 0) return null;
  const stopPips = Math.abs(en - stop) / pip;
  if (!Number.isFinite(stopPips) || stopPips <= 0) return null;
  const usdPerPipPerLot = usdPerPipPerStandardLot(symbol, en, brokerUsdPerPipPerLot);
  if (!usdPerPipPerLot || usdPerPipPerLot <= 0) return null;
  return Math.round(vol * stopPips * usdPerPipPerLot * 100) / 100;
}
