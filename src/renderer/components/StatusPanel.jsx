import React, { useMemo, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';

function fmtLastUpdate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export default function StatusPanel({
  mt5Connected,
  bridgeMeta = { fileBridge: false, fileHandshake: false },
  trades,
  lastUpdatedAt,
  accountSnapshot,
  currentMt5Account,
  settings,
  onConfigure,
  analytics
}) {
  const stats = analytics?.totals || {
    wins: 0,
    losses: 0,
    tpHits: 0,
    slHits: 0,
    totalPnl: 0,
    winRate: 0,
    rr: 0,
    avgWin: 0,
    avgLoss: 0,
    breakevens: 0,
    eodCloses: 0,
    otherCloses: 0
  };
  const advanced = analytics?.advanced || {};
  const pendingTrades = useMemo(
    () => trades.filter((t) => String(t.status || '').toUpperCase() === 'PENDING').length,
    [trades]
  );
  const blockedTrades = useMemo(
    () => trades.filter((t) => {
      const s = String(t.status || '').toUpperCase();
      return s.includes('BLOCKED') || Boolean(t.blockedReason);
    }).length,
    [trades]
  );
  const closedTrades = Number(analytics?.closedCount || 0);

  const [eaHealth, setEaHealth] = useState(null);
  const [guardState, setGuardState] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () => window.electronAPI?.getDrawdownGuardStatus?.().then((res) => {
      if (active) setGuardState(res || null);
    }).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { active = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => window.electronAPI?.getEaHealth?.().then((h) => {
      if (active) setEaHealth(h || null);
    }).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => { active = false; clearInterval(t); };
  }, [mt5Connected]);

  const lotMode = settings?.lotMode || 'percentage';
  let lotLabel = 'Balance %';
  let lotMain = `${settings?.lotPercentage ?? 1}%`;
  let lotHint = 'Notional vs equity (approx.).';

  if (lotMode === 'fixed') {
    lotLabel = 'Fixed lot';
    lotMain = `${settings?.fixedLot ?? 0.01} lots`;
    lotHint = 'Same volume on each execution.';
  } else if (lotMode === 'risk') {
    lotLabel = 'Risk ($)';
    lotMain = `$${settings?.riskAmount ?? 100} at risk`;
    lotHint = 'Lots ≈ risk ÷ (stop distance in $/pip per lot).';
  } else if (lotMode === 'riskpct') {
    lotLabel = 'Risk %';
    lotMain = `${settings?.riskPct ?? 1}% of equity`;
    lotHint = 'Lots sized from stop distance.';
  } else if (lotMode === 'signal' || lotMode === 'from_signal') {
    lotLabel = 'From signal';
    lotMain = 'Parsed lot';
    lotHint = 'Volume copied from Telegram text.';
  }
  const tpMode = String(settings?.tpMode || 'separate').toLowerCase();
  const tpModeLabel = (
    tpMode === 'separate' ? 'Separate Trades'
    : tpMode === 'first' ? 'First TP Only'
    : tpMode === 'last' ? 'Last TP Only'
    : tpMode === 'average' ? 'Average TP'
    : tpMode === 'all_in_one' || tpMode === 'all-in-one' ? 'All in One'
    : tpMode.charAt(0).toUpperCase() + tpMode.slice(1)
  );

  const ddTier = guardState?.state?.tier;
  const tierBadgeClass = ddTier === 'yellow' ? 'badge-pending' : ddTier === 'orange' ? 'badge-blocked' : ddTier === 'red' ? 'badge-error' : null;

  const toggleDryRun = async () => {
    if (!settings) return;
    try {
      await window.electronAPI?.saveSettings?.({ ...settings, dryRunMode: !settings.dryRunMode });
    } catch (_) { /* noop */ }
  };

  return (
    <div className="right-panel" data-onboarding="status-panel">
      {/* ── Connection Status ── */}
      <div className="panel-section">
        <h4>Connections</h4>
        <div className="connection-status-grid">
          <div className="conn-status-item">
            <span className="conn-icon">📈</span>
            <span className="conn-label">MT5</span>
            <span className={`conn-badge ${mt5Connected ? 'connected' : 'disconnected'}`}>
              {mt5Connected ? 'Connected' : 'Offline'}
            </span>
          </div>
          {currentMt5Account?.key && (
            <div className="conn-account">
              {currentMt5Account.login}@{currentMt5Account.server}
            </div>
          )}
        </div>
        {(!mt5Connected && bridgeMeta?.fileBridge && !bridgeMeta?.fileHandshake) && (
          <div className="status-bridge-hint">
            ⚠️ File bridge waiting for MT4 EA
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button
            type="button"
            className={`badge ${settings?.dryRunMode ? 'badge-pending' : 'badge-status'}`}
            style={{ cursor: 'pointer', border: 'none', padding: '4px 10px' }}
            onClick={toggleDryRun}
            title="Dry run — signals simulated, nothing sent to MetaTrader"
          >
            {settings?.dryRunMode ? 'Dry run ON' : 'Dry run OFF'}
          </button>
          {tierBadgeClass && ddTier !== 'none' && (
            <span
              className={`badge ${tierBadgeClass}`}
              title={guardState?.state?.dailyLossPct != null ? `Daily loss ${Number(guardState.state.dailyLossPct).toFixed(2)}%` : 'Drawdown tier'}
            >
              DD {String(ddTier).toUpperCase()}
            </span>
          )}
        </div>
        <div className="status-ea-health" style={{ marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
          <div>
            <strong>MetaTrader link</strong>
            {' — '}
            {eaHealth?.lastHeartbeatAgeSec != null ? `last seen ${eaHealth.lastHeartbeatAgeSec}s ago` : 'not seen yet'}
          </div>
          {eaHealth?.settingsMismatch && (
            <div style={{ color: 'var(--warning)', marginTop: 4 }}>
              MetaTrader has older settings — click below to resend them
            </div>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginTop: 6, width: '100%' }}
            onClick={() => window.electronAPI?.forceEaSettingsUpdate?.()}
            title="Resend your current settings to the EA in MetaTrader"
          >
            Sync settings to MetaTrader
          </button>
        </div>
      </div>

      {/* ── Session Metrics ── */}
      <div className="panel-section">
        <h4>Session Metrics</h4>
        <div className="metric-grid">
          <div className="metric-item">
            <div className="metric-label">Total Signals</div>
            <div className="metric-value">{trades.length}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Closed</div>
            <div className="metric-value">{closedTrades}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Pending</div>
            <div className="metric-value metric-warning">{pendingTrades}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Blocked</div>
            <div className="metric-value" style={{ color: '#c9a227' }} title="Not sent to MT5 (schedule / news / filters)">
              {blockedTrades}
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Balance</div>
            <div className="metric-value">{accountSnapshot ? `${Number(accountSnapshot.balance || 0).toFixed(2)}$` : '—'}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Equity</div>
            <div className="metric-value">{accountSnapshot ? `${Number(accountSnapshot.equity || 0).toFixed(2)}$` : '—'}</div>
          </div>
          <div className="metric-item metric-item-wide">
            <div className="metric-label">Last Update</div>
            <div className="metric-value accent metric-value-sm">
              {fmtLastUpdate(lastUpdatedAt)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Performance ── */}
      <div className="panel-section">
        <h4>Performance</h4>
        {/* Win Rate bar */}
        <div className="perf-block">
          <div className="perf-head">
            <span className="perf-label">WIN RATE (TP/SL)</span>
            <span className={`perf-value ${Number(stats.winRate || 0) >= 50 ? 'pos' : 'neg'}`}>{Number(stats.winRate || 0).toFixed(1)}%</span>
          </div>
          <div className="perf-track">
            <div className={`perf-fill ${Number(stats.winRate || 0) >= 50 ? 'pos' : 'neg'}`} style={{ width: `${Number(stats.winRate || 0)}%` }} />
          </div>
          <div className="perf-foot">
            <span>{Number(stats.tpHits ?? stats.wins ?? 0)} TP</span>
            <span>{Number(stats.slHits ?? stats.losses ?? 0)} SL</span>
            <span>{Number(stats.breakevens || 0)} BE</span>
            <span>{Number(stats.eodCloses || 0)} EOD</span>
            <span>{Number(stats.otherCloses || 0)} Other</span>
          </div>
        </div>

        {/* R:R */}
        <div className="perf-row">
          <span className="perf-row-label">Avg R:R</span>
          <span className={`perf-row-value ${stats.rr >= 1 ? 'pos' : 'warn'}`}>
            1 : {Number(stats.rr || 0).toFixed(2)}
          </span>
        </div>

        {/* Total P&L */}
        <div className="perf-row">
          <span className="perf-row-label">Total P&L</span>
          <span className={`perf-row-value ${stats.totalPnl >= 0 ? 'pos' : 'neg'}`}>
            {Number(stats.totalPnl || 0) >= 0 ? '+' : ''}{Number(stats.totalPnl || 0).toFixed(2)}$
          </span>
        </div>

        {/* Avg Win / Avg Loss */}
        <div className="perf-mini-grid">
          <div className="perf-mini-card perf-mini-card-win">
            <div className="perf-mini-label">AVG WIN</div>
            <div className="perf-mini-value pos">+{Number(stats.avgWin || 0).toFixed(2)}$</div>
          </div>
          <div className="perf-mini-card perf-mini-card-loss">
            <div className="perf-mini-label">AVG LOSS</div>
            <div className="perf-mini-value neg">-{Number(stats.avgLoss || 0).toFixed(2)}$</div>
          </div>
          <div className="perf-mini-card">
            <div className="perf-mini-label">EXPECTANCY</div>
            <div className={`perf-mini-value ${(advanced.expectancy || 0) >= 0 ? 'pos' : 'neg'}`}>
              {(advanced.expectancy || 0) >= 0 ? '+' : ''}{Number(advanced.expectancy || 0).toFixed(2)}$
            </div>
          </div>
          <div className="perf-mini-card">
            <div className="perf-mini-label">MAX DRAWDOWN</div>
            <div className="perf-mini-value neg">-{Number(advanced.maxDrawdown || 0).toFixed(2)}$</div>
          </div>
        </div>
        <div className="perf-row">
          <span className="perf-row-label">Profit Factor</span>
          <span className="perf-row-value">{advanced.profitFactor == null ? '∞' : Number(advanced.profitFactor).toFixed(2)}</span>
        </div>
        <div className="perf-row">
          <span className="perf-row-label">Longest Win Streak</span>
          <span className="perf-row-value pos">{Number(advanced?.streaks?.maxWin || 0)}</span>
        </div>
        <div className="perf-row">
          <span className="perf-row-label">Longest Loss Streak</span>
          <span className="perf-row-value neg">{Number(advanced?.streaks?.maxLoss || 0)}</span>
        </div>
      </div>

      {/* ── Lot Sizing ── */}
      <div className="panel-section">
        <h4>Lot Sizing</h4>
        <div className="status-item status-item-tight">
          <span className="label">Mode</span>
          <span className="lot-mode-badge">{lotLabel}</span>
        </div>
        <div className="lot-pct">{lotMain}</div>
        <div className="trade-mode-hint">{lotHint}</div>
        <button className="btn-configure" onClick={onConfigure}>Configure</button>
      </div>

      {/* ── Trade Mode ── */}
      <div className="panel-section">
        <h4>Trade Mode</h4>
        <div className="trade-mode-label">TP Strategy:</div>
        <div className="trade-mode-value">{tpModeLabel}</div>
        {tpMode === 'separate' && <div className="trade-mode-hint">Lot split across the TP targets</div>}
        {tpMode === 'first' && <div className="trade-mode-hint">Single position closed at TP1</div>}
        {tpMode === 'last' && <div className="trade-mode-hint">Single position riding to last TP</div>}
        {tpMode === 'average' && <div className="trade-mode-hint">Single position to average TP</div>}
        {settings?.reverseMode && settings.reverseMode !== 'none' && (
          <div className="trade-mode-reverse">🔄 Reverse mode: {settings.reverseMode}</div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="right-panel-actions">
        <button className="btn-settings" onClick={onConfigure}><Settings size={14} />Settings</button>
      </div>
    </div>
  );
}
