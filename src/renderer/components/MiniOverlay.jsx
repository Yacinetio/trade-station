import React from 'react';

export default function MiniOverlay({ trades = [], mt5Connected = false, onRestore }) {
  const live = trades.filter((t) => {
    const s = String(t?.status || '').toUpperCase();
    return !s.includes('CLOSED') && !s.includes('SL_HIT') && !s.includes('TP_HIT') && !s.includes('BLOCKED') && s !== 'PENDING';
  });
  const floatPnl = live.reduce((sum, t) => sum + Number(t.profit || 0), 0);
  const last = trades[0];

  return (
    <div className="mini-overlay-shell" style={{ padding: 12, background: 'var(--bg)', color: 'var(--text)', height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>Trade Station</strong>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: mt5Connected ? 'var(--success)' : 'var(--danger)' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text2)' }}>Live: {live.length}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: floatPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
        {floatPnl >= 0 ? '+' : ''}{floatPnl.toFixed(2)}$
      </div>
      {last && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
          Last: {last.symbol} {last.type}
        </div>
      )}
      <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={onRestore}>
        Restore
      </button>
    </div>
  );
}
