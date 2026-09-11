import React, { useEffect, useMemo, useState } from 'react';
import { Radio, FileText, Send, X } from 'lucide-react';
import ChannelList from '../components/ChannelList.jsx';
import AccountScopePicker from '../components/AccountScopePicker.jsx';

export default function TelegramPage({
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  telegramAuthenticated,
  user,
  onRequestTelegramConnect,
  onTelegramDisconnect
}) {
  const [enabledChannels, setEnabledChannels] = useState([]);
  const [tgConnected, setTgConnected] = useState(!!telegramAuthenticated);
  const [loadingEnabled, setLoadingEnabled] = useState(true);
  const [testState, setTestState] = useState('idle');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSending, setReportSending] = useState(false);
  const [allChannels, setAllChannels] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [sendStatus, setSendStatus] = useState(null);
  const [reportChannelId, setReportChannelId] = useState('me');
  const [autoReportAfterEod, setAutoReportAfterEod] = useState(false);
  const [reportAfterEodMinutes, setReportAfterEodMinutes] = useState(5);
  const [autoWeeklyReport, setAutoWeeklyReport] = useState(true);
  const [autoMonthlyReport, setAutoMonthlyReport] = useState(true);
  const [reportSettings, setReportSettings] = useState({
    includePnl: true,
    includeWinRate: true,
    includeDrawdown: true,
    includeOpenCount: true,
    includeTrades: true,
    includeTopPerformers: true,
    includeOutcomes: true,
  });

  const persistReportContentSettings = async (patch) => {
    const next = { ...reportSettings, ...patch };
    setReportSettings(next);
    try {
      await window.electronAPI?.saveReportSettings?.(next);
    } catch (_) {
      /* ignore */
    }
  };

  const saveReportSettingsBeforeSend = async () => {
    try {
      await window.electronAPI?.saveReportSettings?.(reportSettings);
    } catch (_) {
      /* ignore */
    }
  };

  useEffect(() => {
    setTgConnected(!!telegramAuthenticated);
  }, [telegramAuthenticated]);

  useEffect(() => {
    let active = true;
    setLoadingEnabled(true);
    window.electronAPI?.getEnabledChannels?.().then((channels) => {
      if (!active) return;
      setEnabledChannels(Array.isArray(channels) ? channels : []);
    }).finally(() => {
      if (active) setLoadingEnabled(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI?.onConnectionStatus?.((status) => {
      if (status?.telegram !== undefined) setTgConnected(!!status.telegram);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  useEffect(() => {
    if (!telegramAuthenticated) {
      setAllChannels([]);
      return;
    }
    setLoadingChannels(true);
    window.electronAPI?.getChannels?.().then((res) => {
      if (res?.success && Array.isArray(res.channels)) {
        setAllChannels(res.channels);
      }
    }).finally(() => setLoadingChannels(false));
  }, [telegramAuthenticated]);

  useEffect(() => {
    if (!reportModalOpen) return;
    let active = true;
    (async () => {
      try {
        const [targetRes, settings, contentSettings] = await Promise.all([
          window.electronAPI?.getDailyReportTarget?.(),
          window.electronAPI?.getSettings?.(),
          window.electronAPI?.getReportSettings?.()
        ]);
        if (!active) return;
        if (targetRes?.target) setReportChannelId(String(targetRes.target));
        if (contentSettings && typeof contentSettings === 'object') {
          setReportSettings((prev) => ({ ...prev, ...contentSettings }));
        }
        if (settings) {
          setAutoReportAfterEod(!!settings.dailyReportAutoAfterEod);
          setReportAfterEodMinutes(Math.max(1, Math.min(120, Number(settings.dailyReportAfterEodMinutes) || 5)));
          setAutoWeeklyReport(settings.weeklyReportAutoEndOfWeek !== false);
          setAutoMonthlyReport(settings.monthlyReportAutoEndOfMonth !== false);
        }
      } catch (_) {
        /* ignore */
      }
    })();
    return () => { active = false; };
  }, [reportModalOpen]);

  const persistReportSchedule = async (patch) => {
    try {
      const cur = await window.electronAPI?.getSettings?.();
      if (!cur) return;
      await window.electronAPI?.saveSettings?.({ ...cur, ...patch });
    } catch (_) {
      /* ignore */
    }
  };

  const statusText = useMemo(
    () => (telegramAuthenticated && tgConnected ? 'Connected' : 'Disconnected'),
    [telegramAuthenticated, tgConnected]
  );

  return (
    <div className="dashboard-shell telegram-shell" data-testid="page-telegram">
      <div className="titlebar">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon"><Radio size={16} /></span>
          <span className="brand-name">Telegram</span>
          <span className="subtitle">Connection and channel management</span>
        </div>
        <div className="titlebar-actions">
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
        </div>
      </div>

      <div className="telegram-page-wrap" data-onboarding="telegram-workspace">
        <div className="telegram-page-intro">
          <div className="telegram-intro-title">Signal Source Control</div>
          <div className="telegram-intro-subtitle">
            Connect Telegram and choose which channels are allowed to feed trades into Trade Station.
          </div>
          <div className="telegram-summary-row">
            <div className="telegram-summary-card">
              <div className="telegram-summary-label">Session</div>
              <div className="telegram-summary-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`connection-dot ${telegramAuthenticated && tgConnected ? 'connection-dot--live' : 'connection-dot--disconnected'}`}></span>
                {statusText}
              </div>
            </div>
            <div className="telegram-summary-card">
              <div className="telegram-summary-label">Active channels</div>
              <div className="telegram-summary-value">{enabledChannels.length}</div>
            </div>
            <div className="telegram-summary-card">
              <div className="telegram-summary-label">Account</div>
              <div className="telegram-summary-value">{user?.phone || user?.username || 'Not connected'}</div>
            </div>
          </div>
          <div className="telegram-actions-row">
            <button
              className={`btn ${telegramAuthenticated ? 'btn-outline' : 'btn-primary'} ${testState !== 'idle' ? 'test-btn--' + testState : ''}`}
              onClick={() => {
                if (telegramAuthenticated) {
                  onTelegramDisconnect?.();
                  return;
                }
                setTestState('testing');
                onRequestTelegramConnect?.();
                // Auth is popup-based — status updates arrive via onConnectionStatus.
                // Clear testing state after 6s if no callback fired (e.g. user closed popup).
                setTimeout(() => setTestState(prev => prev === 'testing' ? 'error' : prev), 6000);
              }}
            >
              {testState === 'testing' ? (
                <span>Testing<span className="animate-spin" style={{ marginLeft: 6 }}>⟳</span></span>
              ) : testState === 'success' ? (
                <span>✓ Connected</span>
              ) : testState === 'error' ? (
                <span>✗ Failed</span>
              ) : (
                telegramAuthenticated ? 'Disconnect Telegram' : 'Connect Telegram'
              )}
            </button>
            {telegramAuthenticated && (
              <button
                className="btn btn-outline"
                onClick={() => setReportModalOpen(true)}
                style={{ marginLeft: 8 }}
              >
                <FileText size={14} style={{ marginRight: 6 }} />
                Performance reports
              </button>
            )}
          </div>
        </div>

        {telegramAuthenticated ? (
          <div className="telegram-page-channels">
            {loadingEnabled ? (
              <div className="empty-state">Loading channel preferences...</div>
            ) : (
              <div className="animate-enter" style={{ animationDelay: '60ms' }}>
                <ChannelList
                  enabledChannels={enabledChannels}
                  showCollapseControl={false}
                  onToggle={(id, enabled) => {
                    window.electronAPI?.enableChannel?.(id, enabled);
                    setEnabledChannels(prev => enabled ? [...prev, id] : prev.filter(c => c !== id));
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            Connect Telegram to load channels and enable copy for selected sources.
          </div>
        )}

        {reportModalOpen && (
          <div className="modal-overlay" onClick={() => setReportModalOpen(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Telegram performance reports</h3>
                <button className="modal-close" onClick={() => setReportModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="modal-body">
                <p style={{ color: 'var(--text2)', marginBottom: 16 }}>
                  Daily, weekly (Sunday), and monthly rollups use trades opened in each period. Same send target and
                  end-of-day clock + delay as Settings → End of day close (local PC time).
                </p>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Send to
                  </label>
                  <select
                    value={reportChannelId}
                    onChange={async (e) => {
                      const v = e.target.value;
                      setReportChannelId(v);
                      try {
                        await window.electronAPI?.setDailyReportTarget?.(v);
                      } catch (_) {
                        /* ignore */
                      }
                    }}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: 13,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 8, color: 'var(--text)', outline: 'none'
                    }}
                  >
                    <option value="me">My Telegram (self)</option>
                    {allChannels.map(ch => (
                      <option key={ch.id} value={ch.id}>{ch.name || ch.username || ch.id}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={autoReportAfterEod}
                      onChange={async (e) => {
                        const on = e.target.checked;
                        setAutoReportAfterEod(on);
                        await persistReportSchedule({ dailyReportAutoAfterEod: on });
                      }}
                    />
                    <span>Auto-send after end-of-day time</span>
                  </label>
                  <p style={{ fontSize: 12, color: 'var(--text3)', margin: '10px 0 0', lineHeight: 1.45 }}>
                    Sends <strong>daily</strong> at your Settings <strong>End of day close</strong> clock on this PC&apos;s local time,
                    plus the delay below. Weekly: same clock on <strong>Sunday</strong> (Mon–Sun week). Monthly: same clock on the{' '}
                    <strong>last calendar day</strong> of each month. Requires Telegram connected.
                    {' '}
                    <strong>Trade Station must stay running</strong> (not fully quit) at that moment — there is no catch-up if the PC was off or asleep.
                    After a failed send, check <strong>Logs</strong> for &quot;Daily/Weekly/Monthly Telegram report&quot;.
                    Reports count trades <strong>closed</strong> in the period (not opened), with TP, SL, BE, and other outcomes listed separately.
                  </p>
                  {autoReportAfterEod && (
                    <div style={{ marginTop: 12 }}>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Minutes after EOD time</label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={reportAfterEodMinutes}
                        onChange={(e) => setReportAfterEodMinutes(Math.max(1, Math.min(120, Number.parseInt(e.target.value, 10) || 5)))}
                        onBlur={async () => {
                          const m = Math.max(1, Math.min(120, Number(reportAfterEodMinutes) || 5));
                          setReportAfterEodMinutes(m);
                          await persistReportSchedule({ dailyReportAfterEodMinutes: m });
                        }}
                        style={{
                          width: 120,
                          padding: '8px 10px',
                          fontSize: 13,
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          color: 'var(--text)',
                          outline: 'none'
                        }}
                      />
                    </div>
                  )}
                </div>
                <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={autoWeeklyReport}
                      onChange={async (e) => {
                        const on = e.target.checked;
                        setAutoWeeklyReport(on);
                        await persistReportSchedule({ weeklyReportAutoEndOfWeek: on });
                      }}
                    />
                    <span>Auto-send weekly report (Sunday, same EOD + delay)</span>
                  </label>
                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginTop: 10 }}>
                    <input
                      type="checkbox"
                      checked={autoMonthlyReport}
                      onChange={async (e) => {
                        const on = e.target.checked;
                        setAutoMonthlyReport(on);
                        await persistReportSchedule({ monthlyReportAutoEndOfMonth: on });
                      }}
                    />
                    <span>Auto-send monthly report (last day of month)</span>
                  </label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    ['includeOutcomes', 'Include TP / SL / BE / other breakdown'],
                    ['includePnl', 'Include P&L summary'],
                    ['includeWinRate', 'Include win rate'],
                    ['includeDrawdown', 'Include drawdown'],
                    ['includeOpenCount', 'Include open positions count'],
                    ['includeTrades', 'Include trade count'],
                    ['includeTopPerformers', 'Include top performers/losers'],
                  ].map(([key, label]) => (
                    <label key={key} className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!reportSettings[key]}
                        onChange={(e) => persistReportContentSettings({ [key]: e.target.checked })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 20 }}>
                  {sendStatus && (
                    <div style={{
                      padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                      background: sendStatus.success ? 'var(--success)' : 'var(--danger)',
                      color: '#fff', fontSize: 13, fontWeight: 600
                    }}>
                      {sendStatus.success ? 'Report sent successfully!' : 'Error: ' + sendStatus.error}
                    </div>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      setSendStatus(null);
                      setReportSending(true);
                      try {
                        await saveReportSettingsBeforeSend();
                        const result = await window.electronAPI?.sendDailyReport?.(reportChannelId);
                        setSendStatus(result || { error: 'Unknown error' });
                      } catch (e) {
                        setSendStatus({ error: e.message });
                      } finally {
                        setReportSending(false);
                      }
                    }}
                    disabled={reportSending}
                    style={{ width: '100%' }}
                  >
                    <Send size={14} style={{ marginRight: 6 }} />
                    {reportSending ? 'Sending...' : 'Send daily now'}
                  </button>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ flex: 1 }}
                      disabled={reportSending}
                      onClick={async () => {
                        setSendStatus(null);
                        setReportSending(true);
                        try {
                          await saveReportSettingsBeforeSend();
                          const result = await window.electronAPI?.sendWeeklyReport?.(reportChannelId);
                          setSendStatus(result || { error: 'Unknown error' });
                        } catch (e) {
                          setSendStatus({ error: e.message });
                        } finally {
                          setReportSending(false);
                        }
                      }}
                    >
                      Send weekly now
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ flex: 1 }}
                      disabled={reportSending}
                      onClick={async () => {
                        setSendStatus(null);
                        setReportSending(true);
                        try {
                          await saveReportSettingsBeforeSend();
                          const result = await window.electronAPI?.sendMonthlyReport?.(reportChannelId);
                          setSendStatus(result || { error: 'Unknown error' });
                        } catch (e) {
                          setSendStatus({ error: e.message });
                        } finally {
                          setReportSending(false);
                        }
                      }}
                    >
                      Send monthly now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
