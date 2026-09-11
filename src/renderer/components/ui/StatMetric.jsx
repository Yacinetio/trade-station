import React from 'react';

/**
 * StatMetric - Modern statistic card with animation
 * @param {string} icon - Emoji or icon
 * @param {string} label - Stat label (e.g., "WIN RATE")
 * @param {string|number} value - Stat value (e.g., "62.5%")
 * @param {string} color - Color class: 'success', 'danger', 'warning', 'accent', 'neutral'
 * @param {string} trend - Optional trend indicator: 'up', 'down', 'stable'
 * @param {number} trendValue - Optional trend percentage
 * @param {string} description - Optional description text
 */
export default function StatMetric({
  icon = '📊',
  label = 'Metric',
  value = '--',
  color = 'accent',
  trend = null,
  trendValue = 0,
  description = '',
  size = 'md', // 'sm' | 'md' | 'lg'
  animated = true,
  className = '',
  ...props
}) {
  const getTrendIcon = () => {
    if (trend === 'up') return '↗';
    if (trend === 'down') return '↘';
    return '→';
  };

  const getTrendColor = () => {
    if (trend === 'up') return 'var(--success)';
    if (trend === 'down') return 'var(--danger)';
    return 'var(--text2)';
  };

  const sizeClasses = {
    sm: 'stat-metric-sm',
    md: 'stat-metric-md',
    lg: 'stat-metric-lg',
  };

  return (
    <div
      className={`stat-metric stat-metric-${color} ${sizeClasses[size]} ${animated ? 'animate' : ''} ${className}`}
      {...props}
    >
      <div className="stat-metric-header">
        <span className="stat-metric-icon">{icon}</span>
        <span className="stat-metric-label">{label}</span>
      </div>

      <div className="stat-metric-value">{value}</div>

      {description && <div className="stat-metric-description">{description}</div>}

      {trend && (
        <div className="stat-metric-trend" style={{ color: getTrendColor() }}>
          <span className="trend-icon">{getTrendIcon()}</span>
          <span className="trend-value">{Math.abs(trendValue)}%</span>
        </div>
      )}
    </div>
  );
}

