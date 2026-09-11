/** Re-export shared backtest engine for renderer. */
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
} from '../../shared/backtestEngine.js';
