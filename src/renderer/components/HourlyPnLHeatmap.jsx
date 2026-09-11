import React, { useMemo } from 'react';

/**
 * @param {Array<{key, pnl, trades, pnlPerTrade?}>} byHour
 * @param {'sum'|'avg'} valueMode
 */
export function build24HourBucketsFromByHour(byHour, valueMode = 'sum') {
  const map = new Map();
  for (const row of byHour || []) {
    const h = Number(row.key);
    if (!Number.isFinite(h) || h < 0 || h > 23) continue;
    const pnl = Number(row.pnl) || 0;
    const trades = Number(row.trades) || 0;
    const pnlPer =
      row.pnlPerTrade != null && Number.isFinite(Number(row.pnlPerTrade))
        ? Number(row.pnlPerTrade)
        : trades > 0
          ? pnl / trades
          : 0;
    map.set(h, { pnl, trades, pnlPerTrade: pnlPer });
  }
  return Array.from({ length: 24 }, (_, hour) => {
    const pnl = map.get(hour)?.pnl ?? 0;
    const trades = map.get(hour)?.trades ?? 0;
    const pnlPerTrade = map.get(hour)?.pnlPerTrade ?? (trades > 0 ? pnl / trades : 0);
    const useAvg = valueMode === 'avg' && trades > 0;
    const displayValue = useAvg ? pnlPerTrade : pnl;
    return {
      hour,
      pnl,
      trades,
      pnlPerTrade,
      displayValue
    };
  });
}

function HeatmapCell({ hour, displayValue, pnl, trades, pnlPerTrade, maxAbs, isAvg }) {
  const intensity = maxAbs > 0 ? Math.min(Math.abs(displayValue) / maxAbs, 1) : 0;
  const isPos = displayValue >= 0;
  const hasData = trades > 0;
  const bg = !hasData
    ? 'color-mix(in srgb, var(--surface2) 80%, transparent)'
    : isPos
      ? `rgba(36, 208, 132, ${0.08 + intensity * 0.5})`
      : `rgba(255, 92, 117, ${0.08 + intensity * 0.5})`;
  const border = !hasData
    ? 'rgba(36,53,84,0.4)'
    : isPos
      ? `rgba(36, 208, 132, ${0.25 + intensity * 0.5})`
      : `rgba(255, 92, 117, ${0.25 + intensity * 0.5})`;
  const fmt = (h) => `${String(h).padStart(2, '0')}h`;
  const tooltip =
    hasData
      ? isAvg
        ? `${fmt(hour)} — ${trades} trade${trades !== 1 ? 's' : ''} | Total ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$ | Avg ${pnlPerTrade >= 0 ? '+' : ''}${pnlPerTrade.toFixed(2)}$/trade`
        : `${fmt(hour)} — ${trades} trade${trades !== 1 ? 's' : ''}, total ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$`
      : `${fmt(hour)} — no trades`;
  const dec = isAvg ? 2 : 1;
  return (
    <div
      className="hourly-heatmap-cell"
      title={tooltip}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: '4px 2px',
        textAlign: 'center',
        minWidth: 0,
        transition: 'all 0.2s'
      }}
    >
      <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 2 }}>{fmt(hour)}</div>
      {hasData ? (
        <div style={{ fontSize: 10, fontWeight: 700, color: isPos ? 'var(--success)' : 'var(--danger)' }}>
          {displayValue >= 0 ? '+' : ''}
          {Number(displayValue).toFixed(dec)}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--text3)' }}>—</div>
      )}
      {hasData && (
        <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 1 }}>{trades}t</div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {'sum'|'avg'} [props.valueMode] - 'avg' = mean P&L per trade in that hour (for multi-day scopes)
 * @param {string} [props.scopeLabel] - e.g. WEEK, for subtitle
 */
export default function HourlyPnLHeatmap({
  byHour,
  buckets: bucketsProp,
  title = 'Hourly trading heatmap',
  subtitle: subtitleProp,
  className = '',
  embedded = false,
  valueMode = 'sum',
  scopeLabel = ''
}) {
  const scopeUpper = String(scopeLabel || '').toUpperCase();
  const autoSubtitle =
    valueMode === 'avg'
      ? `Avg $/trade per clock hour in selected period${scopeUpper ? ` (${scopeUpper})` : ''} · closed · open time local`
      : 'Total P&L per clock hour · closed · open time local';
  const subtitle = (subtitleProp != null && String(subtitleProp).length > 0) ? subtitleProp : autoSubtitle;

  const buckets = useMemo(() => {
    const useAvg = valueMode === 'avg';
    if (Array.isArray(bucketsProp) && bucketsProp.length === 24) {
      return bucketsProp.map((b, i) => {
        const pnl = Number(b.pnl) || 0;
        const t = Number(b.trades) || 0;
        const pper =
          b.pnlPerTrade != null && Number.isFinite(Number(b.pnlPerTrade))
            ? Number(b.pnlPerTrade)
            : t > 0
              ? pnl / t
              : 0;
        return {
          hour: Number.isFinite(b.hour) ? b.hour : i,
          pnl,
          trades: t,
          pnlPerTrade: pper,
          displayValue: useAvg && t > 0 ? pper : pnl
        };
      });
    }
    return build24HourBucketsFromByHour(byHour, valueMode);
  }, [byHour, bucketsProp, valueMode]);

  const maxAbs = useMemo(
    () => Math.max(...buckets.map((b) => Math.abs(b.displayValue)), 0.01),
    [buckets]
  );
  const isAvg = valueMode === 'avg';

  return (
    <div className={`hourly-pnl-heatmap ${className}`.trim()}>
      {!embedded && (
        <div className="hourly-heatmap-head table-title" style={{ marginBottom: 8 }}>
          🕐 {title}
          {subtitle ? (
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>— {subtitle}</span>
          ) : null}
        </div>
      )}
      {embedded && subtitle ? (
        <p className="hourly-heatmap-embed-hint" style={{ fontSize: 11, color: 'var(--text3)', margin: '0 0 8px' }}>
          {subtitle}
        </p>
      ) : null}
      <div className="hourly-heatmap-grid">
        {buckets.map((b) => (
          <HeatmapCell
            key={b.hour}
            hour={b.hour}
            pnl={b.pnl}
            trades={b.trades}
            pnlPerTrade={b.pnlPerTrade}
            displayValue={b.displayValue}
            maxAbs={maxAbs}
            isAvg={isAvg}
          />
        ))}
      </div>
      <div className="hourly-heatmap-legend">
        <span>{isAvg ? '📊 Avg $/trade per hour slot' : '📊 Total P&L per hour slot'}</span>
        <span>🟢 / 🔴 = sign</span>
        <span>{isAvg ? 'Intensity = |avg| size' : 'Intensity = |total| size'}</span>
      </div>
    </div>
  );
}
