const { estimatePipSize, resolveExecutionEntry, hasSpreadEntryOffset } = require('./signalExecutionApply');

/**
 * @param {unknown} v
 * @param {number} fallback
 */
function numSetting(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'string') {
    const t = String(v).trim().replace(/,/g, '.').replace(/[^\d.+-]/g, '');
    if (!t) return fallback;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
function usdPerPipPerStandardLot(symbol, entryPrice, brokerUsdPerPipPerLot) {
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

/** Telegram ENTRY line when split from EXEC; else parsed entry; else AVG-only fallback for sizing. */
function baselinePriceForExecutionSizing(signal) {
  const s = signal || {};
  if (s.signalEntry != null && Number(s.signalEntry) > 0) return Number(s.signalEntry);
  const direct = numSetting(s.entry, 0);
  if (direct > 0) return direct;
  if (s.avgEntry != null && Number(s.avgEntry) > 0) return Number(s.avgEntry);
  return null;
}

/**
 * Same execution anchor as applySignalExecutionTransforms (signal / avg / blend of ENTRY vs AVG).
 * Recomputes desk entry from baseline (signalEntry → entry → avg) so lots never use a stale price
 * and ENTRY=0 + AVG present still gets a valid risk distance (avoids silent fallback to Telegram lot).
 */
function executionEntryForLotSizing(signal, settings) {
  const s = signal || {};
  // Lots must use spread-adjusted entry → SL (actual fill side), not the pre-spread blend line.
  if (hasSpreadEntryOffset(s)) {
    const spreadEntry = numSetting(s.entry, 0);
    if (spreadEntry > 0) return spreadEntry;
  }
  const base = baselinePriceForExecutionSizing(s);
  if (base != null && base > 0) {
    const synth = { ...s, entry: base };
    const r = resolveExecutionEntry(synth, settings);
    if (Number.isFinite(r.entry) && r.entry > 0) return r.entry;
  }
  return numSetting(s.entry, 0);
}

/**
 * Core: risk amount in USD, stop measured as |entry − SL| in "pips" (price ÷ estimatePipSize).
 */
function computeLotsFromSlRisk(symbol, entry, sl, riskUsd, maxLot, brokerUsdPerPipPerLot) {
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
function computeTradeRiskUsd(symbol, entry, sl, lot, brokerUsdPerPipPerLot) {
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

/** Planned reward:risk from entry → TP1 vs entry → SL (price distance ratio). */
function computePlannedRR(entry, sl, tp1) {
  const en = Number(entry);
  const stop = Number(sl);
  const tp = Number(tp1);
  if (!Number.isFinite(en) || en <= 0 || !Number.isFinite(stop) || stop <= 0 || !Number.isFinite(tp)) return null;
  const slDist = Math.abs(en - stop);
  const tpDist = Math.abs(tp - en);
  if (slDist <= 0 || tpDist <= 0) return null;
  return Math.round((tpDist / slDist) * 1000) / 1000;
}

/**
 * Shapes a parsed Telegram signal for MT5: lot mode + optional account snapshot decide volume.
 *
 * SL-based modes (percentage / risk% / risk $): volume from **execution entry → `sl` only**
 * (signal / avg / blend — recomputed from `signalEntry` when present so SIG @ cannot anchor lots).
 * Telegram TP is ignored — applySignalExecutionTransforms should have aligned TP after entry/RR separately.
 *
 * @param {object} signal - parser output (after execution transforms — SL should exist when defaults/RR used)
 * @param {object} settings - normalized app settings
 * @param {object} [accountCtx] - mt5AccountSnapshot: balance, equity
 */
function applyLotSizingToSignal(signal, settings, accountCtx = {}) {
  const raw = { ...(signal || {}) };
  const parsedSignalLot = Math.max(0, numSetting(raw.lot, 0));
  const { lot: _dropped, ...noLot } = raw;

  const rawMode = String(settings?.lotMode ?? 'percentage').trim().toLowerCase().replace(/\s+/g, '_');
  const mode =
    rawMode === 'from_signal' || rawMode === 'use_signal' || rawMode === 'telegram' ? 'signal' : rawMode;
  const maxLot = Math.min(500, Math.max(0.01, numSetting(settings?.maxLot, 20)));
  const base = { ...noLot, lotMode: mode, maxLot, parsedSignalLot };

  const equity = numSetting(accountCtx?.equity, 0);
  const balance = numSetting(accountCtx?.balance, 0);
  const equityOrBal = equity > 0 ? equity : balance;

  const entry = executionEntryForLotSizing(raw, settings);
  const sl = numSetting(raw.sl, 0);
  const brokerUsdPerPip = numSetting(raw.usdPerPipPerLot, 0);

  if (mode === 'signal' || mode === 'from_signal') {
    return { ...base, lot: clampLotVol(parsedSignalLot || 0.01, maxLot) };
  }
  if (mode === 'fixed') {
    const fl = Math.max(0.01, numSetting(settings?.fixedLot, 0.01));
    return { ...base, lot: clampLotVol(fl, maxLot) };
  }

  /** SL-based modes */
  let riskUsd = 0;
  if (mode === 'percentage') {
    const lp = Math.max(0.01, Math.min(100, numSetting(settings?.lotPercentage, 1)));
    riskUsd = equityOrBal > 0 ? equityOrBal * (lp / 100) : 0;
    const computed =
      riskUsd > 0 ? computeLotsFromSlRisk(raw.symbol, entry, sl, riskUsd, maxLot, brokerUsdPerPip) : null;
    if (computed != null) return { ...base, lot: computed, lotPercentage: lp };
    const fb = clampLotVol(parsedSignalLot || 0.01, maxLot);
    return { ...base, lot: fb, lotPercentage: lp };
  }

  if (mode === 'riskpct') {
    const rp = Math.max(0.01, Math.min(100, numSetting(settings?.riskPct, 1)));
    riskUsd = equityOrBal > 0 ? equityOrBal * (rp / 100) : 0;
    const computed =
      riskUsd > 0 ? computeLotsFromSlRisk(raw.symbol, entry, sl, riskUsd, maxLot, brokerUsdPerPip) : null;
    if (computed != null) return { ...base, lot: computed, riskPct: rp };
    const fb = clampLotVol(parsedSignalLot || 0.01, maxLot);
    return { ...base, lot: fb, riskPct: rp };
  }

  if (mode === 'risk') {
    const ra = Math.max(0.01, numSetting(settings?.riskAmount, 100));
    const computed = computeLotsFromSlRisk(raw.symbol, entry, sl, ra, maxLot, brokerUsdPerPip);
    if (computed != null) return { ...base, lot: computed, riskAmount: ra };
    const fb = clampLotVol(parsedSignalLot || 0.01, maxLot);
    return { ...base, lot: fb, riskAmount: ra };
  }

  const lp = numSetting(settings?.lotPercentage, 1);
  const fallback = clampLotVol(parsedSignalLot || 0.01, maxLot);
  return {
    ...base,
    lot: fallback,
    lotMode: 'percentage',
    lotPercentage: Math.max(0.01, Math.min(100, lp))
  };
}

module.exports = {
  applyLotSizingToSignal,
  baselinePriceForExecutionSizing,
  computeLotsFromSlRisk,
  computePlannedRR,
  computeTradeRiskUsd,
  executionEntryForLotSizing,
  usdPerPipPerStandardLot
};
