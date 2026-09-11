import React, { useEffect, useState } from 'react';

export default function AdvancedAnalyticsPanel({ routeVisible }) {
  const [monte, setMonte] = useState(null);
  const [underwater, setUnderwater] = useState([]);

  useEffect(() => {
    if (!routeVisible) return undefined;
    let active = true;
    (async () => {
      try {
        const [mc, uw] = await Promise.all([
          window.electronAPI?.getMonteCarlo?.({ iterations: 1000 }),
          window.electronAPI?.getUnderwaterSeries?.(),
        ]);
        if (!active) return;
        setMonte(mc || null);
        setUnderwater(Array.isArray(uw) ? uw : []);
      } catch (_) {
        if (active) {
          setMonte(null);
          setUnderwater([]);
        }
      }
    })();
    return () => { active = false; };
  }, [routeVisible]);

  const maxUw = Math.max(...underwater.map((p) => p.underwater || 0), 1);

  return (
    <div className="analytics-card" style={{ marginTop: 12 }}>
      <div className="analytics-card-head">Advanced analytics</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Underwater equity</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
            {underwater.slice(-40).map((p, i) => (
              <div
                key={`uw-${i}`}
                title={`-${p.underwater}$`}
                style={{
                  flex: 1,
                  height: `${Math.max(4, (p.underwater / maxUw) * 100)}%`,
                  background: 'var(--danger)',
                  opacity: 0.35 + (p.underwater / maxUw) * 0.65,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Monte Carlo (1000 runs)</div>
          {monte ? (
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div>Final P&L p50: <strong>{monte.finalEquity?.p50}$</strong></div>
              <div>Max DD p50: <strong>-{monte.maxDrawdown?.p50}$</strong></div>
              <div>Prob. loss: <strong>{monte.probabilityOfLoss}%</strong></div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Need closed trades</div>
          )}
        </div>
      </div>
    </div>
  );
}
