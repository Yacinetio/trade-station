import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PlayCircle, Play, Pause, SkipBack, SkipForward,
  CornerDownRight, Flag, Camera, Search, RefreshCw
} from 'lucide-react';
import ReplayChartCanvas from '../components/ReplayChartCanvas.jsx';
import { useToast, ToastContainer } from '../hooks/useToast.jsx';
import '../styles/replay.css';

const SPEEDS = [1, 2, 5, 10, 30];
const BAR_TICK_MS = 350; // per bar at 1×
const EVENT_TICK_MS = 1100; // per day-event at 1×

function isClosedStatus(status) {
  const s = String(status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT')
    || s.includes('STOP_LOSS') || s.includes('TAKE_PROFIT');
}

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}$`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return '—'; }
}

function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '—';
  try {
    return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function utcDateKey(iso) {
  const ms = new Date(iso || '').getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Linear interpolation over [[unixSec, pnl], ...] (clamped at the edges). */
function interpolateSeries(series, tSec) {
  if (!Array.isArray(series) || series.length === 0) return null;
  if (tSec <= series[0][0]) return series[0][1];
  const last = series[series.length - 1];
  if (tSec >= last[0]) return last[1];
  for (let i = 1; i < series.length; i++) {
    const [t1, v1] = series[i];
    if (tSec > t1) continue;
    const [t0, v0] = series[i - 1];
    if (t1 === t0) return v1;
    return v0 + ((tSec - t0) / (t1 - t0)) * (v1 - v0);
  }
  return last[1];
}

/** Running P&L at the playhead: recorded excursion series first, else pip-math estimate. */
function runningPnlAt(bundle, trade, barIdx) {
  if (!bundle || barIdx < 1) return null;
  const bar = bundle.bars[barIdx - 1];
  if (!bar) return null;
  const t = bar.time;
  if (bundle.entrySec != null && t < bundle.entrySec) {
    return { label: 'Before entry', money: null, estimated: false };
  }
  if (bundle.closed && bundle.exitSec != null && t >= bundle.exitSec) {
    const realized = Number(trade?.profit);
    return {
      label: 'Realized',
      money: Number.isFinite(realized) ? realized : null,
      estimated: false
    };
  }
  if (Array.isArray(bundle.excursionSeries) && bundle.excursionSeries.length > 0) {
    const v = interpolateSeries(bundle.excursionSeries, t);
    return { label: 'Running P&L', money: v, estimated: false };
  }
  const m = bundle.pnlModel;
  if (m && m.pipSize > 0) {
    const pips = (m.direction === -1 ? m.entry - bar.close : bar.close - m.entry) / m.pipSize;
    if (m.moneyPerPip > 0) {
      return { label: 'Running P&L (est.)', money: pips * m.moneyPerPip, estimated: true };
    }
    return { label: 'Running pips (est.)', money: null, pips, estimated: true };
  }
  return null;
}

function DayPnlRibbon({ points = [], width = 320, height = 46 }) {
  if (!points.length) {
    return <div className="replay-ribbon-empty">No closed P&L yet</div>;
  }
  const values = points.map((p) => p[1]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const xs = points.map((p, i) => (points.length <= 1 ? width / 2 : (i / (points.length - 1)) * width));
  const y = (v) => height - ((v - min) / span) * height;
  const coords = points.map((p, i) => `${xs[i].toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const final = values[values.length - 1];
  const color = final >= 0 ? 'var(--success)' : 'var(--danger)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="replay-ribbon-svg">
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="3 3" />
      <polyline fill="none" stroke={color} strokeWidth="1.8" points={coords} />
      <circle cx={xs[xs.length - 1]} cy={y(final)} r="3" fill={color} />
    </svg>
  );
}

export default function ReplayPage({ routeVisible = false }) {
  const { toasts, push: pushToast } = useToast();

  const [mode, setMode] = useState('trade');
  const [trades, setTrades] = useState([]);
  const [tradesLoaded, setTradesLoaded] = useState(false);
  const [settings, setSettings] = useState(null);
  const [search, setSearch] = useState('');

  // Trade replay
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [barSource, setBarSource] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [tradeLoading, setTradeLoading] = useState(false);
  const [barIdx, setBarIdx] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);

  // Day replay
  const [dateKey, setDateKey] = useState('');
  const [accountKey, setAccountKey] = useState('');
  const [dayData, setDayData] = useState(null);
  const [dayWarnings, setDayWarnings] = useState([]);
  const [dayError, setDayError] = useState('');
  const [dayLoading, setDayLoading] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [dayPlaying, setDayPlaying] = useState(false);

  // Journal dock
  const [draftTags, setDraftTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [savingJournal, setSavingJournal] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  const chartApiRef = useRef(null);

  const loadTrades = useCallback(async () => {
    try {
      const list = await window.electronAPI?.getTrades?.();
      setTrades(Array.isArray(list) ? list : []);
    } catch {
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    if (!routeVisible || tradesLoaded) return;
    setTradesLoaded(true);
    loadTrades();
    window.electronAPI?.getSettings?.().then((s) => setSettings(s || null)).catch(() => {});
  }, [routeVisible, tradesLoaded, loadTrades]);

  const closedTrades = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trades
      .filter((t) => t && isClosedStatus(t.status))
      .filter((t) => {
        if (!q) return true;
        return [t.symbol, t.type, t.channel, t.id]
          .some((v) => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0));
  }, [trades, search]);

  const accountOptions = useMemo(
    () => [...new Set(trades.map((t) => String(t?.accountKey || '')).filter(Boolean))],
    [trades]
  );

  const latestTradeDay = useMemo(() => {
    let best = null;
    for (const t of trades) {
      const k = utcDateKey(t?.closedAt) || utcDateKey(t?.openedAt);
      if (k && (!best || k > best)) best = k;
    }
    return best;
  }, [trades]);

  useEffect(() => {
    if (!dateKey && latestTradeDay) setDateKey(latestTradeDay);
  }, [latestTradeDay, dateKey]);

  // ─── Trade replay loading + playback ───────────────────────────────────────

  const selectTrade = useCallback(async (trade) => {
    if (!trade) return;
    setSelectedTrade(trade);
    setDraftTags(Array.isArray(trade.journal?.tags) ? trade.journal.tags : []);
    setNoteInput('');
    setBundle(null);
    setBarSource('');
    setTradeError('');
    setPlaying(false);
    setBarIdx(1);
    setTradeLoading(true);
    try {
      const res = await window.electronAPI?.getTradeReplayBundle?.(trade.id);
      if (res?.success && res.bundle) {
        setBundle(res.bundle);
        setBarSource(res.source || '');
      } else {
        setTradeError(res?.error || 'Could not load bars for this trade.');
      }
    } catch (e) {
      setTradeError(e?.message || String(e));
    } finally {
      setTradeLoading(false);
    }
  }, []);

  const totalBars = bundle?.bars?.length || 0;

  useEffect(() => {
    if (!playing || totalBars === 0) return undefined;
    const timer = setInterval(() => {
      setBarIdx((i) => Math.min(totalBars, i + 1));
    }, Math.max(15, Math.round(BAR_TICK_MS / speed)));
    return () => clearInterval(timer);
  }, [playing, speed, totalBars]);

  useEffect(() => {
    if (playing && totalBars > 0 && barIdx >= totalBars) setPlaying(false);
  }, [playing, barIdx, totalBars]);

  const entryBarIdx = useMemo(() => {
    if (!bundle || bundle.entrySec == null) return 1;
    const i = bundle.bars.findIndex((b) => b.time >= bundle.entrySec);
    return i >= 0 ? i + 1 : 1;
  }, [bundle]);

  const exitBarIdx = useMemo(() => {
    if (!bundle) return 1;
    if (bundle.exitSec == null) return bundle.bars.length;
    const i = bundle.bars.findIndex((b) => b.time >= bundle.exitSec);
    return i >= 0 ? i + 1 : bundle.bars.length;
  }, [bundle]);

  const direction = String(selectedTrade?.type || '').toUpperCase().startsWith('SELL') ? -1 : 1;
  const playhead = bundle?.bars?.[barIdx - 1] || null;
  const running = runningPnlAt(bundle, selectedTrade, barIdx);

  // ─── Day replay loading + playback ─────────────────────────────────────────

  const loadDay = useCallback(async (key, account) => {
    if (!key) return;
    setDayError('');
    setDayData(null);
    setDayWarnings([]);
    setDayPlaying(false);
    setDayIdx(0);
    setDayLoading(true);
    try {
      const res = await window.electronAPI?.getDayReplayBundle?.({
        dateKey: key,
        ...(account ? { accountKey: account } : {})
      });
      if (res?.success && res.bundle) {
        setDayData(res.bundle);
        setDayWarnings(Array.isArray(res.barWarnings) ? res.barWarnings : []);
      } else {
        setDayError(res?.error || 'Could not load this day.');
      }
    } catch (e) {
      setDayError(e?.message || String(e));
    } finally {
      setDayLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'day' || !routeVisible || !dateKey) return;
    loadDay(dateKey, accountKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, routeVisible, dateKey, accountKey]);

  const dayEvents = dayData?.events || [];

  useEffect(() => {
    if (!dayPlaying || dayEvents.length === 0) return undefined;
    const timer = setInterval(() => {
      setDayIdx((i) => Math.min(dayEvents.length, i + 1));
    }, Math.max(60, Math.round(EVENT_TICK_MS / speed)));
    return () => clearInterval(timer);
  }, [dayPlaying, speed, dayEvents.length]);

  useEffect(() => {
    if (dayPlaying && dayEvents.length > 0 && dayIdx >= dayEvents.length) setDayPlaying(false);
  }, [dayPlaying, dayIdx, dayEvents.length]);

  const revealedEvents = dayEvents.slice(0, dayIdx);
  const revealedCloses = revealedEvents.filter((e) => e.type === 'close').length;
  const ribbonPoints = (dayData?.runningPnl || []).slice(0, revealedCloses);
  const dayCumPnl = ribbonPoints.length ? ribbonPoints[ribbonPoints.length - 1][1] : 0;

  const cardStateFor = useCallback((trade) => {
    const id = String(trade?.id ?? '');
    const openRevealed = revealedEvents.some((e) => e.tradeId === id && e.type === 'open');
    const closeEvent = revealedEvents.find((e) => e.tradeId === id && e.type === 'close');
    const hasOpenEvent = dayEvents.some((e) => e.tradeId === id && e.type === 'open');
    if (closeEvent) return { state: 'closed', pnl: closeEvent.pnl ?? 0 };
    if (openRevealed || !hasOpenEvent) return { state: 'open' }; // carried from a previous day counts as open
    return { state: 'pending' };
  }, [revealedEvents, dayEvents]);

  const openTradeFromCard = useCallback((dayTrade) => {
    const full = trades.find((t) => String(t?.id) === String(dayTrade?.id)) || dayTrade;
    setMode('trade');
    selectTrade(full);
  }, [trades, selectTrade]);

  // ─── Journal dock actions ──────────────────────────────────────────────────

  const tagPresets = useMemo(() => {
    const fromPresets = Array.isArray(settings?.tradeTagPresets) ? settings.tradeTagPresets : [];
    if (fromPresets.length > 0) return fromPresets.map((v) => String(v || '').trim()).filter(Boolean);
    const cats = settings?.tagCategories || {};
    return [...(Array.isArray(cats.mistakes) ? cats.mistakes : []), ...(Array.isArray(cats.emotions) ? cats.emotions : [])]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
  }, [settings]);

  const applyUpdatedTrade = useCallback((updated) => {
    if (!updated) return;
    setSelectedTrade(updated);
    setDraftTags(Array.isArray(updated.journal?.tags) ? updated.journal.tags : []);
    setTrades((prev) => prev.map((t) => (String(t?.id) === String(updated.id) ? updated : t)));
  }, []);

  const toggleTag = useCallback((tag) => {
    const clean = String(tag || '').trim();
    if (!clean) return;
    setDraftTags((prev) => (prev.includes(clean) ? prev.filter((t) => t !== clean) : [...prev, clean]));
  }, []);

  const addFreeTag = useCallback(() => {
    const clean = tagInput.trim();
    if (!clean) return;
    setDraftTags((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    setTagInput('');
  }, [tagInput]);

  const saveTags = useCallback(async () => {
    if (!selectedTrade) return;
    setSavingJournal(true);
    try {
      const res = await window.electronAPI?.updateTradeJournal?.(selectedTrade.id, { tags: draftTags });
      if (res?.success) {
        applyUpdatedTrade(res.trade);
        pushToast('Tags saved', 'success');
      } else {
        pushToast(res?.reason || 'Could not save tags', 'error');
      }
    } catch (e) {
      pushToast(e?.message || String(e), 'error');
    } finally {
      setSavingJournal(false);
    }
  }, [selectedTrade, draftTags, applyUpdatedTrade, pushToast]);

  const appendNote = useCallback(async () => {
    if (!selectedTrade) return;
    const text = noteInput.trim();
    if (!text) return;
    setSavingJournal(true);
    try {
      const existing = String(selectedTrade.journal?.notes || '');
      const merged = [existing, text].filter(Boolean).join('\n');
      const res = await window.electronAPI?.updateTradeJournal?.(selectedTrade.id, { notes: merged });
      if (res?.success) {
        applyUpdatedTrade(res.trade);
        setNoteInput('');
        pushToast('Note appended to journal', 'success');
      } else {
        pushToast(res?.reason || 'Could not save note', 'error');
      }
    } catch (e) {
      pushToast(e?.message || String(e), 'error');
    } finally {
      setSavingJournal(false);
    }
  }, [selectedTrade, noteInput, applyUpdatedTrade, pushToast]);

  const captureSnapshot = useCallback(async () => {
    if (!selectedTrade) return;
    const canvas = chartApiRef.current?.takeScreenshot?.();
    if (!canvas) {
      pushToast('Chart is not ready — open Trade Replay with bars loaded first', 'warning');
      return;
    }
    setSnapshotBusy(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const res = await window.electronAPI?.saveReplaySnapshot?.({
        tradeId: selectedTrade.id,
        base64Png: dataUrl
      });
      if (res?.success) {
        const journal = selectedTrade.journal && typeof selectedTrade.journal === 'object'
          ? selectedTrade.journal
          : {};
        const attachments = Array.isArray(journal.attachments) ? journal.attachments : [];
        applyUpdatedTrade({
          ...selectedTrade,
          journal: {
            ...journal,
            attachments: [...attachments, { path: res.path, at: res.at }].slice(-100)
          }
        });
        pushToast('Snapshot saved to journal attachments', 'success');
      } else {
        pushToast(res?.error || 'Snapshot failed', 'error');
      }
    } catch (e) {
      pushToast(e?.message || String(e), 'error');
    } finally {
      setSnapshotBusy(false);
    }
  }, [selectedTrade, applyUpdatedTrade, pushToast]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const renderTransport = () => (
    <div className="replay-transport">
      <div className="replay-transport-buttons">
        <button
          type="button"
          className="btn btn-outline replay-btn-icon"
          onClick={() => { setPlaying(false); setBarIdx((i) => Math.max(1, i - 1)); }}
          disabled={!bundle || barIdx <= 1}
          title="Step back one bar"
        >
          <SkipBack size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn replay-btn-play"
          onClick={() => {
            if (!playing && barIdx >= totalBars) setBarIdx(1);
            setPlaying((p) => !p);
          }}
          disabled={!bundle}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="btn btn-outline replay-btn-icon"
          onClick={() => { setPlaying(false); setBarIdx((i) => Math.min(totalBars, i + 1)); }}
          disabled={!bundle || barIdx >= totalBars}
          title="Step forward one bar"
        >
          <SkipForward size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="replay-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`replay-speed-btn${speed === s ? ' is-active' : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      <input
        type="range"
        className="replay-scrub"
        min={1}
        max={Math.max(1, totalBars)}
        value={Math.min(barIdx, Math.max(1, totalBars))}
        onChange={(e) => { setPlaying(false); setBarIdx(Number(e.target.value) || 1); }}
        disabled={!bundle}
        aria-label="Scrub replay position"
      />

      <div className="replay-jump-btns">
        <button
          type="button"
          className="btn btn-outline replay-jump-btn"
          onClick={() => { setPlaying(false); setBarIdx(entryBarIdx); }}
          disabled={!bundle}
          title="Jump to entry"
        >
          <CornerDownRight size={13} aria-hidden="true" /> Entry
        </button>
        <button
          type="button"
          className="btn btn-outline replay-jump-btn"
          onClick={() => { setPlaying(false); setBarIdx(exitBarIdx); }}
          disabled={!bundle || !bundle.closed}
          title="Jump to exit"
        >
          <Flag size={13} aria-hidden="true" /> Exit
        </button>
      </div>
    </div>
  );

  const renderTradeMode = () => (
    <div className="replay-trade-grid">
      <div className="replay-picker">
        <div className="replay-picker-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            className="input-field replay-search-input"
            placeholder="Search symbol, channel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-outline replay-btn-icon"
            onClick={loadTrades}
            title="Reload trades"
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </div>
        <div className="replay-picker-list">
          {closedTrades.length === 0 ? (
            <div className="replay-empty-hint">
              {trades.length === 0 ? 'No trades yet.' : 'No closed trades match this search.'}
            </div>
          ) : closedTrades.map((t) => {
            const pnl = Number(t.profit);
            const active = selectedTrade && String(selectedTrade.id) === String(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={`replay-trade-row${active ? ' is-active' : ''}`}
                onClick={() => selectTrade(t)}
              >
                <span className="replay-trade-row-main">
                  <span className="replay-trade-sym">{t.symbol || '—'}</span>
                  <span className={`replay-trade-dir ${String(t.type || '').toUpperCase().startsWith('SELL') ? 'is-sell' : 'is-buy'}`}>
                    {String(t.type || '?').toUpperCase()}
                  </span>
                </span>
                <span className="replay-trade-row-sub">
                  <span className={`replay-trade-pnl ${Number.isFinite(pnl) && pnl < 0 ? 'is-loss' : 'is-win'}`}>
                    {fmtMoney(pnl)}
                  </span>
                  <span className="replay-trade-date">{fmtDate(t.closedAt || t.openedAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="replay-stage">
        {!selectedTrade ? (
          <div className="replay-stage-empty">
            <PlayCircle size={28} aria-hidden="true" />
            <p>Pick a closed trade to replay it bar by bar.</p>
          </div>
        ) : (
          <>
            <div className="replay-stage-head">
              <div className="replay-stage-title">
                <strong>{selectedTrade.symbol}</strong>
                <span className={`replay-trade-dir ${direction === -1 ? 'is-sell' : 'is-buy'}`}>
                  {String(selectedTrade.type || '').toUpperCase()}
                </span>
                <span className="replay-stage-meta">
                  {fmtDate(selectedTrade.openedAt)} · {barSource ? `${barSource} · ` : ''}{totalBars} bars (M1)
                </span>
              </div>
              <div className="replay-readout">
                <span className="replay-readout-time">{playhead ? fmtClock(playhead.time) : '—'}</span>
                <span
                  className={`replay-readout-pnl ${running?.money != null && running.money < 0 ? 'is-loss' : 'is-win'}`}
                  title={running?.estimated ? 'Estimated from bar close vs entry (no recorded P&L series)' : 'From recorded running P&L'}
                >
                  {running == null ? '—'
                    : running.money != null ? `${running.label}: ${fmtMoney(running.money)}`
                    : running.pips != null ? `${running.label}: ${running.pips.toFixed(1)} pips`
                    : running.label}
                </span>
              </div>
            </div>

            {tradeLoading ? (
              <div className="replay-banner replay-banner--muted">Loading 1-minute bars…</div>
            ) : null}
            {tradeError ? (
              <div className="replay-banner replay-banner--error">{tradeError}</div>
            ) : null}

            <ReplayChartCanvas
              ref={chartApiRef}
              bars={bundle?.bars || []}
              visibleCount={barIdx}
              markers={bundle?.markers || []}
              slLine={bundle?.slLine || null}
              tpLines={bundle?.tpLines || []}
              entrySec={bundle?.entrySec ?? null}
              direction={direction}
            />

            {renderTransport()}
          </>
        )}
      </div>
    </div>
  );

  const renderDayMode = () => (
    <div className="replay-day-wrap">
      <div className="replay-day-controls">
        <label className="replay-field">
          <span>Day (UTC)</span>
          <input
            type="date"
            className="input-field"
            value={dateKey}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDateKey(e.target.value)}
          />
        </label>
        <label className="replay-field">
          <span>Account</span>
          <select
            className="select-field"
            value={accountKey}
            onChange={(e) => setAccountKey(e.target.value)}
          >
            <option value="">All accounts</option>
            {accountOptions.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>

        <div className="replay-day-transport">
          <button
            type="button"
            className="btn replay-btn-play"
            onClick={() => {
              if (!dayPlaying && dayIdx >= dayEvents.length) setDayIdx(0);
              setDayPlaying((p) => !p);
            }}
            disabled={!dayData || dayEvents.length === 0}
            title={dayPlaying ? 'Pause' : 'Play the session'}
          >
            {dayPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </button>
          <div className="replay-speeds" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`replay-speed-btn${speed === s ? ' is-active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          <input
            type="range"
            className="replay-scrub replay-scrub--day"
            min={0}
            max={Math.max(0, dayEvents.length)}
            value={Math.min(dayIdx, dayEvents.length)}
            onChange={(e) => { setDayPlaying(false); setDayIdx(Number(e.target.value) || 0); }}
            disabled={!dayData || dayEvents.length === 0}
            aria-label="Scrub session position"
          />
          <span className="replay-day-progress">
            {dayIdx}/{dayEvents.length} events
          </span>
        </div>
      </div>

      {dayLoading ? <div className="replay-banner replay-banner--muted">Loading session…</div> : null}
      {dayError ? <div className="replay-banner replay-banner--error">{dayError}</div> : null}
      {dayWarnings.length > 0 ? (
        <div className="replay-banner replay-banner--muted">Bars unavailable for: {dayWarnings.join(' · ')}</div>
      ) : null}

      {dayData ? (
        <>
          <div className="replay-ribbon">
            <div className="replay-ribbon-head">
              <span>Running daily P&L</span>
              <strong className={dayCumPnl < 0 ? 'is-loss' : 'is-win'}>{fmtMoney(dayCumPnl)}</strong>
            </div>
            <DayPnlRibbon points={ribbonPoints} />
          </div>

          <div className="replay-day-columns">
            <div className="replay-timeline">
              <h4 className="replay-subhead">Session timeline</h4>
              {dayEvents.length === 0 ? (
                <div className="replay-empty-hint">No open/close events on this day.</div>
              ) : dayEvents.map((e, i) => {
                const revealed = i < dayIdx;
                return (
                  <div
                    key={`${e.type}-${e.tradeId}-${e.atSec}-${i}`}
                    className={`replay-event${revealed ? ' is-revealed' : ''} replay-event--${e.type}`}
                  >
                    <span className="replay-event-time">{fmtClock(e.atSec)}</span>
                    <span className="replay-event-type">{e.type === 'open' ? 'OPEN' : 'CLOSE'}</span>
                    <span className="replay-event-sym">{e.symbol}</span>
                    {e.type === 'close' ? (
                      <span className={`replay-event-pnl ${Number(e.pnl) < 0 ? 'is-loss' : 'is-win'}`}>{fmtMoney(e.pnl)}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="replay-day-cards">
              <h4 className="replay-subhead">Trades ({dayData.trades.length})</h4>
              <div className="replay-card-grid">
                {dayData.trades.map((t) => {
                  const cs = cardStateFor(t);
                  const cls = cs.state === 'closed'
                    ? (cs.pnl < 0 ? ' is-closed-loss' : ' is-closed-win')
                    : cs.state === 'open' ? ' is-open' : '';
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`replay-day-card${cls}`}
                      onClick={() => openTradeFromCard(t)}
                      title="Open in Trade Replay"
                    >
                      <span className="replay-card-top">
                        <strong>{t.symbol}</strong>
                        <span className={`replay-trade-dir ${String(t.type || '').toUpperCase().startsWith('SELL') ? 'is-sell' : 'is-buy'}`}>
                          {String(t.type || '').toUpperCase()}
                        </span>
                      </span>
                      <span className="replay-card-state">
                        {cs.state === 'pending' ? 'Waiting…'
                          : cs.state === 'open' ? 'Open'
                          : fmtMoney(cs.pnl)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  const renderJournalDock = () => {
    if (!selectedTrade) return null;
    const currentTags = Array.isArray(selectedTrade.journal?.tags) ? selectedTrade.journal.tags : [];
    const dirty = JSON.stringify([...draftTags].sort()) !== JSON.stringify([...currentTags].sort());
    return (
      <aside className="replay-dock">
        <div className="replay-dock-head">
          <h4>Journal — {selectedTrade.symbol}</h4>
          <span className={`replay-trade-pnl ${Number(selectedTrade.profit) < 0 ? 'is-loss' : 'is-win'}`}>
            {fmtMoney(selectedTrade.profit)}
          </span>
        </div>

        <div className="replay-dock-section">
          <h5>Tags</h5>
          <div className="replay-chip-row">
            {draftTags.length === 0 ? <span className="replay-empty-hint">No tags yet</span> : null}
            {draftTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="replay-chip is-selected"
                onClick={() => toggleTag(tag)}
                title="Remove tag"
              >
                {tag} ×
              </button>
            ))}
          </div>
          {tagPresets.length > 0 ? (
            <div className="replay-chip-row replay-chip-row--presets">
              {tagPresets.filter((t) => !draftTags.includes(t)).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="replay-chip"
                  onClick={() => toggleTag(tag)}
                  title="Add tag"
                >
                  + {tag}
                </button>
              ))}
            </div>
          ) : null}
          <div className="replay-dock-inline">
            <input
              type="text"
              className="input-field"
              placeholder="Custom tag…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFreeTag(); } }}
            />
            <button type="button" className="btn btn-outline" onClick={addFreeTag} disabled={!tagInput.trim()}>
              Add
            </button>
          </div>
          <button
            type="button"
            className="btn replay-dock-save"
            onClick={saveTags}
            disabled={savingJournal || !dirty}
          >
            {savingJournal ? 'Saving…' : 'Save tags'}
          </button>
        </div>

        <div className="replay-dock-section">
          <h5>Note</h5>
          {selectedTrade.journal?.notes ? (
            <div className="replay-existing-notes">{selectedTrade.journal.notes}</div>
          ) : null}
          <textarea
            className="input-field replay-note-box"
            rows={3}
            placeholder="What did you see at this point of the replay?"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
          />
          <button
            type="button"
            className="btn replay-dock-save"
            onClick={appendNote}
            disabled={savingJournal || !noteInput.trim()}
          >
            Append note
          </button>
        </div>

        <div className="replay-dock-section">
          <h5>Snapshot</h5>
          <button
            type="button"
            className="btn btn-outline replay-snapshot-btn"
            onClick={captureSnapshot}
            disabled={snapshotBusy || mode !== 'trade' || !bundle}
            title={mode !== 'trade' ? 'Snapshots are captured from the Trade Replay chart' : 'Save the current chart as PNG into journal attachments'}
          >
            <Camera size={14} aria-hidden="true" /> {snapshotBusy ? 'Capturing…' : 'Capture snapshot'}
          </button>
          {Array.isArray(selectedTrade.journal?.attachments) && selectedTrade.journal.attachments.length > 0 ? (
            <div className="replay-attachment-count">
              {selectedTrade.journal.attachments.length} attachment{selectedTrade.journal.attachments.length === 1 ? '' : 's'} on this trade
            </div>
          ) : null}
        </div>
      </aside>
    );
  };

  return (
    <div className="dashboard-shell replay-page">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon"><PlayCircle size={18} aria-hidden="true" /></span>
          <span className="brand-name">Replay</span>
          <span className="subtitle">Bar-by-bar trade replay and full-session day replay</span>
        </div>
        <div className="replay-mode-tabs" role="tablist" aria-label="Replay mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'trade'}
            className={`replay-mode-tab${mode === 'trade' ? ' is-active' : ''}`}
            onClick={() => setMode('trade')}
          >
            Trade Replay
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'day'}
            className={`replay-mode-tab${mode === 'day' ? ' is-active' : ''}`}
            onClick={() => setMode('day')}
          >
            Day Replay
          </button>
        </div>
      </div>

      <div className="replay-layout">
        <div className="replay-main">
          {mode === 'trade' ? renderTradeMode() : renderDayMode()}
        </div>
        {renderJournalDock()}
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  );
}
