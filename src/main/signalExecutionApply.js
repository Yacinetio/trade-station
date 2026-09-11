/**
 * Post-parse execution geometry: signal/avg/blend entry, spread offset, TP mode, rebase TPs to exec entry,
 * default SL/TP, R:R TP. Runs before lot sizing.
 */

const { normalizeSymbolKey } = require('./perPairLot');

/**
 * @param {string} symbol
 * @returns {number} one pip in price for the symbol
 */
function estimatePipSize(symbol) {
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

/**
 * Broker pip for spread offset — matches SignalCopierEA GetPipSize (NOT estimatePipSize).
 * estimatePipSize uses 1.0 on index CFDs for risk-$ lot geometry; spread must use broker pip (often 0.01 on US100).
 */
function brokerPipSizeForSpread(symbol) {
  const raw = String(symbol || '');
  const u = raw.toUpperCase().replace(/\./g, '');
  if (/JPY$/.test(u)) return 0.01;
  if (/(XAU|GOLD|XAG|SILVER)/.test(u)) return 0.01;
  if (/\.CASH$/i.test(raw) || /\b(US30|US100|US500|NAS100|NAS\d*|NDX|SPX|GER\d*|DE\d+|UK100|STOXX|DOW|DJI?)\b/i.test(u)) {
    return 0.01;
  }
  if (/(BTC|ETH|LTC|XRP|BNB)/.test(u)) return 0.01;
  if (/(OIL|GAS|USOIL|UKOIL|WTI|BRENT)/.test(u)) return 0.01;
  return 0.0001;
}

/** Ask−Bid price distance when MT5 quote is on the signal; else broker pips × broker pip size. */
function resolveSpreadPriceDistance(signal, spreadPips) {
  const ask = Number(signal?.spreadAsk);
  const bid = Number(signal?.spreadBid);
  if (Number.isFinite(ask) && Number.isFinite(bid) && ask > bid) return ask - bid;
  const explicit = Number(signal?.spreadPrice);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const pips = Number(spreadPips);
  if (!Number.isFinite(pips) || pips <= 0) return 0;
  return pips * brokerPipSizeForSpread(signal?.symbol);
}

/**
 * @param {string} symbol
 * @param {number} a
 * @param {number} b
 */
function priceDistancePips(symbol, a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const pip = estimatePipSize(symbol);
  if (pip <= 0) return 0;
  return Math.abs(a - b) / pip;
}

/** Align with main.js normalizeLotMode — used for R:R anchor + execution-entry gating. */
function normalizeLotModeForRrAnchor(raw) {
  const u = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (u === 'from_signal' || u === 'use_signal' || u === 'parsed' || u === 'telegram') return 'signal';
  if (u === 'percentage' || u === 'fixed' || u === 'risk' || u === 'riskpct' || u === 'signal') return u;
  return 'percentage';
}

/** Lot modes that size from |entry − SL| — TP must follow RR, not a short Telegram target. */
function isSlBasedLotMode(settings) {
  const mode = normalizeLotModeForRrAnchor(settings?.lotMode);
  return mode === 'risk' || mode === 'riskpct' || mode === 'percentage';
}

/** Explicit useRR toggle, or implicit when lots are SL-risk-based (reward should match risk × RR). */
function effectiveUseRR(settings) {
  if (settings?.useRR === true) return true;
  return isSlBasedLotMode(settings);
}

/** Blend/avg EXEC entry is off when lot comes from Telegram or the user disables adjustment. */
function isExecutionEntryAdjustEnabled(settings) {
  if (normalizeLotModeForRrAnchor(settings?.lotMode) === 'signal') return false;
  return settings?.executionEntryAdjust !== false;
}

/** EA AUTO: limit/stop at entry when live price has moved away (skipped when force market). */
function isPendingAtEntryEnabled(settings) {
  if (settings?.forceMarket) return false;
  if (String(settings?.orderType || '').toLowerCase() === 'market') return false;
  if (settings?.pendingAtEntry === false) return false;
  return true;
}

/**
 * Whether live quote is at or better than the blend/target entry (EA uses the same rule on AUTO).
 * BUY: Ask <= blendEntry (+ tol). SELL: Bid >= blendEntry (− tol).
 */
function isLivePriceAtOrBetterThanBlendEntry(type, quote, blendEntry, tolerance = 0) {
  const entry = Number(blendEntry);
  const q = Number(quote);
  const tol = Math.max(0, Number(tolerance) || 0);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(q)) return false;
  const side = String(type || '').toUpperCase();
  if (side === 'BUY') return q <= entry + tol;
  if (side === 'SELL') return q >= entry - tol;
  return false;
}

/**
 * @param {object} signal
 * @param {object} settings
 * @returns {string}
 */
function resolveOrderTypeForSignal(signal, settings) {
  const explicit = String(signal?.orderType || '').trim().toUpperCase();
  if (explicit && explicit !== 'MARKET' && explicit !== 'AUTO') return explicit;
  const entry = Number(signal?.entry);
  if (entry > 0 && isPendingAtEntryEnabled(settings)) return 'AUTO';
  return 'MARKET';
}

/** True when spread entry offset moved EXEC away from the Telegram/blend line. */
function hasSpreadEntryOffset(s) {
  const pips = Number(s?.spreadEntryOffsetPips);
  return Number.isFinite(pips) && pips > 0;
}

/**
 * Whether TP distance for useRR is measured from EXEC entry or Telegram signal line.
 *
 * - execution: |EXEC − SL| × rr (legacy; MT5 may snap TP to actual fill).
 * - signal: |SIG − SL| × rr from stored signalEntry (or EXEC when no split).
 * - auto: signal-style when lot sizing is not “from signal”, or ENTRY is avg/blend off Telegram.
 *
 * @returns {'execution'|'signal'}
 */
function effectiveRrAnchorKind(settings) {
  const raw = String(settings?.rrEntryAnchor ?? 'auto').toLowerCase();
  if (raw === 'signal' || raw === 'telegram') return 'signal';
  if (raw === 'execution' || raw === 'exec' || raw === 'fill') return 'execution';
  const lot = normalizeLotModeForRrAnchor(settings?.lotMode);
  if (lot !== 'signal') return 'signal';
  if (!isExecutionEntryAdjustEnabled(settings)) return 'execution';
  const execMode = String(settings?.executionEntryMode || 'signal').toLowerCase();
  if (execMode === 'avg' || execMode === 'blend') return 'signal';
  return 'execution';
}

/**
 * Price level used for |anchor − SL| when applying settings R:R.
 *
 * @param {object} s - signal after execution entry resolve (`entry` = EXEC, optional `signalEntry`)
 * @param {object} settings
 * @returns {number}
 */
function resolveRrAnchorPrice(s, settings) {
  // Spread offset only shifts fill side — R:R and Telegram TP stay vs the chart ENTRY line.
  if (hasSpreadEntryOffset(s)) {
    const sig = Number(s?.signalEntry);
    if (Number.isFinite(sig) && sig > 0) return sig;
    const preSpread = Number(s?.entry);
    if (Number.isFinite(preSpread) && preSpread > 0) return preSpread;
  }
  const kind = effectiveRrAnchorKind(settings);
  if (kind === 'execution') {
    const e = Number(s?.entry);
    return Number.isFinite(e) && e > 0 ? e : NaN;
  }
  const sig = Number(s?.signalEntry);
  if (Number.isFinite(sig) && sig > 0) return sig;
  const e = Number(s?.entry);
  return Number.isFinite(e) && e > 0 ? e : NaN;
}

/**
 * Chooses the price used for execution / SL / TP geometry.
 *
 * - signal: use parsed ENTRY from Telegram (default).
 * - avg: use AVG ENTRY when present; otherwise ENTRY.
 * - blend: interpolate ENTRY → AVG ENTRY; blendPct 0 = ENTRY, 100 = AVG ENTRY.
 *
 * @returns {{ entry: number, adjusted: boolean }}
 */
function resolveExecutionEntry(signal, settings) {
  const originalEntry = Number(signal?.entry);
  if (!Number.isFinite(originalEntry) || originalEntry <= 0) {
    return { entry: originalEntry, adjusted: false };
  }
  if (!isExecutionEntryAdjustEnabled(settings)) {
    return { entry: originalEntry, adjusted: false };
  }
  const avg = Number(signal?.avgEntry);
  const obEdge = Number(signal?.obEdge);
  const mode = String(settings?.executionEntryMode || 'signal').toLowerCase();
  const pctRaw = Number(settings?.executionEntryBlendPct);
  const pct = Number.isFinite(pctRaw) && pctRaw >= 0 ? Math.max(0, Math.min(100, pctRaw)) : 50;

  /** Blend from OB edge → AVG when edge is present (Telegram ENTRY is often already the midpoint). */
  const blendFrom =
    Number.isFinite(obEdge) && obEdge > 0 ? obEdge : originalEntry;

  if (mode === 'avg') {
    if (Number.isFinite(avg) && avg > 0) return { entry: avg, adjusted: Math.abs(avg - originalEntry) > 1e-12 };
    return { entry: originalEntry, adjusted: false };
  }
  if (mode === 'blend') {
    if (Number.isFinite(avg) && avg > 0 && Number.isFinite(blendFrom) && blendFrom > 0) {
      const blended = blendFrom + (avg - blendFrom) * (pct / 100);
      return { entry: blended, adjusted: Math.abs(blended - originalEntry) > 1e-12 };
    }
    return { entry: originalEntry, adjusted: false };
  }
  return { entry: originalEntry, adjusted: false };
}

/**
 * Per-pair spread entry offset (Settings → Trading). High-spread symbols often fill away from the
 * OB edge on market orders — shift pending/limit entry toward the fill side:
 * BUY → entry − spread, SELL → entry + spread. Spread pips come from live MT5 quote
 * (signal.spreadPips, attached before transforms) or optional rule fallback when offline.
 *
 * @returns {{ spreadPips: number, source: 'live'|'fallback' } | null}
 */
function resolveSpreadEntryRule(settings, symbol, signalSpreadPips) {
  if (settings?.enableSpreadEntryAdjust === false) return null;
  const key = normalizeSymbolKey(symbol);
  if (!key) return null;

  const allPairs = settings?.spreadEntryAllPairs === true;
  let matched = null;
  const rules = settings?.spreadEntryRules;
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (rule && normalizeSymbolKey(rule.symbol) === key) {
        matched = rule;
        break;
      }
    }
  }
  if (!allPairs && !matched) return null;

  const live = Number(signalSpreadPips);
  if (Number.isFinite(live) && live > 0) return { spreadPips: live, source: 'live' };

  const fallback = Number(matched.spreadPips);
  if (Number.isFinite(fallback) && fallback > 0) return { spreadPips: fallback, source: 'fallback' };

  return null;
}

/**
 * @returns {{ entry: number, adjusted: boolean, spreadPipsApplied?: number, spreadEntrySource?: string }}
 */
function applySpreadEntryOffset(signal, settings) {
  const entry = Number(signal?.entry);
  if (!Number.isFinite(entry) || entry <= 0) {
    return { entry, adjusted: false };
  }
  const resolved = resolveSpreadEntryRule(settings, signal?.symbol, signal?.spreadPips);
  if (!resolved) return { entry, adjusted: false };

  const spreadPrice = resolveSpreadPriceDistance(signal, resolved.spreadPips);
  if (!(spreadPrice > 0)) return { entry, adjusted: false };

  const isBuy = String(signal?.type || '').toUpperCase() === 'BUY';
  const adjustedEntry = isBuy ? entry - spreadPrice : entry + spreadPrice;

  const sl = Number(signal?.sl);
  if (Number.isFinite(sl) && sl > 0) {
    if (isBuy && sl >= adjustedEntry) {
      return { entry, adjusted: false, spreadSkippedInvalidSl: true };
    }
    if (!isBuy && sl <= adjustedEntry) {
      return { entry, adjusted: false, spreadSkippedInvalidSl: true };
    }
  }

  return {
    entry: adjustedEntry,
    adjusted: Math.abs(adjustedEntry - entry) > 1e-12,
    spreadPipsApplied: resolved.spreadPips,
    spreadEntrySource: resolved.source
  };
}

/**
 * Shift Telegram TP prices when executed entry (signal/avg/blend) differs from parsed ENTRY.
 * TPs are authored vs telegram entry; blend/avg would otherwise leave wrong distances from EXEC.
 * Skipped when useRR is on (TP is replaced from |entry−SL|×RR).
 */
function rebaseTakeProfitsToExecutionEntry(s, settings) {
  if (!s || effectiveUseRR(settings)) return;
  // Telegram TP is an absolute chart target — spread offset must not shift it.
  if (hasSpreadEntryOffset(s)) return;
  const base = Number(s.signalEntry);
  const exec = Number(s.entry);
  if (
    !Number.isFinite(base)
    || base <= 0
    || !Number.isFinite(exec)
    || exec <= 0
    || Math.abs(base - exec) < 1e-10
    || !Array.isArray(s.tp)
    || s.tp.length === 0
  ) {
    return;
  }
  const delta = exec - base;
  s.tp = s.tp.map((tp) => {
    const n = Number(tp);
    return Number.isFinite(n) ? n + delta : tp;
  });
}

/**
 * Execution geometry: entry resolution → TP mode → TP rebase → default SL/TP → R:R TP.
 * Lot sizing (separate) uses only `entry`, `sl`, symbol — never TP.
 *
 * @param {object} signal - parser output
 * @param {object} settings
 * @returns {object} new signal object (shallow copy + tp array copy)
 */
function applySignalExecutionTransforms(signal, settings) {
  if (!signal) return null;
  const s = { ...signal, tp: Array.isArray(signal.tp) ? [...signal.tp] : [] };

  const avgFallback = Number(s.avgEntry);
  if ((!Number.isFinite(Number(s.entry)) || Number(s.entry) <= 0) && Number.isFinite(avgFallback) && avgFallback > 0) {
    s.entry = avgFallback;
  }

  const origEntry = Number(s.entry);
  const resolved = resolveExecutionEntry(s, settings);
  if (
    Number.isFinite(origEntry)
    && origEntry > 0
    && Number.isFinite(resolved.entry)
    && resolved.entry > 0
    && Math.abs(resolved.entry - origEntry) > 1e-10
  ) {
    s.signalEntry = origEntry;
  }
  if (Number.isFinite(resolved.entry) && resolved.entry > 0) {
    s.entry = resolved.entry;
  }

  const spreadOffset = applySpreadEntryOffset(s, settings);
  if (spreadOffset.adjusted) {
    const preSpread = Number(s.entry);
    if (
      Number.isFinite(preSpread)
      && preSpread > 0
      && s.signalEntry == null
    ) {
      s.signalEntry = preSpread;
    }
    s.entry = spreadOffset.entry;
    s.spreadEntryOffsetPips = spreadOffset.spreadPipsApplied;
    if (spreadOffset.spreadEntrySource) s.spreadEntrySource = spreadOffset.spreadEntrySource;
  }

  const sym = s.symbol;
  const mode = settings?.tpMode || 'separate';
  if (s.tp && s.tp.length) {
    if (mode === 'first') s.tp = [s.tp[0]];
    else if (mode === 'last') s.tp = [s.tp[s.tp.length - 1]];
    else if (mode === 'average') {
      const sum = s.tp.reduce((a, b) => a + b, 0);
      s.tp = [sum / s.tp.length];
    }
  }

  rebaseTakeProfitsToExecutionEntry(s, settings);

  if (settings?.useDefaultSlTp && s.entry > 0) {
    const pip = estimatePipSize(sym);
    const dSl = Math.max(1, Number(settings.defaultSl) || 50);
    const dTp = Math.max(0, Number(settings.defaultTp) || 100);
    const isBuy = String(s.type || '').toUpperCase() === 'BUY';
    if (!s.sl || s.sl <= 0) {
      s.sl = isBuy ? s.entry - dSl * pip : s.entry + dSl * pip;
    }
    if (s.tp.length === 0 && dTp > 0) {
      s.tp = [isBuy ? s.entry + dTp * pip : s.entry - dTp * pip];
    }
  }

  if (effectiveUseRR(settings) && s.entry > 0 && s.sl > 0) {
    const rr = Math.max(0.1, Number(settings.rrRatio) || 2);
    const isBuy = String(s.type || '').toUpperCase() === 'BUY';
    const anchor = resolveRrAnchorPrice(s, settings);
    if (Number.isFinite(anchor) && anchor > 0) {
      const dist = Math.abs(anchor - s.sl);
      const tp1 = isBuy ? anchor + dist * rr : anchor - dist * rr;
      s.tp = [tp1];
    }
  }

  return s;
}

/**
 * MARKET fills use Ask/Bid, not the app entry line. EA snaps TP from POSITION_PRICE_OPEN
 * so reward = rrRatio × |open − SL| (~$500 when risk $ = $250 and RR = 2).
 */
function attachRrSnapForMt5(signal, settings) {
  if (!signal || !effectiveUseRR(settings)) return signal;
  const rr = Math.max(0.1, Number(settings.rrRatio) || 2);
  const ot = String(signal.orderType || '').toUpperCase();
  const isMarket = !ot || ot === 'MARKET' || ot === 'AUTO';
  return { ...signal, rrSnapTpToFill: isMarket, rrRatio: rr };
}

module.exports = {
  applySignalExecutionTransforms,
  attachRrSnapForMt5,
  rebaseTakeProfitsToExecutionEntry,
  brokerPipSizeForSpread,
  resolveSpreadPriceDistance,
  estimatePipSize,
  priceDistancePips,
  resolveExecutionEntry,
  resolveSpreadEntryRule,
  applySpreadEntryOffset,
  hasSpreadEntryOffset,
  effectiveRrAnchorKind,
  effectiveUseRR,
  isSlBasedLotMode,
  resolveRrAnchorPrice,
  normalizeLotModeForRrAnchor,
  isExecutionEntryAdjustEnabled,
  isPendingAtEntryEnabled,
  isLivePriceAtOrBetterThanBlendEntry,
  resolveOrderTypeForSignal
};
