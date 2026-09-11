import React, { useMemo, useState } from 'react';
import {
  BUILTIN_COLUMN_DEFS,
  normalizeTradeBuiltinColumns,
  serializeTradeBuiltinColumns
} from '../../utils/tradeColumnDefs.js';
import { Toggle, TagList } from './SettingsFields.jsx';

function slugifyColumnId(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return s.slice(0, 48) || 'field';
}

export default function ColumnsTab({ s, set }) {
  const columns = Array.isArray(s.customTradeColumns) ? s.customTradeColumns : [];
  const builtinColumns = useMemo(
    () => normalizeTradeBuiltinColumns(s.tradeBuiltinColumns),
    [s.tradeBuiltinColumns]
  );
  const enabledBuiltins = builtinColumns.filter((c) => c.enabled !== false);
  const hiddenBuiltins = builtinColumns.filter((c) => c.enabled === false);
  const [draft, setDraft] = useState({
    parseKey: '',
    label: '',
    width: 90,
    mapToPresetTags: false
  });
  const [builtinExpanded, setBuiltinExpanded] = useState(null);

  const updateColumns = (next) => set('customTradeColumns', next);

  const saveBuiltinColumns = (rows) => {
    set('tradeBuiltinColumns', serializeTradeBuiltinColumns(rows));
  };

  const patchBuiltin = (id, patch) => {
    saveBuiltinColumns(builtinColumns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const hideBuiltin = (id) => patchBuiltin(id, { enabled: false });

  const restoreBuiltin = (id) => patchBuiltin(id, { enabled: true });

  const restoreAllBuiltins = () => set('tradeBuiltinColumns', []);

  const addColumn = () => {
    const parseKey = String(draft.parseKey || '').trim();
    if (!parseKey) return;
    const label = String(draft.label || parseKey).trim().toUpperCase();
    const id = slugifyColumnId(parseKey);
    if (columns.some((c) => c.id === id || String(c.parseKey).toLowerCase() === parseKey.toLowerCase())) return;
    const width = Math.min(320, Math.max(40, Number(draft.width) || 90));
    updateColumns([
      ...columns,
      {
        id,
        parseKey,
        label,
        width,
        enabled: true,
        sortable: true,
        mapToPresetTags: !!draft.mapToPresetTags,
        tags: []
      }
    ].slice(0, 30));
    setDraft({ parseKey: '', label: '', width: 90, mapToPresetTags: false });
  };

  const patchColumn = (idx, patch) => {
    updateColumns(columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeColumn = (idx) => {
    updateColumns(columns.filter((_, i) => i !== idx));
  };

  return (
    <>
      <div className="settings-section">
        <h3>📊 Built-in columns</h3>
        <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 12 }}>
          Show, hide, or rename standard trade table columns. <strong>Hide</strong> removes a column from the table
          (you can restore it below). Quick show/hide is also available from the table toolbar <em>Columns</em> menu.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={restoreAllBuiltins}>
            Restore all built-in columns
          </button>
          <span style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>
            {enabledBuiltins.length} visible · {hiddenBuiltins.length} hidden
          </span>
        </div>
        <div className="columns-settings-grid">
          {enabledBuiltins.map((col) => (
            <div key={col.id} className="columns-settings-card columns-settings-card--builtin">
              <div className="columns-settings-card-head">
                <strong>{col.label}</strong>
                <span className="columns-settings-id">{col.id}</span>
                <div className="columns-settings-card-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setBuiltinExpanded((cur) => (cur === col.id ? null : col.id))}
                  >
                    {builtinExpanded === col.id ? 'Done' : 'Edit'}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => hideBuiltin(col.id)} title="Hide column from table">
                    Hide
                  </button>
                </div>
              </div>
              {builtinExpanded === col.id && (
                <div className="columns-settings-card-body">
                  <div className="form-row">
                    <div className="form-group">
                      <label>Header</label>
                      <input
                        className="select-field"
                        value={col.label}
                        onChange={(e) => patchBuiltin(col.id, { label: e.target.value.toUpperCase() })}
                      />
                    </div>
                    <div className="form-group" style={{ maxWidth: 100 }}>
                      <label>Width</label>
                      <input
                        type="number"
                        className="select-field"
                        min={40}
                        max={320}
                        value={col.width}
                        onChange={(e) => patchBuiltin(col.id, { width: parseInt(e.target.value, 10) || col.width })}
                      />
                    </div>
                  </div>
                  <div className="toggle-row">
                    <span className="toggle-label">Sortable</span>
                    <Toggle
                      checked={col.sortable !== false}
                      onChange={(v) => patchBuiltin(col.id, { sortable: v })}
                      disabled={BUILTIN_COLUMN_DEFS.find((d) => d.id === col.id)?.sortable === false}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {hiddenBuiltins.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="columns-settings-hidden-title">Hidden columns</div>
            <div className="columns-settings-hidden-list">
              {hiddenBuiltins.map((col) => (
                <div key={col.id} className="columns-settings-hidden-item">
                  <span>{col.label} <span className="columns-settings-id">({col.id})</span></span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => restoreBuiltin(col.id)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>📋 Custom columns (from Telegram)</h3>
        <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 12 }}>
          Add fields parsed from labeled lines in your signals (e.g. <code>Zone: London</code>).
          Marked with ✦ in the table column picker.
        </p>

        {columns.length === 0 && (
          <div className="fund-empty-inline" style={{ marginBottom: 12 }}>
            No custom columns yet. Example: parse key <strong>Setup</strong> matches <strong>Setup: 2</strong> in the message.
          </div>
        )}

        {columns.map((col, idx) => (
          <div
            key={col.id || idx}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              background: 'color-mix(in srgb, var(--bg2) 55%, transparent)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{col.label || col.parseKey}</strong>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => removeColumn(idx)}>Delete</button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Parse key (message label)</label>
                <input
                  className="select-field"
                  value={col.parseKey || ''}
                  onChange={(e) => patchColumn(idx, { parseKey: e.target.value })}
                  placeholder="e.g. Zone, Setup, Session"
                />
              </div>
              <div className="form-group">
                <label>Column header</label>
                <input
                  className="select-field"
                  value={col.label || ''}
                  onChange={(e) => patchColumn(idx, { label: e.target.value.toUpperCase() })}
                  placeholder="ZONE"
                />
              </div>
              <div className="form-group" style={{ maxWidth: 100 }}>
                <label>Width</label>
                <input
                  type="number"
                  className="select-field"
                  min={40}
                  max={320}
                  value={col.width ?? 90}
                  onChange={(e) => patchColumn(idx, { width: parseInt(e.target.value, 10) || 90 })}
                />
              </div>
            </div>
            <div className="toggle-row" style={{ marginTop: 6 }}>
              <span className="toggle-label">Show in table</span>
              <Toggle checked={col.enabled !== false} onChange={(v) => patchColumn(idx, { enabled: v })} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">Sortable</span>
              <Toggle checked={col.sortable !== false} onChange={(v) => patchColumn(idx, { sortable: v })} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label" title="When parsed value matches a tag below (or a Trade preset), add it to trade tags">
                Map value → trade tags
              </span>
              <Toggle checked={!!col.mapToPresetTags} onChange={(v) => patchColumn(idx, { mapToPresetTags: v })} />
            </div>
            {col.mapToPresetTags && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>
                  Allowed tag values (optional — leave empty to accept any parsed value)
                </label>
                <TagList
                  items={Array.isArray(col.tags) ? col.tags : []}
                  onRemove={(ti) => patchColumn(idx, { tags: (col.tags || []).filter((_, i) => i !== ti) })}
                  onAdd={(v) => {
                    const cur = Array.isArray(col.tags) ? col.tags : [];
                    const t = v.trim();
                    if (!t || cur.includes(t)) return;
                    patchColumn(idx, { tags: [...cur, t].slice(0, 50) });
                  }}
                  placeholder="e.g. London, 2, sweep"
                />
              </div>
            )}
          </div>
        ))}

        <div className="settings-section" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>＋ Add column</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Parse key</label>
              <input
                className="select-field"
                value={draft.parseKey}
                onChange={(e) => setDraft((d) => ({ ...d, parseKey: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addColumn()}
                placeholder="Setup"
              />
            </div>
            <div className="form-group">
              <label>Header (optional)</label>
              <input
                className="select-field"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="SETUP"
              />
            </div>
            <div className="form-group" style={{ maxWidth: 100 }}>
              <label>Width</label>
              <input
                type="number"
                className="select-field"
                min={40}
                max={320}
                value={draft.width}
                onChange={(e) => setDraft((d) => ({ ...d, width: parseInt(e.target.value, 10) || 90 }))}
              />
            </div>
          </div>
          <div className="toggle-row" style={{ marginBottom: 8 }}>
            <span className="toggle-label">Map value → trade tags</span>
            <Toggle
              checked={draft.mapToPresetTags}
              onChange={(v) => setDraft((d) => ({ ...d, mapToPresetTags: v }))}
            />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={addColumn} disabled={!String(draft.parseKey || '').trim()}>
            Add column
          </button>
        </div>
      </div>
    </>
  );
}
