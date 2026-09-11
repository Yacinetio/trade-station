import React, { useCallback, useRef } from 'react';
import { GripVertical } from 'lucide-react';

/** `1 / -1`, `1 / 2`, or `2 / 3` — same strings `computeOverviewGridPlacement` applies */
function centroidHalfSide(tileEl, pointerX) {
  const rect = tileEl?.getBoundingClientRect?.();
  if (!rect?.width) return 'left';
  const cx = rect.left + rect.width / 2;
  return pointerX < cx ? 'left' : 'right';
}

/**
 * Dashboard overview tile: grip drag handled by parent (framer-motion Reorder).
 * Bottom edge = persisted min-height; horizontal edges = half/full width & column preference.
 */
export default function DashboardWidgetChrome({
  id,
  title,
  layout,
  fullWidth = true,
  halfSidePref = 'left',
  appliedGridColumn,
  setWidgetMinHeight,
  clearWidgetMinHeight,
  setWidgetWide,
  setWidgetHalfSide,
  onGripPointerDown,
  flushContent = true,
  children
}) {
  const wrapRef = useRef(null);
  const minH = layout?.minHeights?.[id];

  const onResizeMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = wrapRef.current;
      if (!el) return;
      const startY = e.clientY;
      const startH = el.getBoundingClientRect().height;

      const onMove = (ev) => {
        const next = Math.max(140, Math.min(1800, startH + ev.clientY - startY));
        el.style.minHeight = `${next}px`;
      };
      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const next = Math.max(140, Math.min(1800, startH + ev.clientY - startY));
        el.style.minHeight = '';
        setWidgetMinHeight(id, next);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [id, setWidgetMinHeight]
  );

  const onEastResizeMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = wrapRef.current;
      const tile = el?.closest('.dash-widget-tile-slot');
      if (!el || !tile) return;
      const startWide = !!fullWidth;
      const startX = e.clientX;

      const previewFromDx = (dx) => {
        if (startWide && dx < -36) return false;
        if (!startWide && dx > 36) return true;
        return startWide;
      };

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const wide = previewFromDx(dx);
        if (wide) tile.style.gridColumn = '1 / -1';
        else {
          const h = centroidHalfSide(tile, ev.clientX);
          tile.style.gridColumn = h === 'left' ? '1 / 2' : '2 / 3';
        }
      };
      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        tile.style.gridColumn = '';
        const dx = ev.clientX - startX;
        if (startWide && dx < -36) {
          const side = centroidHalfSide(tile, ev.clientX);
          setWidgetWide(id, false, side === 'left' ? 'left' : 'right');
        } else if (!startWide && dx > 36) setWidgetWide(id, true);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [id, fullWidth, setWidgetWide]
  );

  const onWestResizeMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = wrapRef.current;
      const tile = el?.closest('.dash-widget-tile-slot');
      if (!el || !tile || fullWidth) return;
      const startX = e.clientX;
      const baseCol = appliedGridColumn === '2 / 3' ? '2 / 3' : '1 / 2';

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (dx < -36) tile.style.gridColumn = '1 / -1';
        else if (dx > 36) tile.style.gridColumn = baseCol === '1 / 2' ? '2 / 3' : '1 / 2';
        else tile.style.gridColumn = baseCol;
      };
      onMove(e);

      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        tile.style.gridColumn = '';
        const dx = ev.clientX - startX;
        if (dx < -36) setWidgetWide(id, true);
        else if (dx > 36) setWidgetHalfSide(id, baseCol === '1 / 2' ? 'right' : 'left');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [id, fullWidth, appliedGridColumn, setWidgetWide, setWidgetHalfSide]
  );

  return (
    <div
      ref={wrapRef}
      className="dash-widget-wrap"
      style={minH ? { minHeight: minH } : undefined}
      data-dashboard-widget={id}
    >
      <div className="dash-widget-head">
        <button
          type="button"
          className="dash-widget-grip"
          onPointerDown={(e) => {
            onGripPointerDown?.(e);
          }}
          aria-label={`Drag to reorder: ${title}`}
          title="Drag to reorder section"
        >
          <GripVertical size={14} aria-hidden />
        </button>
        <span className="dash-widget-title">{title}</span>
        {!fullWidth ? (
          <>
            <button
              type="button"
              className="dash-widget-reset-h btn btn-outline btn-sm"
              onClick={() => setWidgetHalfSide(id, 'left')}
              title="Move to the left column"
              disabled={halfSidePref === 'left'}
            >
              Left
            </button>
            <button
              type="button"
              className="dash-widget-reset-h btn btn-outline btn-sm"
              onClick={() => setWidgetHalfSide(id, 'right')}
              title="Move to the right column"
              disabled={halfSidePref === 'right'}
            >
              Right
            </button>
            <button
              type="button"
              className="dash-widget-reset-h btn btn-outline btn-sm"
              onClick={() => setWidgetWide(id, true)}
              title="Expand this section to full width"
            >
              Full width
            </button>
          </>
        ) : (
          <button
            type="button"
            className="dash-widget-reset-h btn btn-outline btn-sm"
            onClick={() => setWidgetWide(id, false, 'left')}
            title="Shrink to half width (left column)"
          >
            Half width
          </button>
        )}
        {minH ? (
          <button
            type="button"
            className="dash-widget-reset-h btn btn-outline btn-sm"
            onClick={() => clearWidgetMinHeight(id)}
            title="Use automatic height for this section"
          >
            Auto height
          </button>
        ) : null}
      </div>
      <div className={`dash-widget-body${flushContent ? ' dash-widget-body--flush' : ''}`}>{children}</div>
      <div className="dash-widget-resize-row">
        {!fullWidth ? (
          <div
            className="dash-widget-resize dash-widget-resize--west"
            onMouseDown={onWestResizeMouseDown}
            title="Drag left for full width · drag right to swap column"
            role="separator"
            aria-orientation="vertical"
          />
        ) : (
          <div className="dash-widget-resize dash-widget-resize--west dash-widget-resize--west-spacer" aria-hidden />
        )}
        <div
          className="dash-widget-resize dash-widget-resize--south"
          onMouseDown={onResizeMouseDown}
          onDoubleClick={(ev) => {
            ev.preventDefault();
            clearWidgetMinHeight(id);
          }}
          title="Drag up/down for minimum height · double-click to reset"
          role="separator"
          aria-orientation="horizontal"
        />
        <div
          className="dash-widget-resize dash-widget-resize--east"
          onMouseDown={onEastResizeMouseDown}
          title="Drag left for half width (side follows pointer) · drag right for full width"
          role="separator"
          aria-orientation="vertical"
        />
      </div>
    </div>
  );
}
