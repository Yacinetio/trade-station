/**
 * TEMPORARY: Playwright / marketing recordings only (invoked when process has
 * `--trade-station-e2e`). Not shipped as product behavior. Remove when done.
 *
 * All rows use ids `e2e-synthetic-*` so `e2eClearSyntheticTrades` can strip them.
 */

const fs = require('fs');
const path = require('path');

/** 1×1 transparent PNG — enough for `file://` preview in the app. */
const MIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function isoOffsetMs(baseMs, deltaMs) {
  return new Date(baseMs + deltaMs).toISOString();
}

/** Local calendar day (same rules as the renderer) at given wall-clock time. */
function localDayOpenIsoFromBase(baseMs, hour, minute) {
  const b = new Date(baseMs);
  const d = new Date(b.getFullYear(), b.getMonth(), b.getDate(), hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * Writes tiny PNGs under `e2e/fixtures/screenshots/` if missing; returns absolute paths.
 * @param {string} repoRoot
 * @returns {{ ENTRY: string, SL: string, TP: string, BE: string }}
 */
function ensureE2eDemoScreenshotPaths(repoRoot) {
  const dir = path.join(repoRoot, 'e2e', 'fixtures', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(MIN_PNG_BASE64, 'base64');
  const files = [
    ['ENTRY', 'e2e-ea-entry.png'],
    ['SL', 'e2e-ea-sl.png'],
    ['TP', 'e2e-ea-tp.png'],
    ['BE', 'e2e-ea-be.png'],
  ];
  /** @type {Record<string, string>} */
  const out = {};
  for (const [stage, name] of files) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
    out[stage] = full;
  }
  return out;
}

/**
 * @param {number} baseMs
 * @param {(t: object) => object} normalizeTradeForStorage
 * @param {string} repoRoot app repo root (contains `e2e/fixtures/`)
 */
function buildSyntheticE2eTrades(baseMs, normalizeTradeForStorage, repoRoot) {
  const shotPaths = ensureE2eDemoScreenshotPaths(repoRoot);

  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100', 'BTCUSD'];
  const tfs = ['M5', 'M15', 'H1', 'H4', 'D1'];
  const biases = ['long', 'short', 'neutral', 'breaker', 'FVG retest'];
  const setups = ['London sweep', 'NY open continuation', 'Asian range fade', 'HTF order block', 'Liquidity grab'];
  const channels = ['Telegram', 'Manual', 'MT Statement', 'Copy pipeline'];

  const statusCycle = [
    { status: 'SENT', profit: 0 },
    { status: 'PENDING', profit: 0 },
    { status: 'TP_HIT', profit: 132.4 },
    { status: 'SL_HIT', profit: -74.2 },
    { status: 'CLOSED_TP', profit: 44.1 },
    { status: 'BLOCKED', profit: 0, blockedReason: 'Session filter — outside allowed window' },
    { status: 'BLOCKED', profit: 0, blockedReason: 'News guard — high impact window' },
  ];

  const heroShots = [
    {
      id: 'e2e-ea-entry',
      stage: 'ENTRY',
      path: shotPaths.ENTRY,
      file: 'e2e-ea-entry.png',
      capturedAt: localDayOpenIsoFromBase(baseMs, 9, 2),
    },
    {
      id: 'e2e-ea-sl',
      stage: 'SL',
      path: shotPaths.SL,
      file: 'e2e-ea-sl.png',
      capturedAt: localDayOpenIsoFromBase(baseMs, 9, 55),
    },
    {
      id: 'e2e-ea-be',
      stage: 'BE',
      path: shotPaths.BE,
      file: 'e2e-ea-be.png',
      capturedAt: localDayOpenIsoFromBase(baseMs, 10, 48),
    },
    {
      id: 'e2e-ea-tp',
      stage: 'TP',
      path: shotPaths.TP,
      file: 'e2e-ea-tp.png',
      capturedAt: localDayOpenIsoFromBase(baseMs, 14, 7),
    },
  ];

  const loginHero = 800500;
  const accountKeyHero = `${loginHero}@Synthetic-Demo`;

  const todayCluster = [
    normalizeTradeForStorage({
      id: 'e2e-synthetic-cal-hero',
      symbol: 'EURUSD',
      type: 'BUY',
      entry: Number((1.08542).toFixed(5)),
      sl: Number((1.0821).toFixed(5)),
      tp: Number((1.0922).toFixed(5)),
      lot: 0.12,
      status: 'TP_HIT',
      profit: 241.55,
      timeframe: 'M15',
      bias: 'Order block reclaim',
      setup: 'London → NY continuation',
      vwapBand: 'yes',
      channel: 'Telegram',
      origin: 'E2E_SEED',
      source: 'E2E_SYNTHETIC',
      screenshots: heroShots,
      accountKey: accountKeyHero,
      accountLogin: String(loginHero),
      accountServer: 'Synthetic-Demo',
      openedAt: localDayOpenIsoFromBase(baseMs, 9, 10),
      lastUpdateAt: localDayOpenIsoFromBase(baseMs, 16, 2),
      closeTime: '16:02:00',
      mt5Ticket: '919900',
      orderType: 'MARKET',
    }),
  ];

  for (let j = 0; j < 5; j += 1) {
    const login = 800501 + j;
    todayCluster.push(
      normalizeTradeForStorage({
        id: `e2e-synthetic-cal-today-${j}`,
        symbol: symbols[(j + 1) % symbols.length],
        type: j % 2 === 0 ? 'BUY' : 'SELL',
        entry: Number((1.05 + (j * 17) / 10000).toFixed(5)),
        lot: Number((0.05 + j * 0.02).toFixed(2)),
        status: j % 3 === 0 ? 'CLOSED_TP' : j % 3 === 1 ? 'SL_HIT' : 'SENT',
        profit: j % 3 === 0 ? 55.2 : j % 3 === 1 ? -32.1 : 0,
        timeframe: tfs[j % tfs.length],
        bias: biases[j % biases.length],
        setup: setups[j % setups.length],
        vwapBand: j % 3 === 0 ? 'yes' : j % 3 === 1 ? 'no' : 'na',
        channel: channels[j % channels.length],
        origin: 'E2E_SEED',
        source: 'E2E_SYNTHETIC',
        accountKey: `${login}@Synthetic-Demo`,
        accountLogin: String(login),
        accountServer: 'Synthetic-Demo',
        openedAt: localDayOpenIsoFromBase(baseMs, 11 + j, 5 + j * 3),
        lastUpdateAt: localDayOpenIsoFromBase(baseMs, 12 + j, 10),
        mt5Ticket: `${919901 + j}`,
        orderType: 'MARKET',
      }),
    );
  }

  const out = [...todayCluster];
  const n = 52;
  for (let i = 0; i < n; i += 1) {
    const daySpread = -((i * 13) % 720); // hours back, spread over ~30d
    const hourJitter = (i % 9) * 37 * 60 * 1000;
    const openedAt = isoOffsetMs(baseMs, daySpread * 3600000 + hourJitter);
    const st = statusCycle[i % statusCycle.length];
    const sym = symbols[i % symbols.length];
    const login = 800200 + (i % 80);
    const accountKey = `${login}@Synthetic-Demo`;

    const closedish = ['TP_HIT', 'SL_HIT', 'CLOSED_TP'].includes(st.status);
    const lastUpdateAt = closedish ? openedAt : isoOffsetMs(baseMs, -((i % 5) + 1) * 3600000);

    const raw = normalizeTradeForStorage({
      id: `e2e-synthetic-${i}`,
      symbol: sym,
      type: i % 2 === 0 ? 'BUY' : 'SELL',
      entry: Number((1.05 + (i % 200) / 10000).toFixed(5)),
      sl: undefined,
      tp: undefined,
      lot: Number((0.05 + (i % 8) * 0.03).toFixed(2)),
      status: st.status,
      profit: st.profit,
      blockedReason: st.blockedReason,
      timeframe: tfs[i % tfs.length],
      bias: biases[i % biases.length],
      setup: setups[i % setups.length],
      channel: channels[i % channels.length],
      origin: 'E2E_SEED',
      source: 'E2E_SYNTHETIC',
      accountKey,
      accountLogin: String(login),
      accountServer: 'Synthetic-Demo',
      openedAt,
      lastUpdateAt,
      closeTime: closedish ? lastUpdateAt.slice(11, 19) : undefined,
      mt5Ticket: `${910000 + i}`,
      orderType: 'MARKET',
    });
    out.push(raw);
  }
  return out;
}

module.exports = { buildSyntheticE2eTrades, ensureE2eDemoScreenshotPaths };
