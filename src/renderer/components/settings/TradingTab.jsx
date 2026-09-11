import React from 'react';
import { InfoTip, Toggle, TagList, CorrelationGroupsEditor, SpreadEntryRulesEditor } from './SettingsFields.jsx';

export default function TradingTab({ s, set }) {
  return (
    <>
      <div className="settings-section">
        <h3>🔀 Trade Type Filter</h3>
        <p>Choose which types of trades to copy:</p>
        <div className="radio-group">
          {[{val:'both',label:'Copy both buy and sell trades'},{val:'buy',label:'Copy only buy trades'},{val:'sell',label:'Copy only sell trades'}].map(o => (
            <label key={o.val} className="radio-item">
              <input type="radio" name="tradeType" value={o.val} checked={s.tradeType===o.val} onChange={()=>set('tradeType',o.val)} />
              <label>{o.label}</label>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3>📋 Order Type</h3>
        <select className="select-field" value={s.orderType||'all'} onChange={e=>set('orderType',e.target.value)}>
          <option value="all">Allow all</option>
          <option value="market">Market orders only</option>
          <option value="pending">Pending orders only</option>
        </select>
      </div>

      <div className="settings-section">
        <h3>🎯 Take Profit Strategy</h3>
        <p>Configure how to handle multiple take profit levels:</p>
        <div className="form-group">
          <label>TP Mode:</label>
          <select className="select-field" value={s.tpMode||'separate'} onChange={e=>set('tpMode',e.target.value)}>
            <option value="separate">Separate Trades (Each TP)</option>
            <option value="first">First TP Only</option>
            <option value="last">Last TP Only</option>
            <option value="average">Average TP</option>
          </select>
          {s.tpMode==='separate' && <div className="hint">💡 Your lot is split across the targets — each TP gets its share of the total volume (set shares in Risk Lots → Take Profit Lot Sizing), same entry and SL.</div>}
        </div>
      </div>

      <div className="settings-section">
        <h3>⚡ Order Execution Override</h3>
        <p>Force all pending orders (LIMIT/STOP) to execute as market orders:</p>
        <div className="toggle-row">
          <span className="toggle-label">Convert all pending orders to market orders</span>
          <Toggle checked={s.forceMarket||false} onChange={v=>set('forceMarket',v)} />
        </div>
        {s.forceMarket && (
          <div style={{color:'var(--warning)',fontSize:12,marginTop:6}}>⚠ Warning: SL/TP will be removed when converting to market orders!</div>
        )}
      </div>

      <div className="settings-section">
        <h3>🎯 Execution entry (ENTRY vs AVG ENTRY)</h3>
        <p>
          Resolve <strong>EXEC entry</strong> (signal / AVG / blend).{' '}
          <strong>Risk % · Risk $ · % of balance</strong> lot sizing uses <strong>EXEC entry → SL only</strong> (Telegram TP is ignored for volume).{' '}
          With <strong>Use R:R target TP</strong>, take-profit follows <strong>R:R anchor</strong> below (not always EXEC — see Risk:Reward section).
          {' '}Disabled when <strong>Lot mode = Use lot from signal</strong> (Risk Lots tab).
        </p>
        {(() => {
          const execEntryLocked = (s.lotMode || '') === 'signal';
          const execAdjustOn = !execEntryLocked && s.executionEntryAdjust !== false;
          return (
            <>
        <div className="toggle-row">
          <span className="toggle-label">Adjust EXEC entry (blend / AVG vs Telegram ENTRY)</span>
          <Toggle
            checked={execAdjustOn}
            disabled={execEntryLocked}
            onChange={(v) => set('executionEntryAdjust', v)}
          />
        </div>
        {execEntryLocked && (
          <div className="hint" style={{ marginTop: 6, color: 'var(--warning)' }}>
            Off while <strong>Use lot from signal</strong> is selected — Telegram ENTRY is used as-is.
          </div>
        )}
        <div className="toggle-row" style={{ marginTop: 10 }}>
          <span className="toggle-label">Pending order when price is away from entry</span>
          <Toggle
            checked={s.pendingAtEntry !== false}
            disabled={!!s.forceMarket}
            onChange={(v) => set('pendingAtEntry', v)}
          />
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          MT5 AUTO: markets in when live price is already at your blend entry or better; otherwise LIMIT/STOP at entry. Turn off <strong>Convert all pending to market</strong> above.
        </div>
        {execAdjustOn && (
        <>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Use price:</label>
          <select
            className="select-field"
            value={s.executionEntryMode || 'signal'}
            onChange={(e) => set('executionEntryMode', e.target.value)}
          >
            <option value="signal">Signal ENTRY (Telegram line)</option>
            <option value="avg">AVG ENTRY only</option>
            <option value="blend">Blend OB edge / ENTRY toward AVG ENTRY (%)</option>
          </select>
        </div>
        {(s.executionEntryMode || 'signal') === 'blend' && (
          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Blend: % toward AVG ENTRY</label>
            <div className="number-input-wrap">
              <input
                type="number"
                value={s.executionEntryBlendPct ?? 50}
                min={0}
                max={100}
                step={1}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  set('executionEntryBlendPct', Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50);
                }}
              />
              <span className="number-input-unit">%</span>
            </div>
            <div className="hint">0% = OB edge (or ENTRY) · 100% = AVG ENTRY · 50% = midpoint</div>
          </div>
        )}
        </>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          Trades store <code>signalEntry</code> when EXEC differs from the Telegram ENTRY line.
        </div>
            </>
          );
        })()}
      </div>

      <div className="settings-section">
        <h3>📏 Spread entry offset</h3>
        <p>
          Shifts execution entry using <strong>live Ask−Bid spread</strong> from MT5:
          <strong> BUY → entry − spread</strong>, <strong>SELL → entry + spread</strong>.
          Use <strong>all pairs</strong> or restrict to symbols you list below.
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Enable spread entry offset</span>
          <Toggle
            checked={s.enableSpreadEntryAdjust !== false}
            onChange={(v) => set('enableSpreadEntryAdjust', v)}
          />
        </div>
        {s.enableSpreadEntryAdjust !== false && (
          <>
            <div className="toggle-row" style={{ marginTop: 10 }}>
              <span className="toggle-label">Apply to all pairs (live spread from MT5 EA)</span>
              <Toggle
                checked={!!s.spreadEntryAllPairs}
                onChange={(v) => set('spreadEntryAllPairs', v)}
              />
            </div>
            {s.spreadEntryAllPairs ? (
              <div className="hint" style={{ marginTop: 8 }}>
                Every symbol requests live spread from the SignalCopier EA when a signal arrives (MT5 must be connected).
                Pairs not in the list below are still adjusted; unlisted pairs have no offline fallback pips.
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 8, marginBottom: 8 }}>
                Only symbols in the list below are adjusted — all other pairs keep the normal entry.
              </div>
            )}
            <SpreadEntryRulesEditor
              rules={Array.isArray(s.spreadEntryRules) ? s.spreadEntryRules : []}
              onChange={(next) => set('spreadEntryRules', next)}
            />
            <div className="hint" style={{ marginTop: 8 }}>
              Symbol matching ignores broker suffixes (<code>US100.cash</code> → <code>US100</code>).
              {s.spreadEntryAllPairs
                ? ' Per-pair fallback pips (optional) apply when MT5 is offline — only for listed symbols.'
                : ' Spread is read live from MT5 when the signal is processed. Optional fallback pips when MT5 is offline.'}
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>📐 Default SL/TP for Market Orders</h3>
        <p>Set default Stop Loss and Take Profit when signal has no SL/TP:</p>
        <div className="toggle-row">
          <span className="toggle-label">Use default SL/TP for market orders without them</span>
          <Toggle checked={s.useDefaultSlTp||false} onChange={v=>set('useDefaultSlTp',v)} />
        </div>
        {s.useDefaultSlTp && (
          <div className="form-row" style={{marginTop:10}}>
            <div className="form-group">
              <label>Default SL (pips)</label>
              <div className="number-input-wrap">
                <input type="number" value={s.defaultSl||50} min={1} onChange={e=>set('defaultSl',parseInt(e.target.value))} />
                <span className="number-input-unit">pips</span>
              </div>
            </div>
            <div className="form-group">
              <label>Default TP (pips)</label>
              <div className="number-input-wrap">
                <input type="number" value={s.defaultTp||100} min={1} onChange={e=>set('defaultTp',parseInt(e.target.value))} />
                <span className="number-input-unit">pips</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>📊 Risk:Reward Ratio Mode</h3>
        <p>
          Automatically calculate TP from SL distance × ratio using your settings R:R.{' '}
          Choose which price anchors <strong>|anchor − SL|</strong>:{' '}
          <strong>Execution</strong> uses EXEC entry (above); <strong>Signal</strong> uses the Telegram ENTRY line when it differs;{' '}
          <strong>Auto</strong> uses Signal-style anchoring when lot sizing is not “volume from signal”, or when EXEC uses AVG/blend so TP matches the chart/Telegram line while lots still use EXEC→SL.
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Use Risk:Reward ratio mode</span>
          <Toggle checked={s.useRR||false} onChange={v=>set('useRR',v)} />
        </div>
        {s.useRR && (
          <>
            <div className="form-group" style={{marginTop:10}}>
              <label>R:R TP anchor</label>
              <select
                className="select-field"
                value={s.rrEntryAnchor || 'auto'}
                onChange={(e) => set('rrEntryAnchor', e.target.value)}
              >
                <option value="auto">Auto (recommended)</option>
                <option value="signal">Signal ENTRY (Telegram line)</option>
                <option value="execution">Execution entry only</option>
              </select>
              <div className="hint" style={{ marginTop: 6 }}>
                Auto → Telegram-line TP when lot mode is Risk % / Risk $ / Fixed / % balance, or when EXEC uses AVG/blend.{' '}
                Execution anchor keeps legacy behaviour and allows MT5 to snap TP to the actual fill after market execution.
              </div>
            </div>
            <div className="form-group" style={{marginTop:10}}>
              <label>R:R Ratio (e.g. 2 = 1:2)</label>
              <div className="number-input-wrap">
                <input type="number" value={s.rrRatio||2} min={0.1} step={0.1} onChange={e=>set('rrRatio',parseFloat(e.target.value))} />
                <span className="number-input-unit">:1</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>🔄 Reverse Trade Mode</h3>
        <p>Automatically reverse trade direction (BUY ↔ SELL) with adjusted SL/TP:</p>
        <div className="form-group">
          <label>Reverse Mode:</label>
          <select className="select-field" value={s.reverseMode||'none'} onChange={e=>set('reverseMode',e.target.value)}>
            <option value="none">Normal (No Reverse)</option>
            <option value="all">Reverse All Trades</option>
            <option value="buy">Reverse BUY only</option>
            <option value="sell">Reverse SELL only</option>
          </select>
          <div className="hint" style={{color:s.reverseMode!=='none'?'var(--warning)':'var(--text3)'}}>
            {s.reverseMode==='none' ? '✅ Normal mode - trades are executed as received without any reversal'
              : '⚠ Reverse mode active - BUY signals will be executed as SELL and vice versa'}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>🎯 MT5 break-even (SignalCopier EA)</h3>
        <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 10 }}>
          Sent to MetaTrader when you <strong>Save</strong> and again when MT5 connects. This is the same flag as{' '}
          <code style={{ fontSize: 'inherit' }}>enableBreakEven</code> in your settings JSON. Positions must use EA magic{' '}
          <strong>202401</strong>, or enable <strong>Manage manual positions</strong> on the EA.
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Break-even at 1R — move SL to entry when profit reaches initial risk</span>
          <Toggle
            checked={!!s.enableBreakEven}
            onChange={(on) => {
              if (on) {
                set('enableBreakEven', true);
                set('breakEvenUnit', 'rr');
                set('breakEvenTriggerPips', 1);
                set('breakEvenOffsetPips', 0);
              } else {
                set('enableBreakEven', false);
              }
            }}
          />
        </div>
        {s.enableBreakEven && (
          <>
            <div className="hint" style={{ marginTop: 8 }}>
              Uses <strong>R</strong> = |entry − SL| (cached by the EA when it first sees the trade). Default: trigger at{' '}
              <strong>1R</strong>, SL moved to <strong>entry</strong> (0R offset).
            </div>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label>
                  Trigger (× initial risk){' '}
                  <InfoTip text="How far into profit before the stop moves. 1 = the trade has earned as much as it risked (1R)." />
                </label>
                <div className="number-input-wrap">
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={Number(s.breakEvenTriggerPips ?? 1)}
                    onChange={(e) => set('breakEvenTriggerPips', Math.max(0.1, Number.parseFloat(e.target.value) || 1))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>
                  SL past entry (× risk, 0 = exact entry){' '}
                  <InfoTip text="0 moves the stop exactly to your entry (worst case: break-even). 0.2 locks in a small profit of 0.2R." />
                </label>
                <div className="number-input-wrap">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={Number(s.breakEvenOffsetPips ?? 0)}
                    onChange={(e) => set('breakEvenOffsetPips', Math.max(0, Number.parseFloat(e.target.value) || 0))}
                  />
                </div>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 8 }}>
              <label>
                Unit (keep R for 1R logic){' '}
                <InfoTip text="What the trigger number means: R = multiples of your initial risk, or pips / % of balance / $ profit." />
              </label>
              <select
                className="select-field"
                value={s.breakEvenUnit || 'rr'}
                onChange={(e) => set('breakEvenUnit', e.target.value)}
              >
                <option value="rr">R — multiples of initial risk (recommended)</option>
                <option value="pips">Pips</option>
                <option value="percent">% of balance</option>
                <option value="money">$ profit</option>
              </select>
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>
          💸 Partial close (scale out){' '}
          <InfoTip text="Bank part of the position once it reaches a profit target; the rest keeps running toward your TPs." />
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 10 }}>
          Example: at 1R profit, close 50% and let the rest run. Managed by the SignalCopier EA in MetaTrader — sent on{' '}
          <strong>Save</strong> and when MT5 connects.
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Scale out at profit target</span>
          <Toggle checked={!!s.enablePartialClose} onChange={(v) => set('enablePartialClose', v)} />
        </div>
        {s.enablePartialClose && (
          <>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label>Measure profit in</label>
                <select
                  className="select-field"
                  value={s.partialCloseUnit || 'pips'}
                  onChange={(e) => set('partialCloseUnit', e.target.value)}
                >
                  <option value="pips">Pips</option>
                  <option value="percent">% of balance</option>
                  <option value="money">$ profit</option>
                  <option value="rr">R — multiples of initial risk</option>
                </select>
              </div>
              <div className="form-group">
                <label>
                  Trigger ({
                    (s.partialCloseUnit || 'pips') === 'rr' ? '× initial risk'
                      : (s.partialCloseUnit || 'pips') === 'percent' ? '% of balance'
                      : (s.partialCloseUnit || 'pips') === 'money' ? '$ profit'
                      : 'pips'
                  })
                </label>
                <div className="number-input-wrap">
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={Number(s.partialCloseAtPips ?? 25)}
                    onChange={(e) => set('partialCloseAtPips', Math.max(0.1, Number.parseFloat(e.target.value) || 0.1))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Close this % of the position</label>
                <div className="number-input-wrap">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={Number(s.partialClosePercent ?? 50)}
                    onChange={(e) => {
                      const v = Number.parseInt(e.target.value, 10);
                      set('partialClosePercent', Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 50);
                    }}
                  />
                  <span className="number-input-unit">%</span>
                </div>
              </div>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              With unit <strong>R</strong> and trigger <strong>1</strong>: when the trade is up one full risk unit, {Number(s.partialClosePercent ?? 50)}% is closed and the remainder keeps running.
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>🌅 End of day (MT5)</h3>
        <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 10 }}>
          When enabled, the SignalCopier EA closes <strong>EA-managed</strong> positions (magic <strong>202401</strong>) at the
          time below. Time is <strong>MetaTrader trade-server</strong> (broker) time — the same clock as MT5&apos;s Market
          Watch. Recompile/reattach the EA after updating. Closes show as <strong>EOD close</strong> in the trades table.
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Close positions at end of day</span>
          <Toggle
            checked={!!s.enableEndOfDayClose}
            onChange={(on) => set('enableEndOfDayClose', on)}
          />
        </div>
        {s.enableEndOfDayClose && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Close time (server HH:MM)</label>
            <input
              type="time"
              className="select-field"
              style={{ maxWidth: 160 }}
              value={String(s.endOfDayCloseTime || '21:55').slice(0, 5)}
              onChange={(e) => set('endOfDayCloseTime', e.target.value || '21:55')}
            />
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>🏷️ Trade presets</h3>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          Labels for the Trades table Setup column (pick one or more per trade in Trade Detail). Also shortcut-add to journal tags. OB Telegram signals only carry VWAP yes/no — not setup text.
        </p>
        <TagList
          items={Array.isArray(s.tradePresets) ? s.tradePresets : []}
          onRemove={(i) => set('tradePresets', (s.tradePresets || []).filter((_, idx) => idx !== i))}
          onAdd={(v) => {
            const cur = Array.isArray(s.tradePresets) ? s.tradePresets : [];
            const t = v.trim();
            if (!t || cur.includes(t)) return;
            set('tradePresets', [...cur, t].slice(0, 200));
          }}
          placeholder="e.g. 2, London, sweep"
        />
      </div>

      <div className="settings-section">
        <h3>🔢 Trade Limits</h3>
        <div className="toggle-row">
          <span className="toggle-label">Enable Trade Limit</span>
          <Toggle checked={s.enableTradeLimit||false} onChange={v=>set('enableTradeLimit',v)} />
        </div>
        {s.enableTradeLimit && (
          <div className="form-group" style={{marginTop:10}}>
            <label>Maximum concurrent trades:</label>
            <div className="number-input-wrap">
              <input type="number" value={s.maxConcurrentTrades||10} min={1} max={100} onChange={e=>set('maxConcurrentTrades',parseInt(e.target.value))} />
            </div>
            <div className="hint">When enabled, limits the number of concurrent open trades.</div>
          </div>
        )}
        <div className="toggle-row" style={{marginTop:8}}>
          <span className="toggle-label">Automatically close trades when SL is hit</span>
          <Toggle checked={s.autoCloseSL!==false} onChange={v=>set('autoCloseSL',v)} />
        </div>

        <div className="toggle-row" style={{marginTop:16}}>
          <span className="toggle-label">Block if stop loss missing or wrong side of entry</span>
          <Toggle
            checked={s.blockInvalidOrMissingStopLoss !== false}
            onChange={(v) => set('blockInvalidOrMissingStopLoss', v)}
          />
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>
          BUY requires SL strictly below entry; SELL requires SL strictly above. Disable only if you accept sending signals with no or invalid SL (not recommended).
        </div>

        <div className="toggle-row">
          <span className="toggle-label">Block opposite signal on same pair while a trade is open</span>
          <Toggle checked={s.enableBlockOppositeSameSymbol||false} onChange={v=>set('enableBlockOppositeSameSymbol',v)} />
        </div>
        <div className="hint" style={{marginBottom: 10}}>
          While you have an open position on a symbol, opposite-direction signals on that same symbol are blocked until the position closes (linked MT5 account scope). Example: short EURUSD is open → a buy EURUSD signal is ignored until the short is closed.
        </div>

        <div className="toggle-row">
          <span className="toggle-label">Block opposing signals on correlated pairs while a trade is open</span>
          <Toggle checked={s.enableBlockCorrelatedOpposite||false} onChange={v=>set('enableBlockCorrelatedOpposite',v)} />
        </div>
        <div className="hint" style={{ marginBottom: 12 }}>
          Symbols in the same group move together. With a trade open on one symbol, an <strong>opposite-direction</strong> signal on another symbol in that group is blocked — e.g. long <strong>US100.cash</strong> (Nasdaq) then short <strong>US30.cash</strong> (Dow). Same direction on both is still allowed.
        </div>
        <CorrelationGroupsEditor
          groups={s.correlationGroups}
          onChange={(next) => set('correlationGroups', next)}
        />
      </div>
    </>
  );
}
