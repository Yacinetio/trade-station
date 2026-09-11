/**
 * Pure excursion math: efficiency (our Zella-Scale), edge ratio, bar-based
 * MFE/MAE backfill and Best Exit Analysis.
 *
 * Pip conventions are shared with the rest of the app: `estimatePipSize`
 * (signalExecutionApply) for price→pips and `usdPerPipPerStandardLot`
 * (lotSizing) for pips→account money (money = pips × $/pip/lot × lot).
 * Bars are { time: unixSec, open, high, low, close } ascending (marketHistoryService).
 */

const { estimatePipSize } = require('./signalExecutionApply');
const { usdPerPipPerStandardLot } = require('./lotSizing');

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toUnixSec(iso) {
  const t = new Date(iso || '').getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function tradeDirection(trade) {
  const t = String(trade?.type || '').toUpperCase();
  if (t.startsWith('BUY')) return 1;
  if (t.startsWith('SELL')) return -1;
  return 0;
}

/**
 * Efficiency % = realized profit ÷ peak favorable excursion (money), clamped 0–150.
 * Null when MFE money is missing or <= 0 (nothing to capture) or profit missing.
 */
function computeEfficiencyPct(trade) {
  const profit = toNum(trade?.profit);
  const mfeMoney = toNum(trade?.excursion?.mfeMoney);
  if (profit == null || mfeMoney == null || mfeMoney <= 0) return null;
  const pct = (profit / mfeMoney) * 100;
  return Math.max(0, Math.min(150, pct));
}

/** Edge ratio = MFE pips ÷ MAE pips. Null when either side is missing or MAE is 0. */
function computeEdgeRatio(trade) {
  const mfePips = toNum(trade?.excursion?.mfePips);
  const maePips = toNum(trade?.excursion?.maePips);
  if (mfePips == null || maePips == null || maePips <= 0) return null;
  return mfePips / maePips;
}

/** Bars clipped to the trade's open→close window (60s tolerance on the open side). */
function barsInTradeWindow(trade, bars) {
  const list = (Array.isArray(bars) ? bars : []).filter(
    (b) => b && Number.isFinite(Number(b.time))
      && [b.open, b.high, b.low, b.close].every((x) => Number.isFinite(Number(x)))
  );
  if (list.length === 0) return [];
  const fromSec = toUnixSec(trade?.openedAt);
  const toSec = toUnixSec(trade?.closedAt);
  return list
    .filter((b) => {
      const t = Number(b.time);
      if (fromSec != null && t < fromSec - 60) return false;
      if (toSec != null && t > toSec + 60) return false;
      return true;
    })
    .sort((a, b) => Number(a.time) - Number(b.time));
}

/**
 * Backfill MFE/MAE from 1-min OHLC bars between openedAt and closedAt.
 * BUY: MFE from highs above entry, MAE from lows below entry; SELL inverse.
 * Returns { mfePips, maePips, mfeMoney, maeMoney, barCount } or null when the
 * trade/bars are unusable (no entry, unknown direction, no bars in window).
 */
function computeExcursionFromBars(trade, bars) {
  const entry = toNum(trade?.entry);
  const dir = tradeDirection(trade);
  const pip = estimatePipSize(trade?.symbol);
  if (entry == null || entry <= 0 || dir === 0 || !(pip > 0)) return null;

  const windowBars = barsInTradeWindow(trade, bars);
  if (windowBars.length === 0) return null;

  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (const b of windowBars) {
    const h = Number(b.high);
    const l = Number(b.low);
    if (h > maxHigh) maxHigh = h;
    if (l < minLow) minLow = l;
  }

  const favorPrice = dir === 1 ? maxHigh - entry : entry - minLow;
  const adversePrice = dir === 1 ? entry - minLow : maxHigh - entry;
  const mfePips = Math.max(0, favorPrice / pip);
  const maePips = Math.max(0, adversePrice / pip);

  const lot = toNum(trade?.lot) ?? 0;
  const usdPerPip = usdPerPipPerStandardLot(trade?.symbol, entry, toNum(trade?.usdPerPipPerLot));
  const moneyPerPip = lot > 0 && usdPerPip > 0 ? usdPerPip * lot : 0;

  return {
    mfePips: Math.round(mfePips * 10) / 10,
    maePips: Math.round(maePips * 10) / 10,
    mfeMoney: Math.round(mfePips * moneyPerPip * 100) / 100,
    maeMoney: Math.round(maePips * moneyPerPip * 100) / 100,
    barCount: windowBars.length
  };
}

/**
 * Conservative intrabar fill model shared by all exit simulations:
 * within one bar the STOP is always checked before the TARGET (path unknown).
 * BUY exits: stop when bar.low <= stop, target when bar.high >= target. SELL inverse.
 */
function simulateExitPath(dir, entry, bars, { stop = null, target = null, beAfter = null, trailDist = null } = {}) {
  let curStop = stop;
  let beArmed = false;
  let extreme = entry; // best favorable price seen (for trailing)

  for (const b of bars) {
    const high = Number(b.high);
    const low = Number(b.low);

    const stopHit = curStop != null && (dir === 1 ? low <= curStop : high >= curStop);
    if (stopHit) return { exitPrice: curStop, exitTime: Number(b.time), reason: beArmed ? 'breakeven' : 'stop' };

    const targetHit = target != null && (dir === 1 ? high >= target : low <= target);
    if (targetHit) return { exitPrice: target, exitTime: Number(b.time), reason: 'target' };

    // Arm break-even after the trigger prints; takes effect from the NEXT bar
    // (conservative: unknown intrabar order between trigger and pullback).
    if (beAfter != null && !beArmed) {
      const trigHit = dir === 1 ? high >= beAfter.triggerPrice : low <= beAfter.triggerPrice;
      if (trigHit) {
        beArmed = true;
        curStop = beAfter.stopPrice;
      }
    }

    if (trailDist != null) {
      extreme = dir === 1 ? Math.max(extreme, high) : Math.min(extreme, low);
      const candidate = dir === 1 ? extreme - trailDist : extreme + trailDist;
      if (curStop == null || (dir === 1 ? candidate > curStop : candidate < curStop)) {
        curStop = candidate;
      }
    }
  }

  const last = bars[bars.length - 1];
  return { exitPrice: Number(last.close), exitTime: Number(last.time), reason: 'end' };
}

/**
 * Best Exit Analysis: replay the trade's bar window under alternative exit
 * rules and report each variant's P&L delta vs the actual realized profit.
 * Variants: fixed 1R/2R/3R targets (SL kept), breakeven-after-1R, trailing by
 * N pips (opts.trailPips; default half the SL distance, min 5, fallback 20).
 * R-based variants need a valid SL and are returned with profit=null without one.
 */
function simulateBestExits(trade, bars, opts = {}) {
  const entry = toNum(trade?.entry);
  const dir = tradeDirection(trade);
  const pip = estimatePipSize(trade?.symbol);
  if (entry == null || entry <= 0 || dir === 0 || !(pip > 0)) {
    return { ok: false, reason: 'Trade is missing entry price or direction' };
  }
  const windowBars = barsInTradeWindow(trade, bars);
  if (windowBars.length === 0) {
    return { ok: false, reason: 'No bars available for the trade window' };
  }

  const sl = toNum(trade?.sl);
  const hasSl = sl != null && sl > 0 && (dir === 1 ? sl < entry : sl > entry);
  const riskDist = hasSl ? Math.abs(entry - sl) : null;
  const riskPips = riskDist != null ? riskDist / pip : null;

  const lot = toNum(trade?.lot) ?? 0;
  const usdPerPip = usdPerPipPerStandardLot(trade?.symbol, entry, toNum(trade?.usdPerPipPerLot));
  const moneyPerPip = lot > 0 && usdPerPip > 0 ? usdPerPip * lot : 0;
  const actualProfit = toNum(trade?.profit) ?? 0;

  const profitFromExit = (exitPrice) => {
    const favorPips = (dir === 1 ? exitPrice - entry : entry - exitPrice) / pip;
    return Math.round(favorPips * moneyPerPip * 100) / 100;
  };

  const defaultTrailPips = riskPips != null ? Math.max(5, riskPips / 2) : 20;
  const trailPips = Math.max(1, toNum(opts.trailPips) ?? defaultTrailPips);

  const variants = [];
  const pushVariant = (id, label, sim) => {
    if (!sim) {
      variants.push({ id, label, profit: null, deltaVsActual: null, exitPrice: null, exitReason: 'unavailable' });
      return;
    }
    const profit = profitFromExit(sim.exitPrice);
    variants.push({
      id,
      label,
      profit,
      deltaVsActual: Math.round((profit - actualProfit) * 100) / 100,
      exitPrice: sim.exitPrice,
      exitReason: sim.reason
    });
  };

  for (const mult of [1, 2, 3]) {
    const id = `fixed-${mult}r`;
    const label = `Fixed ${mult}R target`;
    if (!hasSl) {
      pushVariant(id, label, null);
      continue;
    }
    const target = dir === 1 ? entry + mult * riskDist : entry - mult * riskDist;
    pushVariant(id, label, simulateExitPath(dir, entry, windowBars, { stop: sl, target }));
  }

  if (hasSl) {
    const triggerPrice = dir === 1 ? entry + riskDist : entry - riskDist;
    pushVariant(
      'be-after-1r',
      'Breakeven after +1R',
      simulateExitPath(dir, entry, windowBars, {
        stop: sl,
        beAfter: { triggerPrice, stopPrice: entry }
      })
    );
  } else {
    pushVariant('be-after-1r', 'Breakeven after +1R', null);
  }

  pushVariant(
    'trail-pips',
    `Trailing ${Math.round(trailPips)} pips`,
    simulateExitPath(dir, entry, windowBars, {
      stop: hasSl ? sl : null,
      trailDist: trailPips * pip
    })
  );

  return {
    ok: true,
    actualProfit,
    riskPips: riskPips != null ? Math.round(riskPips * 10) / 10 : null,
    trailPips: Math.round(trailPips * 10) / 10,
    barCount: windowBars.length,
    variants
  };
}

module.exports = {
  computeEfficiencyPct,
  computeEdgeRatio,
  computeExcursionFromBars,
  simulateBestExits
};
