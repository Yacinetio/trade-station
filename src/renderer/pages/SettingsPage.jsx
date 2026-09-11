import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import SettingsModal from '../components/SettingsModal.jsx';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import { useToast, ToastContainer } from '../hooks/useToast.jsx';

export default function SettingsPage({
  licenseStatus = null,
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  onReplayOnboarding
}) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const { toasts, push: pushToast } = useToast();

  useEffect(() => {
    let active = true;
    const loadSettings = () => {
      window.electronAPI?.getSettings?.().then((data) => {
        if (!active) return;
        setSettings(data || null);
      }).catch(() => {
        if (!active) return;
        setSettings(null);
      });
    };
    loadSettings();
    const unsubs = [];
    const sub = (maybeUnsub) => {
      if (typeof maybeUnsub === 'function') unsubs.push(maybeUnsub);
    };
    sub(window.electronAPI?.onSettingsUpdated?.(() => loadSettings()));
    sub(window.electronAPI?.onDataRestored?.(() => loadSettings()));
    return () => {
      active = false;
      for (const u of unsubs) {
        try { u(); } catch (_) { /* noop */ }
      }
    };
  }, []);

  const handleSave = async (nextSettings) => {
    setSaving(true);
    try {
      const res = await window.electronAPI?.saveSettings?.(nextSettings);
      setSettings(res?.settings || nextSettings);
      pushToast('Your settings were saved.', 'success');
    } catch (err) {
      console.error(err);
      pushToast(err?.message || 'Could not save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dashboard-shell settings-shell" data-testid="page-settings">
      <div className="titlebar">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon"><SettingsIcon size={18} aria-hidden="true" /></span>
          <span className="brand-name">Settings</span>
          <span className="subtitle">Global app, risk, and execution behavior</span>
        </div>
        <div className="titlebar-actions">
          {typeof onReplayOnboarding === 'function' && (
            <button
              type="button"
              className="btn btn-outline btn-titlebar"
              onClick={() => onReplayOnboarding()}
            >
              Replay product tour
            </button>
          )}
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
          {saving && <div className="subtitle">Saving...</div>}
        </div>
      </div>
      <div className="settings-page-wrap" data-onboarding="settings-page">
        <div className="settings-page-intro">
          <div className="settings-page-kicker">Trusted by serious signal traders</div>
          <div className="settings-page-intro-title">Trade Smarter, Not Harder</div>
          <div className="settings-page-intro-subtitle">
            No more missed signals. Configure copy execution, risk controls, and MT5 bridge behavior with real-time precision.
          </div>
          <div className="settings-page-feature-grid">
            <div className="settings-page-feature-card card-hover-lift animate-enter" style={{ animationDelay: '0ms' }}>
              <div className="settings-page-feature-title">Real-Time Execution</div>
              <div className="settings-page-feature-text">Fast Telegram-to-MT5 processing with low-latency bridge updates.</div>
            </div>
            <div className="settings-page-feature-card card-hover-lift animate-enter" style={{ animationDelay: '100ms' }}>
              <div className="settings-page-feature-title">Advanced Risk Engine</div>
              <div className="settings-page-feature-text">Lot sizing, daily loss caps, execution guards, and filters tuned from one place.</div>
            </div>
            <div className="settings-page-feature-card card-hover-lift animate-enter" style={{ animationDelay: '200ms' }}>
              <div className="settings-page-feature-title">Operator Clarity</div>
              <div className="settings-page-feature-text">Unified settings tabs designed for quick decisions and fewer errors.</div>
            </div>
          </div>
        </div>
        {settings ? (
          <SettingsModal
            settings={settings}
            onSave={handleSave}
            onClose={() => {}}
            embedded
            licenseStatus={licenseStatus}
          />
        ) : (
          <div className="empty-state">Loading settings...</div>
        )}
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  );
}
