/**
 * Slice filters for dashboard table + analytics (mirror analyticsService.passesFilters TF/symbol/bias/setup).
 */

import { getKillzone, sessionKeyForSlice } from './sessionModel.js';

/**
 * Canonical OB-stats VWAP flag: yes | no | na — YES = OB overlaps ±1σ band at signal time.
 */
export function canonicalTradeVwapBand(trade) {
  const raw = String(trade?.vwapBand || '').trim().toLowerCase();
  const v = raw === 'n/a' ? 'na' : raw;
  if (v === 'yes' || v === 'no' || v === 'na') return v;
  return '';
}

/** OB at VP HVN cluster (Telegram HVN: YES/NO) */
export function canonicalTradeHvnBand(trade) {
  const raw = String(trade?.hvnBand || '').trim().toLowerCase();
  const v = raw === 'n/a' ? 'na' : raw;
  if (v === 'yes' || v === 'no' || v === 'na') return v;
  return '';
}

export function canonicalTradeTrendAlign(trade) {
  const raw = String(trade?.trendAlign || '').trim().toLowerCase();
  const v = raw === 'n/a' ? 'na' : raw;
  if (v === 'with' || v === 'against' || v === 'neutral' || v === 'na') return v;
  return '';
}

export function canonicalTradeTop1(trade) {
  if (trade?.top1 === true) return 'yes';
  if (trade?.top1 === false) return 'no';
  return '';
}

/** Confluence tier: 0 | 1-2 | 3+ */
export function confluenceTierFromCount(n) {
  const c = Number(n);
  if (!Number.isFinite(c) || c <= 0) return '0';
  if (c <= 2) return '1-2';
  return '3+';
}

export function canonicalTradeConfluenceTier(trade) {
  if (trade?.confluence == null) return '';
  return confluenceTierFromCount(trade.confluence);
}

function tradeOpenDate(trade) {
  const raw = trade?.openedAt || trade?.time || trade?.lastUpdateAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC session bucket (sessionModel); prefers Telegram signalSession when stored. */
export function tradeSessionLocal(trade) {
  const fromSignal = String(trade?.signalSession || '').trim();
  if (fromSignal === 'asian' || fromSignal === 'london' || fromSignal === 'newYork' || fromSignal === 'off') {
    return fromSignal;
  }
  const d = tradeOpenDate(trade);
  if (!d) return '';
  return sessionKeyForSlice(d);
}

/** ICT killzone at trade open time (UTC, DST-aware). */
export function tradeKillzone(trade) {
  const d = tradeOpenDate(trade);
  if (!d) return '';
  return getKillzone(d) || 'none';
}

/** All session keys for slice pickers (empty selection = no filter). */
export const SLICE_SESSION_KEYS = ['asian', 'london', 'newYork', 'off'];

export const SLICE_TREND_ALIGN_KEYS = ['with', 'against', 'neutral', 'na'];

export const SLICE_KILLZONE_KEYS = [
  'asia-kz',
  'london-open-kz',
  'ny-am-kz',
  'london-close-kz',
  'silver-bullet',
  'none'
];

export const SLICE_CONFLUENCE_TIER_KEYS = ['0', '1-2', '3+'];

export const SLICE_TOP1_KEYS = ['yes', 'no'];

/** `Date.getDay()` indices; UI order Mon → Sun (matches typical trading week). */
export const SLICE_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatWeekdaySliceOption(dayIndex) {
  const i = Number(dayIndex);
  if (!Number.isInteger(i) || i < 0 || i > 6) return String(dayIndex);
  return WD_SHORT[i];
}

export function formatKillzoneSliceOption(kz) {
  const map = {
    'asia-kz': 'Asia KZ',
    'london-open-kz': 'London open KZ',
    'ny-am-kz': 'NY AM KZ',
    'london-close-kz': 'London close KZ',
    'silver-bullet': 'Silver bullet',
    none: 'No killzone'
  };
  return map[kz] || kz;
}

/** Sort weekday indices for display Mon → Sun. */
export function sortWeekdayIndicesMonFirst(indices) {
  const order = new Map(SLICE_WEEKDAY_ORDER.map((d, idx) => [d, idx]));
  return [...indices].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

export function tradeMatchesSlice(trade, slice = {}) {
  const tfs = slice.timeframes;
  if (Array.isArray(tfs) && tfs.length > 0) {
    const tf = String(trade?.timeframe || '').toUpperCase().trim();
    if (!tfs.includes(tf)) return false;
  }
  const syms = slice.symbols;
  if (Array.isArray(syms) && syms.length > 0) {
    const sym = String(trade?.symbol || '').toUpperCase().trim();
    if (!syms.includes(sym)) return false;
  }
  const biasPick = slice.biasTerms;
  if (Array.isArray(biasPick) && biasPick.length > 0) {
    const b = String(trade?.bias || '').trim().toLowerCase();
    if (!b) return false;
    const want = new Set(biasPick.map((x) => String(x || '').trim().toLowerCase()));
    if (!want.has(b)) return false;
  }
  const setupPick = slice.setupTerms;
  if (Array.isArray(setupPick) && setupPick.length > 0) {
    const tags = (() => {
      const pts = Array.isArray(trade?.presetTags) ? trade.presetTags : [];
      const out = pts.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
      const legacy = String(trade?.setup || '').trim().toLowerCase();
      if (legacy && !out.includes(legacy)) out.push(legacy);
      return out;
    })();
    if (tags.length === 0) return false;
    const want = new Set(setupPick.map((x) => String(x || '').trim().toLowerCase()));
    if (!tags.some((t) => want.has(t))) return false;
  }
  const vwapPick = slice.vwapBands;
  if (Array.isArray(vwapPick) && vwapPick.length > 0) {
    const v = canonicalTradeVwapBand(trade);
    if (!v) return false;
    const want = new Set(vwapPick.map((x) => {
      const s = String(x || '').trim().toLowerCase();
      return s === 'n/a' ? 'na' : s;
    }));
    if (!want.has(v)) return false;
  }
  const hvnPick = slice.hvnBands;
  if (Array.isArray(hvnPick) && hvnPick.length > 0) {
    const v = canonicalTradeHvnBand(trade);
    if (!v) return false;
    const want = new Set(hvnPick.map((x) => {
      const s = String(x || '').trim().toLowerCase();
      return s === 'n/a' ? 'na' : s;
    }));
    if (!want.has(v)) return false;
  }
  const trendPick = slice.trendAligns;
  if (Array.isArray(trendPick) && trendPick.length > 0) {
    const v = canonicalTradeTrendAlign(trade);
    if (!v) return false;
    const want = new Set(trendPick.map((x) => {
      const s = String(x || '').trim().toLowerCase();
      return s === 'n/a' ? 'na' : s;
    }));
    if (!want.has(v)) return false;
  }
  const killzonePick = slice.killzones;
  if (Array.isArray(killzonePick) && killzonePick.length > 0) {
    const kz = tradeKillzone(trade);
    if (!kz) return false;
    const want = new Set(killzonePick.map((x) => String(x || '').trim()));
    if (!want.has(kz)) return false;
  }
  const confPick = slice.confluenceTiers;
  if (Array.isArray(confPick) && confPick.length > 0) {
    const tier = canonicalTradeConfluenceTier(trade);
    if (!tier) return false;
    const want = new Set(confPick.map((x) => String(x || '').trim()));
    if (!want.has(tier)) return false;
  }
  const top1Pick = slice.top1Values;
  if (Array.isArray(top1Pick) && top1Pick.length > 0) {
    const v = canonicalTradeTop1(trade);
    if (!v) return false;
    const want = new Set(top1Pick.map((x) => String(x || '').trim().toLowerCase()));
    if (!want.has(v)) return false;
  }
  const sessionPick = slice.sessions;
  if (Array.isArray(sessionPick) && sessionPick.length > 0) {
    const sess = tradeSessionLocal(trade);
    if (!sess) return false;
    const want = new Set();
    for (const x of sessionPick) {
      const k = String(x || '').trim();
      if (SLICE_SESSION_KEYS.includes(k)) want.add(k);
    }
    if (want.size === 0) return false;
    if (!want.has(sess)) return false;
  }
  const weekdayPick = slice.weekdays;
  if (Array.isArray(weekdayPick) && weekdayPick.length > 0) {
    const raw = trade?.openedAt || trade?.time || trade?.lastUpdateAt;
    if (!raw) return false;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    const want = new Set();
    for (const x of weekdayPick) {
      const n = Number(x);
      if (Number.isInteger(n) && n >= 0 && n <= 6) want.add(n);
    }
    if (want.size === 0) return false;
    if (!want.has(d.getDay())) return false;
  }
  return true;
}

export function uniqueSortedStrings(values, { limit = 500 } = {}) {
  const set = new Set();
  for (const v of values || []) {
    const s = String(v || '').trim();
    if (s) set.add(s);
  }
  const arr = [...set].sort((a, b) => a.localeCompare(b));
  return arr.length > limit ? arr.slice(0, limit) : arr;
}
