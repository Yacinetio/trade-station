import { describe, it, expect } from 'vitest';
const {
  isDuplicateTelegramSignal,
  generateTradeId,
  applyTradeDispatchStatus,
  resolveGuardFailMode,
  evaluateFailClosedTimeouts,
  shouldSimulateDispatch,
  resolveMaxSpreadPips,
  validateTpLotShares,
  resolveTpLotShares,
  resolvePendingExpirySeconds,
  detectCloseCommand,
  detectManagementCommand,
  createPipelineStageRecorder,
  appendPipelineStage,
  formatPipelineStagesForDisplay,
  formatPipelineDurationMs
} = require('../src/main/signalPipeline');

describe('isDuplicateTelegramSignal', () => {
  const now = Date.now();
  const trades = [
    { id: 'a', tgMessageId: 101, channel: 'Gold Signals', openedAt: new Date(now - 60000).toISOString() },
    { id: 'b', tgMessageId: 102, channel: 'FX Channel', openedAt: new Date(now - 60000).toISOString() },
    { id: 'c', tgMessageId: 103, channel: 'Old Channel', openedAt: new Date(now - 72 * 3600 * 1000).toISOString() }
  ];

  it('detects a duplicate message id + channel', () => {
    expect(isDuplicateTelegramSignal(trades, { messageId: 101, channelName: 'Gold Signals', now })).toBe(true);
  });

  it('matches across string/number message id types', () => {
    expect(isDuplicateTelegramSignal(trades, { messageId: '101', channelName: 'Gold Signals', now })).toBe(true);
  });

  it('same message id on a different channel is not a duplicate', () => {
    expect(isDuplicateTelegramSignal(trades, { messageId: 101, channelName: 'FX Channel', now })).toBe(false);
  });

  it('ignores matches older than 48h', () => {
    expect(isDuplicateTelegramSignal(trades, { messageId: 103, channelName: 'Old Channel', now })).toBe(false);
  });

  it('no message id → never a duplicate', () => {
    expect(isDuplicateTelegramSignal(trades, { messageId: null, channelName: 'Gold Signals', now })).toBe(false);
    expect(isDuplicateTelegramSignal(trades, { channelName: 'Gold Signals', now })).toBe(false);
  });

  it('only scans the most recent 500 rows', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      id: `t${i}`,
      tgMessageId: i,
      channel: 'Bulk',
      openedAt: new Date(now - 1000).toISOString()
    }));
    expect(isDuplicateTelegramSignal(many, { messageId: 10, channelName: 'Bulk', now })).toBe(true);
    expect(isDuplicateTelegramSignal(many, { messageId: 599, channelName: 'Bulk', now })).toBe(false);
  });
});

describe('generateTradeId', () => {
  it('is short enough for the EA "TS:<id>" comment (≤ 31 chars total)', () => {
    const id = generateTradeId();
    expect(`TS:${id}`.length).toBeLessThanOrEqual(31);
  });

  it('does not collide for signals in the same millisecond', () => {
    const fixedNow = Date.now();
    const ids = new Set(Array.from({ length: 200 }, () => generateTradeId(fixedNow)));
    expect(ids.size).toBeGreaterThan(190);
  });
});

describe('applyTradeDispatchStatus', () => {
  it('maps QUEUE_EXPIRED to BLOCKED_QUEUE with a friendly reason', () => {
    const trade = { status: 'NO_MT5_QUEUED', blockedReason: 'MT5 offline — queued until EA reconnects' };
    applyTradeDispatchStatus(trade, { status: 'QUEUE_EXPIRED' });
    expect(trade.status).toBe('BLOCKED_QUEUE');
    expect(trade.blockedReason).toBe('Signal expired in offline queue before MT5 reconnected — not executed');
    expect(trade.lastUpdateAt).toBeTruthy();
  });

  it('maps QUEUE_OVERFLOW to BLOCKED_QUEUE', () => {
    const trade = { status: 'NO_MT5_QUEUED' };
    applyTradeDispatchStatus(trade, { status: 'QUEUE_OVERFLOW' });
    expect(trade.status).toBe('BLOCKED_QUEUE');
    expect(trade.blockedReason).toMatch(/queue was full/i);
  });

  it('keeps existing DISPATCHED / NO_MT5_QUEUED / WRITE_FAILED mapping', () => {
    const a = {};
    applyTradeDispatchStatus(a, { status: 'DISPATCHED' });
    expect(a.status).toBe('DISPATCHED');
    expect(a.dispatchedAt).toBeTruthy();

    const b = {};
    applyTradeDispatchStatus(b, { status: 'NO_MT5_QUEUED' });
    expect(b.status).toBe('NO_MT5_QUEUED');
    expect(b.blockedReason).toMatch(/MT5 offline/);

    const c = {};
    applyTradeDispatchStatus(c, { status: 'WRITE_FAILED' });
    expect(c.status).toBe('FAILED_DISPATCH');
  });
});

describe('fail-closed guard mode', () => {
  it('resolves guardFailMode with open as default', () => {
    expect(resolveGuardFailMode({})).toBe('open');
    expect(resolveGuardFailMode({ guardFailMode: 'closed' })).toBe('closed');
    expect(resolveGuardFailMode({ guardFailMode: 'CLOSED' })).toBe('closed');
    expect(resolveGuardFailMode({ guardFailMode: 'whatever' })).toBe('open');
    expect(resolveGuardFailMode(null)).toBe('open');
  });

  it('open mode never blocks on timeouts', () => {
    expect(evaluateFailClosedTimeouts({ guardFailMode: 'open', newsTimedOut: true, aiTimedOut: true })).toBe('');
  });

  it('closed mode blocks on news timeout with a clear reason', () => {
    const reason = evaluateFailClosedTimeouts({ guardFailMode: 'closed', newsTimedOut: true });
    expect(reason).toBe('News check timed out — blocked by fail-closed mode');
  });

  it('closed mode blocks on AI timeout', () => {
    const reason = evaluateFailClosedTimeouts({ guardFailMode: 'closed', aiTimedOut: true });
    expect(reason).toBe('AI check timed out — blocked by fail-closed mode');
  });

  it('closed mode with no timeouts allows the trade', () => {
    expect(evaluateFailClosedTimeouts({ guardFailMode: 'closed' })).toBe('');
  });

  it('closed mode blocks on fundamentals timeout', () => {
    const reason = evaluateFailClosedTimeouts({ guardFailMode: 'closed', fundamentalsTimedOut: true });
    expect(reason).toBe('Fundamentals check timed out — blocked by fail-closed mode');
  });

  it('closed mode blocks when AI is unavailable (provider error)', () => {
    const reason = evaluateFailClosedTimeouts({ guardFailMode: 'closed', aiUnavailable: true });
    expect(reason).toBe('AI check unavailable (provider error) — blocked by fail-closed mode');
  });

  it('open mode never blocks on AI unavailability', () => {
    expect(evaluateFailClosedTimeouts({ guardFailMode: 'open', aiUnavailable: true })).toBe('');
  });
});

describe('shouldSimulateDispatch', () => {
  it('simulates when dry run is on and trade is pending', () => {
    expect(shouldSimulateDispatch({ dryRunMode: true, blocked: false, status: 'PENDING' })).toBe(true);
  });

  it('does not simulate blocked trades', () => {
    expect(shouldSimulateDispatch({ dryRunMode: true, blocked: true, status: 'PENDING' })).toBe(false);
  });

  it('does not simulate when dry run is off', () => {
    expect(shouldSimulateDispatch({ dryRunMode: false, blocked: false, status: 'PENDING' })).toBe(false);
  });
});

describe('resolveMaxSpreadPips', () => {
  it('returns the cap when positive, 0 otherwise', () => {
    expect(resolveMaxSpreadPips({ maxSpreadPips: 2.5 })).toBe(2.5);
    expect(resolveMaxSpreadPips({ maxSpreadPips: 0 })).toBe(0);
    expect(resolveMaxSpreadPips({ maxSpreadPips: -3 })).toBe(0);
    expect(resolveMaxSpreadPips({})).toBe(0);
    expect(resolveMaxSpreadPips({ maxSpreadPips: 'abc' })).toBe(0);
  });
});

describe('validateTpLotShares / resolveTpLotShares', () => {
  it('accepts a valid share split matching the TP count', () => {
    expect(validateTpLotShares([50, 30, 20], 3)).toEqual([50, 30, 20]);
  });

  it('rejects count mismatch', () => {
    expect(validateTpLotShares([50, 50], 3)).toBeNull();
  });

  it('rejects sums far from 100', () => {
    expect(validateTpLotShares([10, 10, 10], 3)).toBeNull();
    expect(validateTpLotShares([80, 80, 80], 3)).toBeNull();
  });

  it('accepts slightly imprecise sums (90–110)', () => {
    expect(validateTpLotShares([33.3, 33.3, 33.3], 3)).toBeTruthy();
  });

  it('rejects non-numeric or non-positive shares', () => {
    expect(validateTpLotShares([50, 'x', 20], 3)).toBeNull();
    expect(validateTpLotShares([100, 0, 0], 3)).toBeNull();
    expect(validateTpLotShares('50,50', 2)).toBeNull();
  });

  it('rejects single-TP signals (no split needed)', () => {
    expect(validateTpLotShares([100], 1)).toBeNull();
  });

  it('resolveTpLotShares only fires in custom mode with valid shares', () => {
    const tp = [1.1, 1.2, 1.3];
    expect(resolveTpLotShares({ tpLotMode: 'custom', tpCustomShares: [50, 30, 20] }, tp)).toEqual([50, 30, 20]);
    expect(resolveTpLotShares({ tpLotMode: 'equal', tpCustomShares: [50, 30, 20] }, tp)).toBeNull();
    expect(resolveTpLotShares({ tpLotMode: 'custom', tpCustomShares: [50, 50] }, tp)).toBeNull();
    expect(resolveTpLotShares({ tpLotMode: 'custom', tpCustomShares: [100] }, [1.1])).toBeNull();
  });
});

describe('resolvePendingExpirySeconds', () => {
  it('converts hours to seconds when enabled', () => {
    expect(resolvePendingExpirySeconds({ enablePendingExpiry: true, pendingExpiry: 24 })).toBe(24 * 3600);
    expect(resolvePendingExpirySeconds({ enablePendingExpiry: true, pendingExpiry: 1.5 })).toBe(5400);
  });

  it('returns 0 when disabled or invalid', () => {
    expect(resolvePendingExpirySeconds({ enablePendingExpiry: false, pendingExpiry: 24 })).toBe(0);
    expect(resolvePendingExpirySeconds({ enablePendingExpiry: true, pendingExpiry: 0 })).toBe(0);
    expect(resolvePendingExpirySeconds({ enablePendingExpiry: true, pendingExpiry: 'x' })).toBe(0);
    expect(resolvePendingExpirySeconds({})).toBe(0);
  });
});

describe('detectCloseCommand', () => {
  const keywords = ['close', 'close all', 'exit'];

  it('matches a plain close command (case-insensitive)', () => {
    expect(detectCloseCommand('CLOSE ALL', keywords).matched).toBe(true);
    expect(detectCloseCommand('please exit now', keywords).matched).toBe(true);
    expect(detectCloseCommand('Close', keywords).matched).toBe(true);
  });

  it('extracts an optional symbol mention', () => {
    const out = detectCloseCommand('close EURUSD now', keywords);
    expect(out.matched).toBe(true);
    expect(out.symbol).toBe('EURUSD');
  });

  it('normalizes GOLD → XAUUSD', () => {
    expect(detectCloseCommand('close gold', keywords).symbol).toBe('XAUUSD');
  });

  it('returns null symbol when none mentioned', () => {
    expect(detectCloseCommand('close all positions', keywords).symbol).toBeNull();
  });

  it('does not fire on partial words like "Closed at TP"', () => {
    expect(detectCloseCommand('Closed at TP, +50 pips', keywords).matched).toBe(false);
    expect(detectCloseCommand('disclosure statement', keywords).matched).toBe(false);
  });

  it('no keywords configured → never matches', () => {
    expect(detectCloseCommand('close all', []).matched).toBe(false);
    expect(detectCloseCommand('close all', undefined).matched).toBe(false);
  });

  it('accepts a comma-separated keyword string', () => {
    expect(detectCloseCommand('exit now', 'close, exit').matched).toBe(true);
  });
});

describe('detectManagementCommand', () => {
  const opts = {
    partialCloseKeywords: ['close half', 'partials', 'secure'],
    breakEvenKeywords: ['be', 'breakeven', 'sl to entry'],
    defaultPartialPercent: 50
  };

  it('matches partial-close keywords with the default percent', () => {
    const out = detectManagementCommand('Partials here!', opts);
    expect(out.matched).toBe(true);
    expect(out.action).toBe('partial_close');
    expect(out.percent).toBe(50);
  });

  it('uses an explicit percent from the message', () => {
    const out = detectManagementCommand('secure 30% now', opts);
    expect(out.matched).toBe(true);
    expect(out.percent).toBe(30);
  });

  it('clamps out-of-range percents to the default/limits', () => {
    // "150%" does not match the 1-2 digit percent pattern → default applies.
    expect(detectManagementCommand('partials 150%', opts).percent).toBe(50);
    // 99% is capped at 95 so a partial never fully closes.
    expect(detectManagementCommand('partials 99%', opts).percent).toBe(95);
  });

  it('matches break-even keywords and prioritizes them over partial keywords', () => {
    const out = detectManagementCommand('close half and move to breakeven', opts);
    expect(out.matched).toBe(true);
    expect(out.action).toBe('break_even');
  });

  it('extracts a symbol scope', () => {
    const out = detectManagementCommand('partials on GOLD', opts);
    expect(out.symbol).toBe('XAUUSD');
  });

  it('does not fire on unrelated words (word-boundary match)', () => {
    expect(detectManagementCommand('been watching this pair', opts).matched).toBe(false);
    expect(detectManagementCommand('the best setup', opts).matched).toBe(false);
  });

  it('no keywords configured → never matches', () => {
    expect(detectManagementCommand('close half', {}).matched).toBe(false);
  });

  it('accepts comma-separated keyword strings', () => {
    const out = detectManagementCommand('BE now', { breakEvenKeywords: 'be, breakeven' });
    expect(out.matched).toBe(true);
    expect(out.action).toBe('break_even');
  });
});

describe('createPipelineStageRecorder', () => {
  it('records stage deltas with ISO timestamps', () => {
    const start = 1_700_000_000_000;
    const recorder = createPipelineStageRecorder(start);
    recorder.stamp('parse', 'BUY XAUUSD');
    recorder.stamp('schedule', 'Allowed');
    expect(recorder.stages).toHaveLength(2);
    expect(recorder.stages[0]).toMatchObject({ stage: 'parse', detail: 'BUY XAUUSD' });
    expect(recorder.stages[0].ms).toBeGreaterThanOrEqual(0);
    expect(recorder.stages[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(recorder.stages[1].stage).toBe('schedule');
  });
});

describe('appendPipelineStage', () => {
  it('appends a stage using delta from the previous stage at', () => {
    const trade = {
      pipelineStages: [{ stage: 'parse', ms: 5, at: '2026-06-09T10:00:00.000Z' }]
    };
    appendPipelineStage(trade, 'dispatch', 'DISPATCHED');
    expect(trade.pipelineStages).toHaveLength(2);
    expect(trade.pipelineStages[1].stage).toBe('dispatch');
    expect(trade.pipelineStages[1].detail).toBe('DISPATCHED');
  });
});

describe('formatPipelineStagesForDisplay', () => {
  it('maps telemetry into UI steps with durations', () => {
    const stages = [
      { stage: 'parse', ms: 12, at: '2026-06-09T10:00:00.000Z', detail: 'BUY EURUSD' },
      { stage: 'schedule', ms: 3, at: '2026-06-09T10:00:00.012Z', detail: 'Allowed' },
      { stage: 'dispatch', ms: 40, at: '2026-06-09T10:00:00.055Z', detail: 'DISPATCHED' }
    ];
    const steps = formatPipelineStagesForDisplay(stages, { status: 'DISPATCHED' });
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: 'parse', label: 'Parsed', state: 'done', detail: 'BUY EURUSD' });
    expect(steps[1].duration).toBe('3ms');
    expect(steps[2]).toMatchObject({ id: 'dispatch', label: 'Dispatch to MT5', state: 'done' });
  });

  it('marks blocked stages as failed', () => {
    const stages = [
      { stage: 'parse', ms: 1, at: '2026-06-09T10:00:00.000Z', detail: 'BUY EURUSD' },
      { stage: 'newsGuard', ms: 2000, at: '2026-06-09T10:00:02.000Z', detail: 'High-impact news window' }
    ];
    const steps = formatPipelineStagesForDisplay(stages, { status: 'BLOCKED_HIGH_NEWS' });
    expect(steps[1].state).toBe('failed');
  });

  it('returns empty array for missing telemetry', () => {
    expect(formatPipelineStagesForDisplay(null)).toEqual([]);
    expect(formatPipelineStagesForDisplay([])).toEqual([]);
  });
});

describe('formatPipelineDurationMs', () => {
  it('formats sub-second and second durations', () => {
    expect(formatPipelineDurationMs(450)).toBe('450ms');
    expect(formatPipelineDurationMs(1500)).toBe('1.5s');
  });
});
