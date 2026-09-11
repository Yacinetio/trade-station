import React, { useId } from 'react';

function polar(cx, cy, r, angleRad) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy - r * Math.sin(angleRad)
  };
}

function arcPath(cx, cy, r, fromRad, toRad) {
  const start = polar(cx, cy, r, fromRad);
  const end = polar(cx, cy, r, toRad);
  const sweep = fromRad > toRad ? 1 : 0;
  const large = Math.abs(fromRad - toRad) > Math.PI ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/** Win rate from TP ÷ (TP + SL); pills show TP / BE / SL counts. */
export default function TpSlWinRateGauge({
  tpHits = 0,
  slHits = 0,
  beCount = 0,
  winRatePct = null,
  compact = false,
  kpi = false,
  className = ''
}) {
  const titleId = useId();
  const decisive = Number(tpHits) + Number(slHits);
  const pct = winRatePct != null && Number.isFinite(Number(winRatePct))
    ? Number(winRatePct)
    : (decisive > 0 ? (Number(tpHits) / decisive) * 100 : null);
  const displayPct = pct != null ? `${pct.toFixed(2)}%` : '—';

  const inKpi = kpi && !compact;
  const w = compact ? 120 : (inKpi ? 72 : 100);
  const h = compact ? 52 : (inKpi ? 40 : 52);
  const cx = compact ? 58 : (inKpi ? 36 : 50);
  const cy = compact ? 46 : (inKpi ? 36 : 44);
  const arcR = compact ? 34 : (inKpi ? 24 : 32);
  const stroke = compact ? 7 : (inKpi ? 5 : 7);

  const start = Math.PI;
  const end = 0;
  const winFrac = pct != null ? Math.min(1, Math.max(0, pct / 100)) : 0;
  const split = start - winFrac * Math.PI;

  const trackPath = arcPath(cx, cy, arcR, start, end);
  const winPath = winFrac > 0 ? arcPath(cx, cy, arcR, start, split) : '';
  const lossPath = winFrac < 1 && decisive > 0 ? arcPath(cx, cy, arcR, split, end) : '';

  return (
    <div
      className={`tp-sl-winrate-gauge ${compact ? 'tp-sl-winrate-gauge--compact' : ''} ${inKpi ? 'tp-sl-winrate-gauge--kpi' : ''} ${className}`.trim()}
      role="img"
      aria-labelledby={titleId}
    >
      <div className="tp-sl-winrate-gauge__body">
        <div className="tp-sl-winrate-gauge__text">
          <div className="tp-sl-winrate-gauge__label" id={titleId}>
            Win rate (TP / SL)
            <span
              className="tp-sl-winrate-gauge__info"
              title="TP and SL hits only. Break-even and EOD are shown separately and do not affect this %."
            >
              ⓘ
            </span>
          </div>
          <div className="tp-sl-winrate-gauge__value">{displayPct}</div>
        </div>
        <div className="tp-sl-winrate-gauge__viz">
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
            <path
              d={trackPath}
              fill="none"
              stroke="color-mix(in srgb, var(--text3) 35%, transparent)"
              strokeWidth={stroke}
              strokeLinecap="round"
            />
            {winPath ? (
              <path d={winPath} fill="none" stroke="var(--success)" strokeWidth={stroke} strokeLinecap="round" />
            ) : null}
            {lossPath ? (
              <path d={lossPath} fill="none" stroke="var(--danger)" strokeWidth={stroke} strokeLinecap="round" />
            ) : null}
          </svg>
          <div className="tp-sl-winrate-gauge__pills">
            <span className="tp-sl-winrate-gauge__pill tp-sl-winrate-gauge__pill--tp" title="Take profit">{tpHits}</span>
            <span className="tp-sl-winrate-gauge__pill tp-sl-winrate-gauge__pill--be" title="Break-even">{beCount}</span>
            <span className="tp-sl-winrate-gauge__pill tp-sl-winrate-gauge__pill--sl" title="Stop loss">{slHits}</span>
          </div>
        </div>
      </div>
    </div>
  );
}