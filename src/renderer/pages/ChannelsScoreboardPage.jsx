import React, { useEffect, useMemo, useState } from 'react';
import { RadioTower } from 'lucide-react';
import AccountScopePicker from '../components/AccountScopePicker.jsx';

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

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return '—'; }
}

function WinRateSparkline({ values = [], width = 72, height = 22 }) {
  const pts = Array.isArray(values) ? values : [];
  if (pts.every((v) => v == null)) return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>;
  const coords = pts.map((v, i) => {
    const x = pts.length <= 1 ? width / 2 : (i / (pts.length - 1)) * width;
    const y = v == null ? height / 2 : height - (Math.min(100, Math.max(0, v)) / 100) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" points={coords} />
    </svg>
  );
}

export default function ChannelsScoreboardPage({
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [minClosed, setMinClosed] = useState(0);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('expectancy');
  const [sortDesc, setSortDesc] = useState(true);
  const [backtest, setBacktest] = useState(null);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [detailChannel, setDetailChannel] = useState(null);

  const refresh = async () => {
    if (!window.electronAPI?.getChannelScoreboard) return;
    setLoading(true);
    setError('');
    try {
      const res = await window.electronAPI.getChannelScoreboard({
        accountKeys: selectedAccountKeys,
        minClosedTrades: Number(minClosed) || 0
      });
      setRows(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountKeys?.join(','), minClosed]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return list;
  }, [rows, sortKey, sortDesc]);

  const onSort = (key) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const runBacktest = async (channel) => {
    if (!window.electronAPI?.runChannelBacktest) return;
    setBacktestRunning(true);
    try {
      const settings = await window.electronAPI.getSettings?.();
      const res = await window.electronAPI.runChannelBacktest({ channel, settings: settings || {} });
      setBacktest({ ...(res || {}), requestedChannel: channel });
    } finally {
      setBacktestRunning(false);
    }
  };

  return (
    <div className="dashboard-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon"><RadioTower size={18} aria-hidden="true" /></span>
          <span className="brand-name">Channel Scoreboard</span>
          <span className="subtitle">Per-provider winrate, expectancy, and replay</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
          <label style={{ fontSize: 12, color: 'var(--text2)' }}>
            Min closed trades:&nbsp;
            <input
              className="select-field"
              type="number"
              min="0"
              value={minClosed}
              onChange={(e) => setMinClosed(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 80 }}
            />
          </label>
          <button type="button" className="btn btn-outline" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}

        <div className="trade-table-wrap" style={{ maxHeight: 'calc(100vh - 240px)' }}>
          <table className="trade-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: 220 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => onSort('channel')} style={{ cursor: 'pointer' }}>Channel<span className={`sort-arrow ${sortKey === 'channel' ? 'sort-arrow--active' : ''}`}>{sortKey === 'channel' ? (sortDesc ? ' ▼' : ' ▲') : ' ↕'}</span></th>
                <th onClick={() => onSort('tradeCount')} style={{ cursor: 'pointer' }}>Total<span className={`sort-arrow ${sortKey === 'tradeCount' ? 'sort-arrow--active' : ''}`}>{sortKey === 'tradeCount' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('closedCount')} style={{ cursor: 'pointer' }}>Closed<span className={`sort-arrow ${sortKey === 'closedCount' ? 'sort-arrow--active' : ''}`}>{sortKey === 'closedCount' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('winRate')} style={{ cursor: 'pointer' }}>Win %<span className={`sort-arrow ${sortKey === 'winRate' ? 'sort-arrow--active' : ''}`}>{sortKey === 'winRate' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th title="30-day rolling daily win rate">Trend</th>
                <th onClick={() => onSort('avgWin')} style={{ cursor: 'pointer' }}>Avg Win<span className={`sort-arrow ${sortKey === 'avgWin' ? 'sort-arrow--active' : ''}`}>{sortKey === 'avgWin' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('avgLoss')} style={{ cursor: 'pointer' }}>Avg Loss<span className={`sort-arrow ${sortKey === 'avgLoss' ? 'sort-arrow--active' : ''}`}>{sortKey === 'avgLoss' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('profitFactor')} style={{ cursor: 'pointer' }}>PF<span className={`sort-arrow ${sortKey === 'profitFactor' ? 'sort-arrow--active' : ''}`}>{sortKey === 'profitFactor' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('expectancy')} style={{ cursor: 'pointer' }}>Expectancy<span className={`sort-arrow ${sortKey === 'expectancy' ? 'sort-arrow--active' : ''}`}>{sortKey === 'expectancy' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('totalPnl')} style={{ cursor: 'pointer' }}>Net P&L<span className={`sort-arrow ${sortKey === 'totalPnl' ? 'sort-arrow--active' : ''}`}>{sortKey === 'totalPnl' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th onClick={() => onSort('signalsPerDay')} style={{ cursor: 'pointer' }}>Sig/day<span className={`sort-arrow ${sortKey === 'signalsPerDay' ? 'sort-arrow--active' : ''}`}>{sortKey === 'signalsPerDay' ? (sortDesc ? ' ▼' : ' ▲') : ''}</span></th>
                <th>Last seen</th>
                <th>Replay</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && (
                <tr><td colSpan={13} className="trade-empty-state">No channel data yet — wait for signals or import an MT statement.</td></tr>
              )}
              {sortedRows.map((r, rowIdx) => (
                <tr key={r.channel} className="animate-enter" style={{ animationDelay: `${rowIdx * 40}ms` }}>
                  <td className="td-channel" title={r.channel} style={{ cursor: 'pointer' }} onClick={() => setDetailChannel(r)}>{r.channel}</td>
                  <td className="td-num">{r.tradeCount}</td>
                  <td className="td-num">{r.closedCount}</td>
                  <td className="td-num">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div className="perf-bar">
                        <div className={`perf-bar__fill ${r.winRate >= 50 ? 'pos' : r.winRate > 0 ? 'neg' : 'neu'} animate-draw-bar`} style={{ '--bar-target-width': `${Math.min(r.winRate, 100)}%`, '--draw-delay': `${rowIdx * 60}ms` }}></div>
                      </div>
                      <span>{fmtPct(r.winRate)}</span>
                    </div>
                  </td>
                  <td className="td-num" title="30-day daily win rate sparkline">
                    <WinRateSparkline values={r.trendWinRates} />
                  </td>
                  <td className="td-num pos">{fmtMoney(r.avgWin)}</td>
                  <td className="td-num neg">{fmtMoney(-Math.abs(r.avgLoss))}</td>
                  <td className="td-num">{fmtNum(r.profitFactor)}</td>
                  <td className={`td-num ${r.expectancy >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(r.expectancy)}</td>
                  <td className={`td-num ${r.totalPnl >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(r.totalPnl)}</td>
                  <td className="td-num">{fmtNum(r.signalsPerDay, 1)}</td>
                  <td className="td-num">{fmtDate(r.lastSeen)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={backtestRunning}
                      onClick={() => runBacktest(r.channel)}
                    >
                      Replay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {backtest && (
          <div className="settings-section" style={{ marginTop: 16 }}>
            <h3>🔁 Replay: {backtest.requestedChannel}</h3>
            {backtest.ok ? (
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                Replayed {backtest.totals.replayedCount} signals · would-block {backtest.totals.blockedCount} ·
                closed {backtest.totals.closedCount} · win rate {backtest.totals.winRate}% ·
                <strong style={{ color: backtest.totals.totalPnl >= 0 ? 'var(--success)' : 'var(--danger)', marginLeft: 6 }}>
                  P&L {fmtMoney(backtest.totals.totalPnl)}
                </strong>
                <p style={{ marginTop: 8, color: 'var(--text3)', fontSize: 11 }}>
                  Replay scales each historical trade's P&L by the new lot ratio computed from current settings.
                  Useful as a sanity check, not a price-replay backtest.
                </p>
              </div>
            ) : (
              <div style={{ color: 'var(--danger)' }}>{backtest.error || 'Replay failed'}</div>
            )}
          </div>
        )}

        {detailChannel && (
          <div className="modal-overlay" onClick={() => setDetailChannel(null)}>
            <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{detailChannel.channel}</h3>
                <button type="button" className="modal-close" onClick={() => setDetailChannel(null)}>×</button>
              </div>
              <div className="modal-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>Closed: {detailChannel.closedCount} · Win rate: {fmtPct(detailChannel.winRate)}</div>
                <div>Expectancy: {fmtMoney(detailChannel.expectancy)} · PF: {fmtNum(detailChannel.profitFactor)}</div>
                <div>Net P&L: {fmtMoney(detailChannel.totalPnl)}</div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>30-day win rate trend</div>
                  <WinRateSparkline values={detailChannel.trendWinRates} width={420} height={48} />
                </div>
                <div>Signals/day: {fmtNum(detailChannel.signalsPerDay, 1)}</div>
                <div>Last seen: {fmtDate(detailChannel.lastSeen)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
