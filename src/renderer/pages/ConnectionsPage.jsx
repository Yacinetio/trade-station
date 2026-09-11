import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PlugZap, Database, Plus, Link2, Stethoscope, CheckCircle2, XCircle } from 'lucide-react';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

/** Sanitized placeholders for `--trade-station-e2e` recordings (no real logins, paths, or balances). */
const CONNECTIONS_RECORDING_SAFE_ROWS = [
  {
    id: 'recording-mt5-sample',
    source: 'MT5',
    accountKey: '10090042@Recording-Demo',
    accountName: 'Evaluation profile',
    broker: 'MetaTrader 5',
    type: 'Auto Sync',
    status: 'Known',
    balance: null,
    profitMethod: 'FIFO',
    lastUpdate: null,
    trades: { total: 58, open: 0, closed: 58 },
  },
  {
    id: 'recording-direct-sample',
    source: 'DIRECT',
    accountKey: '',
    accountName: 'Saved broker credentials',
    broker: 'MetaTrader 5',
    type: 'Auto Sync',
    status: 'Saved',
    balance: null,
    profitMethod: 'FIFO',
    lastUpdate: null,
    trades: null,
  },
];

export default function ConnectionsPage({
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange
}) {
  const [connections, setConnections] = useState([]);
  const [knownAccounts, setKnownAccounts] = useState([]);
  const [currentAccount, setCurrentAccount] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [tcpStatus, setTcpStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recordingSafeMode, setRecordingSafeMode] = useState(false);
  const [workingKey, setWorkingKey] = useState('');
  const [storageInfo, setStorageInfo] = useState({ accountsRoot: '', dataRoot: '' });
  const [editorOpen, setEditorOpen] = useState(false);
  const [auditResult, setAuditResult] = useState(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagRunning, setDiagRunning] = useState(false);

  const runDiagnostic = useCallback(async () => {
    setDiagRunning(true);
    try {
      const r = await window.electronAPI?.runEaDiagnostic?.();
      setDiagResult(r || null);
    } finally {
      setDiagRunning(false);
    }
  }, []);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({
    name: '',
    provider: 'MT5',
    type: 'Auto Sync',
    profitMethod: 'FIFO',
    transport: 'ea_tcp',
    region: 'eu-west',
    mode: 'full',
    auth: { login: '', server: '', password: '' }
  });
  const [cloudWorkingId, setCloudWorkingId] = useState('');
  /** Destructive action awaiting confirmation: { type, accountKey?, id?, title, message, confirmLabel } */
  const [confirmAction, setConfirmAction] = useState(null);
  /** Informational dialog: { title, message } */
  const [notice, setNotice] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let e2e = false;
      try {
        e2e = !!(await window.electronAPI?.isTradeStationE2e?.());
      } catch (_) {
        e2e = false;
      }
      setRecordingSafeMode(e2e);

      const [known, current, snap, status, allTrades, links] = await Promise.all([
        window.electronAPI?.getKnownMt5Accounts?.(),
        window.electronAPI?.getCurrentMt5Account?.(),
        window.electronAPI?.getMt5AccountSnapshot?.(),
        window.electronAPI?.getTcpStatus?.(),
        window.electronAPI?.getTrades?.(),
        window.electronAPI?.getConnections?.(),
      ]);
      setKnownAccounts(Array.isArray(known) ? known : []);
      setCurrentAccount(current || null);
      setSnapshot(snap || null);
      setTcpStatus(status || null);
      setTrades(Array.isArray(allTrades) ? allTrades : []);
      setConnections(Array.isArray(links) ? links : []);
      const storage = await window.electronAPI?.getStorageInfo?.();
      setStorageInfo({
        accountsRoot: storage?.accountsRoot || '',
        dataRoot: storage?.dataRoot || ''
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unsub = window.electronAPI?.onMt5KnownAccounts?.(() => {
      loadData();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [loadData]);

  const accountTradeStats = useMemo(() => {
    const map = new Map();
    for (const t of (trades || [])) {
      const key = String(t.accountKey || 'unknown');
      const row = map.get(key) || { total: 0, open: 0, closed: 0 };
      row.total += 1;
      const status = String(t.status || '').toUpperCase();
      const closed = status.includes('CLOSED') || status.includes('SL_HIT') || status.includes('TP_HIT');
      if (closed) row.closed += 1;
      else row.open += 1;
      map.set(key, row);
    }
    return map;
  }, [trades]);

  const rows = useMemo(() => {
    const map = new Map();
    for (const acc of (knownAccounts || [])) {
      if (!acc?.key) continue;
      map.set(acc.key, {
        key: acc.key,
        login: acc.login || '',
        server: acc.server || '',
        name: acc.name || '',
        lastSeenAt: acc.lastSeenAt || null
      });
    }
    if (snapshot?.accountKey && !map.has(snapshot.accountKey)) {
      map.set(snapshot.accountKey, {
        key: snapshot.accountKey,
        login: snapshot.accountLogin || '',
        server: snapshot.accountServer || '',
        name: snapshot.accountName || '',
        lastSeenAt: snapshot.time || null
      });
    }
    if (currentAccount?.key) {
      const prev = map.get(currentAccount.key) || { key: currentAccount.key };
      map.set(currentAccount.key, {
        ...prev,
        login: currentAccount.login || prev.login || '',
        server: currentAccount.server || prev.server || '',
        name: currentAccount.name || prev.name || '',
        lastSeenAt: prev.lastSeenAt || null
      });
    }
    return Array.from(map.values()).sort((a, b) => {
      const ta = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const tb = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return tb - ta;
    });
  }, [knownAccounts, currentAccount, snapshot]);

  const scopedTotal = useMemo(() => {
    if (selectedAccountKeys.length === 0) return trades.length;
    return trades.filter((t) => selectedAccountKeys.includes(String(t.accountKey || 'unknown'))).length;
  }, [selectedAccountKeys, trades]);

  const activeRows = useMemo(() => {
    const mtRows = rows.map((row) => {
      const stats = accountTradeStats.get(row.key) || { total: 0, open: 0, closed: 0 };
      const isCurrent = currentAccount?.key === row.key;
      return {
        id: `mt5-${row.key}`,
        source: 'MT5',
        accountKey: row.key,
        accountName: row.name || row.login || row.key,
        broker: 'MetaTrader 5',
        type: 'Auto Sync',
        status: isCurrent ? 'Connected' : 'Known',
        balance: isCurrent ? Number(snapshot?.balance || 0) : null,
        profitMethod: 'FIFO',
        lastUpdate: row.lastSeenAt || null,
        trades: stats
      };
    });
    const cfgRows = (connections || []).map((c) => ({
      id: c.id,
      source: 'DIRECT',
      accountKey: '',
      accountName: c.name || `${c.provider} ${c.auth?.login || ''}`.trim(),
      broker: c.provider === 'MT4' ? 'MetaTrader 4' : 'MetaTrader 5',
      type: c.transport === 'cloud' ? 'Cloud Bridge' : (c.type || 'Auto Sync'),
      status: c.status || 'Saved',
      balance: Number.isFinite(Number(c.balance)) ? Number(c.balance) : null,
      profitMethod: c.profitMethod || 'FIFO',
      lastUpdate: c.lastUpdate || null,
      transport: c.transport || 'ea_tcp',
      cloudState: c.cloudState || '',
      trades: null
    }));
    return [...mtRows, ...cfgRows];
  }, [rows, accountTradeStats, currentAccount, snapshot, connections]);

  const connectedCount = useMemo(
    () => activeRows.filter((row) => String(row.status || '').toLowerCase().includes('connected')).length,
    [activeRows]
  );

  const displayRows = recordingSafeMode ? CONNECTIONS_RECORDING_SAFE_ROWS : activeRows;
  const displayTcp =
    recordingSafeMode
      ? { connected: false, host: '127.0.0.1', port: '9999' }
      : tcpStatus;
  const displayStorageInfo =
    recordingSafeMode
      ? {
          dataRoot: '%USERPROFILE%\\Documents\\Trade Station\\data',
          accountsRoot: '%USERPROFILE%\\Documents\\Trade Station\\accounts',
        }
      : storageInfo;
  const summaryActiveCount =
    recordingSafeMode ? CONNECTIONS_RECORDING_SAFE_ROWS.length : activeRows.length;
  const summaryConnectedNow = recordingSafeMode ? 1 : connectedCount;
  const summaryScopedTotal = recordingSafeMode ? 212 : scopedTotal;

  const handleDeleteAccount = useCallback((accountKey) => {
    if (recordingSafeMode) return;
    if (!accountKey) return;
    const isCurrent = currentAccount?.key === accountKey;
    if (isCurrent) {
      setNotice({
        title: 'Account is currently connected',
        message: 'Cannot delete the currently connected account. Disconnect or switch account first.'
      });
      return;
    }
    setConfirmAction({
      type: 'deleteAccount',
      accountKey,
      title: 'Delete this account completely?',
      message: 'This removes local trades and forgets the account from the registry. This cannot be undone.',
      confirmLabel: 'Delete account'
    });
  }, [currentAccount?.key, recordingSafeMode]);

  const executeDeleteAccount = useCallback(async (accountKey) => {
    setWorkingKey(accountKey);
    try {
      await window.electronAPI?.deleteTradesByAccount?.(accountKey);
      await loadData();
      onSelectedAccountsChange?.((selectedAccountKeys || []).filter((k) => k !== accountKey));
    } finally {
      setWorkingKey('');
    }
  }, [loadData, onSelectedAccountsChange, selectedAccountKeys]);

  const resetForm = useCallback(() => {
    setEditingId('');
    setForm({
      name: '',
      provider: 'MT5',
      type: 'Auto Sync',
      profitMethod: 'FIFO',
      transport: 'ea_tcp',
      region: 'eu-west',
      mode: 'full',
      auth: { login: '', server: '', password: '' }
    });
  }, []);

  const openNew = useCallback(() => {
    resetForm();
    setEditorOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((conn) => {
    setEditingId(conn.id || '');
    setForm({
      name: conn.name || '',
      provider: conn.provider || 'MT5',
      type: conn.type || 'Auto Sync',
      profitMethod: conn.profitMethod || 'FIFO',
      transport: conn.transport || 'ea_tcp',
      region: conn.region || 'eu-west',
      mode: conn.mode || 'full',
      auth: {
        login: conn.auth?.login || conn.auth?.accountId || '',
        server: conn.auth?.server || '',
        // Stored passwords are never sent to the renderer; empty = keep saved one.
        password: '',
        hasPassword: !!conn.auth?.hasPassword
      }
    });
    setEditorOpen(true);
  }, []);

  const saveConnection = useCallback(async () => {
    const payload = {
      id: editingId || undefined,
      name: form.name || `${form.provider} ${form.auth.login || ''}`.trim(),
      provider: form.provider,
      type: form.type,
      profitMethod: form.profitMethod,
      transport: form.transport,
      region: form.region,
      mode: form.mode,
      auth: {
        login: form.auth.login,
        server: form.auth.server,
        password: form.auth.password
      }
    };
    await window.electronAPI?.upsertConnection?.(payload);
    setEditorOpen(false);
    resetForm();
    await loadData();
  }, [editingId, form, loadData, resetForm]);

  const removeConnection = useCallback((id) => {
    if (!id) return;
    setConfirmAction({
      type: 'deleteConnection',
      id,
      title: 'Delete this connector account?',
      message: 'The saved broker profile will be removed from this device.',
      confirmLabel: 'Delete'
    });
  }, []);

  const executeConfirmAction = useCallback(async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    if (action.type === 'deleteAccount') {
      await executeDeleteAccount(action.accountKey);
    } else if (action.type === 'deleteConnection') {
      await window.electronAPI?.deleteConnection?.(action.id);
      await loadData();
    }
  }, [confirmAction, executeDeleteAccount, loadData]);

  const testConnection = useCallback(async (id) => {
    if (!id) return;
    await window.electronAPI?.testConnection?.(id);
    await loadData();
  }, [loadData]);

  const runCloudAction = useCallback(async (action, connectionId) => {
    if (!connectionId) return;
    setCloudWorkingId(connectionId);
    try {
      const fn = {
        deploy: window.electronAPI?.cloudBridgeDeploy,
        stop: window.electronAPI?.cloudBridgeStop,
        restart: window.electronAPI?.cloudBridgeRestart,
        sync: window.electronAPI?.cloudBridgeSync
      }[action];
      const result = await fn?.(connectionId);
      if (result && result.success === false) {
        const reason = result.reason || 'UNKNOWN';
        setNotice({
          title: `Cloud ${action} failed`,
          message: `${reason}\n\nMake sure start-cloud-bridge.bat is running (3 console windows).`
        });
        return;
      }
      if (action === 'sync' && result?.summary) {
        setNotice({
          title: 'Cloud sync started',
          message: `${result.summary}\n\nCheck Trades in a few seconds.`
        });
      }
      await loadData();
    } catch (err) {
      setNotice({ title: `Cloud ${action} error`, message: String(err?.message || err) });
    } finally {
      setCloudWorkingId('');
    }
  }, [loadData]);

  const providerHint = useMemo(() => {
    return String(form.provider || 'MT5').toUpperCase() === 'MT4'
      ? 'MT4 profile: server/login/password (saved locally).'
      : 'MT5 profile: server/login/password (saved locally).';
  }, [form.provider]);

  return (
    <div className="dashboard-shell connections-shell" data-testid="page-connections">
      <div className="titlebar">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon"><PlugZap size={16} /></span>
          <span className="brand-name">Connections</span>
          <span className="subtitle">Connected MT4/MT5 accounts and account registry</span>
        </div>
        <div className="titlebar-actions">
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
          <button type="button" data-testid="connections-refresh" className="btn btn-outline btn-titlebar" onClick={loadData} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" data-testid="connections-add-account" className="btn btn-titlebar btn-primary" onClick={openNew}>
            <Plus size={14} />
            Add New Account
          </button>
        </div>
      </div>

      <div className="connections-page-wrap" data-onboarding="connections-workspace">
        <div className="connections-summary-grid">
          <div className="connections-summary-card animate-enter" style={{ animationDelay: '0ms' }}>
            <div className="connections-label">MT5 bridge</div>
            <div className={`connections-value ${displayTcp?.connected ? 'pos' : 'neg'}`}>
              {displayTcp?.connected ? 'Connected' : 'Disconnected'}
            </div>
            <div className="connections-subvalue">
              {displayTcp?.transport === 'cloud'
                ? `Cloud · ${displayTcp?.cloudAccountId || '—'}`
                : `TCP ${displayTcp?.host || '127.0.0.1'}:${displayTcp?.port || '9999'}`}
            </div>
          </div>
          <div className="connections-summary-card animate-enter" style={{ animationDelay: '80ms' }}>
            <div className="connections-label">Active accounts</div>
            <div className="connections-value">{summaryActiveCount}</div>
            <div className="connections-subvalue">{summaryScopedTotal} scoped trade rows</div>
          </div>
          <div className="connections-summary-card animate-enter" style={{ animationDelay: '160ms' }}>
            <div className="connections-label">Connected now</div>
            <div className="connections-value">{summaryConnectedNow}</div>
            <div className="connections-subvalue">{summaryActiveCount - summaryConnectedNow} saved profiles</div>
          </div>
          <div className="connections-summary-card animate-enter" style={{ animationDelay: '240ms' }}>
            <div className="connections-label">Current MT5 account</div>
            {!recordingSafeMode ? (
              <>
                <div className="connections-value">
                  {currentAccount?.login ? `${currentAccount.login}${currentAccount.server ? `@${currentAccount.server}` : ''}` : 'None'}
                </div>
                <div className="connections-subvalue">{currentAccount?.name || 'No active account identity'}</div>
              </>
            ) : (
              <>
                <div className="connections-value">None</div>
                <div className="connections-subvalue">Connect the EA to populate identity here</div>
              </>
            )}
          </div>
        </div>

        <div className="connections-table-wrap">
          <div className="connections-section-head">
            <div className="connections-section-title"><Database size={14} /> Active Accounts</div>
            <div className="connections-section-sub">
              {recordingSafeMode ? 'Demonstration placeholders for screen capture.' : 'Real account data only. No mock connectors.'}
            </div>
          </div>
          <table className="stats-table">
            <thead>
              <tr>
                <th>Account Name</th>
                <th>Broker</th>
                <th>Status</th>
                <th>Type</th>
                <th>Balance</th>
                <th>Profit Method</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIdx) => {
                const isCurrent =
                  !recordingSafeMode && row.source === 'MT5' && currentAccount?.key === row.accountKey;
                return (
                  <tr key={row.id} className={isCurrent ? 'account-row--active' : ''}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{row.accountName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {row.source === 'MT5' ? row.accountKey : row.id}
                      </div>
                    </td>
                    <td>{row.broker}</td>
                    <td>
                      <span className={`connections-badge ${
                        String(row.status || '').toLowerCase().includes('connected')
                          ? 'current'
                          : row.source === 'MT5'
                            ? 'known'
                            : 'planned'
                      }`}>
                        {isCurrent ? 'Current' : row.status}
                      </span>
                    </td>
                    <td>{row.type}</td>
                    <td>{Number.isFinite(row.balance) ? `$${row.balance.toFixed(2)}` : '—'}</td>
                    <td>{row.profitMethod}</td>
                    <td>{row.lastUpdate ? new Date(row.lastUpdate).toLocaleString() : '—'}</td>
                    <td>
                      {recordingSafeMode ? (
                        <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
                      ) : (
                        <div className="connections-actions">
                          {row.source === 'MT5' ? (
                            <>
                              <button className="btn btn-outline" onClick={() => onSelectedAccountsChange?.([row.accountKey])}>Scope</button>
                              <button className="btn btn-outline" onClick={() => handleDeleteAccount(row.accountKey)} disabled={isCurrent || workingKey === row.accountKey}>Delete Account</button>
                            </>
                          ) : (
                            <>
                              {row.transport === 'cloud' ? (
                                <>
                                  <button className="btn btn-outline" disabled={cloudWorkingId === row.id} onClick={() => runCloudAction('deploy', row.id)}>Deploy</button>
                                  <button className="btn btn-outline" disabled={cloudWorkingId === row.id} onClick={() => runCloudAction('stop', row.id)}>Stop</button>
                                  <button className="btn btn-outline" disabled={cloudWorkingId === row.id} onClick={() => runCloudAction('restart', row.id)}>Restart</button>
                                  <button className="btn btn-outline" disabled={cloudWorkingId === row.id} onClick={() => runCloudAction('sync', row.id)}>Sync</button>
                                </>
                              ) : (
                                <button className="btn btn-outline" onClick={() => testConnection(row.id)}>Test</button>
                              )}
                              <button className="btn btn-outline" onClick={() => openEdit(connections.find((c) => c.id === row.id) || {})}>Edit</button>
                              <button className="btn btn-outline" onClick={() => removeConnection(row.id)}>Delete</button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)' }}>
                    No accounts yet. Add an MT4/MT5 account profile or connect MT5.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="connections-panel" data-testid="connections-diagnostic-panel">
          <div className="connections-section-title"><Stethoscope size={14} /> EA setup diagnostic</div>
          <div className="connections-section-sub">
            Checks the full chain: bridge listening → EA handshake → Algo Trading → account permission → quote flow.
          </div>
          <button
            type="button"
            className="btn btn-outline"
            style={{ marginBottom: 10 }}
            disabled={diagRunning}
            data-testid="connections-run-diagnostic"
            onClick={runDiagnostic}
          >
            {diagRunning ? 'Running diagnostic…' : 'Run EA diagnostic'}
          </button>
          {diagResult && (
            <div className="connections-next-step">
              <div style={{ fontWeight: 700, marginBottom: 6, color: diagResult.allOk ? 'var(--success, #22c55e)' : 'var(--warning, #eab308)' }}>
                {diagResult.allOk ? 'All checks passed — EA is ready.' : 'Some checks failed — fix the items below.'}
              </div>
              {(diagResult.checks || []).map((check) => (
                <div key={check.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginTop: 4 }}>
                  {check.ok
                    ? <CheckCircle2 size={14} style={{ color: 'var(--success, #22c55e)', flexShrink: 0, marginTop: 1 }} aria-label="Passed" />
                    : <XCircle size={14} style={{ color: 'var(--danger, #ef4444)', flexShrink: 0, marginTop: 1 }} aria-label="Failed" />}
                  <div>
                    <span style={{ fontWeight: 600 }}>{check.label}</span>
                    {check.detail ? <span style={{ color: 'var(--text3)' }}> — {check.detail}</span> : null}
                    {!check.ok && check.hint ? (
                      <div style={{ color: 'var(--warning, #eab308)', marginTop: 2 }}>{check.hint}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="connections-panel" data-testid="connections-storage-panel">
          <div className="connections-section-title"><Link2 size={14} /> Data integrity</div>
          <div className="connections-section-sub">Compare stored trades vs MT5 snapshot for drift.</div>
          <button
            type="button"
            className="btn btn-outline"
            style={{ marginBottom: 10 }}
            disabled={auditRunning}
            onClick={async () => {
              setAuditRunning(true);
              try {
                const r = await window.electronAPI?.runDataIntegrityAudit?.();
                setAuditResult(r || null);
              } finally {
                setAuditRunning(false);
              }
            }}
          >
            {auditRunning ? 'Running audit…' : 'Run audit'}
          </button>
          {auditResult && (
            <div className="connections-next-step" style={{ marginBottom: 12 }}>
              <div>Trades: {auditResult.tradeCount} · Live: {auditResult.liveCount} · Issues: {auditResult.issueCount}</div>
              {(auditResult.issues || []).slice(0, 5).map((issue) => (
                <div key={issue.code} style={{ fontSize: 12, marginTop: 4, color: issue.severity === 'warn' ? 'var(--warning)' : 'var(--text2)' }}>
                  {issue.message}
                </div>
              ))}
            </div>
          )}
          <div className="connections-section-title"><Link2 size={14} /> Storage</div>
          <div className="connections-section-sub">Data root and account files currently in use.</div>
          <div className="connections-next-step">
            Data root: {displayStorageInfo.dataRoot || 'Unavailable'}<br />
            Accounts root: {displayStorageInfo.accountsRoot || 'Unavailable'}
          </div>
        </div>
      </div>

      {editorOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setEditorOpen(false)}>
          <div className="modal animate-scale-in" style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Account' : 'Add New Account'}</h2>
              <button className="modal-close" onClick={() => setEditorOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="settings-section">
                <h3>Identity</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>Account Name</label>
                    <input className="select-field" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="FundedNext MT5" />
                  </div>
                  <div className="form-group">
                    <label>Platform</label>
                    <select className="select-field" value={form.provider} onChange={(e) => setForm((prev) => ({ ...prev, provider: e.target.value }))}>
                      <option value="MT4">MetaTrader 4</option>
                      <option value="MT5">MetaTrader 5</option>
                    </select>
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <div className="form-group">
                    <label>Transport</label>
                    <select className="select-field" value={form.transport} onChange={(e) => setForm((prev) => ({ ...prev, transport: e.target.value }))}>
                      <option value="ea_tcp">Local EA (TCP)</option>
                      <option value="cloud">Cloud Bridge</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Region</label>
                    <select className="select-field" value={form.region} onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}>
                      <option value="eu-west">EU West</option>
                      <option value="us-east">US East</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Mode</label>
                    <select className="select-field" value={form.mode} onChange={(e) => setForm((prev) => ({ ...prev, mode: e.target.value }))}>
                      <option value="full">Full (sync + execute)</option>
                      <option value="sync_only">Sync only</option>
                    </select>
                  </div>
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {form.transport === 'cloud'
                    ? 'Cloud Bridge: no local EA required. Deploy from the accounts table after saving.'
                    : providerHint}
                </div>
              </div>

              <div className="settings-section">
                <h3>Credentials</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>Server</label>
                    <input className="select-field" value={form.auth.server} onChange={(e) => setForm((prev) => ({ ...prev, auth: { ...prev.auth, server: e.target.value } }))} placeholder="FundedNext-Server4" />
                  </div>
                  <div className="form-group">
                    <label>Login</label>
                    <input className="select-field" value={form.auth.login} onChange={(e) => setForm((prev) => ({ ...prev, auth: { ...prev.auth, login: e.target.value } }))} placeholder="78642266" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input className="select-field" type="password" value={form.auth.password} onChange={(e) => setForm((prev) => ({ ...prev, auth: { ...prev.auth, password: e.target.value } }))} placeholder={form.auth.hasPassword ? 'Leave blank to keep saved password' : '********'} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="btn btn-outline" onClick={saveConnection}>Save Account</button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger
          onCancel={() => setConfirmAction(null)}
          onConfirm={executeConfirmAction}
        />
      )}
      {notice && (
        <ConfirmModal
          title={notice.title}
          message={notice.message}
          confirmLabel="OK"
          hideCancel
          onCancel={() => setNotice(null)}
          onConfirm={() => setNotice(null)}
        />
      )}
    </div>
  );
}
