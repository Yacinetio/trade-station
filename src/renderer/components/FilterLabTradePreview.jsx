import React from 'react';

function formatMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function FilterLabTradePreview({
  insight = null,
  breakEvenAmount = 50,
  onClear = () => {},
  onApply = null,
  testIdPrefix = 'filter-lab-preview'
}) {
  if (!insight?.trades?.length) return null;

  const stats = insight.stats;
  const shown = insight.trades.slice(0, 12);
  const more = insight.trades.length - shown.length;

  return (
    <div className="filter-lab-trade-preview" data-testid={`${testIdPrefix}-panel`}>
      <div className="filter-lab-trade-preview-header">
        <div>
          <div className="filter-lab-trade-preview-title">{insight.title}</div>
          {insight.subtitle && (
            <div className="filter-lab-trade-preview-sub">{insight.subtitle}</div>
          )}
          {insight.counterfactual && (
            <div className="filter-lab-trade-preview-counterfactual">{insight.counterfactual}</div>
          )}
          {insight.type === 'avoid' && (
            <div className="filter-lab-trade-preview-tip">
              These are the leaky trades — do not copy this filter combo in live signals. Use Templates to save setups that exclude this pattern.
            </div>
          )}
        </div>
        <div className="filter-lab-trade-preview-tools">
          {stats && (
            <span className="filter-lab-trade-preview-stats">
              <strong>{stats.tradeCount}</strong> trades
              {stats.winRate != null && <> · <strong>{stats.winRate}%</strong> WR</>}
              <span style={{ color: stats.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {' '}· <strong>{formatMoney(stats.pnl)}</strong>
              </span>
            </span>
          )}
          {onApply && insight.filterPatch && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onApply(insight)}>
              Apply filters
            </button>
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={onClear}>Clear</button>
        </div>
      </div>
      <div className="filter-lab-trade-preview-table-wrap">
        <table className="filter-lab-trade-preview-table">
          <thead>
            <tr>
              <th>Open</th>
              <th>Symbol</th>
              <th>TF</th>
              <th>Type</th>
              <th>Profit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                <td>{formatDate(t.openedAt || t.time)}</td>
                <td><strong>{t.symbol}</strong></td>
                <td>{t.timeframe || '—'}</td>
                <td>{t.type || '—'}</td>
                <td className={Number(t.profit) >= 0 ? 'pos' : 'neg'}>{formatMoney(t.profit)}</td>
                <td>{String(t.status || '').replace(/_/g, ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && (
        <div className="filter-lab-trade-preview-more">+ {more} more trade{more !== 1 ? 's' : ''} in this slice</div>
      )}
    </div>
  );
}
