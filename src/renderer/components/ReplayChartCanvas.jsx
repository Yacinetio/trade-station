import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { createChart } from 'lightweight-charts';

/**
 * Bar-by-bar replay candle chart (Phase 2). Mount/theme patterns follow
 * TradeReplayChart.jsx; data flow differs: the parent owns playback state and
 * this component reveals `bars.slice(0, visibleCount)` progressively via
 * series.update() for single steps, series.setData() for scrubs/jumps.
 *
 * Ref API: takeScreenshot() → HTMLCanvasElement | null (lightweight-charts v4).
 */

/** Candle/grid colors follow themes.css + global.css --chart-* tokens (same as TradeReplayChart). */
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

/** Bundle marker → lightweight-charts marker, styled per kind and trade direction. */
function toChartMarker(marker, direction, colors) {
  const buy = direction !== -1;
  switch (marker.kind) {
    case 'entry':
      return {
        time: marker.timeSec,
        position: buy ? 'belowBar' : 'aboveBar',
        color: buy ? colors.markerBuy : colors.markerSell,
        shape: buy ? 'arrowUp' : 'arrowDown',
        text: 'Entry'
      };
    case 'partial':
      return {
        time: marker.timeSec,
        position: buy ? 'aboveBar' : 'belowBar',
        color: colors.markerExit,
        shape: 'circle',
        text: 'Partial'
      };
    case 'sl':
      return {
        time: marker.timeSec,
        position: buy ? 'belowBar' : 'aboveBar',
        color: colors.lineSl,
        shape: 'square',
        text: 'SL hit'
      };
    case 'tp':
      return {
        time: marker.timeSec,
        position: buy ? 'aboveBar' : 'belowBar',
        color: colors.lineTp,
        shape: 'square',
        text: 'TP hit'
      };
    case 'exit':
    default:
      return {
        time: marker.timeSec,
        position: buy ? 'aboveBar' : 'belowBar',
        color: colors.markerExit,
        shape: 'circle',
        text: 'Exit'
      };
  }
}

const ReplayChartCanvas = forwardRef(function ReplayChartCanvas(
  {
    bars = [],
    visibleCount = 0,
    markers = [],
    slLine = null,
    tpLines = [],
    entrySec = null,
    direction = 1
  },
  ref
) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const priceLinesRef = useRef([]);
  const renderedCountRef = useRef(0);
  const linesDrawnRef = useRef(false);
  const [chartReady, setChartReady] = useState(false);
  const [chartBootError, setChartBootError] = useState('');

  useImperativeHandle(ref, () => ({
    takeScreenshot() {
      try {
        return chartRef.current ? chartRef.current.takeScreenshot() : null;
      } catch {
        return null;
      }
    }
  }), []);

  const applyChartSkin = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const c = readChartThemeCss();
    chart.applyOptions({
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: c.text },
      grid: { vertLines: { color: c.gridVert }, horzLines: { color: c.gridHorz } }
    });
    series.applyOptions({
      upColor: c.up,
      downColor: c.down,
      borderVisible: false,
      wickUpColor: c.up,
      wickDownColor: c.down
    });
  }, []);

  // Mount / teardown (ResizeObserver pattern from TradeReplayChart).
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
      renderedCountRef.current = 0;
      linesDrawnRef.current = false;
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
          layout: { background: { type: 'solid', color: 'transparent' }, textColor: c0.text },
          grid: { vertLines: { color: c0.gridVert }, horzLines: { color: c0.gridHorz } },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
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
    const onTheme = () => applyChartSkin();
    window.addEventListener('tradestation-theme-changed', onTheme);
    return () => window.removeEventListener('tradestation-theme-changed', onTheme);
  }, [applyChartSkin]);

  // New bundle → reset series and freeze the frame to the full window so the
  // reveal grows into fixed whitespace instead of re-fitting every step.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chartReady || !chart || !series) return;
    for (const pl of priceLinesRef.current) {
      try {
        series.removePriceLine(pl);
      } catch (_) {}
    }
    priceLinesRef.current = [];
    linesDrawnRef.current = false;
    renderedCountRef.current = 0;
    try {
      series.setData([]);
      series.setMarkers([]);
      if (bars.length > 0) {
        chart.timeScale().setVisibleLogicalRange({ from: -2, to: bars.length + 4 });
      }
    } catch (_) {}
  }, [bars, chartReady]);

  // Progressive reveal: single step → update(); scrub/jump → setData(slice).
  useEffect(() => {
    const series = seriesRef.current;
    if (!chartReady || !series || bars.length === 0) return;
    const count = Math.max(0, Math.min(bars.length, visibleCount));
    const prev = renderedCountRef.current;
    try {
      if (count === prev + 1 && prev > 0) {
        series.update(bars[count - 1]);
      } else if (count !== prev) {
        series.setData(bars.slice(0, count));
      }
    } catch (_) {}
    renderedCountRef.current = count;

    const currentTime = count > 0 ? bars[count - 1].time : null;
    const colors = readChartThemeCss();

    try {
      series.setMarkers(
        (markers || [])
          .filter((m) => currentTime != null && m.timeSec <= currentTime)
          .map((m) => toChartMarker(m, direction, colors))
      );
    } catch (_) {}

    // SL/TP price lines appear once playback reaches the entry.
    const passedEntry = currentTime != null && entrySec != null && currentTime >= entrySec;
    if (passedEntry && !linesDrawnRef.current) {
      linesDrawnRef.current = true;
      try {
        if (slLine && Number(slLine.price) > 0) {
          priceLinesRef.current.push(series.createPriceLine({
            price: Number(slLine.price),
            color: colors.lineSl,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: slLine.label || 'SL'
          }));
        }
        for (const tp of Array.isArray(tpLines) ? tpLines : []) {
          if (!(Number(tp?.price) > 0)) continue;
          priceLinesRef.current.push(series.createPriceLine({
            price: Number(tp.price),
            color: colors.lineTp,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: tp.label || 'TP'
          }));
        }
      } catch (_) {}
    } else if (!passedEntry && linesDrawnRef.current) {
      // scrubbed back before entry → hide the levels again
      linesDrawnRef.current = false;
      for (const pl of priceLinesRef.current) {
        try {
          series.removePriceLine(pl);
        } catch (_) {}
      }
      priceLinesRef.current = [];
    }
  }, [bars, visibleCount, markers, slLine, tpLines, entrySec, direction, chartReady]);

  return (
    <div ref={containerRef} className="replay-chart-mount">
      {chartBootError ? (
        <div className="replay-chart-error">{chartBootError}</div>
      ) : null}
      {!chartReady && !chartBootError ? (
        <div className="replay-chart-placeholder">Preparing chart…</div>
      ) : null}
    </div>
  );
});

export default ReplayChartCanvas;
