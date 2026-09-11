import React from 'react';

/**
 * Modern animated progress bar
 * @param {number} value - Progress value 0-100
 * @param {string} color - 'success', 'danger', 'warning', 'accent'
 * @param {JSX} label - Optional label above bar
 * @param {JSX} rightContent - Optional content on the right
 * @param {boolean} animated - Enable animation
 * @param {string} size - 'sm', 'md', 'lg'
 */
export default function ProgressBar({
  value = 50,
  color = 'accent',
  label = null,
  rightContent = null,
  animated = true,
  size = 'md',
  showValue = false,
  className = '',
  ...props
}) {
  const clampedValue = Math.min(100, Math.max(0, value));

  const sizeClasses = {
    sm: 'progress-bar-sm',
    md: 'progress-bar-md',
    lg: 'progress-bar-lg',
  };

  return (
    <div className={`progress-bar-container ${className}`} {...props}>
      {label && (
        <div className="progress-bar-header">
          <span className="progress-label">{label}</span>
          {rightContent && <span className="progress-right">{rightContent}</span>}
          {showValue && <span className="progress-value">{clampedValue.toFixed(1)}%</span>}
        </div>
      )}

      <div className={`progress-bar-track ${sizeClasses[size]}`}>
        <div
          className={`progress-bar-fill progress-${color} ${animated ? 'animate' : ''}`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
}

