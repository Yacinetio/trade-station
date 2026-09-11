import React, { useMemo, useState, useCallback } from 'react';
import '../styles/excursion.css';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mirrors main/excursionMetrics computeEfficiencyPct: realized ÷ MFE money, clamped 0–150. */
function efficiencyPct(trade) {
  const profit = toNum(trade?.profit);
  const mfeMoney = toNum(trade?.excursion?.mfeMoney);
  if (profit == null || mfeMoney == null || mfeMoney <= 0) return null;
  return Math.max(0, Math.min(150, (profit / mfeMoney) * 100));
}

function money(v) {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(2)}$`;
}

function Sparkline({ series }) {
  const points = useMemo(() => {
    const pairs = (Array.isArray(series) ? series : [])
      .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map((p) => [Number(p[0]), Number(p[1])]);
    if (pairs.length < 2) return null;
    const ts = pairs.map((p) => p[0]);
    const vs = pairs.map((p) => p[1]);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMin = Math.min(...vs, 0);
    const vMax = Math.max(...vs, 0);
    const tSpan = Math.max(1, tMax - tMin);
    const vSpan = Math.max(1e-9, vMax - vMin);
    const W = 400;
    const H = 64;
    const PAD = 4;
    const pts = pairs
      .map(([t, v]) => {
        const x = PAD + ((t - tMin) / tSpan) * (W - 2 * PAD);
        const y = PAD + (1 - (v - vMin) / vSpan) * (H - 2 * PAD);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const zeroY = PAD + (1 - (0 - vMin) / vSpan) * (H - 2 * PAD);
    const lastV = vs[vs.length - 1];
    return { pts, zeroY, W, H, lastV };
  }, [series]);

  if (!points) return null;
  return (
    <div className="excursion-sparkline-wrap">
      <div className="excursion-sparkline-title">Running P&amp;L (sampled by the EA)</div>
      <svg
        className="excursion-sparkline"
        viewBox={`0 0 ${points.W} ${points.H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Running P&L sparkline"
      >
        <line x1="0" y1={points.zeroY} x2={points.W} y2={points.zeroY} stroke="var(--text3)" strokeWidth="0.5" strokeDasharray="3 3" />
        <polyline
          points={points.pts}
          fill="none"
          stroke={points.lastV >= 0 ? 'var(--success)' : 'var(--danger)'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** Horizontal range bar: −MAE … entry(0) … +MFE in pips, with the realized exit marked. */
function RangeBar({ mfePips, maePips, exitPips }) {
  const total = Math.max(1e-6, (mfePips || 0) + (maePips || 0));
  const pct = (pips) => (Math.max(0, Math.min(total, pips)) / total) * 100;
  const entryX = pct(maePips || 0);
  const exitX = exitPips == null ? null : pct((maePips || 0) + exitPips);
  return (
    <>
      <div className="excursion-range" title={`MAE −${(maePips || 0).toFixed(1)} pips · entry · MFE +${(mfePips || 0).toFixed(1)} pips`}>
        <div className="excursion-range-fill excursion-range-fill--mae" style={{ left: 0, width: `${entryX}%` }} />
        <div className="excursion-range-fill excursion-range-fill--mfe" style={{ left: `${entryX}%`, width: `${100 - entryX}%` }} />
        <div className="excursion-range-marker excursion-range-marker--entry" style={{ left: `${entryX}%` }} title="Entry" />
        {exitX != null ? (
          <div className="excursion-range-marker excursion-range-marker--exit" style={{ left: `${Math.max(0, Math.min(100, exitX))}%` }} title="Exit (estimated from realized P&L)" />
        ) : null}
      </div>
      <div className="excursion-range-legend">
        <span>MAE −{(maePips || 0).toFixed(1)} pips</span>
        <span>entry</span>
        <span>MFE +{(mfePips || 0).toFixed(1)} pips</span>
      </div>
    </>
  );
}

export default function ExcursionPanel({ trade }) {
  const [bestExit, setBestExit] = useState(null);
  const [bestExitLoading, setBestExitLoading] = useState(false);

  const exc = trade?.excursion;
  const eff = efficiencyPct(trade);

  // $/pip implied by the EA's own numbers → realized pips estimate for the exit marker.
  const exitPips = useMemo(() => {
    const mfePips = toNum(exc?.mfePips);
    const mfeMoney = toNum(exc?.mfeMoney);
    const profit = toNum(trade?.profit);
    if (profit == null || mfePips == null || mfeMoney == null || mfePips <= 0 || mfeMoney <= 0) return null;
    return profit / (mfeMoney / mfePips);
  }, [exc, trade?.profit]);

  const handleBestExit = useCallback(async () => {
    if (!trade?.id || bestExitLoading) return;
    setBestExitLoading(true);
    try {
      const res = await window.electronAPI?.getBestExit?.(trade.id);
      setBestExit(res || { success: false, error: 'Request failed' });
    } catch (e) {
      setBestExit({ success: false, error: e?.message || 'Request failed' });
    } finally {
      setBestExitLoading(false);
    }
  }, [trade?.id, bestExitLoading]);

  if (!exc) return null;

  const effClass = eff == null ? null : eff >= 60 ? 'good' : eff >= 30 ? 'mid' : 'low';

  return (
    <section className="settings-section trade-detail-section" style={{ marginBottom: 0 }}>
      <h3>
        Excursion
        {eff != null ? (
          <span
            className={`excursion-eff-badge excursion-eff-badge--${effClass}`}
            style={{ marginLeft: 10 }}
            title="Efficiency: realized profit ÷ peak open profit (MFE)"
          >
            {eff.toFixed(0)}% efficient
          </span>
        ) : null}
      </h3>

      <div className="excursion-metrics-row">
        <div className="excursion-metric">
          <span className="excursion-metric-label">MFE</span>
          <span className="excursion-metric-value pos">+{(toNum(exc.mfePips) ?? 0).toFixed(1)} pips</span>
          <span className="excursion-metric-sub">{money(exc.mfeMoney)}</span>
        </div>
        <div className="excursion-metric">
          <span className="excursion-metric-label">MAE</span>
          <span className="excursion-metric-value neg">-{(toNum(exc.maePips) ?? 0).toFixed(1)} pips</span>
          <span className="excursion-metric-sub">{money(exc.maeMoney != null ? -Math.abs(exc.maeMoney) : null)}</span>
        </div>
        <div className="excursion-metric">
          <span className="excursion-metric-label">Realized</span>
          <span className={`excursion-metric-value ${Number(trade?.profit || 0) >= 0 ? 'pos' : 'neg'}`}>
            {money(trade?.profit)}
          </span>
          <span className="excursion-metric-sub">
            {exc.source === 'backfill' ? 'excursion from 1-min bars' : 'excursion tracked live by the EA'}
          </span>
        </div>
      </div>

      <RangeBar mfePips={toNum(exc.mfePips) ?? 0} maePips={toNum(exc.maePips) ?? 0} exitPips={exitPips} />

      <Sparkline series={exc.pnlSeries} />

      <button
        type="button"
        className="btn btn-outline"
        disabled={bestExitLoading}
        onClick={handleBestExit}
        title="Simulate alternative exits (fixed R targets, breakeven, trailing) over this trade's 1-min bars"
      >
        {bestExitLoading ? 'Simulating…' : 'Best exit analysis'}
      </button>

      {bestExit && !bestExit.success ? (
        <div className="excursion-best-exit-error">Best exit unavailable: {bestExit.error || 'unknown error'}</div>
      ) : null}

      {bestExit?.success ? (
        <table className="excursion-best-exit-table">
          <thead>
            <tr>
              <th>Exit strategy</th>
              <th>P&amp;L</th>
              <th>vs actual ({money(bestExit.actualProfit)})</th>
              <th>Exit</th>
            </tr>
          </thead>
          <tbody>
            {(bestExit.variants || []).map((v) => (
              <tr key={v.id}>
                <td>{v.label}</td>
                <td className={v.profit == null ? 'muted' : v.profit >= 0 ? 'pos' : 'neg'}>
                  {v.profit == null ? 'n/a' : money(v.profit)}
                </td>
                <td className={v.deltaVsActual == null ? 'muted' : v.deltaVsActual >= 0 ? 'pos' : 'neg'}>
                  {v.deltaVsActual == null ? '—' : `${v.deltaVsActual >= 0 ? '+' : ''}${v.deltaVsActual.toFixed(2)}$`}
                </td>
                <td className="muted">{v.exitReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
