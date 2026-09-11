import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDaySelector } from '../components/ui';
import TradeDetailModal from '../components/TradeDetailModal.jsx';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import MultiPickFilter from '../components/MultiPickFilter.jsx';
import { tradeMatchesSlice, canonicalTradeVwapBand } from '../utils/tradeSliceFilters.js';
import { tradeFiltersAreDefault } from '../hooks/usePersistedTradeFilters.js';
import { isClosedTradeLossForStats, isClosedTradeWinForStats } from '../utils/tradeStatus.js';
import { sortTradeScreenshotsForDisplay } from '../utils/tradeScreenshotsDisplay.js';
import { useScreenshotViewerKeys } from '../hooks/useScreenshotViewerKeys.js';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function isClosedTrade(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime;
}

function getTradeDate(trade) {
  const candidates = [trade?.openedAt, trade?.lastUpdateAt, trade?.time];
  for (const v of candidates) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function dateKeyLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function fmtTimeFromTrade(trade) {
  if (trade?.time && /^\d{2}:\d{2}:\d{2}$/.test(String(trade.time))) return trade.time;
  if (trade?._date) return trade._date.toTimeString().slice(0, 8);
  return '--:--:--';
}

function buildMonthCells(monthStart) {
  const firstDay = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const firstGridDay = new Date(firstDay);
  firstGridDay.setDate(firstDay.getDate() - firstDay.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(firstGridDay);
    d.setDate(firstGridDay.getDate() + i);
    cells.push(d);
  }
  return cells;
}

// Heatmap cell: color based on P&L intensity
function HeatmapCell({ hour, pnl, trades, maxAbs }) {
  const intensity = maxAbs > 0 ? Math.min(Math.abs(pnl) / maxAbs, 1) : 0;
  const isPos = pnl >= 0;
  const hasData = trades > 0;
  const bg = !hasData
    ? 'color-mix(in srgb, var(--surface2) 80%, transparent)'
    : isPos
    ? `rgba(36, 208, 132, ${0.08 + intensity * 0.5})`
    : `rgba(255, 92, 117, ${0.08 + intensity * 0.5})`;
  const border = !hasData
    ? 'rgba(36,53,84,0.4)'
    : isPos
    ? `rgba(36, 208, 132, ${0.25 + intensity * 0.5})`
    : `rgba(255, 92, 117, ${0.25 + intensity * 0.5})`;
  const fmt = h => `${String(h).padStart(2, '0')}h`;
  return (
    <div title={`${fmt(hour)} — ${trades} trade${trades !== 1 ? 's' : ''}, ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$`}
      className="heatmap-cell-hover"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: '4px 2px',
        textAlign: 'center',
        cursor: hasData ? 'pointer' : 'default',
        transition: 'all 0.2s',
        minWidth: 0,
      }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 2 }}>{fmt(hour)}</div>
      {hasData ? (
        <div style={{ fontSize: 10, fontWeight: 700, color: isPos ? 'var(--success)' : 'var(--danger)' }}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--text3)' }}>—</div>
      )}
      {hasData && (
        <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 1 }}>{trades}t</div>
      )}
    </div>
  );
}

export default function CalendarStatsPage({
  trades,
  accountSnapshot,
  user,
  onTradeUpdated,
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  tradeFilters = null
}) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedRange, setSelectedRange] = useState({ from: undefined, to: undefined });
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyLocal(new Date()));
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [detailTrade, setDetailTrade] = useState(null);
  const detailTradeLive = useMemo(() => {
    if (!detailTrade?.id) return null;
    return (trades || []).find((t) => String(t.id) === String(detailTrade.id)) || detailTrade;
  }, [trades, detailTrade]);
  const [savingDetail, setSavingDetail] = useState(false);
  const [shotsTrade, setShotsTrade] = useState(null);
  const [activeShotIdx, setActiveShotIdx] = useState(0);
  const shotsDisplayList = useMemo(
    () => sortTradeScreenshotsForDisplay(shotsTrade?.screenshots),
    [shotsTrade?.screenshots]
  );
  useScreenshotViewerKeys(!!shotsTrade, shotsDisplayList.length, setActiveShotIdx);

  const toFileUrl = useCallback((p) => {
    const raw = String(p || '').trim();
    if (!raw) return '';
    if (raw.startsWith('file://')) return encodeURI(raw);
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    return encodeURI(`file:///${normalized}`);
  }, []);
  const [settings, setSettings] = useState(null);
  const [canonicalAnalytics, setCanonicalAnalytics] = useState(null);
  // ── Calendar view state ──
  const [calView, setCalView] = useState('month');       // 'month' | 'week' | 'day'
  const [calDisplayDate, setCalDisplayDate] = useState(() => new Date());
  const [sliceVwapBands, setSliceVwapBands] = useState([]);
  const [aiMonthSummary, setAiMonthSummary] = useState(null);
  const [aiMonthLoading, setAiMonthLoading] = useState(false);

  const accountId = String(accountSnapshot?.login || 'default');
  const accountLabel = accountSnapshot?.name || accountSnapshot?.login || user?.phone || 'Primary account';

  const tradeRows = useMemo(() => {
    return (trades || [])
      .map((t) => {
        const date = getTradeDate(t);
        if (!date) return null;
        return {
          ...t,
          _date: date,
          _dateKey: dateKeyLocal(date),
          _hour: date.getHours(),
          _profit: Number(t.profit || 0),
          _isClosed: isClosedTrade(t),
          _accountId: String(t.accountKey || t.accountId || accountId),
          _accountName: t.accountName || accountLabel
        };
      })
      .filter(Boolean)
      .filter((t) => selectedAccountKeys.length === 0 || selectedAccountKeys.includes(t._accountId));
  }, [trades, accountId, accountLabel, selectedAccountKeys]);

  const closedTrades = useMemo(() => tradeRows.filter(t => t._isClosed), [tradeRows]);

  const vwapBandOptions = useMemo(() => {
    const raw = [...new Set(closedTrades.map((t) => canonicalTradeVwapBand(t)).filter(Boolean))];
    const order = { yes: 0, no: 1, na: 2 };
    raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
    return raw;
  }, [closedTrades]);

  const globalFiltersActive = tradeFilters && !tradeFiltersAreDefault(tradeFilters);

  const closedForScope = useMemo(() => {
    return closedTrades.filter((t) => {
      if (tradeFilters) {
        const {
          filterSymbol = '',
          filterType = 'ALL',
          filterChannel = 'ALL',
          sliceTimeframes = [],
          slicePairs = [],
          sliceBiases = [],
          sliceSetups = [],
          sliceVwapBands: gVwap = [],
          sliceHvnBands = [],
          sliceSessions = [],
          sliceWeekdays = [],
          sliceTags = []
        } = tradeFilters;
        if (filterSymbol && !t.symbol?.toLowerCase().includes(filterSymbol.toLowerCase())) return false;
        if (filterType !== 'ALL' && t.type !== filterType) return false;
        if (filterChannel !== 'ALL' && t.channel !== filterChannel) return false;
        if (!tradeMatchesSlice(t, {
          timeframes: sliceTimeframes,
          symbols: slicePairs,
          biasTerms: sliceBiases,
          setupTerms: sliceSetups,
          vwapBands: gVwap,
          hvnBands: sliceHvnBands,
          sessions: sliceSessions,
          weekdays: sliceWeekdays
        })) return false;
        if (sliceTags.length > 0) {
          const tags = [
            ...(Array.isArray(t.presetTags) ? t.presetTags : []),
            ...(Array.isArray(t.journalTags) ? t.journalTags : [])
          ].map((x) => String(x || '').trim().toLowerCase());
          if (!sliceTags.some((tag) => tags.includes(String(tag).trim().toLowerCase()))) return false;
        }
      }
      // Local calendar VWAP filter (applied on top of global filters)
      if (!tradeMatchesSlice(t, { vwapBands: sliceVwapBands })) return false;
      return true;
    });
  }, [closedTrades, tradeFilters, sliceVwapBands]);

  const monthTrades = useMemo(() => closedForScope.filter(t =>
    t._date.getFullYear() === monthCursor.getFullYear() && t._date.getMonth() === monthCursor.getMonth()
  ), [closedForScope, monthCursor]);

  const rangeBounds = useMemo(() => {
    const start = selectedRange?.from ? new Date(selectedRange.from) : null;
    const end = selectedRange?.to ? new Date(selectedRange.to) : null;
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);
    if (start && Number.isNaN(start.getTime())) return { start: null, end: null, active: false, invalid: true };
    if (end && Number.isNaN(end.getTime())) return { start: null, end: null, active: false, invalid: true };
    if (start && end && start > end) return { start, end, active: false, invalid: true };
    return { start, end, active: !!(start || end), invalid: false };
  }, [selectedRange]);

  const rangeTrades = useMemo(() => {
    if (!rangeBounds.active || rangeBounds.invalid) return monthTrades;
    return closedForScope.filter(t => {
      if (rangeBounds.start && t._date < rangeBounds.start) return false;
      if (rangeBounds.end && t._date > rangeBounds.end) return false;
      return true;
    });
  }, [closedForScope, monthTrades, rangeBounds]);

  const mappedScope = calView === 'day' ? 'DAY' : calView === 'week' ? 'WEEK' : 'MONTH';

  useEffect(() => {
    window.electronAPI?.getSettings?.().then((s) => setSettings(s || null)).catch(() => setSettings(null));
  }, []);
  useEffect(() => {
    const unsub = window.electronAPI?.onSettingsUpdated?.((next) => {
      if (next) setSettings(next);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const analyticsBeBand = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);

  useEffect(() => {
    if (rangeBounds.active && !rangeBounds.invalid) return;
    let active = true;
    window.electronAPI?.getAnalyticsSummary?.({
      accountKeys: selectedAccountKeys,
      timeScope: mappedScope
    }).then((summary) => {
      if (!active) return;
      setCanonicalAnalytics(summary || null);
    }).catch(() => {
      if (!active) return;
      setCanonicalAnalytics(null);
    });
    return () => { active = false; };
  }, [selectedAccountKeys, mappedScope, rangeBounds.active, rangeBounds.invalid, trades]);

  // ── Week-scoped trades (Sun→Sat of calDisplayDate) ──
  const weekTrades = useMemo(() => {
    const start = new Date(calDisplayDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return closedForScope.filter(t => t._date >= start && t._date <= end);
  }, [closedForScope, calDisplayDate]);

  // ── Day-scoped trades ──
  const dayTrades = useMemo(() => {
    const key = dateKeyLocal(calDisplayDate);
    return closedForScope.filter(t => t._dateKey === key);
  }, [closedForScope, calDisplayDate]);

  // ── analysisTrades depends on active view / range ──
  const analysisTrades = useMemo(() => {
    if (rangeBounds.active && !rangeBounds.invalid) return rangeTrades;
    if (calView === 'week') return weekTrades;
    if (calView === 'day')  return dayTrades;
    return monthTrades;
  }, [rangeBounds, rangeTrades, calView, weekTrades, dayTrades, monthTrades]);

  const dailyStats = useMemo(() => {
    const map = new Map();
    const be = analyticsBeBand;
    for (const t of monthTrades) {
      const prev = map.get(t._dateKey) || { pnl: 0, trades: 0, wins: 0, losses: 0, items: [] };
      prev.pnl += t._profit; prev.trades += 1;
      if (isClosedTradeWinForStats(t, be)) prev.wins += 1;
      if (isClosedTradeLossForStats(t, be)) prev.losses += 1;
      prev.items.push(t);
      map.set(t._dateKey, prev);
    }
    return map;
  }, [monthTrades, analyticsBeBand]);

  const computedSummary = useMemo(() => {
    const totalPnl = analysisTrades.reduce((s, t) => s + t._profit, 0);
    const be = analyticsBeBand;
    const wins = analysisTrades.filter((t) => isClosedTradeWinForStats(t, be)).length;
    const losses = analysisTrades.filter((t) => isClosedTradeLossForStats(t, be)).length;
    const decisive = wins + losses;
    const winRate = decisive > 0 ? (wins / decisive) * 100 : 0;
    const winTrades = analysisTrades.filter((t) => isClosedTradeWinForStats(t, be));
    const lossTrades = analysisTrades.filter((t) => isClosedTradeLossForStats(t, be));
    const avgWin = wins > 0 ? winTrades.reduce((s, t) => s + t._profit, 0) / wins : 0;
    const avgLoss = losses > 0 ? Math.abs(lossTrades.reduce((s, t) => s + t._profit, 0) / losses) : 0;
    const rr = avgLoss > 0 ? avgWin / avgLoss : 0;
    return { totalPnl, trades: analysisTrades.length, wins, losses, winRate, rr, avgWin, avgLoss };
  }, [analysisTrades, analyticsBeBand]);
  const summary = (rangeBounds.active && !rangeBounds.invalid)
    ? computedSummary
    : {
      totalPnl: Number(canonicalAnalytics?.totals?.totalPnl || 0),
      trades: Number(canonicalAnalytics?.tradeCount || 0),
      wins: Number(canonicalAnalytics?.totals?.wins || 0),
      losses: Number(canonicalAnalytics?.totals?.losses || 0),
      winRate: Number(canonicalAnalytics?.totals?.winRate || 0),
      rr: Number(canonicalAnalytics?.totals?.rr || 0),
      avgWin: Number(canonicalAnalytics?.totals?.avgWin || 0),
      avgLoss: Number(canonicalAnalytics?.totals?.avgLoss || 0)
    };

  // Best & worst day
  const { bestDay, worstDay } = useMemo(() => {
    const entries = [...dailyStats.entries()];
    if (entries.length === 0) return { bestDay: null, worstDay: null };
    const sorted = entries.sort((a, b) => b[1].pnl - a[1].pnl);
    return { bestDay: sorted[0], worstDay: sorted[sorted.length - 1] };
  }, [dailyStats]);

  // 24h heatmap
  const hourlyStats = useMemo(() => {
    const be = analyticsBeBand;
    const buckets = HOURS.map(h => ({ hour: h, pnl: 0, trades: 0, wins: 0, losses: 0 }));
    for (const t of analysisTrades) {
      const b = buckets[t._hour];
      b.pnl += t._profit; b.trades += 1;
      if (isClosedTradeWinForStats(t, be)) b.wins += 1;
      if (isClosedTradeLossForStats(t, be)) b.losses += 1;
    }
    return buckets;
  }, [analysisTrades, analyticsBeBand]);

  const heatmapMaxAbs = useMemo(() => Math.max(...hourlyStats.map(b => Math.abs(b.pnl)), 0.01), [hourlyStats]);

  const weekdayStats = useMemo(() => {
    const be = analyticsBeBand;
    const buckets = WEEK_DAYS.map((name, index) => ({ name, index, pnl: 0, trades: 0, wins: 0, losses: 0 }));
    for (const t of analysisTrades) {
      const b = buckets[t._date.getDay()];
      b.pnl += t._profit; b.trades += 1;
      if (isClosedTradeWinForStats(t, be)) b.wins += 1;
      if (isClosedTradeLossForStats(t, be)) b.losses += 1;
    }
    return buckets;
  }, [analysisTrades, analyticsBeBand]);

  const pairStats = useMemo(() => {
    const be = analyticsBeBand;
    const map = new Map();
    for (const t of analysisTrades) {
      const key = t.symbol || 'UNKNOWN';
      const prev = map.get(key) || { symbol: key, pnl: 0, trades: 0, wins: 0, losses: 0, buy: 0, sell: 0 };
      prev.pnl += t._profit; prev.trades += 1;
      if (isClosedTradeWinForStats(t, be)) prev.wins += 1;
      if (isClosedTradeLossForStats(t, be)) prev.losses += 1;
      if (String(t.type || '').toUpperCase() === 'BUY') prev.buy += 1;
      if (String(t.type || '').toUpperCase() === 'SELL') prev.sell += 1;
      map.set(key, prev);
    }
    return [...map.values()].sort((a, b) => b.trades - a.trades);
  }, [analysisTrades, analyticsBeBand]);

  const maxPairTrades = useMemo(() => Math.max(...pairStats.map(p => p.trades), 1), [pairStats]);

  const selectedDay = dailyStats.get(selectedDateKey) || { pnl: 0, trades: 0, wins: 0, losses: 0, items: [] };

  const dayModalHourStats = useMemo(() => {
    if (!dayModalOpen) return [];
    const be = analyticsBeBand;
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, pnl: 0, trades: 0, wins: 0, losses: 0 }));
    for (const t of selectedDay.items) {
      const b = buckets[t._hour] || buckets[0];
      b.pnl += t._profit; b.trades += 1;
      if (isClosedTradeWinForStats(t, be)) b.wins += 1;
      if (isClosedTradeLossForStats(t, be)) b.losses += 1;
    }
    return buckets.filter(b => b.trades > 0).sort((a, b) => b.trades - a.trades);
  }, [dayModalOpen, selectedDay, analyticsBeBand]);

  const dayTradesSorted = useMemo(() => {
    if (!dayModalOpen) return [];
    return [...selectedDay.items].sort((a, b) => b._date.getTime() - a._date.getTime());
  }, [dayModalOpen, selectedDay]);

  const isActiveLabel = rangeBounds.active && !rangeBounds.invalid;
  const viewLabel = isActiveLabel ? 'Range' : calView === 'month' ? 'Monthly' : calView === 'week' ? 'Weekly' : 'Daily';

  const handleAiMonthSummary = useCallback(async () => {
    if (aiMonthLoading) return;
    setAiMonthLoading(true);
    setAiMonthSummary(null);
    const cursorSnapshot = monthCursor;
    const accountsSnapshot = effectiveAccountKeys.length > 0 ? effectiveAccountKeys : selectedAccountKeys;
    try {
      const from = new Date(cursorSnapshot.getFullYear(), cursorSnapshot.getMonth(), 1);
      const to = new Date(cursorSnapshot.getFullYear(), cursorSnapshot.getMonth() + 1, 0, 23, 59, 59, 999);
      const result = await window.electronAPI?.getAiMonthSummary?.({
        fromTs: from.getTime(),
        toTs: to.getTime(),
        accountKeys: accountsSnapshot
      });
      setAiMonthSummary(result || null);
    } catch {
      setAiMonthSummary({ ok: false, error: 'Request failed' });
    } finally {
      setAiMonthLoading(false);
    }
  }, [selectedAccountKeys, aiMonthLoading]);

  // Week label for display
  const weekRangeLabel = useMemo(() => {
    const start = new Date(calDisplayDate);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [calDisplayDate]);

  return (
    <div className="calendar-stats-page calendar-with-gradient" data-testid="page-calendar" data-onboarding="calendar-workspace">

      {/* Header */}
      <div className="calendar-stats-header">
        <div>
          <div className="calendar-stats-title">📊 Performance Dashboard</div>
          {/* Active period indicator */}
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
            {calView === 'month' && !isActiveLabel && (
              <span>📅 {calDisplayDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            )}
            {calView === 'week' && !isActiveLabel && (
              <span>📆 {weekRangeLabel}</span>
            )}
            {calView === 'day' && !isActiveLabel && (
              <span>🗓️ {calDisplayDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            )}
            {isActiveLabel && <span>📏 Custom date range active</span>}
          </div>
        </div>
        <div className="calendar-stats-header-right" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {settings?.aiCheck?.enabled && (
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: 11, padding: '4px 12px' }}
              onClick={handleAiMonthSummary}
              disabled={aiMonthLoading}
              title="Generate AI summary for this month"
            >
              {aiMonthLoading ? '🤖 Summarizing…' : '🤖 AI Month Summary'}
            </button>
          )}
          {globalFiltersActive && (
            <span
              title="Global trade filters are active — trades are filtered by your Filter Lab settings"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: 20,
                background: 'rgba(var(--accent-rgb, 62,130,247), 0.15)',
                color: 'var(--accent)',
                border: '1px solid rgba(var(--accent-rgb, 62,130,247), 0.35)',
                cursor: 'default',
                letterSpacing: '0.02em'
              }}
            >
              <span aria-hidden>⚡</span> Filters active
            </span>
          )}
          <MultiPickFilter
            testId="calendar-slice-vwap"
            label="VWAP"
            options={vwapBandOptions}
            selected={sliceVwapBands}
            onChange={setSliceVwapBands}
            formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
          />
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
          />
        </div>
      </div>

      {rangeBounds.invalid && <div className="range-invalid">⚠️ Invalid range (From must be before or equal to To)</div>}

      {/* AI Month Summary panel */}
      {aiMonthSummary && (
        <div className="calendar-box" style={{ marginBottom: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>🤖 AI Month Insight</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{monthCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            </div>
            {!aiMonthSummary.ok ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{aiMonthSummary.error || 'Could not generate summary'}</div>
            ) : (
              <>
                {aiMonthSummary.headline && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>{aiMonthSummary.headline}</div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  <div style={{ background: 'var(--surface1)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Net P&L</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: aiMonthSummary.totalPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {aiMonthSummary.totalPnl >= 0 ? '+' : ''}{aiMonthSummary.totalPnl?.toFixed(2)}$
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface1)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Win Rate</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>
                      {aiMonthSummary.trades > 0 ? Math.round((aiMonthSummary.wins / aiMonthSummary.trades) * 100) : 0}%
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface1)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Sample</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{aiMonthSummary.sample} trades</div>
                  </div>
                </div>
                {(aiMonthSummary.wins_list || []).length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--success)' }}>
                    ✓ {aiMonthSummary.wins_list.join(' · ')}
                  </div>
                )}
                {(aiMonthSummary.leaks || []).length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                    ✗ {aiMonthSummary.leaks.join(' · ')}
                  </div>
                )}
                {aiMonthSummary.next_action && (
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>→ {aiMonthSummary.next_action}</div>
                )}
                {aiMonthSummary.caution && (
                  <div style={{ fontSize: 12, color: 'var(--warning)', fontStyle: 'italic' }}>⚠ {aiMonthSummary.caution}</div>
                )}
                {(aiMonthSummary.best_pairs || []).length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Best pairs: {aiMonthSummary.best_pairs.join(', ')}</div>
                )}
                {(aiMonthSummary.worst_pairs || []).length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Weak pairs: {aiMonthSummary.worst_pairs.join(', ')}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Summary cards — label changes with view */}
      <div className="calendar-summary-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
        <div className="calendar-summary-card animate-enter" style={{ animationDelay: '0ms' }}>
          <div className="k">{viewLabel} P&L</div>
          <div className={`v ${summary.totalPnl >= 0 ? 'pos' : 'neg'}`}>{summary.totalPnl >= 0 ? '+' : ''}{summary.totalPnl.toFixed(2)}$</div>
        </div>
        <div className="calendar-summary-card animate-enter" style={{ animationDelay: '80ms' }}>
          <div className="k">{viewLabel} Trades</div>
          <div className="v">{summary.trades}</div>
        </div>
        <div className="calendar-summary-card animate-enter" style={{ animationDelay: '160ms' }}>
          <div className="k">Win Rate</div>
          <div className={`v ${summary.winRate >= 50 ? 'pos' : 'neg'}`}>{summary.winRate.toFixed(1)}%</div>
        </div>
        <div className="calendar-summary-card animate-enter" style={{ animationDelay: '240ms' }}>
          <div className="k">Avg R:R</div>
          <div className={`v ${summary.rr >= 1 ? 'pos' : 'warn'}`}>{summary.rr.toFixed(2)}</div>
        </div>
        <div className="calendar-summary-card animate-enter" style={{ animationDelay: '320ms' }}>
          <div className="k">Avg Win</div>
          <div className="v pos">+{summary.avgWin.toFixed(2)}$</div>
        </div>
        <div className="calendar-summary-card animate-enter" style={{ animationDelay: '400ms' }}>
          <div className="k">Avg Loss</div>
          <div className="v neg">-{summary.avgLoss.toFixed(2)}$</div>
        </div>
      </div>

      {/* Best/Worst day highlight strip */}
      {(bestDay || worstDay) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {bestDay && (
            <div style={{ flex: 1, border: '1px solid rgba(36,208,132,0.35)', borderRadius: 8, background: 'rgba(36,208,132,0.07)', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>🏆 Best Day</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: bestDay[1].pnl >= 0 ? 'var(--success)' : 'var(--warning)' }}>
                {bestDay[1].pnl >= 0 ? '+' : ''}{bestDay[1].pnl.toFixed(2)}$
              </span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{bestDay[0]}</span>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{bestDay[1].trades} trade{bestDay[1].trades !== 1 ? 's' : ''}</span>
            </div>
          )}
          {worstDay && worstDay !== bestDay && (
            <div style={{ flex: 1, border: '1px solid rgba(255,92,117,0.35)', borderRadius: 8, background: 'rgba(255,92,117,0.07)', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>📉 Worst Day</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
                {worstDay[1].pnl >= 0 ? '+' : ''}{worstDay[1].pnl.toFixed(2)}$
              </span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{worstDay[0]}</span>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{worstDay[1].trades} trade{worstDay[1].trades !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Calendar */}
      <div className="calendar-stats-grid single-col">
        <div className="calendar-box">
          <CalendarDaySelector
            trades={analysisTrades}
            analyticsBreakEvenAmount={analyticsBeBand}
            onOpenTradeDetail={(trade) => setDetailTrade(trade)}
            currentDate={calDisplayDate}
            selectedRange={selectedRange}
            onRangeChange={setSelectedRange}
            onDaySelected={(date) => {
              const key = dateKeyLocal(date);
              setSelectedDateKey(key);
              setDayModalOpen(true);
            }}
            onDateChange={(date) => {
              setCalDisplayDate(date);
              setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1));
            }}
            onViewChange={(v, date) => {
              setCalView(v);
              if (date) {
                setCalDisplayDate(date);
                setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1));
              }
            }}
          />
        </div>
      </div>

      {/* 24h Heatmap */}
      <div className="calendar-box" style={{ marginBottom: 10 }}>
        <div className="table-title" style={{ marginBottom: 8 }}>🕐 Hourly Trading Heatmap <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>— P&L by hour of day</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 4 }}>
          {hourlyStats.slice(0, 12).map(b => (
            <HeatmapCell key={b.hour} hour={b.hour} pnl={b.pnl} trades={b.trades} maxAbs={heatmapMaxAbs} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 4, marginTop: 4 }}>
          {hourlyStats.slice(12).map(b => (
            <HeatmapCell key={b.hour} hour={b.hour} pnl={b.pnl} trades={b.trades} maxAbs={heatmapMaxAbs} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: 'var(--text3)' }}>
          <span>🟢 Green = Profitable hour</span>
          <span>🔴 Red = Loss hour</span>
          <span>Darker = higher intensity</span>
        </div>
      </div>

      {/* Weekday + Pair stats */}
      <div className="calendar-bottom-grid">
        <div className="table-box">
          <div className="table-title">
            📅 {calView === 'day' ? 'Hour' : 'Weekday'} Performance
            <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>
              — {viewLabel.toLowerCase()} data
            </span>
          </div>
          <table className="stats-table">
            <thead>
              {calView === 'day' ? (
                <tr><th>Hour</th><th>Trades</th><th>Win %</th><th>P&L</th></tr>
              ) : (
                <tr><th>Day</th><th>Trades</th><th>Win %</th><th>P&L</th></tr>
              )}
            </thead>
            <tbody>
              {calView === 'day' ? (
                // Group by hour for day view
                hourlyStats.filter(b => b.trades > 0).length === 0 ? (
                  <tr><td colSpan={4} style={{ color: 'var(--text3)', textAlign: 'center' }}>No trades this day</td></tr>
                ) : (
                  hourlyStats.filter(b => b.trades > 0).map(b => {
                    const dec = b.wins + b.losses;
                    const wr = dec > 0 ? (b.wins / dec) * 100 : 0;
                    return (
                      <tr key={b.hour}>
                        <td style={{ fontWeight: 600 }}>{String(b.hour).padStart(2, '0')}:00</td>
                        <td>{b.trades}</td>
                        <td className={wr >= 50 ? 'pos' : wr > 0 ? 'warn' : ''}>{wr.toFixed(0)}%</td>
                        <td className={b.pnl >= 0 ? 'pos' : 'neg'}>{b.pnl >= 0 ? '+' : ''}{b.pnl.toFixed(2)}$</td>
                      </tr>
                    );
                  })
                )
              ) : (
                weekdayStats.map(w => {
                  const dec = w.wins + w.losses;
                  const wr = dec > 0 ? (w.wins / dec) * 100 : 0;
                  const maxDayTrades = Math.max(...weekdayStats.map(x => x.trades), 1);
                  return (
                    <tr key={w.name}>
                      <td style={{ fontWeight: 600 }}>{w.name}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{w.trades}</span>
                          {w.trades > 0 && (
                            <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', maxWidth: 60 }}>
                              <div style={{ height: '100%', width: `${(w.trades / maxDayTrades) * 100}%`, background: 'var(--accent)', borderRadius: 2 }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={wr >= 50 ? 'pos' : wr > 0 ? 'warn' : ''}>{wr.toFixed(1)}%</td>
                      <td className={w.pnl >= 0 ? 'pos' : 'neg'}>{w.pnl >= 0 ? '+' : ''}{w.pnl.toFixed(2)}$</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="table-box">
          <div className="table-title">💱 Pair Performance</div>
          <table className="stats-table">
            <thead><tr><th>Pair</th><th>Volume</th><th>B/S</th><th>WR%</th><th>P&L</th></tr></thead>
            <tbody>
              {pairStats.slice(0, 12).map(p => {
                const dec = p.wins + p.losses;
                const wr = dec > 0 ? (p.wins / dec) * 100 : 0;
                const barWidth = (p.trades / maxPairTrades) * 100;
                return (
                  <tr key={p.symbol}>
                    <td style={{ fontWeight: 700, fontSize: 11 }}>{p.symbol}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 10 }}>{p.trades}</span>
                        <div style={{ height: 3, width: 50, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barWidth}%`, background: p.pnl >= 0 ? 'var(--success)' : 'var(--danger)', borderRadius: 2 }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 10 }}>
                      <span style={{ color: 'var(--success)' }}>{p.buy}B</span>
                      <span style={{ color: 'var(--text3)' }}>/</span>
                      <span style={{ color: 'var(--danger)' }}>{p.sell}S</span>
                    </td>
                    <td className={wr >= 50 ? 'pos' : 'warn'}>{wr.toFixed(0)}%</td>
                    <td className={p.pnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)}$</td>
                  </tr>
                );
              })}
              {pairStats.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--text3)', textAlign: 'center' }}>No data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dayModalOpen && (
        <div className="modal-overlay calendar-page-day-modal-overlay" onClick={() => setDayModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 720, width: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Day breakdown — {selectedDateKey}</h3>
              <button type="button" className="modal-close" onClick={() => setDayModalOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div><strong>P&L:</strong> {selectedDay.pnl >= 0 ? '+' : ''}{selectedDay.pnl.toFixed(2)}$</div>
                <div><strong>Trades:</strong> {selectedDay.trades}</div>
                <div><strong>W/L:</strong> {selectedDay.wins}/{selectedDay.losses}</div>
              </div>
              {dayModalHourStats.length > 0 && (
                <>
                  <div className="table-title" style={{ marginBottom: 8 }}>By hour</div>
                  <table className="stats-table" style={{ marginBottom: 16 }}>
                    <thead><tr><th>Hour</th><th>Trades</th><th>Win %</th><th>P&L</th></tr></thead>
                    <tbody>
                      {dayModalHourStats.map((b) => {
                        const wr = b.trades > 0 ? (b.wins / b.trades) * 100 : 0;
                        return (
                          <tr key={b.hour}>
                            <td>{String(b.hour).padStart(2, '0')}:00</td>
                            <td>{b.trades}</td>
                            <td>{wr.toFixed(0)}%</td>
                            <td className={b.pnl >= 0 ? 'pos' : 'neg'}>{b.pnl >= 0 ? '+' : ''}{b.pnl.toFixed(2)}$</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
              <div className="table-title" style={{ marginBottom: 8 }}>Trades</div>
              {dayTradesSorted.length === 0 ? (
                <p style={{ color: 'var(--text3)' }}>No closed trades this day.</p>
              ) : (
                <table className="stats-table">
                  <thead><tr><th>Symbol</th><th>Type</th><th>Status</th><th>P&L</th><th></th></tr></thead>
                  <tbody>
                    {dayTradesSorted.map((t) => (
                      <tr key={t.id || `${t.symbol}-${t._date}`}>
                        <td>{t.symbol}</td>
                        <td>{t.type}</td>
                        <td>{t.status}</td>
                        <td className={t._profit >= 0 ? 'pos' : 'neg'}>{t._profit >= 0 ? '+' : ''}{t._profit.toFixed(2)}$</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setDayModalOpen(false); setDetailTrade(t); }}>Details</button>
                            {Array.isArray(t.screenshots) && t.screenshots.length > 0 && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => {
                                  setShotsTrade(t);
                                  setActiveShotIdx(0);
                                }}
                              >
                                📸 {t.screenshots.length}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {detailTrade && (
        <TradeDetailModal
          trade={detailTradeLive || detailTrade}
          tagPresets={Array.isArray(settings?.tradePresets) ? settings.tradePresets : []}
          saving={savingDetail}
          onClose={() => setDetailTrade(null)}
          onSave={async ({ patch, journalPatch, applyToMt5 }) => {
            setSavingDetail(true);
            try {
              const result = await window.electronAPI?.updateTrade?.(
                (detailTradeLive || detailTrade).id,
                { patch, journalPatch, applyToMt5 }
              );
              if (result?.success && result?.trade) {
                setDetailTrade(result.trade);
                onTradeUpdated?.(result.trade);
              }
            } finally {
              setSavingDetail(false);
            }
          }}
        />
      )}

      {shotsTrade && (
        <div className="trade-shots-overlay" onClick={() => setShotsTrade(null)}>
          <div className="trade-shots-modal" onClick={(e) => e.stopPropagation()}>
            <div className="trade-shots-header">
              <h3>Trade Screenshots — {shotsTrade.symbol} {shotsTrade.type}</h3>
              <button type="button" className="modal-close" onClick={() => setShotsTrade(null)}>×</button>
            </div>
            {shotsDisplayList.length > 0 ? (
              <>
                {shotsDisplayList.length > 1 && (
                  <div className="trade-shots-stagebar">
                    {shotsDisplayList.map((shot, idx) => (
                      <button
                        key={shot.id || idx}
                        type="button"
                        className={`trade-shot-pill${idx === activeShotIdx ? ' active' : ''}`}
                        onClick={() => setActiveShotIdx(idx)}
                      >
                        {(shot.stage || shot.label || `Shot ${idx + 1}`).toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                <div className="trade-shots-image-wrap">
                  <img
                    src={toFileUrl(shotsDisplayList[activeShotIdx]?.path)}
                    alt={`Trade screenshot ${activeShotIdx + 1}`}
                    className="trade-shots-image"
                  />
                </div>
                <div className="trade-shots-meta">
                  <span>{shotsDisplayList[activeShotIdx]?.file || `${activeShotIdx + 1} / ${shotsDisplayList.length}`}</span>
                  <span>{shotsDisplayList[activeShotIdx]?.capturedAt || ''}</span>
                </div>
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




