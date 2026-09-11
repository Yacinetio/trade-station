import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import '../styles/strategies.css';

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}$`;
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
}

/** Inline SVG equity sparkline — no chart-library imports on this page. */
function EquitySparkline({ points = [], width = 120, height = 28 }) {
  const values = (Array.isArray(points) ? points : [])
    .map((p) => Number(p?.equity))
    .filter((v) => Number.isFinite(v));
  if (values.length < 2) {
    return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>;
  }
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const coords = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * height}`)
    .join(' ');
  const positive = values[values.length - 1] >= 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline
        fill="none"
        stroke={positive ? 'var(--success)' : 'var(--danger)'}
        strokeWidth="1.5"
        points={coords}
      />
    </svg>
  );
}

function csvToList(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const EMPTY_DRAFT = null;

export default function StrategiesPage({ routeVisible = true }) {
  const [tab, setTab] = useState('strategies');
  const [strategies, setStrategies] = useState([]);
  const [analytics, setAnalytics] = useState({ rows: [], mistakes: [], missedTotalR: 0 });
  const [missed, setMissed] = useState([]);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Detail drawer
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [expandedTradeId, setExpandedTradeId] = useState(null);

  // Modals
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateQuery, setTemplateQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [exportJson, setExportJson] = useState('');

  // Missed-trade form
  const [missedForm, setMissedForm] = useState({
    symbol: '', direction: 'BUY', plannedEntry: '', plannedSl: '', plannedTp: '', strategyId: '', reasonMissed: ''
  });
  const [simulatingId, setSimulatingId] = useState(null);

  const api = window.electronAPI;

  const refresh = useCallback(async () => {
    if (!api?.listStrategies) return;
    try {
      const [stratRes, analyticsRes, missedRes, tradeRows] = await Promise.all([
        api.listStrategies({ includeArchived: true }),
        api.getStrategyAnalytics?.(),
        api.listMissedTrades?.(),
        api.getTrades?.()
      ]);
      setStrategies(Array.isArray(stratRes?.strategies) ? stratRes.strategies : []);
      if (analyticsRes?.success) {
        setAnalytics({
          rows: analyticsRes.rows || [],
          mistakes: analyticsRes.mistakes || [],
          missedTotalR: Number(analyticsRes.missedTotalR) || 0
        });
      }
      setMissed(Array.isArray(missedRes?.missed) ? missedRes.missed : []);
      setTrades(Array.isArray(tradeRows) ? tradeRows : []);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [api]);

  useEffect(() => {
    if (!routeVisible) return undefined;
    refresh().catch(() => {});
    const off = api?.onStrategiesChanged?.(() => refresh().catch(() => {}));
    return () => { if (typeof off === 'function') off(); };
  }, [routeVisible, refresh, api]);

  const analyticsById = useMemo(() => {
    const map = new Map();
    for (const row of analytics.rows) map.set(String(row.strategyId), row);
    return map;
  }, [analytics.rows]);

  const selectedStrategy = useMemo(
    () => strategies.find((s) => String(s.id) === String(selectedId)) || null,
    [strategies, selectedId]
  );

  const linkedTrades = useMemo(() => {
    if (!selectedId) return [];
    return trades
      .filter((t) => String(t?.strategyId || '') === String(selectedId))
      .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));
  }, [trades, selectedId]);

  const missedTotalR = useMemo(() => (
    missed.filter((m) => m?.simulated).reduce((a, m) => a + (Number(m.simulated.pnlR) || 0), 0)
  ), [missed]);

  const openDrawer = (strategy) => {
    setSelectedId(strategy.id);
    setExpandedTradeId(null);
    setDraft({
      ...strategy,
      rules: (strategy.rules || []).map((r) => ({ ...r })),
      linkedTagsText: (strategy.linkedTags || []).join(', '),
      linkedChannelsText: (strategy.linkedChannels || []).join(', ')
    });
  };

  const closeDrawer = () => {
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setExportJson('');
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const res = await api?.saveStrategy?.({
        id: draft.id,
        name: draft.name,
        description: draft.description,
        color: draft.color,
        rules: draft.rules.filter((r) => String(r.text || '').trim()),
        entryCriteria: draft.entryCriteria,
        exitCriteria: draft.exitCriteria,
        riskRules: draft.riskRules,
        linkedTags: csvToList(draft.linkedTagsText),
        linkedChannels: csvToList(draft.linkedChannelsText),
        archived: !!draft.archived
      });
      if (!res?.success) setError(res?.error || 'Save failed');
      else await refresh();
    } finally {
      setBusy(false);
    }
  };

  const createBlank = async () => {
    const res = await api?.saveStrategy?.({ name: 'New strategy', rules: [] });
    if (res?.success) {
      await refresh();
      openDrawer(res.strategy);
    } else if (res?.error) {
      setError(res.error);
    }
  };

  const deleteSelected = async () => {
    if (!selectedId) return;
    const res = await api?.deleteStrategy?.(selectedId);
    if (!res?.success) setError(res?.error || 'Delete failed');
    closeDrawer();
    await refresh();
  };

  const doExport = async () => {
    if (!selectedId) return;
    const res = await api?.exportStrategy?.(selectedId);
    if (res?.success) setExportJson(res.json);
    else setError(res?.error || 'Export failed');
  };

  const openTemplates = async () => {
    setTemplateOpen(true);
    setTemplateQuery('');
    if (templates.length === 0) {
      const res = await api?.listStrategyTemplates?.();
      setTemplates(Array.isArray(res?.templates) ? res.templates : []);
    }
  };

  const useTemplate = async (templateId) => {
    setBusy(true);
    try {
      const res = await api?.createStrategyFromTemplate?.(templateId);
      if (res?.success) {
        setTemplateOpen(false);
        await refresh();
        openDrawer(res.strategy);
      } else {
        setError(res?.error || 'Template failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api?.importStrategy?.(importText);
      if (res?.success) {
        setImportOpen(false);
        setImportText('');
        await refresh();
        openDrawer(res.strategy);
      } else {
        setError(res?.error || 'Import failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => (
      t.name.toLowerCase().includes(q)
      || String(t.description || '').toLowerCase().includes(q)
      || (t.suggestedTags || []).some((tag) => String(tag).toLowerCase().includes(q))
    ));
  }, [templates, templateQuery]);

  const addMissed = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!missedForm.symbol.trim()) { setError('Symbol is required for a missed trade.'); return; }
    const res = await api?.addMissedTrade?.({
      symbol: missedForm.symbol,
      direction: missedForm.direction,
      plannedEntry: missedForm.plannedEntry === '' ? null : Number(missedForm.plannedEntry),
      plannedSl: missedForm.plannedSl === '' ? null : Number(missedForm.plannedSl),
      plannedTp: missedForm.plannedTp === '' ? null : Number(missedForm.plannedTp),
      strategyId: missedForm.strategyId || null,
      reasonMissed: missedForm.reasonMissed,
      at: new Date().toISOString()
    });
    if (res?.success) {
      setMissedForm({ symbol: '', direction: 'BUY', plannedEntry: '', plannedSl: '', plannedTp: '', strategyId: missedForm.strategyId, reasonMissed: '' });
      await refresh();
    } else {
      setError(res?.error || 'Could not add missed trade');
    }
  };

  const simulateMissed = async (missedId) => {
    setSimulatingId(missedId);
    setError('');
    try {
      const res = await api?.simulateMissedTrade?.(missedId);
      if (!res?.success) setError(res?.error || 'Simulation failed');
      await refresh();
    } finally {
      setSimulatingId(null);
    }
  };

  const setRuleCheck = async (trade, ruleId, checked) => {
    const nextChecks = { ...(trade.ruleChecks || {}), [ruleId]: checked };
    const res = await api?.setStrategyRuleChecks?.({ tradeId: trade.id, ruleChecks: nextChecks });
    if (res?.success) {
      setTrades((prev) => prev.map((t) => (String(t.id) === String(trade.id) ? res.trade : t)));
    }
  };

  const strategyNameById = (sid) => strategies.find((s) => String(s.id) === String(sid))?.name || '—';

  const renderStrategyCards = () => {
    if (strategies.length === 0) {
      return (
        <div className="strat-empty">
          No strategies yet. Start from one of the {templates.length || '29'} built-in templates or create a blank playbook.
          <div className="strat-actions-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={openTemplates}>New from template</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={createBlank}>New blank strategy</button>
          </div>
        </div>
      );
    }
    return (
      <div className="strat-grid">
        {strategies.map((s) => {
          const row = analyticsById.get(String(s.id));
          return (
            <button
              type="button"
              key={s.id}
              className={`strat-card ${s.archived ? 'archived' : ''}`}
              onClick={() => openDrawer(s)}
            >
              <div className="strat-card-head">
                <span className="strat-color-dot" style={{ background: s.color || 'var(--accent)' }} />
                <span className="strat-card-name">{s.name}</span>
                {s.archived && <span style={{ fontSize: 10, color: 'var(--text3)' }}>archived</span>}
              </div>
              <p className="strat-card-desc">{s.description || 'No description yet.'}</p>
              <div className="strat-kpis">
                <span><span className="strat-kpi-label">Trades</span><span className="strat-kpi-value">{row?.tradeCount ?? 0}</span></span>
                <span><span className="strat-kpi-label">Win rate</span><span className="strat-kpi-value">{fmtPct(row?.winRate)}</span></span>
                <span><span className="strat-kpi-label">Net P&L</span><span className={`strat-kpi-value ${Number(row?.netPnl) > 0 ? 'pos' : Number(row?.netPnl) < 0 ? 'neg' : ''}`}>{fmtMoney(row?.netPnl)}</span></span>
                <span><span className="strat-kpi-label">Expectancy</span><span className="strat-kpi-value">{fmtMoney(row?.expectancy)}</span></span>
                <span><span className="strat-kpi-label">Compliance</span><span className="strat-kpi-value">{fmtPct(row?.compliancePct)}</span></span>
                <span><span className="strat-kpi-label">Avg R</span><span className="strat-kpi-value">{fmtNum(row?.avgR)}</span></span>
              </div>
              <EquitySparkline points={row?.equityCurve || []} width={240} height={30} />
            </button>
          );
        })}
      </div>
    );
  };

  const renderDrawer = () => {
    if (!selectedStrategy || !draft) return null;
    const row = analyticsById.get(String(selectedStrategy.id));
    return (
      <>
        <div className="strat-drawer-backdrop" onClick={closeDrawer} />
        <div className="strat-drawer" role="dialog" aria-label={`Strategy ${draft.name}`}>
          <div className="strat-drawer-head">
            <span className="strat-color-dot" style={{ background: draft.color || 'var(--accent)', width: 12, height: 12 }} />
            <strong style={{ flex: 1, fontSize: 14 }}>{draft.name}</strong>
            <button type="button" className="btn btn-outline btn-sm" onClick={doExport}>Export JSON</button>
            <button type="button" className="modal-close" onClick={closeDrawer}>×</button>
          </div>
          <div className="strat-drawer-body">
            {row && (
              <div className="strat-kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
                <span><span className="strat-kpi-label">Trades</span><span className="strat-kpi-value">{row.tradeCount}</span></span>
                <span><span className="strat-kpi-label">Win rate</span><span className="strat-kpi-value">{fmtPct(row.winRate)}</span></span>
                <span><span className="strat-kpi-label">Net P&L</span><span className={`strat-kpi-value ${Number(row.netPnl) > 0 ? 'pos' : Number(row.netPnl) < 0 ? 'neg' : ''}`}>{fmtMoney(row.netPnl)}</span></span>
                <span><span className="strat-kpi-label">Profit factor</span><span className="strat-kpi-value">{fmtNum(row.profitFactor)}</span></span>
                <span><span className="strat-kpi-label">Expectancy</span><span className="strat-kpi-value">{fmtMoney(row.expectancy)}</span></span>
                <span><span className="strat-kpi-label">Avg R</span><span className="strat-kpi-value">{fmtNum(row.avgR)}</span></span>
                <span><span className="strat-kpi-label">Compliance</span><span className="strat-kpi-value">{fmtPct(row.compliancePct)}</span></span>
                <span><span className="strat-kpi-label">Missed R</span><span className="strat-kpi-value">{fmtNum(row.missedPnlR)}R</span></span>
              </div>
            )}
            {row && (row.complianceVsPnl?.highCount > 0 || row.complianceVsPnl?.lowCount > 0) && (
              <div className="strat-banner" style={{ marginBottom: 14 }}>
                Plan followed (≥80% rules): avg {fmtMoney(row.complianceVsPnl.highAvgPnl)} over {row.complianceVsPnl.highCount} trades
                &nbsp;·&nbsp; Plan broken: avg {fmtMoney(row.complianceVsPnl.lowAvgPnl)} over {row.complianceVsPnl.lowCount} trades
              </div>
            )}

            <div className="strat-field">
              <label className="strat-field-label">Name</label>
              <input className="strat-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="strat-field" style={{ flex: 1 }}>
                <label className="strat-field-label">Color</label>
                <input className="strat-input" type="color" value={/^#[0-9a-fA-F]{6}$/.test(draft.color || '') ? draft.color : '#6c8cff'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} style={{ padding: 2, height: 34 }} />
              </div>
              <div className="strat-field" style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <label className="strat-check-item" style={{ marginBottom: 6 }}>
                  <input type="checkbox" checked={!!draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.checked })} />
                  Archived
                </label>
              </div>
            </div>
            <div className="strat-field">
              <label className="strat-field-label">Description</label>
              <textarea className="strat-textarea" value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>

            <div className="strat-field">
              <label className="strat-field-label">Rules (checklist per trade)</label>
              {draft.rules.map((rule, idx) => (
                <div className="strat-rule-row" key={rule.id || idx}>
                  <input
                    className="strat-input"
                    value={rule.text}
                    onChange={(e) => {
                      const rules = [...draft.rules];
                      rules[idx] = { ...rules[idx], text: e.target.value };
                      setDraft({ ...draft, rules });
                    }}
                  />
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== idx) })}>✕</button>
                </div>
              ))}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft({ ...draft, rules: [...draft.rules, { text: '' }] })}>+ Add rule</button>
            </div>

            <div className="strat-field">
              <label className="strat-field-label">Entry criteria</label>
              <textarea className="strat-textarea" value={draft.entryCriteria || ''} onChange={(e) => setDraft({ ...draft, entryCriteria: e.target.value })} />
            </div>
            <div className="strat-field">
              <label className="strat-field-label">Exit criteria</label>
              <textarea className="strat-textarea" value={draft.exitCriteria || ''} onChange={(e) => setDraft({ ...draft, exitCriteria: e.target.value })} />
            </div>
            <div className="strat-field">
              <label className="strat-field-label">Risk rules</label>
              <textarea className="strat-textarea" value={draft.riskRules || ''} onChange={(e) => setDraft({ ...draft, riskRules: e.target.value })} />
            </div>
            <div className="strat-field">
              <label className="strat-field-label">Linked tags (comma-separated — auto-attach suggestions)</label>
              <input className="strat-input" value={draft.linkedTagsText} onChange={(e) => setDraft({ ...draft, linkedTagsText: e.target.value })} placeholder="ict, fvg, ny-session" />
            </div>
            <div className="strat-field">
              <label className="strat-field-label">Linked channels (comma-separated — auto-attach suggestions)</label>
              <input className="strat-input" value={draft.linkedChannelsText} onChange={(e) => setDraft({ ...draft, linkedChannelsText: e.target.value })} placeholder="Gold Signals VIP" />
            </div>

            <div className="strat-actions-row">
              <button type="button" className="btn btn-primary btn-sm" onClick={saveDraft} disabled={busy}>{busy ? 'Saving…' : 'Save strategy'}</button>
              <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={deleteSelected}>Delete</button>
            </div>

            {exportJson && (
              <div className="strat-field" style={{ marginTop: 14 }}>
                <label className="strat-field-label">Exported JSON (copy &amp; share)</label>
                <textarea className="strat-textarea" readOnly value={exportJson} style={{ minHeight: 120 }} onFocus={(e) => e.target.select()} />
              </div>
            )}

            <div className="strat-section-title">Linked trades ({linkedTrades.length})</div>
            {linkedTrades.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                No trades attached yet. Attach from a trade&apos;s detail, or link channels/tags above and use auto-attach.
              </div>
            )}
            {linkedTrades.map((t) => {
              const ruleCount = (selectedStrategy.rules || []).length;
              const checkedCount = Object.values(t.ruleChecks || {}).filter(Boolean).length;
              const expanded = String(expandedTradeId) === String(t.id);
              return (
                <div className="strat-trade-row" key={t.id}>
                  <div className="strat-trade-row-head" onClick={() => setExpandedTradeId(expanded ? null : t.id)}>
                    <strong style={{ color: 'var(--text)' }}>{t.symbol}</strong>
                    <span>{t.type}</span>
                    <span style={{ color: 'var(--text3)' }}>{fmtDate(t.openedAt)}</span>
                    <span className={Number(t.profit) >= 0 ? 'strat-kpi-value pos' : 'strat-kpi-value neg'} style={{ marginLeft: 'auto' }}>{fmtMoney(t.profit)}</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{ruleCount ? `${checkedCount}/${ruleCount} rules` : ''} {expanded ? '▴' : '▾'}</span>
                  </div>
                  {expanded && ruleCount > 0 && (
                    <div className="strat-checklist">
                      {(selectedStrategy.rules || []).map((rule) => (
                        <label className="strat-check-item" key={rule.id}>
                          <input
                            type="checkbox"
                            checked={!!(t.ruleChecks || {})[rule.id]}
                            onChange={(e) => setRuleCheck(t, rule.id, e.target.checked)}
                          />
                          {rule.text}
                        </label>
                      ))}
                    </div>
                  )}
                  {expanded && ruleCount === 0 && (
                    <div className="strat-checklist" style={{ fontSize: 12, color: 'var(--text3)' }}>Add rules to this strategy to grade compliance.</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  const renderMissedTab = () => (
    <div>
      <div className="strat-banner">
        Total missed R (simulated):&nbsp;
        <strong className={missedTotalR >= 0 ? 'strat-kpi-value pos' : 'strat-kpi-value neg'} style={{ fontSize: 15 }}>
          {fmtNum(missedTotalR)}R
        </strong>
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>
          — what the trades you skipped would have produced, per bar-replay of 1-min data.
        </span>
      </div>

      <form className="strat-missed-form" onSubmit={addMissed}>
        <div>
          <label className="strat-field-label">Symbol</label>
          <input className="strat-input" value={missedForm.symbol} onChange={(e) => setMissedForm({ ...missedForm, symbol: e.target.value.toUpperCase() })} placeholder="XAUUSD" />
        </div>
        <div>
          <label className="strat-field-label">Direction</label>
          <select className="strat-input" value={missedForm.direction} onChange={(e) => setMissedForm({ ...missedForm, direction: e.target.value })}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>
        <div>
          <label className="strat-field-label">Planned entry</label>
          <input className="strat-input" type="number" step="any" value={missedForm.plannedEntry} onChange={(e) => setMissedForm({ ...missedForm, plannedEntry: e.target.value })} />
        </div>
        <div>
          <label className="strat-field-label">Planned SL</label>
          <input className="strat-input" type="number" step="any" value={missedForm.plannedSl} onChange={(e) => setMissedForm({ ...missedForm, plannedSl: e.target.value })} />
        </div>
        <div>
          <label className="strat-field-label">Planned TP</label>
          <input className="strat-input" type="number" step="any" value={missedForm.plannedTp} onChange={(e) => setMissedForm({ ...missedForm, plannedTp: e.target.value })} />
        </div>
        <div>
          <label className="strat-field-label">Strategy</label>
          <select className="strat-input" value={missedForm.strategyId} onChange={(e) => setMissedForm({ ...missedForm, strategyId: e.target.value })}>
            <option value="">— none —</option>
            {strategies.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label className="strat-field-label">Reason missed</label>
          <input className="strat-input" value={missedForm.reasonMissed} onChange={(e) => setMissedForm({ ...missedForm, reasonMissed: e.target.value })} placeholder="Hesitated / away from desk / fear after loss…" />
        </div>
        <div>
          <button type="submit" className="btn btn-primary btn-sm" style={{ width: '100%' }}>Log missed trade</button>
        </div>
      </form>

      {missed.length === 0 ? (
        <div className="strat-empty">No missed trades logged. Log the ones you hesitated on — the simulator tells you what they would have done.</div>
      ) : (
        <div className="trade-table-wrap" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table className="trade-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>When</th><th>Symbol</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP</th>
                <th>Strategy</th><th>Reason</th><th>Outcome</th><th>Missed R</th><th></th>
              </tr>
            </thead>
            <tbody>
              {missed.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(m.at)}</td>
                  <td><strong>{m.symbol}</strong></td>
                  <td>{m.direction}</td>
                  <td className="td-num">{m.plannedEntry ?? '—'}</td>
                  <td className="td-num">{m.plannedSl ?? '—'}</td>
                  <td className="td-num">{m.plannedTp ?? '—'}</td>
                  <td style={{ fontSize: 11 }}>{m.strategyId ? strategyNameById(m.strategyId) : '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.reasonMissed}>{m.reasonMissed || '—'}</td>
                  <td>
                    {m.simulated ? (
                      <span className={`strat-kpi-value ${m.simulated.outcome === 'TP' ? 'pos' : m.simulated.outcome === 'SL' ? 'neg' : ''}`}>
                        {m.simulated.outcome}{m.simulated.entryFilled === false ? ' (no fill)' : ''}
                      </span>
                    ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td className="td-num">
                    {m.simulated ? (
                      <span className={Number(m.simulated.pnlR) >= 0 ? 'strat-kpi-value pos' : 'strat-kpi-value neg'}>{fmtNum(m.simulated.pnlR)}R</span>
                    ) : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-outline btn-sm" disabled={simulatingId === m.id} onClick={() => simulateMissed(m.id)}>
                      {simulatingId === m.id ? 'Simulating…' : (m.simulated ? 'Re-simulate' : 'Simulate')}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 4, color: 'var(--danger)' }} onClick={async () => { await api?.deleteMissedTrade?.(m.id); refresh(); }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderMistakesTab = () => (
    <div>
      <div className="strat-banner">
        Mistake economics — the dollar cost of each mistake tag on your trades.
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>
          Tag categories are configured in Settings (tagCategories.mistakes); tag trades in their journal to feed this table.
        </span>
      </div>
      {analytics.mistakes.length === 0 ? (
        <div className="strat-empty">No mistake tags configured or no tagged trades yet.</div>
      ) : (
        <div className="trade-table-wrap">
          <table className="trade-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>Mistake tag</th><th>Trades</th><th>Closed</th><th>Total cost</th><th>Avg R</th></tr>
            </thead>
            <tbody>
              {analytics.mistakes.map((m) => (
                <tr key={m.tag}>
                  <td><strong>{m.tag}</strong></td>
                  <td className="td-num">{m.count}</td>
                  <td className="td-num">{m.closedCount}</td>
                  <td className={`td-num ${Number(m.totalPnl) >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(m.totalPnl)}</td>
                  <td className="td-num">{m.avgR === null ? '—' : `${fmtNum(m.avgR)}R`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="dashboard-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-icon"><Layers size={18} aria-hidden="true" /></span>
          <span className="brand-name">Strategies</span>
          <span className="subtitle">Playbooks, rule compliance, missed trades &amp; mistake costs</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { setImportOpen(true); setImportText(''); }}>Import JSON</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={openTemplates}>New from template</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={createBlank}>New strategy</button>
        </div>
      </div>

      <div className="strat-tabs">
        <button type="button" className={`strat-tab ${tab === 'strategies' ? 'active' : ''}`} onClick={() => setTab('strategies')}>Strategies ({strategies.length})</button>
        <button type="button" className={`strat-tab ${tab === 'missed' ? 'active' : ''}`} onClick={() => setTab('missed')}>Missed trades ({missed.length})</button>
        <button type="button" className={`strat-tab ${tab === 'mistakes' ? 'active' : ''}`} onClick={() => setTab('mistakes')}>Mistake economics</button>
      </div>

      <div style={{ padding: 16 }}>
        {error && <div className="strat-error">{error}</div>}
        {tab === 'strategies' && renderStrategyCards()}
        {tab === 'missed' && renderMissedTab()}
        {tab === 'mistakes' && renderMistakesTab()}
      </div>

      {renderDrawer()}

      {templateOpen && (
        <div className="modal-overlay" onClick={() => setTemplateOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New strategy from template</h3>
              <button type="button" className="modal-close" onClick={() => setTemplateOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <input
                autoFocus
                className="strat-input"
                placeholder={`Search ${templates.length} templates… (ICT, London, VWAP, gold…)`}
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
              />
              <div className="strat-template-list">
                {filteredTemplates.map((t) => (
                  <button type="button" key={t.id} className="strat-template-item" disabled={busy} onClick={() => useTemplate(t.id)}>
                    <span className="strat-template-name">
                      <span className="strat-color-dot" style={{ background: t.color || 'var(--accent)' }} />
                      {t.name}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)' }}>{t.rules.length} rules</span>
                    </span>
                    <div className="strat-template-desc">{t.description}</div>
                  </button>
                ))}
                {filteredTemplates.length === 0 && <div className="strat-empty">No template matches “{templateQuery}”.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import strategy from JSON</h3>
              <button type="button" className="modal-close" onClick={() => setImportOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <textarea
                className="strat-textarea"
                style={{ minHeight: 180 }}
                placeholder='Paste a strategy exported from Trade Station ({"format":"trade-station.strategy", …})'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="strat-actions-row">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !importText.trim()} onClick={doImport}>Import</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setImportOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
