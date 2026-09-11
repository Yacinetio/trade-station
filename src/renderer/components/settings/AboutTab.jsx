import React, { useEffect, useState } from 'react';

export default function AboutTab({ licenseStatus, settings }) {
  const [copied, setCopied] = useState(false);
  const [openingDataFolder, setOpeningDataFolder] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [backupAccounts, setBackupAccounts] = useState([]);
  const [selectedBackupAccountKeys, setSelectedBackupAccountKeys] = useState([]);
  const [validationMessage, setValidationMessage] = useState('');
  const [storageInfo, setStorageInfo] = useState({ dataRoot: '', dataFile: '', accountsRoot: '' });
  const appVersion = licenseStatus?.appVersion || '1.1.0';
  const deviceId = licenseStatus?.deviceId || 'N/A';
  const platform = typeof navigator !== 'undefined' ? navigator.platform || 'N/A' : 'N/A';
  const language = typeof navigator !== 'undefined' ? navigator.language || 'N/A' : 'N/A';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'N/A';
  const generatedAt = new Date().toLocaleString();

  const yn = (value) => (value ? 'Enabled' : 'Disabled');
  const settingsSummary = [
    ['Lot mode', settings?.lotMode || 'percentage'],
    ['TP mode', settings?.tpMode || 'separate'],
    ['Execution entry', (settings?.executionEntryAdjust === false || settings?.lotMode === 'signal')
      ? 'Off (Telegram ENTRY)'
      : `${settings?.executionEntryMode || 'signal'}${(settings?.executionEntryMode === 'blend') ? ` (${settings?.executionEntryBlendPct ?? 50}%)` : ''}`],
    ['Spread entry offset', settings?.enableSpreadEntryAdjust === false
      ? 'Off'
      : settings?.spreadEntryAllPairs
        ? 'All pairs (live MT5 spread)'
        : `${Array.isArray(settings?.spreadEntryRules) ? settings.spreadEntryRules.length : 0} pair rule(s)`],
    ['Pending at entry', settings?.pendingAtEntry === false ? 'Off' : 'On'],
    ['R:R TP anchor', settings?.rrEntryAnchor || 'auto'],
    ['Reverse mode', settings?.reverseMode || 'none'],
    ['Break-even', yn(settings?.enableBreakEven)],
    ['Trailing stop', yn(settings?.enableTrailingStop)],
    ['Partial close', yn(settings?.enablePartialClose)],
    ['Max concurrent trades', String(settings?.maxConcurrentTrades || 10)],
    ['Daily loss guard', yn(settings?.enableDailyLoss)],
    ['Pending expiry', yn(settings?.enablePendingExpiry)],
    ['ACK log interval', `${settings?.mt5AckLogIntervalSec ?? 5} sec`],
    ['BE band (analytics)', `$±${Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 0)}`]
  ];

  useEffect(() => {
    let active = true;
    window.electronAPI?.getStorageInfo?.().then((info) => {
      if (!active) return;
      setStorageInfo({
        dataRoot: info?.dataRoot || '',
        dataFile: info?.dataFile || '',
        accountsRoot: info?.accountsRoot || ''
      });
    }).catch(() => {
      if (!active) return;
      setStorageInfo({ dataRoot: '', dataFile: '', accountsRoot: '' });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    window.electronAPI?.listBackupAccounts?.().then((result) => {
      if (!active) return;
      const accounts = Array.isArray(result?.accounts) ? result.accounts : [];
      setBackupAccounts(accounts);
      setSelectedBackupAccountKeys(accounts.map((acc) => acc.key));
    }).catch(() => {
      if (!active) return;
      setBackupAccounts([]);
      setSelectedBackupAccountKeys([]);
    });
    return () => { active = false; };
  }, []);

  const allBackupAccountsSelected = backupAccounts.length > 0
    && selectedBackupAccountKeys.length === backupAccounts.length;
  const toggleBackupAccount = (accountKey) => {
    const key = String(accountKey);
    setSelectedBackupAccountKeys((current) => {
      const has = current.some((item) => String(item) === key);
      return has ? current.filter((item) => String(item) !== key) : [...current, accountKey];
    });
  };
  const toggleAllBackupAccounts = (checked) => {
    setSelectedBackupAccountKeys(checked ? backupAccounts.map((acc) => acc.key) : []);
  };

  const copyDeviceId = async () => {
    if (!deviceId || deviceId === 'N/A') return;
    try {
      await navigator.clipboard.writeText(deviceId);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = deviceId;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <>
    <div className="settings-section">
      <h3>ℹ️ About Trade Station</h3>
      <p>Product identity and runtime metadata in a clean read-only layout.</p>

      <div className="about-grid">
        <div className="about-item">
          <span className="about-label">Version</span>
          <div className="about-value">{appVersion}</div>
        </div>
        <div className="about-item">
          <span className="about-label">Platform</span>
          <div className="about-value">{platform}</div>
        </div>
        <div className="about-item">
          <span className="about-label">Language</span>
          <div className="about-value">{language}</div>
        </div>
        <div className="about-item">
          <span className="about-label">Timezone</span>
          <div className="about-value">{timezone}</div>
        </div>
        <div className="about-item">
          <span className="about-label">Snapshot Generated</span>
          <div className="about-value">{generatedAt}</div>
        </div>
        <div className="about-item full">
          <span className="about-label">Device ID</span>
          <div className="about-value">{deviceId}</div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-outline" onClick={copyDeviceId}>
              {copied ? 'Copied' : 'Copy Device ID'}
            </button>
          </div>
        </div>
        <div className="about-item full">
          <span className="about-label">Data Folder</span>
          <div className="about-value">{storageInfo.dataRoot || 'Unavailable'}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-outline"
              disabled={openingDataFolder}
              onClick={async () => {
                setOpeningDataFolder(true);
                try {
                  await window.electronAPI?.openDataFolder?.();
                } finally {
                  setOpeningDataFolder(false);
                }
              }}
            >
              {openingDataFolder ? 'Opening...' : 'Open in File Explorer'}
            </button>
          </div>
        </div>
        <div className="about-item full">
          <span className="about-label">Data File</span>
          <div className="about-value">{storageInfo.dataFile || 'Unavailable'}</div>
        </div>
        <div className="about-item full">
          <span className="about-label">Accounts Trades Folder</span>
          <div className="about-value">{storageInfo.accountsRoot || 'Unavailable'}</div>
        </div>
      </div>
    </div>

    <div className="settings-section">
      <h3>🔌 Integrations</h3>
      <div className="form-row">
        <div className="about-item">
          <span className="about-label">Telegram Sync</span>
          <div className="about-value">Available (session-based)</div>
        </div>
        <div className="about-item">
          <span className="about-label">MT5 Bridge</span>
          <div className="about-value">TCP socket bridge + account snapshot</div>
        </div>
      </div>
      <div className="form-row">
        <div className="about-item">
          <span className="about-label">Screenshot Capture</span>
          <div className="about-value">Entry/Exit screenshots linked to trades</div>
        </div>
      </div>
    </div>

    <div className="settings-section">
      <h3>⚙️ Active Configuration Snapshot</h3>
      <p>Quick view of your most important execution and risk settings.</p>
      <div className="about-grid">
        {settingsSummary.map(([label, value]) => (
          <div key={label} className="about-item">
            <span className="about-label">{label}</span>
            <div className="about-value">{value}</div>
          </div>
        ))}
      </div>
    </div>
    <div className="settings-section">
      <h3>💾 Data Backup</h3>
      <p>
        Download or restore a ZIP of your Trade Station data folder (settings, trades, accounts, caches, exports).
        Export is read-only. Restore merges files in — nothing is deleted; a safety backup is created first.
      </p>
      {backupAccounts.length > 0 ? (
        <div className="backup-accounts-picker" style={{ marginTop: 12, marginBottom: 12 }}>
          <div className="hint" style={{ marginBottom: 8 }}>Include trade data for these accounts:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="account-scope-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={allBackupAccountsSelected}
                onChange={(e) => toggleAllBackupAccounts(e.target.checked)}
              />
              <span>All accounts</span>
            </label>
            {backupAccounts.map((acc) => (
              <label
                key={acc.key}
                className="account-scope-item"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                title={acc.key}
              >
                <input
                  type="checkbox"
                  checked={selectedBackupAccountKeys.some((key) => String(key) === String(acc.key))}
                  onChange={() => toggleBackupAccount(acc.key)}
                />
                <span>{acc.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 'auto' }}
          disabled={backingUp}
          onClick={async () => {
            setBackingUp(true);
            setBackupMessage('');
            try {
              const includeAccountKeys = backupAccounts.length > 0
                ? selectedBackupAccountKeys
                : null;
              const result = await window.electronAPI?.exportDataZip?.(
                includeAccountKeys ? { includeAccountKeys } : undefined
              );
              if (result?.canceled) {
                setBackupMessage('Backup canceled.');
              } else if (result?.success) {
                const mb = Number(result.zipBytes || result.totalBytes || 0) / (1024 * 1024);
                const sizeTxt = Number.isFinite(mb) && mb > 0 ? ` (${mb.toFixed(1)} MB)` : '';
                setBackupMessage(`Backup saved: ${result.filePath}${sizeTxt}`);
              } else {
                setBackupMessage(result?.reason ? `Backup failed: ${result.reason}` : 'Backup failed.');
              }
            } catch (err) {
              setBackupMessage(err?.message || 'Backup failed.');
            } finally {
              setBackingUp(false);
            }
          }}
        >
          {backingUp ? 'Creating ZIP...' : 'Download data backup (ZIP)'}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={restoring || backingUp}
          onClick={async () => {
            setRestoring(true);
            setBackupMessage('');
            try {
              const result = await window.electronAPI?.importDataZip?.();
              if (result?.canceled) {
                setBackupMessage('Restore canceled.');
              } else if (result?.success) {
                const safety = result.safetyBackupPath ? ` Safety copy: ${result.safetyBackupPath}.` : '';
                setBackupMessage(
                  `Restored ${result.copied ?? 0} files (${result.overwritten ?? 0} overwritten, ${result.added ?? 0} new). `
                  + `${result.tradeCount ?? 0} trades loaded.${safety}`
                );
              } else {
                setBackupMessage(result?.reason ? `Restore failed: ${result.reason}` : 'Restore failed.');
              }
            } catch (err) {
              setBackupMessage(err?.message || 'Restore failed.');
            } finally {
              setRestoring(false);
            }
          }}
        >
          {restoring ? 'Restoring...' : 'Restore from backup (ZIP)'}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={openingDataFolder}
          onClick={async () => {
            setOpeningDataFolder(true);
            try {
              await window.electronAPI?.openDataFolder?.();
            } finally {
              setOpeningDataFolder(false);
            }
          }}
        >
          {openingDataFolder ? 'Opening...' : 'Open data folder'}
        </button>
      </div>
      {backupMessage && <div className="hint" style={{ marginTop: 8 }}>{backupMessage}</div>}
    </div>

    <div className="settings-section">
      <h3>📤 Export Center</h3>
      <p>Generate a real-data weekly review pack (CSV trades + PDF performance report).</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 'auto' }}
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            setExportMessage('');
            try {
              const result = await window.electronAPI?.exportWeeklyPack?.({});
              if (result?.success) {
                setExportMessage(`Export generated in: ${result.baseDir}`);
              } else {
                setExportMessage('Export failed.');
              }
            } catch {
              setExportMessage('Export failed.');
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? 'Generating...' : 'Generate Weekly Pack'}
        </button>
      </div>
      {exportMessage && <div className="hint" style={{ marginTop: 8 }}>{exportMessage}</div>}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-outline"
          onClick={async () => {
            setValidationMessage('');
            const result = await window.electronAPI?.validateLiveAnalytics?.();
            if (result?.success) {
              setValidationMessage(`Live analytics validated at ${new Date(result.checkedAt).toLocaleString()}`);
            } else {
              setValidationMessage('Live analytics validation failed.');
            }
          }}
        >
          Run Live Analytics Check
        </button>
      </div>
      {validationMessage && <div className="hint" style={{ marginTop: 8 }}>{validationMessage}</div>}
    </div>
    </>
  );
}
