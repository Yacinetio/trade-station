import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { buildExecutionPipeline } from '../utils/executionPipeline.js';
import { formatTradeNewsContextDetail, getTradeNewsContext } from '../utils/tradeNewsContext.js';
import { applyParsedFieldsToTradeEditors, triBandValue, trendAlignValue } from '../utils/manualTradeFormUtils.js';

import TradeReplayChart from './TradeReplayChart.jsx';
import ExcursionPanel from './ExcursionPanel.jsx';
import PsychologyFields from './PsychologyFields.jsx';

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function tradeIsOpen(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (!s) return false;
  if (s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT')) return false;
  if (s.startsWith('FAILED') || s.startsWith('BLOCKED')) return false;
  if (s === 'SIMULATED') return false;
  return true;
}

export default function TradeDetailModal({ trade, onClose, onSave, onSaveJournal, saving = false, tagPresets = [] }) {
  const journal = trade?.journal || {};
  const [notes, setNotes] = useState(journal.notes || '');
  const [tags, setTags] = useState((journal.tags || []).join(', '));
  const [confidence, setConfidence] = useState(Number.isFinite(Number(journal.confidence)) ? Number(journal.confidence) : 5);
  const [emotion, setEmotion] = useState(journal.emotion || '');
  const [rating, setRating] = useState(journal.rating || '');
  const [presetTagsSel, setPresetTagsSel] = useState([]);
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [aiReviewResult, setAiReviewResult] = useState(null);
  const [editTab, setEditTab] = useState('fields');
  const [telegramText, setTelegramText] = useState('');
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState('BUY');
  const [entry, setEntry] = useState('');
  const [signalEntry, setSignalEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [lot, setLot] = useState('');
  const [bias, setBias] = useState('');
  const [fundBias, setFundBias] = useState('');
  const [vwapBand, setVwapBand] = useState('');
  const [hvnBand, setHvnBand] = useState('');
  const [trendAlign, setTrendAlign] = useState('');
  const [obSize, setObSize] = useState('');
  const [avgEntry, setAvgEntry] = useState('');
  const [obEdge, setObEdge] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [applyToMt5, setApplyToMt5] = useState(false);

  useEffect(() => {
    const j = trade?.journal || {};
    setNotes(j.notes || '');
    setTags((j.tags || []).join(', '));
    setConfidence(Number.isFinite(Number(j.confidence)) ? Number(j.confidence) : 5);
    setPresetTagsSel(Array.isArray(trade?.presetTags) ? [...trade.presetTags] : []);
    setAiReviewResult(null);
    setEditTab('fields');
    setParseError('');
    setSymbol(String(trade?.symbol || '').trim().toUpperCase());
    setType(String(trade?.type || 'BUY').trim().toUpperCase());
    setEntry(trade?.entry != null && Number(trade.entry) > 0 ? String(trade.entry) : '');
    setSignalEntry(trade?.signalEntry != null && Number(trade.signalEntry) > 0 ? String(trade.signalEntry) : '');
    setSl(trade?.sl != null && Number(trade.sl) > 0 ? String(trade.sl) : '');
    setTp(trade?.tp != null && Number(trade.tp) > 0 ? String(trade.tp) : '');
    setLot(trade?.lot != null && Number(trade.lot) > 0 ? String(trade.lot) : '');
    setBias(String(trade?.bias || '').trim());
    setFundBias(String(trade?.fundBias || '').trim().toUpperCase());
    setVwapBand(triBandValue(trade?.vwapBand));
    setHvnBand(triBandValue(trade?.hvnBand));
    setTrendAlign(trendAlignValue(trade?.trendAlign));
    setObSize(String(trade?.obSize || '').trim());
    setAvgEntry(trade?.avgEntry != null && Number(trade.avgEntry) > 0 ? String(trade.avgEntry) : '');
    setObEdge(trade?.obEdge != null && Number(trade.obEdge) > 0 ? String(trade.obEdge) : '');
    setTimeframe(String(trade?.timeframe || '').trim());
    setApplyToMt5(false);
  }, [trade]);

  const handleRegenerateAiReview = useCallback(async () => {
    if (!trade?.id || aiReviewLoading) return;
    setAiReviewLoading(true);
    try {
      const result = await window.electronAPI?.analyzeClosedTrade?.(trade.id);
      setAiReviewResult(result || null);
    } catch {
      setAiReviewResult({ ok: false, error: 'Request failed' });
    } finally {
      setAiReviewLoading(false);
    }
  }, [trade?.id, aiReviewLoading]);

  const payload = useMemo(
    () => ({
      notes: notes.trim(),
      tags: parseList(tags),
      confidence: Number(confidence),
      emotion,
      rating,
      presetTags: [...new Set(presetTagsSel.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50)
    }),
    [notes, tags, confidence, emotion, rating, presetTagsSel]
  );

  const tradePatch = useMemo(
    () => ({
      symbol: symbol.trim(),
      type: type.trim(),
      entry: entry.trim(),
      signalEntry: signalEntry.trim(),
      sl: sl.trim(),
      tp: tp.trim(),
      lot: lot.trim(),
      bias: bias.trim(),
      fundBias: fundBias.trim(),
      vwapBand,
      hvnBand,
      trendAlign,
      obSize: obSize.trim(),
      avgEntry: avgEntry.trim(),
      obEdge: obEdge.trim(),
      timeframe: timeframe.trim()
    }),
    [symbol, type, entry, signalEntry, sl, tp, lot, bias, fundBias, vwapBand, hvnBand, trendAlign, obSize, avgEntry, obEdge, timeframe]
  );

  const handleParseTelegram = useCallback(async () => {
    setParseError('');
    setParsing(true);
    try {
      const res = await window.electronAPI?.parseManualTelegram?.({ text: telegramText });
      if (!res?.ok) {
        setParseError(res?.error || 'Could not parse message.');
        return;
      }
      applyParsedFieldsToTradeEditors(res.fields, {
        setSymbol,
        setType,
        setEntry,
        setSignalEntry,
        setSl,
        setTp,
        setLot,
        setTimeframe,
        setBias,
        setVwapBand,
        setHvnBand,
        setTrendAlign,
        setObSize,
        setAvgEntry,
        setObEdge
      });
      setEditTab('fields');
    } catch (e) {
      setParseError(e?.message || 'Parse failed.');
    } finally {
      setParsing(false);
    }
  }, [telegramText]);

  const canApplyMt5 = useMemo(() => {
    if (!tradeIsOpen(trade)) return false;
    const ticket = String(trade?.mt5PositionId || trade?.mt5Ticket || '').trim();
    return ticket.length > 0 && ticket !== '0';
  }, [trade]);

  const handleSave = useCallback(async () => {
    if (onSave) {
      await onSave({ patch: tradePatch, journalPatch: payload, applyToMt5: canApplyMt5 && applyToMt5 });
      return;
    }
    await onSaveJournal?.(payload);
  }, [onSave, onSaveJournal, tradePatch, payload, canApplyMt5, applyToMt5]);

  const showAiStrip =
    Number.isFinite(Number(trade?.journal?.aiChartConfidence)) ||
    trade?.aiCheck?.summary ||
    trade?.aiCheck?.entryVsChart ||
    trade?.aiCheck?.tfBiasVsStructure ||
    trade?.aiCheck?.adjustHint;

  const pipelineSteps = useMemo(() => buildExecutionPipeline(trade), [trade]);
  const newsContext = useMemo(() => getTradeNewsContext(trade), [trade]);
  const newsContextDetail = useMemo(() => formatTradeNewsContextDetail(trade), [trade]);

  return (
    <div className="modal-overlay trade-detail-modal-overlay" onClick={onClose}>
      <div className="modal trade-journal-modal trade-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ marginBottom: 4 }}>Trade Detail - {trade?.symbol} {trade?.type}</h2>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)' }}>
              Paste a Telegram OB block or edit fields. Save updates this row.
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>x</button>
        </div>

        <div className="modal-body trade-detail-body">
          <section className="settings-section trade-detail-section" style={{ marginBottom: 0 }}>
            <div className="analytics-tabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`analytics-tab-btn ${editTab === 'paste' ? 'active' : ''}`}
                onClick={() => setEditTab('paste')}
              >
                Paste Telegram
              </button>
              <button
                type="button"
                className={`analytics-tab-btn ${editTab === 'fields' ? 'active' : ''}`}
                onClick={() => setEditTab('fields')}
              >
                Edit fields
              </button>
            </div>

            {editTab === 'paste' && (
              <>
                <div className="form-group">
                  <label>Telegram signal message</label>
                  <textarea
                    className="select-field manual-trade-textarea"
                    rows={10}
                    value={telegramText}
                    onChange={(e) => setTelegramText(e.target.value)}
                    placeholder={'Signal: BUY GBPJPY M10\nEntry: 212.906\nSL: 212.819\nTP: 213.017\nVWAP: YES\nHVN: NO\n...'}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={parsing || !telegramText.trim()}
                  onClick={handleParseTelegram}
                >
                  {parsing ? 'Parsing…' : 'Parse into fields'}
                </button>
                {parseError ? (
                  <div className="hint" style={{ color: 'var(--danger)', marginTop: 8 }}>{parseError}</div>
                ) : (
                  <div className="hint" style={{ marginTop: 10 }}>
                    Parses the same OB-stats block as <strong>Add manual trade</strong>. Review on Edit fields, then Save.
                  </div>
                )}
              </>
            )}

            {editTab === 'fields' && (
              <>
            <h3>Execution</h3>
            <div className="trade-detail-exec-grid">
              <div className="form-group">
                <label>Status</label>
                <input className="select-field" readOnly value={trade?.status || '-'} />
              </div>
              <div className="form-group">
                <label>Channel</label>
                <input className="select-field" readOnly value={trade?.channel || '-'} />
              </div>
              <div className="form-group">
                <label>Symbol</label>
                <input className="select-field" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select className="select-field" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div className="form-group">
                <label>Chart TF</label>
                <input className="select-field" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="M15, H1…" />
              </div>
              <div className="form-group trade-detail-bias">
                <label>Bias</label>
                <input className="select-field" value={bias} onChange={(e) => setBias(e.target.value)} placeholder="Signal bias text" />
              </div>
              <div className="form-group">
                <label>Fundamentals (FUND)</label>
                <select className="select-field" value={fundBias} onChange={(e) => setFundBias(e.target.value)}>
                  <option value="">—</option>
                  <option value="BULLISH">BULLISH</option>
                  <option value="BEARISH">BEARISH</option>
                  <option value="NEUTRAL">NEUTRAL</option>
                </select>
              </div>
              <div className="form-group">
                <label>VWAP ±1σ</label>
                <select className="select-field" value={vwapBand} onChange={(e) => setVwapBand(e.target.value)} title="OB STATS: OB intersects ±1σ band">
                  <option value="">—</option>
                  <option value="yes">YES</option>
                  <option value="no">NO</option>
                  <option value="na">n/a</option>
                </select>
              </div>
              <div className="form-group">
                <label>HVN</label>
                <select className="select-field" value={hvnBand} onChange={(e) => setHvnBand(e.target.value)} title="OB STATS: OB overlaps HVN cluster">
                  <option value="">—</option>
                  <option value="yes">YES</option>
                  <option value="no">NO</option>
                  <option value="na">n/a</option>
                </select>
              </div>
              <div className="form-group">
                <label>Trend</label>
                <select className="select-field" value={trendAlign} onChange={(e) => setTrendAlign(e.target.value)} title="OB STATS: direction vs TF EMA">
                  <option value="">—</option>
                  <option value="with">WITH</option>
                  <option value="against">AGAINST</option>
                  <option value="neutral">NEUTRAL</option>
                  <option value="na">n/a</option>
                </select>
              </div>
              <div className="form-group">
                <label>OB size</label>
                <input className="select-field" value={obSize} onChange={(e) => setObSize(e.target.value)} placeholder="pips" />
              </div>
              <div className="form-group trade-detail-span-full">
                <label>Setup column (presets)</label>
                <p className="trade-detail-setup-hint">
                  Toggle labels from Settings → Trading. Saved with journal. Matches Setup filters when any selected tag is on the trade.
                </p>
                {Array.isArray(tagPresets) && tagPresets.length > 0 ? (
                  <div className="trade-detail-preset-chips">
                    {tagPresets.map((p) => {
                      const label = String(p || '').trim();
                      if (!label) return null;
                      const on = presetTagsSel.some((x) => String(x).toLowerCase() === label.toLowerCase());
                      return (
                        <button
                          key={label}
                          type="button"
                          className={on ? 'btn btn-primary' : 'btn btn-outline'}
                          style={{ fontSize: 11, padding: '4px 12px' }}
                          onClick={() => {
                            const low = label.toLowerCase();
                            setPresetTagsSel((prev) => {
                              if (prev.some((x) => String(x).toLowerCase() === low)) {
                                return prev.filter((x) => String(x).toLowerCase() !== low);
                              }
                              return [...prev, label];
                            });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Add presets under Settings → Trading.</div>
                )}
                {String(trade?.setup || '').trim() ? (
                  <div className="hint" style={{ marginTop: 8 }}>
                    Legacy signal setup: {String(trade.setup).trim()}
                  </div>
                ) : null}
              </div>
              <div className="form-group">
                <label>Signal ENTRY (SIG @)</label>
                <input className="select-field" value={signalEntry} onChange={(e) => setSignalEntry(e.target.value)} placeholder="Telegram line" />
              </div>
              <div className="form-group">
                <label>Executed entry (EXEC @)</label>
                <input className="select-field" value={entry} onChange={(e) => setEntry(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Stop loss</label>
                <input className="select-field" value={sl} onChange={(e) => setSl(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Take profit</label>
                <input className="select-field" value={tp} onChange={(e) => setTp(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Lot</label>
                <input className="select-field" value={lot} onChange={(e) => setLot(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Avg entry</label>
                <input className="select-field" value={avgEntry} onChange={(e) => setAvgEntry(e.target.value)} />
              </div>
              <div className="form-group">
                <label>OB edge</label>
                <input className="select-field" value={obEdge} onChange={(e) => setObEdge(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Profit</label>
                <input className="select-field" readOnly value={`${Number(trade?.profit || 0).toFixed(2)}$`} />
              </div>
              {newsContext ? (
                <div className="form-group trade-detail-span-full trade-detail-news-context">
                  <label>News context</label>
                  <input
                    className="select-field"
                    readOnly
                    value={newsContext.label}
                    title={newsContextDetail}
                  />
                  <p className="hint" style={{ marginTop: 6 }}>
                    {newsContext.blocked
                      ? 'High-impact news was active when this signal was blocked.'
                      : `High-impact ${newsContext.country || 'macro'} news released ${newsContext.minutesAgo ?? '—'}m before this signal (after your block window).`}
                  </p>
                </div>
              ) : null}
            </div>
              </>
            )}
          </section>

          <section className="settings-section trade-detail-section" style={{ marginBottom: 0 }}>
            <h3>Execution pipeline</h3>
            <div className="execution-pipeline">
              {pipelineSteps.map((step) => (
                <div key={step.id} className={`execution-pipeline-step execution-pipeline-step--${step.state}`}>
                  <div className="execution-pipeline-dot" />
                  <div>
                    <strong>{step.label}</strong>
                    {step.duration && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text3)' }}>{step.duration}</span>}
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <ExcursionPanel trade={trade} />
          <section className="settings-section trade-detail-section" style={{ marginBottom: 0 }}>
            <h3>Journal</h3>
            <div className="trade-detail-journal-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Tags (comma separated)</label>
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag one, tag two" />
                {Array.isArray(tagPresets) && tagPresets.length > 0 ? (
                  <div className="trade-detail-tag-presets">
                    <span className="trade-detail-tag-presets-label">Quick add (Settings → Trading)</span>
                    <div className="trade-detail-preset-chips trade-detail-preset-chips--dense">
                      {tagPresets.map((p) => {
                        const label = String(p || '').trim();
                        if (!label) return null;
                        const curLower = parseList(tags).map((x) => x.toLowerCase());
                        const taken = curLower.includes(label.toLowerCase());
                        return (
                          <button
                            key={`tag-${label}`}
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: 11, padding: '4px 12px', opacity: taken ? 0.45 : 1 }}
                            disabled={taken}
                            title={taken ? 'Already in tags' : `Add “${label}” to tags`}
                            onClick={() => {
                              const cur = parseList(tags);
                              setTags([...cur, label].join(', '));
                            }}
                          >
                            + {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="form-group trade-detail-confidence" style={{ marginBottom: 0 }}>
                <label>Confidence ({confidence}/10)</label>
                <input type="range" min="0" max="10" step="1" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
                <div className="trade-detail-confidence-hint">
                  Manual journal rating. Separate from AI chart confidence when stored on this trade.
                </div>
              </div>
              <PsychologyFields
                emotion={emotion}
                rating={rating}
                onEmotionChange={setEmotion}
                onRatingChange={setRating}
              />
            </div>
          </section>

          <section className="settings-section trade-detail-section trade-detail-notes-section" style={{ marginBottom: 0 }}>
            <h3>Notes</h3>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <textarea
                className="journal-textarea trade-detail-notes-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Plan, review, AI summaries…"
              />
            </div>
          </section>

          <section className="settings-section trade-detail-section" style={{ marginBottom: 0 }}>
            <h3>AI Review</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!aiReviewLoading && !aiReviewResult && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleRegenerateAiReview}
                  style={{ alignSelf: 'flex-start' }}
                >
                  🤖 Regenerate AI Review
                </button>
              )}
              {aiReviewLoading && (
                <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="skeleton" style={{ width: 16, height: 16, borderRadius: '50%', display: 'inline-block' }} />
                  Generating AI review…
                </div>
              )}
              {aiReviewResult && !aiReviewResult.ok && (
                <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 10px', background: 'rgba(255,92,117,0.08)', borderRadius: 6 }}>
                  AI review unavailable: {aiReviewResult.error || 'unknown error'}
                </div>
              )}
              {aiReviewResult?.ok && (
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {aiReviewResult.chartConfidence != null && (
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                      Chart confidence: <strong style={{ color: 'var(--accent)' }}>{aiReviewResult.chartConfidence}%</strong>
                    </div>
                  )}
                  {aiReviewResult.headline && (
                    <div style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 600 }}>{aiReviewResult.headline}</div>
                  )}
                  {aiReviewResult.tradeNote && (
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>{aiReviewResult.tradeNote}</div>
                  )}
                  {(aiReviewResult.wins_list || []).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--success)' }}>
                      ✓ {aiReviewResult.wins_list.join(' · ')}
                    </div>
                  )}
                  {(aiReviewResult.leaks || []).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--danger)' }}>
                      ✗ {aiReviewResult.leaks.join(' · ')}
                    </div>
                  )}
                  {aiReviewResult.next_action && (
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                      → {aiReviewResult.next_action}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="settings-section trade-detail-section trade-detail-chart-section" style={{ marginBottom: 0 }}>
            {showAiStrip ? (
              <div className="trade-detail-ai-strip">
                <div className="trade-detail-ai-strip-title">AI (stored)</div>
                {Number.isFinite(Number(trade?.journal?.aiChartConfidence)) ? (
                  <div className="trade-detail-ai-confidence">
                    Chart confidence: {Math.round(Number(trade.journal.aiChartConfidence))}%
                  </div>
                ) : null}
                {trade?.aiCheck?.summary ? (
                  <div className="trade-detail-ai-line">
                    <strong>Signal check</strong>
                    {trade.aiCheck.score != null ? ` (${trade.aiCheck.score}% · ${trade.aiCheck.action || 'allow'})` : ''}:{' '}
                    {trade.aiCheck.summary}
                  </div>
                ) : null}
                {trade?.aiCheck?.entryVsChart ? (
                  <div className="trade-detail-ai-line trade-detail-ai-line--accent">
                    <strong>Entry vs chart:</strong> {trade.aiCheck.entryVsChart}
                  </div>
                ) : null}
                {trade?.aiCheck?.tfBiasVsStructure ? (
                  <div className="trade-detail-ai-line trade-detail-ai-line--accent">
                    <strong>TF bias vs structure:</strong> {trade.aiCheck.tfBiasVsStructure}
                  </div>
                ) : null}
                {trade?.aiCheck?.adjustHint ? (
                  <div className="trade-detail-ai-line trade-detail-ai-line--accent">
                    <strong>Adjust hint:</strong> {trade.aiCheck.adjustHint}
                  </div>
                ) : null}
              </div>
            ) : null}
            <TradeReplayChart trade={trade} />
          </section>
        </div>

        <div className="modal-footer trade-detail-footer">
          <div className="trade-detail-footer-left">
            {canApplyMt5 ? (
              <label className="trade-detail-mt5-apply">
                <input type="checkbox" checked={applyToMt5} onChange={(e) => setApplyToMt5(e.target.checked)} />
                Apply SL/TP to MT5 position
              </label>
            ) : null}
          </div>
          <div className="trade-detail-footer-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
