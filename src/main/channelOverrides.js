/**
 * Per-channel strategy overrides.
 *
 * Settings shape:
 *   settings.channelStrategies = {
 *     [channelKey]: {
 *       enabled: true | false,         // false → silently drop signals from this channel
 *       reverse: 'none'|'flip'|'sl_tp_only',
 *       lotMode: 'percentage'|'fixed'|'risk'|'riskpct'|'signal',
 *       lotPercentage, fixedLot, riskAmount, riskPct,
 *       tpMode: 'separate'|'first'|'last'|'average'|'all_in_one',
 *       skipNoSL: true|false,          // forces blockInvalidOrMissingStopLoss for this channel
 *       maxSpreadPips: number,         // override
 *       extraDelayMs: number           // adds to global stealth delay
 *     }
 *   }
 *
 * Channel keys are matched with several strategies (id, exact name, normalized name) so the
 * UI can store whichever the user picks.
 */

function normalizeChannelKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getChannelOverride(settings, channelName, channelId) {
  const map = settings?.channelStrategies;
  if (!map || typeof map !== 'object') return null;
  const candidates = [
    channelId != null ? String(channelId) : '',
    String(channelName || ''),
    normalizeChannelKey(channelName)
  ].filter(Boolean);
  for (const key of candidates) {
    if (map[key] && typeof map[key] === 'object') return map[key];
  }
  return null;
}

/**
 * Merge per-channel overrides on top of global settings, returning a new flat object that
 * downstream modules (lotSizing, signalExecutionApply, executionGuards) can consume unchanged.
 */
function applyChannelOverrides(settings, channelName, channelId) {
  const override = getChannelOverride(settings, channelName, channelId);
  if (!override) return { merged: settings, override: null, channelDisabled: false };

  if (override.enabled === false) {
    return { merged: settings, override, channelDisabled: true };
  }

  const merged = { ...settings };
  if (override.reverse !== undefined) merged.reverseMode = override.reverse;
  if (override.lotMode !== undefined) merged.lotMode = override.lotMode;
  if (override.lotPercentage !== undefined) merged.lotPercentage = Number(override.lotPercentage);
  if (override.fixedLot !== undefined) merged.fixedLot = Number(override.fixedLot);
  if (override.riskAmount !== undefined) merged.riskAmount = Number(override.riskAmount);
  if (override.riskPct !== undefined) merged.riskPct = Number(override.riskPct);
  if (override.tpMode !== undefined) merged.tpMode = override.tpMode;
  if (override.skipNoSL === true) merged.blockInvalidOrMissingStopLoss = true;
  if (override.skipNoSL === false) merged.blockInvalidOrMissingStopLoss = false;
  if (override.maxSpreadPips !== undefined) merged.maxSpreadPips = Number(override.maxSpreadPips);
  return { merged, override, channelDisabled: false };
}

module.exports = {
  applyChannelOverrides,
  getChannelOverride,
  normalizeChannelKey
};
