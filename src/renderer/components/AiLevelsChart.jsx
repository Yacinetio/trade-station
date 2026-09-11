import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';

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
    lineStop: pick('--chart-line-sl', '#ffb74d'),
    lineTarget: pick('--chart-line-tp', '#ce93d8'),
    lineEntry: pick('--accent', '#4ade80'),
    lineSup: 'rgba(74, 222, 128, 0.55)',
    lineRes: 'rgba(239, 83, 80, 0.65)',
    lineNeu: 'rgba(154, 164, 178, 0.75)',
    markerBuy: pick('--chart-marker-buy', '#26a69a'),
    markerSell: pick('--chart-marker-sell', '#ef5350')
  };
}

function roleToLineStyle(role, ct) {
  switch (role) {
    case 'stop':
      return { color: ct.lineStop, lineStyle: 2, lineWidth: 2 };
    case 'target':
      return { color: ct.lineTarget, lineStyle: 2, lineWidth: 2 };
    case 'entry':
      return { color: ct.lineEntry, lineStyle: 0, lineWidth: 2 };
    default:
      return { color: ct.lineNeu, lineStyle: 0, lineWidth: 1 };
  }
}

/**
 * OHLC chart with Entry / SL / TP lines from AI text. Same bars as CHART_CTX / getMarketBars.
 */
export default function AiLevelsChart({ bars = [], levels = [], className = '' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const priceLinesRef = useRef([]);
  const [bootError, setBootError] = useState('');

  const applySkin = useCallback(() => {
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let canceled = false;
    let ro = null;

    const teardown = () => {
      try {
        chartRef.current?.remove();
      } catch (_) { /* noop */ }
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };

    const tryMount = () => {
      if (canceled) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;

      if (chartRef.current) {
        chartRef.current.applyOptions({ width: Math.max(200, w), height: Math.max(280, h) });
        return;
      }

      setBootError('');
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
          height: Math.max(280, h)
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
      } catch (e) {
        setBootError(e?.message || String(e));
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
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    window.addEventListener('tradestation-theme-changed', applySkin);
    applySkin();

    const data = (Array.isArray(bars) ? bars : [])
      .map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close
      }))
      .filter((b) => Number.isFinite(b.time) && [b.open, b.high, b.low, b.close].every(Number.isFinite));

    for (const pl of priceLinesRef.current) {
      try {
        series.removePriceLine(pl);
      } catch (_) { /* noop */ }
    }
    priceLinesRef.current = [];

    series.setData(data);

    const ct = readChartThemeCss();
    for (const lv of levels || []) {
      const p = Number(lv.price);
      if (!Number.isFinite(p)) continue;
      const sty = roleToLineStyle(lv.role || 'neutral', ct);
      try {
        const pl = series.createPriceLine({
          price: p,
          color: sty.color,
          lineWidth: sty.lineWidth,
          lineStyle: sty.lineStyle,
          axisLabelVisible: true,
          title: String(lv.label || '').slice(0, 12)
        });
        priceLinesRef.current.push(pl);
      } catch (_) { /* noop */ }
    }

    try {
      series.setMarkers([]);
    } catch (_) { /* noop */ }

    chart.timeScale().fitContent();

    return () => window.removeEventListener('tradestation-theme-changed', applySkin);
  }, [bars, levels, applySkin]);

  if (bootError) {
    return (
      <div className={`ai-levels-chart ai-levels-chart--error ${className}`}>
        Chart error: {bootError}
      </div>
    );
  }

  return <div ref={containerRef} className={`ai-levels-chart ${className}`} />;
}
