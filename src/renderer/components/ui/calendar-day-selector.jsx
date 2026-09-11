import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Clock, Grid3X3, ChevronDown } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { sortTradeScreenshotsForDisplay } from '../../utils/tradeScreenshotsDisplay.js';
import { useScreenshotViewerKeys } from '../../hooks/useScreenshotViewerKeys.js';
import { getTradeOutcome, isClosedTradeLossForStats, isClosedTradeWinForStats } from '../../utils/tradeStatus.js';

/**
 * CalendarDaySelector Component
 * Displays an interactive calendar for TradeSync
 * - Click on a day to select it
 * - Opens a modal showing trades for that day
 * - Shows daily P&L and trade count
 */

function toDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseTradeDate(trade) {
  const d = new Date(trade.openedAt || trade.lastUpdateAt || trade.time);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRangeLabel(range) {
  if (!range?.from && !range?.to) return 'Select date range';
  if (range?.from && !range?.to) return range.from.toLocaleDateString();
  return `${range.from.toLocaleDateString()} - ${range.to.toLocaleDateString()}`;
}

export default function CalendarDaySelector({
  trades = [],
  onOpenTradeDetail = null,
  onDaySelected = null,
  currentDate = new Date(),
  onDateChange = null,
  onViewChange = null,
  selectedRange = null,
  onRangeChange = null,
  onHeightChange = null,
  showViewControls = true,
  showRangeControls = true,
  compact = false,
  /** Same band as Settings → Analytics "BE band" (USD); SL/TP flips inside ±band count as BE, not loss. */
  analyticsBreakEvenAmount = 50,
  className = '',
  style = {},
}) {
  const rootRef = useRef(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [displayDate, setDisplayDate] = useState(new Date(currentDate));
  const [showDayModal, setShowDayModal] = useState(false);
  const [view, setView] = useState('month');
  const [showRangePopover, setShowRangePopover] = useState(false);
  const [range, setRange] = useState({ from: undefined, to: undefined });
  const [draftRange, setDraftRange] = useState({ from: undefined, to: undefined });
  useEffect(() => {
    if (!showViewControls && view !== 'month') {
      setView('month');
    }
  }, [showViewControls, view]);

  useEffect(() => {
    if (!selectedRange) return;
    setRange({
      from: selectedRange.from || undefined,
      to: selectedRange.to || undefined
    });
  }, [selectedRange?.from, selectedRange?.to]);

  const [shotsTrade, setShotsTrade] = useState(null);
  const [activeShotIdx, setActiveShotIdx] = useState(0);
  const shotsDisplayList = useMemo(
    () => sortTradeScreenshotsForDisplay(shotsTrade?.screenshots),
    [shotsTrade?.screenshots]
  );
  useScreenshotViewerKeys(!!shotsTrade, shotsDisplayList.length, setActiveShotIdx);

  const rangeFilteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      const d = parseTradeDate(trade);
      if (!d) return false;
      if (range.from) {
        const start = new Date(range.from);
        start.setHours(0, 0, 0, 0);
        if (d < start) return false;
      }
      if (range.to) {
        const end = new Date(range.to);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
      return true;
    });
  }, [trades, range]);

  // Get trades for a specific day
  const getTradesForDay = (date) => {
    const key = toDayKey(date);
    return rangeFilteredTrades.filter((trade) => {
      const d = parseTradeDate(trade);
      return d && toDayKey(d) === key;
    });
  };

  const beBand = Math.max(0, Number(analyticsBreakEvenAmount) || 0);

  // Calculate daily stats (W/L match dashboard analytics; BE & EOD excluded from W/L)
  const getDayStats = (date) => {
    const dayTrades = getTradesForDay(date);
    let totalProfit = 0;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let eodCloses = 0;
    let otherCloses = 0;

    dayTrades.forEach((trade) => {
      const p = Number(trade.profit || 0);
      totalProfit += p;
      const outcome = getTradeOutcome(trade, beBand);
      if (outcome === 'BE') breakevens += 1;
      else if (outcome === 'EOD') eodCloses += 1;
      else if (outcome === 'CLOSED') otherCloses += 1;
      else if (isClosedTradeWinForStats(trade, beBand)) wins += 1;
      else if (isClosedTradeLossForStats(trade, beBand)) losses += 1;
    });

    return {
      trades: dayTrades,
      count: dayTrades.length,
      profit: totalProfit,
      wins,
      losses,
      breakevens,
      eodCloses,
      otherCloses
    };
  };

  const getWeekDays = (baseDate) => {
    const start = new Date(baseDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  };

  const generateMonthCells = () => {
    const first = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  };

  const handleDayClick = (date) => {
    setSelectedDate(date);
    if (onDaySelected) {
      onDaySelected(date);
      return;
    }
    setShowDayModal(true);
  };

  const navigateDate = (direction) => {
    const next = new Date(displayDate);
    const delta = direction === 'next' ? 1 : -1;
    if (view === 'month') next.setMonth(next.getMonth() + delta);
    if (view === 'week') next.setDate(next.getDate() + (7 * delta));
    if (view === 'day') next.setDate(next.getDate() + delta);
    setDisplayDate(next);
    if (onDateChange) onDateChange(next);
    if (onViewChange) onViewChange(view, next);
  };

  const handleToday = () => {
    const today = new Date();
    setDisplayDate(today);
    if (onDateChange) onDateChange(today);
    if (onViewChange) onViewChange(view, today);
  };

  const handleViewChange = (v) => {
    setView(v);
    if (onViewChange) onViewChange(v, displayDate);
  };

  const getHeaderLabel = () => {
    if (view === 'month') {
      return displayDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (view === 'week') {
      const week = getWeekDays(displayDate);
      return `${week[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${week[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return displayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  const profitStyle = (profit) => ({
    color: profit > 0 ? 'var(--success)' : profit < 0 ? 'var(--danger)' : 'var(--text3)',
    fontWeight: '600',
  });

  const isSameDay = (a, b) => a && b && toDayKey(a) === toDayKey(b);
  const toFileUrl = (p) => {
    const raw = String(p || '').trim();
    if (!raw) return '';
    if (raw.startsWith('file://')) return encodeURI(raw);
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    return encodeURI(`file:///${normalized}`);
  };

  const containerStyle = { display: 'flex', flexDirection: 'column', gap: compact ? '8px' : '12px', ...style };
  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' };
  const navButtonStyle = {
    background: 'color-mix(in srgb, var(--surface2) 90%, transparent)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '6px 12px',
    cursor: 'pointer',
    color: 'var(--text2)',
    fontSize: '12px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };
  const tabStyle = (active) => ({
    background: active ? 'var(--accent)' : 'color-mix(in srgb, var(--surface2) 90%, transparent)',
    color: active ? '#000' : 'var(--text2)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  });

  const renderDayCell = (date, compact = false) => {
    const stats = getDayStats(date);
    const selected = isSameDay(date, selectedDate);
    const today = isSameDay(date, new Date());

    let background = 'color-mix(in srgb, var(--surface2) 85%, transparent)';
    if (stats.profit > 0) background = 'rgba(36, 208, 132, 0.12)';
    if (stats.profit < 0) background = 'rgba(255, 92, 117, 0.12)';
    if (selected) background = 'rgba(61, 217, 255, 0.2)';

    const dayKey = toDayKey(date);
    return (
      <div
        key={dayKey}
        data-testid={`calendar-day-${dayKey}`}
        data-calendar-has-trades={stats.count > 0 ? 'true' : 'false'}
        style={{
          minHeight: compact ? '64px' : '105px',
          background,
          border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
          borderRadius: '8px',
          padding: compact ? '6px' : '8px',
          cursor: 'pointer',
          transition: 'all .15s ease'
        }}
        onClick={() => handleDayClick(date)}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: compact ? '11px' : '12px', fontWeight: '700', color: today ? 'var(--accent)' : 'var(--text)' }}>{date.getDate()}</div>
          {today && <div style={{ fontSize: '10px', color: 'var(--accent)' }}>Today</div>}
        </div>
        {stats.count > 0 && (
          <div style={{ marginTop: compact ? '4px' : '6px', fontSize: compact ? '9px' : '10px', color: 'var(--text2)', lineHeight: 1.3 }}>
            <div>{stats.count} trades</div>
            <div style={profitStyle(stats.profit)}>{stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}</div>
          </div>
        )}
      </div>
    );
  };

  const monthCells = generateMonthCells();
  const weekDays = getWeekDays(displayDate);
  const dayStats = getDayStats(displayDate);

  useLayoutEffect(() => {
    if (!onHeightChange || !rootRef.current) return;
    const next = Math.ceil(rootRef.current.scrollHeight || 0);
    if (next > 0) onHeightChange(next);
  }, [onHeightChange, view, displayDate, monthCells.length, weekDays.length, dayStats.count, trades.length, range?.from, range?.to, compact]);

  return (
    <div ref={rootRef} style={containerStyle} className={className}>
      <div style={rowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button style={navButtonStyle} onClick={() => navigateDate('prev')}><ChevronLeft size={14} /> Prev</button>
          <button style={navButtonStyle} onClick={handleToday}>Today</button>
          <button style={navButtonStyle} onClick={() => navigateDate('next')}>Next <ChevronRight size={14} /></button>
          <div style={{ fontSize: compact ? '20px' : '32px', fontWeight: '700', color: 'var(--text)', marginLeft: '6px' }}>{getHeaderLabel()}</div>
        </div>

        {showViewControls ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button type="button" data-testid="calendar-view-month" style={tabStyle(view === 'month')} onClick={() => handleViewChange('month')}><Calendar size={14} /> Month</button>
            <button type="button" data-testid="calendar-view-week" style={tabStyle(view === 'week')} onClick={() => handleViewChange('week')}><Grid3X3 size={14} /> Week</button>
            <button type="button" data-testid="calendar-view-day" style={tabStyle(view === 'day')} onClick={() => handleViewChange('day')}><Clock size={14} /> Day</button>
          </div>
        ) : null}
      </div>

      {showRangeControls ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', position: 'relative' }}>
          <div style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: '600' }}>Date Range</div>
          <button
            style={{ ...navButtonStyle, minWidth: '260px', justifyContent: 'space-between' }}
            onClick={() => {
              setDraftRange(selectedRange || range);
              setShowRangePopover((v) => !v);
            }}
          >
            <span>{formatRangeLabel(selectedRange || range)}</span>
            <ChevronDown size={14} />
          </button>
          <button
            style={navButtonStyle}
            onClick={() => {
              const cleared = { from: undefined, to: undefined };
              setRange(cleared);
              setDraftRange(cleared);
              onRangeChange?.(cleared);
              setShowRangePopover(false);
            }}
          >
            Clear Range
          </button>

          {showRangePopover && (
            <>
              <div
                className="calendar-range-popover-backdrop"
                onClick={() => setShowRangePopover(false)}
              />
              <div className="calendar-range-popover">
                <DayPicker
                  mode="range"
                  selected={draftRange}
                  onSelect={(nextRange) => {
                    setDraftRange(nextRange || { from: undefined, to: undefined });
                  }}
                  numberOfMonths={2}
                  defaultMonth={displayDate}
                />
                <div className="calendar-range-actions">
                  <button
                    style={navButtonStyle}
                    onClick={() => {
                      setDraftRange(selectedRange || range);
                      setShowRangePopover(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={{ ...navButtonStyle, background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)' }}
                    onClick={() => {
                      const nextRange = draftRange || { from: undefined, to: undefined };
                      setRange(nextRange);
                      onRangeChange?.(nextRange);
                      setShowRangePopover(false);
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {view !== 'day' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '700', color: 'var(--text2)', padding: '8px' }}>{d}</div>
          ))}
        </div>
      )}

      {view === 'month' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px' }}>
          {monthCells.map((date) => (
            <div key={toDayKey(date)} style={{ opacity: date.getMonth() === displayDate.getMonth() ? 1 : 0.55 }}>
              {renderDayCell(date, true)}
            </div>
          ))}
        </div>
      )}

      {view === 'week' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px' }}>
          {weekDays.map((date) => renderDayCell(date, false))}
        </div>
      )}

      {view === 'day' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: '10px', background: 'color-mix(in srgb, var(--surface) 85%, transparent)', padding: '12px' }}>
          {renderDayCell(displayDate, false)}
          <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text2)' }}>
            Daily summary: <span style={profitStyle(dayStats.profit)}>{dayStats.profit >= 0 ? '+' : ''}${dayStats.profit.toFixed(2)}</span> • {dayStats.count} trades
          </div>
        </div>
      )}

      {/* Restored Modal on day click */}
      {showDayModal && selectedDate && (() => {
        const stats = getDayStats(selectedDate);
        return (
          <div
            className="calendar-day-modal-overlay"
            data-testid="calendar-day-modal-overlay"
            onClick={() => setShowDayModal(false)}
          >
            <div
              className="calendar-day-modal"
              data-testid="calendar-day-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text)' }}>Day Details</div>
                  <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                    {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>
                <button type="button" data-testid="calendar-day-modal-close" style={navButtonStyle} onClick={() => setShowDayModal(false)}>Close</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '10px', marginBottom: '14px' }}>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase' }}>P&L</div>
                  <div style={{ ...profitStyle(stats.profit), fontSize: '20px' }}>{stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}</div>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase' }}>Trades</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)' }}>{stats.count}</div>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase' }}>Wins</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--success)' }}>{stats.wins}</div>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase' }}>Losses</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--danger)' }}>{stats.losses}</div>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase' }}>BE</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--warning)' }}>{stats.breakevens}</div>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase' }}>EOD</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--accent)' }}>{stats.eodCloses}</div>
                </div>
              </div>

              <div className="calendar-day-modal-trades">
                {stats.count === 0 && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '16px' }}>No trades on this day</div>}
                {stats.trades.map((trade) => (
                  <div key={trade.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg)', padding: '10px' }}>
                    <div>
                      <div style={{ color: 'var(--accent)', fontWeight: '700' }}>{trade.symbol || 'UNKNOWN'}</div>
                      <div style={{ color: 'var(--text3)', fontSize: '10px' }}>{trade.type || '-'} • {trade.status || '-'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        className="btn-trade-journal"
                        onClick={() => {
                          setShowDayModal(false);
                          onOpenTradeDetail?.(trade);
                        }}
                        title="Open full trade detail"
                      >
                        Detail
                      </button>
                      <button
                        type="button"
                        className="btn-trade-shots"
                        onClick={() => {
                          setShotsTrade(trade);
                          setActiveShotIdx(0);
                        }}
                        disabled={!Array.isArray(trade.screenshots) || trade.screenshots.length === 0}
                        title="Open trade screenshots"
                      >
                        📸 {Array.isArray(trade.screenshots) ? trade.screenshots.length : 0}
                      </button>
                      <div style={profitStyle(Number(trade.profit || 0))}>{Number(trade.profit || 0) >= 0 ? '+' : ''}${Number(trade.profit || 0).toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {shotsTrade && (
        <div
          className="trade-shots-overlay"
          data-testid="trade-screenshots-overlay"
          onClick={() => setShotsTrade(null)}
        >
          <div
            className="trade-shots-modal"
            data-testid="trade-shots-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="trade-shots-header">
              <h3>Trade Screenshots - {shotsTrade.symbol} {shotsTrade.type}</h3>
              <button type="button" className="modal-close" data-testid="trade-shots-modal-close" onClick={() => setShotsTrade(null)}>×</button>
            </div>
            {shotsDisplayList.length > 0 ? (
              <>
                <div className="trade-shots-stagebar">
                  {shotsDisplayList.map((shot, idx) => (
                    <button
                      type="button"
                      key={shot.id || `${shot.path}-${idx}`}
                      className={`trade-shot-pill ${idx === activeShotIdx ? 'active' : ''}`}
                      data-testid={`trade-shot-pill-${String(shot.stage || 'SHOT').replace(/[^A-Z0-9_-]/gi, '')}`}
                      onClick={() => setActiveShotIdx(idx)}
                    >
                      {shot.stage || 'SHOT'}
                    </button>
                  ))}
                </div>
                <div className="trade-shots-image-wrap">
                  <img
                    src={toFileUrl(shotsDisplayList[activeShotIdx]?.path)}
                    alt={`Trade screenshot ${activeShotIdx + 1}`}
                    className="trade-shots-image"
                  />
                </div>
                <div className="trade-shots-meta">
                  <span>{shotsDisplayList[activeShotIdx]?.file || 'unknown file'}</span>
                  <span>{shotsDisplayList[activeShotIdx]?.capturedAt || ''}</span>
                </div>
                {shotsDisplayList.length > 1 && (
                  <div className="trade-shots-keyhint" style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>
                    ← → switch shot
                  </div>
                )}
              </>
            ) : (
              <div className="trade-shots-empty">No screenshots for this trade yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
