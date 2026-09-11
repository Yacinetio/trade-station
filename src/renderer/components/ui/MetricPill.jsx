import React from 'react';

export default function MetricPill({ label, value, tone = 'neutral', title }) {
  return (
    <div className="stat-pill" title={title || undefined}>
      <span className="stat-pill-label">{label}{title ? <span className="stat-pill-hint" aria-hidden="true"> ⓘ</span> : null}</span>
      <span className={`stat-pill-value metric-tone-${tone}`}>{value}</span>
    </div>
  );
}
