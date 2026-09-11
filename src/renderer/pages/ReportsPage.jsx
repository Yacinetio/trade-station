import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { BarChart3 } from 'lucide-react';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import ScopeDateRangeToolbar from '../components/ScopeDateRangeToolbar.jsx';
import TradeSliceFilterBar from '../components/TradeSliceFilterBar.jsx';
import { buildReportFilterPayload } from '../utils/buildReportFilterPayload.js';
import { buildFilterSummaryText } from '../utils/filterSummaryText.js';
import { effectiveAccountKeysForScope } from '../utils/accountScope.js';
import '../styles/reports.css';

function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}$`;
}

/** Legacy saved compare presets (reportEngine shape, pre–global-filters). */
function filterSummary(engineFilter = {}) {
  const parts = [];
  if (engineFilter.accountKeys?.length) parts.push(`acct ${engineFilter.accountKeys.join('/')}`);
  if (engineFilter.channels?.length) parts.push(engineFilter.channels.join('/'));
  if (engineFilter.symbols?.length) parts.push(engineFilter.symbols.join('/'));
  if (engineFilter.direction) parts.push(engineFilter.direction);
  if (engineFilter.tags?.length) parts.push(`#${engineFilter.tags.join(' #')}`);
  if (engineFilter.dateFromMs || engineFilter.dateToMs) parts.push('date range');
  return parts.length ? parts.join(' · ') : 'all trades';
}

const TABLE_COLUMNS = [
  { key: 'label', label: 'Bucket', numeric: false },
  { key: 'count', label: 'Trades', numeric: true },
  { key: 'closedCount', label: 'Closed', numeric: true },
  { key: 'wins', label: 'Wins', numeric: true },
  { key: 'losses', label: 'Losses', numeric: true },
  { key: 'winRatePct', label: 'Win %', numeric: true },
  { key: 'netPnl', label: 'Net P&L', numeric: true },
  { key: 'avgWin', label: 'Avg Win', numeric: true },
  { key: 'avgLoss', label: 'Avg Loss', numeric: true },
  { key: 'profitFactor', label: 'PF', numeric: true },
  { key: 'expectancy', label: 'Expectancy', numeric: true },
  { key: 'totalR', label: 'Total R', numeric: true }
];

const KPI_ROWS = [
  { key: 'count', label: 'Trades', fmt: (v) => fmtNum(v, 0) },
  { key: 'closedCount', label: 'Closed', fmt: (v) => fmtNum(v, 0) },
  { key: 'netPnl', label: 'Net P&L', fmt: fmtMoney },
  { key: 'winRatePct', label: 'Win rate', fmt: fmtPct },
  { key: 'profitFactor', label: 'Profit factor', fmt: (v) => fmtNum(v) },
  { key: 'expectancy', label: 'Expectancy', fmt: fmtMoney },
  { key: 'avgR', label: 'Avg R', fmt: (v) => fmtNum(v) },
  { key: 'maxDrawdown', label: 'Max drawdown', fmt: (v) => fmtMoney(v == null ? null : -Math.abs(v)) }
];

/** For these KPIs a lower value is better (delta coloring flips). */
const LOWER_IS_BETTER = new Set(['maxDrawdown']);

function DeltaBadge({ value, kpiKey }) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return <span className="reports-delta neu">—</span>;
  }
  const v = Number(value);
  if (v === 0) return <span className="reports-delta neu">±0</span>;
  const better = LOWER_IS_BETTER.has(kpiKey) ? v < 0 : v > 0;
  return (
    <span className={`reports-delta ${better ? 'pos' : 'neg'}`}>
      {v > 0 ? '+' : ''}{Number(v.toFixed(2))}
    </span>
  );
}

function KpiCard({ title, subtitle, kpis, deltas, deltaSign = 1 }) {
  return (
    <div className="reports-kpi-card">
      <h4>{title} {subtitle && <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>· {subtitle}</span>}</h4>
      {KPI_ROWS.map(({ key, label, fmt }) => (
        <div key={key} className="reports-kpi-row">
          <span className="kpi-label">{label}</span>
          <span className="kpi-value">
            {fmt(kpis?.[key])}
            {deltas && <DeltaBadge value={deltas[key] == null ? null : deltas[key] * deltaSign} kpiKey={key} />}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage({
  routeVisible = true,
  trades = [],
  tradeFilters = {},
  setTradeFilters = () => {},
  resetTradeFilters = () => {},
  timeScope = 'ALL',
  setTimeScope = () => {},
  analyticsCustomRange = null,
  setAnalyticsCustomRange = () => {},
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange = () => {}
}) {
  const [dimensionGroups, setDimensionGroups] = useState([]);
  const [dimensionId, setDimensionId] = useState('day-of-week');
  const [dimSearch, setDimSearch] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [savedFilters, setSavedFilters] = useState([]);
  const [tab, setTab] = useState('reports');
  const [compareA, setCompareA] = useState('current');
  const [compareB, setCompareB] = useState('current');
  const [compareResult, setCompareResult] = useState(null);
  const [compareRunning, setCompareRunning] = useState(false);
  const [booted, setBooted] = useState(false);
  const [breakEvenAmount, setBreakEvenAmount] = useState(50);

  const effectiveAccountKeys = useMemo(
    () => effectiveAccountKeysForScope(selectedAccountKeys),
    [selectedAccountKeys]
  );

  const scopeMetricLabel = useMemo(() => {
    const ts = String(timeScope || '').toUpperCase();
    if (ts !== 'CUSTOM') return String(timeScope || '');
    const f = analyticsCustomRange?.from;
    const t = analyticsCustomRange?.to;
    if (!f || !t) return 'CUSTOM';
    try {
      const a = new Date(`${f}T12:00:00`);
      const b = new Date(`${t}T12:00:00`);
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'CUSTOM';
      const short = { month: 'short', day: 'numeric' };
      const yOpt = a.getFullYear() !== b.getFullYear() ? { year: 'numeric' } : {};
      return `${a.toLocaleDateString(undefined, short)} → ${b.toLocaleDateString(undefined, { ...short, ...yOpt })}`;
    } catch (_) {
      return 'CUSTOM';
    }
  }, [timeScope, analyticsCustomRange?.from, analyticsCustomRange?.to]);

  const reportFilterPayload = useMemo(() => buildReportFilterPayload({
    tradeFilters,
    selectedAccountKeys,
    timeScope,
    analyticsCustomRange,
    breakEvenAmount
  }), [tradeFilters, selectedAccountKeys, timeScope, analyticsCustomRange, breakEvenAmount]);

  const activeFilterSummary = useMemo(() => {
    const text = buildFilterSummaryText({
      scopeMetricLabel,
      effectiveAccountKeysCount: effectiveAccountKeys.length,
      signalsTab: tradeFilters.signalsTab,
      filterSymbol: tradeFilters.filterSymbol,
      filterType: tradeFilters.filterType,
      filterStatus: tradeFilters.filterStatus,
      filterChannel: tradeFilters.filterChannel,
      sliceTimeframes: tradeFilters.sliceTimeframes,
      slicePairs: tradeFilters.slicePairs,
      sliceBiases: tradeFilters.sliceBiases,
      sliceSetups: tradeFilters.sliceSetups,
      sliceVwapBands: tradeFilters.sliceVwapBands,
      sliceHvnBands: tradeFilters.sliceHvnBands,
      sliceSessions: tradeFilters.sliceSessions,
      sliceWeekdays: tradeFilters.sliceWeekdays,
      sliceTags: tradeFilters.sliceTags
    });
    return text || 'all trades';
  }, [scopeMetricLabel, effectiveAccountKeys.length, tradeFilters]);

  // One-time bootstrap when the route becomes visible.
  useEffect(() => {
    if (!routeVisible || booted) return;
    setBooted(true);
    (async () => {
      try {
        const [dims, saved, settings] = await Promise.all([
          window.electronAPI?.listReportDimensions?.(),
          window.electronAPI?.listSavedReportFilters?.(),
          window.electronAPI?.getSettings?.()
        ]);
        if (dims?.ok) setDimensionGroups(dims.groups || []);
        if (saved?.ok) setSavedFilters(saved.filters || []);
        const def = settings?.reports?.defaultDimension;
        if (def) setDimensionId(def);
        setBreakEvenAmount(Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50));
      } catch (e) {
        setError(String(e?.message || e));
      }
    })();
  }, [routeVisible, booted]);

  // Recompute the report whenever the dimension or filter changes (while visible).
  useEffect(() => {
    if (!routeVisible || !booted) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    window.electronAPI?.computeReport?.({ dimensionId, filter: reportFilterPayload })
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) setReport(res);
        else setError(res?.error || 'Failed to compute report');
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [routeVisible, booted, dimensionId, reportFilterPayload]);

  const filteredGroups = useMemo(() => {
    const q = dimSearch.trim().toLowerCase();
    if (!q) return dimensionGroups;
    return dimensionGroups
      .map((g) => ({ ...g, dimensions: g.dimensions.filter((d) => d.label.toLowerCase().includes(q) || d.id.includes(q)) }))
      .filter((g) => g.dimensions.length > 0);
  }, [dimensionGroups, dimSearch]);

  const dimensionCount = useMemo(
    () => dimensionGroups.reduce((a, g) => a + g.dimensions.length, 0),
    [dimensionGroups]
  );

  const rows = report?.rows || [];

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[sortKey] ?? (typeof a[sortKey] === 'string' ? '' : -Infinity);
      const bv = b[sortKey] ?? (typeof b[sortKey] === 'string' ? '' : -Infinity);
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortDesc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      return sortDesc ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return list;
  }, [rows, sortKey, sortDesc]);

  const onSort = (key) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const chartOption = useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { left: 54, right: 54, top: 30, bottom: 60 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: {
      data: ['Net P&L', 'Win rate'],
      textStyle: { color: '#8a8f98', fontSize: 11 },
      top: 0
    },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.label),
      axisLabel: { color: '#8a8f98', fontSize: 10, rotate: rows.length > 10 ? 40 : 0 },
      axisLine: { lineStyle: { color: 'rgba(138,143,152,0.3)' } }
    },
    yAxis: [
      {
        type: 'value',
        name: 'P&L $',
        nameTextStyle: { color: '#8a8f98', fontSize: 10 },
        axisLabel: { color: '#8a8f98', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(138,143,152,0.12)' } }
      },
      {
        type: 'value',
        name: 'Win %',
        min: 0,
        max: 100,
        nameTextStyle: { color: '#8a8f98', fontSize: 10 },
        axisLabel: { color: '#8a8f98', fontSize: 10, formatter: '{value}%' },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: 'Net P&L',
        type: 'bar',
        data: rows.map((r) => ({
          value: r.netPnl,
          itemStyle: { color: r.netPnl >= 0 ? '#22c55e' : '#ef4444', borderRadius: [3, 3, 0, 0] }
        })),
        barMaxWidth: 34
      },
      {
        name: 'Win rate',
        type: 'line',
        yAxisIndex: 1,
        data: rows.map((r) => r.winRatePct),
        symbol: 'circle',
        symbolSize: 6,
        connectNulls: true,
        lineStyle: { color: '#818cf8', width: 2 },
        itemStyle: { color: '#818cf8' }
      }
    ]
  }), [rows]);

  const refreshSavedFilters = async () => {
    const res = await window.electronAPI?.listSavedReportFilters?.();
    if (res?.ok) setSavedFilters(res.filters || []);
  };

  const resolveCompareFilter = (sel) => {
    if (sel === 'current') return reportFilterPayload;
    const sf = savedFilters.find((f) => f.id === sel);
    return sf ? sf.filter : {};
  };

  const runCompare = async () => {
    setCompareRunning(true);
    setError('');
    try {
      const res = await window.electronAPI?.compareReports?.({
        filterA: resolveCompareFilter(compareA),
        filterB: resolveCompareFilter(compareB)
      });
      if (res?.ok) {
        const nameOf = (sel) => (sel === 'current'
          ? `Current filter (${activeFilterSummary})`
          : (savedFilters.find((f) => f.id === sel)?.name || 'Saved filter'));
        setCompareResult({ ...res, labels: { a: nameOf(compareA), b: nameOf(compareB) } });
      } else {
        setError(res?.error || 'Compare failed');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setCompareRunning(false);
    }
  };

  const runWinsVsLosses = async () => {
    setCompareRunning(true);
    setError('');
    try {
      const res = await window.electronAPI?.getWinsVsLosses?.({ filter: reportFilterPayload });
      if (res?.ok) {
        setCompareResult({
          ...res,
          labels: {
            a: `Winners (${activeFilterSummary})`,
            b: `Losers (${activeFilterSummary})`
          }
        });
      } else {
        setError(res?.error || 'Wins vs losses failed');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setCompareRunning(false);
    }
  };

  const deleteSavedFilter = async (id) => {
    const res = await window.electronAPI?.deleteSavedReportFilter?.(id);
    if (res?.ok) setSavedFilters(res.filters || []);
    else await refreshSavedFilters();
  };

  return (
    <div className="dashboard-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon"><BarChart3 size={18} aria-hidden="true" /></span>
          <span className="brand-name">Reports</span>
          <span className="subtitle">Slice performance across {dimensionCount || '50'}+ dimensions</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ScopeDateRangeToolbar
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            customRange={
              analyticsCustomRange && analyticsCustomRange.from && analyticsCustomRange.to
                ? analyticsCustomRange
                : { from: '', to: '' }
            }
            setCustomRange={setAnalyticsCustomRange}
            testIdPrefix="reports"
          />
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
          <div className="reports-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'reports'}
              className={`reports-tab-btn ${tab === 'reports' ? 'active' : ''}`}
              onClick={() => setTab('reports')}
            >Reports</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'compare'}
              className={`reports-tab-btn ${tab === 'compare' ? 'active' : ''}`}
              onClick={() => setTab('compare')}
            >Compare</button>
          </div>
        </div>
      </div>

      <div className="reports-layout">
        {tab === 'reports' && (
          <div className="reports-sidebar">
            <div className="reports-sidebar-head">
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Dimensions</span>
              <span className="reports-count-badge">{dimensionCount >= 50 ? '50+' : dimensionCount} reports</span>
            </div>
            <input
              type="text"
              className="select-field reports-search"
              placeholder="Search reports…"
              value={dimSearch}
              onChange={(e) => setDimSearch(e.target.value)}
            />
            {filteredGroups.map((g) => (
              <div key={g.group}>
                <div className="reports-group-title">{g.group}</div>
                {g.dimensions.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`reports-dim-btn ${dimensionId === d.id ? 'active' : ''}`}
                    onClick={() => setDimensionId(d.id)}
                  >{d.label}</button>
                ))}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)', padding: 8 }}>No matching reports</div>
            )}
          </div>
        )}

        <div className="reports-main">
          <TradeSliceFilterBar
            trades={trades}
            selectedAccountKeys={selectedAccountKeys}
            tradeFilters={tradeFilters}
            setTradeFilters={setTradeFilters}
            resetTradeFilters={resetTradeFilters}
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            analyticsCustomRange={analyticsCustomRange}
            setAnalyticsCustomRange={setAnalyticsCustomRange}
            scopeMetricLabel={scopeMetricLabel}
            testIdPrefix="reports"
          />

          {error && <div className="reports-error">{error}</div>}

          {tab === 'reports' && (
            <>
              <div className="reports-chart-card">
                <div className="reports-card-title">
                  {report?.dimension?.label || 'Report'}
                  <span className="muted">
                    {loading ? 'computing…' : `${report?.totalTrades ?? 0} trades · ${activeFilterSummary}`}
                  </span>
                </div>
                {rows.length === 0 && !loading ? (
                  <div className="reports-empty">No trades match this filter yet.</div>
                ) : (
                  <ReactECharts option={chartOption} style={{ width: '100%', height: 300 }} notMerge lazyUpdate />
                )}
              </div>

              <div className="reports-table-card">
                <div className="reports-card-title">Breakdown table</div>
                <div className="trade-table-wrap" style={{ maxHeight: 420 }}>
                  <table className="trade-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        {TABLE_COLUMNS.map((col) => (
                          <th key={col.key} onClick={() => onSort(col.key)} style={{ cursor: 'pointer' }}>
                            {col.label}
                            <span className={`sort-arrow ${sortKey === col.key ? 'sort-arrow--active' : ''}`}>
                              {sortKey === col.key ? (sortDesc ? ' ▼' : ' ▲') : ' ↕'}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.length === 0 && (
                        <tr><td colSpan={TABLE_COLUMNS.length} className="trade-empty-state">No rows for this report.</td></tr>
                      )}
                      {sortedRows.map((r) => (
                        <tr key={r.key}>
                          <td title={r.label}>{r.label}</td>
                          <td className="td-num">{r.count}</td>
                          <td className="td-num">{r.closedCount}</td>
                          <td className="td-num">{r.wins}</td>
                          <td className="td-num">{r.losses}</td>
                          <td className="td-num">{fmtPct(r.winRatePct)}</td>
                          <td className={`td-num ${r.netPnl >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(r.netPnl)}</td>
                          <td className="td-num pos">{fmtMoney(r.avgWin)}</td>
                          <td className="td-num neg">{fmtMoney(r.avgLoss === 0 ? 0 : -Math.abs(r.avgLoss))}</td>
                          <td className="td-num">{fmtNum(r.profitFactor)}</td>
                          <td className={`td-num ${r.expectancy >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(r.expectancy)}</td>
                          <td className={`td-num ${r.totalR >= 0 ? 'pos' : 'neg'}`}>{fmtNum(r.totalR)}R</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === 'compare' && (
            <>
              <div className="reports-filter-bar">
                <div className="reports-filter-field">
                  <label>Side A</label>
                  <select className="select-field" value={compareA} onChange={(e) => setCompareA(e.target.value)}>
                    <option value="current">Current filter (app-wide)</option>
                    {savedFilters.map((sf) => <option key={sf.id} value={sf.id}>{sf.name}</option>)}
                  </select>
                </div>
                <div className="reports-filter-field">
                  <label>Side B</label>
                  <select className="select-field" value={compareB} onChange={(e) => setCompareB(e.target.value)}>
                    <option value="current">Current filter (app-wide)</option>
                    {savedFilters.map((sf) => <option key={sf.id} value={sf.id}>{sf.name}</option>)}
                  </select>
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled={compareRunning} onClick={runCompare}>
                  {compareRunning ? 'Comparing…' : 'Compare A vs B'}
                </button>
                <button type="button" className="btn btn-outline btn-sm" disabled={compareRunning} onClick={runWinsVsLosses}>
                  Wins vs Losses
                </button>
              </div>

              {savedFilters.length > 0 && (
                <div className="reports-saved-row">
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Legacy compare presets:</span>
                  {savedFilters.map((sf) => (
                    <span
                      key={sf.id}
                      className="reports-saved-chip"
                      title={`Legacy preset: ${filterSummary(sf.filter)}`}
                    >
                      {sf.name}
                      <button
                        type="button"
                        className="chip-delete"
                        title="Delete saved preset"
                        onClick={(e) => { e.stopPropagation(); deleteSavedFilter(sf.id); }}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

              {!compareResult && (
                <div className="reports-empty">
                  Pick two filter sets (or hit “Wins vs Losses”) to see side-by-side KPIs with deltas.
                </div>
              )}

              {compareResult && (
                <div className="reports-compare-grid">
                  <KpiCard
                    title={`A — ${compareResult.labels?.a || 'Side A'}`}
                    kpis={compareResult.a}
                    deltas={compareResult.deltas}
                    deltaSign={1}
                  />
                  <KpiCard
                    title={`B — ${compareResult.labels?.b || 'Side B'}`}
                    kpis={compareResult.b}
                    deltas={compareResult.deltas}
                    deltaSign={-1}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
