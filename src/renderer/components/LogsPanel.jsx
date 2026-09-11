import React, { useState, useEffect, useRef, useCallback } from 'react';

const LEVEL_LABEL = {
  info: 'INFO',
  success: 'OK',
  warn: 'WARN',
  error: 'ERR',
};

function fmt(iso) {
  try {
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return '';
  }
}

export default function LogsPanel() {
  const [logs, setLogs] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    window.electronAPI?.getLogs().then((l) => setLogs(l || []));
    const unsub = window.electronAPI?.onLogEvent((entry) => {
      setLogs((prev) => [entry, ...prev.slice(0, 499)]);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [logs, autoScroll]);

  const handleClear = useCallback(async () => {
    await window.electronAPI?.clearLogs();
    setLogs([]);
  }, []);

  const filtered = filter === 'ALL' ? logs : logs.filter((l) => l.level === filter.toLowerCase());

  return (
    <div className="logs-panel" data-onboarding="activity-logs">
      <div className="logs-header">
        <div className="logs-title" onClick={() => setCollapsed((c) => !c)}>
          <span className="logs-title-icon">{collapsed ? '▶' : '▼'}</span>
          <span>Activity Logs</span>
          <span className="logs-count">{logs.length}</span>
        </div>
        {!collapsed && (
          <div className="logs-controls">
            {['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map((f) => (
              <button
                key={f}
                type="button"
                className={`log-filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
            <button
              type="button"
              className={`log-filter-btn ${autoScroll ? 'active' : ''}`}
              onClick={() => setAutoScroll((a) => !a)}
              title="Auto-scroll"
            >
              ↑ AUTO
            </button>
            <button type="button" className="log-filter-btn log-clear-btn" onClick={handleClear}>
              🗑 Clear
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="logs-list" ref={listRef}>
          {filtered.length === 0 && <div className="logs-empty">No logs yet…</div>}
          {filtered.map((entry) => {
            const lv = entry.level || 'info';
            return (
              <div key={entry.id} className={`log-row log-row-${lv}`}>
                <span className="log-time">{fmt(entry.time)}</span>
                <span className={`log-level-chip ${lv}`}>{LEVEL_LABEL[lv] || 'LOG'}</span>
                <span className="log-msg">{entry.message}</span>
                {entry.detail && <span className="log-detail">{entry.detail}</span>}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
