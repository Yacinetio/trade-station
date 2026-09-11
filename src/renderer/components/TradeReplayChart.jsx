import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';

function parseMs(raw) {
  if (!raw) return NaN;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/** Request range: full UTC day before min(entry,exit), through full UTC day after max(entry,exit). */
function tradeChartWindowIso(entryMs, exitMs) {
  const lo = Math.min(entryMs, exitMs);
  const hi = Math.max(entryMs, exitMs);
  const start = new Date(lo);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(hi);
  end.setUTCHours(23, 59, 59, 999);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function entryExitMs(trade) {
  let entry =
    parseMs(trade?.executedAt) ||
    parseMs(trade?.openedAt) ||
    parseMs(trade?.time);
  let exit = parseMs(trade?.closedAt) || parseMs(trade?.lastUpdateAt);
  if (!Number.isFinite(entry) && Number.isFinite(exit)) entry = exit;
  if (!Number.isFinite(exit) && Number.isFinite(entry)) exit = entry;
  if (!Number.isFinite(entry)) entry = Date.now();
  if (!Number.isFinite(exit)) exit = entry;
  return { entryMs: entry, exitMs: exit };
}

function snapBarTime(targetSec, bars) {
  if (!bars.length) return targetSec;
  let best = bars[0].time;
  let bestAbs = Math.abs(best - targetSec);
  for (const b of bars) {
    const d = Math.abs(b.time - targetSec);
    if (d < bestAbs) {
      bestAbs = d;
      best = b.time;
    }
  }
  return best;
}

/** Candle/grid colors follow themes.css + global.css --chart-* tokens */
function readChartThemeCss() {
  const root = getComputedStyle(document.documentElement);
  const pick = (name, fb) => {
    const v = root.getPropertyValue(name).trim();
    return v || fb;
  };
  const grid = pick('--chart-grid', 'rgba(128,128,128,0.15)');
  return {
    gridVert: grid,
    gridHorz: grid,
    text: pick('--chart-text', '#9aa4b2'),
    up: pick('--chart-candle-up', '#26a69a'),
    down: pick('--chart-candle-down', '#ef5350'),
    markerBuy: pick('--chart-marker-buy', '#26a69a'),
    markerSell: pick('--chart-marker-sell', '#ef5350'),
    markerExit: pick('--chart-marker-exit', '#64b5f6'),
    lineSl: pick('--chart-line-sl', '#ffb74d'),
    lineTp: pick('--chart-line-tp', '#ce93d8')
  };
}

const REPLAY_RESOLUTION_LS_KEY = 'tradesync-trade-replay-resolution';

const ALLOWED_REPLAY_RES = [5, 15, 60, 240];

function readStoredReplayResolution() {
  try {
    const v = Number(window.localStorage.getItem(REPLAY_RESOLUTION_LS_KEY));
    return ALLOWED_REPLAY_RES.includes(v) ? v : 5;
  } catch {
    return 5;
  }
}

export default function TradeReplayChart({ trade }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const priceLinesRef = useRef([]);
  const [resolution, setResolution] = useState(readStoredReplayResolution);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [chartBootError, setChartBootError] = useState('');
  const [chartReady, setChartReady] = useState(false);
  const [source, setSource] = useState('');
  const [barCount, setBarCount] = useState(0);

  const loadRef = useRef(async () => {});

  const applyChartSkin = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const c = readChartThemeCss();
    chart.applyOptions({
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: c.text
      },
      grid: {
        vertLines: { color: c.gridVert },
        horzLines: { color: c.gridHorz }
      }
    });
    series.applyOptions({
      upColor: c.up,
      downColor: c.down,
      borderVisible: false,
      wickUpColor: c.up,
      wickDownColor: c.down
    });
  }, []);

  const load = useCallback(async () => {
    const series = seriesRef.current;
    if (!chartReady || !series) return;

    if (!trade?.symbol) {
      setLoading(false);
      setError('');
      setInfo('No symbol on this trade — chart data cannot be loaded.');
      setSource('');
      setBarCount(0);
      try {
        series.setData([]);
        series.setMarkers([]);
      } catch (_) {}
      return;
    }

    if (!window.electronAPI?.getMarketBars) {
      setLoading(false);
      setError('');
      setInfo('Market history API is not available in this view.');
      setSource('');
      setBarCount(0);
      try {
        series.setData([]);
        series.setMarkers([]);
      } catch (_) {}
      return;
    }

    for (const pl of priceLinesRef.current) {
      try {
        series.removePriceLine(pl);
      } catch (_) {}
    }
    priceLinesRef.current = [];

    setLoading(true);
    setError('');
    setInfo('');
    setChartBootError('');
    try {
      const { entryMs, exitMs } = entryExitMs(trade);
      const { from, to } = tradeChartWindowIso(entryMs, exitMs);
      const res = await window.electronAPI.getMarketBars({
        symbol: trade.symbol,
        resolutionMinutes: resolution,
        from,
        to
      });

      if (!res?.success || !Array.isArray(res.bars) || res.bars.length === 0) {
        series.setData([]);
        series.setMarkers([]);
        setBarCount(0);
        setSource('');
        setError('');
        setInfo(
          res?.message ||
            res?.code ||
            'No OHLC bars for this symbol and date range. Check API keys, symbol mapping, or try another timeframe.'
        );
        return;
      }

      setSource(res.source || '');
      setBarCount(res.bars.length);
      const data = res.bars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close
      }));
      series.setData(data);

      const typeStr = String(trade.type || '').toUpperCase();
      const buy = typeStr.includes('BUY');
      const entrySec = Math.floor(entryMs / 1000);
      const exitSec = Math.floor(exitMs / 1000);
      const eSnap = snapBarTime(entrySec, data);
      const xSnap = snapBarTime(exitSec, data);

      const ct = readChartThemeCss();
      const markers = [
        {
          time: eSnap,
          position: buy ? 'belowBar' : 'aboveBar',
          color: buy ? ct.markerBuy : ct.markerSell,
          shape: buy ? 'arrowUp' : 'arrowDown',
          text: 'Entry'
        }
      ];
      const st = String(trade.status || '').toUpperCase();
      const closed = !!trade.closedAt || st.includes('CLOSED') || st.includes('SL_HIT') || st.includes('TP_HIT');
      if (closed && xSnap !== eSnap) {
        markers.push({
          time: xSnap,
          position: buy ? 'aboveBar' : 'belowBar',
          color: ct.markerExit,
          shape: 'circle',
          text: 'Exit'
        });
      }
      series.setMarkers(markers);

      const sl = Number(trade.sl);
      const tp = Number(trade.tp);
      if (Number.isFinite(sl) && sl > 0) {
        priceLinesRef.current.push(
          series.createPriceLine({
            price: sl,
            color: ct.lineSl,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'SL'
          })
        );
      }
      if (Number.isFinite(tp) && tp > 0) {
        priceLinesRef.current.push(
          series.createPriceLine({
            price: tp,
            color: ct.lineTp,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP'
          })
        );
      }

      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      setError(e?.message || String(e));
      setInfo('');
    } finally {
      setLoading(false);
    }
  }, [trade, resolution, chartReady]);

  loadRef.current = load;

  useEffect(() => {
    try {
      window.localStorage.setItem(REPLAY_RESOLUTION_LS_KEY, String(resolution));
    } catch (_) {}
  }, [resolution]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let canceled = false;
    let ro = null;

    const teardown = () => {
      try {
        chartRef.current?.remove();
      } catch (_) {}
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      if (!canceled) setChartReady(false);
    };

    const tryMount = () => {
      if (canceled) return;
      const w = el.clientWidth;
      const h = el.clientHeight;

      if (chartRef.current) {
        chartRef.current.applyOptions({
          width: Math.max(200, w || 400),
          height: Math.max(200, h || 280)
        });
        return;
      }

      if (w < 8 || h < 8) return;

      setChartBootError('');
      try {
        const c0 = readChartThemeCss();
        const chart = createChart(el, {
          layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: c0.text
          },
          grid: {
            vertLines: { color: c0.gridVert },
            horzLines: { color: c0.gridHorz }
          },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false },
          crosshair: { mode: 1 },
          width: Math.max(200, w),
          height: Math.max(200, h)
        });
        const series = chart.addCandlestickSeries({
          upColor: c0.up,
          downColor: c0.down,
          borderVisible: false,
          wickUpColor: c0.up,
          wickDownColor: c0.down
        });
        chartRef.current = chart;
        seriesRef.current = series;
        setChartReady(true);
      } catch (e) {
        setChartBootError(e?.message || String(e));
        teardown();
      }
    };

    ro = new ResizeObserver(() => tryMount());
    ro.observe(el);
    tryMount();

    return () => {
      canceled = true;
      ro.disconnect();
      teardown();
    };
  }, []);

  useEffect(() => {
    if (!chartReady) return;
    applyChartSkin();
  }, [chartReady, applyChartSkin]);

  useEffect(() => {
    const onTheme = () => {
      applyChartSkin();
      loadRef.current();
    };
    window.addEventListener('tradestation-theme-changed', onTheme);
    return () => window.removeEventListener('tradestation-theme-changed', onTheme);
  }, [applyChartSkin, chartReady]);

  useEffect(() => {
    load();
  }, [load]);

  const sourceLabel = source ? `${String(source).replace(/^(\w)/, (m) => m.toUpperCase())} · ${barCount} candles` : '';

  return (
    <div className="settings-section trade-replay-section" style={{ marginBottom: 0 }}>
      <div className="trade-replay-head">
        <div className="trade-replay-head-text">
          <h3 className="trade-replay-title">Price replay</h3>
          <p className="trade-replay-lede">
            Real OHLC around this trade — markers at entry / exit and SL · TP lines when levels exist.
          </p>
        </div>
        {(loading || sourceLabel) ? (
          <div className={`trade-replay-meta ${loading ? 'is-loading' : ''}`} title={sourceLabel || 'Loading'}>
            {loading ? 'Updating…' : sourceLabel}
          </div>
        ) : null}
      </div>

      <div className="trade-replay-toolbar">
        <div className="trade-replay-toolbar-inner">
          <div className="trade-replay-field">
            <label htmlFor="trade-replay-tf">Replay timeframe</label>
            <select
              id="trade-replay-tf"
              className="select-field trade-replay-select"
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value))}
            >
              <option value={5}>M5</option>
              <option value={15}>M15</option>
              <option value={60}>H1</option>
              <option value={240}>H4</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-outline trade-replay-sync-btn"
            onClick={load}
            disabled={loading || !chartReady}
            title="Refetch OHLC and redraw markers"
          >
            {loading ? 'Loading…' : 'Sync chart'}
          </button>
        </div>
      </div>

      {chartBootError ? (
        <div className="trade-replay-banner trade-replay-banner--error">{chartBootError}</div>
      ) : null}
      {error ? (
        <div className="trade-replay-banner trade-replay-banner--error">{error}</div>
      ) : null}
      {info ? (
        <div className="trade-replay-banner trade-replay-banner--muted">{info}</div>
      ) : null}

      <div ref={containerRef} className="trade-replay-chart-mount">
        {!chartReady && !chartBootError ? (
          <div className="trade-replay-chart-placeholder">
            Preparing chart… If this stays empty, resize the window once.
          </div>
        ) : null}
      </div>

      <p className="trade-replay-footnote">
        Data sources: optional Twelve Data / Alpha Vantage keys, public crypto feeds, or MT5 history when the bridge is connected.
      </p>
    </div>
  );
}
