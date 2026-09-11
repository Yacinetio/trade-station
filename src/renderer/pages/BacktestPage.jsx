import React, {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';
import {
  Play, Pause, SkipForward, SkipBack, CandlestickChart, Plus, Trash2, Archive, RefreshCw
} from 'lucide-react';
import BacktestChart from '../components/BacktestChart.jsx';
import { listIndicators } from '../utils/indicators/index.js';
import {
  createEngineState,
  restoreEngineState,
  serializeEngineState,
  placeOrder,
  advanceBar,
  closePosition,
  modifyPosition,
  cancelOrder,
  drainClosedTrades,
  floatingPnl
} from '../utils/backtestEngineClient.js';
import '../styles/backtest.css';

const SPEEDS = [0.5, 1, 2, 5, 10];
const SYMBOL_SUGGESTIONS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100', 'BTCUSD'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1'];
const SNAPSHOT_EVERY_BARS = 30;

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}$`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function isoFromBar(bar) {
  if (!bar?.time) return null;
  return new Date(bar.time * 1000).toISOString();
}

function EquitySparkline({ points = [], width = 200, height = 40 }) {
  const values = (points || [])
    .map((p) => Number(p?.equity ?? p?.balance))
    .filter((v) => Number.isFinite(v));
  if (values.length < 2) return <span className="backtest-muted">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * height}`)
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke={up ? 'var(--success)' : 'var(--danger)'} strokeWidth="1.8" points={coords} />
    </svg>
  );
}

export default function BacktestPage({ routeVisible = false }) {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [settings, setSettings] = useState(null);
  const [bars, setBars] = useState([]);
  const [barIdx, setBarIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [engine, setEngine] = useState(null);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [activeIndicators, setActiveIndicators] = useState(['ema20']);
  const indicatorOptions = useMemo(() => listIndicators(), []);

  const [form, setForm] = useState({
    name: '',
    symbol: 'EURUSD',
    dateFrom: '',
    dateTo: '',
    timeframe: 'M1',
    startingBalance: 100000,
    spreadPips: 1,
    strategyId: ''
  });

  const [orderForm, setOrderForm] = useState({
    side: 'BUY',
    kind: 'market',
    lots: '',
    riskPct: '1',
    price: '',
    slPips: '20',
    tpR: '2',
    autoBreakevenAtR: '',
    note: ''
  });

  const playTimerRef = useRef(null);
  const barsSinceSnapshotRef = useRef(0);
  const engineRef = useRef(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await window.electronAPI?.listBacktestSessions?.({ includeArchived: true });
      setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
    } catch {
      setSessions([]);
    }
  }, []);

  const refreshStats = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await window.electronAPI?.getBacktestSessionStats?.(sessionId);
      if (res?.success) setStats(res.stats);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    if (!routeVisible) return;
    loadSessions();
    window.electronAPI?.getSettings?.().then((s) => {
      setSettings(s || null);
      const bt = s?.backtest || {};
      setForm((f) => ({
        ...f,
        startingBalance: bt.defaultBalance ?? f.startingBalance,
        spreadPips: bt.defaultSpreadPips ?? f.spreadPips
      }));
    }).catch(() => {});
    window.electronAPI?.listStrategies?.().then((r) => {
      setStrategies(Array.isArray(r?.strategies) ? r.strategies.filter((x) => !x.archived) : []);
    }).catch(() => {});
  }, [routeVisible, loadSessions]);

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  const currentBar = bars[barIdx - 1] || null;

  const persistSnapshot = useCallback(async (session, eng, cursorIso, noteText) => {
    if (!session?.id || !eng) return;
    try {
      await window.electronAPI?.saveBacktestSnapshot?.({
        sessionId: session.id,
        cursorIso,
        engineSnapshot: serializeEngineState(eng),
        notes: noteText ?? notes
      });
    } catch {
      /* best effort */
    }
  }, [notes]);

  const flushClosedTrades = useCallback(async (sessionId, eng) => {
    const closed = drainClosedTrades(eng);
    if (!closed.length || !sessionId) return;
    try {
      await window.electronAPI?.recordBacktestTrades?.({ sessionId, closedTrades: closed });
      await refreshStats(sessionId);
    } catch {
      /* logged on next attempt */
    }
  }, [refreshStats]);

  const stepBar = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng || barIdx >= bars.length) return false;
    const bar = bars[barIdx];
    advanceBar(eng, bar);
    setEngine({ ...eng });
    setBarIdx((i) => i + 1);
    barsSinceSnapshotRef.current += 1;

    const session = activeSession;
    if (session) {
      await flushClosedTrades(session.id, eng);
      if (barsSinceSnapshotRef.current >= SNAPSHOT_EVERY_BARS) {
        barsSinceSnapshotRef.current = 0;
        await persistSnapshot(session, eng, isoFromBar(bar), notes);
      }
    }
    return barIdx + 1 < bars.length;
  }, [barIdx, bars, activeSession, flushClosedTrades, persistSnapshot, notes]);

  useEffect(() => {
    if (!playing || !routeVisible) return undefined;
    const ms = Math.max(50, 500 / speed);
    playTimerRef.current = setInterval(async () => {
      const hasMore = await stepBar();
      if (!hasMore) setPlaying(false);
    }, ms);
    return () => clearInterval(playTimerRef.current);
  }, [playing, speed, stepBar, routeVisible]);

  useEffect(() => {
    if (!routeVisible && activeSession && engine) {
      persistSnapshot(activeSession, engine, currentBar ? isoFromBar(currentBar) : activeSession.cursorIso, notes);
      setPlaying(false);
    }
  }, [routeVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const resumeSession = useCallback(async (session) => {
    setBusy(true);
    setError('');
    try {
      const res = await window.electronAPI?.getBacktestBars?.({
        sessionId: session.id,
        fromIso: session.dateFrom,
        toIso: session.dateTo
      });
      if (!res?.success || !Array.isArray(res.bars) || !res.bars.length) {
        setError(res?.error || 'Could not load bars for session.');
        return;
      }
      const loadedBars = res.bars;
      setBars(loadedBars);
      const eng = session.engineSnapshot
        ? restoreEngineState(session.engineSnapshot)
        : createEngineState({
          startingBalance: session.startingBalance,
          spreadPips: session.spreadPips,
          pipSize: session.pipSize,
          symbol: session.symbol
        });
      setEngine(eng);
      engineRef.current = eng;

      let idx = 0;
      const lastT = session.engineSnapshot?.lastBar?.time;
      if (lastT != null) {
        const li = loadedBars.findIndex((b) => b.time === lastT);
        idx = li >= 0 ? li + 1 : 0;
      } else if (session.cursorIso) {
        const target = Math.floor(new Date(session.cursorIso).getTime() / 1000);
        const found = loadedBars.findIndex((b) => b.time >= target);
        if (found >= 0) idx = found;
      }
      setBarIdx(idx);
      setActiveSession(session);
      setNotes(session.notes || '');
      barsSinceSnapshotRef.current = 0;
      await refreshStats(session.id);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshStats]);

  const createSession = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await window.electronAPI?.createBacktestSession?.({
        ...form,
        strategyId: form.strategyId || null
      });
      if (!res?.success) {
        setError(res?.error || 'Failed to create session.');
        return;
      }
      await loadSessions();
      setBars(res.bars || []);
      const eng = res.session.engineSnapshot
        ? restoreEngineState(res.session.engineSnapshot)
        : createEngineState({
          startingBalance: res.session.startingBalance,
          spreadPips: res.session.spreadPips,
          pipSize: res.session.pipSize,
          symbol: res.session.symbol
        });
      setEngine(eng);
      engineRef.current = eng;
      setBarIdx(0);
      setActiveSession(res.session);
      setNotes('');
      barsSinceSnapshotRef.current = 0;
      await refreshStats(res.session.id);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSession = async (session, deleteTrades = true) => {
    if (!window.confirm(`Delete session "${session.name}"?`)) return;
    await window.electronAPI?.deleteBacktestSession?.({ sessionId: session.id, deleteTrades });
    if (activeSession?.id === session.id) {
      setActiveSession(null);
      setEngine(null);
      setBars([]);
      setBarIdx(0);
    }
    await loadSessions();
  };

  const handleArchive = async (session) => {
    await window.electronAPI?.saveBacktestSnapshot?.({
      sessionId: session.id,
      notes: session.notes,
      engineSnapshot: session.engineSnapshot,
      cursorIso: session.cursorIso,
      status: 'archived'
    });
    await loadSessions();
  };

  const jumpToDate = (iso) => {
    if (!iso || !bars.length) return;
    const target = Math.floor(new Date(iso).getTime() / 1000);
    const idx = bars.findIndex((b) => b.time >= target);
    if (idx >= 0 && idx < barIdx) setBarIdx(idx + 1);
  };

  const handlePlaceOrder = () => {
    const eng = engineRef.current;
    if (!eng || !currentBar) {
      setError('Advance to at least one bar before placing orders.');
      return;
    }
    const spec = {
      kind: orderForm.kind,
      side: orderForm.side,
      price: orderForm.kind === 'market' ? currentBar.close : Number(orderForm.price),
      lots: orderForm.lots ? Number(orderForm.lots) : undefined,
      riskPct: orderForm.lots ? undefined : Number(orderForm.riskPct),
      slPips: Number(orderForm.slPips),
      tpR: Number(orderForm.tpR),
      autoBreakevenAtR: orderForm.autoBreakevenAtR ? Number(orderForm.autoBreakevenAtR) : undefined,
      note: orderForm.note
    };
    const res = placeOrder(eng, spec);
    if (!res.ok) {
      setError(res.error || 'Order rejected.');
      return;
    }
    setEngine({ ...eng });
    setError('');
  };

  const handlePartialClose = (posId, fraction) => {
    const eng = engineRef.current;
    if (!eng) return;
    closePosition(eng, posId, { fraction, atPrice: currentBar?.close });
    setEngine({ ...eng });
    flushClosedTrades(activeSession?.id, eng);
  };

  const handleBreakeven = (posId) => {
    const eng = engineRef.current;
    if (!eng) return;
    const pos = eng.positions.find((p) => p.id === posId);
    if (!pos) return;
    modifyPosition(eng, posId, { slPrice: pos.entryPrice });
    pos.beTriggered = true;
    setEngine({ ...eng });
  };

  const openFloating = currentBar && engine ? floatingPnl(engine, currentBar) : 0;
  const slLines = engine?.positions?.map((p) => p.slPrice).filter(Number.isFinite) || [];
  const tpLines = engine?.positions?.map((p) => p.tpPrice).filter(Number.isFinite) || [];

  const toggleIndicator = (id) => {
    setActiveIndicators((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const pauseAndSnapshot = async () => {
    setPlaying(false);
    if (activeSession && engine) {
      await flushClosedTrades(activeSession.id, engine);
      await persistSnapshot(activeSession, engine, currentBar ? isoFromBar(currentBar) : activeSession.cursorIso, notes);
    }
  };

  if (!routeVisible) return null;

  return (
    <div className="backtest-page">
      <header className="backtest-header">
        <div className="backtest-title-row">
          <CandlestickChart size={22} aria-hidden="true" />
          <h1>Backtest</h1>
        </div>
        <p className="backtest-subtitle">Bar-replay sessions with risk-based sizing — journaled under bt:&lt;session&gt; accounts.</p>
      </header>

      {error && <div className="backtest-error" role="alert">{error}</div>}

      <div className="backtest-layout">
        <aside className="backtest-sidebar">
          <section className="backtest-panel">
            <h2>Sessions</h2>
            <button type="button" className="backtest-btn ghost" onClick={loadSessions} disabled={busy}>
              <RefreshCw size={14} /> Refresh
            </button>
            <ul className="backtest-session-list">
              {sessions.map((s) => (
                <li key={s.id} className={activeSession?.id === s.id ? 'active' : ''}>
                  <button type="button" className="backtest-session-btn" onClick={() => resumeSession(s)}>
                    <strong>{s.name}</strong>
                    <span>{s.symbol} · {s.timeframe} · {s.dateFrom} → {s.dateTo}</span>
                    <span className="backtest-muted">{s.status}</span>
                  </button>
                  <div className="backtest-session-actions">
                    <button type="button" title="Archive" onClick={() => handleArchive(s)}><Archive size={14} /></button>
                    <button type="button" title="Delete" onClick={() => handleDeleteSession(s)}><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="backtest-panel">
            <h2><Plus size={16} /> New session</h2>
            <form className="backtest-form" onSubmit={createSession}>
              <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="London breakout test" /></label>
              <label>
                Symbol
                <input list="bt-symbols" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} required />
                <datalist id="bt-symbols">{SYMBOL_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              <label>From<input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} required /></label>
              <label>To<input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} required /></label>
              <label>
                Timeframe
                <select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })}>
                  {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </label>
              <label>Starting balance<input type="number" value={form.startingBalance} onChange={(e) => setForm({ ...form, startingBalance: Number(e.target.value) })} /></label>
              <label>Spread (pips)<input type="number" step="0.1" value={form.spreadPips} onChange={(e) => setForm({ ...form, spreadPips: Number(e.target.value) })} /></label>
              <label>
                Strategy
                <select value={form.strategyId} onChange={(e) => setForm({ ...form, strategyId: e.target.value })}>
                  <option value="">— none —</option>
                  {strategies.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </label>
              <button type="submit" className="backtest-btn primary" disabled={busy}>Create &amp; load</button>
            </form>
          </section>
        </aside>

        <main className="backtest-main">
          {!activeSession ? (
            <div className="backtest-empty">Select or create a session to start bar replay.</div>
          ) : (
            <>
              <div className="backtest-stats-row">
                <div><span className="backtest-stat-label">Balance</span><strong>{fmtMoney(engine?.balance)}</strong></div>
                <div><span className="backtest-stat-label">Open P&amp;L</span><strong>{fmtMoney(openFloating)}</strong></div>
                <div><span className="backtest-stat-label">Closed</span><strong>{stats?.closedCount ?? 0}</strong></div>
                <div><span className="backtest-stat-label">Win rate</span><strong>{fmtPct(stats?.winRate)}</strong></div>
                <div className="backtest-equity-spark"><EquitySparkline points={engine?.equityCurve?.length ? engine.equityCurve : stats?.equityCurve} /></div>
              </div>

              <div className="backtest-transport">
                <button type="button" onClick={() => setBarIdx((i) => Math.max(1, i - 1))} title="Step back"><SkipBack size={16} /></button>
                <button type="button" onClick={() => (playing ? pauseAndSnapshot() : setPlaying(true))} title={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button type="button" onClick={() => stepBar()} title="Step forward"><SkipForward size={16} /></button>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
                <span className="backtest-bar-counter">{barIdx} / {bars.length}</span>
                <label className="backtest-jump">
                  Go to
                  <input type="datetime-local" onChange={(e) => jumpToDate(new Date(e.target.value).toISOString())} />
                </label>
              </div>

              <div className="backtest-indicators">
                {indicatorOptions.map((ind) => (
                  <label key={ind.id} className="backtest-chip">
                    <input type="checkbox" checked={activeIndicators.includes(ind.id)} onChange={() => toggleIndicator(ind.id)} />
                    {ind.label}
                  </label>
                ))}
              </div>

              <BacktestChart
                bars={bars}
                visibleCount={barIdx}
                activeIndicators={activeIndicators}
                slLines={slLines}
                tpLines={tpLines}
              />

              <div className="backtest-bottom-grid">
                <section className="backtest-panel">
                  <h2>Order</h2>
                  <div className="backtest-order-form">
                    <div className="backtest-toggle-row">
                      <button type="button" className={orderForm.side === 'BUY' ? 'active buy' : ''} onClick={() => setOrderForm({ ...orderForm, side: 'BUY' })}>Buy</button>
                      <button type="button" className={orderForm.side === 'SELL' ? 'active sell' : ''} onClick={() => setOrderForm({ ...orderForm, side: 'SELL' })}>Sell</button>
                    </div>
                    <label>
                      Type
                      <select value={orderForm.kind} onChange={(e) => setOrderForm({ ...orderForm, kind: e.target.value })}>
                        <option value="market">Market</option>
                        <option value="limit">Limit</option>
                        <option value="stop">Stop</option>
                      </select>
                    </label>
                    {orderForm.kind !== 'market' && (
                      <label>Price<input type="number" step="0.00001" value={orderForm.price} onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })} /></label>
                    )}
                    <label>Lots (optional)<input type="number" step="0.01" value={orderForm.lots} onChange={(e) => setOrderForm({ ...orderForm, lots: e.target.value })} placeholder="auto risk %" /></label>
                    {!orderForm.lots && (
                      <label>Risk %<input type="number" step="0.1" value={orderForm.riskPct} onChange={(e) => setOrderForm({ ...orderForm, riskPct: e.target.value })} /></label>
                    )}
                    <label>SL (pips)<input type="number" value={orderForm.slPips} onChange={(e) => setOrderForm({ ...orderForm, slPips: e.target.value })} /></label>
                    <label>TP (R)<input type="number" step="0.1" value={orderForm.tpR} onChange={(e) => setOrderForm({ ...orderForm, tpR: e.target.value })} /></label>
                    <label>Auto BE at R<input type="number" step="0.1" value={orderForm.autoBreakevenAtR} onChange={(e) => setOrderForm({ ...orderForm, autoBreakevenAtR: e.target.value })} placeholder="optional" /></label>
                    <button type="button" className="backtest-btn primary" onClick={handlePlaceOrder}>Place order</button>
                  </div>
                </section>

                <section className="backtest-panel">
                  <h2>Open positions</h2>
                  {!engine?.positions?.length ? <p className="backtest-muted">No open positions</p> : (
                    <ul className="backtest-positions">
                      {engine.positions.map((p) => {
                        const fl = currentBar ? floatingPnl({ ...engine, positions: [p] }, currentBar) : 0;
                        return (
                          <li key={p.id}>
                            <div><strong>{p.side}</strong> {p.remainingLots} @ {p.entryPrice?.toFixed?.(5)} · {fmtMoney(fl)}</div>
                            <div className="backtest-pos-actions">
                              {[0.25, 0.5, 0.75, 1].map((f) => (
                                <button key={f} type="button" onClick={() => handlePartialClose(p.id, f)}>{Math.round(f * 100)}%</button>
                              ))}
                              <button type="button" onClick={() => handleBreakeven(p.id)}>BE</button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <h3>Pending orders</h3>
                  {!engine?.pendingOrders?.length ? <p className="backtest-muted">None</p> : (
                    <ul className="backtest-orders">
                      {engine.pendingOrders.map((o) => (
                        <li key={o.id}>
                          {o.kind} {o.side} @ {o.price} · {o.lots} lots
                          <button type="button" onClick={() => { cancelOrder(engine, o.id); setEngine({ ...engine }); }}>Cancel</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="backtest-panel">
                  <h2>Session notes</h2>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => activeSession && persistSnapshot(activeSession, engine, currentBar ? isoFromBar(currentBar) : activeSession.cursorIso, notes)}
                    rows={6}
                    placeholder="Observations, rule tweaks, what to test next…"
                  />
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
