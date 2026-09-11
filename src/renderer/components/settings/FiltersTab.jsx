import React, { useState } from 'react';
import { InfoTip, Toggle, TagList } from './SettingsFields.jsx';

function ExcludePairInput({ onAdd }) {
  const [val, setVal] = useState('');
  return (
    <>
      <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&val.trim()&&(onAdd(val),setVal(''))} placeholder="Enter symbol (e.g., XAUUSDm)"
        style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',color:'var(--text)',fontSize:13,outline:'none'}} />
      <button onClick={()=>val.trim()&&(onAdd(val),setVal(''))} style={{padding:'8px 14px',background:'transparent',border:'1px solid var(--border)',borderRadius:8,color:'var(--text2)',cursor:'pointer',fontSize:18}}>＋</button>
    </>
  );
}

export default function FiltersTab({ s, set, setNested, addToArray, removeFromArray }) {
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const sb0 = {
    symbolContains: '',
    types: [],
    channels: [],
    timeframes: [],
    symbols: [],
    biasTerms: [],
    setupTerms: [],
    vwapBands: [],
    hvnBands: [],
    sessionNames: [],
    weekdayIndices: []
  };
  const sb = { ...sb0, ...(s.signalBlockFilters || {}) };
  const patchSb = (partial) => set('signalBlockFilters', { ...sb, ...partial });
  const toggleSbList = (key, val, active) => {
    const cur = Array.isArray(sb[key]) ? [...sb[key]] : [];
    const i = cur.indexOf(val);
    if (active && i < 0) cur.push(val);
    if (!active && i >= 0) cur.splice(i, 1);
    patchSb({ [key]: cur });
  };
  const WD_SLICES = [
    { i: 1, l: 'Mon' }, { i: 2, l: 'Tue' }, { i: 3, l: 'Wed' }, { i: 4, l: 'Thu' },
    { i: 5, l: 'Fri' }, { i: 6, l: 'Sat' }, { i: 0, l: 'Sun' }
  ];
  return (
    <>
      <div className="settings-section">
        <h3>⛔ Advanced signal block filters</h3>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.45 }}>
          When enabled, a signal that matches <strong>every</strong> rule you set below is saved as{' '}
          <code style={{ fontSize: 12 }}>BLOCKED_SIGNAL_FILTERS</code> and is <strong>not</strong> sent to MT5.
          Leave a row empty to skip that dimension (same idea as dashboard slice filters: empty = no constraint).
        </p>
        <div className="toggle-row">
          <span className="toggle-label">Enable advanced block rules</span>
          <Toggle checked={s.enableAdvancedSignalBlockFilters === true} onChange={(v) => set('enableAdvancedSignalBlockFilters', v)} />
        </div>
        {s.enableAdvancedSignalBlockFilters && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label>Symbol contains (optional substring)</label>
              <input
                className="select-field"
                value={sb.symbolContains || ''}
                onChange={(e) => patchSb({ symbolContains: e.target.value })}
                placeholder="e.g. XAU — matches XAUUSD, XAUUSDm"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Direction (optional)</div>
              <div style={{ display: 'flex', gap: 16 }}>
                {['BUY', 'SELL'].map((t) => (
                  <label key={t} className={`checkbox-item ${(sb.types || []).includes(t) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={(sb.types || []).includes(t)}
                      onChange={(e) => toggleSbList('types', t, e.target.checked)}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
              <div className="hint">Unchecked both = any direction can match other rules.</div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Channels (OR — match any listed)</div>
              <TagList
                items={sb.channels || []}
                onRemove={(i) => patchSb({ channels: (sb.channels || []).filter((_, idx) => idx !== i) })}
                onAdd={(v) => {
                  const c = String(v || '').trim();
                  if (!c) return;
                  if ((sb.channels || []).includes(c)) return;
                  patchSb({ channels: [...(sb.channels || []), c] });
                }}
                placeholder="Exact Telegram channel name"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Timeframes (OR)</div>
              <TagList
                items={sb.timeframes || []}
                onRemove={(i) => patchSb({ timeframes: (sb.timeframes || []).filter((_, idx) => idx !== i) })}
                onAdd={(v) => patchSb({ timeframes: [...(sb.timeframes || []), String(v || '').trim().toUpperCase()].filter(Boolean) })}
                placeholder="e.g. M15, H1"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Pairs (OR — exact symbol after mapping)</div>
              <TagList
                items={sb.symbols || []}
                onRemove={(i) => patchSb({ symbols: (sb.symbols || []).filter((_, idx) => idx !== i) })}
                onAdd={(v) => patchSb({ symbols: [...(sb.symbols || []), String(v || '').trim().toUpperCase()].filter(Boolean) })}
                placeholder="e.g. EURUSD"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Bias terms (OR)</div>
              <TagList
                items={sb.biasTerms || []}
                onRemove={(i) => patchSb({ biasTerms: (sb.biasTerms || []).filter((_, idx) => idx !== i) })}
                onAdd={(v) => patchSb({ biasTerms: [...(sb.biasTerms || []), String(v || '').trim().toLowerCase()].filter(Boolean) })}
                placeholder="Lowercase phrase from signal"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Setup / preset tags (OR)</div>
              <TagList
                items={sb.setupTerms || []}
                onRemove={(i) => patchSb({ setupTerms: (sb.setupTerms || []).filter((_, idx) => idx !== i) })}
                onAdd={(v) => patchSb({ setupTerms: [...(sb.setupTerms || []), String(v || '').trim().toLowerCase()].filter(Boolean) })}
                placeholder="Matches journal presets / setup text"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>VWAP flag (OR)</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { k: 'yes', lab: 'YES' },
                  { k: 'no', lab: 'NO' },
                  { k: 'na', lab: 'n/a' }
                ].map(({ k, lab }) => (
                  <label key={k} className={`checkbox-item ${(sb.vwapBands || []).includes(k) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={(sb.vwapBands || []).includes(k)}
                      onChange={(e) => toggleSbList('vwapBands', k, e.target.checked)}
                    />
                    <span>{lab}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>HVN flag (OR)</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { k: 'yes', lab: 'YES' },
                  { k: 'no', lab: 'NO' },
                  { k: 'na', lab: 'n/a' }
                ].map(({ k, lab }) => (
                  <label key={k} className={`checkbox-item ${(sb.hvnBands || []).includes(k) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={(sb.hvnBands || []).includes(k)}
                      onChange={(e) => toggleSbList('hvnBands', k, e.target.checked)}
                    />
                    <span>{lab}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Sessions (OR, local hour)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { key: 'asian', label: 'Asian (local before 08:00)' },
                  { key: 'london', label: 'London (08:00–15:59)' },
                  { key: 'newYork', label: 'New York (16:00+)' }
                ].map((sess) => (
                  <label key={sess.key} className={`checkbox-item ${(sb.sessionNames || []).includes(sess.key) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={(sb.sessionNames || []).includes(sess.key)}
                      onChange={(e) => toggleSbList('sessionNames', sess.key, e.target.checked)}
                    />
                    <span>{sess.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Weekdays (OR, local)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {WD_SLICES.map(({ i, l }) => (
                  <label key={i} className={`checkbox-item ${(sb.weekdayIndices || []).includes(i) ? 'checked' : ''}`} style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={(sb.weekdayIndices || []).includes(i)}
                      onChange={(e) => toggleSbList('weekdayIndices', i, e.target.checked)}
                    />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>⏰ Time Range</h3>
        <div className="toggle-row">
          <span className="toggle-label">Enable Time Range Filter</span>
          <Toggle checked={s.enableTimeFilter||false} onChange={v=>set('enableTimeFilter',v)} />
        </div>
        {s.enableTimeFilter && (
          <div className="form-row" style={{marginTop:12}}>
            <div className="form-group"><label>From:</label><input className="select-field" type="time" value={s.timeFrom||'00:00'} onChange={e=>set('timeFrom',e.target.value)} /></div>
            <div className="form-group"><label>To:</label><input className="select-field" type="time" value={s.timeTo||'23:59'} onChange={e=>set('timeTo',e.target.value)} /></div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>🌍 Trading Sessions</h3>
        <div className="toggle-row">
          <span className="toggle-label">Enable Trading Sessions Filter</span>
          <Toggle checked={s.enableSessionFilter||false} onChange={v=>set('enableSessionFilter',v)} />
        </div>
        <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8}}>
          {[{key:'asian',label:'Asian Session (00:00 - 09:00 UTC)'},{key:'london',label:'London Session (08:00 - 17:00 UTC)'},{key:'newYork',label:'New York Session (13:00 - 22:00 UTC)'}].map(sess=>{
            const checked=s.sessions?.[sess.key]!==false;
            return (
              <label key={sess.key} className={`checkbox-item ${checked?'checked':''}`}>
                <input type="checkbox" checked={checked} onChange={e=>setNested('sessions',sess.key,e.target.checked)} />
                <label>{sess.label}</label>
              </label>
            );
          })}
        </div>
      </div>

      <div className="settings-section">
        <h3>📅 Trading Days</h3>
        <div className="toggle-row">
          <span className="toggle-label">Enable Trading Days Filter</span>
          <Toggle checked={s.enableDaysFilter||false} onChange={v=>set('enableDaysFilter',v)} />
        </div>
        <p style={{marginTop:8}}>Select allowed trading days:</p>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
          {DAYS.map((d,i)=>{
            const dayIdx=i+1;
            const checked=(s.tradingDays||[1,2,3,4,5]).includes(dayIdx);
            const toggle=()=>{const days=s.tradingDays||[1,2,3,4,5];set('tradingDays',checked?days.filter(x=>x!==dayIdx):[...days,dayIdx]);};
            return (
              <label key={d} className={`checkbox-item ${checked?'checked':''}`} style={{gridColumn:'1/-1'}}>
                <input type="checkbox" checked={checked} onChange={toggle} />
                <label>{d}</label>
              </label>
            );
          })}
        </div>
      </div>

      <div className="settings-section">
        <h3>🚫 Ignored Keywords</h3>
        <p>Add keywords or phrases to ignore. Messages containing these will be skipped.</p>
        <p style={{fontSize:11,color:'var(--text3)'}}>Examples: 'half close', 'partial close', 'close half', etc.</p>
        <div style={{marginBottom:4,fontSize:12,fontWeight:600,color:'var(--text2)'}}>Current Ignored Keywords:</div>
        <TagList items={s.ignoredKeywords||[]} onRemove={i=>removeFromArray('ignoredKeywords',i)} onAdd={v=>addToArray('ignoredKeywords',v)} placeholder="Enter keyword or phrase (e.g., 'half close')" />
      </div>

      <div className="settings-section">
        <h3>🚫 Excluded Trading Pairs</h3>
        <p>Add symbols to exclude. Signals for these pairs will be ignored until removed.</p>
        <p style={{fontSize:11,color:'var(--text3)'}}>Examples: 'GOLD', 'XAUUSD', 'XAUUSDm'</p>
        <div style={{marginBottom:4,fontSize:12,fontWeight:600,color:'var(--text2)'}}>Current Excluded Pairs:</div>
        <div style={{minHeight:80,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:8,marginBottom:8,display:'flex',flexWrap:'wrap',gap:6}}>
          {(s.excludedPairs||[]).map((p,i)=>(
            <span key={i} className="tag" style={{borderColor:'rgba(255,68,68,0.4)',color:'var(--sell)',background:'rgba(255,68,68,0.1)'}}>
              {p}<button className="tag-remove" style={{color:'var(--sell)'}} onClick={()=>removeFromArray('excludedPairs',i)}>×</button>
            </span>
          ))}
          {(s.excludedPairs||[]).length===0 && <span style={{color:'var(--text3)',fontSize:12}}>No excluded pairs</span>}
        </div>
        <div style={{display:'flex',gap:8}}>
          <ExcludePairInput onAdd={v=>addToArray('excludedPairs',v.toUpperCase())} />
        </div>
      </div>

      <div className="settings-section">
        <h3>🔢 Trade Volume Limits</h3>
        <div className="form-row">
          <div className="form-group"><label>Max Daily Trades</label><div className="number-input-wrap"><input type="number" value={s.maxDailyTrades||10} min={1} max={100} onChange={e=>set('maxDailyTrades',parseInt(e.target.value))} /></div></div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Looking for the spread limit? It moved to <strong>Guard → Execution Limits</strong> (&quot;Max spread (pips)&quot;) — one field, measured in pips.
        </div>
      </div>

      <div className="settings-section">
        <h3>📰 High-Impact News Protection</h3>
        <p>Block copy execution around high-impact macro releases.</p>
        <div className="toggle-row">
          <span className="toggle-label">Enable high-impact news copy guard</span>
          <Toggle checked={s.enableHighImpactNewsGuard !== false} onChange={v=>set('enableHighImpactNewsGuard',v)} />
        </div>
        {s.enableHighImpactNewsGuard !== false && (
          <div className="form-row" style={{ marginTop: 10 }}>
            <div className="form-group">
              <label>
                Block before high news (minutes){' '}
                <InfoTip text="Signals arriving this many minutes BEFORE a high-impact release (NFP, CPI, FOMC…) are blocked — prices whip around right before the number drops." />
              </label>
              <div className="number-input-wrap">
                <input type="number" value={s.highImpactNewsBlockBeforeMinutes ?? 30} min={0} max={240} onChange={e=>set('highImpactNewsBlockBeforeMinutes',parseInt(e.target.value)||0)} />
                <span className="number-input-unit">min</span>
              </div>
            </div>
            <div className="form-group">
              <label>
                Block after high news (minutes){' '}
                <InfoTip text="Keeps blocking for this many minutes AFTER the release while spreads are still wide and prices are erratic." />
              </label>
              <div className="number-input-wrap">
                <input type="number" value={s.highImpactNewsBlockAfterMinutes ?? 15} min={0} max={240} onChange={e=>set('highImpactNewsBlockAfterMinutes',parseInt(e.target.value)||0)} />
                <span className="number-input-unit">min</span>
              </div>
            </div>
            <div className="form-group">
              <label>
                Tag trades after news (minutes){' '}
                <InfoTip text="Purely informational: trades taken within this window after a release get a 'news was X min ago' note — they are not blocked." />
              </label>
              <div className="number-input-wrap">
                <input type="number" value={s.highImpactNewsTradeContextAfterMinutes ?? 120} min={0} max={480} onChange={e=>set('highImpactNewsTradeContextAfterMinutes',parseInt(e.target.value)||0)} />
                <span className="number-input-unit">min</span>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                After the block window ends, still show &quot;news was X min ago&quot; on trade details for this long.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
