import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Landmark, RefreshCw, Sparkles } from 'lucide-react';
import {
  DIGEST_ALL_ASSET_CLASSES,
  buildFundamentalsDigest,
  buildFundamentalsDigestAiContext,
  normalizeDigestAssetClasses
} from '../utils/fundamentalsDigest.js';

const AI_NOTE_STORAGE_PREFIX = 'ts-fund-digest-ai:v1:';
const COVERAGE_LS_KEY = 'ts-fund-digest-coverage-v1';

const COVERAGE_LABELS = {
  forex: 'Forex',
  commodities: 'Commodities',
  indices: 'Indices',
  crypto: 'Crypto'
};

function fmtEta(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return '';
  if (m < 0) return `${Math.abs(Math.round(m))}m ago`;
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `in ${h}h ${rem}m`;
}

function chipTone(direction) {
  const d = String(direction || '').toUpperCase();
  if (d === 'BULLISH') return 'fund-digest-chip--bull';
  if (d === 'BEARISH') return 'fund-digest-chip--bear';
  return 'fund-digest-chip--flat';
}

function setupToneClass(tone) {
  const t = String(tone || '').toLowerCase();
  if (t === 'strong' || t === 'long') return 'fund-digest-setup--pos';
  if (t === 'short') return 'fund-digest-setup--neg';
  return 'fund-digest-setup--neu';
}

function currencyStrengthPillClass(bias) {
  const b = String(bias || '').toUpperCase();
  if (b === 'STRONG') return 'fund-digest-cs-pill fund-digest-cs-pill--strong';
  if (b === 'BULLISH') return 'fund-digest-cs-pill fund-digest-cs-pill--bull';
  if (b === 'WEAK') return 'fund-digest-cs-pill fund-digest-cs-pill--weak';
  if (b === 'BEARISH') return 'fund-digest-cs-pill fund-digest-cs-pill--bear';
  return 'fund-digest-cs-pill fund-digest-cs-pill--neutral';
}

function readCoverageFromLs() {
  try {
    const raw = window.localStorage.getItem(COVERAGE_LS_KEY);
    if (!raw) return [...DIGEST_ALL_ASSET_CLASSES];
    const parsed = JSON.parse(raw);
    return normalizeDigestAssetClasses(parsed);
  } catch (_) {
    return [...DIGEST_ALL_ASSET_CLASSES];
  }
}

function writeCoverageToLs(list) {
  try {
    window.localStorage.setItem(COVERAGE_LS_KEY, JSON.stringify(normalizeDigestAssetClasses(list)));
  } catch (_) { /* noop */ }
}

export default function FundamentalsDigestCard({
  routeVisible = true,
  aiEnabled = false,
  onOpenFundamentals
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [aiNote, setAiNote] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [assetClasses, setAssetClasses] = useState(readCoverageFromLs);

  useEffect(() => {
    writeCoverageToLs(assetClasses);
  }, [assetClasses]);

  const digest = useMemo(
    () => buildFundamentalsDigest(data, { assetClasses }),
    [data, assetClasses]
  );

  const toggleAssetClass = useCallback((key) => {
    const k = String(key || '').toLowerCase();
    if (!DIGEST_ALL_ASSET_CLASSES.includes(k)) return;
    setAssetClasses((prev) => {
      const cur = normalizeDigestAssetClasses(prev);
      const has = cur.includes(k);
      if (has && cur.length <= 1) return cur;
      if (has) return cur.filter((x) => x !== k);
      return [...cur, k].sort((a, b) => DIGEST_ALL_ASSET_CLASSES.indexOf(a) - DIGEST_ALL_ASSET_CLASSES.indexOf(b));
    });
  }, []);

  useEffect(() => {
    if (!aiEnabled) setAiNote('');
  }, [aiEnabled]);

  const loadDashboard = useCallback(async (forceRefresh) => {
    if (!window.electronAPI?.getFundamentalsDashboard) {
      setLoading(false);
      setFetchError('Unavailable');
      return;
    }
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError('');
    try {
      const payload = await window.electronAPI.getFundamentalsDashboard({ forceRefresh: !!forceRefresh });
      setData(payload && typeof payload === 'object' ? payload : null);
      if (payload?.unavailable && !payload?.hasRealData) {
        setFetchError(payload?.unavailableReason || 'Fundamentals data unavailable.');
      }
    } catch (e) {
      setData(null);
      setFetchError(e?.message || 'Could not load fundamentals.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!routeVisible) return undefined;
    const t = window.setTimeout(() => {
      loadDashboard(false);
    }, 220);
    return () => window.clearTimeout(t);
  }, [routeVisible, loadDashboard]);

  useEffect(() => {
    if (!routeVisible || !aiEnabled || !digest?.generatedAt) return;
    if (!window.electronAPI?.getFundamentalsDigestAi) return;

    const cov = (digest.coverage || []).slice().sort().join('|');
    const cacheKey = `${AI_NOTE_STORAGE_PREFIX}${digest.generatedAt}:${cov}`;
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.note) {
          setAiNote(String(parsed.note));
          return;
        }
      }
    } catch (_) {
      /* use network */
    }

    const ctx = buildFundamentalsDigestAiContext(digest, data);
    if (!ctx) return;

    let cancelled = false;
    setAiLoading(true);
    window.electronAPI.getFundamentalsDigestAi({ context: ctx })
      .then((res) => {
        if (cancelled) return;
        if (res?.ok && res.note) {
          const note = String(res.note);
          setAiNote(note);
          try {
            window.sessionStorage.setItem(cacheKey, JSON.stringify({ note }));
          } catch (_) { /* noop */ }
        } else {
          setAiNote('');
        }
      })
      .catch(() => {
        if (!cancelled) setAiNote('');
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeVisible, aiEnabled, digest, data]);

  const verdictClass = (() => {
    const v = String(digest?.verdict || 'WAIT').toUpperCase();
    if (v === 'GO') return 'verdict-go';
    if (v === 'NO_GO') return 'verdict-no_go';
    return 'verdict-wait';
  })();

  const rowMeta = (() => {
    if (!digest) return '';
    const parts = [
      digest.marketBias,
      digest.regime?.replace(/_/g, ' ') || ''
    ].filter(Boolean);
    return parts.join(' · ');
  })();

  const coverageSummary = useMemo(() => {
    const norm = normalizeDigestAssetClasses(assetClasses);
    if (norm.length === DIGEST_ALL_ASSET_CLASSES.length) return 'All markets';
    let s = norm.map((k) => COVERAGE_LABELS[k] || k).join(' · ');
    if (norm.length === 1 && norm[0] === 'forex') s += ' · USD majors';
    return s;
  }, [assetClasses]);

  const checklistChipTone = useCallback((st) => {
    const x = String(st || '').toLowerCase();
    if (x === 'pass') return 'fund-digest-check-chip fund-digest-check-chip--pass';
    if (x === 'warn') return 'fund-digest-check-chip fund-digest-check-chip--warn';
    if (x === 'fail') return 'fund-digest-check-chip fund-digest-check-chip--fail';
    return 'fund-digest-check-chip';
  }, []);

  if (!routeVisible) return null;

  return (
    <div className="analytics-card fund-digest-card" data-testid="dashboard-fundamentals-digest">
      <div className="fund-digest-head">
        <div className="fund-digest-head-left">
          <span className="fund-digest-icon" aria-hidden><Landmark size={14} /></span>
          <div>
            <div className="fund-digest-title-row">
              <span className="fund-digest-title">Today&apos;s fundamentals</span>
              {aiEnabled && (
                <span className="fund-digest-ai-badge" title="Desk note uses the same free AI as Headlines when enabled in Settings">
                  <Sparkles size={11} />
                  AI
                </span>
              )}
            </div>
            <div className="fund-digest-meta">
              {loading ? 'Loading snapshot…' : (rowMeta || 'Macro snapshot')}
              {digest?.stale && <span className="fund-digest-stale">Stale</span>}
            </div>
            <div className="fund-digest-coverage-row" aria-label="Instrument coverage">
              <span className="fund-digest-coverage-label">Show</span>
              <div className="fund-digest-coverage-toggles">
                {DIGEST_ALL_ASSET_CLASSES.map((id) => {
                  const on = normalizeDigestAssetClasses(assetClasses).includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`fund-digest-coverage-pill ${on ? 'is-on' : ''}`}
                      aria-pressed={on}
                      title={
                        normalizeDigestAssetClasses(assetClasses).length <= 1 && on
                          ? 'At least one market type must stay selected'
                          : `Toggle ${COVERAGE_LABELS[id] || id} in this digest`
                      }
                      onClick={() => toggleAssetClass(id)}
                    >
                      {COVERAGE_LABELS[id] || id}
                    </button>
                  );
                })}
              </div>
              <span className="fund-digest-coverage-hint" title="Filters strongest/weakest screens and setups below">
                {coverageSummary}
              </span>
            </div>
          </div>
        </div>
        <div className="fund-digest-head-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm fund-digest-refresh"
            title="Refresh fundamentals cache"
            disabled={refreshing || loading}
            onClick={() => loadDashboard(true)}
          >
            <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
          </button>
          {typeof onOpenFundamentals === 'function' && (
            <button
              type="button"
              className="btn btn-outline btn-sm fund-digest-open"
              onClick={() => onOpenFundamentals()}
            >
              Open
              <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {fetchError && !digest && (
        <div className="fund-digest-empty">{fetchError}</div>
      )}

      {digest && (
        <>
          <div className={`fund-digest-kicker fund-summary-card ${verdictClass}`} style={{ minHeight: 'unset', padding: '8px 10px', marginBottom: 8 }}>
            <div className="fund-digest-kicker-row">
              <span className="fund-digest-verdict">{digest.verdict}</span>
              <span className="fund-digest-score">
                {Number.isFinite(digest.score) ? `${digest.score >= 0 ? '+' : ''}${digest.score.toFixed(0)} pts` : ''}
                {Number.isFinite(digest.confidence) ? ` · ${digest.confidence.toFixed(0)}% conf` : ''}
              </span>
            </div>
            {digest.driver && <div className="fund-digest-driver">{digest.driver}</div>}
            {digest.nextEventLabel && (
              <div className="fund-digest-next">
                Next: {digest.nextEventLabel}
                {digest.nextEventEta != null && (
                  <span className="fund-digest-next-eta">{` · ${fmtEta(digest.nextEventEta)}`}</span>
                )}
              </div>
            )}
          </div>

          {(Array.isArray(digest.pulseHeadlines) && digest.pulseHeadlines.length > 0) && (
            <div className="fund-digest-details">
              <div className="fund-digest-details-label">Macro pulse</div>
              <div className="fund-digest-pulse-list">
                {digest.pulseHeadlines.map((p) => (
                  <div key={p.id || p.title} className="fund-digest-pulse-row">
                    <div className="fund-digest-pulse-title">{p.title}</div>
                    {p.summary ? <div className="fund-digest-pulse-sum">{p.summary}</div> : null}
                    {p.category ? <div className="fund-digest-pulse-meta">{p.category}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(Array.isArray(digest.checklistItemsTop) && digest.checklistItemsTop.length > 0) && (
            <div className="fund-digest-details">
              <div className="fund-digest-details-label">
                Desk checklist{digest.checklistSummary ? ` · ${digest.checklistSummary}` : ''}
              </div>
              <div className="fund-digest-checklist">
                {digest.checklistItemsTop.map((it) => (
                  <span
                    key={it.key || it.label}
                    className={checklistChipTone(it.status)}
                    title={it.detail || it.label}
                  >
                    {it.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(Array.isArray(digest.currencyStrength) && digest.currencyStrength.length > 0) && (
            <div className="fund-digest-details">
              <div className="fund-digest-details-label">Currency strength</div>
              <p className="fund-digest-cs-caption">Strongest → weakest (majors snapshot)</p>
              <div className="fund-digest-currency-strength">
                {digest.currencyStrength.map((row) => (
                  <span
                    key={row.currency}
                    className={currencyStrengthPillClass(row.bias)}
                    title={`${row.currency} · score ${Number.isFinite(row.score) ? row.score.toFixed(1) : 'n/a'} · ${row.bias}`}
                  >
                    <span className="fund-digest-cs-code">{row.currency}</span>
                    {Number.isFinite(row.score) ? (
                      <span className="fund-digest-cs-score">
                        {row.score >= 0 ? '+' : ''}
                        {row.score.toFixed(0)}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(aiEnabled && (aiLoading || aiNote)) && (
            <div className={`fund-digest-ai-note ${aiLoading ? 'fund-digest-ai-note--loading' : ''}`}>
              {aiLoading && !aiNote ? 'AI desk note…' : aiNote}
            </div>
          )}

          <div className="fund-digest-columns">
            <div className="fund-digest-col">
              <div className="fund-digest-col-label">Focus</div>
              <div className="fund-digest-chips">
                {digest.focus.length === 0 && <span className="fund-digest-muted">—</span>}
                {digest.focus.map((x) => (
                  <span
                    key={x.symbol}
                    className={`fund-digest-chip ${chipTone(x.direction)}`}
                    title={`${x.assetClass ? `${x.assetClass} · ` : ''}${Number.isFinite(x.trendScore) ? `Trend ${x.trendScore}` : 'Trend n/a'}`}
                  >
                    <span className="fund-digest-chip-sym">{x.symbol}</span>
                    {Number.isFinite(x.trendScore) ? (
                      <span className="fund-digest-chip-ts">{x.trendScore}</span>
                    ) : null}
                    {x.assetClass ? (
                      <span className="fund-digest-chip-class">{x.assetClass.slice(0, 3)}</span>
                    ) : null}
                    <span className="fund-digest-chip-glyph">{x.direction === 'BULLISH' ? '↑' : x.direction === 'BEARISH' ? '↓' : '·'}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="fund-digest-col">
              <div className="fund-digest-col-label">Stand aside</div>
              <div className="fund-digest-chips">
                {digest.ignore.length === 0 && <span className="fund-digest-muted">—</span>}
                {digest.ignore.map((x) => (
                  <span
                    key={x.symbol}
                    className={`fund-digest-chip ${chipTone(x.direction)}`}
                    title={`${x.assetClass ? `${x.assetClass} · ` : ''}${Number.isFinite(x.trendScore) ? `Trend ${x.trendScore}` : 'Trend n/a'}`}
                  >
                    <span className="fund-digest-chip-sym">{x.symbol}</span>
                    {Number.isFinite(x.trendScore) ? (
                      <span className="fund-digest-chip-ts">{x.trendScore}</span>
                    ) : null}
                    {x.assetClass ? (
                      <span className="fund-digest-chip-class">{x.assetClass.slice(0, 3)}</span>
                    ) : null}
                    <span className="fund-digest-chip-glyph">{x.direction === 'BULLISH' ? '↑' : x.direction === 'BEARISH' ? '↓' : '·'}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="fund-digest-col fund-digest-col-wide">
              <div className="fund-digest-col-label">Setups</div>
              <div className="fund-digest-setups">
                {digest.setups.length === 0 && <span className="fund-digest-muted">—</span>}
                {digest.setups.map((s) => (
                  <div key={s.id} className={`fund-digest-setup ${setupToneClass(s.tone)}`}>
                    <span className="fund-digest-setup-title">{s.title}</span>
                    <span className="fund-digest-setup-sub">{s.sub}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
