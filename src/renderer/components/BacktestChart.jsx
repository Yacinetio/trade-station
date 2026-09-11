import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import { createChart, LineStyle } from 'lightweight-charts';
import { getIndicator } from '../utils/indicators/index.js';

/**
 * Session range boxes: lightweight-charts has no native box primitive, so we draw
 * semi-transparent horizontal band markers via paired createPriceLine calls (top/bottom)
 * scoped to visible session windows — readable enough without custom canvas plugins.
 *
 * FVG zones: same paired price-line approach (top + bottom dashed lines) rather than
 * filled rectangles — keeps one chart pane stable and avoids custom series complexity.
 */

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
    lineAccent: pick('--chart-line-tp', '#ce93d8'),
    lineMuted: pick('--chart-line-sl', '#ffb74d')
  };
}

const BacktestChart = forwardRef(function BacktestChart(
  {
    bars = [],
    visibleCount = 0,
    activeIndicators = [],
    slLines = [],
    tpLines = []
  },
  ref
) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const overlaySeriesRef = useRef([]);
  const priceLinesRef = useRef([]);
  const renderedCountRef = useRef(0);
  const [chartReady, setChartReady] = useState(false);

  const visibleBars = useMemo(
    () => bars.slice(0, Math.max(0, Math.min(visibleCount, bars.length))),
    [bars, visibleCount]
  );

  useImperativeHandle(ref, () => ({
    chart: () => chartRef.current
  }), []);

  const clearOverlays = useCallback(() => {
    for (const pl of priceLinesRef.current) {
      try { seriesRef.current?.removePriceLine(pl); } catch (_) { /* noop */ }
    }
    priceLinesRef.current = [];
    for (const s of overlaySeriesRef.current) {
      try { chartRef.current?.removeSeries(s); } catch (_) { /* noop */ }
    }
    overlaySeriesRef.current = [];
  }, []);

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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let ro = null;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }
    });
    const series = chart.addCandlestickSeries({
      priceFormat: { type: 'price', precision: 5, minMove: 0.00001 }
    });
    chartRef.current = chart;
    seriesRef.current = series;
    renderedCountRef.current = 0;
    applyChartSkin();
    setChartReady(true);

    ro = new ResizeObserver(() => {
      try {
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      } catch (_) { /* noop */ }
    });
    ro.observe(el);

    return () => {
      ro?.disconnect();
      clearOverlays();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setChartReady(false);
    };
  }, [applyChartSkin, clearOverlays]);

  useEffect(() => {
    if (!chartReady || !seriesRef.current) return;
    const series = seriesRef.current;
    const prev = renderedCountRef.current;
    const next = visibleBars.length;

    if (next === 0) {
      series.setData([]);
      renderedCountRef.current = 0;
      return;
    }

    if (prev === 0 || next < prev) {
      series.setData(visibleBars);
      renderedCountRef.current = next;
    } else if (next > prev) {
      for (let i = prev; i < next; i++) series.update(visibleBars[i]);
      renderedCountRef.current = next;
    }

    chartRef.current?.timeScale().scrollToRealTime();
  }, [visibleBars, chartReady]);

  useEffect(() => {
    if (!chartReady || !seriesRef.current) return;
    clearOverlays();
    const series = seriesRef.current;
    const c = readChartThemeCss();
    const lastTime = visibleBars.length ? visibleBars[visibleBars.length - 1].time : null;

    for (const indId of activeIndicators) {
      const ind = getIndicator(indId);
      if (!ind) continue;
      const data = ind.compute(visibleBars);

      if (ind.render === 'line') {
        const line = chartRef.current.addLineSeries({
          color: indId === 'vwap' ? '#42a5f5' : indId === 'ema50' ? '#ab47bc' : '#ffa726',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false
        });
        line.setData(data.map((p) => ({ time: p.time, value: p.value })));
        overlaySeriesRef.current.push(line);
      }

      if (ind.render === 'band') {
        const upper = chartRef.current.addLineSeries({
          color: 'rgba(171, 71, 188, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false
        });
        const lower = chartRef.current.addLineSeries({
          color: 'rgba(171, 71, 188, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false
        });
        upper.setData(data.map((p) => ({ time: p.time, value: p.upper })));
        lower.setData(data.map((p) => ({ time: p.time, value: p.lower })));
        overlaySeriesRef.current.push(upper, lower);
      }

      if (ind.render === 'boxes') {
        if (indId === 'sessionRanges') {
          for (const box of data) {
            if (lastTime != null && box.startSec > lastTime) continue;
            const alpha = box.id === 'asian' ? 0.35 : box.id === 'london' ? 0.45 : 0.55;
            const color = box.id === 'asian' ? `rgba(66,165,245,${alpha})`
              : box.id === 'london' ? `rgba(102,187,106,${alpha})` : `rgba(239,83,80,${alpha})`;
            priceLinesRef.current.push(series.createPriceLine({
              price: box.high,
              color,
              lineWidth: 1,
              lineStyle: LineStyle.Solid,
              axisLabelVisible: true,
              title: `${box.label} H`
            }));
            priceLinesRef.current.push(series.createPriceLine({
              price: box.low,
              color,
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: false,
              title: `${box.label} L`
            }));
          }
        }
        if (indId === 'fvg') {
          for (const zone of data.slice(-12)) {
            if (zone.filledAtSec && lastTime != null && zone.filledAtSec <= lastTime) continue;
            const color = zone.dir === 'bull' ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)';
            priceLinesRef.current.push(series.createPriceLine({
              price: zone.top,
              color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `FVG ${zone.dir}`
            }));
            priceLinesRef.current.push(series.createPriceLine({
              price: zone.bottom,
              color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
              title: ''
            }));
          }
        }
      }

      if (ind.render === 'levels') {
        const recent = data.filter((lv) => lastTime == null || lv.startSec <= lastTime).slice(-8);
        for (const lv of recent) {
          priceLinesRef.current.push(series.createPriceLine({
            price: lv.price,
            color: lv.kind.includes('Week') ? c.lineAccent : c.lineMuted,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: lv.kind.replace('prev', 'Prev ')
          }));
        }
      }
    }

    for (const sl of slLines) {
      priceLinesRef.current.push(series.createPriceLine({
        price: sl,
        color: c.lineMuted,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'SL'
      }));
    }
    for (const tp of tpLines) {
      priceLinesRef.current.push(series.createPriceLine({
        price: tp,
        color: c.lineAccent,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'TP'
      }));
    }
  }, [activeIndicators, visibleBars, slLines, tpLines, chartReady, clearOverlays]);

  return (
    <div className="backtest-chart-wrap">
      <div ref={containerRef} className="backtest-chart-canvas" role="img" aria-label="Backtest candle chart" />
      {!chartReady && <div className="backtest-chart-loading">Loading chart…</div>}
    </div>
  );
});

export default BacktestChart;
