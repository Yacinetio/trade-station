import React, { useState } from 'react';
import { TagList } from './SettingsFields.jsx';

function KeywordInput({ onAdd, color }) {
  const [val, setVal] = useState('');
  return (
    <>
      <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&val.trim()&&(onAdd(val.trim()),setVal(''))} placeholder="Enter keyword (supports emojis 📊)"
        style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',color:'var(--text)',fontSize:13,outline:'none'}} />
      <button onClick={()=>val.trim()&&(onAdd(val.trim()),setVal(''))} style={{padding:'8px 14px',background:color,border:'none',borderRadius:8,color:'#000',fontWeight:700,cursor:'pointer',fontSize:13}}>＋</button>
      <button onClick={()=>setVal('')} style={{padding:'8px 12px',background:'rgba(255,68,68,0.2)',border:'1px solid rgba(255,68,68,0.4)',borderRadius:8,color:'var(--danger)',cursor:'pointer',fontSize:16}}>🗑</button>
    </>
  );
}

function SymbolMappingTab({ s, set }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const mappings = s.symbolMappings || [];

  const addMapping = () => {
    if (!from.trim() || !to.trim()) return;
    // "from" is uppercased (signal text) but "to" preserves exact case (broker symbol, e.g. US100.cash)
    set('symbolMappings', [...mappings, { from: from.trim().toUpperCase(), to: to.trim() }]);
    setFrom(''); setTo('');
  };
  const remove = (i) => set('symbolMappings', mappings.filter((_,idx)=>idx!==i));

  return (
    <div className="settings-section">
      <h3>🔀 Custom Symbol Mappings</h3>
      <p>Map signal names to exact broker symbols (e.g., 'US100.CASH' → 'US100.cash').</p>
      <p style={{color:'var(--text3)',fontSize:11}}>⚠ The <strong>From</strong> field is case-insensitive. The <strong>To</strong> field preserves exact case as your broker requires it.</p>
      <div style={{minHeight:120,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:8,marginBottom:12}}>
        {mappings.length===0 && <div style={{color:'var(--text3)',fontSize:12,padding:8}}>No mappings defined yet</div>}
        {mappings.map((m,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',borderBottom:'1px solid var(--border)',fontSize:13}}>
            <span style={{color:'var(--text2)'}}>{m.from}</span>
            <span style={{color:'var(--accent)'}}>→</span>
            <span style={{color:'var(--text)',fontWeight:600}}>{m.to}</span>
            <button onClick={()=>remove(i)} style={{marginLeft:'auto',background:'none',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:14}}>🗑</button>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <input value={from} onChange={e=>setFrom(e.target.value)} placeholder="From signal (e.g., US100.CASH)"
          style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',color:'var(--text)',fontSize:13,outline:'none'}} />
        <span style={{color:'var(--accent)',fontSize:18}}>→</span>
        <input value={to} onChange={e=>setTo(e.target.value)} placeholder="Broker exact (e.g., US100.cash)"
          style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',color:'var(--text)',fontSize:13,outline:'none'}} />
        <button onClick={addMapping} style={{padding:'8px 14px',background:'var(--accent)',border:'none',borderRadius:8,color:'#000',fontWeight:700,cursor:'pointer'}}>＋</button>
        <button onClick={()=>remove(mappings.length-1)} style={{padding:'8px 12px',background:'rgba(255,68,68,0.2)',border:'1px solid rgba(255,68,68,0.4)',borderRadius:8,color:'var(--danger)',cursor:'pointer',fontSize:16}}>🗑</button>
      </div>
    </div>
  );
}

export default function KeywordsTab({ s, set, setNested, addToArray, removeFromArray }) {
  const [subTab, setSubTab] = useState('general');

  const addKw = (type, val) => {
    const list = s.customKeywords?.[type] || [];
    if (!list.includes(val)) setNested('customKeywords', type, [...list, val]);
  };
  const removeKw = (type, i) => setNested('customKeywords', type, (s.customKeywords?.[type]||[]).filter((_,idx)=>idx!==i));

  return (
    <>
      <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'1px solid var(--border)',paddingBottom:0}}>
        {['general','mapping','close'].map(st=>(
          <button key={st} onClick={()=>setSubTab(st)}
            style={{padding:'8px 16px',background:'none',border:'none',borderBottom:`2px solid ${subTab===st?'var(--accent)':'transparent'}`,color:subTab===st?'var(--accent)':'var(--text2)',cursor:'pointer',fontSize:13,fontWeight:subTab===st?600:400}}>
            {st==='general'?'General':st==='mapping'?'Symbol Mapping':'Trade Management'}
          </button>
        ))}
      </div>

      {subTab === 'general' && (
        <>
          <div style={{background:'rgba(0,229,255,0.05)',border:'1px solid rgba(0,229,255,0.15)',borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:12,color:'var(--text2)'}}>
            🎯 <strong style={{color:'var(--accent)'}}>Custom Keywords for Signal Parsing</strong><br/>
            Add your own keywords to recognize trading signals. Supports emojis! 📈📉<br/>
            The parser will use these in addition to the default keywords.
          </div>

          {[
            {key:'buy',label:'📈 BUY Signal Keywords',desc:"Keywords that indicate a BUY signal (e.g., 'LONG', '📈', 'CALL', 'BULLISH')",color:'var(--buy)'},
            {key:'sell',label:'📉 SELL Signal Keywords',desc:"Keywords that indicate a SELL signal (e.g., 'SHORT', '📉', 'PUT', 'BEARISH')",color:'var(--sell)'},
            {key:'entryMarket',label:'⚡ ENTRY Keywords (Market Orders)',desc:"Keywords for immediate market execution (e.g., 'NOW', 'MARKET', 'INSTANT')",color:'var(--accent)'},
            {key:'entryPending',label:'⏳ ENTRY Keywords (Pending Orders)',desc:"Keywords for pending/limit orders (e.g., 'OPEN AT', 'ENTER', 'ZONE', '@')",color:'var(--warning)'},
            {key:'sl',label:'🔴 STOP LOSS Keywords',desc:"Keywords that indicate stop loss (e.g., 'STOP', '🔴', 'SL', 'STOPLOSS')",color:'var(--danger)'},
            {key:'tp',label:'✅ TAKE PROFIT Keywords',desc:"Keywords that indicate take profit (e.g., 'TARGET', '✅', 'PROFIT', 'TP')",color:'var(--success)'},
          ].map(({key,label,desc,color})=>(
            <div key={key} className="settings-section">
              <h3>{label}</h3>
              <p>{desc}</p>
              <div style={{minHeight:60,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:8,marginBottom:8,display:'flex',flexWrap:'wrap',gap:6}}>
                {(s.customKeywords?.[key]||[]).map((w,i)=>(
                  <span key={i} className="tag" style={{borderColor:`${color}44`,color,background:`${color}18`}}>
                    {w}<button className="tag-remove" style={{color}} onClick={()=>removeKw(key,i)}>×</button>
                  </span>
                ))}
                {!(s.customKeywords?.[key]?.length) && <span style={{color:'var(--text3)',fontSize:12}}>No custom keywords</span>}
              </div>
              <div style={{display:'flex',gap:8}}>
                <KeywordInput color={color} onAdd={v=>addKw(key,v)} />
              </div>
            </div>
          ))}
        </>
      )}

      {subTab === 'mapping' && (
        <SymbolMappingTab s={s} set={set} />
      )}

      {subTab === 'close' && (
        <>
          <div className="settings-section">
            <h3>🔒 Close Trade Keywords</h3>
            <p>Keywords that trigger closing open trades (e.g., 'CLOSE', 'EXIT', 'TAKE PROFIT ALL')</p>
            <TagList items={s.closeKeywords||[]} onRemove={i=>removeFromArray('closeKeywords',i)} onAdd={v=>addToArray('closeKeywords',v)} placeholder="Enter close keyword (e.g., 'CLOSE ALL')" />
          </div>

          <div className="settings-section">
            <h3>✂️ Partial Close Keywords</h3>
            <p>Keywords that close part of open trades (e.g., 'CLOSE HALF', 'PARTIALS', 'SECURE'). If the message contains a percent like "30%", that is used; otherwise the default below applies.</p>
            <TagList items={s.partialCloseKeywords||[]} onRemove={i=>removeFromArray('partialCloseKeywords',i)} onAdd={v=>addToArray('partialCloseKeywords',v)} placeholder="Enter partial-close keyword (e.g., 'CLOSE HALF')" />
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:12}}>
              <label style={{fontSize:13,color:'var(--text2)'}}>Default close percent</label>
              <input
                type="number" min={1} max={95} step={5}
                value={s.partialClosePercentDefault ?? 50}
                onChange={e=>set('partialClosePercentDefault', Math.min(95, Math.max(1, Number(e.target.value)||50)))}
                style={{width:80,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 10px',color:'var(--text)',fontSize:13,outline:'none'}}
              />
              <span style={{fontSize:13,color:'var(--text3)'}}>%</span>
            </div>
          </div>

          <div className="settings-section">
            <h3>🛡️ Break-Even Keywords</h3>
            <p>Keywords that move the stop loss to each position's entry price (e.g., 'BE', 'BREAKEVEN', 'SL TO ENTRY'). Applies to this channel's open trades; add a symbol in the message to narrow the scope.</p>
            <TagList items={s.breakEvenKeywords||[]} onRemove={i=>removeFromArray('breakEvenKeywords',i)} onAdd={v=>addToArray('breakEvenKeywords',v)} placeholder="Enter break-even keyword (e.g., 'BREAKEVEN')" />
          </div>
        </>
      )}
    </>
  );
}
