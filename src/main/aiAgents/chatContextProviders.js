/**
 * Keyword-triggered trade-data context blocks for conversational AI.
 */

const { computeReport, isClosedTrade } = require('../reportEngine');
const { computeStrategyAnalytics, mistakeEconomics } = require('../strategyAnalytics');

const MAX_CHARS = 2000;

function clip(text) {
  const s = String(text || '').trim();
  if (s.length <= MAX_CHARS) return s;
  return `${s.slice(0, MAX_CHARS - 20)}\n…(truncated)`;
}

function closedTrades(trades) {
  return (Array.isArray(trades) ? trades : []).filter(isClosedTrade);
}

function formatReportRows(report) {
  if (!report?.rows?.length) return '';
  return report.rows
    .slice(0, 8)
    .map((r) => `${r.label || r.key}: ${r.count} trades, net $${Number(r.netPnl || 0).toFixed(2)}, WR ${Number(r.winRate || 0).toFixed(0)}%`)
    .join('\n');
}

function detectKeywords(question) {
  const q = String(question || '').toLowerCase();
  return {
    day: /\b(day|monday|tuesday|wednesday|thursday|friday|weekday|weekend)\b/.test(q),
    session: /\b(session|asian|london|new york|ny open)\b/.test(q),
    hour: /\b(hour|time of day|what time)\b/.test(q),
    week: /\b(week|weekly)\b/.test(q),
    strategy: /\b(strategy|playbook|setup)\b/.test(q),
    efficiency: /\b(efficiency|mfe|mae|zella scale|left on table)\b/.test(q),
    tag: /\b(tag|tags|mistake|mistakes)\b/.test(q),
    emotion: /\b(emotion|psychology|fomo|revenge|anxious)\b/.test(q)
  };
}

function buildExtraChatContext({ question, trades, settings }) {
  const keys = detectKeywords(question);
  const hasSignal = Object.values(keys).some(Boolean);
  if (!hasSignal) return '';

  const blocks = [];
  const list = closedTrades(trades);

  try {
    if (keys.day || /which day/.test(String(question || '').toLowerCase())) {
      const report = computeReport(list, { dimensionId: 'day-of-week' });
      const top = [...(report.rows || [])].sort((a, b) => (b.netPnl || 0) - (a.netPnl || 0))[0];
      blocks.push([
        'REPORT day-of-week (closed trades):',
        formatReportRows(report),
        top ? `Best day by net P&L: ${top.label} ($${Number(top.netPnl || 0).toFixed(2)})` : ''
      ].filter(Boolean).join('\n'));
    }

    if (keys.session) {
      const report = computeReport(list, { dimensionId: 'session' });
      blocks.push(['REPORT session:', formatReportRows(report)].join('\n'));
    }

    if (keys.hour) {
      const report = computeReport(list, { dimensionId: 'hour-of-day' });
      blocks.push(['REPORT hour-of-day:', formatReportRows(report)].join('\n'));
    }

    if (keys.week) {
      const report = computeReport(list, { dimensionId: 'week' });
      blocks.push(['REPORT by ISO week:', formatReportRows(report)].join('\n'));
    }

    if (keys.efficiency) {
      const report = computeReport(list, { dimensionId: 'efficiency-bucket' });
      blocks.push(['REPORT efficiency buckets:', formatReportRows(report)].join('\n'));
    }

    if (keys.strategy) {
      const rows = computeStrategyAnalytics(list, [], []);
      const top = rows.filter((r) => r.closedCount > 0).slice(0, 5);
      if (top.length) {
        blocks.push([
          'STRATEGY analytics (top by net P&L):',
          ...top.map((r) => `${r.name}: ${r.closedCount} closed, net $${Number(r.netPnl || 0).toFixed(2)}, WR ${r.winRate}%`)
        ].join('\n'));
      }
    }

    if (keys.tag || keys.emotion) {
      const mistakes = mistakeEconomics(list, settings?.tagCategories || {});
      if (mistakes.length) {
        blocks.push([
          'MISTAKE tag economics:',
          ...mistakes.slice(0, 6).map((m) => `${m.tag}: ${m.closedCount} trades, total $${Number(m.totalPnl || 0).toFixed(2)}`)
        ].join('\n'));
      }
      if (keys.emotion) {
        const report = computeReport(list, { dimensionId: 'emotion' });
        blocks.push(['REPORT emotion:', formatReportRows(report)].join('\n'));
      }
    }
  } catch (_) {
    return '';
  }

  if (!blocks.length) return '';
  return clip(blocks.join('\n\n'));
}

module.exports = {
  detectKeywords,
  buildExtraChatContext,
  MAX_CHARS
};
