import React, { useEffect, useMemo, useState } from 'react';

const ACTIONS = [
  { id: 'page-dashboard', label: 'Go to Dashboard', group: 'Navigate', run: (ctx) => ctx.setPage('dashboard') },
  { id: 'page-trades', label: 'Go to Trades', group: 'Navigate', run: (ctx) => ctx.setPage('trades') },
  { id: 'page-filter-lab', label: 'Go to Filter Lab', group: 'Navigate', run: (ctx) => ctx.setPage('filter-lab') },
  { id: 'page-parser-lab', label: 'Go to Parser Lab', group: 'Navigate', run: (ctx) => ctx.setPage('parser-lab') },
  { id: 'page-calendar', label: 'Go to Calendar', group: 'Navigate', run: (ctx) => ctx.setPage('calendar') },
  { id: 'page-fundamentals', label: 'Go to Fundamentals', group: 'Navigate', run: (ctx) => ctx.setPage('fundamentals') },
  { id: 'page-settings', label: 'Go to Settings', group: 'Navigate', run: (ctx) => ctx.setPage('settings') },
  // ─── TradeZella-parity pages — agents: replace ONLY your own anchor line ───
  { id: 'page-strategies', label: 'Go to Strategies', group: 'Navigate', run: (ctx) => ctx.setPage('strategies') },
  { id: 'page-reports', label: 'Go to Reports', group: 'Navigate', run: (ctx) => ctx.setPage('reports') },
  { id: 'page-notebook', label: 'Go to Notebook', group: 'Navigate', run: (ctx) => ctx.setPage('notebook') },
  { id: 'page-replay', label: 'Go to Replay', group: 'Navigate', run: (ctx) => ctx.setPage('replay') },
  { id: 'page-prop-firm', label: 'Go to Prop Firm', group: 'Navigate', run: (ctx) => ctx.setPage('prop-firm') },
  { id: 'page-backtest', label: 'Go to Backtest', group: 'Navigate', run: (ctx) => ctx.setPage('backtest') },
  { id: 'refresh-trades', label: 'Refresh trades', group: 'Actions', run: () => window.electronAPI?.refreshTrades?.() },
  { id: 'toggle-mini', label: 'Toggle mini overlay', group: 'Window', run: () => window.electronAPI?.toggleMiniMode?.() },
];

export default function CommandPalette({ open, onClose, setPage }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS;
    return ACTIONS.filter((a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;

  const ctx = { setPage };

  return (
    <div className="modal-overlay modal-overlay--instant" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520, width: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Command palette</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <input
            autoFocus
            className="select-field"
            placeholder="Search actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {filtered.map((action) => (
              <button
                key={action.id}
                type="button"
                className="btn btn-outline"
                style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6 }}
                onClick={() => {
                  action.run(ctx);
                  onClose();
                }}
              >
                <span style={{ opacity: 0.6, fontSize: 11, marginRight: 8 }}>{action.group}</span>
                {action.label}
              </button>
            ))}
            {filtered.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>No matching actions</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function useCommandPaletteHotkey(setOpen) {
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}
