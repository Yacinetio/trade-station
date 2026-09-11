import React from 'react';
import { motion } from 'framer-motion';

/**
 * GradientBackground Component
 * Animated gradient background with customizable gradients and animation
 * Adapted for TradeSync (no Tailwind, using CSS-in-JS)
 */

const Default_Gradients = [
  'linear-gradient(135deg, #2d1b69 0%, #11998e 100%)',
  'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
  'linear-gradient(135deg, #0f3460 0%, #e94560 100%)',
  'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
  'linear-gradient(135deg, #2d1b69 0%, #11998e 100%)',
];

export function GradientBackground({
  children,
  className = '',
  gradients = Default_Gradients,
  animationDuration = 8,
  animationDelay = 0.5,
  overlay = false,
  overlayOpacity = 0.3,
  enableCenterContent = true,
  style = {},
  ...props
}) {
  const containerStyle = {
    width: '100%',
    position: 'relative',
    minHeight: '100vh',
    overflow: 'hidden',
    ...style,
  };

  const gradientStyle = {
    position: 'absolute',
    inset: 0,
  };

  const overlayStyle = {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'black',
    opacity: overlayOpacity,
  };

  const contentWrapperStyle = enableCenterContent
    ? {
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }
    : {
        position: 'relative',
        zIndex: 10,
        minHeight: '100vh',
      };

  return (
    <div style={containerStyle} className={className} {...props}>
      {/* Animated gradient background */}
      <motion.div
        style={{ ...gradientStyle, background: gradients[0] }}
        animate={{ background: gradients }}
        transition={{
          delay: animationDelay,
          duration: animationDuration,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
      />

      {/* Optional overlay */}
      {overlay && <div style={overlayStyle} />}

      {/* Content wrapper */}
      {children && <div style={contentWrapperStyle}>{children}</div>}
    </div>
  );
}
