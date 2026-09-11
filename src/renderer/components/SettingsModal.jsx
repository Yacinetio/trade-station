import React, { useEffect, useMemo, useState } from 'react';
import {
  CandlestickChart, AlertTriangle, RadioTower, Shield, Bot, Ban,
  Columns, CaseSensitive, Bell, Plug, Info, Save
} from 'lucide-react';
import TradingTab from './settings/TradingTab.jsx';
import RiskLotsTab from './settings/RiskLotsTab.jsx';
import ChannelsTab from './settings/ChannelsTab.jsx';
import GuardTab from './settings/GuardTab.jsx';
import AiTab from './settings/AiTab.jsx';
import FiltersTab from './settings/FiltersTab.jsx';
import ColumnsTab from './settings/ColumnsTab.jsx';
import KeywordsTab from './settings/KeywordsTab.jsx';
import NotifsTab from './settings/NotifsTab.jsx';
import ConnectionTab from './settings/ConnectionTab.jsx';
import AboutTab from './settings/AboutTab.jsx';

const TABS = [
  { id: 'trading', label: 'Trading', Icon: CandlestickChart },
  { id: 'risk', label: 'Risk Lots', Icon: AlertTriangle },
  { id: 'channels', label: 'Channels', Icon: RadioTower },
  { id: 'guard', label: 'Guard', Icon: Shield },
  { id: 'ai', label: 'AI', Icon: Bot },
  { id: 'filters', label: 'Filters', Icon: Ban },
  { id: 'columns', label: 'Columns', Icon: Columns },
  { id: 'keywords', label: 'Keywords', Icon: CaseSensitive },
  { id: 'notif', label: 'Notifs', Icon: Bell },
  { id: 'connection', label: 'Connection', Icon: Plug },
  { id: 'about', label: 'About', Icon: Info },
];

export default function SettingsModal({
  settings,
  onSave,
  onClose,
  embedded = false,
  licenseStatus = null,
}) {
  const [tab, setTab] = useState('trading');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [profilesData, setProfilesData] = useState({ profiles: [], activeProfileId: 'default' });
  const [profileName, setProfileName] = useState('');
  const [instanceInfo, setInstanceInfo] = useState(null);
  const settingsSnap = useMemo(() => JSON.stringify(settings ?? null), [settings]);
  const [s, setS] = useState(() => ({ ...(settings || {}) }));

  useEffect(() => {
    window.electronAPI?.getSettingsProfiles?.().then((p) => setProfilesData(p || { profiles: [] })).catch(() => {});
    window.electronAPI?.getInstanceInfo?.().then((info) => {
      if (info?.isNamedInstance) setInstanceInfo(info);
    }).catch(() => {});
  }, []);

  const visibleTabs = useMemo(() => {
    const q = settingsSearch.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((t) => t.label.toLowerCase().includes(q) || t.id.includes(q));
  }, [settingsSearch]);

  useEffect(() => {
    if (settings == null) return;
    setS({ ...settings });
  }, [settingsSnap]);

  const set = (key, val) => setS(prev => ({ ...prev, [key]: val }));
  const setNested = (parent, key, val) => setS(prev => ({ ...prev, [parent]: { ...prev[parent], [key]: val } }));

  const addToArray = (key, val) => setS(prev => ({ ...prev, [key]: [...(prev[key] || []), val] }));
  const removeFromArray = (key, idx) => setS(prev => ({ ...prev, [key]: (prev[key] || []).filter((_, i) => i !== idx) }));

  const wrapperClass = embedded ? 'settings-page-panel' : 'modal';
  const headerClass = embedded ? 'settings-page-header' : 'modal-header';
  const tabsClass = embedded ? 'settings-page-tabs' : 'modal-tabs';
  const tabClass = embedded ? 'settings-page-tab' : 'modal-tab';
  const bodyClass = embedded ? 'settings-page-body' : 'modal-body';
  const footerClass = embedded ? 'settings-page-footer' : 'modal-footer';

  const modalBody = (
      <div className={`${wrapperClass}${embedded ? ' settings-page-panel--embedded' : ''}`} data-testid="settings-panel">
        {!embedded && (
          <div className={headerClass}>
            <h2>⚙️ Settings</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        )}
        <div className="settings-page-toolbar">
          <input
            className="select-field"
            placeholder="Search settings…"
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <select
              className="select-field"
              value={profilesData.activeProfileId || 'default'}
              onChange={async (e) => {
                const id = e.target.value;
                if (id === 'default') return;
                const r = await window.electronAPI?.applySettingsProfile?.(id);
                if (r?.settings) setS({ ...r.settings });
              }}
            >
              <option value="default">Current settings</option>
              {(profilesData.profiles || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              className="select-field"
              placeholder="Profile name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              style={{ flex: 1, minWidth: 120 }}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={async () => {
                const name = profileName.trim() || 'Profile';
                await window.electronAPI?.saveSettingsProfile?.({ name, settings: s });
                const p = await window.electronAPI?.getSettingsProfiles?.();
                setProfilesData(p || { profiles: [] });
                setProfileName('');
              }}
            >
              Save profile
            </button>
          </div>
        </div>
        <div className={tabsClass}>
          {visibleTabs.map(t => (
            <button
              key={t.id}
              type="button"
              data-testid={`settings-tab-${t.id}`}
              className={`${tabClass} ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <t.Icon size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
              {t.label}
            </button>
          ))}
        </div>
        <div className={bodyClass}>
          {tab === 'trading'    && <TradingTab    s={s} set={set} />}
          {tab === 'risk'       && <RiskLotsTab   s={s} set={set} />}
          {tab === 'channels'   && <ChannelsTab   s={s} set={set} />}
          {tab === 'guard'      && <GuardTab      s={s} set={set} />}
          {tab === 'ai'         && <AiTab         s={s} set={set} />}
          {tab === 'filters'    && <FiltersTab    s={s} set={set} setNested={setNested} addToArray={addToArray} removeFromArray={removeFromArray} />}
          {tab === 'columns'    && <ColumnsTab    s={s} set={set} />}
          {tab === 'keywords'   && <KeywordsTab   s={s} set={set} setNested={setNested} addToArray={addToArray} removeFromArray={removeFromArray} />}
          {tab === 'notif'      && <NotifsTab     s={s} set={set} setNested={setNested} />}
          {tab === 'connection' && <ConnectionTab s={s} set={set} instanceInfo={instanceInfo} />}
          {tab === 'about'
            && (
              <AboutTab
                licenseStatus={licenseStatus}
                settings={s}
              />
            )}
        </div>
        <div className={footerClass}>
          <button
            className="btn btn-outline"
            title="Revert unsaved edits back to your last saved settings"
            onClick={() => setS({ ...settings })}
          >
            Discard changes
          </button>
          <button
            className="btn btn-outline"
            title="Restore factory defaults (keeps EA port/instance identity). Nothing is saved until you click Save."
            onClick={async () => {
              const defaults = await window.electronAPI?.getDefaultSettings?.();
              if (defaults && typeof defaults === 'object') setS({ ...defaults });
            }}
          >
            Reset to defaults
          </button>
          {!embedded && <button className="btn btn-outline" onClick={onClose}>Cancel</button>}
          <button
            type="button"
            data-testid="settings-save"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={() => onSave(s)}
          >
            <Save size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
            Save Settings
          </button>
        </div>
      </div>
  );

  if (embedded) return modalBody;
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      {modalBody}
    </div>
  );
}
