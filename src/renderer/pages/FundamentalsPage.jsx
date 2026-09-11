import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Landmark, RefreshCw, AlertTriangle, Filter, Search, Sparkles, TrendingUp, Users, BarChart3, Activity, Building2, Target } from 'lucide-react';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import {
  FundOverviewPulse,
  FundPositioningLegend,
  FundPositioningMap,
  FundSmartRetailCard,
  FundSentimentGauges,
  FundHeadlineImminentRow,
  FundFeedsHealth,
  FundSessionTimeline,
  FundCotSpecSparkline,
  FundRetailCrowdedAlerts,
  FundPositionExposure,
  HeadlineSurpriseBadge
} from '../components/fundamentals/FundamentalsWidgets.jsx';

function scoreTone(score) {
  const s = Number(score || 0);
  if (s >= 30) return 'pos';
  if (s <= -30) return 'neg';
  return 'neutral';
}

function fmtPct(value, suffix = '%') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}${suffix}`;
}

function fmtCompactUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtCountdown(minutesToEvent) {
  const m = Number(minutesToEvent);
  if (!Number.isFinite(m)) return '—';
  if (m < 0) return `${Math.abs(Math.round(m))}m ago`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem}m`;
}

/** MRKT-style: local clock + relative ETA (e.g. `8:58:05 AM • 5h ago`). */
function fmtHeadlineTimeRow(row) {
  const m = Number(row?.minutesToEvent);
  const t = row?.time;
  let clock = '';
  if (t) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) {
      clock = d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
  }
  let rel = '';
  if (Number.isFinite(m)) {
    if (m < 0) rel = fmtCountdown(m);
    else rel = Number(m) === 0 ? 'now' : `in ${fmtCountdown(m)}`;
  }
  if (clock && rel) return `${clock} • ${rel}`;
  if (clock) return clock;
  return rel || '—';
}

function compactTicker(sym) {
  return String(sym || '')
    .replace(/\s+/g, '')
    .split('/')
    .join('')
    .replace(/=+$/i, '')
    .toUpperCase();
}

function buildAiBiasMap(pairs) {
  const m = new Map();
  for (const p of pairs || []) {
    const k = compactTicker(p.symbol);
    const b = String(p.bias || '').toLowerCase();
    if (k && (b === 'bullish' || b === 'bearish' || b === 'neutral')) m.set(k, b);
  }
  return m;
}

/** Feed is newest-first; prior releases are older rows (higher index). */
function priorHeadlinesPayload(allItems, focusId, maxPrior = 10) {
  const ix = allItems.findIndex((h) => h.id === focusId);
  if (ix < 0) return [];
  const older = allItems.slice(ix + 1, ix + 1 + maxPrior);
  return [...older].reverse().map((h) => ({
    title: h.title,
    country: h.country,
    surprise: h.surprise,
    category: h.category
  }));
}

function pillClassForAsset(asset, aiBiasMap) {
  const symKey = compactTicker(asset.symbol);
  let bullish = false;
  let bearish = false;
  let neutral = false;
  if (aiBiasMap && aiBiasMap.has(symKey)) {
    const b = aiBiasMap.get(symKey);
    if (b === 'bullish') bullish = true;
    else if (b === 'bearish') bearish = true;
    else neutral = true;
  } else {
    const d = String(asset.direction || '').toUpperCase();
    bullish = d === 'BULLISH';
    bearish = d === 'BEARISH';
    neutral = d === 'NEUTRAL' || (!bullish && !bearish);
  }
  if (bullish) return 'fund-mrkt-pill--up';
  if (bearish) return 'fund-mrkt-pill--down';
  if (neutral && aiBiasMap?.has(symKey)) return 'fund-mrkt-pill--silver';
  return 'fund-mrkt-pill--flat';
}

function pillArrowForAsset(asset, aiBiasMap) {
  const symKey = compactTicker(asset.symbol);
  if (aiBiasMap?.has(symKey)) {
    const b = aiBiasMap.get(symKey);
    if (b === 'bullish') return '↑';
    if (b === 'bearish') return '↓';
    return '·';
  }
  const d = String(asset.direction || '').toUpperCase();
  if (d === 'BULLISH') return '↑';
  if (d === 'BEARISH') return '↓';
  return '·';
}

/** Defensive impact tier (cached rows may use strings). */
function rowImpactTier(row) {
  const n = Number(row?.impact);
  if (n === 3 || n === 2 || n === 1) return n;
  const t = String(row?.impact ?? '').toLowerCase();
  if (t.includes('high')) return 3;
  if (t.includes('medium')) return 2;
  return 1;
}

function impactBadge(impact) {
  if (impact >= 3) return 'HIGH';
  if (impact >= 2) return 'MED';
  return 'LOW';
}

function dirClass(direction) {
  const d = String(direction || '').toUpperCase();
  if (d === 'BULLISH') return 'bullish';
  if (d === 'BEARISH') return 'bearish';
  return 'neutral';
}

export default function FundamentalsPage({
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  trades = [],
  setTimeScope,
  setAnalyticsCustomRange,
  onNavigateToTrades
}) {
  const latestRequestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [assetFilter, setAssetFilter] = useState('ALL');
  const [impactFilter, setImpactFilter] = useState('ALL');
  const [selectedPair, setSelectedPair] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [sentimentPairFilter, setSentimentPairFilter] = useState('ALL');
  const [headlineMode, setHeadlineMode] = useState('ALL');
  const [headlineImpactFilter, setHeadlineImpactFilter] = useState('ALL');
  const [headlineAssetFilter, setHeadlineAssetFilter] = useState('ALL');
  const [headlineSearch, setHeadlineSearch] = useState('');
  const [showHeadlineFilters, setShowHeadlineFilters] = useState(false);
  const [selectedHeadlineId, setSelectedHeadlineId] = useState('');
  const [headlineAiById, setHeadlineAiById] = useState({});
  const [batchHeadlineAiRunning, setBatchHeadlineAiRunning] = useState(false);

  const [retryCountdown, setRetryCountdown] = useState(0);

  const fetchDashboard = async (forceRefresh = false, pairOverride = null) => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const requestedPair = String((pairOverride ?? selectedPair) || '').trim();
      const payload = await window.electronAPI?.getFundamentalsDashboard?.({
        forceRefresh,
        selectedPair: requestedPair || undefined
      });
      if (requestId !== latestRequestRef.current) return;
      setData(payload || null);
      if (payload?.unavailable) {
        setError(payload?.unavailableReason || 'Real providers unavailable.');
      }
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setError(err?.message || 'Failed to load fundamentals data.');
    } finally {
      if (requestId !== latestRequestRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!error || refreshing) {
      setRetryCountdown(0);
      return undefined;
    }
    setRetryCountdown(60);
    const tick = setInterval(() => {
      setRetryCountdown((n) => {
        if (n <= 1) {
          fetchDashboard(true);
          return 60;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, refreshing]);

  useEffect(() => {
    const gen = data?.headlineIntel?.generatedAt;
    if (gen) setHeadlineAiById({});
  }, [data?.headlineIntel?.generatedAt]);

  useEffect(() => {
    fetchDashboard(false, '');
  }, []);

  const screenerRows = Array.isArray(data?.screener?.rows) ? data.screener.rows : [];
  const filteredRows = useMemo(() => {
    if (assetFilter === 'ALL') return screenerRows;
    return screenerRows.filter((row) => String(row.assetClass || '').toUpperCase() === assetFilter);
  }, [screenerRows, assetFilter]);

  const scoreModules = Array.isArray(data?.scoreBreakdown?.modules) ? data.scoreBreakdown.modules : [];
  const checklistItems = Array.isArray(data?.checklist?.items) ? data.checklist.items : [];
  const calendarEvents = Array.isArray(data?.calendar?.events) ? data.calendar.events : [];
  const filteredCalendarEvents = useMemo(() => {
    if (impactFilter === 'ALL') return calendarEvents;
    if (impactFilter === 'HIGH') return calendarEvents.filter((evt) => Number(evt?.impact || 0) >= 3);
    if (impactFilter === 'MED_PLUS') return calendarEvents.filter((evt) => Number(evt?.impact || 0) >= 2);
    if (impactFilter === 'LOW_PLUS') return calendarEvents.filter((evt) => Number(evt?.impact || 0) >= 1);
    return calendarEvents;
  }, [calendarEvents, impactFilter]);
  const surpriseRows = Array.isArray(data?.calendar?.currencySurprise) ? data.calendar.currencySurprise : [];
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const providerHealth = Array.isArray(data?.providerHealth) ? data.providerHealth : [];
  const cryptoRows = Array.isArray(data?.cryptoSnapshot) ? data.cryptoSnapshot : [];
  const pairOptions = useMemo(
    () => screenerRows.map((row) => ({ id: row.id, label: `${row.symbol} (${row.assetClass})` })),
    [screenerRows]
  );
  const selectedPairLabel = useMemo(() => {
    if (!selectedPair && data?.overview?.portfolioScope) return 'All markets';
    const fromData = data?.selectedPair?.symbol;
    if (fromData) return fromData;
    const opt = pairOptions.find((o) => o.id === selectedPair);
    if (opt?.label) return opt.label.replace(/\s*\([^)]*\)\s*$/, '');
    if (selectedPair && selectedPair.length === 6) {
      return `${selectedPair.slice(0, 3)}/${selectedPair.slice(3)}`;
    }
    return selectedPair || '—';
  }, [selectedPair, data?.overview?.portfolioScope, data?.selectedPair?.symbol, pairOptions]);
  const opportunities = data?.opportunities || { bestBuy: [], bestSell: [] };
  const topBuyRow = (opportunities.bestBuy || [])[0] || null;
  const topSellRow = (opportunities.bestSell || [])[0] || null;
  const correlations = Array.isArray(data?.correlations) ? data.correlations : [];
  const currencyStrengthRows = Array.isArray(data?.currencyStrength?.rows) ? data.currencyStrength.rows : [];
  const currencyStrengthBestPair = data?.currencyStrength?.bestPair || null;
  const sessionIntel = data?.sessionIntelligence || null;
  const newsImpactZones = Array.isArray(data?.newsImpactZones?.windows) ? data.newsImpactZones.windows : [];
  const carryProxy = data?.carryProxy || null;
  const cotProxy = data?.cotProxy || null;
  const cotPositioning = data?.cotPositioning || null;
  const cotCurrencyRows = Array.isArray(cotPositioning?.currencyRows) ? cotPositioning.currencyRows : [];
  const seasonality = data?.seasonality || null;
  const macroSurpriseRows = Array.isArray(data?.macroSurpriseIndex) ? data.macroSurpriseIndex : [];
  const cotRetailRows = useMemo(() => {
    return cotCurrencyRows
      .filter((row) => sentimentPairFilter === 'ALL' || row.currency === sentimentPairFilter.slice(0, 3))
      .filter((row) => row.retailLongPct != null);
  }, [cotCurrencyRows, sentimentPairFilter]);
  const sentimentPairOptions = useMemo(() => {
    const fromCot = cotCurrencyRows.map((row) => ({ id: row.currency, label: row.currency }));
    return [{ id: 'ALL', label: 'All currencies' }, ...fromCot];
  }, [cotCurrencyRows]);
  const groupedCalendarRows = useMemo(() => {
    const out = [];
    let lastDay = '';
    for (const evt of filteredCalendarEvents) {
      const dayLabel = new Date(evt.time).toLocaleDateString();
      if (dayLabel !== lastDay) {
        out.push({ __kind: 'day', dayLabel, id: `day-${dayLabel}` });
        lastDay = dayLabel;
      }
      out.push({ __kind: 'event', ...evt });
    }
    return out;
  }, [filteredCalendarEvents]);
  const headlineIntel = data?.headlineIntel || { items: [], assetOptions: [], stats: { total: 0, highImpact: 0, pending: 0 } };
  const headlineItems = Array.isArray(headlineIntel?.items) ? headlineIntel.items : [];
  const headlineAssetOptions = Array.isArray(headlineIntel?.assetOptions) ? headlineIntel.assetOptions : [];
  const filteredHeadlineItems = useMemo(() => {
    let rows = headlineItems.slice();
    if (headlineMode === 'POPULAR') {
      rows = rows
        .slice()
        .sort((a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0))
        .slice(0, 24);
    } else if (headlineMode === 'HIGH') {
      rows = rows.filter((row) => rowImpactTier(row) >= 3);
    }
    if (headlineImpactFilter === 'HIGH') rows = rows.filter((row) => rowImpactTier(row) >= 3);
    else if (headlineImpactFilter === 'MED_PLUS') rows = rows.filter((row) => rowImpactTier(row) >= 2);
    if (headlineAssetFilter !== 'ALL') {
      rows = rows.filter((row) => (row?.affectedAssets || []).some((asset) => asset.id === headlineAssetFilter));
    }
    const q = String(headlineSearch || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row?.title || ''} ${row?.country || ''} ${row?.category || ''} ${row?.summary || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [headlineItems, headlineMode, headlineImpactFilter, headlineAssetFilter, headlineSearch]);

  const onHeadlineTab = (tabId) => {
    setHeadlineMode(tabId);
    if (tabId === 'HIGH') setHeadlineImpactFilter('HIGH');
    else setHeadlineImpactFilter('ALL');
  };
  useEffect(() => {
    if (!filteredHeadlineItems.length) {
      if (selectedHeadlineId) setSelectedHeadlineId('');
      return;
    }
    if (!selectedHeadlineId || !filteredHeadlineItems.some((row) => row.id === selectedHeadlineId)) {
      setSelectedHeadlineId(filteredHeadlineItems[0].id);
    }
  }, [filteredHeadlineItems, selectedHeadlineId]);
  const selectedHeadline = useMemo(
    () => filteredHeadlineItems.find((row) => row.id === selectedHeadlineId) || filteredHeadlineItems[0] || null,
    [filteredHeadlineItems, selectedHeadlineId]
  );

  const runHeadlineAi = async (headlineRow = selectedHeadline) => {
    if (!headlineRow || !window.electronAPI?.analyzeFundamentalsHeadlineAi) return;
    const id = headlineRow.id;
    setHeadlineAiById((m) => ({ ...m, [id]: { loading: true } }));
    const focus = {
      title: headlineRow.title,
      country: headlineRow.country,
      category: headlineRow.category,
      surprise: headlineRow.surprise,
      forecast: headlineRow.forecast,
      actual: headlineRow.actual
    };
    const prior = priorHeadlinesPayload(headlineItems, id, 12);
    try {
      const res = await window.electronAPI.analyzeFundamentalsHeadlineAi({ focus, prior });
      if (res && res.success === false) {
        setHeadlineAiById((m) => ({ ...m, [id]: { loading: false, error: res.error || 'failed' } }));
        return;
      }
      if (!res?.ok) {
        setHeadlineAiById((m) => ({ ...m, [id]: { loading: false, error: res?.error || 'AI failed' } }));
        return;
      }
      setHeadlineAiById((m) => ({
        ...m,
        [id]: { loading: false, ok: true, verdict: res.verdict, rationale: res.rationale, pairs: res.pairs }
      }));
    } catch (e) {
      setHeadlineAiById((m) => ({ ...m, [id]: { loading: false, error: e?.message || 'Error' } }));
    }
  };

  const runBatchHeadlineAi = async () => {
    if (!window.electronAPI?.analyzeFundamentalsHeadlineAi || batchHeadlineAiRunning) return;
    const targets = headlineItems
      .filter((row) => row.headlineFeedKind === 'RELEASED')
      .filter((row) => !headlineAiById[row.id]?.ok)
      .slice(0, 5);
    if (targets.length === 0) return;
    setBatchHeadlineAiRunning(true);
    for (const row of targets) {
      // eslint-disable-next-line no-await-in-loop
      await runHeadlineAi(row);
    }
    setBatchHeadlineAiRunning(false);
  };

  const openTradesForEvent = (evt) => {
    if (!evt?.time) return;
    const d = new Date(evt.time);
    if (Number.isNaN(d.getTime())) return;
    const ymd = d.toISOString().slice(0, 10);
    setTimeScope?.('CUSTOM');
    setAnalyticsCustomRange?.({ from: ymd, to: ymd });
    if (typeof onNavigateToTrades === 'function') onNavigateToTrades();
  };

  const nextHigh = data?.overview?.nextHighImpact || data?.calendar?.nextHighImpact || null;
  const headlineTone = scoreTone(data?.overview?.score);
  const verdict = String(data?.checklist?.verdict || 'WAIT').toUpperCase();
  const tabEnterKey = `${activeTab}-${data?.generatedAt || 'init'}`;

  const cotTraderGuide = cotPositioning?.traderGuide || null;

  return (
    <div className="dashboard-shell fundamentals-shell" data-testid="page-fundamentals">
      <div className="titlebar">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon"><Landmark size={16} /></span>
          <span className="brand-name">Fundamentals</span>
          <span className="subtitle">Forex, indices, commodities first • crypto snapshot secondary</span>
        </div>
        <div className="titlebar-actions">
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
          {data?.stale && (
            <span className="fund-stale-pill">
              <AlertTriangle size={12} />
              Stale cache
            </span>
          )}
          <button type="button" data-testid="fundamentals-refresh" className="btn btn-outline btn-titlebar" onClick={() => fetchDashboard(true)} disabled={refreshing}>
            <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>
      </div>

      <div className="fund-page" data-onboarding="fundamentals-workspace">
        {(error || data?.stale) && data && !loading && (
          <div className="fund-degraded-banner" style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', fontSize: 12, color: 'var(--text2)' }}>
            {data?.stale ? 'Showing cached fundamentals — data may be outdated. ' : ''}
            {error ? `${error} ` : ''}
            {retryCountdown > 0 ? `Auto-retry in ${retryCountdown}s.` : 'Retrying…'}
            <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} onClick={() => fetchDashboard(true)} disabled={refreshing}>Retry now</button>
          </div>
        )}
        {(error && !data?.hasRealData && !data?.overview) ? (
          <div className="empty-state">
            <div className="fund-error-title">Real data unavailable</div>
            <div className="fund-error-text">{error}</div>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
              Showing cached sections when available. Check network and API keys in Settings → Connection, then Refresh.
            </p>
          </div>
        ) : (
          <>
            <div className="fund-summary-grid animate-stagger">
              <div className={`fund-summary-card fund-summary-card--elevated tone-${headlineTone}`} style={{ '--stagger-index': 0 }}>
                <div className="fund-card-label">Composite Bias</div>
                <div className="fund-card-value">{data?.overview?.marketBias || 'NEUTRAL'}</div>
                <div className="fund-card-sub">{selectedPairLabel} • Score {fmtPct(data?.overview?.score, '')} / Confidence {fmtPct(data?.overview?.confidence, '')}</div>
              </div>
              <div className="fund-summary-card">
                <div className="fund-card-label">Risk Regime</div>
                <div className="fund-card-value">{data?.overview?.sentimentRegime || 'NEUTRAL'}</div>
                <div className="fund-card-sub">Driver: {data?.overview?.keyDriver || 'N/A'}</div>
              </div>
              <div className="fund-summary-card">
                <div className="fund-card-label">Next High-Impact Event</div>
                <div className="fund-card-value">{nextHigh ? `${nextHigh.country} ${nextHigh.title}` : 'None detected'}</div>
                <div className="fund-card-sub">{nextHigh ? `In ${fmtCountdown(nextHigh.minutesToEvent)}` : 'No event in tracked window'}</div>
              </div>
              <div className={`fund-summary-card verdict-${verdict.toLowerCase()}`}>
                <div className="fund-card-label">Checklist Verdict</div>
                <div className="fund-card-value">{verdict}</div>
                <div className="fund-card-sub">{selectedPairLabel} • {data?.checklist?.summary || 'No checklist summary'}</div>
              </div>
              <div className="fund-summary-card">
                <div className="fund-card-label">Top Opportunities</div>
                <div className="fund-card-value">
                  {topBuyRow ? `${topBuyRow.symbol} (BUY)` : 'N/A'} / {topSellRow ? `${topSellRow.symbol} (SELL)` : 'N/A'}
                </div>
                <div className="fund-card-sub">
                  Buy {topBuyRow ? fmtPct(topBuyRow.trendScore, '') : '—'} • Sell {topSellRow ? fmtPct(topSellRow.trendScore, '') : '—'}
                </div>
              </div>
              <div className={`fund-summary-card fund-summary-card--cot ${cotPositioning?.available ? 'is-live' : ''}`} style={{ '--stagger-index': 5 }}>
                <div className="fund-card-label"><Users size={11} /> COT Positioning</div>
                <div className={`fund-card-value ${cotPositioning?.available ? (Number(cotPositioning.pairScore) >= 0 ? 'pos' : 'neg') : ''}`}>
                  {cotPositioning?.available ? fmtPct(cotPositioning.pairScore, '') : 'N/A'}
                </div>
                <div className="fund-card-sub">
                  {cotPositioning?.available
                    ? `${cotPositioning.stance?.replace(/_/g, ' ') || 'Mixed'} • Report ${cotPositioning.reportDate || '—'}`
                    : (cotPositioning?.reason || 'Select a major FX pair')}
                </div>
              </div>
            </div>

            <div className="fund-focus-bar animate-enter">
              <div className="fund-focus-left">
                <span className="fund-focus-label">Focus Instrument</span>
                <select
                  value={selectedPair || ''}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedPair(next);
                    fetchDashboard(false, next);
                  }}
                  className="fund-focus-select"
                  title="Select pair/instrument for pair-specific verdict and news"
                  disabled={activeTab === 'headlines'}
                >
                  <option value="">All markets</option>
                  {pairOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="fund-focus-meta">
                <span className="fund-focus-chip">
                  {activeTab === 'headlines'
                    ? 'Headlines AI: global released prints (pair focus applies to Overview & calendar)'
                    : `Pair-specific verdict: ${selectedPairLabel}`}
                </span>
                {activeTab !== 'headlines' && (
                  <span className="fund-focus-chip">Auto refresh on pair change</span>
                )}
              </div>
            </div>

            <div className="fund-tabs-row fund-tabs-row--animated">
              <button type="button" data-testid="fundamentals-tab-overview" className={`fund-tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
              <button type="button" data-testid="fundamentals-tab-positioning" className={`fund-tab-btn ${activeTab === 'positioning' ? 'active' : ''}`} onClick={() => setActiveTab('positioning')}><BarChart3 size={13} /> Positioning</button>
              <button type="button" data-testid="fundamentals-tab-headlines" className={`fund-tab-btn ${activeTab === 'headlines' ? 'active' : ''}`} onClick={() => setActiveTab('headlines')}>Headlines AI</button>
              <button type="button" data-testid="fundamentals-tab-sentiment" className={`fund-tab-btn ${activeTab === 'sentiment' ? 'active' : ''}`} onClick={() => setActiveTab('sentiment')}>Sentiment</button>
              <button type="button" data-testid="fundamentals-tab-feeds" className={`fund-tab-btn ${activeTab === 'feeds' ? 'active' : ''}`} onClick={() => setActiveTab('feeds')}>Feeds</button>
            </div>

            <div key={tabEnterKey} className="fund-tab-stage animate-enter">
            {activeTab === 'overview' && (
            <>
            <FundOverviewPulse
              data={data}
              cotPositioning={cotPositioning}
              selectedPairLabel={selectedPairLabel}
              calendarEvents={calendarEvents}
              scoreModules={scoreModules}
              sessionIntel={sessionIntel}
              onGoPositioning={() => setActiveTab('positioning')}
              onOpenTradesForEvent={openTradesForEvent}
            />
            <div className="fund-main-grid">
              <div className="fund-main-left">
                <div className="fund-panel">
                  <div className="fund-panel-header">
                    <h3>Screener</h3>
                    <div className="fund-panel-actions">
                      <select data-testid="fundamentals-filter-asset" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} className="fund-select">
                        <option value="ALL">All classes</option>
                        <option value="FOREX">Forex</option>
                        <option value="INDICES">Indices</option>
                        <option value="COMMODITIES">Commodities</option>
                        <option value="CRYPTO">Crypto</option>
                      </select>
                    </div>
                  </div>
                  <div className="fund-table-wrap">
                    <table className="fund-table">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Class</th>
                          <th>Change</th>
                          <th>Volatility</th>
                          <th>Trend</th>
                          <th>Bias</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.length === 0 && (
                          <tr><td colSpan={6} className="fund-empty-row">No real screener rows available.</td></tr>
                        )}
                        {filteredRows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.symbol}</td>
                            <td>{row.assetClass}</td>
                            <td className={Number(row.priceChange) >= 0 ? 'pos' : 'neg'}>{fmtPct(row.priceChange)}</td>
                            <td>{fmtPct(row.volatility)}</td>
                            <td className={Number(row.trendScore) >= 0 ? 'pos' : 'neg'}>{fmtPct(row.trendScore, '')}</td>
                            <td>
                              <span className={`fund-badge ${String(row.direction || '').toLowerCase()}`}>{row.direction}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="fund-panel">
                  <div className="fund-panel-header"><h3>Currency Strength Matrix (live FX)</h3></div>
                {currencyStrengthBestPair && (
                  <div className="fund-strength-bestpair">
                    Best pair setup: <strong>{currencyStrengthBestPair.pair}</strong>
                    {' '}({currencyStrengthBestPair.bias} edge, spread {fmtPct(currencyStrengthBestPair.spread, '')})
                  </div>
                )}
                  <div className="fund-table-wrap">
                    <table className="fund-table">
                    <thead><tr><th>Rank</th><th>Currency</th><th>Strength</th><th>H1 Bar</th><th>Bias</th></tr></thead>
                      <tbody>
                      {currencyStrengthRows.length === 0 && <tr><td colSpan={5} className="fund-empty-row">No currency strength rows available.</td></tr>}
                        {currencyStrengthRows.map((row) => (
                        <tr key={`cs-${row.currency}`}>
                          {(() => {
                            const rowScore = Number(row?.score || 0);
                            const toneClass = rowScore >= 20 ? 'strong' : rowScore >= 0 ? 'bull' : rowScore <= -20 ? 'weak' : 'bear';
                            const barWidth = Math.max(2, Math.min(100, Math.abs(rowScore)));
                            return (
                              <>
                            <td>{row.rank}</td>
                            <td>{row.currency}</td>
                            <td className={Number(row.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(row.score, '')}</td>
                          <td>
                            <div className="fund-strength-bar-wrap">
                              <div
                                className={`fund-strength-bar ${toneClass}`}
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </td>
                          <td>{row.bias}</td>
                              </>
                            );
                          })()}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="fund-panel news-panel">
                <div className="fund-panel-header">
                  <h3>Economic Calendar / News ({selectedPairLabel})</h3>
                  <div className="fund-panel-actions">
                    <select data-testid="fundamentals-filter-impact" value={impactFilter} onChange={(e) => setImpactFilter(e.target.value)} className="fund-select">
                      <option value="ALL">Impact: All</option>
                      <option value="HIGH">Impact: High only</option>
                      <option value="MED_PLUS">Impact: Medium + High</option>
                      <option value="LOW_PLUS">Impact: Low + Medium + High</option>
                    </select>
                  </div>
                </div>
                <FundSessionTimeline sessionIntel={sessionIntel} />
                <div className="fund-table-wrap">
                  <table className="fund-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Currency</th>
                        <th>Impact</th>
                        <th>Event</th>
                        <th>Forecast</th>
                        <th>Actual</th>
                        <th>Surprise</th>
                        <th>T-</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {groupedCalendarRows.length === 0 && (
                        <tr><td colSpan={9} className="fund-empty-row">No calendar events available.</td></tr>
                      )}
                      {groupedCalendarRows.map((row) => {
                        if (row.__kind === 'day') {
                          return (
                            <tr key={row.id} className="fund-day-separator-row">
                              <td colSpan={9}>{row.dayLabel}</td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={row.id}>
                            <td>{new Date(row.time).toLocaleString()}</td>
                            <td>{row.country}</td>
                            <td><span className={`fund-impact impact-${impactBadge(row.impact).toLowerCase()}`}>{impactBadge(row.impact)}</span></td>
                            <td>{row.title}</td>
                            <td>{row.forecast ?? '—'}</td>
                            <td>{row.actual ?? '—'}</td>
                            <td><HeadlineSurpriseBadge row={row} /></td>
                            <td>{fmtCountdown(row.minutesToEvent)}</td>
                            <td>
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => openTradesForEvent(row)} title="View trades on this day">
                                Trades
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="fund-subgrid">
                  <div className="fund-mini-panel">
                    <h4>Currency Surprise</h4>
                    {surpriseRows.length === 0 ? (
                      <div className="fund-empty-inline">No surprise data yet.</div>
                    ) : surpriseRows.slice(0, 8).map((row) => (
                      <div key={row.currency} className="fund-mini-row">
                        <span>{row.currency}</span>
                        <span className={Number(row.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(row.score, '')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="fund-mini-panel">
                    <h4>Sentiment + Volatility</h4>
                    <div className="fund-mini-row"><span>Regime</span><span>{data?.sentiment?.regime || 'NEUTRAL'}</span></div>
                    <div className="fund-mini-row"><span>Sentiment score</span><span className={Number(data?.sentiment?.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(data?.sentiment?.score, '')}</span></div>
                    <div className="fund-mini-row"><span>VIX</span><span>{data?.sentiment?.vix ?? '—'}</span></div>
                    <div className="fund-mini-row"><span>DXY change</span><span>{fmtPct(data?.sentiment?.dxyChange)}</span></div>
                    <div className="fund-mini-row"><span>Fear/Greed</span><span>{data?.sentiment?.fearGreed?.value ?? '—'}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="fund-masonry-grid">
              <div className="fund-panel">
                <div className="fund-panel-header"><h3>Score Breakdown</h3></div>
                <div className="fund-score-list">
                  {scoreModules.length === 0 && <div className="fund-empty-inline">No score modules available.</div>}
                  {scoreModules.map((module) => (
                    <div className="fund-score-item" key={module.key || module.name}>
                      <div className="fund-score-head">
                        <span>{module.name}</span>
                        <span className={Number(module.score) >= 0 ? 'pos' : 'neg'}>
                          {fmtPct(module.score, '')} ({fmtPct(module.normalizedWeight, '')}% w)
                        </span>
                      </div>
                      <div className="fund-score-track">
                        <div
                          className={`fund-score-fill ${Number(module.score) >= 0 ? 'pos' : 'neg'}`}
                          style={{ width: `${Math.min(100, Math.abs(Number(module.score) || 0))}%` }}
                        />
                      </div>
                      <div className="fund-score-detail">{module.detail || 'No detail'}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fund-panel">
                <div className="fund-panel-header"><h3>Checklist</h3></div>
                <div className="fund-checklist">
                  {checklistItems.length === 0 && <div className="fund-empty-inline">No checklist available.</div>}
                  {checklistItems.map((item) => (
                    <div className={`fund-check-item ${item.status}`} key={item.key}>
                      <div className="fund-check-label">{item.label}</div>
                      <div className="fund-check-status">{String(item.status || '').toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <div className={`fund-verdict verdict-${verdict.toLowerCase()}`}>
                  Final Verdict ({selectedPairLabel}): {verdict}
                </div>
              </div>

              <div className="fund-panel">
                <div className="fund-panel-header"><h3>Best Opportunities + Correlation</h3></div>
                <div className="fund-opps-grid">
                  <div className="fund-mini-panel">
                    <h4>Top Buying Opportunities</h4>
                    <div className="fund-table-wrap">
                      <table className="fund-table fund-opps-table">
                        <thead>
                          <tr><th>Symbol</th><th>Trend</th></tr>
                        </thead>
                        <tbody>
                          {(opportunities.bestBuy || []).slice(0, 6).map((row) => (
                            <tr key={`buy-${row.id}`}>
                              <td>{row.symbol}</td>
                              <td className="pos">{fmtPct(row.trendScore, '')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="fund-mini-panel">
                    <h4>Top Selling Opportunities</h4>
                    <div className="fund-table-wrap">
                      <table className="fund-table fund-opps-table">
                        <thead>
                          <tr><th>Symbol</th><th>Trend</th></tr>
                        </thead>
                        <tbody>
                          {(opportunities.bestSell || []).slice(0, 6).map((row) => (
                            <tr key={`sell-${row.id}`}>
                              <td>{row.symbol}</td>
                              <td className="neg">{fmtPct(row.trendScore, '')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="fund-mini-panel">
                  <h4>Correlation ({selectedPairLabel})</h4>
                  {correlations.length === 0 && <div className="fund-empty-inline">No correlation data available.</div>}
                  {correlations.map((row) => (
                    <div className="fund-mini-row" key={`corr-${row.id}`}>
                      <span>{row.symbol}</span>
                      <span className={Number(row.correlation) >= 0 ? 'pos' : 'neg'}>{row.correlation}</span>
                    </div>
                  ))}
                </div>
                <div className="fund-mini-panel">
                  <h4>Crypto Snapshot</h4>
                  {cryptoRows.length === 0 && <div className="fund-empty-inline">Crypto snapshot unavailable.</div>}
                  {cryptoRows.map((row) => (
                    <div className="fund-mini-row" key={row.id}>
                      <span>{row.symbol}</span>
                      <span className={Number(row.priceChange) >= 0 ? 'pos' : 'neg'}>{fmtPct(row.priceChange)}</span>
                    </div>
                  ))}
                </div>
                <div className="fund-sources">
                  <h4>Sources</h4>
                  {sources.length === 0 && <div className="fund-empty-inline">No source metadata.</div>}
                  {sources.map((src) => (
                    <div key={src.id} className="fund-source-row">
                      <span>{src.label}</span>
                      <span>{src.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fund-panel">
                <div className="fund-panel-header"><h3>Session + News Impact Zones</h3></div>
                <div className="fund-mini-panel">
                  <div className="fund-mini-row"><span>Active session</span><span>{sessionIntel?.activeSession || 'N/A'}</span></div>
                  <div className="fund-mini-row"><span>Liquidity score</span><span>{fmtPct(sessionIntel?.liquidityScore, '')}</span></div>
                  <div className="fund-mini-row"><span>Session edge</span><span className={Number(sessionIntel?.edgeScore) >= 0 ? 'pos' : 'neg'}>{fmtPct(sessionIntel?.edgeScore, '')}</span></div>
                  <div className="fund-mini-row"><span>High events (next 4h)</span><span>{sessionIntel?.highImpactNext4h ?? 0}</span></div>
                </div>
                <div className="fund-mini-panel">
                  <h4>News Impact Zones ({selectedPairLabel})</h4>
                  {newsImpactZones.length === 0 && <div className="fund-empty-inline">No impact windows available.</div>}
                  {newsImpactZones.map((zone) => (
                    <div key={`zone-${zone.windowMinutes}`} className="fund-mini-row">
                      <span>Next {zone.windowMinutes}m</span>
                      <span className={zone.upcoming > 0 ? 'neg' : 'pos'}>{zone.upcoming} high-impact</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fund-panel">
                <div className="fund-panel-header"><h3>Carry / COT / Seasonality</h3></div>
                <div className="fund-mini-panel">
                  <h4>Rates + Carry (FRED)</h4>
                  {!carryProxy?.available && (
                    <div className="fund-empty-inline">{carryProxy?.detail || 'Live rate differential unavailable — set FRED_API_KEY.'}</div>
                  )}
                  {carryProxy?.available && (
                    <>
                      <div className="fund-mini-row"><span>Carry score</span><span className={Number(carryProxy.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(carryProxy.score, '')}</span></div>
                      <div className="fund-empty-inline">{carryProxy.detail}</div>
                    </>
                  )}
                </div>
                <div className="fund-mini-panel fund-mini-panel--cot">
                  <h4>CFTC COT (weekly)</h4>
                  {!cotProxy?.available && (
                    <div className="fund-empty-inline">{cotProxy?.detail || 'CFTC positioning unavailable for this pair.'}</div>
                  )}
                  {cotProxy?.available && (
                    <>
                      <div className="fund-mini-row"><span>Positioning score</span><span className={Number(cotProxy.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(cotProxy.score, '')}</span></div>
                      <div className="fund-mini-row"><span>Stance</span><span>{cotProxy.stance || 'MIXED_POSITIONING'}</span></div>
                      <div className="fund-empty-inline">{cotProxy.detail}</div>
                      {cotProxy.reportDate && <div className="fund-mini-row"><span>Report date</span><span>{cotProxy.reportDate}</span></div>}
                    </>
                  )}
                  {cotPositioning?.divergence && (
                    <div className="fund-cot-divergence-banner animate-enter-fast">
                      <Activity size={14} />
                      <div>
                        <strong>{cotPositioning.divergence.label}</strong>
                        <p>{cotPositioning.divergence.hint}</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="fund-mini-panel">
                  <h4>Seasonality</h4>
                  {!seasonality?.available && <div className="fund-empty-inline">Seasonality unavailable (insufficient history).</div>}
                  {seasonality?.available && (
                    <>
                      <div className="fund-mini-row"><span>Best day</span><span className="pos">{seasonality?.bestWeekday?.key} {fmtPct(seasonality?.bestWeekday?.mean)}</span></div>
                      <div className="fund-mini-row"><span>Worst day</span><span className="neg">{seasonality?.worstWeekday?.key} {fmtPct(seasonality?.worstWeekday?.mean)}</span></div>
                      <div className="fund-mini-row"><span>Best month</span><span className="pos">{seasonality?.bestMonth?.key} {fmtPct(seasonality?.bestMonth?.mean)}</span></div>
                    </>
                  )}
                </div>
              </div>

              <div className="fund-panel">
                <div className="fund-panel-header"><h3>Macro Surprise Index</h3></div>
                <div className="fund-table-wrap">
                  <table className="fund-table">
                    <thead><tr><th>Currency</th><th>Surprise score</th><th>Samples</th></tr></thead>
                    <tbody>
                      {macroSurpriseRows.length === 0 && <tr><td colSpan={3} className="fund-empty-row">No macro surprise samples available.</td></tr>}
                      {macroSurpriseRows.map((row) => (
                        <tr key={`ms-${row.currency}`}>
                          <td>{row.currency}</td>
                          <td className={Number(row.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(row.score, '')}</td>
                          <td>{row.samples ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            </>
            )}

            {activeTab === 'headlines' && (
              <div className="fund-headlines-layout">
                <FundHeadlineImminentRow items={headlineItems} onBatchAnalyze={runBatchHeadlineAi} batchAnalyzing={batchHeadlineAiRunning} />
                <div className="fund-panel fund-panel--mrkt-feed">
                  <div className="fund-mrkt-feed-head">
                    <div className="fund-mrkt-toolbar">
                      <div className="fund-mrkt-tabs" role="tablist" aria-label="Headline feed">
                        {[
                          { id: 'ALL', label: 'All' },
                          { id: 'POPULAR', label: 'Popular' },
                          { id: 'HIGH', label: 'High impact', dot: true }
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={headlineMode === tab.id}
                            className={`fund-mrkt-tab ${headlineMode === tab.id ? 'active' : ''} ${tab.dot ? 'fund-mrkt-tab--high' : ''}`}
                            onClick={() => onHeadlineTab(tab.id)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <div className="fund-mrkt-toolbar-right">
                        <label className="fund-mrkt-search-wrap">
                          <Search size={14} aria-hidden />
                          <input
                            type="search"
                            className="fund-mrkt-search"
                            placeholder="Search…"
                            value={headlineSearch}
                            onChange={(e) => setHeadlineSearch(e.target.value)}
                            autoComplete="off"
                          />
                        </label>
                        <button
                          type="button"
                          className={`fund-mrkt-icon-btn ${showHeadlineFilters ? 'active' : ''}`}
                          title="More filters"
                          aria-expanded={showHeadlineFilters}
                          onClick={() => setShowHeadlineFilters((v) => !v)}
                        >
                          <Filter size={16} />
                        </button>
                      </div>
                    </div>
                    {showHeadlineFilters && (
                      <div className="fund-mrkt-filters-row">
                        <select value={headlineImpactFilter} onChange={(e) => setHeadlineImpactFilter(e.target.value)} className="fund-select fund-select--compact">
                          <option value="ALL">Impact: All</option>
                          <option value="MED_PLUS">Impact: Medium + High</option>
                          <option value="HIGH">Impact: High only</option>
                        </select>
                        <select value={headlineAssetFilter} onChange={(e) => setHeadlineAssetFilter(e.target.value)} className="fund-select fund-select--compact">
                          <option value="ALL">Assets: All</option>
                          {headlineAssetOptions.map((asset) => (
                            <option key={asset.id} value={asset.id}>{asset.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="fund-headline-stats fund-headline-stats--subtle">
                      <span>{filteredHeadlineItems.length} shown</span>
                      <span>·</span>
                      <span>{headlineIntel?.stats?.total ?? 0} in feed</span>
                      <span>·</span>
                      <span>Upcoming {headlineIntel?.stats?.pending ?? 0}</span>
                      <span>·</span>
                      <span>High {headlineIntel?.stats?.highImpact ?? 0}</span>
                    </div>
                  </div>
                  <div className="fund-headline-list fund-headline-list--mrkt">
                    {filteredHeadlineItems.length === 0 && (
                      <div className="fund-empty-inline">
                        No headlines for current filters.
                        {headlineItems.length === 0 ? (
                          <span> Zero events in the calendar window — check your connection and tap Refresh, or loosen impact filters.</span>
                        ) : null}
                      </div>
                    )}
                    {filteredHeadlineItems.map((row) => {
                      const tier = rowImpactTier(row);
                      const hi = tier >= 3;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          className={`fund-mrkt-card ${selectedHeadline?.id === row.id ? 'active' : ''}`}
                          onClick={() => setSelectedHeadlineId(row.id)}
                        >
                          <div className="fund-mrkt-card-top">
                            <span className={`fund-mrkt-impact ${hi ? 'fund-mrkt-impact--high' : tier >= 2 ? 'fund-mrkt-impact--med' : 'fund-mrkt-impact--low'}`}>
                              {hi ? 'HIGH IMPACT' : tier >= 2 ? 'MEDIUM IMPACT' : 'LOW IMPACT'}
                            </span>
                            <HeadlineSurpriseBadge row={row} />
                            {row.headlineFeedKind === 'UPCOMING' ? (
                              <span className="fund-mrkt-feed-kind" title="Scheduled — not yet released">UPCOMING</span>
                            ) : null}
                            <span className="fund-mrkt-time">{fmtHeadlineTimeRow(row)}</span>
                          </div>
                          <div className="fund-mrkt-headline">{row.title}</div>
                          <div className="fund-mrkt-lead">{row.summary}</div>
                          <div className="fund-mrkt-pills">
                            {(row.affectedAssets || []).slice(0, 16).map((asset) => {
                              const aiPack = headlineAiById[row.id];
                              const aiMap = aiPack?.ok && Array.isArray(aiPack.pairs) ? buildAiBiasMap(aiPack.pairs) : null;
                              const pillClass = pillClassForAsset(asset, aiMap);
                              const arr = pillArrowForAsset(asset, aiMap);
                              return (
                                <span
                                  key={`${row.id}-${asset.id}`}
                                  className={`fund-mrkt-pill ${pillClass}`}
                                >
                                  {compactTicker(asset.symbol)}
                                  <span className="fund-mrkt-pill-arr" aria-hidden>{arr}</span>
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="fund-panel">
                  <div className="fund-panel-header"><h3>MRKT-style Deep Analysis</h3></div>
                  {!selectedHeadline ? (
                    <div className="fund-empty-inline">Select a headline to view deep analysis.</div>
                  ) : (
                    <>
                      <div className="fund-mrkt-ai-actions" style={{ marginBottom: 12 }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => runHeadlineAi()}
                          disabled={!!headlineAiById[selectedHeadline.id]?.loading || batchHeadlineAiRunning}
                        >
                          <Sparkles size={14} style={{ marginRight: 6 }} />
                          {headlineAiById[selectedHeadline.id]?.loading ? 'AI analyzing…' : 'AI: contextual pairs (prior news)'}
                        </button>
                        <span className="hint" style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
                          Free model (Pollinations). Sends this headline plus up to 12 earlier releases from the same feed for context. Greens / reds / silver follow AI pair bias when available; otherwise the rule-based chips stay as before.
                        </span>
                        {headlineAiById[selectedHeadline.id]?.error && (
                          <div className="fund-empty-inline" style={{ marginTop: 8, color: 'var(--danger)' }}>
                            {headlineAiById[selectedHeadline.id].error}
                          </div>
                        )}
                      </div>
                      {headlineAiById[selectedHeadline.id]?.ok && (
                        <div className={`fund-headline-ai-card tone-${dirClass(headlineAiById[selectedHeadline.id].verdict)}`} style={{ marginBottom: 12 }}>
                          <div className="fund-mini-row"><span>AI verdict</span><span className={dirClass(headlineAiById[selectedHeadline.id].verdict)}>{headlineAiById[selectedHeadline.id].verdict}</span></div>
                          <div className="fund-empty-inline" style={{ marginTop: 8 }}>{headlineAiById[selectedHeadline.id].rationale}</div>
                        </div>
                      )}
                      <div className={`fund-headline-analysis-card tone-${dirClass(selectedHeadline.direction)}`}>
                        <div className="fund-mini-row"><span>Event</span><span>{selectedHeadline.country} • {selectedHeadline.category}</span></div>
                        <div className="fund-mini-row"><span>Direction</span><span className={dirClass(selectedHeadline.direction)}>{selectedHeadline.direction}</span></div>
                        <div className="fund-mini-row"><span>Confidence</span><span>{selectedHeadline.confidence}%</span></div>
                        <div className="fund-mini-row"><span>Surprise</span><span>{Number.isFinite(Number(selectedHeadline.surprise)) ? fmtPct(selectedHeadline.surprise, '') : 'Pending'}</span></div>
                        <div className="fund-empty-inline">{selectedHeadline.summary}</div>
                      </div>
                      <div className="fund-mini-panel">
                        <h4>Asset Impact Map</h4>
                        {(selectedHeadline.affectedAssets || []).length === 0 && (
                          <div className="fund-empty-inline">No strong cross-asset spillover detected.</div>
                        )}
                        {(selectedHeadline.affectedAssets || []).map((asset) => (
                          <div key={`${selectedHeadline.id}-asset-${asset.id}`} className="fund-mini-row">
                            <span>{asset.symbol}</span>
                            <span className={dirClass(asset.direction)}>{asset.direction} ({fmtPct(asset.score, '')})</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'feeds' && (() => {
              const mw = data?.macroWorldBank;
              const mf = data?.macroFed;
              const cm = data?.cryptoMarket;
              const fgHist = Array.isArray(data?.sentiment?.fearGreedHistory) ? data.sentiment.fearGreedHistory : [];
              const altGlob = data?.sentiment?.aggregateCryptoUsd || null;
              const spot = cm?.spot && typeof cm.spot === 'object' ? cm.spot : {};
              const spotRow = (id, label) => {
                const n = spot[id];
                if (!n || typeof n.usd !== 'number') return null;
                const ch = n.usd_24h_change;
                return (
                  <div key={id} className="fund-mini-row">
                    <span>{label}</span>
                    <span>
                      ${Number(n.usd).toLocaleString(undefined, { maximumFractionDigits: n.usd >= 1000 ? 0 : 2 })}
                      {Number.isFinite(ch) ? (
                        <span className={ch >= 0 ? 'pos' : 'neg'}> ({fmtPct(ch)})</span>
                      ) : null}
                    </span>
                  </div>
                );
              };
              return (
                <div className="fund-feeds-layout">
                  <FundFeedsHealth sources={sources} providerHealth={providerHealth} sentiment={data?.sentiment} generatedAt={data?.generatedAt} snapshotData={data} />
                  <div className="fund-panel">
                    <div className="fund-panel-header"><h3>Annual macro snapshot (national accounts)</h3></div>
                    {!mw?.ok ? (
                      <div className="fund-empty-inline">{mw?.error || 'Data unavailable.'}</div>
                    ) : (
                      <div className="fund-table-wrap">
                        <table className="fund-table">
                          <thead>
                            <tr>
                              <th>Country</th>
                              <th>GDP growth</th>
                              <th>Inflation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(mw.rows || []).length === 0 && (
                              <tr><td colSpan={3} className="fund-empty-row">No rows returned.</td></tr>
                            )}
                            {(mw.rows || []).map((row) => {
                              const g = row.indicators?.gdpGrowth;
                              const inf = row.indicators?.inflation;
                              return (
                                <tr key={row.countryCode}>
                                  <td>{row.countryName || row.countryCode}</td>
                                  <td className={Number(g?.value) >= 0 ? 'pos' : 'neg'}>
                                    {g != null && Number.isFinite(g.value) ? `${fmtPct(g.value)} (${g.year})` : '—'}
                                  </td>
                                  <td>
                                    {inf != null && Number.isFinite(inf.value) ? `${fmtPct(inf.value)} (${inf.year})` : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="fund-panel">
                    <div className="fund-panel-header"><h3>US macro (latest print)</h3></div>
                    {!mf?.configured ? (
                      <div className="fund-empty-inline">{mf?.hint || 'Optional: configure FRED access in the app environment to show US series here.'}</div>
                    ) : (
                      <div className="fund-table-wrap">
                        <table className="fund-table">
                          <thead>
                            <tr><th>Series</th><th>Value</th><th>As of</th></tr>
                          </thead>
                          <tbody>
                            {(mf.rows || []).length === 0 && (
                              <tr><td colSpan={3} className="fund-empty-row">No series loaded.</td></tr>
                            )}
                            {(mf.rows || []).map((r) => (
                              <tr key={r.id}>
                                <td>{r.label}</td>
                                <td>{r.value != null ? `${r.value}${r.unit || ''}` : '—'}</td>
                                <td>{r.date || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="fund-panel">
                    <div className="fund-panel-header"><h3>Crypto market reference</h3></div>
                    {!cm?.ok && (
                      <div className="fund-empty-inline">Aggregates unavailable (rate limit or network).</div>
                    )}
                    {cm?.global && (
                      <div className="fund-mini-panel">
                        <h4>Global</h4>
                        <div className="fund-mini-row"><span>Total cap</span><span>{fmtCompactUsd(cm.global.totalMarketCapUsd)}</span></div>
                        <div className="fund-mini-row"><span>24h volume</span><span>{fmtCompactUsd(cm.global.totalVolume24hUsd)}</span></div>
                        <div className="fund-mini-row"><span>BTC dominance</span><span>{cm.global.btcDominancePct != null ? `${Number(cm.global.btcDominancePct).toFixed(1)}%` : '—'}</span></div>
                      </div>
                    )}
                    <div className="fund-mini-panel">
                      <h4>Spot (24h)</h4>
                      {spotRow('bitcoin', 'Bitcoin')}
                      {spotRow('ethereum', 'Ethereum')}
                      {spotRow('solana', 'Solana')}
                      {!spot.bitcoin && !spot.ethereum && !spot.solana && (
                        <div className="fund-empty-inline">Spot quotes unavailable.</div>
                      )}
                    </div>
                    <div className="fund-mini-panel">
                      <h4>Trending search</h4>
                      {(cm?.trending || []).length === 0 ? (
                        <div className="fund-empty-inline">No trending list.</div>
                      ) : (
                        <div className="fund-table-wrap">
                          <table className="fund-table fund-opps-table">
                            <thead><tr><th>#</th><th>Symbol</th><th>Name</th></tr></thead>
                            <tbody>
                              {(cm.trending || []).map((t, i) => (
                                <tr key={`${t.id}-${i}`}>
                                  <td>{i + 1}</td>
                                  <td>{t.symbol}</td>
                                  <td>{t.name}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="fund-panel">
                    <div className="fund-panel-header"><h3>Fear &amp; Greed history</h3></div>
                    <div className="fund-mini-panel">
                      <h4>Crypto aggregate (reference)</h4>
                      {!altGlob ? (
                        <div className="fund-empty-inline">Aggregate snapshot unavailable.</div>
                      ) : (
                        <>
                          <div className="fund-mini-row"><span>Total market cap (USD)</span><span>{fmtCompactUsd(altGlob.totalMarketCap)}</span></div>
                          <div className="fund-mini-row"><span>24h volume (USD)</span><span>{fmtCompactUsd(altGlob.totalVolume24h)}</span></div>
                          <div className="fund-mini-row"><span>BTC dominance</span><span>{altGlob.btcDominancePct != null ? `${Number(altGlob.btcDominancePct).toFixed(1)}%` : '—'}</span></div>
                        </>
                      )}
                    </div>
                    <div className="fund-table-wrap">
                      <table className="fund-table">
                        <thead>
                          <tr><th>Date</th><th>Index</th><th>Label</th></tr>
                        </thead>
                        <tbody>
                          {fgHist.length === 0 && (
                            <tr><td colSpan={3} className="fund-empty-row">No history.</td></tr>
                          )}
                          {fgHist.map((row, idx) => (
                            <tr key={`fg-${row.timestamp || idx}`}>
                              <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}</td>
                              <td>{row.value ?? '—'}</td>
                              <td>{row.classification || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {activeTab === 'positioning' && (
              <div className="fund-positioning-layout">
                <FundPositioningLegend />
                <FundRetailCrowdedAlerts alerts={cotPositioning?.retailCrowdedAlerts} />
                {!cotPositioning?.available && (
                  <div className="fund-panel">
                    <div className="fund-empty-inline">{cotPositioning?.reason || 'Positioning data unavailable. Select a major FX pair (e.g. EURUSD).'}</div>
                  </div>
                )}
                {cotPositioning?.available && (
                  <>
                    <FundPositioningMap cotPositioning={cotPositioning} selectedPairLabel={selectedPairLabel} />
                    <div className="fund-cot-sparkline-row">
                      <FundCotSpecSparkline series={cotPositioning.baseSpecHistory} label={`${cotPositioning.base?.currency || 'Base'} net spec (8w)`} />
                      {cotPositioning.quoteSpecHistory?.length > 1 && cotPositioning.quote?.currency !== 'USD' && (
                        <FundCotSpecSparkline series={cotPositioning.quoteSpecHistory} label={`${cotPositioning.quote?.currency} net spec (8w)`} />
                      )}
                    </div>
                    <div className={`fund-cot-action-card fund-cot-action-card--${cotTraderGuide?.verdictTone || 'neutral'}`}>
                      <div className="fund-cot-action-head">
                        <Target size={18} />
                        <div>
                          <span className="fund-cot-action-kicker">What to do · {selectedPairLabel}</span>
                          <h3>{cotTraderGuide?.title || 'Positioning read'}</h3>
                        </div>
                        <span className={`fund-cot-action-verdict fund-cot-action-verdict--${cotTraderGuide?.verdictTone || 'neutral'}`}>
                          {cotTraderGuide?.verdictLabel || 'Wait'}
                        </span>
                      </div>
                      <p className="fund-cot-action-do">{cotTraderGuide?.doText}</p>
                      <ul className="fund-cot-action-reasons">
                        {(cotTraderGuide?.reasons || []).map((row, idx) => (
                          <li key={`cot-reason-${idx}`} className={`fund-cot-action-reason fund-cot-action-reason--${row.side}`}>
                            <strong>{row.label}</strong>
                            <span>{row.text}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="fund-cot-action-foot">
                        <span>{cotTraderGuide?.holdTimeframe}</span>
                        <span>{cotTraderGuide?.disclaimer}</span>
                        <span>CFTC report {cotPositioning.reportDate || '—'}</span>
                      </div>
                    </div>

                    <div className="fund-positioning-body">
                      <div className="fund-panel">
                        <div className="fund-panel-header">
                          <h3><TrendingUp size={16} /> Smart money vs Retail</h3>
                          <span className="fund-cot-live-pill"><span className="animate-live-pulse" /> CFTC weekly</span>
                        </div>
                        <p className="fund-cot-section-lead">Institutions (banks, hedge funds) vs the retail crowd on your pair&apos;s base currency.</p>
                        <div className="fund-cot-vs-block">
                          <div className="fund-cot-vs-label">{cotPositioning.base?.currency || 'Base'} — drives {cotPositioning.pair || selectedPairLabel} direction</div>
                          <div className="fund-cot-vs-grid">
                            <FundSmartRetailCard pack={cotPositioning.base} side="smart" currency={cotPositioning.base?.currency} roleLabel="base leg" />
                            <FundSmartRetailCard pack={cotPositioning.base} side="retail" currency={cotPositioning.base?.currency} roleLabel="base leg" />
                          </div>
                        </div>
                        {cotPositioning.quote && cotPositioning.quote.currency !== 'USD' && (
                          <div className="fund-cot-vs-block">
                            <div className="fund-cot-vs-label">{cotPositioning.quote.currency} — quote leg (inverse read for pair)</div>
                            <div className="fund-cot-vs-grid">
                              <FundSmartRetailCard pack={cotPositioning.quote} side="smart" currency={cotPositioning.quote.currency} roleLabel="quote leg" />
                              <FundSmartRetailCard pack={cotPositioning.quote} side="retail" currency={cotPositioning.quote.currency} roleLabel="quote leg" />
                            </div>
                          </div>
                        )}
                        {cotPositioning.divergence && (
                          <div className="fund-cot-divergence-banner animate-enter-fast">
                            <Activity size={14} />
                            <div>
                              <strong>{cotPositioning.divergence.label}</strong>
                              <p>{cotPositioning.divergence.hint}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="fund-panel">
                        <div className="fund-panel-header"><h3><Users size={16} /> All currencies</h3></div>
                        <p className="fund-cot-section-lead">How crowded retail is on each currency (weekly CFTC).</p>
                        <div className="fund-cot-matrix-head">
                          <span>CCY</span>
                          <span>Smart bias</span>
                          <span>Score</span>
                          <span>Retail long</span>
                        </div>
                        <div className="fund-cot-matrix">
                          {cotCurrencyRows.length === 0 && <div className="fund-empty-inline">No COT rows loaded.</div>}
                          {cotCurrencyRows.map((row, idx) => (
                            <div key={`cot-all-${row.currency}`} className="fund-cot-matrix-row animate-enter" style={{ animationDelay: `${idx * 45}ms` }}>
                              <span className="fund-cot-matrix-code">{row.currency}</span>
                              <div className="fund-cot-bar-track fund-cot-bar-track--compact">
                                <div className={`fund-cot-bar-fill ${Number(row.specScore) >= 0 ? 'pos' : 'neg'} fund-cot-bar-animate`} style={{ width: `${Math.max(6, Math.min(100, Math.abs(Number(row.specScore))))}%` }} />
                              </div>
                              <span className={Number(row.specScore) >= 0 ? 'pos' : 'neg'} title="Institutional bias vs other currencies this week">{fmtPct(row.specScore, '')}</span>
                              <span className={`fund-cot-matrix-retail ${row.retailLongPct >= 60 ? 'crowded' : ''}`}>{row.retailLongPct != null ? `${row.retailLongPct}% L` : '—'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'sentiment' && (
              <div className="fund-sentiment-layout">
                <FundSentimentGauges sentiment={data?.sentiment} />
                <FundPositionExposure trades={trades} sentiment={data?.sentiment} selectedPairLabel={selectedPairLabel} />
                <div className="fund-panel">
                  <div className="fund-panel-header">
                    <h3>Retail Positioning (CFTC COT, weekly)</h3>
                    <div className="fund-panel-actions">
                      <select data-testid="fundamentals-filter-sentiment-pair" value={sentimentPairFilter} onChange={(e) => setSentimentPairFilter(e.target.value)} className="fund-select">
                        {sentimentPairOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="fund-sentiment-grid-head">
                    <span>Currency</span>
                    <span>Retail long %</span>
                    <span>Distribution</span>
                    <span>Retail short %</span>
                  </div>
                  <div className="fund-sentiment-list">
                    {cotRetailRows.length === 0 && (
                      <div className="fund-empty-inline">
                        {cotPositioning?.available
                          ? 'No retail positioning rows for this filter.'
                          : (cotPositioning?.reason || 'CFTC COT data unavailable — select a major FX pair.')}
                      </div>
                    )}
                    {cotRetailRows.map((row) => {
                      const longPct = Number(row.retailLongPct);
                      const shortPct = Math.max(0, Math.min(100, 100 - longPct));
                      return (
                        <div className="fund-sentiment-row" key={`cot-retail-${row.currency}`}>
                          <div className="fund-sentiment-symbol">{row.currency}</div>
                          <div className="fund-sentiment-bar-wrap">
                            <div className="fund-sentiment-bar bull" style={{ width: `${longPct}%` }} />
                            <div className="fund-sentiment-bar bear" style={{ width: `${shortPct}%` }} />
                          </div>
                          <div className="fund-sentiment-pct pos">{longPct.toFixed(1)}%</div>
                          <div className="fund-sentiment-pct neg">{shortPct.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                  {cotPositioning?.reportDate && (
                    <div className="fund-empty-inline">CFTC report date: {cotPositioning.reportDate}</div>
                  )}
                </div>
                <div className="fund-panel">
                  <div className="fund-panel-header"><h3>Live Market Sentiment</h3></div>
                  <div className="fund-mini-panel">
                    <div className="fund-mini-row"><span>Cross-asset score</span><span className={Number(data?.sentiment?.score) >= 0 ? 'pos' : 'neg'}>{fmtPct(data?.sentiment?.score, '')}</span></div>
                    <div className="fund-mini-row"><span>Regime</span><span>{data?.sentiment?.regime || 'NEUTRAL'}</span></div>
                    <div className="fund-mini-row"><span>Fear/Greed (Alternative.me)</span><span>{data?.sentiment?.fearGreed?.value ?? '—'}</span></div>
                    <div className="fund-mini-row"><span>VIX (Yahoo)</span><span>{data?.sentiment?.vix ?? '—'}</span></div>
                    <div className="fund-mini-row"><span>DXY change (Yahoo)</span><span>{fmtPct(data?.sentiment?.dxyChange)}</span></div>
                    <div className="fund-mini-row"><span>Volatility regime</span><span>{data?.sentiment?.volatilityRegime || '—'}</span></div>
                    <div className="fund-mini-row"><span>Selected pair</span><span>{selectedPairLabel}</span></div>
                  </div>
                  {cotPositioning?.divergence && (
                    <div className="fund-mini-panel">
                      <h4>Spec vs retail (CFTC)</h4>
                      <div className="fund-empty-inline">
                        <strong>{cotPositioning.divergence.label}</strong> — {cotPositioning.divergence.hint}
                      </div>
                    </div>
                  )}
                  <div className="fund-mini-panel">
                    <h4>Contrarian note</h4>
                    <div className="fund-empty-inline">Extreme retail long % (&gt;70%) from CFTC weekly data can flag crowded positioning — confirm with price structure.</div>
                  </div>
                </div>
              </div>
            )}
            </div>
          </>
        )}

        {(loading && !refreshing) && <div className="fund-loading-overlay animate-fade">Loading real market data...</div>}
      </div>
    </div>
  );
}
