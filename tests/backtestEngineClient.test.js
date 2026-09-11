import { describe, it, expect } from 'vitest';
import { createEngineState } from '../src/renderer/utils/backtestEngineClient.js';

describe('backtestEngineClient interop', () => {
  it('re-exports shared engine for renderer bundle path', () => {
    const state = createEngineState({ startingBalance: 5000, symbol: 'EURUSD', pipSize: 0.0001 });
    expect(state.balance).toBe(5000);
    expect(state.symbol).toBe('EURUSD');
  });
});
