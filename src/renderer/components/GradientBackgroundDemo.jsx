import React from 'react';
import { GradientBackground } from '../ui/gradient-background';

/**
 * Demo: GradientBackground Component
 * Shows how to use the animated gradient background
 */

export default function GradientBackgroundDemo() {
  return (
    <GradientBackground
      gradients={[
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      ]}
      animationDuration={10}
      animationDelay={0}
      overlay
      overlayOpacity={0.4}
    >
      <div
        style={{
          textAlign: 'center',
          color: 'white',
          padding: '40px 20px',
          zIndex: 20,
        }}
      >
        <h1 style={{ fontSize: '48px', fontWeight: 'bold', marginBottom: '20px' }}>
          ✨ Animated Gradient Background
        </h1>

        <p style={{ fontSize: '18px', marginBottom: '40px', opacity: 0.9 }}>
          Beautiful animated gradients for your dashboards and landing pages
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
            maxWidth: '800px',
            margin: '0 auto',
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '20px',
              borderRadius: '12px',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <h3 style={{ fontSize: '20px', marginBottom: '10px' }}>🎨 Features</h3>
            <ul
              style={{
                textAlign: 'left',
                fontSize: '14px',
                opacity: 0.9,
              }}
            >
              <li>✓ Smooth animations</li>
              <li>✓ Customizable gradients</li>
              <li>✓ Optional overlay</li>
              <li>✓ Responsive design</li>
            </ul>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '20px',
              borderRadius: '12px',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <h3 style={{ fontSize: '20px', marginBottom: '10px' }}>⚡ Performance</h3>
            <ul
              style={{
                textAlign: 'left',
                fontSize: '14px',
                opacity: 0.9,
              }}
            >
              <li>✓ Uses Framer Motion</li>
              <li>✓ GPU accelerated</li>
              <li>✓ Smooth 60fps</li>
              <li>✓ No lag</li>
            </ul>
          </div>
        </div>

        <div style={{ marginTop: '40px' }}>
          <code
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              padding: '15px 20px',
              borderRadius: '8px',
              fontSize: '12px',
              display: 'inline-block',
              color: '#fff',
            }}
          >
            &lt;GradientBackground overlay animationDuration={'{10}'}&gt;
            <br />
            {'  '}Your content here
            <br />
            &lt;/GradientBackground&gt;
          </code>
        </div>
      </div>
    </GradientBackground>
  );
}

