import React, { useCallback, useMemo, useRef, useState } from 'react';
import DashboardWidgetChrome from './DashboardWidgetChrome.jsx';
import { buildOverviewRowGroups, computeOverviewGridPlacement } from '../utils/dashboardOverviewPlacement.js';

export default function DashboardOverviewReorder({
  layout,
  reorderAll,
  setWidgetMinHeight,
  clearWidgetMinHeight,
  setWidgetWide,
  setWidgetHalfSide,
  widgetLabels,
  renderWidget
}) {
  const order = layout.order;
  const placement = useMemo(
    () => computeOverviewGridPlacement(order, layout.wide || {}, layout.halfSide || {}),
    [order, layout.wide, layout.halfSide]
  );
  const rowGroups = useMemo(
    () => buildOverviewRowGroups(order, layout.wide || {}, layout.halfSide || {}),
    [order, layout.wide, layout.halfSide]
  );

  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const stackRef = useRef(null);

  const finishDrag = useCallback((dragId, clientY) => {
    setDraggingId(null);
    setDropTargetId(null);
    if (!dragId || !stackRef.current) return;

    const tiles = [...stackRef.current.querySelectorAll('[data-overview-tile-id]')];
    let targetId = null;
    for (const el of tiles) {
      const id = el.getAttribute('data-overview-tile-id');
      if (!id || id === dragId) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        targetId = id;
        break;
      }
    }

    const from = order.indexOf(dragId);
    if (from < 0) return;

    const next = order.filter((id) => id !== dragId);
    if (!targetId) {
      next.push(dragId);
    } else {
      const to = next.indexOf(targetId);
      if (to < 0) next.push(dragId);
      else next.splice(to, 0, dragId);
    }
    if (next.join('|') !== order.join('|')) reorderAll(next);
  }, [order, reorderAll]);

  const onGripPointerDown = useCallback((dragId, e) => {
    e.preventDefault();
    setDraggingId(dragId);
    const startY = e.clientY;

    const onMove = (ev) => {
      if (!stackRef.current) return;
      const tiles = [...stackRef.current.querySelectorAll('[data-overview-tile-id]')];
      let target = null;
      for (const el of tiles) {
        const id = el.getAttribute('data-overview-tile-id');
        if (!id || id === dragId) continue;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (ev.clientY < mid) {
          target = id;
          break;
        }
      }
      setDropTargetId(target);
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      finishDrag(dragId, ev.clientY);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    onMove(e);
    void startY;
  }, [finishDrag]);

  const renderTile = (wid) => {
    if (!wid) return null;
    const fullWidth = layout.wide?.[wid] !== false;
    const halfPref = layout.halfSide?.[wid] === 'right' ? 'right' : 'left';
    const isDragging = draggingId === wid;
    const isDropBefore = dropTargetId === wid && draggingId && draggingId !== wid;

    return (
      <div
        key={wid}
        data-overview-tile-id={wid}
        className={[
          'dash-widget-tile-slot',
          fullWidth ? 'dash-widget-tile-slot--full' : `dash-widget-tile-slot--${halfPref}`,
          isDragging ? 'dash-widget-tile-slot--dragging' : '',
          isDropBefore ? 'dash-widget-tile-slot--drop-before' : ''
        ].filter(Boolean).join(' ')}
      >
        <DashboardWidgetChrome
          id={wid}
          title={widgetLabels[wid]}
          layout={layout}
          fullWidth={fullWidth}
          halfSidePref={halfPref}
          appliedGridColumn={placement[wid]?.gridColumn}
          setWidgetMinHeight={setWidgetMinHeight}
          clearWidgetMinHeight={clearWidgetMinHeight}
          setWidgetWide={setWidgetWide}
          setWidgetHalfSide={setWidgetHalfSide}
          onGripPointerDown={(ev) => onGripPointerDown(wid, ev)}
        >
          {renderWidget(wid)}
        </DashboardWidgetChrome>
      </div>
    );
  };

  return (
    <div ref={stackRef} className="dash-overview-stack">
      {rowGroups.map((group) => (
        <div key={`overview-row-${group.row}`} className="dash-overview-row">
          {group.fullId ? (
            renderTile(group.fullId)
          ) : (
            <>
              <div className="dash-overview-half-slot dash-overview-half-slot--left">
                {renderTile(group.leftId)}
              </div>
              <div className="dash-overview-half-slot dash-overview-half-slot--right">
                {renderTile(group.rightId)}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
