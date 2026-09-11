const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { classifyMarketSymbol } = require('./marketSymbolMap');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hashKey(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
}

function toUnixSec(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : NaN;
}

function twelveInterval(minutes) {
  const m = Number(minutes) || 5;
  if (m <= 1) return '1min';
  if (m <= 5) return '5min';
  if (m <= 15) return '15min';
  if (m <= 30) return '30min';
  if (m <= 60) return '1h';
  if (m <= 240) return '4h';
  return '1day';
}

function alphaInterval(minutes) {
  const m = Number(minutes) || 5;
  if (m <= 5) return '5min';
  if (m <= 15) return '15min';
  if (m <= 30) return '30min';
  if (m <= 60) return '60min';
  return 'daily';
}

const MARKET_FETCH_TIMEOUT_MS = 10000;

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || MARKET_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { parseError: true, raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    const message = e?.name === 'AbortError' ? `timeout after ${MARKET_FETCH_TIMEOUT_MS}ms` : (e?.message || String(e));
    return { ok: false, status: 0, data: { error: message } };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBarsAscending(bars) {
  const out = (bars || [])
    .map((b) => ({
      time: Number(b.time),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close)
    }))
    .filter((b) => Number.isFinite(b.time) && [b.open, b.high, b.low, b.close].every(Number.isFinite));
  out.sort((a, b) => a.time - b.time);
  return out;
}

function clipRange(bars, fromSec, toSec) {
  return bars.filter((b) => b.time >= fromSec && b.time <= toSec);
}

async function fetchTwelveData({ symbol, resolutionMinutes, fromIso, toIso }, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return null;
  const interval = twelveInterval(resolutionMinutes);
  const u = new URL('https://api.twelvedata.com/time_series');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('interval', interval);
  u.searchParams.set('start_date', fromIso.slice(0, 19).replace('T', ' '));
  u.searchParams.set('end_date', toIso.slice(0, 19).replace('T', ' '));
  u.searchParams.set('apikey', key);
  const { ok, status, data } = await fetchJson(u.toString());
  if (!ok || !data || data.status === 'error' || !Array.isArray(data.values)) {
    return { error: `TWELVEDATA_${status}`, detail: data?.message || data?.code || '' };
  }
  const bars = data.values
    .map((row) => {
      const rawDt = String(row.datetime || '').replace(' ', 'T');
      const t = new Date(rawDt.endsWith('Z') ? rawDt : `${rawDt}Z`).getTime() / 1000;
      return {
        time: Math.floor(t),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close)
      };
    })
    .filter((b) => Number.isFinite(b.time));
  return { bars: normalizeBarsAscending(bars), source: 'twelvedata' };
}

async function fetchAlphaFx({ from, to, resolutionMinutes }, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return null;
  const interval = alphaInterval(resolutionMinutes);
  const u = new URL('https://www.alphavantage.co/query');
  u.searchParams.set('function', 'FX_INTRADAY');
  u.searchParams.set('from_symbol', from);
  u.searchParams.set('to_symbol', to);
  u.searchParams.set('interval', interval);
  u.searchParams.set('outputsize', 'full');
  u.searchParams.set('datatype', 'json');
  u.searchParams.set('apikey', key);
  const { ok, status, data } = await fetchJson(u.toString());
  if (!ok || !data || data['Error Message'] || data.Note) {
    return { error: `ALPHAVANTAGE_${status}`, detail: data?.['Error Message'] || data.Note || '' };
  }
  const prefix = `Time Series FX (${interval})`;
  const series = data[prefix];
  if (!series || typeof series !== 'object') {
    return { error: 'ALPHAVANTAGE_NO_SERIES', detail: prefix };
  }
  const bars = Object.entries(series).map(([dt, row]) => {
    const t = new Date(`${dt.replace(' ', 'T')}Z`).getTime() / 1000;
    return {
      time: Math.floor(t),
      open: parseFloat(row['1. open']),
      high: parseFloat(row['2. high']),
      low: parseFloat(row['3. low']),
      close: parseFloat(row['4. close'])
    };
  });
  return { bars: normalizeBarsAscending(bars), source: 'alphavantage' };
}

function krakenMinutes(resolutionMinutes) {
  const m = Number(resolutionMinutes) || 5;
  if (m <= 1) return 1;
  if (m <= 5) return 5;
  if (m <= 15) return 15;
  if (m <= 30) return 30;
  if (m <= 60) return 60;
  if (m <= 240) return 240;
  return 1440;
}

async function fetchKrakenOHLC(pair, resolutionMinutes, fromSec, toSec) {
  const interval = krakenMinutes(resolutionMinutes);
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`;
  const { ok, status, data } = await fetchJson(url);
  if (!ok || !data || (Array.isArray(data.error) && data.error.length)) {
    return { error: `KRAKEN_${status}`, detail: (data?.error || []).join(';') };
  }
  const result = data.result;
  if (!result || typeof result !== 'object') return { error: 'KRAKEN_BAD', detail: '' };
  const ckey = Object.keys(result).find((k) => k !== 'last');
  const rows = ckey ? result[ckey] : null;
  if (!Array.isArray(rows)) return { error: 'KRAKEN_PAIR', detail: pair };
  const bars = rows
    .map((row) => ({
      time: Number(row[0]),
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4])
    }))
    .filter((b) => b.time >= fromSec && b.time <= toSec);
  return { bars: normalizeBarsAscending(bars), source: 'kraken' };
}

async function fetchBinanceKlines(symbol, resolutionMinutes, fromSec, toSec) {
  const m = Number(resolutionMinutes) || 5;
  let interval = '5m';
  if (m <= 1) interval = '1m';
  else if (m <= 3) interval = '3m';
  else if (m <= 5) interval = '5m';
  else if (m <= 15) interval = '15m';
  else if (m <= 30) interval = '30m';
  else if (m <= 60) interval = '1h';
  else if (m <= 240) interval = '4h';
  else interval = '1d';
  const msFrom = fromSec * 1000;
  const msTo = toSec * 1000;
  const u = new URL('https://api.binance.com/api/v3/klines');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('interval', interval);
  u.searchParams.set('startTime', String(msFrom));
  u.searchParams.set('endTime', String(msTo));
  u.searchParams.set('limit', '1000');
  const { ok, status, data } = await fetchJson(u.toString());
  if (!ok || !Array.isArray(data)) {
    return { error: `BINANCE_${status}`, detail: typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : '' };
  }
  const bars = data.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4])
  }));
  return { bars: normalizeBarsAscending(bars), source: 'binance' };
}

function readCache(cachePath, maxAgeMs) {
  try {
    const st = fs.statSync(cachePath);
    if (Date.now() - st.mtimeMs > maxAgeMs) return null;
    const raw = fs.readFileSync(cachePath, 'utf8');
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.bars)) return null;
    return j;
  } catch {
    return null;
  }
}

function writeCache(cachePath, payload) {
  try {
    ensureDir(path.dirname(cachePath));
    fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  } catch (_) {}
}

/**
 * @param {{ brokerSymbol: string, resolutionMinutes: number, fromIso: string, toIso: string }} query
 * @param {{ settings: object, dataRoot: string, requestMt5History?: (p: object)=>Promise<object>, tcpConnected?: boolean }} ctx
 */
async function getMarketBars(query, ctx) {
  const { brokerSymbol, resolutionMinutes = 5, fromIso, toIso } = query;
  const settings = ctx.settings || {};
  const md = settings.marketData || {};
  const fromSec = toUnixSec(fromIso);
  const toSec = toUnixSec(toIso);
  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || fromSec >= toSec) {
    return { success: false, code: 'BAD_RANGE', message: 'Invalid from/to' };
  }

  const classification = classifyMarketSymbol(brokerSymbol);
  const cacheDir = path.join(ctx.dataRoot || '', 'market-cache');
  const cacheKey = hashKey([
    String(brokerSymbol),
    String(resolutionMinutes),
    String(fromSec),
    String(toSec)
  ]);
  const cachePath = path.join(cacheDir, `${cacheKey}.json`);
  const ttlMs = Math.max(60_000, Number(md.cacheTtlMinutes || 1440) * 60_000);
  const cached = readCache(cachePath, ttlMs);
  if (cached?.bars?.length) {
    return {
      success: true,
      source: cached.source || 'cache',
      bars: clipRange(normalizeBarsAscending(cached.bars), fromSec, toSec),
      warnings: ['CACHE']
    };
  }

  const warnings = [];
  let lastErr = '';

  async function tryMt5() {
    if (typeof ctx.requestMt5History !== 'function') return null;
    if (!ctx.tcpConnected) return null;
    try {
      const msg = await ctx.requestMt5History({
        symbol: String(brokerSymbol).trim(),
        timeframeMinutes: Number(resolutionMinutes) || 5,
        from: fromSec,
        to: toSec
      });
      if (msg?.success && Array.isArray(msg.bars) && msg.bars.length > 0) {
        return {
          bars: normalizeBarsAscending(msg.bars),
          source: 'mt5'
        };
      }
      lastErr = msg?.error || 'MT5_EMPTY';
    } catch (e) {
      lastErr = e?.message || 'MT5_ERR';
    }
    return null;
  }

  if (classification.preferMt5) {
    const m = await tryMt5();
    if (m) {
      writeCache(cachePath, { source: m.source, bars: m.bars, cachedAt: Date.now() });
      return { success: true, source: m.source, bars: clipRange(m.bars, fromSec, toSec), warnings };
    }
    return {
      success: false,
      code: 'MT5_REQUIRED',
      message: lastErr || 'Broker-style symbol needs MT5 connected for real OHLC.'
    };
  }

  if (classification.crypto) {
    const { krakenPair, binanceSymbol } = classification.crypto;
    let r = await fetchKrakenOHLC(krakenPair, resolutionMinutes, fromSec, toSec);
    if (r.bars?.length) {
      writeCache(cachePath, { source: r.source, bars: r.bars, cachedAt: Date.now() });
      return { success: true, source: r.source, bars: clipRange(r.bars, fromSec, toSec), warnings };
    }
    lastErr = r.error || 'KRAKEN_FAIL';
    r = await fetchBinanceKlines(binanceSymbol, resolutionMinutes, fromSec, toSec);
    if (r.bars?.length) {
      writeCache(cachePath, { source: r.source, bars: r.bars, cachedAt: Date.now() });
      return { success: true, source: r.source, bars: clipRange(r.bars, fromSec, toSec), warnings };
    }
    lastErr = r.error || lastErr;
  }

  if (classification.twelveFxSymbol && md.enableTwelveData !== false) {
    const r = await fetchTwelveData(
      {
        symbol: classification.twelveFxSymbol,
        resolutionMinutes,
        fromIso,
        toIso
      },
      md.twelveDataKey
    );
    if (r?.bars?.length) {
      writeCache(cachePath, { source: r.source, bars: r.bars, cachedAt: Date.now() });
      return { success: true, source: r.source, bars: clipRange(r.bars, fromSec, toSec), warnings };
    }
    if (r?.error) lastErr = r.error;
    if (r?.detail) warnings.push(String(r.detail));
  }

  if (classification.alphaFx && md.enableAlphaVantage !== false) {
    const r = await fetchAlphaFx(
      {
        from: classification.alphaFx.from,
        to: classification.alphaFx.to,
        resolutionMinutes
      },
      md.alphaVantageKey
    );
    if (r?.bars?.length) {
      writeCache(cachePath, { source: r.source, bars: r.bars, cachedAt: Date.now() });
      return { success: true, source: r.source, bars: clipRange(r.bars, fromSec, toSec), warnings };
    }
    if (r?.error) lastErr = r.error;
    if (r?.detail) warnings.push(String(r.detail));
  }

  if (md.fallbackMt5 !== false) {
    const m = await tryMt5();
    if (m) {
      writeCache(cachePath, { source: m.source, bars: m.bars, cachedAt: Date.now() });
      return { success: true, source: m.source, bars: clipRange(m.bars, fromSec, toSec), warnings };
    }
  }

  return {
    success: false,
    code: 'ALL_PROVIDERS_FAILED',
    message: lastErr || 'No free OHLC source returned bars for this window.',
    warnings
  };
}

module.exports = {
  getMarketBars,
  classifyMarketSymbol
};
