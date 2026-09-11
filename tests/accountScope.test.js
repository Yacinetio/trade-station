import { it as test } from 'vitest';
const assert = require('node:assert/strict');

test('isManualEntryTrade detects Manual channel rows', async () => {
  const { isManualEntryTrade, tradeMatchesAccountScope } = await import('../src/renderer/utils/accountScope.js');
  assert.equal(isManualEntryTrade({ channel: 'Manual', accountKey: 'manual' }), true);
  assert.equal(isManualEntryTrade({ channel: 'My Telegram', accountKey: '123@Broker' }), false);

  const manual = { channel: 'Manual', accountKey: 'manual', symbol: 'EURUSD' };
  const live = { channel: 'Signals', accountKey: '123@Broker', symbol: 'GBPJPY' };
  assert.equal(tradeMatchesAccountScope(manual, ['123@Broker']), true);
  assert.equal(tradeMatchesAccountScope(live, ['123@Broker']), true);
  assert.equal(tradeMatchesAccountScope(live, ['999@Other']), false);

  const edited = { accountKey: 'orphan@broker', userEdited: true };
  assert.equal(tradeMatchesAccountScope(edited, ['123@Broker']), true);
});
