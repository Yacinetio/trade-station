/**
 * Pure bar-replay backtest engine (no I/O). Shared by renderer (ESM) and vitest.
 */

import {
  estimatePipSize,
  usdPerPipPerStandardLot,
  computeLotsFromSlRisk,
  computeTradeRiskUsd
} from './pipMath.js';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function roundLots(n) {
  const step = 0.01;
  const v = Math.max(step, Math.round(Number(n) / step) * step);
  return Math.round(v * 100) / 100;
}

function newId(state, prefix) {
  state.seq = (state.seq || 0) + 1;
  return `${prefix}_${state.seq}_${Date.now().toString(36)}`;
}

function isoFromSec(sec) {
  if (!Number.isFinite(sec)) return new Date().toISOString();
  return new Date(sec * 1000).toISOString();
}

function sideSign(side) {
  return String(side).toUpperCase() === 'SELL' ? -1 : 1;
}

function applyBuySpread(price, spreadPips, pipSize, isBuy) {
  const pad = Math.max(0, Number(spreadPips) || 0) * Number(pipSize);
  if (!pad) return price;
  if (isBuy) return price + pad;
  return price;
}

function exitPriceForSide(rawPrice, spreadPips, pipSize, isBuy) {
  const pad = Math.max(0, Number(spreadPips) || 0) * Number(pipSize);
  if (!pad) return rawPrice;
  // Conservative: BUY exits at bid (lower), SELL exits at ask (higher).
  return isBuy ? rawPrice - pad : rawPrice + pad;
}

function pipValuePerLot(symbol, entryPrice) {
  return usdPerPipPerStandardLot(symbol, entryPrice, null);
}

function computeRiskUsd(symbol, entry, sl, lots, pipSize) {
  const risk = computeTradeRiskUsd(symbol, entry, sl, lots, null);
  if (risk != null) return risk;
  const stopPips = Math.abs(entry - sl) / pipSize;
  return round2(lots * stopPips * pipValuePerLot(symbol, entry));
}

function computeLotsFromRisk(state, entry, sl, riskPct) {
  const pct = Math.max(0.01, Math.min(100, Number(riskPct) || 0));
  const riskUsd = state.balance * (pct / 100);
  const lots = computeLotsFromSlRisk(
    state.symbol,
    entry,
    sl,
    riskUsd,
    state.maxLot,
    null
  );
  if (lots != null) return lots;
  const stopPips = Math.abs(entry - sl) / state.pipSize;
  if (stopPips <= 0) return null;
  const raw = riskUsd / (stopPips * pipValuePerLot(state.symbol, entry));
  return roundLots(Math.min(state.maxLot, raw));
}

function resolveSlPrice(state, side, anchorPrice, spec) {
  if (spec.slPrice != null && Number.isFinite(Number(spec.slPrice))) return Number(spec.slPrice);
  const sign = sideSign(side);
  if (spec.slPips != null && Number.isFinite(Number(spec.slPips))) {
    return anchorPrice - sign * Number(spec.slPips) * state.pipSize;
  }
  return null;
}

function resolveTpPrice(state, side, anchorPrice, slPrice, spec) {
  if (spec.tpPrice != null && Number.isFinite(Number(spec.tpPrice))) return Number(spec.tpPrice);
  const sign = sideSign(side);
  if (spec.tpPips != null && Number.isFinite(Number(spec.tpPips))) {
    return anchorPrice + sign * Number(spec.tpPips) * state.pipSize;
  }
  if (spec.tpR != null && slPrice != null && Number.isFinite(Number(spec.tpR))) {
    const slDist = Math.abs(anchorPrice - slPrice);
    if (slDist > 0) return anchorPrice + sign * slDist * Number(spec.tpR);
  }
  return null;
}

function pnlMoney(state, side, entryPrice, exitPrice, lots) {
  const sign = sideSign(side);
  const pips = (sign * (exitPrice - entryPrice)) / state.pipSize;
  return round2(pips * pipValuePerLot(state.symbol, entryPrice) * lots);
}

function markEquity(state, bar) {
  let floating = 0;
  for (const pos of state.positions) {
    const mark = exitPriceForSide(bar.close, state.spreadPips, state.pipSize, pos.side === 'BUY');
    floating += pnlMoney(state, pos.side, pos.entryPrice, mark, pos.remainingLots);
  }
  state.equity = round2(state.balance + floating);
  state.equityCurve.push({
    timeSec: bar.time,
    balance: state.balance,
    equity: state.equity
  });
}

function emitClosedTrade(state, pos, exitPrice, lotsClosed, status, barTimeSec) {
  const profit = pnlMoney(state, pos.side, pos.entryPrice, exitPrice, lotsClosed);
  state.balance = round2(state.balance + profit);
  const initialRisk = pos.initialRiskUsd || computeRiskUsd(
    state.symbol,
    pos.entryPrice,
    pos.initialSlPrice,
    pos.initialLots,
    state.pipSize
  );
  const realizedR = initialRisk > 0 ? round2(profit / initialRisk) : null;
  const trade = {
    id: newId(state, 'bt'),
    symbol: state.symbol,
    type: pos.side,
    entry: pos.entryPrice,
    sl: pos.slPrice,
    tp: pos.tpPrice,
    lot: lotsClosed,
    profit,
    status,
    openedAt: isoFromSec(pos.openedAtSec),
    closedAt: isoFromSec(barTimeSec),
    channel: 'Backtest',
    riskUsd: computeRiskUsd(state.symbol, pos.entryPrice, pos.initialSlPrice, lotsClosed, state.pipSize),
    realizedR,
    journal: {
      notes: pos.note || '',
      tags: [],
      mistakes: [],
      checklist: [],
      confidence: null
    },
    origin: 'BACKTEST',
    source: 'BACKTEST_ENGINE'
  };
  state.closedTrades.push(trade);
  return trade;
}

function openPositionFromFill(state, { side, fillPrice, lots, slPrice, tpPrice, autoBreakevenAtR, note, barTimeSec }) {
  const isBuy = String(side).toUpperCase() === 'BUY';
  const entry = applyBuySpread(fillPrice, state.spreadPips, state.pipSize, isBuy);
  const pos = {
    id: newId(state, 'pos'),
    side: isBuy ? 'BUY' : 'SELL',
    entryPrice: entry,
    initialLots: lots,
    remainingLots: lots,
    slPrice: slPrice,
    tpPrice: tpPrice,
    initialSlPrice: slPrice,
    autoBreakevenAtR: autoBreakevenAtR != null ? Number(autoBreakevenAtR) : null,
    beTriggered: false,
    openedAtSec: barTimeSec,
    note: note || ''
  };
  state.positions.push(pos);
  return pos;
}

function fillPendingOrder(state, order, fillPrice, bar) {
  const sl = resolveSlPrice(state, order.side, fillPrice, order);
  const tp = resolveTpPrice(state, order.side, fillPrice, sl, order);
  openPositionFromFill(state, {
    side: order.side,
    fillPrice,
    lots: order.lots,
    slPrice: sl,
    tpPrice: tp,
    autoBreakevenAtR: order.autoBreakevenAtR,
    note: order.note,
    barTimeSec: bar.time
  });
}

function tryFillPendingOrders(state, bar) {
  const still = [];
  for (const order of state.pendingOrders) {
    const side = String(order.side).toUpperCase();
    const kind = String(order.kind).toLowerCase();
    const price = Number(order.price);
    let filled = false;
    let fillAt = null;

    if (kind === 'limit') {
      if (side === 'BUY' && bar.low <= price) {
        fillAt = Math.min(price, bar.open <= price ? bar.open : price);
        filled = true;
      } else if (side === 'SELL' && bar.high >= price) {
        fillAt = Math.max(price, bar.open >= price ? bar.open : price);
        filled = true;
      }
    } else if (kind === 'stop') {
      if (side === 'BUY') {
        if (bar.open >= price) {
          fillAt = bar.open;
          filled = true;
        } else if (bar.high >= price) {
          fillAt = price;
          filled = true;
        }
      } else if (side === 'SELL') {
        if (bar.open <= price) {
          fillAt = bar.open;
          filled = true;
        } else if (bar.low <= price) {
          fillAt = price;
          filled = true;
        }
      }
    }

    if (filled) {
      fillPendingOrder(state, order, fillAt, bar);
    } else {
      still.push(order);
    }
  }
  state.pendingOrders = still;
}

function checkAutoBreakeven(state, pos, bar) {
  if (pos.beTriggered || pos.autoBreakevenAtR == null || !Number.isFinite(pos.autoBreakevenAtR)) return;
  const slDist = Math.abs(pos.entryPrice - pos.initialSlPrice);
  if (slDist <= 0) return;
  const sign = sideSign(pos.side);
  const target = pos.entryPrice + sign * slDist * pos.autoBreakevenAtR;
  const favorable = sign === 1 ? bar.high : bar.low;
  if (sign === 1 ? favorable >= target : favorable <= target) {
    pos.slPrice = pos.entryPrice;
    pos.beTriggered = true;
  }
}

function checkPositionExits(state, pos, bar) {
  const isBuy = pos.side === 'BUY';
  const sl = pos.slPrice;
  const tp = pos.tpPrice;
  let slHit = false;
  let tpHit = false;
  let slExit = null;
  let tpExit = null;

  if (sl != null && Number.isFinite(sl)) {
    if (isBuy && bar.low <= sl) {
      slHit = true;
      slExit = exitPriceForSide(Math.max(sl, bar.low), state.spreadPips, state.pipSize, true);
    } else if (!isBuy && bar.high >= sl) {
      slHit = true;
      slExit = exitPriceForSide(Math.min(sl, bar.high), state.spreadPips, state.pipSize, false);
    }
  }

  if (tp != null && Number.isFinite(tp)) {
    if (isBuy && bar.high >= tp) {
      tpHit = true;
      tpExit = exitPriceForSide(tp, state.spreadPips, state.pipSize, true);
    } else if (!isBuy && bar.low <= tp) {
      tpHit = true;
      tpExit = exitPriceForSide(tp, state.spreadPips, state.pipSize, false);
    }
  }

  if (slHit && tpHit) {
    emitClosedTrade(state, pos, slExit, pos.remainingLots, 'CLOSED_SL', bar.time);
    return true;
  }
  if (slHit) {
    emitClosedTrade(state, pos, slExit, pos.remainingLots, pos.beTriggered ? 'CLOSED_MANUAL' : 'CLOSED_SL', bar.time);
    return true;
  }
  if (tpHit) {
    emitClosedTrade(state, pos, tpExit, pos.remainingLots, 'CLOSED_TP', bar.time);
    return true;
  }
  return false;
}

function createEngineState({ startingBalance, spreadPips = 0, pipSize, symbol = 'EURUSD', maxLot = 20 }) {
  const pip = Number(pipSize) > 0 ? Number(pipSize) : estimatePipSize(symbol);
  const bal = round2(Number(startingBalance) || 100000);
  return {
    balance: bal,
    startingBalance: bal,
    equity: bal,
    spreadPips: Math.max(0, Number(spreadPips) || 0),
    pipSize: pip,
    symbol: String(symbol || 'EURUSD').trim() || 'EURUSD',
    maxLot: Math.min(500, Math.max(0.01, Number(maxLot) || 20)),
    positions: [],
    pendingOrders: [],
    closedTrades: [],
    equityCurve: [],
    lastBar: null,
    seq: 0
  };
}

function restoreEngineState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return createEngineState({ startingBalance: 100000 });
  }
  const base = createEngineState({
    startingBalance: snapshot.startingBalance ?? snapshot.balance ?? 100000,
    spreadPips: snapshot.spreadPips,
    pipSize: snapshot.pipSize,
    symbol: snapshot.symbol,
    maxLot: snapshot.maxLot
  });
  Object.assign(base, {
    balance: round2(snapshot.balance ?? base.balance),
    equity: round2(snapshot.equity ?? snapshot.balance ?? base.balance),
    positions: Array.isArray(snapshot.positions) ? snapshot.positions.map((p) => ({ ...p })) : [],
    pendingOrders: Array.isArray(snapshot.pendingOrders) ? snapshot.pendingOrders.map((o) => ({ ...o })) : [],
    closedTrades: [],
    equityCurve: Array.isArray(snapshot.equityCurve) ? [...snapshot.equityCurve] : [],
    lastBar: snapshot.lastBar || null,
    seq: Number(snapshot.seq) || 0
  });
  return base;
}

function serializeEngineState(state) {
  return {
    balance: state.balance,
    startingBalance: state.startingBalance,
    equity: state.equity,
    spreadPips: state.spreadPips,
    pipSize: state.pipSize,
    symbol: state.symbol,
    maxLot: state.maxLot,
    positions: state.positions.map((p) => ({ ...p })),
    pendingOrders: state.pendingOrders.map((o) => ({ ...o })),
    equityCurve: state.equityCurve.slice(-5000),
    lastBar: state.lastBar,
    seq: state.seq
  };
}

function placeOrder(state, spec = {}) {
  const side = String(spec.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const kind = String(spec.kind || 'market').toLowerCase();
  const barTimeSec = state.lastBar?.time ?? Math.floor(Date.now() / 1000);
  const anchor = Number.isFinite(Number(spec.price))
    ? Number(spec.price)
    : (state.lastBar?.close ?? Number(spec.price));

  let lots = Number(spec.lots);
  const slPreview = resolveSlPrice(state, side, anchor, spec);
  if ((!Number.isFinite(lots) || lots <= 0) && spec.riskPct != null && slPreview != null) {
    lots = computeLotsFromRisk(state, anchor, slPreview, spec.riskPct);
  }
  if (!Number.isFinite(lots) || lots <= 0) {
    return { ok: false, error: 'Invalid lot size — provide lots or riskPct with SL.' };
  }
  lots = roundLots(Math.min(state.maxLot, lots));

  const orderPayload = {
    side,
    lots,
    slPrice: spec.slPrice,
    slPips: spec.slPips,
    tpPrice: spec.tpPrice,
    tpPips: spec.tpPips,
    tpR: spec.tpR,
    autoBreakevenAtR: spec.autoBreakevenAtR,
    note: spec.note || ''
  };

  if (kind === 'market') {
    if (!state.lastBar) {
      return { ok: false, error: 'No bar yet — advance playback before market orders.' };
    }
    const sl = resolveSlPrice(state, side, anchor, spec);
    const tp = resolveTpPrice(state, side, anchor, sl, spec);
    const pos = openPositionFromFill(state, {
      side,
      fillPrice: anchor,
      lots,
      slPrice: sl,
      tpPrice: tp,
      autoBreakevenAtR: spec.autoBreakevenAtR,
      note: spec.note,
      barTimeSec
    });
    return { ok: true, position: pos };
  }

  if (!Number.isFinite(anchor) || anchor <= 0) {
    return { ok: false, error: 'Limit/stop orders require a price.' };
  }

  const order = {
    id: newId(state, 'ord'),
    kind,
    side,
    price: anchor,
    lots,
    ...orderPayload
  };
  state.pendingOrders.push(order);
  return { ok: true, order };
}

function advanceBar(state, bar) {
  if (!bar || !Number.isFinite(bar.time)) return state;
  const b = {
    time: Number(bar.time),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close)
  };
  state.lastBar = b;

  tryFillPendingOrders(state, b);

  const survivors = [];
  for (const pos of state.positions) {
    checkAutoBreakeven(state, pos, b);
    if (checkPositionExits(state, pos, b)) continue;
    survivors.push(pos);
  }
  state.positions = survivors;

  markEquity(state, b);
  return state;
}

function closePosition(state, positionId, opts = {}) {
  const pos = state.positions.find((p) => String(p.id) === String(positionId));
  if (!pos) return { ok: false, error: 'Position not found' };
  const fraction = Math.max(0.01, Math.min(1, Number(opts.fraction) || 1));
  const lotsToClose = roundLots(pos.remainingLots * fraction);
  if (lotsToClose <= 0) return { ok: false, error: 'Nothing to close' };

  const atPrice = Number.isFinite(Number(opts.atPrice))
    ? Number(opts.atPrice)
    : (state.lastBar?.close ?? pos.entryPrice);
  const isBuy = pos.side === 'BUY';
  const exitPx = exitPriceForSide(atPrice, state.spreadPips, state.pipSize, isBuy);
  const barTimeSec = state.lastBar?.time ?? Math.floor(Date.now() / 1000);
  emitClosedTrade(state, pos, exitPx, lotsToClose, 'CLOSED_MANUAL', barTimeSec);
  pos.remainingLots = roundLots(pos.remainingLots - lotsToClose);
  if (pos.remainingLots <= 0.001) {
    state.positions = state.positions.filter((p) => p.id !== pos.id);
  }
  if (state.lastBar) markEquity(state, state.lastBar);
  return { ok: true, position: pos.remainingLots > 0 ? pos : null };
}

function modifyPosition(state, positionId, opts = {}) {
  const pos = state.positions.find((p) => String(p.id) === String(positionId));
  if (!pos) return { ok: false, error: 'Position not found' };
  if (opts.slPrice != null && Number.isFinite(Number(opts.slPrice))) {
    pos.slPrice = Number(opts.slPrice);
  }
  if (opts.tpPrice != null && Number.isFinite(Number(opts.tpPrice))) {
    pos.tpPrice = Number(opts.tpPrice);
  }
  return { ok: true, position: pos };
}

function cancelOrder(state, orderId) {
  const before = state.pendingOrders.length;
  state.pendingOrders = state.pendingOrders.filter((o) => String(o.id) !== String(orderId));
  return { ok: state.pendingOrders.length < before, error: state.pendingOrders.length < before ? undefined : 'Order not found' };
}

function drainClosedTrades(state) {
  const out = state.closedTrades.slice();
  state.closedTrades = [];
  return out;
}

function floatingPnl(state, bar) {
  if (!bar) return 0;
  let sum = 0;
  for (const pos of state.positions) {
    const mark = exitPriceForSide(bar.close, state.spreadPips, state.pipSize, pos.side === 'BUY');
    sum += pnlMoney(state, pos.side, pos.entryPrice, mark, pos.remainingLots);
  }
  return round2(sum);
}

export {
  createEngineState,
  restoreEngineState,
  serializeEngineState,
  placeOrder,
  advanceBar,
  closePosition,
  modifyPosition,
  cancelOrder,
  drainClosedTrades,
  floatingPnl,
  pnlMoney,
  computeLotsFromRisk,
  computeRiskUsd,
  pipValuePerLot
};
