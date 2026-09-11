import React, { useEffect, useState } from 'react';
import { Toggle } from './SettingsFields.jsx';

export default function ChannelsTab({ s, set }) {
  const [channels, setChannels] = useState([]);
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    let active = true;
    window.electronAPI?.getChannels?.().then((res) => {
      if (!active) return;
      const list = Array.isArray(res?.channels) ? res.channels : [];
      setChannels(list);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const strategies = s.channelStrategies && typeof s.channelStrategies === 'object' ? s.channelStrategies : {};
  const keys = Object.keys(strategies);

  const updateOne = (key, patch) => {
    const next = { ...strategies, [key]: { ...(strategies[key] || {}), ...patch } };
    set('channelStrategies', next);
  };
  const removeOne = (key) => {
    const next = { ...strategies };
    delete next[key];
    set('channelStrategies', next);
  };
  const addNewKey = () => {
    const k = String(newKey || '').trim();
    if (!k) return;
    if (strategies[k]) return;
    set('channelStrategies', { ...strategies, [k]: { enabled: true } });
    setNewKey('');
  };

  return (
    <>
      <div className="settings-section">
        <h3>📡 Per-channel Strategy Overrides</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Override risk, lot, TP, reverse, or skip-no-SL per Telegram channel. Empty fields fall back to global settings.
          Disable a channel here to silently drop its signals without removing it from your enabled list.
        </p>

        <div className="form-row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Add channel by name or id</label>
            <input
              className="select-field"
              list="known-channels"
              placeholder="e.g. Gold Signals VIP"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <datalist id="known-channels">
              {channels.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <button type="button" className="btn btn-outline" onClick={addNewKey}>+ Add</button>
        </div>
      </div>

      {keys.length === 0 && (
        <div className="settings-section" style={{ color: 'var(--text2)', fontSize: 13 }}>
          No per-channel overrides configured yet.
        </div>
      )}

      {keys.map((key) => {
        const cfg = strategies[key] || {};
        return (
          <div key={key} className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0 }}>📌 {key}</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => removeOne(key)}>Remove</button>
            </div>

            <div className="toggle-row" style={{ marginTop: 12 }}>
              <span className="toggle-label">Enabled (process signals from this channel)</span>
              <Toggle checked={cfg.enabled !== false} onChange={(v) => updateOne(key, { enabled: v })} />
            </div>

            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label>Lot mode</label>
                <select className="select-field" value={cfg.lotMode || ''} onChange={(e) => updateOne(key, { lotMode: e.target.value || undefined })}>
                  <option value="">(global)</option>
                  <option value="percentage">Balance %</option>
                  <option value="fixed">Fixed lot</option>
                  <option value="risk">Risk $</option>
                  <option value="riskpct">Risk %</option>
                  <option value="signal">From signal</option>
                </select>
              </div>
              <div className="form-group">
                <label>TP mode</label>
                <select className="select-field" value={cfg.tpMode || ''} onChange={(e) => updateOne(key, { tpMode: e.target.value || undefined })}>
                  <option value="">(global)</option>
                  <option value="separate">Separate trades</option>
                  <option value="first">First TP only</option>
                  <option value="last">Last TP only</option>
                  <option value="average">Average TP</option>
                </select>
              </div>
              <div className="form-group">
                <label>Reverse mode</label>
                <select className="select-field" value={cfg.reverse || ''} onChange={(e) => updateOne(key, { reverse: e.target.value || undefined })}>
                  <option value="">(global)</option>
                  <option value="none">None</option>
                  <option value="flip">Flip direction</option>
                  <option value="sl_tp_only">Swap SL/TP only</option>
                </select>
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label>Risk %</label>
                <input className="select-field" type="number" step="0.1" value={cfg.riskPct ?? ''} onChange={(e) => updateOne(key, { riskPct: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>Lot %</label>
                <input className="select-field" type="number" step="0.1" value={cfg.lotPercentage ?? ''} onChange={(e) => updateOne(key, { lotPercentage: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>Fixed lot</label>
                <input className="select-field" type="number" step="0.01" value={cfg.fixedLot ?? ''} onChange={(e) => updateOne(key, { fixedLot: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>Extra delay (ms)</label>
                <input className="select-field" type="number" min="0" step="50" value={cfg.extraDelayMs ?? ''} onChange={(e) => updateOne(key, { extraDelayMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
            </div>

            <div className="toggle-row" style={{ marginTop: 12 }}>
              <span className="toggle-label">Skip signals without SL</span>
              <Toggle checked={!!cfg.skipNoSL} onChange={(v) => updateOne(key, { skipNoSL: v })} />
            </div>
          </div>
        );
      })}
    </>
  );
}
