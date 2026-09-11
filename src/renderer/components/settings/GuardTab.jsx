import React, { useEffect, useMemo, useState } from 'react';
import { InfoTip, Toggle } from './SettingsFields.jsx';
import { useUiMode } from '../../hooks/useUiMode.js';

/** Safe caps applied by the "Apply safe defaults" button (mirrors first-run guided defaults). */
const SAFE_DEFAULTS = {
  lotMode: 'percentage',
  lotPercentage: 1.0,
  enableTradeLimit: true,
  maxConcurrentTrades: 3,
  enableDailyLoss: true,
  maxDailyLossPct: 5,
  maxSpreadPips: 3,
  enableHighImpactNewsGuard: true,
  blockInvalidOrMissingStopLoss: true,
};

export default function GuardTab({ s, set }) {
  const { isAdvanced, setUiMode } = useUiMode();
  const [guardState, setGuardState] = useState(null);
  useEffect(() => {
    let active = true;
    const refresh = () => window.electronAPI?.getDrawdownGuardStatus?.().then((res) => { if (active) setGuardState(res); }).catch(() => {});
    refresh();
    const t = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const clearHalt = async () => {
    await window.electronAPI?.clearDrawdownGuardHalt?.();
    const res = await window.electronAPI?.getDrawdownGuardStatus?.();
    setGuardState(res || null);
  };

  const applySafeDefaults = () => {
    for (const [key, value] of Object.entries(SAFE_DEFAULTS)) set(key, value);
    set('experienceMode', 'guided');
  };

  return (
    <>
      <div className="settings-section">
        <h3>🧭 Experience mode</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Guided mode ships with safe risk caps (1% risk sizing, 5% daily loss cap, max 3 concurrent trades,
          3-pip spread cap, news guard on). Pro mode records that you manage risk yourself — it never loosens
          anything automatically, but the app stops recommending the caps.
        </p>
        <div className="form-row" style={{ marginTop: 12, alignItems: 'end' }}>
          <div className="form-group" style={{ maxWidth: 320 }}>
            <label>Mode</label>
            <select
              className="select-field"
              value={s.experienceMode === 'pro' ? 'pro' : 'guided'}
              onChange={(e) => set('experienceMode', e.target.value === 'pro' ? 'pro' : 'guided')}
            >
              <option value="guided">Guided — safe caps recommended</option>
              <option value="pro">Pro — I manage my own risk</option>
            </select>
          </div>
          <div className="form-group">
            <button type="button" className="btn btn-outline btn-sm" onClick={applySafeDefaults}>
              Apply safe defaults
            </button>
          </div>
        </div>
        {s.experienceMode !== 'pro' && (!s.enableDailyLoss || !s.enableTradeLimit || !(Number(s.maxSpreadPips) > 0)) && (
          <div className="hint" style={{ marginTop: 8, color: 'var(--warning, #eab308)' }}>
            Some safe caps are currently off (daily loss cap, trade limit or spread cap). Use “Apply safe defaults”
            to restore them, or switch to Pro mode if that is intentional.
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>🎛️ Interface</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Simple mode keeps the sidebar focused on day-to-day trading. Advanced mode unlocks Filter Lab, AI, Fundamentals, and Channels.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Show advanced pages and settings</span>
          <Toggle
            checked={isAdvanced}
            onChange={(v) => setUiMode(v ? 'advanced' : 'simple')}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>🛡️ Drawdown Guardian</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Halts new signal sends when daily loss or peak-to-equity drawdown crosses the limits.
          Required for funded / prop accounts. Halt persists until next local-day boundary or manual clear.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Enable drawdown guardian</span>
          <Toggle checked={!!s.enableDrawdownGuard} onChange={(v) => set('enableDrawdownGuard', v)} />
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label>Max daily loss %</label>
            <input className="select-field" type="number" step="0.1" min="0" value={s.maxDailyLossPct ?? 0} onChange={(e) => set('maxDailyLossPct', Number(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label>Max absolute daily loss ($)</label>
            <input className="select-field" type="number" min="0" value={s.maxAbsoluteDailyLoss ?? 0} onChange={(e) => set('maxAbsoluteDailyLoss', Number(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label>Max peak-to-equity DD %</label>
            <input className="select-field" type="number" step="0.1" min="0" value={s.maxPeakDrawdownPct ?? 0} onChange={(e) => set('maxPeakDrawdownPct', Number(e.target.value) || 0)} />
          </div>
        </div>
        {guardState?.state && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'color-mix(in srgb, var(--surface2) 92%, transparent)', fontSize: 12 }}>
            <div><strong>Account:</strong> {guardState.accountKey || '—'}</div>
            <div><strong>Day:</strong> {guardState.state.day || '—'}</div>
            <div><strong>Start balance:</strong> {Number(guardState.state.startBalance || 0).toFixed(2)}</div>
            <div><strong>Start equity:</strong> {Number(guardState.state.startOfDayEquity || guardState.state.startBalance || 0).toFixed(2)}</div>
            <div><strong>Peak equity:</strong> {Number(guardState.state.peakEquity || 0).toFixed(2)}</div>
            <div><strong>Daily loss:</strong> {guardState.state.dailyLossPct != null ? `${Number(guardState.state.dailyLossPct).toFixed(2)}% (${guardState.state.dailyLossBasis || 'realized'})` : '—'}</div>
            <div style={{ marginTop: 6 }}>
              <strong>Tier:</strong>{' '}
              {guardState.state.tier && guardState.state.tier !== 'none' ? (
                <span className={`badge badge-${guardState.state.tier === 'yellow' ? 'pending' : guardState.state.tier === 'orange' ? 'blocked' : 'error'}`}>
                  {String(guardState.state.tier).toUpperCase()}
                </span>
              ) : 'None'}
            </div>
            <div><strong>Halted:</strong> {guardState.state.halted ? `Yes — ${guardState.state.reason}` : 'No'}</div>
            {guardState.state.halted && (
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={clearHalt}>Clear halt</button>
            )}
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>📉 Tiered drawdown</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Gradual response before a full halt: reduce lot size at yellow/orange tiers, halt at red.
          Daily loss % uses start-of-day equity when <strong>Daily loss basis</strong> is equity (below).
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Enable tiered drawdown responses</span>
          <Toggle checked={!!s.enableTieredDrawdown} onChange={(v) => set('enableTieredDrawdown', v)} />
        </div>
        {s.enableTieredDrawdown && (
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label>Yellow tier %</label>
              <input className="select-field" type="number" step="0.1" min="0" value={s.ddTierYellowPct ?? 2} onChange={(e) => set('ddTierYellowPct', Number(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Orange tier %</label>
              <input className="select-field" type="number" step="0.1" min="0" value={s.ddTierOrangePct ?? 3} onChange={(e) => set('ddTierOrangePct', Number(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Red tier % (halt)</label>
              <input className="select-field" type="number" step="0.1" min="0" value={s.ddTierRedPct ?? 5} onChange={(e) => set('ddTierRedPct', Number(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Yellow lot factor</label>
              <input className="select-field" type="number" step="0.05" min="0.01" max="1" value={s.ddTierYellowLotFactor ?? 0.5} onChange={(e) => set('ddTierYellowLotFactor', Number(e.target.value) || 0.5)} />
            </div>
            <div className="form-group">
              <label>Orange lot factor</label>
              <input className="select-field" type="number" step="0.05" min="0.01" max="1" value={s.ddTierOrangeLotFactor ?? 0.25} onChange={(e) => set('ddTierOrangeLotFactor', Number(e.target.value) || 0.25)} />
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>📊 Daily loss basis</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Prop firms count floating P&amp;L. <strong>Equity</strong> uses start-of-day equity minus current equity (from MT5 snapshots).
          Falls back to closed-trade P&amp;L if the snapshot is older than 60 seconds.
        </p>
        <div className="form-group" style={{ marginTop: 10, maxWidth: 320 }}>
          <label>Daily loss basis</label>
          <select className="select-field" value={s.dailyLossBasis || 'realized'} onChange={(e) => set('dailyLossBasis', e.target.value)}>
            <option value="realized">Realized (closed trades only)</option>
            <option value="equity">Equity (includes floating)</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>🧪 Dry run</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Runs the full pipeline (parse, sizing, guards, news, AI) but never sends to MetaTrader.
          Trades appear as <strong>SIMULATED</strong> so you can see what would have happened.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Dry run mode — simulate signals, do not send to MT5</span>
          <Toggle checked={!!s.dryRunMode} onChange={(v) => set('dryRunMode', v)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>📋 Fundamentals gate</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Uses the cached fundamentals checklist (same data as the Fundamentals page). NO-GO blocks the trade; WAIT allows it.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Block trades when the fundamentals checklist says NO-GO</span>
          <Toggle checked={!!s.enableFundamentalsGate} onChange={(v) => set('enableFundamentalsGate', v)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>🕶️ Stealth Execution</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          Adds a small randomized delay (and optional lot rounding jitter) before each send so executions look less identical to the source.
          Required by some funded firms to avoid copy-trade detection.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">Enable stealth mode</span>
          <Toggle checked={!!s.stealthMode} onChange={(v) => set('stealthMode', v)} />
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label>Min delay (ms)</label>
            <input className="select-field" type="number" min="0" step="50" value={s.stealthMinDelayMs ?? 200} onChange={(e) => set('stealthMinDelayMs', Number(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label>Max delay (ms)</label>
            <input className="select-field" type="number" min="0" step="50" value={s.stealthMaxDelayMs ?? 2500} onChange={(e) => set('stealthMaxDelayMs', Number(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label>Lot jitter (%)</label>
            <input className="select-field" type="number" min="0" max="20" step="0.1" value={s.stealthLotJitterPct ?? 0} onChange={(e) => set('stealthLotJitterPct', Number(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>🚦 If a safety check can&apos;t complete</h3>
        <p style={{ color: 'var(--text2)', fontSize: 12 }}>
          The news guard and AI check each have a short time budget. By default, when one of them times out the trade is
          still allowed through (fail-open). Turn this on to block the trade instead (fail-closed) — safer, but a slow
          connection can cost you valid signals.
        </p>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label">
            If a safety check can&apos;t complete (news/AI timeout), block the trade instead of allowing it
          </span>
          <Toggle
            checked={s.guardFailMode === 'closed'}
            onChange={(v) => set('guardFailMode', v ? 'closed' : 'open')}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>📏 Execution Limits</h3>
        <div className="form-row">
          <div className="form-group">
            <label>
              Max spread (pips) — blocks execution when spread is wider{' '}
              <InfoTip text="The spread is the broker's buy/sell price gap. When it is wider than this at the moment a signal arrives, the trade is blocked (reason: spread too high). 0 = no limit." />
            </label>
            <input className="select-field" type="number" min="0" step="0.1" value={s.maxSpreadPips ?? 0} onChange={(e) => set('maxSpreadPips', Number(e.target.value) || 0)} />
            <div className="hint" style={{ marginTop: 6 }}>0 = off. Checked once per signal, right before execution.</div>
          </div>
        </div>
      </div>
    </>
  );
}
