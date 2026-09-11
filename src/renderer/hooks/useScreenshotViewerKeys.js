import { useEffect } from 'react';

/**
 * ← / → (also ↑ / ↓) cycle screenshot index while overlay/modal open.
 */
export function useScreenshotViewerKeys(isActive, imageCount, setActiveIdx) {
  useEffect(() => {
    if (!isActive || imageCount < 2) return undefined;
    const max = imageCount - 1;
    const onKey = (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(max, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, imageCount, setActiveIdx]);
}
