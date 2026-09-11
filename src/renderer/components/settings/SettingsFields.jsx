import React, { useState } from 'react';
import Tooltip from '../ui/Tooltip.jsx';
import {
  DEFAULT_CORRELATION_GROUPS,
  CORRELATION_GROUP_PRESETS,
  parseCorrelationGroupInput,
  formatCorrelationGroupLabel,
  cleanCorrelationGroups
} from '../../utils/correlationGroups.js';

export function InfoTip({ text }) {
  return (
    <Tooltip content={text} position="top">
      <span className="info-tip" tabIndex={0} aria-label={text}>?</span>
    </Tooltip>
  );
}

export function Toggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-slider" />
    </label>
  );
}

export function Field({ label, tooltip, children }) {
  return (
    <div className="settings-field">
      <div className="field-header">
        <label>{label}</label>
        {tooltip && <span className="field-tooltip" title={tooltip}>?</span>}
      </div>
      {children}
    </div>
  );
}

export function CorrelationGroupsEditor({ groups = [], onChange }) {
  const list = Array.isArray(groups) && groups.length
    ? groups
    : DEFAULT_CORRELATION_GROUPS.map((g) => [...g]);

  const commit = (next) => {
    const cleaned = cleanCorrelationGroups(next);
    onChange(cleaned || DEFAULT_CORRELATION_GROUPS.map((g) => [...g]));
  };

  const updateRow = (idx, text) => {
    const symbols = parseCorrelationGroupInput(text);
    const next = list.map((row, i) => (i === idx ? symbols : row));
    onChange(next);
  };

  const removeRow = (idx) => {
    commit(list.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    onChange([...list, ['US100', 'US30']]);
  };

  const addPreset = (preset) => {
    const symbols = [...preset.symbols];
    const exists = list.some((row) => {
      const a = [...row].sort().join(',');
      const b = [...symbols].sort().join(',');
      return a === b;
    });
    if (exists) return;
    onChange([...list, symbols]);
  };

  const resetDefaults = () => {
    onChange(DEFAULT_CORRELATION_GROUPS.map((g) => [...g]));
  };

  return (
    <div className="correlation-groups-editor">
      {list.map((group, idx) => (
        <div key={`cg-${idx}`} className="correlation-group-row">
          <div className="correlation-group-row-head">
            <span className="correlation-group-row-label">Group {idx + 1}</span>
            <button type="button" className="correlation-group-remove" onClick={() => removeRow(idx)} title="Remove group">×</button>
          </div>
          <input
            className="correlation-group-input"
            value={group.join(', ')}
            onChange={(e) => updateRow(idx, e.target.value)}
            placeholder="US100, US30, US500"
          />
          <div className="correlation-group-hint">{formatCorrelationGroupLabel(group)}</div>
        </div>
      ))}
      <div className="correlation-group-toolbar">
        <button type="button" className="btn btn-outline btn-sm" onClick={addRow}>＋ Add group</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={resetDefaults}>Reset defaults</button>
      </div>
      <div className="correlation-group-presets">
        <span className="correlation-group-presets-label">Quick add:</span>
        {CORRELATION_GROUP_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => addPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SpreadEntryRulesEditor({ rules = [], onChange }) {
  const list = Array.isArray(rules) ? rules : [];

  const commit = (next) => {
    onChange(
      next.filter((row) => String(row?.symbol || '').trim().length > 0)
    );
  };

  const updateRule = (idx, patch) => {
    commit(list.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRule = (idx) => {
    commit(list.filter((_, i) => i !== idx));
  };

  const addRule = () => {
    onChange([...list, { symbol: '' }]);
  };

  return (
    <div className="spread-entry-rules-editor">
      {list.length === 0 && (
        <div style={{ color: 'var(--text3)', fontSize: 12, padding: '8px 0' }}>
          No pairs configured — add symbols with wide spreads (e.g. US100, XAUUSD).
        </div>
      )}
      {list.map((rule, idx) => (
        <div key={`ser-${idx}`} className="form-row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Symbol</label>
            <input
              className="select-field"
              value={rule.symbol || ''}
              placeholder="US100"
              onChange={(e) => updateRule(idx, { symbol: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Fallback spread (pips)</label>
            <div className="number-input-wrap">
              <input
                type="number"
                min={0}
                step={0.1}
                value={rule.spreadPips ?? ''}
                placeholder="optional"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) {
                    updateRule(idx, { spreadPips: undefined });
                    return;
                  }
                  const v = Number.parseFloat(raw);
                  updateRule(idx, { spreadPips: Number.isFinite(v) && v > 0 ? v : undefined });
                }}
              />
              <span className="number-input-unit">pips</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeRule(idx)}
            style={{
              padding: '8px 12px',
              background: 'rgba(255,68,68,0.2)',
              border: '1px solid rgba(255,68,68,0.4)',
              borderRadius: 8,
              color: 'var(--danger)',
              cursor: 'pointer',
              fontSize: 14,
              marginBottom: 2
            }}
            title="Remove rule"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={addRule}>＋ Add pair</button>
    </div>
  );
}

export function TagList({ items = [], onRemove, placeholder, onAdd }) {
  const [val, setVal] = useState('');
  const add = () => { if (val.trim()) { onAdd(val.trim()); setVal(''); } };
  return (
    <div>
      <div style={{ minHeight: 80, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((w, i) => (
          <span key={i} className="tag">
            {w}
            <button className="tag-remove" onClick={() => onRemove(i)}>×</button>
          </span>
        ))}
        {items.length === 0 && <span style={{ color: 'var(--text3)', fontSize: 12 }}>No items added yet</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
        />
        <button onClick={add} style={{ padding: '8px 14px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>＋ Add</button>
      </div>
    </div>
  );
}
