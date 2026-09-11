import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ts-ui-mode';
const MODE_EVENT = 'ts-ui-mode-changed';

/** Pages hidden in simple mode */
export const ADVANCED_ONLY_PAGES = new Set([
  'filter-lab', 'parser-lab', 'ai', 'fundamentals', 'channels',
  // TradeZella-parity pages gated to advanced mode (pre-registered for feature agents)
  'reports', 'replay', 'backtest',
]);

function readUiMode() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'advanced' || raw === 'simple') return raw;
  } catch {
    /* noop */
  }
  return 'simple';
}

function writeUiMode(mode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: { mode } }));
}

/** Persisted UI mode — simple (retail) vs advanced (power users). */
export function useUiMode() {
  const [uiMode, setUiModeState] = useState(readUiMode);

  useEffect(() => {
    const onChange = (e) => {
      const next = e?.detail?.mode ?? readUiMode();
      setUiModeState(next);
    };
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setUiModeState(readUiMode());
    };
    window.addEventListener(MODE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MODE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setUiMode = useCallback((mode) => {
    const next = mode === 'advanced' ? 'advanced' : 'simple';
    writeUiMode(next);
    setUiModeState(next);
  }, []);

  return {
    uiMode,
    setUiMode,
    isSimple: uiMode === 'simple',
    isAdvanced: uiMode === 'advanced',
  };
}
