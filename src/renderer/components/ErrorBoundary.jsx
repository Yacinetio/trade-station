import React from 'react';

/**
 * Renderer-level error boundary. Wraps each lazy route subtree so a thrown render error
 * in one page does not blank the entire app. Reports the error through the existing
 * IPC log stream when available so the user can see it in the Activity Logs panel.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      const payload = {
        message: String(error?.message || error),
        stack: String(error?.stack || ''),
        component: String(info?.componentStack || '').slice(0, 600)
      };
      window.electronAPI?.reportRendererError?.(payload);
    } catch (_) {
      // best-effort
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-fallback" role="alert" style={{
          padding: 24,
          margin: 16,
          borderRadius: 12,
          border: '1px solid color-mix(in srgb, var(--danger) 60%, var(--border))',
          background: 'color-mix(in srgb, var(--danger) 6%, transparent)',
          color: 'var(--text)'
        }}>
          <h3 style={{ marginTop: 0 }}>Something went wrong on this screen.</h3>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text)',
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
