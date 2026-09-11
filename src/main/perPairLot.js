/**
 * Per-symbol lot sizing overrides. Settings shape:
 *   settings.perPairOverrides = {
 *     [SYMBOL]: { lotMode, lotPercentage, fixedLot, riskAmount, riskPct, maxLot }
 *   }
 *
 * The override key is matched by `normalizeSymbolKey` (broker suffix stripped, uppercased)
 * so that EURUSD, EURUSDm, EURUSD.r all resolve to the same EURUSD entry.
 */

function normalizeSymbolKey(symbol) {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return '';
  // Strip common broker suffixes / dots
  const m = raw.match(/^([A-Z0-9]{3,8})(?:[._-][A-Z0-9]{0,5})?$/);
  if (m) return m[1];
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function getPerPairOverride(settings, symbol) {
  const map = settings?.perPairOverrides;
  if (!map || typeof map !== 'object') return null;
  const key = normalizeSymbolKey(symbol);
  if (!key) return null;
  if (map[key]) return map[key];
  // Also try original case as a fallback so users can paste raw names.
  if (map[String(symbol || '')]) return map[String(symbol || '')];
  return null;
}

function applyPerPairOverrides(settings, symbol) {
  const override = getPerPairOverride(settings, symbol);
  if (!override) return settings;
  const merged = { ...settings };
  if (override.lotMode !== undefined) merged.lotMode = override.lotMode;
  if (override.lotPercentage !== undefined) merged.lotPercentage = Number(override.lotPercentage);
  if (override.fixedLot !== undefined) merged.fixedLot = Number(override.fixedLot);
  if (override.riskAmount !== undefined) merged.riskAmount = Number(override.riskAmount);
  if (override.riskPct !== undefined) merged.riskPct = Number(override.riskPct);
  if (override.maxLot !== undefined) merged.maxLot = Number(override.maxLot);
  return merged;
}

module.exports = {
  normalizeSymbolKey,
  getPerPairOverride,
  applyPerPairOverrides
};
