/** Plain-English block reasons + Settings navigation hints. */

import { formatTradeNewsContextDetail } from './tradeNewsContext.js';

const BLOCK_REASON_MAP = {
  BLOCKED_SCHEDULE: {
    label: 'Outside trading schedule',
    explain: 'This signal arrived outside your configured trading hours or session window.',
    settingsTab: 'filters',
  },
  BLOCKED_SIGNAL_FILTERS: {
    label: 'Signal filter',
    explain: 'Advanced signal block filters rejected this signal (symbol, channel, bias, etc.).',
    settingsTab: 'filters',
  },
  BLOCKED_HIGH_NEWS: {
    label: 'High-impact news',
    explain: 'News guard blocked execution during a high-impact economic event window.',
    settingsTab: 'guard',
  },
  BLOCKED_EXEC_GUARD: {
    label: 'Execution guard',
    explain: 'An execution guard blocked this trade (spread, daily loss, correlation, or similar).',
    settingsTab: 'guard',
  },
  BLOCKED_DRAWDOWN_GUARD: {
    label: 'Drawdown guard',
    explain: 'Drawdown guardian halted new executions after daily loss or peak drawdown limits were hit.',
    settingsTab: 'guard',
  },
  BLOCKED_FUNDAMENTALS: {
    label: 'Fundamentals NO-GO',
    explain: 'The fundamentals checklist returned NO-GO for this symbol — execution was blocked.',
    settingsTab: 'guard',
  },
  BLOCKED_OPPOSITE_SYMBOL: {
    label: 'Opposite position',
    explain: 'A block-opposite rule prevented opening against an existing position on the same symbol.',
    settingsTab: 'guard',
  },
  BLOCKED_LOW_CONFIDENCE: {
    label: 'Low confidence',
    explain: 'Signal confidence score was below your minimum threshold.',
    settingsTab: 'filters',
  },
  BLOCKED_MANUAL: {
    label: 'Manual rejection',
    explain: 'Execution was rejected manually.',
    settingsTab: null,
  },
  BLOCKED_SPREAD: {
    label: 'Spread too high',
    explain: 'Spread was too high when the signal arrived, so execution was skipped to protect your entry price.',
    settingsTab: 'guard',
  },
  BLOCKED_EA_NO_SL: {
    label: 'EA: missing stop loss',
    explain: 'The EA-side safety net rejected the trade because the signal had no valid stop loss.',
    settingsTab: 'guard',
  },
  BLOCKED_EA_MAX_CONCURRENT: {
    label: 'EA: trade limit',
    explain: 'The EA-side safety net rejected the trade because the maximum number of concurrent trades was reached.',
    settingsTab: 'guard',
  },
  BLOCKED_EA_DAILY_LOSS: {
    label: 'EA: daily loss limit',
    explain: 'The EA-side safety net rejected the trade because the daily loss limit was already reached.',
    settingsTab: 'guard',
  },
  BLOCKED_QUEUE: {
    label: 'Expired while offline',
    explain: 'Signal expired while MetaTrader was offline — it was dropped instead of executing late at a stale price.',
    settingsTab: null,
  },
  BLOCKED_NEWS_TIMEOUT: {
    label: 'News check timed out',
    explain: 'The news-guard check could not complete in time and your safety setting blocks trades when a check fails.',
    settingsTab: 'guard',
  },
  BLOCKED_AI_TIMEOUT: {
    label: 'AI check timed out',
    explain: 'The AI signal-check could not complete in time and your safety setting blocks trades when a check fails.',
    settingsTab: 'guard',
  },
  BLOCKED_FAIL_CLOSED: {
    label: 'Safety check failed',
    explain: 'A safety check (news / AI) could not complete and your safety setting blocks trades when a check fails.',
    settingsTab: 'guard',
  },
  FAILED_10031: {
    label: 'MT5 connection lost',
    explain: 'The broker connection dropped while the order was being sent.',
    settingsTab: null,
  },
  FAILED_4756: {
    label: 'MT5 network error',
    explain: 'MetaTrader rejected the order because the terminal lost network connectivity.',
    settingsTab: null,
  },
  FAILED_DISPATCH_TIMEOUT: {
    label: 'Dispatch timeout',
    explain: 'Trade Station sent the signal to the EA but received no broker confirmation within 2 minutes.',
    settingsTab: null,
  },
};

function matchBlockReasonEntry(trade = {}) {
  const status = String(trade?.status || '').toUpperCase();
  const reason = String(trade?.blockedReason || '').trim();
  for (const [code, meta] of Object.entries(BLOCK_REASON_MAP)) {
    if (status.includes(code) || reason.toUpperCase().includes(code)) {
      return { code, ...meta, detail: reason || meta.explain };
    }
  }
  if (status.includes('BLOCKED') || reason) {
    return {
      code: 'BLOCKED',
      label: 'Blocked',
      explain: reason || 'This signal was blocked before execution.',
      settingsTab: 'guard',
      detail: reason,
    };
  }
  return null;
}

export function getBlockReasonHelp(trade = {}) {
  return matchBlockReasonEntry(trade);
}

export function formatBlockReasonTooltip(trade = {}) {
  const newsDetail = formatTradeNewsContextDetail(trade);
  const entry = matchBlockReasonEntry(trade);
  if (!entry) return newsDetail;
  const settingsHint = entry.settingsTab
    ? ` Open Settings → ${entry.settingsTab === 'filters' ? 'Filters' : 'Guard'}.`
    : '';
  const base = `${entry.explain}${entry.detail && entry.detail !== entry.explain ? ` (${entry.detail})` : ''}${settingsHint}`;
  return newsDetail ? `${base}\n${newsDetail}` : base;
}

export { BLOCK_REASON_MAP };
