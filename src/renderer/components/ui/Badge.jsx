import React from 'react';

/**
 * Badge component - status, labels, counters
 */
export default function Badge({
  children,
  variant = 'default', // 'default' | 'success' | 'danger' | 'warning' | 'info'
  size = 'md', // 'sm' | 'md' | 'lg'
  icon = null,
  pill = false,
  animated = false,
  className = '',
  ...props
}) {
  const variantClasses = {
    default: 'badge-default',
    success: 'badge-success',
    danger: 'badge-danger',
    warning: 'badge-warning',
    info: 'badge-info',
  };

  const sizeClasses = {
    sm: 'badge-sm',
    md: 'badge-md',
    lg: 'badge-lg',
  };

  return (
    <span
      className={`
        badge
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${pill ? 'badge-pill' : ''}
        ${animated ? 'badge-animate' : ''}
        ${className}
      `}
      {...props}
    >
      {icon && <span className="badge-icon">{icon}</span>}
      {children}
    </span>
  );
}

