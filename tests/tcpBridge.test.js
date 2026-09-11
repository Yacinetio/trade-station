import { describe, expect, it, afterEach } from 'vitest';
import net from 'net';

const tcpBridge = require('../src/main/tcpBridge');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await sleep(10);
  }
}

/** Start the bridge on an ephemeral port (never 9999 in tests) and wait for listen. */
function startBridge(options = {}, events = []) {
  return new Promise((resolve) => {
    tcpBridge.start((event, data) => {
      events.push({ event, data });
      if (event === 'tcp:port') resolve(data);
    }, { port: 0, ...options });
  });
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => resolve(socket));
    socket.on('error', reject);
  });
}

describe('tcpBridge', () => {
  let client = null;

  afterEach(() => {
    if (client) {
      try { client.destroy(); } catch {}
      client = null;
    }
    tcpBridge.stop();
  });

  it('binds to 127.0.0.1 by default', async () => {
    const info = await startBridge();
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBeGreaterThan(0);

    const status = tcpBridge.getStatus();
    expect(status.bindHost).toBe('127.0.0.1');
    expect(status.port).toBe(info.port);

    // Loopback connections must still work.
    client = await connectClient(info.port);
    expect(client.remotePort).toBe(info.port);
  });

  it('honors an explicit bindHost option', async () => {
    const info = await startBridge({ bindHost: '0.0.0.0' });
    expect(info.host).toBe('0.0.0.0');
    expect(tcpBridge.getStatus().bindHost).toBe('0.0.0.0');
  });

  it('drops queued signals older than queueTtlMs with QUEUE_EXPIRED on flush', async () => {
    const info = await startBridge({ queueTtlMs: 50 });

    const statuses = [];
    tcpBridge.sendSignal(
      { type: 'BUY', symbol: 'EURUSD', tradeId: 'stale-1' },
      (ack) => statuses.push(ack.status)
    );
    expect(statuses).toEqual(['NO_MT5_QUEUED']);
    expect(tcpBridge.getStatus().queuedSignals).toBe(1);

    await sleep(120); // let the queued signal exceed its TTL

    let received = '';
    client = await connectClient(info.port); // connection triggers the queue flush
    client.on('data', (d) => { received += d.toString(); });

    await waitFor(() => statuses.includes('QUEUE_EXPIRED'));
    const status = tcpBridge.getStatus();
    expect(status.queuedSignals).toBe(0);
    expect(status.droppedSignalCount).toBe(1);
    expect(status.droppedSignals[0].reason).toBe('QUEUE_EXPIRED');
    expect(status.droppedSignals[0].tradeId).toBe('stale-1');

    // The stale signal must never reach the EA.
    await sleep(100);
    expect(received).not.toContain('"SIGNAL"');
  });

  it('flushes fresh queued signals to a connecting EA', async () => {
    const info = await startBridge(); // default TTL (120s) — signal stays fresh

    const statuses = [];
    tcpBridge.sendSignal(
      { type: 'SELL', symbol: 'XAUUSD', tradeId: 'fresh-1' },
      (ack) => statuses.push(ack.status)
    );
    expect(statuses).toEqual(['NO_MT5_QUEUED']);

    let received = '';
    client = await connectClient(info.port);
    client.on('data', (d) => { received += d.toString(); });

    await waitFor(() => statuses.includes('DISPATCHED'));
    await waitFor(() => received.includes('"SIGNAL"'));
    expect(received).toContain('fresh-1');
    expect(tcpBridge.getStatus().queuedSignals).toBe(0);
    expect(tcpBridge.getStatus().droppedSignalCount).toBe(0);
  });

  it('caps the offline queue at 50 and evicts the oldest with QUEUE_OVERFLOW', async () => {
    await startBridge(); // no EA connected — every signal queues

    const acksById = new Map();
    for (let i = 0; i < 55; i += 1) {
      const id = `q-${i}`;
      acksById.set(id, []);
      tcpBridge.sendSignal(
        { type: 'BUY', symbol: 'EURUSD', tradeId: id },
        (ack) => acksById.get(id).push(ack.status)
      );
    }

    const status = tcpBridge.getStatus();
    expect(status.queuedSignals).toBe(50);
    expect(status.droppedSignalCount).toBe(5);

    // The 5 oldest were evicted with QUEUE_OVERFLOW…
    for (let i = 0; i < 5; i += 1) {
      expect(acksById.get(`q-${i}`)).toContain('QUEUE_OVERFLOW');
    }
    // …while newer ones remain queued only.
    expect(acksById.get('q-54')).toEqual(['NO_MT5_QUEUED']);
  });

  it('respects a custom maxQueue option', async () => {
    await startBridge({ maxQueue: 3 });
    for (let i = 0; i < 5; i += 1) {
      tcpBridge.sendSignal({ type: 'BUY', symbol: 'EURUSD', tradeId: `m-${i}` }, () => {});
    }
    const status = tcpBridge.getStatus();
    expect(status.queuedSignals).toBe(3);
    expect(status.droppedSignalCount).toBe(2);
    expect(status.droppedSignals.every((d) => d.reason === 'QUEUE_OVERFLOW')).toBe(true);
  });

  it('emits signal:dropped events for expired queue entries', async () => {
    const events = [];
    const info = await startBridge({ queueTtlMs: 40 }, events);

    tcpBridge.sendSignal({ type: 'BUY', symbol: 'GBPUSD', tradeId: 'ev-1' }, () => {});
    await sleep(90);
    client = await connectClient(info.port);

    await waitFor(() => events.some((e) => e.event === 'signal:dropped'));
    const dropped = events.find((e) => e.event === 'signal:dropped');
    expect(dropped.data.reason).toBe('QUEUE_EXPIRED');
    expect(dropped.data.signal.tradeId).toBe('ev-1');
  });

  it('rejects clients that skip HELLO when a shared secret is configured', async () => {
    const events = [];
    const info = await startBridge({ sharedSecret: 's3cret' }, events);
    expect(tcpBridge.getStatus().authRequired).toBe(true);

    client = await connectClient(info.port);
    let received = '';
    let closed = false;
    client.on('data', (d) => { received += d.toString(); });
    client.on('close', () => { closed = true; });

    // Non-HELLO message from an unauthenticated client must be rejected.
    client.write(JSON.stringify({ type: 'ACK', status: 'EXECUTED', tradeId: 'spoof-1' }) + '\n');
    await waitFor(() => closed);

    expect(received).toContain('AUTH_FAILED');
    expect(tcpBridge.getStatus().connected).toBe(false);
    expect(tcpBridge.getStatus().authFailureCount).toBe(1);
    expect(events.some((e) => e.event === 'bridge:authFailed' && e.data.reason === 'NO_HELLO')).toBe(true);
    // The spoofed ACK must never reach the app pipeline.
    expect(events.some((e) => e.event === 'trade:ack')).toBe(false);
  });

  it('rejects HELLO with a wrong secret', async () => {
    const events = [];
    const info = await startBridge({ sharedSecret: 's3cret' }, events);

    client = await connectClient(info.port);
    let received = '';
    let closed = false;
    client.on('data', (d) => { received += d.toString(); });
    client.on('close', () => { closed = true; });
    client.write(JSON.stringify({ type: 'HELLO', ea: 'FakeEA', secret: 'wrong' }) + '\n');
    await waitFor(() => closed);
    expect(received).toContain('AUTH_FAILED');

    expect(events.some((e) => e.event === 'bridge:authFailed' && e.data.reason === 'BAD_SECRET')).toBe(true);
    expect(tcpBridge.getStatus().connected).toBe(false);
  });

  it('accepts HELLO with the correct secret and only then flushes queued signals', async () => {
    const info = await startBridge({ sharedSecret: 's3cret' });

    const statuses = [];
    tcpBridge.sendSignal({ type: 'BUY', symbol: 'EURUSD', tradeId: 'auth-1' }, (ack) => statuses.push(ack.status));
    expect(statuses).toEqual(['NO_MT5_QUEUED']);

    client = await connectClient(info.port);
    let received = '';
    client.on('data', (d) => { received += d.toString(); });

    // Not connected/flushed before authentication.
    await sleep(60);
    expect(tcpBridge.getStatus().connected).toBe(false);
    expect(received).not.toContain('"SIGNAL"');

    client.write(JSON.stringify({ type: 'HELLO', ea: 'TestEA', version: '1.3', secret: 's3cret' }) + '\n');
    await waitFor(() => received.includes('HELLO_ACK'));
    expect(received).toContain('"status":"OK"');
    await waitFor(() => received.includes('"SIGNAL"'));
    expect(received).toContain('auth-1');
    expect(tcpBridge.getStatus().connected).toBe(true);
  });

  it('keeps legacy no-auth behavior when no secret is configured', async () => {
    const info = await startBridge();
    client = await connectClient(info.port);
    await waitFor(() => tcpBridge.getStatus().connected === true);
    expect(tcpBridge.getStatus().authRequired).toBe(false);
  });

  it('requestMt5Spread resolves live spread from EA SPREAD_REPLY', async () => {
    const info = await startBridge();
    client = await connectClient(info.port);

    const chunks = [];
    client.on('data', (buf) => chunks.push(String(buf)));

    client.write(JSON.stringify({ type: 'HELLO', ea: 'TestEA', version: '1' }) + '\n');
    await sleep(50);

    const reqPromise = tcpBridge.requestMt5Spread({ symbol: 'EURUSD' }, 2000);
    await waitFor(() => chunks.join('').includes('SPREAD_REQUEST'));

    const line = chunks.join('').split('\n').find((l) => l.includes('SPREAD_REQUEST'));
    const msg = JSON.parse(line);
    client.write(JSON.stringify({
      type: 'SPREAD_REPLY',
      success: true,
      reqId: msg.reqId,
      symbol: 'EURUSD',
      spreadPips: 1.8,
      usdPerPipPerLot: 10,
      ask: 1.1002,
      bid: 1.1
    }) + '\n');

    const result = await reqPromise;
    expect(result.success).toBe(true);
    expect(result.spreadPips).toBeCloseTo(1.8);
    expect(result.usdPerPipPerLot).toBeCloseTo(10);
    expect(result.symbol).toBe('EURUSD');
  });
});
