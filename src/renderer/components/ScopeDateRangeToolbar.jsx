import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import {
  defaultCustomAnalyticsRange,
  isoYmdCustomRangeBounds,
  toYmd
} from '../utils/timeCalendarScope.js';

export default function ScopeDateRangeToolbar({
  timeScope,
  setTimeScope,
  customRange,
  setCustomRange,
  testIdPrefix = 'scope-date'
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: undefined, to: undefined });

  const selected = useMemo(() => {
    const b = isoYmdCustomRangeBounds(customRange?.from, customRange?.to);
    if (!b || !b.start || !b.end) return { from: undefined, to: undefined };
    return { from: b.start, to: b.end };
  }, [customRange?.from, customRange?.to]);

  useEffect(() => {
    if (String(timeScope || '').toUpperCase() !== 'CUSTOM') return;
    if (customRange?.from && customRange?.to) return;
    setCustomRange(defaultCustomAnalyticsRange());
  }, [timeScope, customRange?.from, customRange?.to, setCustomRange]);

  const triggerLabel = useMemo(() => {
    if (String(timeScope || '').toUpperCase() !== 'CUSTOM') return '';
    if (!customRange?.from || !customRange?.to) return 'Pick dates…';
    try {
      const a = new Date(`${customRange.from}T12:00:00`);
      const z = new Date(`${customRange.to}T12:00:00`);
      if (Number.isNaN(a.getTime()) || Number.isNaN(z.getTime())) return 'Pick dates…';
      return `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${z.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch (_) {
      return 'Pick dates…';
    }
  }, [timeScope, customRange?.from, customRange?.to]);

  const onSelectScope = useCallback((e) => {
    const v = String(e.target.value || '').toUpperCase();
    setTimeScope(v);
    if (v === 'CUSTOM') {
      if (!customRange?.from || !customRange?.to) {
        setCustomRange(defaultCustomAnalyticsRange());
      }
    }
  }, [setTimeScope, setCustomRange, customRange?.from, customRange?.to]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select
        className="titlebar-select"
        data-testid={`${testIdPrefix}-time-scope`}
        value={timeScope}
        onChange={onSelectScope}
        title="Date range"
      >
        <option value="DAY">Date range: Day</option>
        <option value="WEEK">Date range: Week</option>
        <option value="MONTH">Date range: Month</option>
        <option value="YEAR">Date range: Year</option>
        <option value="CUSTOM">Date range: Custom…</option>
        <option value="ALL">Date range: All</option>
      </select>

      {String(timeScope || '').toUpperCase() === 'CUSTOM' && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn btn-outline btn-titlebar btn-titlebar-compact"
            data-testid={`${testIdPrefix}-custom-trigger`}
            title="Choose start and end (same as calendar page)"
            onClick={() => {
              setDraft(selected.from && selected.to ? { from: selected.from, to: selected.to } : { from: undefined, to: undefined });
              setOpen((o) => !o);
            }}
          >
            <Calendar size={14} aria-hidden />
            <span>{triggerLabel}</span>
            <ChevronDown size={14} aria-hidden />
          </button>

          {open && (
            <>
              <div
                className="calendar-range-popover-backdrop"
                aria-hidden
                onClick={() => setOpen(false)}
              />
              <div
                className="calendar-range-popover scope-date-range-popover"
                style={{ right: 0, left: 'auto' }}
                role="dialog"
                aria-modal="false"
                onMouseDown={(e) => {
                  /** Keep picker usable: backdrop sits under this due to global z-index, but guard against bubbling weirdness */
                  e.stopPropagation();
                }}
              >
                <DayPicker
                  mode="range"
                  selected={draft}
                  onSelect={(nextRange) => {
                    setDraft(nextRange || { from: undefined, to: undefined });
                  }}
                  numberOfMonths={1}
                  defaultMonth={draft?.from || selected.from || new Date()}
                />
                <div className="calendar-range-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setDraft(selected.from && selected.to ? { from: selected.from, to: selected.to } : { from: undefined, to: undefined });
                      setOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)' }}
                    onClick={() => {
                      let f = draft?.from ? toYmd(draft.from) : '';
                      let t = draft?.to ? toYmd(draft.to) : '';
                      if (f && !t) t = f;
                      if (f && t) setCustomRange({ from: f, to: t });
                      setOpen(false);
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
