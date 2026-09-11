import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ProfitChart from '../ProfitChart.jsx';
import TpSlWinRateGauge from '../TpSlWinRateGauge.jsx';
import { tradeIsClosed } from '../../utils/tradeStatus.js';

function formatMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

function formatDurationHours(ms) {
  const totalHours = Number(ms || 0) / (1000 * 60 * 60);
  if (!Number.isFinite(totalHours) || totalHours <= 0) return '0h';
  if (totalHours < 1) return `${Math.round(totalHours * 60)}m`;
  return `${totalHours.toFixed(1)}h`;
}

function WidgetShell({ title, children, className = '', actions = null }) {
  return (
    <div className={`dashboard-widget-inner analytics-card ${className}`.trim()}>
      {(title || actions) && (
        <div className="dashboard-widget-head analytics-card-head">
          {title && <span>{title}</span>}
          {actions && <div className="dashboard-widget-head-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function WidgetLoading({ label = 'Loading…' }) {
  return <div className="dashboard-widget-state analytics-muted">{label}</div>;
}

function WidgetError({ message }) {
  return <div className="dashboard-widget-state dashboard-widget-state--error">{message || 'Failed to load'}</div>;
}

function WidgetEmpty({ message, action = null }) {
  return (
    <div className="dashboard-widget-state">
      <p>{message}</p>
      {action}
    </div>
  );
}

function KpiCoreWidget({ sharedCtx }) {
  const {
    totals = {},
    advanced = {},
    tpSlWinRate,
    tpHits = 0,
    slHits = 0,
    beCount = 0,
    topSymbol,
    topChannel,
    bestSession
  } = sharedCtx || {};

  return (
    <div className="analytics-kpi-grid analytics-kpi-grid-rich stagger-grid">
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '0ms' }}>
        <div className="analytics-kpi-label">Net PnL</div>
        <div className={`analytics-kpi-value ${Number(totals?.totalPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{formatMoney(totals?.totalPnl || 0)}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '80ms' }}>
        <div className="analytics-kpi-label">Gross Avg Win</div>
        <div className="analytics-kpi-value pos">{formatMoney(totals?.avgWin || 0)}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '160ms' }}>
        <div className="analytics-kpi-label">Gross Avg Loss</div>
        <div className="analytics-kpi-value neg">{formatMoney(totals?.avgLoss || 0)}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '240ms' }}>
        <div className="analytics-kpi-label">Profit Factor</div>
        <div className="analytics-kpi-value">{advanced?.profitFactor == null ? 'N/A' : Number(advanced?.profitFactor || 0).toFixed(2)}</div>
      </div>
      <div className="analytics-kpi-card analytics-kpi-card--tp-sl-winrate animate-enter" style={{ animationDelay: '320ms' }}>
        <TpSlWinRateGauge kpi tpHits={tpHits} slHits={slHits} beCount={beCount} winRatePct={tpSlWinRate} />
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '400ms' }}>
        <div className="analytics-kpi-label">Max Drawdown</div>
        <div className="analytics-kpi-value neg">{formatMoney(advanced?.maxDrawdown || 0)}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '480ms' }}>
        <div className="analytics-kpi-label">Avg Hold</div>
        <div className="analytics-kpi-value">{formatDurationHours(advanced?.avgHoldMs || 0)}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '560ms' }}>
        <div className="analytics-kpi-label">Current Streak</div>
        <div className="analytics-kpi-value">{Number(advanced?.streaks?.currentWin || 0)}W / {Number(advanced?.streaks?.currentLoss || 0)}L</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '640ms' }}>
        <div className="analytics-kpi-label">Max Streaks</div>
        <div className="analytics-kpi-value">{Number(advanced?.streaks?.maxWin || 0)}W / {Number(advanced?.streaks?.maxLoss || 0)}L</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '720ms' }}>
        <div className="analytics-kpi-label">Top Symbol</div>
        <div className="analytics-kpi-value">{topSymbol?.key || 'N/A'}</div>
        <div className="analytics-kpi-sub">{topSymbol ? formatMoney(topSymbol.pnl) : ''}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '800ms' }}>
        <div className="analytics-kpi-label">Top Channel</div>
        <div className="analytics-kpi-value">{topChannel?.key || 'N/A'}</div>
        <div className="analytics-kpi-sub">{topChannel ? formatMoney(topChannel.pnl) : ''}</div>
      </div>
      <div className="analytics-kpi-card animate-enter" style={{ animationDelay: '880ms' }}>
        <div className="analytics-kpi-label">Best Session</div>
        <div className="analytics-kpi-value">{bestSession?.name?.toUpperCase() || 'N/A'}</div>
        <div className="analytics-kpi-sub">{bestSession ? formatMoney(bestSession.pnl) : ''}</div>
      </div>
    </div>
  );
}

function EquityCurveWidget({ sharedCtx }) {
  const { analytics, timeScope, setTimeScope } = sharedCtx || {};
  return (
    <WidgetShell title="Equity Curve" className="analytics-card-chart">
      <ProfitChart
        scope={timeScope}
        onScopeChange={setTimeScope}
        onResetScope={() => setTimeScope?.('DAY')}
        chart={analytics?.chart || { points: [], totalPnl: 0 }}
      />
    </WidgetShell>
  );
}

function EfficiencyWidget({ sharedCtx }) {
  const summary = sharedCtx?.excursionSummary;
  const loading = sharedCtx?.excursionLoading;

  if (loading && !summary) return <WidgetShell title="Excursion Efficiency"><WidgetLoading /></WidgetShell>;
  if (!summary?.success) {
    return (
      <WidgetShell title="Excursion Efficiency">
        <WidgetEmpty message="Excursion data unavailable for this scope." />
      </WidgetShell>
    );
  }

  const avgEff = summary.avgEfficiencyPct;
  const left = summary.totalLeftOnTable;
  const coverage = summary.closedCount > 0
    ? Math.round((summary.withExcursion / summary.closedCount) * 100)
    : 0;

  return (
    <WidgetShell title="Excursion Efficiency">
      <div className="dashboard-efficiency-grid">
        <div className="dashboard-efficiency-stat">
          <span className="dashboard-efficiency-label">Avg efficiency</span>
          <strong className={avgEff != null && avgEff >= 60 ? 'pos' : avgEff != null ? 'warn' : ''}>
            {avgEff == null ? 'N/A' : `${Number(avgEff).toFixed(0)}%`}
          </strong>
          <small>Realized ÷ MFE on closed trades</small>
        </div>
        <div className="dashboard-efficiency-stat">
          <span className="dashboard-efficiency-label">Left on table</span>
          <strong className={Number(left || 0) > 0 ? 'warn' : ''}>
            {left == null ? 'N/A' : formatMoney(left)}
          </strong>
          <small>Peak profit not captured on winners</small>
        </div>
        <div className="dashboard-efficiency-stat">
          <span className="dashboard-efficiency-label">Coverage</span>
          <strong>{summary.withExcursion}/{summary.closedCount}</strong>
          <small>{coverage}% of closed trades have excursion data</small>
        </div>
      </div>
      {Array.isArray(summary.byChannel) && summary.byChannel.length > 0 && (
        <div className="dashboard-efficiency-channels">
          <div className="dashboard-efficiency-channels-title">By channel</div>
          {summary.byChannel.slice(0, 4).map((row) => (
            <div key={row.channel} className="dashboard-efficiency-channel-row">
              <span>{row.channel}</span>
              <span>{row.avgEfficiencyPct != null ? `${Number(row.avgEfficiencyPct).toFixed(0)}%` : '—'}</span>
              <span className="warn">{formatMoney(row.leftOnTable || 0)}</span>
            </div>
          ))}
        </div>
      )}
      {summary.withExcursion === 0 && (
        <div className="analytics-muted" style={{ marginTop: 8, fontSize: 11 }}>
          Enable EA excursion tracking or run backfill to populate metrics.
        </div>
      )}
    </WidgetShell>
  );
}

function parseTradeDay(trade) {
  const candidates = [trade?.closedAt, trade?.openedAt, trade?.lastUpdateAt, trade?.time];
  for (const value of candidates) {
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function CalendarMiniWidget({ sharedCtx }) {
  const trades = sharedCtx?.analysisTrades || [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const dailyPnl = useMemo(() => {
    const map = new Map();
    for (const t of trades) {
      if (!tradeIsClosed(t)) continue;
      const d = parseTradeDay(t);
      if (!d || d.getFullYear() !== year || d.getMonth() !== month) continue;
      const key = d.getDate();
      map.set(key, (map.get(key) || 0) + Number(t.profit || 0));
    }
    return map;
  }, [trades, year, month]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ empty: true, key: `pad-${i}` });
  for (let day = 1; day <= daysInMonth; day++) {
    const pnl = dailyPnl.get(day);
    cells.push({ day, pnl, key: `d-${day}` });
  }

  const hasData = dailyPnl.size > 0;

  return (
    <WidgetShell title={`Calendar — ${monthLabel}`}>
      {!hasData ? (
        <WidgetEmpty message="No closed trades this month in the current filter scope." />
      ) : (
        <>
          <div className="dashboard-calendar-mini-grid">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <div key={d} className="dashboard-calendar-mini-dow">{d}</div>
            ))}
            {cells.map((cell) => {
              if (cell.empty) return <div key={cell.key} className="dashboard-calendar-mini-cell dashboard-calendar-mini-cell--empty" />;
              const pnl = cell.pnl;
              const tone = pnl == null ? 'flat' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat';
              return (
                <div
                  key={cell.key}
                  className={`dashboard-calendar-mini-cell dashboard-calendar-mini-cell--${tone}`}
                  title={pnl != null ? `${cell.day}: ${formatMoney(pnl)}` : `${cell.day}: no trades`}
                >
                  <span className="dashboard-calendar-mini-day">{cell.day}</span>
                  {pnl != null && (
                    <span className="dashboard-calendar-mini-pnl">{pnl >= 0 ? '+' : ''}{Number(pnl).toFixed(0)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </WidgetShell>
  );
}

function ReportSnapshotWidget({ sharedCtx, layoutItem, editMode, onConfigChange }) {
  const dimension = String(layoutItem?.config?.dimension || 'day-of-week');
  const accountKeys = sharedCtx?.effectiveAccountKeys || [];
  const [dimensions, setDimensions] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI?.listReportDimensions?.()
      .then((res) => {
        if (!alive) return;
        if (res?.ok && Array.isArray(res.groups)) {
          const flat = res.groups.flatMap((g) => (g.dimensions || []).map((d) => ({ ...d, group: g.label || g.id })));
          setDimensions(flat);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    window.electronAPI?.computeReport?.({
      dimensionId: dimension,
      filter: accountKeys.length ? { accountKeys } : undefined
    })
      .then((res) => {
        if (!alive) return;
        if (!res?.ok) {
          setError(res?.error || 'Report failed');
          setReport(null);
        } else {
          setReport(res);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
        setReport(null);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dimension, accountKeys.join('|'), sharedCtx?.tradesRevision]);

  const rows = (report?.rows || []).slice(0, 6);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r.netPnl || 0))), 0.01);

  const dimPicker = (editMode || dimensions.length > 0) && (
    <select
      className="dashboard-widget-dim-select"
      value={dimension}
      onChange={(e) => onConfigChange?.({ dimension: e.target.value })}
      aria-label="Report dimension"
    >
      {dimensions.length === 0 && <option value={dimension}>{dimension}</option>}
      {dimensions.map((d) => (
        <option key={d.id} value={d.id}>{d.label || d.id}</option>
      ))}
    </select>
  );

  return (
    <WidgetShell title="Report snapshot" actions={dimPicker}>
      {loading && <WidgetLoading />}
      {!loading && error && <WidgetError message={error} />}
      {!loading && !error && rows.length === 0 && (
        <WidgetEmpty message="No rows for this dimension in scope." />
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="dashboard-report-bars">
          {rows.map((row) => {
            const pnl = Number(row.netPnl || 0);
            const width = Math.max(4, (Math.abs(pnl) / maxAbs) * 100);
            return (
              <div key={row.key} className="dashboard-report-bar-row">
                <span className="dashboard-report-bar-label" title={row.label || row.key}>{row.label || row.key}</span>
                <div className="dashboard-report-bar-track">
                  <div
                    className={`dashboard-report-bar-fill ${pnl >= 0 ? 'pos' : 'neg'}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className={`dashboard-report-bar-value ${pnl >= 0 ? 'pos' : 'neg'}`}>{formatMoney(pnl)}</span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}

function PropRulesWidget({ sharedCtx }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.electronAPI?.evaluateAllPropProfiles?.()
      .then((res) => {
        if (!alive) return;
        if (!res?.success) {
          setError(res?.error || 'Failed to load prop profiles');
          setRows([]);
        } else {
          setRows(Array.isArray(res.rows) ? res.rows : []);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
        setRows([]);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sharedCtx?.tradesRevision]);

  if (loading) return <WidgetShell title="Prop firm rules"><WidgetLoading /></WidgetShell>;
  if (error) return <WidgetShell title="Prop firm rules"><WidgetError message={error} /></WidgetShell>;
  if (rows.length === 0) {
    return (
      <WidgetShell title="Prop firm rules">
        <WidgetEmpty
          message="No prop profiles configured yet."
          action={(
            <button type="button" className="btn btn-outline btn-sm" onClick={() => sharedCtx?.navigateToPage?.('prop-firm')}>
              Open Prop Firm page
            </button>
          )}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title="Prop firm rules">
      <div className="dashboard-prop-list">
        {rows.map(({ profile, evaluation: ev }) => {
          if (!profile) return null;
          const targetPct = Number(profile.profitTargetPct) || 10;
          const maxDd = Number(profile.maxDrawdownPct) || 10;
          const progress = Math.min(100, Math.max(0, Number(ev?.profitProgressPct || 0)));
          const ddUsed = maxDd > 0 ? Math.min(100, (Number(ev?.maxDrawdownPctObserved || 0) / maxDd) * 100) : 0;
          const label = profile.label || profile.firm || profile.id;
          return (
            <div key={profile.id} className="dashboard-prop-card">
              <div className="dashboard-prop-card-head">
                <strong>{label}</strong>
                <span className={`dashboard-prop-status dashboard-prop-status--${ev?.status || 'in-progress'}`}>{ev?.status || 'in-progress'}</span>
              </div>
              <div className="dashboard-prop-meter">
                <span>Target {targetPct}%</span>
                <div className="dashboard-prop-meter-track">
                  <div className="dashboard-prop-meter-fill dashboard-prop-meter-fill--accent" style={{ width: `${progress}%` }} />
                </div>
                <small>{progress.toFixed(0)}%</small>
              </div>
              <div className="dashboard-prop-meter">
                <span>Drawdown {maxDd}% cap</span>
                <div className="dashboard-prop-meter-track">
                  <div className={`dashboard-prop-meter-fill ${ddUsed >= 85 ? 'dashboard-prop-meter-fill--red' : ddUsed >= 60 ? 'dashboard-prop-meter-fill--amber' : 'dashboard-prop-meter-fill--green'}`} style={{ width: `${Math.min(100, ddUsed)}%` }} />
                </div>
                <small>{Number(ev?.distanceToDdViolationUsd || 0).toFixed(0)}$ room</small>
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

function StrategyTopWidget({ sharedCtx }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.electronAPI?.getStrategyAnalytics?.()
      .then((res) => {
        if (!alive) return;
        if (!res?.success) {
          setError(res?.error || 'Failed to load strategies');
          setRows([]);
        } else {
          const sorted = [...(res.rows || [])]
            .filter((r) => !r.archived)
            .sort((a, b) => Number(b.netPnl || 0) - Number(a.netPnl || 0))
            .slice(0, 3);
          setRows(sorted);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
        setRows([]);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sharedCtx?.tradesRevision]);

  if (loading) return <WidgetShell title="Top strategies"><WidgetLoading /></WidgetShell>;
  if (error) return <WidgetShell title="Top strategies"><WidgetError message={error} /></WidgetShell>;
  if (rows.length === 0) {
    return <WidgetShell title="Top strategies"><WidgetEmpty message="No strategies with linked trades yet." /></WidgetShell>;
  }

  return (
    <WidgetShell title="Top strategies">
      <div className="dashboard-strategy-list">
        {rows.map((row, idx) => (
          <div key={row.strategyId} className="dashboard-strategy-row">
            <span className="dashboard-strategy-rank">{idx + 1}</span>
            <span className="dashboard-strategy-dot" style={{ background: row.color || 'var(--accent)' }} />
            <div className="dashboard-strategy-main">
              <strong>{row.name}</strong>
              <small>{row.closedCount} closed · WR {row.winRate != null ? `${Number(row.winRate).toFixed(0)}%` : '—'}</small>
            </div>
            <span className={`dashboard-strategy-pnl ${Number(row.netPnl || 0) >= 0 ? 'pos' : 'neg'}`}>{formatMoney(row.netPnl || 0)}</span>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

function RecentTradesWidget({ sharedCtx }) {
  const trades = sharedCtx?.analysisTrades || [];
  const recent = useMemo(() => {
    return [...trades]
      .filter(tradeIsClosed)
      .sort((a, b) => {
        const ta = new Date(a.closedAt || a.lastUpdateAt || 0).getTime();
        const tb = new Date(b.closedAt || b.lastUpdateAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 8);
  }, [trades]);

  if (recent.length === 0) {
    return <WidgetShell title="Recent trades"><WidgetEmpty message="No closed trades in this scope." /></WidgetShell>;
  }

  return (
    <WidgetShell title="Recent trades">
      <div className="dashboard-recent-trades">
        {recent.map((t) => {
          const pnl = Number(t.profit || 0);
          return (
            <button
              key={t.id}
              type="button"
              className="dashboard-recent-trade-row"
              onClick={() => sharedCtx?.onOpenTradeDetail?.(t)}
            >
              <span className="dashboard-recent-trade-symbol">{t.symbol}</span>
              <span className="dashboard-recent-trade-meta">{String(t.type || '').toUpperCase()}</span>
              <span className={`dashboard-recent-trade-pnl ${pnl >= 0 ? 'pos' : 'neg'}`}>{formatMoney(pnl)}</span>
            </button>
          );
        })}
      </div>
    </WidgetShell>
  );
}

export const WIDGET_REGISTRY = [
  {
    id: 'kpi-core',
    label: 'Core KPIs',
    description: 'Net P&L, profit factor, drawdown, streaks, and session highlights.',
    defaultSize: 'lg',
    defaultVisible: true,
    Component: KpiCoreWidget
  },
  {
    id: 'equity-curve',
    label: 'Equity curve',
    description: 'Cumulative P&L chart for the active scope.',
    defaultSize: 'lg',
    defaultVisible: true,
    Component: EquityCurveWidget
  },
  {
    id: 'efficiency',
    label: 'Excursion efficiency',
    description: 'Average MFE capture and money left on the table.',
    defaultSize: 'md',
    defaultVisible: false,
    Component: EfficiencyWidget
  },
  {
    id: 'calendar-mini',
    label: 'Mini calendar',
    description: 'Daily P&L grid for the current month.',
    defaultSize: 'md',
    defaultVisible: false,
    Component: CalendarMiniWidget
  },
  {
    id: 'report-snapshot',
    label: 'Report snapshot',
    description: 'Top breakdown rows for a chosen report dimension.',
    defaultSize: 'md',
    defaultVisible: false,
    Component: ReportSnapshotWidget
  },
  {
    id: 'prop-rules',
    label: 'Prop firm rules',
    description: 'Challenge progress and drawdown distance per profile.',
    defaultSize: 'md',
    defaultVisible: false,
    Component: PropRulesWidget
  },
  {
    id: 'strategy-top',
    label: 'Top strategies',
    description: 'Best three playbooks by net P&L.',
    defaultSize: 'sm',
    defaultVisible: false,
    Component: StrategyTopWidget
  },
  {
    id: 'recent-trades',
    label: 'Recent trades',
    description: 'Last eight closed trades in scope.',
    defaultSize: 'md',
    defaultVisible: false,
    Component: RecentTradesWidget
  }
];

export const WIDGET_BY_ID = Object.fromEntries(WIDGET_REGISTRY.map((w) => [w.id, w]));

export function getRegistryMeta() {
  return WIDGET_REGISTRY.map(({ id, label, description, defaultSize, defaultVisible }) => ({
    id,
    label,
    description,
    defaultSize,
    defaultVisible
  }));
}
