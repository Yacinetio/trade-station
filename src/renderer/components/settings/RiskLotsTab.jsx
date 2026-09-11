import React from 'react';
import { InfoTip, Toggle } from './SettingsFields.jsx';

export default function RiskLotsTab({ s, set }) {
  const beBand = Math.max(0, Number(s.analyticsBreakEvenAmount ?? 50) || 0);
  return (
    <>
      <div className="settings-section">
        <h3>📊 Break-even band (analytics)</h3>
        <p style={{ marginTop: 8, color: 'var(--text3)', fontSize: 12, lineHeight: 1.45 }}>
          Closed trades whose profit falls between <strong>−this value</strong> and <strong>+this value</strong> (USD) count as break-even for the dashboard stats pill, status badges, and filters (e.g. <strong>20</strong> → −$20 … +$20, or <strong>0.01</strong> → −$0.01 … +$0.01).
          Separate from EA break-even management on the Trading tab.
        </p>
        <div className="form-row" style={{ marginTop: 10 }}>
          <div className="form-group">
            <label>Break-even band ($)</label>
            <div className="number-input-wrap">
              <input
                type="number"
                min={0}
                step={0.01}
                value={beBand}
                onChange={(e) =>
                  set('analyticsBreakEvenAmount', Math.max(0, Number.parseFloat(e.target.value) || 0))
                }
              />
              <span className="number-input-unit">$</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>💰 Lot Sizing</h3>
        <p>Choose how to calculate lot sizes for trades:</p>
        <div className="form-group">
          <label>
            Lot Mode:{' '}
            <InfoTip text="How big each trade is. Risk-based modes size the lot from your stop-loss distance so a losing trade costs a predictable amount; Fixed always uses the same volume; 'from signal' copies whatever lot the channel wrote." />
          </label>
          <select
            className="select-field"
            value={s.lotMode||'percentage'}
            onChange={(e) => {
              const mode = e.target.value;
              set('lotMode', mode);
              if (mode === 'signal') set('executionEntryAdjust', false);
            }}
          >
            <option value="percentage">Risk % of balance (SL-based)</option>
            <option value="fixed">Fixed Lot Size</option>
            <option value="signal">Use lot from signal</option>
            <option value="risk">Risk Amount ($)</option>
            <option value="riskpct">Risk % of Balance</option>
          </select>
        </div>
        {s.lotMode==='signal' && (
          <div className="hint" style={{ marginTop: 8 }}>
            Uses the lot parsed from Telegram when the message includes one; otherwise falls back to the minimum volume (capped by max lot).
          </div>
        )}
        {s.lotMode==='percentage' && (
          <>
          <div className="hint" style={{ marginTop: 8 }}>
            Lot size uses your risk budget ({s.lotPercentage ?? 1}% of equity or balance) divided by estimated loss per standard lot from entry to stop loss (pip distance). Include an SL in the Telegram message, or enable default SL/TP in the Execution tab so a stop is placed automatically.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Risk % of equity/balance:</label>
              <div className="number-input-wrap">
                <input type="number" value={s.lotPercentage||1} min={0.01} max={100} step={0.1} onChange={e=>set('lotPercentage',parseFloat(e.target.value))} />
                <span className="number-input-unit">%</span>
              </div>
            </div>
            <div className="form-group">
              <label>Maximum Lot Size:</label>
              <div className="number-input-wrap">
                <input type="number" value={s.maxLot||20} min={0.01} max={500} step={0.01} onChange={e=>set('maxLot',parseFloat(e.target.value))} />
                <span className="number-input-unit">lots</span>
              </div>
            </div>
          </div>
          </>
        )}
        {s.lotMode==='fixed' && (
          <div className="form-row">
            <div className="form-group">
              <label>Fixed Lot Size:</label>
              <div className="number-input-wrap">
                <input type="number" value={s.fixedLot||0.01} min={0.01} step={0.01} onChange={e=>set('fixedLot',parseFloat(e.target.value))} />
                <span className="number-input-unit">lots</span>
              </div>
            </div>
            <div className="form-group">
              <label>Maximum Lot Size:</label>
              <div className="number-input-wrap">
                <input type="number" value={s.maxLot||20} min={0.01} step={0.01} onChange={e=>set('maxLot',parseFloat(e.target.value))} />
                <span className="number-input-unit">lots</span>
              </div>
            </div>
          </div>
        )}
        {(s.lotMode==='risk'||s.lotMode==='riskpct') && (
          <>
          <div className="hint" style={{ marginTop: 8 }}>
            Same SL-based sizing as percentage mode: risk budget ({s.lotMode === 'risk' ? 'fixed $' : '% of equity/balance'}) divided by loss per lot from execution entry to stop loss. Requires SL in the signal or default SL/TP enabled.
            {' '}If volume still matches the lot written in Telegram (for example 0.06), open Telegram Channels → per-channel strategy and ensure Lot mode is not set to “Use lot from signal”, which ignores Risk $.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{s.lotMode==='risk'?'Risk Amount':'Risk %'}:</label>
              <div className="number-input-wrap">
                <input type="number" value={s.lotMode==='risk'?(s.riskAmount||100):(s.riskPct||1)} min={0.01} step={0.1} onChange={e=>set(s.lotMode==='risk'?'riskAmount':'riskPct',parseFloat(e.target.value))} />
                <span className="number-input-unit">{s.lotMode==='risk'?'$':'%'}</span>
              </div>
            </div>
            <div className="form-group">
              <label>Maximum Lot Size:</label>
              <div className="number-input-wrap">
                <input type="number" value={s.maxLot||20} min={0.01} step={0.01} onChange={e=>set('maxLot',parseFloat(e.target.value))} />
                <span className="number-input-unit">lots</span>
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>🎯 Take Profit Lot Sizing (Separate TP Mode)</h3>
        <p>Your lot is split across the targets. Choose how the shares are divided:</p>
        <div className="form-group">
          <label>TP Lot Mode:</label>
          <select className="select-field" value={s.tpLotMode||'equal'} onChange={e=>set('tpLotMode',e.target.value)}>
            <option value="equal">Equal (same share for every TP)</option>
            <option value="decreasing">Decreasing (50% / 30% / 20%)</option>
            <option value="custom">Custom %</option>
          </select>
        </div>
        {s.tpLotMode==='custom' && (() => {
          const raw = String(s.tpCustomShares ?? '50,30,20');
          const parts = raw.split(',').map((x) => Number.parseFloat(String(x).trim())).filter((n) => Number.isFinite(n));
          const sum = parts.reduce((a, b) => a + b, 0);
          const sumOk = parts.length > 0 && Math.abs(sum - 100) <= 1;
          return (
            <div className="form-group" style={{ marginTop: 8 }}>
              <label>Custom shares (% per TP, comma-separated)</label>
              <input
                className="select-field"
                value={raw}
                placeholder="e.g. 50,30,20"
                onChange={(e) => set('tpCustomShares', e.target.value)}
              />
              <div className="hint" style={{ marginTop: 6, color: sumOk ? 'var(--text3)' : 'var(--warning)' }}>
                {parts.length === 0
                  ? 'Enter one percentage per take-profit target, e.g. "50,30,20".'
                  : sumOk
                    ? `✓ ${parts.length} target${parts.length === 1 ? '' : 's'} — shares add up to ${Math.round(sum)}%.`
                    : `⚠ Shares add up to ${Math.round(sum)}% — they should total about 100%.`}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="settings-section">
        <h3>🛡️ Daily Loss Limit</h3>
        <div className="toggle-row">
          <span className="toggle-label">Enable Daily Loss Limit</span>
          <Toggle checked={s.enableDailyLoss||false} onChange={v=>set('enableDailyLoss',v)} />
        </div>
        {s.enableDailyLoss && (
          <div className="form-row" style={{marginTop:10}}>
            <div className="form-group">
              <label>Max Daily Loss ($):</label>
              <div className="number-input-wrap">
                <input type="number" value={s.maxDailyLoss||500} min={1} onChange={e=>set('maxDailyLoss',parseFloat(e.target.value))} />
                <span className="number-input-unit">$</span>
              </div>
            </div>
            <div className="form-group">
              <label>Max Daily Loss (%):</label>
              <div className="number-input-wrap">
                <input type="number" value={s.maxDailyLossPct||5} min={0.1} max={100} step={0.1} onChange={e=>set('maxDailyLossPct',parseFloat(e.target.value))} />
                <span className="number-input-unit">%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
