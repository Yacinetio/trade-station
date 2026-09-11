import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import '../styles/propfirm.css';

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}$`;
}

function meterClass(ratio) {
  if (ratio >= 0.85) return 'propfirm-meter-fill--red';
  if (ratio >= 0.6) return 'propfirm-meter-fill--amber';
  return 'propfirm-meter-fill--green';
}

const EMPTY_FORM = {
  presetId: 'ftmo-challenge',
  accountKey: '',
  startingBalance: 10000,
  label: '',
  firm: '',
  phase: 'challenge',
  profitTargetPct: 10,
  maxDrawdownPct: 10,
  dailyLossPct: 5,
  minTradingDays: 4,
  trailingDrawdown: false,
  consistencyRulePct: ''
};

export default function PropFirmPage({ routeVisible = true, accountOptions = [] }) {
  const [profiles, setProfiles] = useState([]);
  const [evalRows, setEvalRows] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [simByProfile, setSimByProfile] = useState({});
  const [riskByProfile, setRiskByProfile] = useState({});
  const [simBusy, setSimBusy] = useState(null);
  const [shareAccounts, setShareAccounts] = useState([]);
  const [includeNotebook, setIncludeNotebook] = useState(true);
  const [includeStrategies, setIncludeStrategies] = useState(true);
  const [importResult, setImportResult] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  const accountKeys = useMemo(
    () => (Array.isArray(accountOptions) ? accountOptions.map((a) => a.key).filter(Boolean) : []),
    [accountOptions]
  );

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.evaluateAllPropProfiles) return;
    setLoading(true);
    setError('');
    try {
      const [profRes, evalRes, presetRes] = await Promise.all([
        window.electronAPI.listPropProfiles?.(),
        window.electronAPI.evaluateAllPropProfiles?.(),
        window.electronAPI.listPropPresets?.()
      ]);
      setProfiles(Array.isArray(profRes?.profiles) ? profRes.profiles : []);
      setEvalRows(Array.isArray(evalRes?.rows) ? evalRes.rows : []);
      setPresets(Array.isArray(presetRes?.presets) ? presetRes.presets : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!routeVisible) return;
    refresh();
  }, [routeVisible, refresh]);

  useEffect(() => {
    if (accountKeys.length && !form.accountKey) {
      setForm((f) => ({ ...f, accountKey: accountKeys[0] }));
    }
  }, [accountKeys, form.accountKey]);

  const evalMap = useMemo(() => {
    const m = new Map();
    for (const row of evalRows) {
      if (row?.profile?.id) m.set(row.profile.id, row);
    }
    return m;
  }, [evalRows]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, accountKey: accountKeys[0] || '' });
    setFormOpen(true);
  };

  const openEdit = (profile) => {
    setEditId(profile.id);
    setForm({
      presetId: 'custom',
      accountKey: profile.accountKey || '',
      startingBalance: profile.startingBalance || 10000,
      label: profile.label || '',
      firm: profile.firm || '',
      phase: profile.phase || 'challenge',
      profitTargetPct: profile.profitTargetPct ?? 10,
      maxDrawdownPct: profile.maxDrawdownPct ?? 10,
      dailyLossPct: profile.dailyLossPct ?? 5,
      minTradingDays: profile.minTradingDays ?? 4,
      trailingDrawdown: !!profile.trailingDrawdown,
      consistencyRulePct: profile.consistencyRulePct ?? ''
    });
    setFormOpen(true);
  };

  const onPresetChange = (presetId) => {
    const preset = presets.find((p) => p.id === presetId) || {};
    setForm((f) => ({
      ...f,
      presetId,
      label: preset.label || f.label,
      firm: preset.firm || f.firm,
      phase: preset.phase || f.phase,
      profitTargetPct: preset.profitTargetPct ?? f.profitTargetPct,
      maxDrawdownPct: preset.maxDrawdownPct ?? f.maxDrawdownPct,
      dailyLossPct: preset.dailyLossPct ?? f.dailyLossPct,
      minTradingDays: preset.minTradingDays ?? f.minTradingDays,
      trailingDrawdown: !!preset.trailingDrawdown
    }));
  };

  const saveProfile = async () => {
    setShareBusy(true);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        presetId: form.presetId,
        accountKey: form.accountKey,
        startingBalance: Number(form.startingBalance) || 10000,
        label: form.label || `${form.firm || 'Prop'} — ${form.accountKey}`,
        firm: form.firm,
        phase: form.phase,
        profitTargetPct: Number(form.profitTargetPct),
        maxDrawdownPct: Number(form.maxDrawdownPct),
        dailyLossPct: Number(form.dailyLossPct),
        minTradingDays: Number(form.minTradingDays),
        trailingDrawdown: !!form.trailingDrawdown,
        consistencyRulePct: form.consistencyRulePct === '' ? null : Number(form.consistencyRulePct)
      };
      await window.electronAPI.savePropProfile?.(payload);
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setShareBusy(false);
    }
  };

  const deleteProfile = async (id) => {
    if (!window.confirm('Delete this prop profile?')) return;
    await window.electronAPI.deletePropProfile?.(id);
    await refresh();
  };

  const runSimulation = async (profileId) => {
    setSimBusy(profileId);
    try {
      const [simRes, riskRes] = await Promise.all([
        window.electronAPI.simulateChallenge?.({ profileId }),
        window.electronAPI.getPropRiskSensitivity?.({ profileId })
      ]);
      if (simRes?.simulation) {
        setSimByProfile((m) => ({ ...m, [profileId]: simRes.simulation }));
      }
      if (riskRes?.rows) {
        setRiskByProfile((m) => ({ ...m, [profileId]: riskRes.rows }));
      }
    } finally {
      setSimBusy(null);
    }
  };

  const exportPack = async () => {
    setShareBusy(true);
    setImportResult(null);
    try {
      await window.electronAPI.exportJournalPack?.({
        accountKeys: shareAccounts.length ? shareAccounts : null,
        includeNotebook,
        includeStrategies
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setShareBusy(false);
    }
  };

  const importPack = async () => {
    setShareBusy(true);
    setImportResult(null);
    try {
      const res = await window.electronAPI.importJournalPack?.();
      if (res?.success && !res.canceled) {
        setImportResult(res);
        window.electronAPI?.refreshTrades?.();
        await refresh();
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setShareBusy(false);
    }
  };

  const toggleShareAccount = (key) => {
    setShareAccounts((prev) => (
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    ));
  };

  return (
    <div className="dashboard-shell propfirm-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon"><Trophy size={18} aria-hidden="true" /></span>
          <span className="brand-name">Prop Firm</span>
          <span className="subtitle">Challenge rules, pass simulator, journal sharing</span>
        </div>
        <div className="propfirm-actions">
          <button type="button" className="propfirm-btn propfirm-btn--primary" onClick={openCreate}>
            New profile
          </button>
          <button type="button" className="propfirm-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="propfirm-status-banner propfirm-status-banner--failed">{error}</div>}

      {formOpen && (
        <div className="propfirm-panel">
          <div className="propfirm-panel-title">{editId ? 'Edit profile' : 'Create profile from preset'}</div>
          <div className="propfirm-form-row">
            <label>
              Preset
              <select value={form.presetId} onChange={(e) => onPresetChange(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              Account
              <select value={form.accountKey} onChange={(e) => setForm((f) => ({ ...f, accountKey: e.target.value }))}>
                {accountKeys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Starting balance
              <input
                type="number"
                value={form.startingBalance}
                onChange={(e) => setForm((f) => ({ ...f, startingBalance: e.target.value }))}
              />
            </label>
            <label>
              Label
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Optional label"
              />
            </label>
          </div>
          <div className="propfirm-actions">
            <button type="button" className="propfirm-btn propfirm-btn--primary" onClick={saveProfile} disabled={shareBusy}>
              Save
            </button>
            <button type="button" className="propfirm-btn" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!profiles.length && !formOpen && (
        <div className="propfirm-empty">No prop profiles yet. Create one from a firm preset to track challenge progress.</div>
      )}

      <div className="propfirm-grid">
        {profiles.map((profile) => {
          const row = evalMap.get(profile.id) || {};
          const ev = row.evaluation || {};
          const violations = row.violations || [];
          const sim = simByProfile[profile.id];
          const riskRows = riskByProfile[profile.id] || [];
          const progressRatio = Math.min(1, Math.max(0, (ev.profitProgressPct || 0) / 100));
          const ddUsed = profile.maxDrawdownPct
            ? (ev.maxDrawdownPctObserved || 0) / profile.maxDrawdownPct
            : 0;
          const dailyUsed = profile.dailyLossPct
            ? (ev.worstDailyLossPct || 0) / profile.dailyLossPct
            : 0;

          return (
            <div key={profile.id} className="propfirm-card">
              <div className="propfirm-card-header">
                <div>
                  <div style={{ fontWeight: 600 }}>{profile.label || profile.firm}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                    {profile.accountKey} · {fmtMoney(ev.netPnl)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="propfirm-badge">{profile.firm}</span>
                  <span className="propfirm-badge propfirm-badge--phase">{profile.phase}</span>
                </div>
              </div>

              <div className={`propfirm-status-banner propfirm-status-banner--${ev.status === 'passed' ? 'passed' : ev.status === 'failed' ? 'failed' : 'in-progress'}`}>
                {(ev.status || 'in-progress').toUpperCase()}
                {ev.failReasons?.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontWeight: 400, fontSize: 12 }}>
                    {ev.failReasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
              </div>

              <div className="propfirm-meter">
                <div className="propfirm-meter-label">
                  <span>Profit target</span>
                  <span>{fmtPct(ev.netPnlPct)} / {fmtPct(profile.profitTargetPct)}</span>
                </div>
                <div className="propfirm-meter-track">
                  <div
                    className="propfirm-meter-fill propfirm-meter-fill--accent"
                    style={{ width: `${Math.min(100, progressRatio * 100)}%` }}
                  />
                </div>
              </div>

              <div className="propfirm-meter">
                <div className="propfirm-meter-label">
                  <span>Drawdown ({profile.trailingDrawdown ? 'trailing' : 'static'})</span>
                  <span>{fmtPct(ev.maxDrawdownPctObserved)} / {fmtPct(profile.maxDrawdownPct)}</span>
                </div>
                <div className="propfirm-meter-track">
                  <div className={`propfirm-meter-fill ${meterClass(ddUsed)}`} style={{ width: `${Math.min(100, ddUsed * 100)}%` }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  Room before violation: {fmtMoney(ev.distanceToDdViolationUsd)}
                </div>
              </div>

              <div className="propfirm-meter">
                <div className="propfirm-meter-label">
                  <span>Daily loss (worst day)</span>
                  <span>{fmtPct(ev.worstDailyLossPct)} / {fmtPct(profile.dailyLossPct)}</span>
                </div>
                <div className="propfirm-meter-track">
                  <div className={`propfirm-meter-fill ${meterClass(dailyUsed)}`} style={{ width: `${Math.min(100, dailyUsed * 100)}%` }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  Today&apos;s room: {fmtMoney(ev.distanceToDailyViolationUsd)}
                </div>
              </div>

              <div className="propfirm-checklist">
                <span className={`propfirm-check ${ev.minDaysMet ? 'propfirm-check--ok' : ''}`}>
                  Min days {ev.tradingDays}/{profile.minTradingDays}
                </span>
                {profile.consistencyRulePct != null && (
                  <span className={`propfirm-check ${ev.consistencyOk ? 'propfirm-check--ok' : 'propfirm-check--bad'}`}>
                    Consistency {fmtPct(ev.biggestDayPct)} / {fmtPct(profile.consistencyRulePct)}
                  </span>
                )}
                {ev.projectedDaysToTarget != null && (
                  <span className="propfirm-check">~{ev.projectedDaysToTarget}d to target</span>
                )}
              </div>

              {violations.length > 0 && (
                <table className="propfirm-violations">
                  <thead>
                    <tr><th>Date</th><th>Rule</th><th>%</th></tr>
                  </thead>
                  <tbody>
                    {violations.map((v) => (
                      <tr key={`${v.dateKey}-${v.rule}`}>
                        <td>{v.dateKey}</td>
                        <td>{v.rule}</td>
                        <td>{v.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="propfirm-actions">
                <button type="button" className="propfirm-btn" onClick={() => runSimulation(profile.id)} disabled={simBusy === profile.id}>
                  {simBusy === profile.id ? 'Simulating…' : 'Pass probability'}
                </button>
                <button type="button" className="propfirm-btn" onClick={() => openEdit(profile)}>Edit</button>
                <button type="button" className="propfirm-btn propfirm-btn--danger" onClick={() => deleteProfile(profile.id)}>Delete</button>
              </div>

              {sim && (
                <div>
                  <div className="propfirm-sim-cards">
                    <div className="propfirm-sim-card">
                      <div className="propfirm-sim-value">{fmtPct(sim.passPct)}</div>
                      <div className="propfirm-sim-label">Pass</div>
                    </div>
                    <div className="propfirm-sim-card">
                      <div className="propfirm-sim-value">{fmtPct(sim.bustPct)}</div>
                      <div className="propfirm-sim-label">Bust</div>
                    </div>
                    <div className="propfirm-sim-card">
                      <div className="propfirm-sim-value">{sim.medianDaysToPass ?? '—'}</div>
                      <div className="propfirm-sim-label">Median days</div>
                    </div>
                  </div>
                  {riskRows.length > 0 && (
                    <div className="propfirm-risk-row">
                      {riskRows.map((r) => (
                        <span key={r.scale} className="propfirm-risk-chip">
                          at {r.scale}× risk: {fmtPct(r.passPct)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="propfirm-panel">
        <div className="propfirm-panel-title">Journal pack sharing</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
          Export trades, notebook, and strategies for a mentor review. Imports appear under read-only <code>shared:*</code> accounts.
        </p>
        <div className="propfirm-share-grid">
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Export</div>
            <div className="propfirm-account-chips" style={{ marginBottom: 10 }}>
              {accountKeys.map((k) => (
                <label key={k} className="propfirm-account-chip">
                  <input
                    type="checkbox"
                    checked={shareAccounts.includes(k)}
                    onChange={() => toggleShareAccount(k)}
                  />
                  {k}
                </label>
              ))}
            </div>
            <label className="propfirm-account-chip" style={{ marginRight: 8 }}>
              <input type="checkbox" checked={includeNotebook} onChange={(e) => setIncludeNotebook(e.target.checked)} />
              Notebook
            </label>
            <label className="propfirm-account-chip">
              <input type="checkbox" checked={includeStrategies} onChange={(e) => setIncludeStrategies(e.target.checked)} />
              Strategies
            </label>
            <div className="propfirm-actions" style={{ marginTop: 12 }}>
              <button type="button" className="propfirm-btn propfirm-btn--primary" onClick={exportPack} disabled={shareBusy}>
                Export pack
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Import</div>
            <button type="button" className="propfirm-btn propfirm-btn--primary" onClick={importPack} disabled={shareBusy}>
              Import pack
            </button>
            {importResult && (
              <div className="propfirm-import-result">
                Imported {importResult.tradesImported} trades, {importResult.notesImported} notes,{' '}
                {importResult.strategiesImported} strategies ({importResult.skipped} skipped).
                Shared data uses <code>shared:*</code> account keys.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
