/**
 * Maps broker/trade symbols to Fundamentals screener instrument ids.
 * Screener rows use friendly labels (Gold, NASDAQ 100) and ids (XAU, NDX);
 * trades use broker symbols (XAUUSD, US100.cash).
 */

/** Normalized trade symbol → fundamentals instrument id (from fundamentalsService INSTRUMENTS) */
const TRADE_TO_INSTRUMENT_ID = {
  XAUUSD: 'XAU',
  GOLD: 'XAU',
  XAU: 'XAU',
  XAGUSD: 'XAG',
  SILVER: 'XAG',
  XAG: 'XAG',

  US100: 'NDX',
  NAS100: 'NDX',
  NAS: 'NDX',
  USTEC: 'NDX',
  NDX: 'NDX',

  US500: 'SPX',
  SPX500: 'SPX',
  SPX: 'SPX',

  US30: 'DJI',
  DJ30: 'DJI',
  DJI: 'DJI',
  DOW: 'DJI',

  GER40: 'DAX',
  DE40: 'DAX',
  DAX: 'DAX',

  UK100: 'FTSE',
  FTSE: 'FTSE',

  NIKKEI225: 'NIKKEI',
  N225: 'NIKKEI',
  JP225: 'NIKKEI',

  HANGSENG: 'HSI',
  HSI: 'HSI',

  BRENT: 'BRENT',
  UKOIL: 'BRENT',
  USOIL: 'WTI',
  WTI: 'WTI',
  CRUDE: 'WTI',
  NATGAS: 'NATGAS',
  NGAS: 'NATGAS',
  COPPER: 'COPPER',

  BTCUSD: 'BTC',
  BTCUSDT: 'BTC',
  BTC: 'BTC',
  ETHUSD: 'ETH',
  ETHUSDT: 'ETH',
  ETH: 'ETH',
  SOLUSD: 'SOL',
  SOLUSDT: 'SOL',
  SOL: 'SOL'
};

/** Strip broker suffixes so US100.cash / US100.ca → US100, EURUSDm → EURUSD */
export function normalizeTradeSymbolKey(symbol = '') {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return '';
  const dotted = raw.match(/^([A-Z0-9]{3,8})[._-][A-Z0-9]{1,5}$/);
  if (dotted) return dotted[1];
  const letterSuffix = raw.match(/^([A-Z]{6})([A-Z])$/);
  if (letterSuffix) return letterSuffix[1];
  const plain = raw.match(/^([A-Z0-9]{3,8})$/);
  if (plain) return plain[1];
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function resolveFundInstrumentId(symbol = '') {
  const key = normalizeTradeSymbolKey(symbol);
  if (!key) return '';
  if (TRADE_TO_INSTRUMENT_ID[key]) return TRADE_TO_INSTRUMENT_ID[key];
  if (/^[A-Z]{6}$/.test(key)) return key;
  return key;
}

function normalizeScreenerLabel(label = '') {
  return String(label || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function normalizeSourceSymbol(src = '') {
  return String(src || '')
    .replace(/^[\^=]+/i, '')
    .replace(/=X$/i, '')
    .replace(/=F$/i, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
}

/**
 * Build normalizedSymbol → direction map from Fundamentals screener rows.
 * @param {Array<{ id?: string, symbol?: string, sourceSymbol?: string, direction?: string }>} rows
 * @returns {Map<string, string>|null}
 */
export function buildScreenerBiasMap(rows = []) {
  const map = new Map();
  const set = (key, direction) => {
    const k = String(key || '').toUpperCase();
    if (k && direction) map.set(k, direction);
  };

  for (const row of rows) {
    const dir = row?.direction;
    if (!dir) continue;
    const id = String(row.id || '').toUpperCase();
    set(id, dir);
    set(normalizeScreenerLabel(row.symbol), dir);
    set(normalizeSourceSymbol(row.sourceSymbol), dir);

    for (const [tradeSym, instId] of Object.entries(TRADE_TO_INSTRUMENT_ID)) {
      if (instId === id) set(tradeSym, dir);
    }
  }

  return map.size > 0 ? map : null;
}

export function lookupScreenerBias(map, tradeSymbol) {
  if (!map) return '';
  const key = normalizeTradeSymbolKey(tradeSymbol);
  if (!key) return '';
  return map.get(key) || map.get(resolveFundInstrumentId(tradeSymbol)) || '';
}
