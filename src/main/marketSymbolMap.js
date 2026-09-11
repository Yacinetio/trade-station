/**
 * Broker symbol → free REST identifiers + routing hints.
 * No substitute broker prices: CFD-style symbols prefer MT5 history.
 */

const INDEX_HINT = /^(US100|US500|NAS100|GER40|UK100|US30|DJ30|SPX|USTEC|DE40)/i;

function stripBrokerSuffix(sym) {
  let s = String(sym || '').trim().toUpperCase();
  s = s.replace(/\.(CASH|I)$/i, '');
  s = s.replace(/[^A-Z0-9]/g, '');
  return s;
}

function normalizeCore(sym) {
  const raw = String(sym || '').trim().toUpperCase().replace(/\s+/g, '');
  const stripped = stripBrokerSuffix(sym);
  const hasCash = /\.CASH$/i.test(raw) || /\.I$/i.test(raw);
  return { raw, stripped, hasCash };
}

function looksLikeFxPair(core) {
  if (!core || core.length !== 6) return false;
  return /^[A-Z]{6}$/.test(core);
}

function cryptoVenueSymbols(core) {
  const c = String(core || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!c) return null;
  let base = '';
  let quote = 'USD';
  if (c.endsWith('USDT')) {
    base = c.slice(0, -4);
    quote = 'USDT';
  } else if (c.endsWith('USD')) {
    base = c.slice(0, -3);
  } else return null;
  if (!base || base.length > 6) return null;

  const krakenBase = base === 'BTC' ? 'XBT' : base;
  const krakenPair = `${krakenBase}${quote === 'USDT' ? 'USDT' : 'USD'}`;
  const binanceSymbol = `${base}${quote}`;

  return { krakenPair, binanceSymbol, base, quote };
}

function classifyMarketSymbol(brokerSymbol) {
  const { raw, stripped, hasCash } = normalizeCore(brokerSymbol);
  const core = stripped || stripBrokerSuffix(raw);

  if (hasCash || INDEX_HINT.test(raw)) {
    return {
      core,
      preferMt5: true,
      twelveFxSymbol: null,
      alphaFx: null,
      crypto: null
    };
  }

  const crypto = cryptoVenueSymbols(core);
  if (crypto && (crypto.quote === 'USD' || crypto.quote === 'USDT')) {
    return {
      core,
      preferMt5: false,
      twelveFxSymbol: null,
      alphaFx: null,
      crypto
    };
  }

  if (looksLikeFxPair(core)) {
    const base = core.slice(0, 3);
    const quote = core.slice(3);
    return {
      core,
      preferMt5: false,
      twelveFxSymbol: `${base}/${quote}`,
      alphaFx: { from: base, to: quote },
      crypto: null
    };
  }

  return {
    core,
    preferMt5: true,
    twelveFxSymbol: null,
    alphaFx: null,
    crypto: null
  };
}

module.exports = {
  classifyMarketSymbol,
  stripBrokerSuffix
};
