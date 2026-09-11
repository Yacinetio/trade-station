const { parse } = require('./signalParser');
const { evaluateSignalSchedule } = require('./signalFilters');
const { evaluateAdvancedSignalBlock } = require('./signalBlockFilters');
const { evaluateExecutionGuards } = require('./executionGuards');

function debugParseTelegramMessage(text, settings = {}, channelName = 'Parser Debugger') {
  const raw = String(text || '').trim();
  if (!raw) {
    return { ok: false, error: 'Empty message' };
  }
  let parsed = null;
  let parseError = null;
  try {
    parsed = parse(raw, channelName, settings);
  } catch (e) {
    parseError = e?.message || String(e);
  }

  const schedule = evaluateSignalSchedule(settings, new Date());
  const advBlockRaw = parsed
    ? evaluateAdvancedSignalBlock(settings, parsed, new Date())
    : { blocked: true, reason: 'Parse failed' };
  const advBlock = {
    allowed: !advBlockRaw.blocked,
    reason: advBlockRaw.reason || '',
  };

  const execGuard = parsed
    ? evaluateExecutionGuards({
        settings,
        signal: parsed,
        trades: [],
        accountSnapshot: {},
        helpers: {},
        accountKey: '',
      })
    : { allowed: false, reason: 'Parse failed' };

  const wouldExecute = parsed && schedule.allowed && advBlock.allowed && execGuard.allowed;

  return {
    ok: !!parsed,
    parseError,
    parsed,
    schedule,
    advancedBlock: advBlock,
    executionGuard: execGuard,
    wouldExecute,
  };
}

module.exports = { debugParseTelegramMessage };
