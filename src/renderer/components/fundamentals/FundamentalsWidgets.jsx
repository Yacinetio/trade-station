import React, { useMemo } from 'react';
import { Building2, Users, ArrowRight, Clock, TrendingUp, TrendingDown, Minus, Zap, Download, AlertTriangle, ExternalLink } from 'lucide-react';
import { tradeIsClosed } from '../../utils/tradeStatus.js';

function fmtPct(value, suffix = '%') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}${suffix}`;
}

function smartBiasLabel(pack) {
  if (!pack) return { label: 'No data', tone: 'neutral', icon: Minus };
  const s = Number(pack.specScore);
  if (s >= 22 || String(pack.specStance || '').includes('LONG')) {
    return { label: 'Net long', tone: 'bull', icon: TrendingUp };
  }
  if (s <= -22 || String(pack.specStance || '').includes('SHORT')) {
    return { label: 'Net short', tone: 'bear', icon: TrendingDown };
  }
  return { label: 'Neutral', tone: 'neutral', icon: Minus };
}

function retailZone(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return { label: 'Unknown', tone: 'neutral', hint: 'No retail split in report.' };
  if (p >= 65) return { label: 'Crowded long', tone: 'bear', hint: 'Retail heavily long — contrarian fade bias.' };
  if (p <= 35) return { label: 'Crowded short', tone: 'bull', hint: 'Retail heavily short — squeeze risk.' };
  return { label: 'Balanced', tone: 'neutral', hint: 'No extreme retail positioning.' };
}

export function headlineSurpriseBadge(row) {
  const actual = row?.actual;
  const forecast = row?.forecast;
  const surprise = Number(row?.surprise);
  if (actual == null && !Number.isFinite(surprise)) return null;
  if (!Number.isFinite(surprise)) {
    if (actual != null && forecast != null && Number.isFinite(Number(actual)) && Number.isFinite(Number(forecast))) {
      const delta = Number(actual) - Number(forecast);
      if (Math.abs(delta) < 1e-9) return { label: 'Inline', tone: 'neutral' };
      return delta > 0 ? { label: 'Beat', tone: 'bull' } : { label: 'Miss', tone: 'bear' };
    }
    return null;
  }
  if (Math.abs(surprise) < 2) return { label: 'Inline', tone: 'neutral' };
  return surprise > 0 ? { label: 'Beat', tone: 'bull' } : { label: 'Miss', tone: 'bear' };
}

export function FundSessionTimeline({ sessionIntel }) {
  const sessions = Array.isArray(sessionIntel?.sessions) ? sessionIntel.sessions : [];
  const utcHour = Number(sessionIntel?.utcHour);
  if (sessions.length === 0) return null;

  const markerPct = Number.isFinite(utcHour) ? (utcHour / 24) * 100 : 50;

  return (
    <div className="fund-session-timeline animate-enter">
      <div className="fund-session-timeline-head">
        <strong>Session clock (UTC)</strong>
        <span>{sessionIntel?.activeSession?.replace(/_/g, ' ') || '—'}</span>
        {sessionIntel?.overlap ? <span className="fund-session-overlap-pill">London × NY overlap</span> : null}
      </div>
      <div className="fund-session-timeline-track">
        {sessions.filter((s) => s.id !== 'overlap').map((sess) => {
          const left = (sess.startUtc / 24) * 100;
          const width = ((sess.endUtc - sess.startUtc) / 24) * 100;
          return (
            <div
              key={sess.id}
              className={`fund-session-band fund-session-band--${sess.id} ${sess.active ? 'active' : ''}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${sess.label} ${sess.startUtc}:00–${sess.endUtc}:00 UTC`}
            >
              <span>{sess.label}</span>
            </div>
          );
        })}
        <div className="fund-session-now-marker" style={{ left: `${markerPct}%` }} title="Now (UTC)" />
      </div>
      <div className="fund-session-timeline-meta">
        <span>Liquidity {sessionIntel?.liquidityScore ?? '—'}</span>
        <span>Edge {sessionIntel?.edgeScore ?? '—'}</span>
        <span>{sessionIntel?.highImpactNext4h ?? 0} high-impact in 4h</span>
      </div>
    </div>
  );
}

export function FundCotSpecSparkline({ series = [], label = 'Net spec (8w)' }) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const values = series.map((r) => Number(r.netSpec)).filter(Number.isFinite);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return (
    <div className="fund-cot-sparkline-wrap">
      <div className="fund-cot-sparkline-head">
        <strong>{label}</strong>
        <span className={values[values.length - 1] >= 0 ? 'pos' : 'neg'}>
          {values[values.length - 1]?.toLocaleString?.() ?? values[values.length - 1]}
        </span>
      </div>
      <div className="fund-cot-sparkline">
        {series.map((row) => {
          const v = Number(row.netSpec);
          const h = Math.max(12, Math.min(100, ((v - min) / range) * 100));
          return (
            <div
              key={row.date}
              className={`fund-cot-spark-bar ${v >= 0 ? 'pos' : 'neg'}`}
              style={{ height: `${h}%` }}
              title={`${row.date}: ${v.toLocaleString()} net`}
            />
          );
        })}
      </div>
      <div className="fund-cot-sparkline-dates">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function FundRetailCrowdedAlerts({ alerts = [] }) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  return (
    <div className="fund-retail-alerts animate-enter-fast">
      <AlertTriangle size={14} />
      <div className="fund-retail-alerts-body">
        <strong>Retail crowded long (≥70%)</strong>
        {alerts.map((a) => (
          <span key={a.currency} className="fund-retail-alert-chip">
            {a.currency} {a.retailLongPct}% L
          </span>
        ))}
      </div>
    </div>
  );
}

export function FundPositionExposure({ trades = [], sentiment, selectedPairLabel }) {
  const openTrades = useMemo(() => {
    return (Array.isArray(trades) ? trades : []).filter((t) => !tradeIsClosed(t));
  }, [trades]);

  const vix = Number(sentiment?.vix);
  const fg = Number(sentiment?.fearGreed?.value);
  const regime = String(sentiment?.regime || 'NEUTRAL');

  const rows = useMemo(() => {
    return openTrades.slice(0, 12).map((t) => {
      const sym = String(t.symbol || '').toUpperCase();
      let exposureNote = 'Neutral macro read';
      let tone = 'neutral';
      if (Number.isFinite(vix) && vix >= 22) {
        exposureNote = 'Elevated VIX — widen stops / reduce size';
        tone = 'warn';
      }
      if (Number.isFinite(fg) && fg >= 75 && String(t.type || '').toUpperCase().includes('BUY')) {
        exposureNote = 'Extreme greed — longs face fade risk';
        tone = 'bear';
      }
      if (Number.isFinite(fg) && fg <= 25 && String(t.type || '').toUpperCase().includes('SELL')) {
        exposureNote = 'Extreme fear — shorts face squeeze risk';
        tone = 'bull';
      }
      if (regime.includes('RISK_OFF') && String(t.type || '').toUpperCase().includes('BUY')) {
        exposureNote = 'Risk-off regime vs long exposure';
        tone = 'warn';
      }
      return { id: t.id, symbol: sym, type: t.type, exposureNote, tone };
    });
  }, [openTrades, vix, fg, regime]);

  return (
    <div className="fund-panel">
      <div className="fund-panel-header">
        <h3>Open positions vs sentiment</h3>
        <span className="fund-focus-chip">{openTrades.length} live</span>
      </div>
      {rows.length === 0 ? (
        <div className="fund-empty-inline">No open trades — macro sentiment read applies to {selectedPairLabel || 'selected pair'} only.</div>
      ) : (
        <div className="fund-position-exposure-list">
          {rows.map((row) => (
            <div key={row.id} className={`fund-position-exposure-row tone-${row.tone}`}>
              <span className="fund-position-exposure-sym">{row.symbol} {row.type}</span>
              <span>{row.exposureNote}</span>
            </div>
          ))}
        </div>
      )}
      {sentiment?.vixTerm && (
        <div className="fund-empty-inline" style={{ marginTop: 8 }}>
          VIX term: {sentiment.vixTerm.label} (spot {sentiment.vixTerm.vix}, 3M {sentiment.vixTerm.vix3m})
        </div>
      )}
    </div>
  );
}

function downloadSnapshot(data) {
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fundamentals-snapshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function FundOverviewPulse({
  data,
  cotPositioning,
  selectedPairLabel,
  calendarEvents = [],
  scoreModules = [],
  sessionIntel,
  onGoPositioning,
  onOpenTradesForEvent
}) {
  const breadth = data?.overview?.breadth || { up: 0, down: 0, total: 0 };
  const breadthPct = breadth.total > 0 ? Math.round((breadth.up / breadth.total) * 100) : 50;

  const topDrivers = useMemo(() => {
    return [...scoreModules]
      .sort((a, b) => Math.abs(Number(b.score) * Number(b.weight)) - Math.abs(Number(a.score) * Number(a.weight)))
      .slice(0, 3);
  }, [scoreModules]);

  const imminentEvents = useMemo(() => {
    return (calendarEvents || [])
      .filter((e) => Number(e?.impact) >= 3 && Number(e?.minutesToEvent) >= 0 && Number(e?.minutesToEvent) <= 240)
      .sort((a, b) => Number(a.minutesToEvent) - Number(b.minutesToEvent))
      .slice(0, 4);
  }, [calendarEvents]);

  const base = cotPositioning?.base;
  const smart = smartBiasLabel(base);
  const retail = retailZone(base?.retailLongPct);
  const SmartIcon = smart.icon;

  return (
    <div className="fund-overview-pulse animate-enter">
      <FundSessionTimeline sessionIntel={sessionIntel} />
      <div className="fund-overview-pulse-card">
        <div className="fund-overview-pulse-head">
          <strong>Positioning snapshot</strong>
          <span>{selectedPairLabel}</span>
          {typeof onGoPositioning === 'function' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onGoPositioning}>
              Full map <ArrowRight size={12} />
            </button>
          )}
        </div>
        {cotPositioning?.available ? (
          <div className="fund-overview-pos-grid">
            <div className={`fund-overview-pos-cell fund-overview-pos-cell--smart tone-${smart.tone}`}>
              <Building2 size={14} />
              <span className="fund-overview-pos-kicker">Smart money</span>
              <span className="fund-overview-pos-value"><SmartIcon size={14} /> {smart.label}</span>
              <span className="fund-overview-pos-sub">
                {base?.netSpec?.toLocaleString?.() ?? '—'} net · {base?.specStance?.replace(/_/g, ' ') || '—'}
              </span>
            </div>
            <div className={`fund-overview-pos-cell fund-overview-pos-cell--retail tone-${retail.tone}`}>
              <Users size={14} />
              <span className="fund-overview-pos-kicker">Retail crowd</span>
              <span className="fund-overview-pos-value">{base?.retailLongPct ?? '—'}% long</span>
              <span className="fund-overview-pos-sub">{retail.label}</span>
            </div>
            {cotPositioning.divergence && (
              <div className="fund-overview-pos-cell fund-overview-pos-cell--alert">
                <Zap size={14} />
                <span className="fund-overview-pos-kicker">Divergence</span>
                <span className="fund-overview-pos-value">{cotPositioning.divergence.label}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="fund-empty-inline">{cotPositioning?.reason || 'Select a major FX pair for COT positioning.'}</div>
        )}
      </div>

      <div className="fund-overview-pulse-card">
        <div className="fund-overview-pulse-head"><strong>Market breadth</strong><span>{breadth.up}↑ / {breadth.down}↓</span></div>
        <div className="fund-breadth-bar">
          <div className="fund-breadth-bar-bull" style={{ width: `${breadthPct}%` }} />
          <div className="fund-breadth-bar-bear" style={{ width: `${100 - breadthPct}%` }} />
        </div>
        <div className="fund-breadth-labels">
          <span className="pos">{breadthPct}% bullish</span>
          <span className="neg">{100 - breadthPct}% bearish</span>
        </div>
      </div>

      <div className="fund-overview-pulse-card">
        <div className="fund-overview-pulse-head"><strong>Top score drivers</strong></div>
        {topDrivers.length === 0 ? (
          <div className="fund-empty-inline">No score modules.</div>
        ) : (
          <div className="fund-driver-list">
            {topDrivers.map((m) => (
              <div key={m.key || m.name} className="fund-driver-row">
                <span>{m.name}</span>
                <span className={Number(m.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(m.score, '')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fund-overview-pulse-card">
        <div className="fund-overview-pulse-head"><strong>High-impact soon</strong><Clock size={13} /></div>
        {imminentEvents.length === 0 ? (
          <div className="fund-empty-inline">No high-impact events in the next 4 hours.</div>
        ) : (
          <div className="fund-imminent-pills">
            {imminentEvents.map((evt) => {
              const mins = Number(evt.minutesToEvent);
              const urgent = mins <= 30;
              return (
                <span key={evt.id} className="fund-imminent-pill-wrap">
                  <span className={`fund-imminent-pill ${urgent ? 'fund-imminent-pill--urgent' : ''}`} title={evt.title}>
                    {evt.country} · {mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}
                  </span>
                  {typeof onOpenTradesForEvent === 'function' && (
                    <button
                      type="button"
                      className="fund-imminent-trades-btn"
                      title="View trades on this day"
                      onClick={() => onOpenTradesForEvent(evt)}
                    >
                      <ExternalLink size={11} /> Trades
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function FundPositioningLegend() {
  return (
    <div className="fund-cot-legend">
      <div className="fund-cot-legend-item">
        <Building2 size={13} />
        <div>
          <strong>Smart money</strong>
          <span>CFTC &quot;Managed Money&quot; — hedge funds &amp; large speculators. Net long = institutions support that currency.</span>
        </div>
      </div>
      <div className="fund-cot-legend-item">
        <Users size={13} />
        <div>
          <strong>Retail crowd</strong>
          <span>CFTC &quot;Non-reportable&quot; — small traders. Extreme long % often fades; extreme short % = squeeze risk.</span>
        </div>
      </div>
    </div>
  );
}

export function FundPositioningMap({ cotPositioning, selectedPairLabel }) {
  if (!cotPositioning?.available) return null;
  const base = cotPositioning.base;
  const quote = cotPositioning.quote;
  const baseSmart = smartBiasLabel(base);
  const baseRetail = retailZone(base?.retailLongPct);
  const quoteSmart = quote?.currency !== 'USD' ? smartBiasLabel(quote) : null;
  const quoteRetail = quote?.currency !== 'USD' ? retailZone(quote?.retailLongPct) : null;

  return (
    <div className="fund-positioning-map">
      <div className="fund-positioning-map-head">
        <h4>{selectedPairLabel} — who holds what</h4>
        <span className={`fund-positioning-map-bias tone-${cotPositioning.traderGuide?.verdictTone || 'neutral'}`}>
          {cotPositioning.traderGuide?.verdictLabel || cotPositioning.stance?.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="fund-positioning-map-grid">
        <div className="fund-positioning-map-col">
          <div className="fund-positioning-map-ccy">{base?.currency || 'Base'} <small>base leg</small></div>
          <div className={`fund-positioning-map-row smart tone-${baseSmart.tone}`}>
            <Building2 size={13} /> Smart: <strong>{baseSmart.label}</strong>
            <span>{base?.specPercentile != null ? `${base.specPercentile.toFixed(0)}th pct` : fmtPct(base?.specScore, '')}</span>
          </div>
          <div className={`fund-positioning-map-row retail tone-${baseRetail.tone}`}>
            <Users size={13} /> Retail: <strong>{baseRetail.label}</strong>
            <span>{base?.retailLongPct ?? '—'}% long</span>
          </div>
        </div>
        {quote && quote.currency !== 'USD' && (
          <div className="fund-positioning-map-col">
            <div className="fund-positioning-map-ccy">{quote.currency} <small>quote leg</small></div>
            <div className={`fund-positioning-map-row smart tone-${quoteSmart.tone}`}>
              <Building2 size={13} /> Smart: <strong>{quoteSmart.label}</strong>
              <span>{quote.specPercentile != null ? `${quote.specPercentile.toFixed(0)}th pct` : fmtPct(quote.specScore, '')}</span>
            </div>
            <div className={`fund-positioning-map-row retail tone-${quoteRetail.tone}`}>
              <Users size={13} /> Retail: <strong>{quoteRetail.label}</strong>
              <span>{quote.retailLongPct ?? '—'}% long</span>
            </div>
          </div>
        )}
        {quote?.currency === 'USD' && (
          <div className="fund-positioning-map-col fund-positioning-map-col--note">
            <div className="fund-positioning-map-ccy">USD</div>
            <p>COT &quot;USD&quot; is the dollar-index future — use the <strong>base currency</strong> leg for {selectedPairLabel} direction.</p>
          </div>
        )}
      </div>
      <div className="fund-positioning-map-foot">
        <span>Pair score {fmtPct(cotPositioning.pairScore, '')}</span>
        <span>Report {cotPositioning.reportDate || '—'}</span>
        <span>{cotPositioning.scoreMode === 'percentile' ? '52-week percentile mode' : 'Cross-section mode (limited history)'}</span>
      </div>
    </div>
  );
}

export function FundSmartRetailCard({ pack, side, currency, roleLabel }) {
  if (!pack) {
    return (
      <div className="fund-cot-side-card fund-cot-side-card--empty">
        <div className="fund-empty-inline">No CFTC data for {currency || 'this leg'}.</div>
      </div>
    );
  }
  const isSmart = side === 'smart';
  const smart = smartBiasLabel(pack);
  const retail = retailZone(pack.retailLongPct);
  const weeklyDelta = Number(pack.weeklySpecChange);
  const weeklyLabel = pack.historyLimited && weeklyDelta === 0 ? '—' : (weeklyDelta >= 0 ? `+${weeklyDelta.toLocaleString()}` : weeklyDelta.toLocaleString());
  const SmartIcon = smart.icon;

  return (
    <div className={`fund-cot-side-card fund-cot-side-card--${side}`}>
      <div className="fund-cot-side-head">
        {isSmart ? <Building2 size={14} /> : <Users size={14} />}
        <div>
          <strong>{isSmart ? 'Smart money' : 'Retail crowd'}</strong>
          <span>{currency} · {roleLabel}</span>
        </div>
      </div>
      {isSmart ? (
        <>
          <div className="fund-cot-gauge-wrap">
            <div className="fund-cot-gauge-label">
              <span>Historical net spec position</span>
              <strong className={smart.tone === 'bull' ? 'pos' : smart.tone === 'bear' ? 'neg' : ''}>
                {pack.specPercentile != null ? `${pack.specPercentile.toFixed(0)}th percentile` : 'Limited history'}
              </strong>
            </div>
            <div className="fund-cot-gauge-track">
              <div
                className={`fund-cot-gauge-fill ${Number(pack.specScore) >= 0 ? 'pos' : 'neg'} fund-cot-bar-animate`}
                style={{ width: `${pack.specPercentile != null ? Math.max(4, pack.specPercentile) : Math.max(4, Math.abs(Number(pack.specScore)))}%` }}
              />
              <div className="fund-cot-gauge-mid" aria-hidden />
            </div>
            <div className="fund-cot-gauge-ends"><span>Short extreme</span><span>Long extreme</span></div>
          </div>
          <div className="fund-cot-side-stat">
            <span>Net contracts</span>
            <strong className={pack.netSpec >= 0 ? 'pos' : 'neg'}>{pack.netSpec?.toLocaleString?.() ?? pack.netSpec}</strong>
          </div>
          <div className="fund-cot-side-stat">
            <span>Bias</span>
            <strong className={smart.tone === 'bull' ? 'pos' : smart.tone === 'bear' ? 'neg' : ''}>
              <SmartIcon size={12} /> {pack.specStance?.replace(/_/g, ' ') || smart.label}
            </strong>
          </div>
          <div className="fund-cot-side-stat">
            <span>Weekly Δ nets</span>
            <strong className={weeklyDelta >= 0 ? 'pos' : 'neg'}>{weeklyLabel}</strong>
          </div>
          <p className="fund-cot-side-caption">Managed money / large speculators (CFTC TFF)</p>
        </>
      ) : (
        <>
          <div className="fund-cot-retail-zones">
            <span className={pack.retailLongPct <= 35 ? 'active bull' : ''}>Short crowd</span>
            <span className={pack.retailLongPct > 35 && pack.retailLongPct < 65 ? 'active' : ''}>Balanced</span>
            <span className={pack.retailLongPct >= 65 ? 'active bear' : ''}>Long crowd</span>
          </div>
          <div className="fund-cot-side-stat fund-cot-side-stat--hero">
            <span>Retail long</span>
            <strong className={retail.tone === 'bear' ? 'neg' : retail.tone === 'bull' ? 'pos' : ''}>{pack.retailLongPct != null ? `${pack.retailLongPct}%` : '—'}</strong>
          </div>
          <div className="fund-cot-retail-bar fund-cot-retail-bar--large">
            <div className="fund-cot-retail-long fund-cot-bar-animate" style={{ width: `${pack.retailLongPct ?? 50}%` }} />
            <div className="fund-cot-retail-marker" style={{ left: '50%' }} title="50% balanced" />
          </div>
          <div className="fund-cot-chip-row">
            <span className={`fund-cot-chip fund-cot-chip--${String(pack.retailSignal || '').toLowerCase()}`}>{pack.retailSignal?.replace(/_/g, ' ') || retail.label}</span>
          </div>
          <p className="fund-cot-side-caption">{pack.retailHint || retail.hint}</p>
        </>
      )}
    </div>
  );
}

export function FundSentimentGauges({ sentiment }) {
  const fg = Number(sentiment?.fearGreed?.value);
  const fgLabel = sentiment?.fearGreed?.classification || '—';
  const fgTone = fg >= 75 ? 'bear' : fg <= 25 ? 'bull' : 'neutral';
  const regime = String(sentiment?.regime || 'NEUTRAL').replace(/_/g, ' ');
  const vixTerm = sentiment?.vixTerm;

  return (
    <div className="fund-sentiment-gauges">
      <div className="fund-sentiment-gauge-card">
        <div className="fund-sentiment-gauge-head"><strong>Fear &amp; Greed</strong><span>{fgLabel}</span></div>
        <div className="fund-fg-gauge">
          <div className="fund-fg-gauge-fill" style={{ width: `${Number.isFinite(fg) ? fg : 50}%` }} />
          <div className={`fund-fg-gauge-marker tone-${fgTone}`} style={{ left: `${Number.isFinite(fg) ? fg : 50}%` }} />
        </div>
        <div className="fund-fg-gauge-labels"><span>Fear</span><span>{Number.isFinite(fg) ? fg : '—'}</span><span>Greed</span></div>
      </div>
      {vixTerm && (
        <div className={`fund-vix-term-card tone-${vixTerm.tone || 'neutral'}`}>
          <div className="fund-sentiment-gauge-head"><strong>VIX term structure</strong><span>{vixTerm.label}</span></div>
          <div className="fund-vix-term-row">
            <span>Spot <strong>{vixTerm.vix}</strong></span>
            <span>3M <strong>{vixTerm.vix3m}</strong></span>
            <span className={Number(vixTerm.spread) > 0 ? 'neg' : 'pos'}>Spread {fmtPct(vixTerm.spread, '')}</span>
          </div>
        </div>
      )}
      <div className="fund-sentiment-tiles">
        <div className="fund-sentiment-tile">
          <span>Regime</span>
          <strong>{regime}</strong>
        </div>
        <div className="fund-sentiment-tile">
          <span>Cross-asset</span>
          <strong className={Number(sentiment?.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(sentiment?.score, '')}</strong>
        </div>
        <div className="fund-sentiment-tile">
          <span>VIX</span>
          <strong>{sentiment?.vix ?? '—'}</strong>
        </div>
        <div className="fund-sentiment-tile">
          <span>DXY Δ</span>
          <strong className={Number(sentiment?.dxyChange) >= 0 ? 'pos' : 'neg'}>{fmtPct(sentiment?.dxyChange)}</strong>
        </div>
        <div className="fund-sentiment-tile">
          <span>Vol regime</span>
          <strong>{sentiment?.volatilityRegime || '—'}</strong>
        </div>
      </div>
    </div>
  );
}

export function FundHeadlineImminentRow({ items = [], onBatchAnalyze, batchAnalyzing = false }) {
  const upcoming = useMemo(() => {
    return items
      .filter((r) => r.headlineFeedKind === 'UPCOMING' && Number(r.minutesToEvent) >= 0 && Number(r.minutesToEvent) <= 180)
      .sort((a, b) => Number(a.minutesToEvent) - Number(b.minutesToEvent))
      .slice(0, 6);
  }, [items]);

  if (upcoming.length === 0 && !onBatchAnalyze) return null;

  return (
    <div className="fund-headline-imminent animate-enter">
      <Clock size={14} />
      <span className="fund-headline-imminent-label">Releases soon</span>
      {upcoming.map((row) => {
        const mins = Number(row.minutesToEvent);
        const urgent = mins <= 30;
        return (
          <button
            key={`imm-${row.id}`}
            type="button"
            className={`fund-imminent-pill fund-imminent-pill--btn ${urgent ? 'fund-imminent-pill--urgent' : ''}`}
            title={row.title}
          >
            {row.country} {row.category || 'Data'} · {mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}
          </button>
        );
      })}
      {typeof onBatchAnalyze === 'function' && (
        <button type="button" className="btn btn-outline btn-sm fund-headline-batch-ai" onClick={onBatchAnalyze} disabled={batchAnalyzing}>
          <Zap size={12} /> {batchAnalyzing ? 'Analyzing…' : 'AI: top 5 released'}
        </button>
      )}
    </div>
  );
}

export function HeadlineSurpriseBadge({ row }) {
  const badge = headlineSurpriseBadge(row);
  if (!badge) return null;
  return <span className={`fund-surprise-badge tone-${badge.tone}`}>{badge.label}</span>;
}

export function FundFeedsHealth({ sources = [], providerHealth = [], sentiment, generatedAt, snapshotData }) {
  const healthById = useMemo(() => {
    const map = {};
    for (const row of providerHealth || []) map[row.id] = row;
    return map;
  }, [providerHealth]);

  const fgHist = Array.isArray(sentiment?.fearGreedHistory) ? sentiment.fearGreedHistory : [];
  const spark = fgHist.slice(0, 14).reverse();

  const statusClass = (status) => {
    if (status === 'error') return 'error';
    if (status === 'stale') return 'stale';
    return 'ok';
  };

  return (
    <div className="fund-feeds-health">
      <div className="fund-feeds-health-toolbar">
        <strong>Data providers</strong>
        {snapshotData && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadSnapshot(snapshotData)}>
            <Download size={12} /> Export JSON
          </button>
        )}
      </div>
      <div className="fund-feeds-health-grid">
        {sources.map((src) => {
          const health = healthById[src.id];
          const status = health?.status || 'ok';
          return (
            <div key={src.id} className={`fund-feeds-health-chip status-${statusClass(status)}`}>
              <span className={`fund-feeds-health-dot status-${statusClass(status)}`} />
              <div>
                <strong>{src.label}</strong>
                <span>{src.type}{status !== 'ok' ? ` · ${status}` : ''}</span>
                {health?.error && <span className="fund-feeds-health-err" title={health.error}>{health.error}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {spark.length > 1 && (
        <div className="fund-fg-sparkline-wrap">
          <span>Fear/Greed (14d)</span>
          <div className="fund-fg-sparkline">
            {spark.map((row, i) => (
              <div
                key={row.timestamp || i}
                className="fund-fg-spark-bar"
                style={{ height: `${Math.max(8, Math.min(100, Number(row.value) || 50))}%` }}
                title={`${row.value} ${row.classification || ''}`}
              />
            ))}
          </div>
        </div>
      )}
      {generatedAt && (
        <div className="fund-feeds-health-meta">Dashboard generated {new Date(generatedAt).toLocaleString()}</div>
      )}
    </div>
  );
}
