import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, EyeOff, Maximize2, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { WIDGET_BY_ID, WIDGET_REGISTRY } from './widgetRegistry.jsx';
import {
  cycleSize,
  hiddenAvailableWidgets,
  loadLayoutFromStorage,
  normalizeLayout,
  patchLayoutItem,
  reorderLayout,
  resetLayout,
  saveLayoutToStorage
} from '../../utils/dashboardLayout.js';
import '../../styles/dashboardGrid.css';

export default function DashboardGrid({
  sharedCtx,
  editMode: editModeProp,
  onEditModeChange,
  showToolbar = true,
  resetNonce = 0
}) {
  const [layout, setLayout] = useState(() => loadLayoutFromStorage(WIDGET_REGISTRY));
  const [editModeInternal, setEditModeInternal] = useState(false);
  const editMode = editModeProp ?? editModeInternal;
  const setEditMode = onEditModeChange ?? setEditModeInternal;
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const prevEditModeRef = useRef(editMode);

  useEffect(() => {
    setLayout(loadLayoutFromStorage(WIDGET_REGISTRY));
  }, []);

  const visibleItems = useMemo(() => layout.filter((item) => item.visible), [layout]);
  const hiddenWidgets = useMemo(() => hiddenAvailableWidgets(layout, WIDGET_REGISTRY), [layout]);

  const persistLayout = useCallback((next) => {
    const normalized = normalizeLayout(next, WIDGET_REGISTRY);
    setLayout(normalized);
    saveLayoutToStorage(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    if (resetNonce > 0) {
      persistLayout(resetLayout(WIDGET_REGISTRY));
    }
  }, [resetNonce, persistLayout]);

  useEffect(() => {
    if (prevEditModeRef.current && !editMode) {
      persistLayout(layout);
    }
    prevEditModeRef.current = editMode;
  }, [editMode, layout, persistLayout]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setDragId(null);
    setDropTargetId(null);
    persistLayout(layout);
  }, [layout, persistLayout]);

  const handleReset = useCallback(() => {
    const next = resetLayout(WIDGET_REGISTRY);
    persistLayout(next);
  }, [persistLayout]);

  const handleHide = useCallback((id) => {
    setLayout((prev) => patchLayoutItem(prev, id, { visible: false }));
  }, []);

  const handleShow = useCallback((id) => {
    setLayout((prev) => {
      const exists = prev.find((i) => i.id === id);
      if (exists) {
        return patchLayoutItem(prev, id, { visible: true });
      }
      const def = WIDGET_BY_ID[id];
      return [...prev, {
        id,
        size: def?.defaultSize === 'sm' || def?.defaultSize === 'lg' ? def.defaultSize : 'md',
        visible: true,
        ...(id === 'report-snapshot' ? { config: { dimension: 'day-of-week' } } : {})
      }];
    });
  }, []);

  const handleCycleSize = useCallback((id) => {
    setLayout((prev) => {
      const item = prev.find((i) => i.id === id);
      if (!item) return prev;
      return patchLayoutItem(prev, id, { size: cycleSize(item.size) });
    });
  }, []);

  const handleConfigChange = useCallback((id, configPatch) => {
    setLayout((prev) => patchLayoutItem(prev, id, { config: configPatch }));
  }, []);

  const finishDrag = useCallback((sourceId, targetId) => {
    if (!sourceId || sourceId === targetId) return;
    setLayout((prev) => {
      const targetIndex = targetId ? prev.findIndex((i) => i.id === targetId) : prev.length;
      return reorderLayout(prev, sourceId, targetIndex >= 0 ? targetIndex : prev.length);
    });
  }, []);

  return (
    <div className={`dashboard-grid-shell ${editMode ? 'dashboard-grid-shell--edit' : ''}`}>
      {showToolbar && (
        <div className="dashboard-grid-toolbar">
          <span className="dashboard-grid-toolbar-label">Widgets</span>
          <div className="dashboard-grid-toolbar-actions">
            {editMode ? (
              <div className="dashboard-grid-edit-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={handleReset} title="Restore default widget layout">
                  <RotateCcw size={14} />
                  Reset layout
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={exitEditMode}>
                  Done
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm dashboard-grid-customize-btn"
                onClick={() => setEditMode(true)}
                title="Customize dashboard widgets"
              >
                <Settings2 size={14} />
                Customize
              </button>
            )}
          </div>
        </div>
      )}

      {editMode && hiddenWidgets.length > 0 && (
        <div className="dashboard-grid-add-tray">
          <div className="dashboard-grid-add-tray-title">
            <Plus size={14} />
            Add widget
          </div>
          <div className="dashboard-grid-add-tray-list">
            {hiddenWidgets.map((w) => (
              <button
                key={w.id}
                type="button"
                className="dashboard-grid-add-chip"
                onClick={() => handleShow(w.id)}
                title={w.description}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        {visibleItems.map((item) => {
          const def = WIDGET_BY_ID[item.id];
          if (!def?.Component) return null;
          const { Component } = def;
          const isDragging = dragId === item.id;
          const isDropTarget = dropTargetId === item.id;

          return (
            <div
              key={item.id}
              className={[
                'dashboard-grid-item',
                `dashboard-grid-item--${item.size}`,
                editMode ? 'dashboard-grid-item--editable' : '',
                isDragging ? 'dashboard-grid-item--dragging' : '',
                isDropTarget ? 'dashboard-grid-item--drop-target' : ''
              ].filter(Boolean).join(' ')}
              data-widget-id={item.id}
              onDragOver={(e) => {
                if (!editMode || !dragId) return;
                e.preventDefault();
                setDropTargetId(item.id);
              }}
              onDragLeave={() => {
                if (dropTargetId === item.id) setDropTargetId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                finishDrag(dragId, item.id);
                setDragId(null);
                setDropTargetId(null);
              }}
            >
              {editMode && (
                <div className="dashboard-grid-item-chrome">
                  <span
                    className="dashboard-grid-drag-handle"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.id);
                      setDragId(item.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTargetId(null);
                    }}
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </span>
                  <span className="dashboard-grid-item-label">{def.label}</span>
                  <div className="dashboard-grid-item-controls">
                    <button
                      type="button"
                      className="dashboard-grid-icon-btn"
                      onClick={() => handleCycleSize(item.id)}
                      title={`Size: ${item.size} (click to cycle)`}
                    >
                      <Maximize2 size={13} />
                      <span>{item.size.toUpperCase()}</span>
                    </button>
                    <button
                      type="button"
                      className="dashboard-grid-icon-btn"
                      onClick={() => handleHide(item.id)}
                      title="Hide widget"
                    >
                      <EyeOff size={13} />
                    </button>
                  </div>
                </div>
              )}
              <div className="dashboard-grid-item-body">
                <Component
                  sharedCtx={sharedCtx}
                  layoutItem={item}
                  editMode={editMode}
                  onConfigChange={(patch) => handleConfigChange(item.id, patch)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {visibleItems.length === 0 && (
        <div className="dashboard-grid-empty">
          No widgets visible. Enter customize mode and add widgets from the tray.
          {!editMode && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditMode(true)} style={{ marginTop: 8 }}>
              Customize dashboard
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { WIDGET_REGISTRY };
