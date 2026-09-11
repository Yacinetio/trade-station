import React, { useMemo, useState, useEffect, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { ChevronDown, ChevronUp, LineChart, RotateCcw } from 'lucide-react';

const COLLAPSE_KEY = 'tradeStation_profitChartCollapsed';

const FILTERS = [
  { key: 'DAY', label: 'Day' },
  { key: 'WEEK', label: 'Week' },
  { key: 'MONTH', label: 'Month' },
  { key: 'YEAR', label: 'Year' }
];

function chartPixelHeight() {
  if (typeof window === 'undefined') return 120;
  const vh = window.innerHeight;
  /** Short viewport → shallow curve; tall viewport caps ~132px */
  return Math.round(Math.min(132, Math.max(96, vh * 0.14)));
}

/** Equity curve colors follow themes.css --chart-* / --success / --danger (same convention as TradeReplayChart). */
function readProfitChartTheme() {
  const root = getComputedStyle(document.documentElement);
  const pick = (name, fb) => {
    const v = root.getPropertyValue(name).trim();
    return v || fb;
  };
  const up = pick('--chart-candle-up', pick('--success', '#24d084'));
  const down = pick('--chart-candle-down', pick('--danger', '#ff5c75'));
  return {
    up,
    down,
    tooltipBg: pick('--tp-surface4', pick('--surface', '#0f1011')),
    tooltipBorder: pick('--tp-border2', pick('--border', '#232529')),
    tooltipText: pick('--text', '#eef5ff')
  };
}

export default function ProfitChart({
  scope = 'DAY',
  onScopeChange,
  onResetScope,
  chart = { points: [], totalPnl: 0 }
}) {
  const points = Array.isArray(chart?.points) ? chart.points : [];
  const totalPnl = Number(chart?.totalPnl || 0);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage?.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [plotHeight, setPlotHeight] = useState(chartPixelHeight);
  const [chartTheme, setChartTheme] = useState(() => readProfitChartTheme());

  const refreshChartTheme = useCallback(() => {
    setChartTheme(readProfitChartTheme());
  }, []);

  useEffect(() => {
    const onResize = () => setPlotHeight(chartPixelHeight());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    refreshChartTheme();
    window.addEventListener('tradestation-theme-changed', refreshChartTheme);
    return () => window.removeEventListener('tradestation-theme-changed', refreshChartTheme);
  }, [refreshChartTheme]);

  const setCollapsedPersist = (next) => {
    setCollapsed(next);
    try {
      window.localStorage?.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch (_) {}
  };

  const lineColor = totalPnl >= 0 ? chartTheme.up : chartTheme.down;

  const option = useMemo(() => ({
    animation: true,
    animationDuration: 220,
    grid: { left: 10, right: 10, top: 8, bottom: 8, containLabel: false },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((p) => p.time),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false }
    },
    tooltip: {
      trigger: 'axis',
      borderWidth: 1,
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      formatter: (params) => {
        const v = Number(params?.[0]?.value ?? 0);
        return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}$`;
      }
    },
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: {
          width: 2,
          color: lineColor
        },
        areaStyle: {
          opacity: 0.1,
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: lineColor },
              { offset: 1, color: 'transparent' }
            ]
          }
        },
        data: points.map((p) => p.pnl)
      }
    ]
  }), [points, lineColor, chartTheme]);

  return (
    <div className={`chart-section${collapsed ? ' chart-section--collapsed' : ''}`}>
      <div className="chart-header">
        <div className="chart-title">
          <LineChart size={14} />
          <span>Profit Growth</span>
        </div>
        <button
          type="button"
          className="chart-toggle-btn"
          onClick={() => setCollapsedPersist(!collapsed)}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show equity curve' : 'Hide equity curve (more room for trades)'}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <div className="chart-pnl-wrap">
          <span className={`chart-pnl num value-transition ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
            {totalPnl >= 0 ? '+' : '−'}${Math.abs(totalPnl).toFixed(2)}
          </span>
        </div>
        <div className="chart-filters">
          <button type="button" className="chart-filter-btn chart-filter-reset" onClick={() => onResetScope?.()}>
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chart-filter-btn ${scope === f.key ? 'active' : ''}`}
              onClick={() => onScopeChange?.(f.key)}
            >{f.label}</button>
          ))}
        </div>
      </div>
      <div className="chart-section-collapsible-body" aria-hidden={collapsed}>
        <ReactECharts
          option={option}
          style={{ width: '100%', height: collapsed ? 0 : plotHeight }}
          notMerge
          lazyUpdate
        />
      </div>
    </div>
  );
}
