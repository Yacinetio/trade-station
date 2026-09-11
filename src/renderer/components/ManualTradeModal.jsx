import React, { useState, useCallback } from 'react';
import {
  EMPTY_MANUAL_DRAFT,
  fieldsToDraft,
  draftToFields,
  isoToLocalInput
} from '../utils/manualTradeFormUtils.js';

function OutcomeAndProfitSection({ outcome, setOutcome, profit, setProfit, beProfitLocked }) {
  return (
    <div className="manual-trade-outcome">
      <div className="form-group">
        <label>Close result</label>
        <div className="manual-trade-outcome-btns" role="radiogroup" aria-label="Close result">
          {[
            { id: 'tp', label: 'TP' },
            { id: 'sl', label: 'SL' },
            { id: 'be', label: 'BE' }
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`btn btn-outline manual-outcome-btn ${outcome === id ? 'active' : ''}`}
              aria-pressed={outcome === id}
              onClick={() => setOutcome(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label>Profit ($)</label>
        <div className="number-input-wrap">
          <input
            type="number"
            step="0.01"
            value={profit}
            disabled={beProfitLocked}
            onChange={(e) => setProfit(e.target.value)}
            placeholder={beProfitLocked ? '0 (break-even)' : 'e.g. 42.50'}
          />
          <span className="number-input-unit">$</span>
        </div>
        {beProfitLocked && <div className="hint">Break-even uses $0 profit for analytics.</div>}
      </div>
    </div>
  );
}

function ManualFieldsForm({ draft, setDraft }) {
  const set = (key, val) => setDraft((d) => ({ ...d, [key]: val }));
  return (
    <div className="manual-trade-fields" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>Symbol</label>
          <input className="select-field" value={draft.symbol} onChange={(e) => set('symbol', e.target.value)} placeholder="EURUSD" />
        </div>
        <div className="form-group" style={{ width: 120 }}>
          <label>Type</label>
          <select className="select-field" value={draft.type} onChange={(e) => set('type', e.target.value)}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>
        <div className="form-group" style={{ width: 90 }}>
          <label>TF</label>
          <input className="select-field" value={draft.timeframe} onChange={(e) => set('timeframe', e.target.value)} placeholder="M10" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>Entry</label>
          <input className="select-field" type="number" step="any" value={draft.entry} onChange={(e) => set('entry', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>SL</label>
          <input className="select-field" type="number" step="any" value={draft.sl} onChange={(e) => set('sl', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>TP</label>
          <input className="select-field" type="number" step="any" value={draft.tp} onChange={(e) => set('tp', e.target.value)} />
        </div>
        <div className="form-group" style={{ width: 90 }}>
          <label>Lot</label>
          <input className="select-field" type="number" step="0.01" value={draft.lot} onChange={(e) => set('lot', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>OB edge</label>
          <input className="select-field" type="number" step="any" value={draft.obEdge} onChange={(e) => set('obEdge', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Avg ENTRY</label>
          <input className="select-field" type="number" step="any" value={draft.avgEntry} onChange={(e) => set('avgEntry', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Bias</label>
          <input className="select-field" value={draft.bias} onChange={(e) => set('bias', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>VWAP</label>
          <select className="select-field" value={draft.vwapBand} onChange={(e) => set('vwapBand', e.target.value)}>
            <option value="">—</option>
            <option value="yes">YES</option>
            <option value="no">NO</option>
            <option value="na">n/a</option>
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>HVN</label>
          <select className="select-field" value={draft.hvnBand} onChange={(e) => set('hvnBand', e.target.value)}>
            <option value="">—</option>
            <option value="yes">YES</option>
            <option value="no">NO</option>
            <option value="na">n/a</option>
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Trend</label>
          <select className="select-field" value={draft.trendAlign} onChange={(e) => set('trendAlign', e.target.value)}>
            <option value="">—</option>
            <option value="with">WITH</option>
            <option value="against">AGAINST</option>
            <option value="neutral">NEUTRAL</option>
            <option value="na">n/a</option>
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>OB size</label>
          <input className="select-field" value={draft.obSize} onChange={(e) => set('obSize', e.target.value)} placeholder="pips" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>Opened</label>
          <input className="select-field" type="datetime-local" value={draft.openedAt} onChange={(e) => set('openedAt', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Closed</label>
          <input className="select-field" type="datetime-local" value={draft.closedAt} onChange={(e) => set('closedAt', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Comment</label>
        <input className="select-field" value={draft.comment} onChange={(e) => set('comment', e.target.value)} placeholder="Optional note" />
      </div>
    </div>
  );
}

export default function ManualTradeModal({ onClose, onSaved }) {
  const [tab, setTab] = useState('paste');
  const [telegramText, setTelegramText] = useState('');
  const [draft, setDraft] = useState(() => {
    const now = isoToLocalInput(new Date().toISOString());
    return { ...EMPTY_MANUAL_DRAFT, openedAt: now, closedAt: now };
  });
  const [outcome, setOutcome] = useState('tp');
  const [profit, setProfit] = useState('');
  const [parseError, setParseError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  const beProfitLocked = outcome === 'be';

  const handleParse = useCallback(async () => {
    setParseError('');
    setParsing(true);
    try {
      const res = await window.electronAPI?.parseManualTelegram?.({ text: telegramText });
      if (!res?.ok) {
        setParseError(res?.error || 'Could not parse message.');
        return;
      }
      setDraft(fieldsToDraft(res.fields));
      setTab('fields');
    } catch (e) {
      setParseError(e?.message || 'Parse failed.');
    } finally {
      setParsing(false);
    }
  }, [telegramText]);

  const handleSave = useCallback(async () => {
    setSaveError('');
    setSaving(true);
    try {
      const fields = draftToFields(draft);
      const payload = {
        fields,
        outcome,
        profit: beProfitLocked ? 0 : profit === '' ? 0 : Number(profit),
        ...(telegramText.trim() ? { telegramText: telegramText.trim() } : {})
      };
      const res = await window.electronAPI?.addManualTrade?.(payload);
      if (!res?.success) {
        setSaveError(res?.error || 'Could not save trade.');
        return;
      }
      onSaved?.(res.trade);
      onClose?.();
    } catch (e) {
      setSaveError(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [draft, outcome, profit, beProfitLocked, telegramText, onSaved, onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal manual-trade-modal"
        data-testid="manual-trade-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Add manual trade</h2>
          <span className="hint" style={{ marginLeft: 8 }}>Channel: Manual</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="analytics-tabs" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`analytics-tab-btn ${tab === 'paste' ? 'active' : ''}`}
              onClick={() => setTab('paste')}
            >
              Paste Telegram
            </button>
            <button
              type="button"
              className={`analytics-tab-btn ${tab === 'fields' ? 'active' : ''}`}
              onClick={() => setTab('fields')}
            >
              Edit fields
            </button>
          </div>

          {tab === 'paste' && (
            <>
              <div className="form-group">
                <label>Telegram signal message</label>
                <textarea
                  className="select-field manual-trade-textarea"
                  rows={12}
                  value={telegramText}
                  onChange={(e) => setTelegramText(e.target.value)}
                  placeholder={'Signal: BUY EURUSD M10\nEntry: 1.16426\nSL: 1.16376\nTP: 1.16525\n...'}
                />
              </div>
              <button
                type="button"
                className="btn btn-outline"
                disabled={parsing || !telegramText.trim()}
                onClick={handleParse}
              >
                {parsing ? 'Parsing…' : 'Parse into fields'}
              </button>
              {parseError && (
                <div className="hint" style={{ color: 'var(--danger)', marginTop: 8 }}>
                  {parseError}
                </div>
              )}
              <div className="hint" style={{ marginTop: 10 }}>
                After parsing, review on <strong>Edit fields</strong>, then set TP / SL / BE and profit below.
              </div>
            </>
          )}

          {tab === 'fields' && <ManualFieldsForm draft={draft} setDraft={setDraft} />}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

          <OutcomeAndProfitSection
            outcome={outcome}
            setOutcome={setOutcome}
            profit={beProfitLocked ? '0' : profit}
            setProfit={setProfit}
            beProfitLocked={beProfitLocked}
          />

          {saveError && (
            <div className="hint" style={{ color: 'var(--danger)', marginTop: 8 }}>
              {saveError}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="manual-trade-save"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save to Manual channel'}
          </button>
        </div>
      </div>
    </div>
  );
}
