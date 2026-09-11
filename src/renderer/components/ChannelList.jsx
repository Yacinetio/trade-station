import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Unplug, ChevronDown, ChevronUp } from 'lucide-react';

const ICONS = ['📢', '📡', '💹', '🔔', '📊', '⚡', '🎯', '💰'];
const LOAD_TIMEOUT_MS = 25000;
const STUCK_AFTER_MS = 10000;

function formatDiagError(msg) {
  const m = String(msg || '');
  if (m.includes('TELEGRAM_CONNECT_TIMEOUT')) return 'Telegram connection timed out — try Reconnect.';
  if (m.includes('TELEGRAM_DIALOGS_TIMEOUT')) return 'Fetching channel list timed out — try Refresh or Reconnect.';
  if (m.includes('AUTH_KEY')) return 'Session invalid — disconnect and sign in again.';
  return m || 'Unknown error';
}

function ChannelCard({ ch, index, isEnabled, onToggle }) {
  return (
    <div className={`channel-card ${isEnabled ? 'active' : ''}`}>
      <div className="channel-top">
        <div className={`channel-icon ${isEnabled ? 'active-ch' : ''}`}>
          {ICONS[index % ICONS.length]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="channel-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {ch.name}
          </div>
          {ch.username && (
            <div className="channel-username">@{ch.username}</div>
          )}
        </div>
      </div>
      <button
        className={`btn-enable ${isEnabled ? 'enabled' : ''}`}
        onClick={() => onToggle(ch.id, !isEnabled)}
      >
        {isEnabled ? '✓ Copying Active' : 'Enable Copy'}
      </button>
    </div>
  );
}

function ChannelSection({ title, channels, allChannels, enabledChannels, onToggle, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="channel-section">
      <button className="channel-section-header" onClick={() => setOpen(v => !v)}>
        <span className="channel-section-icon">{open ? '▾' : '▸'}</span>
        <span className="channel-section-title">{title}</span>
        <span className="channel-section-count">{channels.length}</span>
      </button>
      {open && (
        <div className="channel-section-body">
          {channels.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--text3)', fontSize: 12, fontStyle: 'italic' }}>
              No channels here
            </div>
          )}
          {channels.map((ch) => {
            const globalIndex = allChannels.findIndex(c => c.id === ch.id);
            return (
              <ChannelCard
                key={ch.id}
                ch={ch}
                index={globalIndex >= 0 ? globalIndex : 0}
                isEnabled={enabledChannels.includes(ch.id)}
                onToggle={onToggle}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChannelsLoadTrouble({
  loading,
  stuck,
  loadError,
  diagOpen,
  diagInfo,
  onRetry,
  onReconnect,
  onToggleDiag,
  onRunDiag
}) {
  const busy = loading;
  return (
    <div className="channels-load-trouble" data-testid="channels-load-trouble">
      <div className="channels-load-trouble-title">
        {stuck && loading ? 'Still loading channels…' : 'Could not load channels'}
      </div>
      <p className="channels-load-trouble-hint">
        {stuck && loading
          ? 'Telegram may be slow or the connection is stuck. Try Refresh, or Reconnect to reset the session.'
          : formatDiagError(loadError)}
      </p>
      <div className="channels-load-trouble-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={onRetry}
          data-testid="channels-refresh-btn"
        >
          <RefreshCw size={14} style={{ marginRight: 6 }} />
          {busy ? 'Loading…' : 'Refresh channels'}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={onReconnect}
          data-testid="channels-reconnect-btn"
        >
          <Unplug size={14} style={{ marginRight: 6 }} />
          Reconnect Telegram
        </button>
      </div>
      <button
        type="button"
        className="channels-load-diag-toggle"
        onClick={onToggleDiag}
        data-testid="channels-diag-toggle"
      >
        {diagOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {diagOpen ? 'Hide diagnostics' : 'Why is this happening?'}
      </button>
      {diagOpen && (
        <div className="channels-load-diag-panel">
          {!diagInfo?.checked && !diagInfo?.checking && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onRunDiag}>
              Run diagnostics
            </button>
          )}
          {diagInfo?.checking && (
            <div className="channels-load-diag-line">Checking session and channel API…</div>
          )}
          {diagInfo?.checked && (
            <pre className="channels-load-diag-pre">{JSON.stringify(diagInfo, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChannelList({ enabledChannels, onToggle, collapsed = false, onToggleCollapse, showCollapseControl = true }) {
  const [channels, setChannels] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagInfo, setDiagInfo] = useState(null);
  const loadSeqRef = useRef(0);
  const stuckTimerRef = useRef(null);

  const loadChannels = useCallback(async ({ forceReconnect = false } = {}) => {
    const seq = ++loadSeqRef.current;
    if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    setLoading(true);
    setStuck(false);
    setLoadError(null);
    stuckTimerRef.current = setTimeout(() => {
      if (seq === loadSeqRef.current) setStuck(true);
    }, STUCK_AFTER_MS);

    try {
      const res = await Promise.race([
        window.electronAPI?.getChannels?.({ forceReconnect }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('TELEGRAM_UI_TIMEOUT')), LOAD_TIMEOUT_MS);
        })
      ]);
      if (seq !== loadSeqRef.current) return;
      if (res?.success && Array.isArray(res.channels)) {
        setChannels(res.channels);
        setLoadError(null);
      } else {
        setLoadError(res?.error || 'CHANNELS_LOAD_FAILED');
      }
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(e?.message || 'CHANNELS_LOAD_FAILED');
    } finally {
      if (stuckTimerRef.current) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setStuck(false);
      }
    }
  }, []);

  const handleReconnect = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const recon = await window.electronAPI?.reconnectTelegram?.();
      if (!recon?.success) {
        setLoadError(recon?.error || 'RECONNECT_FAILED');
        setLoading(false);
        return;
      }
      await loadChannels({ forceReconnect: true });
    } catch (e) {
      setLoadError(e?.message || 'RECONNECT_FAILED');
      setLoading(false);
    }
  }, [loadChannels]);

  const runDiagnostics = useCallback(async () => {
    setDiagInfo({ checking: true });
    try {
      const session = await window.electronAPI?.checkSession?.();
      const channelProbe = await Promise.race([
        window.electronAPI?.getChannels?.({ forceReconnect: false, timeoutMs: 15000 }),
        new Promise((resolve) => setTimeout(() => resolve({ success: false, error: 'PROBE_TIMEOUT' }), 16000))
      ]);
      setDiagInfo({
        checked: true,
        at: new Date().toISOString(),
        session: session
          ? { authenticated: !!session.authenticated, error: session.error || null, user: session.user || null }
          : { error: 'checkSession unavailable' },
        getChannels: channelProbe
          ? {
            success: !!channelProbe.success,
            count: Array.isArray(channelProbe.channels) ? channelProbe.channels.length : 0,
            error: channelProbe.error || null
          }
          : { error: 'getChannels unavailable' }
      });
    } catch (e) {
      setDiagInfo({ checked: true, at: new Date().toISOString(), error: e?.message || 'DIAG_FAILED' });
    }
  }, []);

  useEffect(() => {
    loadChannels();
    return () => {
      loadSeqRef.current += 1;
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    };
  }, [loadChannels]);

  const filtered = channels.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.username || '').toLowerCase().includes(search.toLowerCase())
  );

  const activeChannels = filtered.filter(c => enabledChannels.includes(c.id));
  const otherChannels = filtered.filter(c => !enabledChannels.includes(c.id));
  const showTrouble = (loading && (stuck || channels.length === 0)) || (!loading && loadError && channels.length === 0);

  return (
    <div className={`left-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="panel-header">
        <div className="channels-header-row">
          {!collapsed && <span className="channels-title">Telegram Channels</span>}
          {showCollapseControl && (
            <button
              className="collapse-btn"
              onClick={onToggleCollapse}
              title={collapsed ? 'Expand channels panel' : 'Collapse channels panel'}
            >
              {collapsed ? '▶' : '◀'}
            </button>
          )}
        </div>
        {!collapsed && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <span style={{ color: 'var(--text3)', fontSize: 14 }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search channels..."
            />
          </div>
          <button
            className="refresh-btn"
            onClick={() => loadChannels()}
            disabled={loading}
            title="Refresh channels"
            data-testid="channels-header-refresh"
          >
            {loading ? '⏳' : '🔄'}
          </button>
        </div>
        )}
      </div>

      {!collapsed && <div className="channels-list">
        {showTrouble && (
          <ChannelsLoadTrouble
            loading={loading}
            stuck={stuck}
            loadError={loadError}
            diagOpen={diagOpen}
            diagInfo={diagInfo}
            onRetry={() => loadChannels()}
            onReconnect={handleReconnect}
            onToggleDiag={() => setDiagOpen(v => !v)}
            onRunDiag={runDiagnostics}
          />
        )}
        {loading && !showTrouble && channels.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            Loading channels...
          </div>
        )}
        {!loading && filtered.length === 0 && !showTrouble && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            No channels found. Make sure you&apos;re in some Telegram channels.
          </div>
        )}
        {filtered.length > 0 && (
          <>
            {loadError && (
              <div className="channels-load-warn" role="status">
                Last refresh failed: {formatDiagError(loadError)}
              </div>
            )}
            <ChannelSection
              title="Copying Active"
              channels={activeChannels}
              allChannels={channels}
              enabledChannels={enabledChannels}
              onToggle={onToggle}
              defaultOpen={true}
            />
            <ChannelSection
              title="Other Channels"
              channels={otherChannels}
              allChannels={channels}
              enabledChannels={enabledChannels}
              onToggle={onToggle}
              defaultOpen={false}
            />
          </>
        )}
      </div>}
    </div>
  );
}
