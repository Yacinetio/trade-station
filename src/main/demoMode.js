const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

const DEMO_ACCOUNT_KEY = 'DEMO_ACCOUNT';
const DEMO_ACCOUNT = {
  key: DEMO_ACCOUNT_KEY,
  login: 'demo',
  server: 'demo-mt5',
  name: 'Demo Account (Simulation)'
};

let demoInterval = null;
let demoEmitter = null;
let demoSettings = null;
let demoDataRoot = null;

function initDemoStore(dataRoot) {
  demoDataRoot = path.join(String(dataRoot || process.cwd()), 'demo');
  try {
    fs.mkdirSync(demoDataRoot, { recursive: true });
  } catch (_) {}
}

function getDemoTradesFile() {
  return path.join(demoDataRoot, 'trades.json');
}

function readDemoTrades() {
  try {
    const file = getDemoTradesFile();
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      return JSON.parse(data) || [];
    }
  } catch (_) {}
  return [];
}

function writeDemoTrades(trades) {
  try {
    const file = getDemoTradesFile();
    fs.writeFileSync(file, JSON.stringify(trades, null, 2), 'utf8');
  } catch (_) {}
}

function getDemoTrades() {
  return readDemoTrades();
}

function saveDemoTrades(trades) {
  writeDemoTrades(trades);
}

function clearDemoTrades() {
  writeDemoTrades([]);
}

function addDemoTrade(trade) {
  const trades = readDemoTrades();
  trades.unshift(trade);
  if (trades.length > 100) trades.pop();
  writeDemoTrades(trades);
  return trades;
}

function setDemoEmitter(emitter) {
  demoEmitter = emitter;
}

function startDemoMode(settings, onSignal) {
  if (demoInterval) return;

  const cfg = settings?.demoSettings || {};
  const symbols = cfg.symbols || ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
  const interval = (cfg.signalIntervalSeconds || 30) * 1000;
  const winRate = cfg.winRate || 50;
  const avgWin = cfg.avgPipsWin || 30;
  const avgLoss = cfg.avgPipsLoss || 25;

  demoSettings = settings;

  demoInterval = setInterval(() => {
    const isWin = Math.random() * 100 < winRate;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const isBuy = Math.random() > 0.5;

    const signal = buildDemoSignal({
      symbol,
      isBuy,
      isWin,
      avgWin,
      avgLoss,
      settings
    });

    onSignal(signal);

    if (demoEmitter) {
      demoEmitter('signal:new', signal);
    }
  }, interval);

  console.log('[Demo] Started - generating signals every', interval / 1000, 'seconds');
}

function stopDemoMode() {
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
    console.log('[Demo] Stopped');
  }
}

function buildDemoSignal({ symbol, isBuy, isWin, avgWin, avgLoss, settings }) {
  const id = randomUUID();
  const now = new Date();

  const entryPrices = {
    EURUSD: 1.0850,
    GBPUSD: 1.2650,
    USDJPY: 149.50,
    XAUUSD: 2035.00,
    AUDUSD: 0.6580,
    USDCAD: 1.3650,
    USDCHF: 0.8850,
    EURJPY: 162.20,
    GBPJPY: 188.90
  };

  const entry = entryPrices[symbol] || 1.1000;
  const slPips = isWin ? avgLoss : avgLoss * (0.8 + Math.random() * 0.4);
  const tpPips = isWin ? avgWin * (0.8 + Math.random() * 0.4) : avgLoss;

  const point = symbol.includes('JPY') ? 0.01 : 0.0001;
  const sl = isBuy ? entry - slPips * point : entry + slPips * point;
  const tp = isBuy ? entry + tpPips * point : entry - tpPips * point;

  const lotSizes = [0.01, 0.02, 0.05, 0.1, 0.15, 0.2];
  const lot = lotSizes[Math.floor(Math.random() * lotSizes.length)];

  const channelNames = ['📈 Pro Signals', '💎 VIP Trade', '🚀 Quick Pips', '🎯 Precision'];
  const channel = channelNames[Math.floor(Math.random() * channelNames.length)];

  const signal = {
    id,
    symbol,
    type: isBuy ? 'BUY' : 'SELL',
    entry,
    sl,
    tp,
    lot,
    status: 'PENDING',
    channel,
    source: 'DEMO',
    createdAt: now.toISOString(),
    accountKey: DEMO_ACCOUNT.key
  };

  return signal;
}

function generateDemoTradeFromSignal(signal, status, profit = 0) {
  const now = new Date();
  const closeTime = status !== 'LIVE' ? new Date(now.getTime() - Math.random() * 3600000).toISOString() : null;

  return {
    id: signal.id,
    symbol: signal.symbol,
    type: signal.type,
    status,
    openTime: signal.createdAt,
    closeTime,
    entryPrice: signal.entry,
    exitPrice: status === 'LIVE' ? null : (status.includes('TP') ? signal.tp : signal.sl),
    lot: signal.lot,
    profit: status === 'LIVE' ? 0 : profit,
    sl: signal.sl,
    tp: signal.tp,
    channel: signal.channel,
    accountKey: signal.accountKey,
    accountLogin: 'demo',
    accountServer: 'demo-mt5',
    accountName: 'Demo Account',
    source: 'DEMO',
    demo: true
  };
}

function getDemoAccount() {
  return DEMO_ACCOUNT;
}

function getDemoAccountKey() {
  return DEMO_ACCOUNT_KEY;
}

function isDemoAccountKey(key) {
  return key === DEMO_ACCOUNT_KEY;
}

module.exports = {
  initDemoStore,
  setDemoEmitter,
  startDemoMode,
  stopDemoMode,
  buildDemoSignal,
  generateDemoTradeFromSignal,
  getDemoAccount,
  getDemoAccountKey,
  isDemoAccountKey,
  getDemoTrades,
  saveDemoTrades,
  addDemoTrade,
  clearDemoTrades
};