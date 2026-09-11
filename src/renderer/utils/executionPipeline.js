/** Build execution pipeline steps for TradeDetailModal. */

import { formatTradeNewsContextDetail } from './tradeNewsContext.js';

const PIPELINE_STAGE_LABELS = {
  parse: 'Parsed',
  schedule: 'Schedule',
  signalFilters: 'Signal filters',
  execGuards: 'Execution guards',
  drawdown: 'Drawdown guard',
  newsGuard: 'News guard',
  aiCheck: 'AI check',
  fundamentalsGate: 'Fundamentals gate',
  dispatch: 'Dispatch to MT5'
};

function tsMs(raw) {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtDur(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function inferPipelineStageState(stage, detail, tradeStatus) {
  const st = String(tradeStatus || '').toUpperCase();
  const d = String(detail || '').toLowerCase();
  const blockedDetail = /block|halt|no-go|timeout|fail|reject|expired|overflow|simulated|high-impact/i.test(d);
  if (stage === 'dispatch') {
    if (st.startsWith('FAILED') || st === 'BLOCKED_QUEUE') return 'failed';
    if (d.includes('simulated')) return 'done';
    if (st === 'DISPATCHED' || st === 'NO_MT5_QUEUED' || st === 'SENT') return 'done';
    if (st === 'PENDING' || st === 'SIMULATED') return st === 'SIMULATED' ? 'done' : 'pending';
    return blockedDetail ? 'failed' : 'done';
  }
  if (blockedDetail) return 'failed';
  if (stage === 'aiCheck' && d.includes('block')) return 'failed';
  return 'done';
}

/** Format raw pipelineStages telemetry into UI step objects (mirrors signalPipeline.js). */
export function formatPipelineStagesForDisplay(pipelineStages, trade = {}) {
  const list = Array.isArray(pipelineStages) ? pipelineStages : [];
  if (list.length === 0) return [];
  const status = String(trade?.status || '').toUpperCase();
  const steps = list.map((entry) => {
    const id = String(entry?.stage || 'unknown');
    const detail = String(entry?.detail || '');
    return {
      id,
      label: PIPELINE_STAGE_LABELS[id] || id,
      state: inferPipelineStageState(id, detail, status),
      detail: detail || PIPELINE_STAGE_LABELS[id] || id,
      at: tsMs(entry?.at)
    };
  });
  for (let i = 1; i < steps.length; i++) {
    const ms = list[i]?.ms;
    if (ms != null && Number.isFinite(ms)) steps[i].duration = fmtDur(ms);
  }
  return steps;
}

function buildCosmeticExecutionPipeline(trade = {}) {
  const status = String(trade?.status || '').toUpperCase();
  const blocked = status.includes('BLOCKED') || Boolean(trade?.blockedReason);
  const closed = status.includes('CLOSED') || status.includes('TP_HIT') || status.includes('SL_HIT') || Boolean(trade?.closeTime || trade?.closedAt);
  const sent = status === 'SENT' || status === 'DISPATCHED' || status === 'NO_MT5_QUEUED' || Boolean(trade?.mt5Ticket || trade?.mt5PositionId);
  const openMs = tsMs(trade?.openedAt || trade?.time);
  const closeMs = tsMs(trade?.closedAt || trade?.closeTime);
  const updateMs = tsMs(trade?.lastUpdateAt);

  const steps = [];

  steps.push({
    id: 'parse',
    label: 'Parsed',
    state: 'done',
    detail: trade?.symbol ? `${trade.type || ''} ${trade.symbol}`.trim() : 'Signal parsed',
    at: openMs,
  });

  if (blocked) {
    steps.push({
      id: 'block',
      label: 'Blocked',
      state: 'failed',
      detail: trade?.blockedReason || status,
      at: updateMs || openMs,
    });
    return steps;
  }

  const newsDetail = formatTradeNewsContextDetail(trade);
  steps.push({
    id: 'filters',
    label: 'Schedule & filters',
    state: 'done',
    detail: newsDetail || 'Passed schedule, news, and signal filters',
    at: openMs,
  });

  steps.push({
    id: 'guards',
    label: 'Execution guards',
    state: 'done',
    detail: 'Passed lot sizing and execution guards',
    at: openMs,
  });

  if (trade?.aiCheck?.verdict || trade?.aiCheck?.summary) {
    steps.push({
      id: 'ai',
      label: 'AI check',
      state: trade.aiCheck.verdict === 'reject' ? 'failed' : 'done',
      detail: trade.aiCheck.summary || trade.aiCheck.verdict || 'AI reviewed',
      at: updateMs || openMs,
    });
  }

  steps.push({
    id: 'send',
    label: status === 'DISPATCHED' || status === 'NO_MT5_QUEUED' ? 'Dispatching to MT5' : 'Sent to MT5',
    state: status.startsWith('FAILED') ? 'failed' : sent ? 'done' : 'pending',
    detail: status.startsWith('FAILED')
      ? (trade?.blockedReason || status)
      : status === 'DISPATCHED' || status === 'NO_MT5_QUEUED'
        ? 'Awaiting broker confirmation'
        : sent
          ? `Ticket ${trade.mt5Ticket || trade.mt5PositionId || '—'}`
          : 'Not sent',
    at: openMs,
  });

  steps.push({
    id: 'fill',
    label: closed ? 'Closed' : sent ? 'Live' : 'Pending',
    state: closed ? 'done' : sent ? 'active' : 'pending',
    detail: closed
      ? `${status} · P&L ${Number(trade.profit || 0).toFixed(2)}$`
      : sent
        ? 'Position open'
        : 'Awaiting fill',
    at: closeMs || updateMs || openMs,
  });

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]?.at;
    const cur = steps[i]?.at;
    if (prev != null && cur != null && cur >= prev) {
      steps[i].duration = fmtDur(cur - prev);
    }
  }

  return steps;
}

export function buildExecutionPipeline(trade = {}) {
  if (Array.isArray(trade?.pipelineStages) && trade.pipelineStages.length > 0) {
    return formatPipelineStagesForDisplay(trade.pipelineStages, trade);
  }
  return buildCosmeticExecutionPipeline(trade);
}
