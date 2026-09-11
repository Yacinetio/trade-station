/**
 * Pre-trade signal confidence scorer.
 *
 * Combines simple, fast, fully-local heuristics with the channel's recent track record.
 * Intentionally does NOT call OpenAI by default — keeps decisions cheap and offline.
 * Returns a score in [0, 1] and a list of reasons for the UI / log.
 *
 * Settings shape:
 *   settings.signalConfidence = {
 *     enabled: bool,
 *     minScore: number          // 0..1; below this we either reduce size or block
 *     onLowScore: 'reduce' | 'block'
 *     reduceFactor: number      // 0..1, only when onLowScore === 'reduce'
 *   }
 */

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function isClosed(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('TP_HIT') || s.includes('SL_HIT') || !!t?.closeTime;
}

function recentClosedForChannel(trades, channel, limit = 30) {
  const list = (trades || [])
    .filter((t) => String(t?.channel || '') === String(channel || '') && isClosed(t))
    .sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')))
    .slice(0, limit);
  return list;
}

function expectancyHeuristic(closed) {
  if (!closed.length) return { winRate: 0.5, expectancy: 0, sample: 0 };
  const wins = closed.filter((t) => Number(t.profit) > 0).length;
  const losses = closed.filter((t) => Number(t.profit) < 0).length;
  const winRate = closed.length === 0 ? 0.5 : wins / closed.length;
  const avgWin = wins ? closed.filter((t) => Number(t.profit) > 0).reduce((a, b) => a + Number(b.profit || 0), 0) / wins : 0;
  const avgLoss = losses ? Math.abs(closed.filter((t) => Number(t.profit) < 0).reduce((a, b) => a + Number(b.profit || 0), 0) / losses) : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  return { winRate, expectancy, sample: closed.length };
}

/**
 * @param {object} param0
 * @param {object} param0.signal - after lot sizing
 * @param {object[]} param0.trades - prior trades for context
 * @param {string} param0.channelName
 * @param {object} param0.newsGuard - { blocked, reason, severity? }
 * @returns {{ score: number, action: 'allow'|'reduce'|'block', reasons: string[], lotMultiplier: number }}
 */
function scoreSignal({ signal, trades, channelName, newsGuard, settings }) {
  const cfg = settings?.signalConfidence || {};
  const reasons = [];
  let score = 0.6;

  // 1. SL/TP sanity — invalid stop-loss already blocked upstream; here only check the SL distance ratio.
  const entry = Number(signal?.entry);
  const sl = Number(signal?.sl);
  const tp = Array.isArray(signal?.tp) ? Number(signal.tp[0]) : Number(signal?.tp);
  if (Number.isFinite(entry) && entry > 0 && Number.isFinite(sl) && sl > 0 && Number.isFinite(tp) && tp > 0) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk > 0) {
      const rr = reward / risk;
      if (rr >= 2) { score += 0.15; reasons.push(`R:R ${rr.toFixed(2)} ≥ 2`); }
      else if (rr >= 1) { score += 0.05; reasons.push(`R:R ${rr.toFixed(2)} ≥ 1`); }
      else { score -= 0.15; reasons.push(`R:R ${rr.toFixed(2)} < 1`); }
    }
  } else {
    score -= 0.05; reasons.push('Missing TP — cannot evaluate R:R');
  }

  // 2. News context — partial overlap with news guard.
  if (newsGuard?.blocked === true) {
    score -= 0.20;
    reasons.push(`News guard says blocked: ${String(newsGuard.reason || '').slice(0, 60)}`);
  } else if (newsGuard?.severity && Number(newsGuard.severity) >= 0.5) {
    score -= 0.10;
    reasons.push('Elevated news risk window');
  }

  // 3. Channel track record on recent N trades.
  const closed = recentClosedForChannel(trades, channelName, 30);
  const { winRate, expectancy, sample } = expectancyHeuristic(closed);
  if (sample >= 10) {
    if (expectancy > 0 && winRate >= 0.55) {
      score += 0.15;
      reasons.push(`Channel: WR ${(winRate * 100).toFixed(0)}% over ${sample} closed (positive expectancy)`);
    } else if (expectancy < 0 || winRate < 0.4) {
      score -= 0.15;
      reasons.push(`Channel: WR ${(winRate * 100).toFixed(0)}% over ${sample} closed (negative expectancy)`);
    }
  } else if (sample === 0) {
    reasons.push('No prior closed trades for this channel — neutral');
  }

  score = clamp01(score);

  const minScore = clamp01(Number(cfg.minScore));
  const enabled = cfg.enabled === true && minScore > 0;
  const reduce = clamp01(Number(cfg.reduceFactor) || 0.5);

  let action = 'allow';
  let lotMultiplier = 1;
  if (enabled && score < minScore) {
    if (cfg.onLowScore === 'block') {
      action = 'block';
    } else {
      action = 'reduce';
      lotMultiplier = reduce;
    }
  }

  return { score, action, reasons, lotMultiplier };
}

module.exports = { scoreSignal };
