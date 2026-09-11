import React, { useEffect, useRef, useState } from 'react';

export default function MultiPickFilter({
  label,
  options = [],
  selected = [],
  onChange,
  formatOption = (o) => o,
  maxMenuHeight = 240,
  disabled = false,
  emptyHint = 'No values in this scope',
  /** Label for the top action that clears selection (e.g. "All days" for weekday picker). */
  allButtonLabel = 'Clear (all)',
  allButtonTitle,
  /** Optional stable id for E2E (e.g. `trades-slice-tf`). */
  testId
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (val) => {
    const set = new Set(selected);
    if (set.has(val)) set.delete(val);
    else set.add(val);
    onChange([...set]);
  };

  const n = selected.length;
  const noOpts = options.length === 0;

  return (
    <div
      className={`filter-multipick ${disabled ? 'is-disabled' : ''}`}
      ref={wrapRef}
      data-testid={testId || undefined}
    >
      <button
        type="button"
        className="filter-multipick-trigger"
        data-testid={testId ? `${testId}-trigger` : undefined}
        disabled={disabled || noOpts}
        onClick={() => setOpen((v) => !v)}
        title={noOpts ? emptyHint : `${label}: no checkmarks = include all`}
      >
        <span className="filter-multipick-label">{label}</span>
        <span className="filter-multipick-badge">{n === 0 ? 'all' : n}</span>
      </button>
      {open && !noOpts && (
        <div className="filter-multipick-menu" style={{ maxHeight: maxMenuHeight }}>
          <button
            type="button"
            className="filter-multipick-all"
            title={allButtonTitle}
            onClick={() => { onChange([]); }}
          >
            {allButtonLabel}
          </button>
          <div className="filter-multipick-list">
            {options.map((opt) => (
              <label key={opt} className="filter-multipick-item" title={opt}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                <span>{formatOption(opt)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
