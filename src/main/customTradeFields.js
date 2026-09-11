/**
 * User-defined trade table columns parsed from Telegram signal text.
 * Settings → Columns: each field matches a labeled line like "Zone: London".
 */

const MAX_VALUE_LEN = 200;
const MAX_COLUMNS = 30;

const RESERVED_BUILTIN_IDS = new Set([
  'timeIn', 'timeOut', 'account', 'channel', 'symbol', 'timeframe', 'bias', 'setup',
  'vwapBand', 'hvnBand', 'trendAlign', 'obSize', 'type', 'sigEntry', 'entry', 'avgEntry', 'sl', 'tp', 'lot',
  'rr', 'profit', 'status', 'blockReason', 'comment', 'shots', 'replay', 'time'
]);

function trimFieldValue(raw, maxLen = MAX_VALUE_LEN) {
  const t = String(raw || '').replace(/\r/g, '').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function slugifyId(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return s.slice(0, 48) || 'field';
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize settings.customTradeColumns */
function normalizeCustomTradeColumns(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const parseKey = trimFieldValue(item.parseKey, 80);
    if (!parseKey) continue;
    let id = trimFieldValue(item.id, 48) || slugifyId(parseKey);
    if (RESERVED_BUILTIN_IDS.has(id) || id.startsWith('custom_')) {
      id = `custom_${slugifyId(parseKey)}`;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const label = trimFieldValue(item.label, 32) || parseKey.toUpperCase();
    const widthRaw = Number(item.width);
    const width = Number.isFinite(widthRaw) ? Math.min(320, Math.max(40, Math.round(widthRaw))) : 90;
    const tags = Array.isArray(item.tags)
      ? [...new Set(item.tags.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50)
      : [];
    out.push({
      id,
      label,
      parseKey,
      width,
      enabled: item.enabled !== false,
      sortable: item.sortable !== false,
      mapToPresetTags: item.mapToPresetTags === true,
      tags
    });
    if (out.length >= MAX_COLUMNS) break;
  }
  return out;
}

/** Extract `ParseKey: value` from signal text (line-based, case-insensitive key). */
function extractLabelValueFromText(text, parseKey) {
  if (!text || typeof text !== 'string' || !parseKey) return '';
  const escaped = escapeRegExp(String(parseKey).trim());
  const re = new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im');
  const m = text.match(re);
  if (!m) return '';
  return trimFieldValue(m[1]);
}

function extractCustomFieldsFromText(text, columnDefs = []) {
  const out = {};
  for (const col of columnDefs) {
    if (!col?.parseKey || !col?.id) continue;
    const val = extractLabelValueFromText(text, col.parseKey);
    if (val) out[col.id] = val;
  }
  return out;
}

function resolvePresetTagsFromCustomFields(customFields, columnDefs = [], tradePresets = []) {
  const tags = [];
  const presetLc = new Set(
    (Array.isArray(tradePresets) ? tradePresets : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
  );
  for (const col of columnDefs) {
    if (!col?.mapToPresetTags || !col?.id) continue;
    const val = trimFieldValue(customFields[col.id]);
    if (!val) continue;
    const valLc = val.toLowerCase();
    const colTags = Array.isArray(col.tags) ? col.tags : [];
    if (colTags.length > 0) {
      const hit = colTags.find((t) => String(t).trim().toLowerCase() === valLc);
      if (hit) tags.push(String(hit).trim());
      continue;
    }
    if (presetLc.has(valLc)) {
      const exact = (Array.isArray(tradePresets) ? tradePresets : []).find((t) => String(t).trim().toLowerCase() === valLc);
      if (exact) tags.push(String(exact).trim());
    } else {
      tags.push(val);
    }
  }
  return [...new Set(tags.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50);
}

/** Apply user column defs to a parsed signal payload. */
function applyCustomFieldsToSignal(signal, text, settings) {
  if (!signal || !text) return signal;
  const defs = normalizeCustomTradeColumns(settings?.customTradeColumns);
  if (!defs.length) return signal;
  const customFields = extractCustomFieldsFromText(text, defs);
  if (!Object.keys(customFields).length) return signal;
  const next = { ...signal, customFields: { ...(signal.customFields || {}), ...customFields } };
  const mappedTags = resolvePresetTagsFromCustomFields(customFields, defs, settings?.tradePresets);
  if (mappedTags.length) {
    next.presetTags = [...new Set([...(Array.isArray(signal.presetTags) ? signal.presetTags : []), ...mappedTags])].slice(0, 50);
  }
  return next;
}

function normalizeTradeCustomFields(trade = {}) {
  const src = trade.customFields;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = trimFieldValue(k, 48);
    const val = trimFieldValue(v);
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  normalizeCustomTradeColumns,
  extractLabelValueFromText,
  extractCustomFieldsFromText,
  resolvePresetTagsFromCustomFields,
  applyCustomFieldsToSignal,
  normalizeTradeCustomFields,
  MAX_COLUMNS
};
