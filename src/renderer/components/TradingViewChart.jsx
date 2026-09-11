import React, { useEffect, useId, useRef, useState } from 'react';

const TV_SCRIPT_SRC = 'https://s3.tradingview.com/tv.js';

let tvLoadPromise = null;

function loadTradingView() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'));
  if (window.TradingView && typeof window.TradingView.widget === 'function') {
    return Promise.resolve(window.TradingView);
  }
  if (tvLoadPromise) return tvLoadPromise;
  tvLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TV_SCRIPT_SRC}"]`);
    const onReady = () => {
      if (window.TradingView && typeof window.TradingView.widget === 'function') {
        resolve(window.TradingView);
      } else {
        reject(new Error('tradingview_unavailable'));
      }
    };
    const onError = () => reject(new Error('tradingview_load_failed'));
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', onError, { once: true });
      if (window.TradingView && typeof window.TradingView.widget === 'function') onReady();
      return;
    }
    const s = document.createElement('script');
    s.src = TV_SCRIPT_SRC;
    s.async = true;
    s.addEventListener('load', onReady, { once: true });
    s.addEventListener('error', onError, { once: true });
    document.head.appendChild(s);
  }).catch((e) => {
    tvLoadPromise = null;
    throw e;
  });
  return tvLoadPromise;
}

function isDarkPage() {
  if (typeof window === 'undefined') return true;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0a0c';
  const hex = bg.replace('#', '');
  if (hex.length !== 6) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return true;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55;
}

/**
 * Strip exchange / contract suffix so app state stays a simple root symbol (EURUSD, XAUUSD, BTCUSDT).
 */
function normalizeTradingViewSymbol(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  const idx = s.lastIndexOf(':');
  if (idx >= 0) s = s.slice(idx + 1);
  s = s.replace(/\s+/g, '').toUpperCase();
  s = s.replace(/\.P$/i, '');
  return s;
}

/**
 * TradingView Advanced Chart widget.
 *
 * Note: the widget renders inside a cross-origin iframe — the host page CANNOT
 * read its candles. The AI page fetches OHLC separately via getMarketBars and
 * sends a CHART_CTX text snippet with chat messages.
 */
export default function TradingViewChart({
  symbol = 'OANDA:XAUUSD',
  interval = '60',
  studies = [],
  hideTopToolbar = false,
  hideSideToolbar = false,
  className = '',
  onSymbolChange
}) {
  const containerId = `tv-mount-${useId().replace(/[:]/g, '')}`;
  const widgetRef = useRef(null);
  const containerRef = useRef(null);
  const onSymbolChangeRef = useRef(onSymbolChange);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onSymbolChangeRef.current = onSymbolChange;
  }, [onSymbolChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    loadTradingView()
      .then((TV) => {
        if (cancelled) return;
        try {
          if (widgetRef.current && typeof widgetRef.current.remove === 'function') {
            try { widgetRef.current.remove(); } catch (_) { /* noop */ }
          }
          if (containerRef.current) containerRef.current.innerHTML = '';
          const isDark = isDarkPage();
          widgetRef.current = new TV.widget({
            container_id: containerId,
            symbol,
            interval,
            timezone: 'Etc/UTC',
            theme: isDark ? 'dark' : 'light',
            style: '1',
            locale: 'en',
            toolbar_bg: 'rgba(0,0,0,0)',
            enable_publishing: false,
            hide_top_toolbar: !!hideTopToolbar,
            hide_side_toolbar: !!hideSideToolbar,
            withdateranges: true,
            allow_symbol_change: true,
            studies: Array.isArray(studies) ? studies : [],
            autosize: true
          });
          const w = widgetRef.current;
          if (w && typeof w.onChartReady === 'function') {
            w.onChartReady(() => {
              try {
                const chart = typeof w.chart === 'function' ? w.chart() : null;
                if (!chart || typeof chart.onSymbolChanged !== 'function') return;
                const sub = chart.onSymbolChanged();
                if (!sub || typeof sub.subscribe !== 'function') return;
                sub.subscribe(null, () => {
                  let raw = '';
                  try {
                    if (typeof chart.symbolExt === 'function') {
                      const ext = chart.symbolExt();
                      raw = (ext && (ext.symbol || ext.ticker || ext.name || ext.description)) || '';
                    }
                    if (!raw && typeof chart.symbol === 'function') raw = chart.symbol() || '';
                  } catch (_) {
                    /* noop */
                  }
                  const nextBase = normalizeTradingViewSymbol(raw);
                  const prevBase = normalizeTradingViewSymbol(symbol);
                  if (nextBase && nextBase !== prevBase && typeof onSymbolChangeRef.current === 'function') {
                    onSymbolChangeRef.current(nextBase);
                  }
                });
              } catch (_) {
                /* widget API differs by embed version */
              }
            });
          }
          setLoading(false);
        } catch (e) {
          setError(`Failed to mount TradingView: ${e?.message || e}`);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`TradingView unavailable: ${e?.message || e}`);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      try {
        if (widgetRef.current && typeof widgetRef.current.remove === 'function') {
          widgetRef.current.remove();
        }
      } catch (_) { /* noop */ }
      widgetRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [symbol, interval, hideTopToolbar, hideSideToolbar, containerId, JSON.stringify(studies)]);

  return (
    <div className={`tradingview-chart-wrap ${className}`}>
      {loading && !error ? (
        <div className="tradingview-chart-state">Loading TradingView…</div>
      ) : null}
      {error ? (
        <div className="tradingview-chart-state tradingview-chart-state--error">
          {error}
          <div className="tradingview-chart-state-hint">
            Make sure the app can reach <code>s3.tradingview.com</code>. The chat below still works without it.
          </div>
        </div>
      ) : null}
      <div ref={containerRef} id={containerId} className="tradingview-chart-mount" />
    </div>
  );
}
