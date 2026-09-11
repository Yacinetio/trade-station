import React, { useEffect, useMemo, useState } from 'react';
import { Toggle } from './SettingsFields.jsx';

export default function NotifsTab({ s, set, setNested }) {
  const notifs = s.notifications || {};
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const rows = await window.electronAPI?.getNotificationHistory?.();
      setHistory(Array.isArray(rows) ? rows : []);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
    const handler = (entry) => setHistory((prev) => [entry, ...prev].slice(0, 500));
    const unsub = window.electronAPI?.onNewNotificationEvent?.(handler);
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((item) => {
      if (typeFilter !== 'ALL' && String(item?.type || 'GENERAL') !== typeFilter) return false;
      if (!q) return true;
      const title = String(item?.title || '').toLowerCase();
      const body = String(item?.body || '').toLowerCase();
      return title.includes(q) || body.includes(q);
    });
  }, [history, search, typeFilter]);

  const unreadIds = filteredHistory.filter((n) => !n?.read).map((n) => n.id);

  return (
    <>
      <div className="settings-section">
        <h3>🔔 Notification Settings</h3>
        <p>Choose which events trigger desktop notifications</p>
        <div className="form-row">
          <div className="form-group">
            <label>News alert lead time</label>
            <div className="number-input-wrap">
              <input
                type="number"
                value={s.highImpactNewsAlertBefore ?? s.highImpactNewsAlertBeforeMinutes ?? 45}
                min={1}
                onChange={(e) => set('highImpactNewsAlertBefore', parseInt(e.target.value) || 1)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Lead time unit</label>
            <select
              className="select-field"
              value={s.highImpactNewsAlertUnit || 'MINUTES'}
              onChange={(e) => set('highImpactNewsAlertUnit', e.target.value)}
            >
              <option value="MINUTES">Minutes</option>
              <option value="HOURS">Hours</option>
            </select>
          </div>
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>
          You can set alerts in minutes or hours before high-impact news.
        </div>
        <div className="toggle-row">
          <span className="toggle-label">Repeat pre-news alerts until release</span>
          <Toggle checked={s.highImpactNewsRepeatAlertsEnabled === true} onChange={(v) => set('highImpactNewsRepeatAlertsEnabled', v)} />
        </div>
        {s.highImpactNewsRepeatAlertsEnabled === true && (
          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Repeat interval (minutes)</label>
            <div className="number-input-wrap">
              <input
                type="number"
                value={s.highImpactNewsRepeatIntervalMinutes ?? 10}
                min={1}
                max={120}
                onChange={(e) => set('highImpactNewsRepeatIntervalMinutes', parseInt(e.target.value) || 10)}
              />
              <span className="number-input-unit">min</span>
            </div>
            <div className="hint">Default is disabled to avoid repeated popups.</div>
          </div>
        )}
        {[
          {key:'newSignal',label:'New signal detected'},
          {key:'tradeOpened',label:'Trade opened on MT5'},
          {key:'tradeClosed',label:'Trade closed on MT5'},
          {key:'mtDisconnect',label:'MT5 disconnected'},
          {key:'telegramDisconnect',label:'Telegram disconnected'},
          {key:'dailyReport',label:'Daily performance report'},
          {key:'drawdown',label:'Drawdown alert'},
          {key:'dailyLossLimit',label:'Daily loss limit reached'},
          {key:'highImpactNews',label:'High-impact news approaching'},
          {key:'signalBlockedByNews',label:'Trade blocked by high-impact news guard'},
          {key:'signalBlockedBySignalFilters',label:'Trade blocked by advanced signal filters (Settings → Filters)'},
          {key:'signalBlockedByGuard',label:'Trade blocked by execution guard (limits / hedge rules)'},
        ].map(n=>(
          <div key={n.key} className="toggle-row">
            <span className="toggle-label">{n.label}</span>
            <Toggle checked={notifs[n.key]!==false} onChange={v=>setNested('notifications',n.key,v)} />
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h3>🧾 Notification History</h3>
        <p>Review all desktop alerts, including high-impact news pre-alerts and release results.</p>
        <div className="form-row">
          <div className="form-group">
            <label>Search</label>
            <input className="select-field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or body..." />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select className="select-field" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="ALL">All</option>
              <option value="NEWS_ALERT">News alerts</option>
              <option value="NEWS_RELEASE">News release</option>
              <option value="NEWS_BLOCKED">News blocked trades</option>
              <option value="SIGNAL">Signals</option>
              <option value="GENERAL">General</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button type="button" className="btn btn-outline" onClick={loadHistory} disabled={loadingHistory}>
            {loadingHistory ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={async () => {
              if (unreadIds.length === 0) return;
              await window.electronAPI?.markNotificationsRead?.(unreadIds, true);
              setHistory((prev) => prev.map((item) => unreadIds.includes(item.id) ? { ...item, read: true } : item));
            }}
            disabled={unreadIds.length === 0}
          >
            Mark filtered as read
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={async () => {
              await window.electronAPI?.clearNotificationHistory?.();
              setHistory([]);
            }}
          >
            Clear all
          </button>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
          {filteredHistory.length === 0 && <div className="fund-empty-inline">No notifications found.</div>}
          {filteredHistory.map((item) => (
            <div key={item.id} style={{ padding: '8px 6px', borderBottom: '1px solid color-mix(in srgb, var(--border) 65%, transparent)', opacity: item.read ? 0.75 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 12 }}>{item.title}</strong>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(item.time).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{item.body}</div>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text3)' }}>{item.type}{item.read ? ' • read' : ' • unread'}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
