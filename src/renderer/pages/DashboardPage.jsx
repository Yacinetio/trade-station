import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import TradeTable from '../components/TradeTable.jsx';
import StatusPanel from '../components/StatusPanel.jsx';
import LogsPanel from '../components/LogsPanel.jsx';
import AiInsightsPanel from '../components/AiInsightsPanel.jsx';
import DashboardStatsAiCard from '../components/DashboardStatsAiCard.jsx';
import { buildFilterSummaryText } from '../utils/filterSummaryText.js';
import TradeDetailModal from '../components/TradeDetailModal.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import { MetricPill } from '../components/ui';
import { Bolt, Bell, Upload, Plus } from 'lucide-react';
import ManualTradeModal from '../components/ManualTradeModal.jsx';
import { tradeMatchesTimeScope, isoYmdCustomRangeBounds } from '../utils/timeCalendarScope.js';
import { tradeSelectionKey } from '../utils/tradeSelectionKey.js';
import { tradeMatchesSlice, uniqueSortedStrings, canonicalTradeVwapBand, canonicalTradeHvnBand, SLICE_SESSION_KEYS, SLICE_WEEKDAY_ORDER, formatWeekdaySliceOption, sortWeekdayIndicesMonFirst } from '../utils/tradeSliceFilters.js';
import { sortTradeScreenshotsForDisplay } from '../utils/tradeScreenshotsDisplay.js';
import { useScreenshotViewerKeys } from '../hooks/useScreenshotViewerKeys.js';
import MultiPickFilter from '../components/MultiPickFilter.jsx';
import FilterTemplatesControl from '../components/FilterTemplatesControl.jsx';
import { computeTemplateResults } from '../utils/filterPresetMatch.js';
import ScopeDateRangeToolbar from '../components/ScopeDateRangeToolbar.jsx';
import { effectiveAccountKeysForScope, tradeMatchesAccountScope } from '../utils/accountScope.js';
import { buildScreenerBiasMap } from '../utils/fundamentalsSymbolMap.js';
import {
  tradeIsBlocked,
  tradeIsClosed,
  tradeIsLive,
  getTradeOutcome
} from '../utils/tradeStatus.js';
import { computeScopedTradeStats } from '../utils/tradeAnalytics.js';
import { tradeFiltersAreDefault } from '../hooks/usePersistedTradeFilters.js';
import { getBlockReasonHelp } from '../utils/blockReasonHelp.js';
import { resolveFilterDimensions, stripDisabledSliceFilters } from '../utils/filterDimensions.js';
import { useToast, ToastContainer } from '../hooks/useToast.jsx';

function tradeIsSimulated(trade) {
  const s = String(trade?.status || '').toUpperCase();
  return s === 'SIMULATED' || trade?.simulated === true;
}

/* ── Skeleton row block ── */
function SkeletonTable({ rows = 6 }) {
  return (
    <div className="trade-table-wrap">
      <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton skeleton-row" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}

function SkeletonStats() {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap' }}>
      {[90, 80, 110, 60, 70, 65].map((w, i) => (
        <div key={i} className="skeleton skeleton-pill" style={{ width: w }} />
      ))}
    </div>
  );
}

export default function DashboardPage({
  trades = [],
  setTrades,
  accountSnapshot,
  currentMt5Account,
  mt5Connected = false,
  bridgeMeta = { fileBridge: false, fileHandshake: false },
  timeScope = 'DAY',
  setTimeScope,
  analyticsCustomRange = null,
  setAnalyticsCustomRange = () => {},
  onOpenSettingsPage,
  onTradeUpdated,
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  /** When false (sidebar switched away), skip analytics IPC so hidden tabs do not churn */
  routeVisible = true,
  tradeFilters,
  setTradeFilters = () => {},
  resetTradeFilters = () => {}
}) {
  const [settings, setSettings] = useState(null);
  const [screenerBiasMap, setScreenerBiasMap] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const aiPanelRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [shotsTrade, setShotsTrade] = useState(null);
  const [activeShotIdx, setActiveShotIdx] = useState(0);
  const shotsDisplayList = useMemo(
    () => sortTradeScreenshotsForDisplay(shotsTrade?.screenshots),
    [shotsTrade?.screenshots]
  );
  useScreenshotViewerKeys(!!shotsTrade, shotsDisplayList.length, setActiveShotIdx);
  const [loading, setLoading] = useState(true);
  const [detailTrade, setDetailTrade] = useState(null);
  const detailTradeLive = useMemo(() => {
    if (!detailTrade?.id) return null;
    const fromList = trades.find((t) => String(t.id) === String(detailTrade.id));
    if (!fromList) return detailTrade;
    const detailTs = new Date(detailTrade.lastUpdateAt || 0).getTime();
    const listTs = new Date(fromList.lastUpdateAt || 0).getTime();
    if (Number.isFinite(detailTs) && detailTs >= listTs) return { ...fromList, ...detailTrade };
    return fromList;
  }, [trades, detailTrade]);
  const [savingJournal, setSavingJournal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [manualTradeOpen, setManualTradeOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationHistory, setNotificationHistory] = useState([]);
  /** Multi-select in popover for "Clear selected". */
  const [selectedNotifIds, setSelectedNotifIds] = useState(() => new Set());
  const { toasts, push: pushToast } = useToast();
  const prevMt5 = useRef(undefined);
  const notifWrapRef = useRef(null);

  const {
    filterSymbol = '',
    filterType = 'ALL',
    filterStatus = 'ALL',
    filterChannel = 'ALL',
    signalsTab = 'ALL',
    sliceTimeframes = [],
    slicePairs = [],
    sliceBiases = [],
    sliceSetups = [],
    sliceVwapBands = [],
    sliceHvnBands = [],
    sliceSessions = [],
    sliceWeekdays = [],
    sliceTags = []
  } = tradeFilters || {};

  const filtersAreDefault = useMemo(() => tradeFiltersAreDefault(tradeFilters), [tradeFilters]);

  const filterDims = useMemo(
    () => resolveFilterDimensions(settings?.tradeBuiltinColumns),
    [settings?.tradeBuiltinColumns]
  );
  const dimOn = (id) => filterDims.enabled.has(id);

  useEffect(() => {
    const patch = stripDisabledSliceFilters(tradeFilters, settings?.tradeBuiltinColumns);
    if (Object.keys(patch).length) setTradeFilters(patch);
  }, [settings?.tradeBuiltinColumns]);

  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    try { return window.localStorage.getItem('ts-ui-right-panel-collapsed') === '1'; } catch (_) { return false; }
  });

  useEffect(() => {
    try { window.localStorage.setItem('ts-ui-right-panel-collapsed', rightPanelCollapsed ? '1' : '0'); } catch (_) { /* noop */ }
  }, [rightPanelCollapsed]);

  useEffect(() => {
    if (!Array.isArray(trades) || trades.length === 0) return;
    const last = trades.map((x) => x.lastUpdateAt || x.openedAt).filter(Boolean).sort().at(-1);
    setLastUpdatedAt(last || null);
  }, [trades]);

  /** Keep newest trade (prepended in App) selected when it appears */
  useEffect(() => {
    if (!Array.isArray(trades) || trades.length === 0) return;
    const newestKey = tradeSelectionKey(trades[0].id);
    setSelectedIds((prev) => {
      if (prev.has(newestKey)) return prev;
      return new Set([...prev, newestKey]);
    });
  }, [trades]);

  // Load settings only (trades + MT5 snapshot come from App)
  useEffect(() => {
    window.electronAPI?.getSettings?.().then((s) => {
      setSettings(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Fetch screener bias map from Fundamentals (stale-ok, best-effort)
  useEffect(() => {
    let active = true;
    window.electronAPI?.getFundamentalsDashboard?.({ forceRefresh: false }).then((data) => {
      if (!active) return;
      const rows = Array.isArray(data?.screener?.rows) ? data.screener.rows : [];
      setScreenerBiasMap(buildScreenerBiasMap(rows));
    }).catch(() => { if (active) setScreenerBiasMap(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI?.onSettingsUpdated?.((next) => {
      if (next) setSettings(next);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.electronAPI?.getNotificationHistory?.().then((rows) => {
      if (!active) return;
      setNotificationHistory(Array.isArray(rows) ? rows.slice(0, 80) : []);
    }).catch(() => {
      if (!active) return;
      setNotificationHistory([]);
    });
    const handler = (entry) => {
      setNotificationHistory((prev) => [entry, ...prev].slice(0, 80));
    };
    const unsubNotif = window.electronAPI?.onNewNotificationEvent?.(handler);
    return () => {
      active = false;
      if (typeof unsubNotif === 'function') unsubNotif();
    };
  }, []);

  useEffect(() => {
    if (!notificationOpen) return undefined;
    const handleOutside = (evt) => {
      if (!notifWrapRef.current) return;
      if (!notifWrapRef.current.contains(evt.target)) {
        setNotificationOpen(false);
      }
    };
    const handleEscape = (evt) => {
      if (evt.key === 'Escape') setNotificationOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [notificationOpen]);

  useEffect(() => {
    if (prevMt5.current === undefined) {
      prevMt5.current = mt5Connected;
      return;
    }
    if (mt5Connected && !prevMt5.current) pushToast('MT5 bridge connected', 'success', '🔗 MT5');
    if (!mt5Connected && prevMt5.current) pushToast('MT5 bridge disconnected', 'error', '⚡ MT5');
    prevMt5.current = mt5Connected;
  }, [mt5Connected, pushToast]);

  // Toasts + bridge activity only (trade list updates live in App)
  useEffect(() => {
    const unsubs = [];
    const sub = (maybeUnsub) => {
      if (typeof maybeUnsub === 'function') unsubs.push(maybeUnsub);
    };
    sub(window.electronAPI?.onNewTrade?.((trade) => {
      setLastUpdatedAt(trade.lastUpdateAt || new Date().toISOString());
      const st = String(trade?.status || '').toUpperCase();
      if (st === 'POSITION_UPDATE' || /^mt5-/i.test(String(trade?.id || ''))) return;
      const blocked = String(trade?.status || '').toUpperCase().includes('BLOCKED') || trade?.blockedReason;
      if (blocked) {
        const help = getBlockReasonHelp(trade);
        const why = help
          ? `${help.label} — ${help.explain}`.slice(0, 160)
          : String(trade.blockedReason || trade.status || 'Filtered').slice(0, 120);
        pushToast(`${trade.symbol} ${trade.type} — not sent. ${why}`, 'warning', '⛔ Blocked / filtered');
      } else {
        pushToast(`New signal: ${trade.symbol} ${trade.type}`, 'info', '📡 Trade received');
      }
    }));
    sub(window.electronAPI?.onTradeUpdate?.((updated) => {
      setLastUpdatedAt(updated.lastUpdateAt || new Date().toISOString());
      const s = String(updated.status || '').toUpperCase();
      if (s === 'TP_HIT' || s === 'CLOSED_TP') {
        pushToast(`${updated.symbol} — TP hit 🎯`, 'success', '✅ Trade Closed');
      }
      if (s === 'SL_HIT' || s === 'CLOSED_SL') {
        const be = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);
        if (getTradeOutcome({ ...updated }, be) === 'BE') {
          pushToast(`${updated.symbol} — break-even (near flat)`, 'warning', '⚪ Closed at BE');
        } else {
          pushToast(`${updated.symbol} — SL hit`, 'error', '🔴 Stop Loss');
        }
      }
    }));
    sub(window.electronAPI?.onMt5Activity?.((evt) => {
      if (evt?.time) setLastUpdatedAt(evt.time);
    }));
    sub(window.electronAPI?.onStatementImported?.(() => {
      window.electronAPI?.getTrades?.().then((rows) => {
        if (Array.isArray(rows)) setTrades(rows);
      });
    }));
    return () => {
      for (const u of unsubs) {
        try { u(); } catch (_) { /* noop */ }
      }
    };
  }, [settings?.analyticsBreakEvenAmount, pushToast, setTrades]);

  const effectiveAccountKeys = useMemo(
    () => effectiveAccountKeysForScope(selectedAccountKeys),
    [selectedAccountKeys]
  );

  const customScopeBounds = useMemo(() => {
    if (String(timeScope || '').toUpperCase() !== 'CUSTOM') return null;
    return isoYmdCustomRangeBounds(analyticsCustomRange?.from, analyticsCustomRange?.to);
  }, [timeScope, analyticsCustomRange?.from, analyticsCustomRange?.to]);

  const scopeMetricLabel = useMemo(() => {
    const ts = String(timeScope || '').toUpperCase();
    if (ts !== 'CUSTOM') return String(timeScope || '');
    const f = analyticsCustomRange?.from;
    const t = analyticsCustomRange?.to;
    if (!f || !t) return 'CUSTOM';
    try {
      const a = new Date(`${f}T12:00:00`);
      const b = new Date(`${t}T12:00:00`);
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'CUSTOM';
      const short = { month: 'short', day: 'numeric' };
      const yOpt = a.getFullYear() !== b.getFullYear() ? { year: 'numeric' } : {};
      return `${a.toLocaleDateString(undefined, short)} → ${b.toLocaleDateString(undefined, { ...short, ...yOpt })}`;
    } catch (_) {
      return 'CUSTOM';
    }
  }, [timeScope, analyticsCustomRange?.from, analyticsCustomRange?.to]);

  const accountScopedTrades = useMemo(() => {
    return trades.filter((t) => tradeMatchesAccountScope(t, effectiveAccountKeys));
  }, [trades, effectiveAccountKeys]);

  const timeScopedTrades = useMemo(() =>
    accountScopedTrades.filter((t) => tradeMatchesTimeScope(t, timeScope, new Date(), customScopeBounds)),
  [accountScopedTrades, timeScope, customScopeBounds]);

  const sliceFilterPayload = useMemo(() => ({
    timeframes: sliceTimeframes,
    symbols: slicePairs,
    biasTerms: sliceBiases,
    setupTerms: sliceSetups,
    vwapBands: sliceVwapBands,
    hvnBands: sliceHvnBands,
    sessions: sliceSessions,
    weekdays: sliceWeekdays
  }), [sliceTimeframes, slicePairs, sliceBiases, sliceSetups, sliceVwapBands, sliceHvnBands, sliceSessions, sliceWeekdays]);

  const sliceOptions = useMemo(() => ({
    tfs: uniqueSortedStrings(
      timeScopedTrades.map((t) => String(t.timeframe || '').toUpperCase().trim()).filter(Boolean)
    ),
    pairs: uniqueSortedStrings(timeScopedTrades.map((t) => t.symbol)),
    biases: uniqueSortedStrings(timeScopedTrades.map((t) => t.bias)),
    setups: uniqueSortedStrings(
      [
        ...timeScopedTrades.flatMap((t) => (Array.isArray(t.presetTags) ? t.presetTags : [])),
        ...timeScopedTrades.map((t) => t.setup).filter(Boolean),
        ...(Array.isArray(settings?.tradePresets) ? settings.tradePresets : [])
      ],
      { limit: 200 }
    ),
    vwapBands: (() => {
      const raw = [...new Set(timeScopedTrades.map((t) => canonicalTradeVwapBand(t)).filter(Boolean))];
      const order = { yes: 0, no: 1, na: 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    hvnBands: (() => {
      const raw = [...new Set(timeScopedTrades.map((t) => canonicalTradeHvnBand(t)).filter(Boolean))];
      const order = { yes: 0, no: 1, na: 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    sessions: [...SLICE_SESSION_KEYS],
    tags: uniqueSortedStrings(
      timeScopedTrades.flatMap((t) => [
        ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
        ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
      ]),
      { limit: 100 }
    )
  }), [timeScopedTrades, settings?.tradePresets]);

  const tabCounts = useMemo(() => {
    const scoped = timeScopedTrades;
    return {
      all: scoped.length,
      live: scoped.filter((t) => tradeIsLive(t)).length,
      closed: scoped.filter((t) => tradeIsClosed(t)).length,
      blocked: scoped.filter((t) => tradeIsBlocked(t)).length,
      simulated: scoped.filter((t) => tradeIsSimulated(t)).length
    };
  }, [timeScopedTrades]);

  const filterLabScopeTrades = useMemo(() => {
    const breakEvenAmount = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);
    return timeScopedTrades.filter((t) => {
      if (signalsTab === 'LIVE' && !tradeIsLive(t)) return false;
      if (signalsTab === 'CLOSED' && !tradeIsClosed(t)) return false;
      if (signalsTab === 'BLOCKED' && !tradeIsBlocked(t)) return false;
      if (signalsTab === 'SIMULATED' && !tradeIsSimulated(t)) return false;
      if (filterSymbol && !t.symbol?.toLowerCase().includes(filterSymbol.toLowerCase())) return false;
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (filterStatus !== 'ALL') {
        const s = (t.status || '').toUpperCase();
        const outcome = getTradeOutcome(t, breakEvenAmount);
        if (filterStatus === 'CLOSED' && !tradeIsClosed(t)) return false;
        if (filterStatus === 'PENDING' && s !== 'PENDING') return false;
        if (filterStatus === 'SENT' && s !== 'SENT') return false;
        if (filterStatus === 'BLOCKED' && !tradeIsBlocked(t)) return false;
        if (filterStatus === 'TP' && outcome !== 'TP') return false;
        if (filterStatus === 'SL' && outcome !== 'SL') return false;
        if (filterStatus === 'BE' && outcome !== 'BE') return false;
        if (filterStatus === 'EOD' && outcome !== 'EOD') return false;
      }
      if (filterChannel !== 'ALL' && t.channel !== filterChannel) return false;
      return true;
    });
  }, [timeScopedTrades, filterSymbol, filterType, filterStatus, filterChannel, signalsTab, settings?.analyticsBreakEvenAmount]);

  const filteredTrades = useMemo(() => {
    const breakEvenAmount = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);
    return timeScopedTrades.filter((t) => {
      if (signalsTab === 'LIVE' && !tradeIsLive(t)) return false;
      if (signalsTab === 'CLOSED' && !tradeIsClosed(t)) return false;
      if (signalsTab === 'BLOCKED' && !tradeIsBlocked(t)) return false;
      if (signalsTab === 'SIMULATED' && !tradeIsSimulated(t)) return false;
      if (filterSymbol && !t.symbol?.toLowerCase().includes(filterSymbol.toLowerCase())) return false;
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (filterStatus !== 'ALL') {
        const s = (t.status || '').toUpperCase();
        const outcome = getTradeOutcome(t, breakEvenAmount);
        if (filterStatus === 'CLOSED' && !tradeIsClosed(t)) return false;
        if (filterStatus === 'PENDING' && s !== 'PENDING') return false;
        if (filterStatus === 'SENT' && s !== 'SENT') return false;
        if (filterStatus === 'BLOCKED' && !tradeIsBlocked(t)) return false;
        if (filterStatus === 'TP' && outcome !== 'TP') return false;
        if (filterStatus === 'SL' && outcome !== 'SL') return false;
        if (filterStatus === 'BE' && outcome !== 'BE') return false;
        if (filterStatus === 'EOD' && outcome !== 'EOD') return false;
      }
      if (filterChannel !== 'ALL' && t.channel !== filterChannel) return false;
      if (!tradeMatchesSlice(t, sliceFilterPayload)) return false;
      if (sliceTags.length > 0) {
        const tags = [
          ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
          ...(Array.isArray(t?.presetTags) ? t.presetTags : [])
        ].map((x) => String(x || '').toLowerCase());
        if (!sliceTags.some((wanted) => tags.includes(String(wanted).toLowerCase()))) return false;
      }
      return true;
    });
  }, [timeScopedTrades, filterSymbol, filterType, filterStatus, filterChannel, signalsTab, settings?.analyticsBreakEvenAmount, sliceFilterPayload, sliceTags]);

  const dashboardStatsFilterSummary = useMemo(() => buildFilterSummaryText({
    scopeMetricLabel,
    effectiveAccountKeysCount: effectiveAccountKeys.length,
    signalsTab,
    filterSymbol,
    filterType,
    filterStatus,
    filterChannel,
    sliceTimeframes,
    slicePairs,
    sliceBiases,
    sliceSetups,
    sliceVwapBands,
    sliceHvnBands,
    sliceSessions,
    sliceWeekdays,
    sliceTags
  }), [
    scopeMetricLabel,
    effectiveAccountKeys.length,
    signalsTab,
    filterSymbol,
    filterType,
    filterStatus,
    filterChannel,
    sliceTimeframes,
    slicePairs,
    sliceBiases,
    sliceSetups,
    sliceVwapBands,
    sliceHvnBands,
    sliceSessions,
    sliceWeekdays,
    sliceTags
  ]);

  const dashboardStatsAiTradeIds = useMemo(
    () => filterLabScopeTrades.map((t) => t.id),
    [filterLabScopeTrades]
  );

  const dashboardStatsAiScopeKey = useMemo(
    () =>
      `${lastUpdatedAt || ''}:${filteredTrades.length}:${dashboardStatsFilterSummary}`,
    [lastUpdatedAt, filteredTrades.length, dashboardStatsFilterSummary]
  );

  const visibleSelectedIds = useMemo(
    () => new Set(
      filteredTrades.filter((t) => selectedIds.has(tradeSelectionKey(t.id))).map((t) => tradeSelectionKey(t.id))
    ),
    [filteredTrades, selectedIds]
  );
  const visibleSelectedCount = visibleSelectedIds.size;
  const unreadNotifications = useMemo(
    () => notificationHistory.filter((item) => !item?.read).length,
    [notificationHistory]
  );

  useEffect(() => {
    const valid = new Set(notificationHistory.map((x) => String(x.id)));
    setSelectedNotifIds((prev) => {
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [notificationHistory]);

  const channels = useMemo(() => [...new Set(trades.map(t => t.channel).filter(Boolean))], [trades]);
  const localAccountOptions = useMemo(() => {
    const map = new Map();
    for (const t of trades) {
      const key = String(t.accountKey || 'unknown');
      const login = t.accountLogin || key;
      const server = t.accountServer || '';
      map.set(key, server ? `${login}@${server}` : login);
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [trades]);
  const mergedAccountOptions = useMemo(() => {
    const map = new Map();
    for (const acc of (accountOptions || [])) {
      if (!acc?.key) continue;
      map.set(acc.key, acc);
    }
    for (const acc of localAccountOptions) {
      if (!acc?.key || map.has(acc.key)) continue;
      map.set(acc.key, acc);
    }
    return Array.from(map.values());
  }, [accountOptions, localAccountOptions]);

  const reloadTradesFromDisk = useCallback(async () => {
    const rows = await window.electronAPI?.getTrades?.();
    if (Array.isArray(rows)) setTrades(rows);
    return rows;
  }, [setTrades]);

  useEffect(() => {
    if (!routeVisible) return undefined;
    reloadTradesFromDisk();
  }, [routeVisible, reloadTradesFromDisk]);

  const scopedStats = useMemo(
    () => computeScopedTradeStats(
      filteredTrades,
      Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50)
    ),
    [filteredTrades, settings?.analyticsBreakEvenAmount]
  );

  const stats = scopedStats;

  const templateResults = useMemo(
    () => computeTemplateResults(
      filteredTrades,
      Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50)
    ),
    [filteredTrades, settings?.analyticsBreakEvenAmount]
  );
  const analytics = useMemo(
    () => ({
      totals: scopedStats,
      closedCount: scopedStats.closedCount,
      advanced: scopedStats.advanced || {}
    }),
    [scopedStats]
  );

  const handleClear = useCallback(async () => {
    setConfirmAction({
      type: 'clearAll',
      title: 'Delete all trades?',
      message: 'This will permanently remove all trades from local history.',
      confirmLabel: 'Delete all'
    });
  }, []);

  const handleToggleSelect = useCallback((id, checked) => {
    const key = tradeSelectionKey(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await window.electronAPI?.refreshTrades();
      await reloadTradesFromDisk();
    } finally {
      setRefreshing(false);
    }
  }, [reloadTradesFromDisk]);

  const selectedTradeIds = useMemo(
    () => filteredTrades.filter((t) => selectedIds.has(tradeSelectionKey(t.id))).map((t) => t.id),
    [filteredTrades, selectedIds]
  );

  // Exports the current table view (selected rows when any, else all filtered rows).
  const handleExport = useCallback(async (format) => {
    if (!format) return;
    const rows = selectedTradeIds.length > 0 ? selectedTradeIds : filteredTrades.map((t) => t.id);
    const ids = rows.filter((id) => id !== undefined && id !== null && id !== '');
    if (ids.length === 0) {
      pushToast('No trades in the current view to export.', 'warning', 'Export');
      return;
    }
    try {
      const res = await window.electronAPI?.exportTrades?.({ format, tradeIds: ids });
      if (res?.success) {
        pushToast(`Exported ${res.tradeCount} trade(s) as ${format.toUpperCase()}`, 'success', 'Export');
      } else if (!res?.canceled) {
        pushToast(res?.reason === 'NO_TRADES' ? 'No matching trades found.' : (res?.reason || 'Export failed'), 'error', 'Export');
      }
    } catch (err) {
      pushToast(err?.message || 'Export failed', 'error', 'Export');
    }
  }, [selectedTradeIds, filteredTrades, pushToast]);

  const handleAnalyseSelected = useCallback(() => {
    if (!settings?.aiCheck?.enabled) {
      pushToast('Enable AI signal-check in Settings → AI first.', 'warning', 'AI off');
      return;
    }
    if (selectedTradeIds.length === 0) {
      pushToast('Tick at least one trade in the table to analyse.', 'info', 'No selection');
      return;
    }
    try {
      aiPanelRef.current?.analyseSelected?.();
      const el = document.querySelector('.ai-insights-panel');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (_) { /* best-effort scroll */ }
  }, [selectedTradeIds, settings?.aiCheck?.enabled, pushToast]);

  const handleDeleteSelected = useCallback(() => {
    const ids = filteredTrades.filter((t) => selectedIds.has(tradeSelectionKey(t.id))).map((t) => t.id);
    if (ids.length === 0) return;
    setConfirmAction({
      type: 'deleteSelected',
      ids,
      title: `Delete ${ids.length} selected trade(s)?`,
      message: 'Selected trades will be removed permanently.',
      confirmLabel: `Delete ${ids.length}`
    });
  }, [filteredTrades, selectedIds]);

  const handleResendSelected = useCallback(async () => {
    const ids = filteredTrades.filter((t) => selectedIds.has(tradeSelectionKey(t.id))).map((t) => t.id);
    if (ids.length === 0) return;

    const liveTrades = filteredTrades.filter(t => {
      const s = String(t.status || '').toUpperCase();
      return s === 'LIVE' || s === 'PENDING' || !s.includes('CLOSED') && !s.includes('HIT');
    });

    if (liveTrades.length === 0) {
      pushToast('No open trades in selection to resend', 'warning', 'Resend');
      return;
    }

    setRefreshing(true);
    try {
      const result = await window.electronAPI?.resendTrades?.(ids);
      if (result?.success) {
        pushToast(`Resent ${result.sent} trade(s) to MT5`, 'success', 'Resend');
      } else if (result?.reason) {
        pushToast(`Resend blocked: ${result.scheduleReason || result.reason}`, 'warning', 'Resend');
      }
    } catch (err) {
      pushToast(`Resend failed: ${err.message || 'Unknown error'}`, 'error', 'Resend');
    } finally {
      setRefreshing(false);
    }
  }, [filteredTrades, selectedIds, pushToast]);

  const handleDeleteAccounts = useCallback(() => {
    const keys = Array.isArray(selectedAccountKeys) ? selectedAccountKeys.filter(Boolean) : [];
    if (keys.length === 0) {
      pushToast('Select one or more accounts in All Accounts first', 'warning', 'Accounts');
      return;
    }
    setConfirmAction({
      type: 'deleteAccounts',
      keys,
      title: `Delete ${keys.length} account${keys.length === 1 ? '' : 's'}?`,
      message:
        'This removes all local trades for the selected account(s) and removes them from the account registry on this device. The currently connected MT5 account cannot be removed until you disconnect — it will be skipped automatically if selected. This cannot be undone.',
      confirmLabel: `Delete ${keys.length} account${keys.length === 1 ? '' : 's'}`
    });
  }, [selectedAccountKeys, pushToast]);

  const executeConfirmAction = useCallback(async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'clearAll') {
      await window.electronAPI?.clearTrades();
      setTrades([]);
      setSelectedIds(new Set());
      setConfirmAction(null);
      return;
    }
    if (confirmAction.type === 'deleteOne') {
      const res = await window.electronAPI?.deleteTrades?.([confirmAction.tradeId]);
      if (res?.success) {
        setTrades((prev) => prev.filter((t) => String(t.id) !== String(confirmAction.tradeId)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(tradeSelectionKey(confirmAction.tradeId));
          return next;
        });
      }
      setConfirmAction(null);
      return;
    }
    if (confirmAction.type === 'deleteSelected') {
      const ids = Array.isArray(confirmAction.ids) ? confirmAction.ids : [];
      const res = await window.electronAPI?.deleteTrades?.(ids);
      if (res?.success) {
        const idSet = new Set(ids.map((id) => String(id)));
        setTrades((prev) => prev.filter((t) => !idSet.has(String(t.id))));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(tradeSelectionKey(id)));
          return next;
        });
      }
      setConfirmAction(null);
      return;
    }
    if (confirmAction.type === 'deleteAccounts') {
      const keys = Array.isArray(confirmAction.keys) ? confirmAction.keys.filter(Boolean) : [];
      if (keys.length === 0) {
        setConfirmAction(null);
        return;
      }
      const res = await window.electronAPI?.deleteAccounts?.(keys);
      if (res?.success) {
        const removedKeys = Array.isArray(res.deletedKeys) ? res.deletedKeys : keys;
        const keySet = new Set(removedKeys.map(String));
        setTrades((prev) => prev.filter((t) => !keySet.has(String(t.accountKey || 'unknown'))));
        setSelectedIds(new Set());
        onSelectedAccountsChange?.((prev) => (Array.isArray(prev) ? prev : []).filter((k) => !keySet.has(String(k))));
        const skipped = Array.isArray(res.skippedKeys) ? res.skippedKeys : [];
        const skipLabels = skipped.map(
          (k) => mergedAccountOptions.find((a) => String(a.key) === String(k))?.label || k
        );
        if (skipped.length > 0) {
          pushToast(
            `Removed ${removedKeys.length} account(s). Skipped (live): ${skipLabels.join(', ')}`,
            'warning',
            'Accounts'
          );
        } else {
          pushToast(`Removed ${removedKeys.length} account(s) locally`, 'success', 'Accounts');
        }
      } else if (res?.reason === 'CANNOT_DELETE_CURRENT_ACCOUNT') {
        pushToast('Cannot delete the currently connected account.', 'error', 'Accounts');
      } else {
        pushToast(res?.reason || 'Delete failed', 'error', 'Accounts');
      }
      setConfirmAction(null);
    }
  }, [confirmAction, mergedAccountOptions, onSelectedAccountsChange, pushToast, setTrades]);

  const toFileUrl = useCallback((p) => {
    const raw = String(p || '').trim();
    if (!raw) return '';
    if (raw.startsWith('file://')) return encodeURI(raw);
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    return encodeURI(`file:///${normalized}`);
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    const ids = notificationHistory.filter((item) => !item?.read).map((item) => item.id);
    if (ids.length === 0) return;
    await window.electronAPI?.markNotificationsRead?.(ids, true);
    setNotificationHistory((prev) => prev.map((item) => ({ ...item, read: true })));
  }, [notificationHistory]);

  const toggleNotifSelect = useCallback((id) => {
    const sid = String(id);
    setSelectedNotifIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const clearSelectedNotifications = useCallback(async () => {
    const ids = Array.from(selectedNotifIds);
    if (ids.length === 0) return;
    const res = await window.electronAPI?.removeNotificationsByIds?.(ids);
    if (res?.success) {
      const idSet = new Set(ids.map(String));
      setNotificationHistory((prev) => prev.filter((x) => !idSet.has(String(x.id))));
      setSelectedNotifIds(new Set());
    }
  }, [selectedNotifIds]);

  const clearAllNotifications = useCallback(async () => {
    if (notificationHistory.length === 0) return;
    const ok = typeof window !== 'undefined' && window.confirm
      ? window.confirm('Remove all notifications from history?')
      : true;
    if (!ok) return;
    await window.electronAPI?.clearNotificationHistory?.();
    setNotificationHistory([]);
    setSelectedNotifIds(new Set());
  }, [notificationHistory.length]);

  const handleImportMtStatement = useCallback(async () => {
    try {
      const singleScope =
        Array.isArray(selectedAccountKeys) && selectedAccountKeys.length === 1
          ? selectedAccountKeys[0]
          : '';
      const res = await window.electronAPI?.importMtStatementDialog?.({
        targetAccountKey: singleScope || ''
      });
      if (!res || res.canceled) return;
      if (!res.success) {
        pushToast(res.error || 'Could not import statement.', 'error');
        return;
      }
      const parts = [`Imported ${res.added} closed trade(s).`];
      if (res.skippedDup) parts.push(`${res.skippedDup} duplicate ticket(s) skipped.`);
      pushToast(parts.join(' '), 'success');
      const t = await window.electronAPI?.getTrades?.();
      setTrades(Array.isArray(t) ? t : []);
    } catch (err) {
      console.error(err);
      pushToast(err?.message || 'Import failed.', 'error');
    }
  }, [selectedAccountKeys, pushToast, setTrades]);

  return (
    <div className="dashboard-shell dashboard" data-testid="page-trades">
      {/* Titlebar */}
      <div className="titlebar" data-onboarding="page-header-trades">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon"><Bolt size={16} /></span>
          <span className="brand-name">Trades</span>
          <span className="subtitle">Execution Monitor • Trade Operations</span>
        </div>
        <div className="titlebar-actions dashboard-top-actions">
          <div ref={notifWrapRef} className={`notif-top-wrap ${notificationOpen ? 'open' : ''}`}>
            <button
              className="btn btn-outline btn-titlebar btn-titlebar-compact notif-top-btn"
              onClick={() => setNotificationOpen((v) => !v)}
              title="Notifications"
            >
              <Bell size={14} />
              <span>Activity</span>
              {unreadNotifications > 0 && (
                <span className="notif-top-badge">{Math.min(unreadNotifications, 99)}</span>
              )}
            </button>
            {notificationOpen && (
              <div className="notif-top-popover">
                <div className="notif-top-header">
                  <strong>Activity &amp; Notifications</strong>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{notificationHistory.length} total</span>
                  <button className="btn btn-outline" onClick={markAllNotificationsRead}>Mark all read</button>
                </div>
                <div className="notif-top-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  {notificationHistory.length === 0 && (
                    <div className="fund-empty-inline">No activity yet.</div>
                  )}
                  {notificationHistory.slice(0, 50).map((item) => (
                    <div key={item.id} className={`notif-top-item ${item.read ? 'read' : 'unread'}`}>
                      <label className="notif-top-item-check">
                        <input
                          type="checkbox"
                          checked={selectedNotifIds.has(String(item.id))}
                          onChange={() => toggleNotifSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Select notification"
                        />
                      </label>
                      <div className="notif-top-item-main">
                        <div className="notif-top-item-head">
                          <span>{item.title || 'Notification'}</span>
                          <small>{item.time ? new Date(item.time).toLocaleTimeString() : ''}</small>
                        </div>
                        <div className="notif-top-item-body">{item.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="notif-top-foot">
                  <button type="button" className="btn btn-outline" onClick={() => setNotificationOpen(false)}>Close drawer</button>
                  <div className="notif-top-foot-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={selectedNotifIds.size === 0}
                      onClick={clearSelectedNotifications}
                    >
                      Clear selected
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={notificationHistory.length === 0}
                      onClick={clearAllNotifications}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>


          <button
            type="button"
            data-testid="trades-add-manual"
            className="btn btn-outline btn-titlebar btn-titlebar-compact"
            title="Add a closed trade on channel Manual (paste Telegram or enter fields)"
            onClick={() => setManualTradeOpen(true)}
          >
            <Plus size={14} />
            <span>Add manual</span>
          </button>

          <button
            type="button"
            data-testid="trades-import-mt-html"
            className="btn btn-outline btn-titlebar btn-titlebar-compact"
            title="Import closed trades from MT4 DetailedStatement.htm or MT5 HTML report (History → Report → Deals)"
            onClick={handleImportMtStatement}
          >
            <Upload size={14} />
            <span>Import MT HTML…</span>
          </button>

          <ScopeDateRangeToolbar
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            customRange={
              analyticsCustomRange && analyticsCustomRange.from && analyticsCustomRange.to
                ? analyticsCustomRange
                : { from: '', to: '' }
            }
            setCustomRange={setAnalyticsCustomRange}
            testIdPrefix="trades"
          />
          <AccountScopePicker
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={mergedAccountOptions}
            onSelectedAccountsChange={onSelectedAccountsChange}
            onDeleteSelectedAccounts={handleDeleteAccounts}
            deleteAccountsDisabled={mergedAccountOptions.length === 0 || selectedAccountKeys.length === 0}
          />
        </div>
      </div>

      {/* Center: Trades + Chart */}
      <div className="center-panel" data-onboarding="trades-workspace">
        {/* Stats Bar */}
        {loading ? <SkeletonStats /> : (
        <div className="stats-bar animate-enter">
          <MetricPill label="Scope" value={scopeMetricLabel} tone="accent" />
          <MetricPill label="Win Rate (TP/SL)" value={`${Number(stats.winRate || 0).toFixed(1)}%`} tone={stats.winRate >= 50 ? 'success' : 'danger'} />
          <MetricPill label="TP" value={`${Number(stats.tpHits ?? stats.wins ?? 0)}`} tone="success" />
          <MetricPill label="SL" value={`${Number(stats.slHits ?? stats.losses ?? 0)}`} tone="danger" />
          <MetricPill label="Break-Even" value={String(Number(stats.breakevens || 0))} tone="warning" />
          <MetricPill label="EOD" value={String(Number(stats.eodCloses || 0))} tone="accent" />
          <MetricPill label="Other" value={String(Number(stats.otherCloses || 0))} />
          <MetricPill label="Avg R:R" value={`1:${Number(stats.rr || 0).toFixed(2)}`} tone={stats.rr >= 1 ? 'success' : 'warning'} />
          <MetricPill label="Total P&L" value={`${stats.totalPnl >= 0 ? '+' : ''}${Number(stats.totalPnl || 0).toFixed(2)}$`} tone={stats.totalPnl >= 0 ? 'success' : 'danger'} />
          <MetricPill label="Closed" value={String(Number(stats.closedCount || 0))} />
        </div>
        )}

        {/* Filter bar */}
        <div className="filter-bar" data-testid="trades-filter-bar">
          <div className="analytics-tabs">
            {['ALL','LIVE','CLOSED','BLOCKED','SIMULATED'].map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`trades-tab-${tab.toLowerCase()}`}
                className={`analytics-tab-btn ${signalsTab === tab ? 'active' : ''}`}
                onClick={() => setTradeFilters({ signalsTab: tab })}
              >
                {tab === 'ALL' ? 'All' : tab === 'LIVE' ? 'Live' : tab === 'CLOSED' ? 'Closed' : tab === 'SIMULATED' ? 'Simulated' : 'Blocked'}
                <span className={`analytics-tab-count ${tab === 'BLOCKED' ? 'tab-count-blocked' : ''}`}>
                  {tab === 'ALL' ? tabCounts.all : tab === 'LIVE' ? tabCounts.live : tab === 'CLOSED' ? tabCounts.closed : tab === 'SIMULATED' ? tabCounts.simulated : tabCounts.blocked}
                </span>
              </button>
            ))}
          </div>
          <input
            className="filter-input"
            data-testid="trades-filter-symbol"
            placeholder="Symbol..."
            value={filterSymbol}
            onChange={(e) => setTradeFilters({ filterSymbol: e.target.value })}
          />
          <select className="filter-select" data-testid="trades-filter-type" value={filterType} onChange={(e) => setTradeFilters({ filterType: e.target.value })}>
            <option value="ALL">All Types</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <select className="filter-select" data-testid="trades-filter-status" value={filterStatus} onChange={(e) => setTradeFilters({ filterStatus: e.target.value })}>
            <option value="ALL">All Status</option>
            <option value="SENT">Sent</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
            <option value="TP">TP</option>
            <option value="SL">SL</option>
            <option value="BE">BE</option>
            <option value="EOD">EOD close</option>
            <option value="BLOCKED">Blocked / filtered</option>
          </select>
          <select className="filter-select" data-testid="trades-filter-channel" value={filterChannel} onChange={(e) => setTradeFilters({ filterChannel: e.target.value })}>
            <option value="ALL">All Channels</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            className="btn-reset-filters"
            data-testid="trades-reset-filters"
            onClick={resetTradeFilters}
            disabled={filtersAreDefault}
            title="Reset all filters including slice filters (shared with Dashboard)"
          >
            Reset all
          </button>
          <span className="filter-count">{filteredTrades.length} / {timeScopedTrades.length}</span>
          <button
            type="button"
            data-testid="trades-refresh"
            className="btn-refresh-trades"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh open/closed trades and account stats from MT5"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="btn-delete" onClick={handleDeleteSelected} disabled={visibleSelectedCount === 0}>
            Delete Selected
          </button>
          <button className="btn-clear" onClick={handleClear}>Clear</button>
          {settings?.aiCheck?.enabled && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleAnalyseSelected}
              disabled={visibleSelectedCount === 0}
              title="Send selected trades to the free AI for review"
            >
              🤖 Analyse with AI
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleResendSelected}
            disabled={refreshing || visibleSelectedCount === 0}
            title="Resend selected trades to MT5"
          >
            ↻ Resend to MT5
          </button>
          <select
            className="filter-select"
            data-testid="trades-export"
            value=""
            onChange={(e) => { handleExport(e.target.value); e.target.value = ''; }}
            title={visibleSelectedCount > 0
              ? `Export ${visibleSelectedCount} selected trade(s)`
              : `Export all ${filteredTrades.length} filtered trade(s)`}
          >
            <option value="" disabled>Export…</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="pdf">PDF</option>
          </select>
        </div>

        <div className="filter-bar filter-bar-slice" data-testid="trades-slice-bar">
          <span className="filter-slice-label">Slice stats &amp; table</span>
          {dimOn('timeframe') && (
            <MultiPickFilter testId="trades-slice-tf" label="TF" options={sliceOptions.tfs} selected={sliceTimeframes} onChange={(v) => setTradeFilters({ sliceTimeframes: v })} />
          )}
          {dimOn('symbol') && (
            <MultiPickFilter testId="trades-slice-pair" label="Pair" options={sliceOptions.pairs} selected={slicePairs} onChange={(v) => setTradeFilters({ slicePairs: v })} />
          )}
          {dimOn('bias') && (
            <MultiPickFilter testId="trades-slice-bias" label="Bias" options={sliceOptions.biases} selected={sliceBiases} onChange={(v) => setTradeFilters({ sliceBiases: v })} />
          )}
          {dimOn('setup') && (
            <MultiPickFilter
              testId="trades-slice-setup"
              label="Setup"
              options={sliceOptions.setups}
              selected={sliceSetups}
              onChange={(v) => setTradeFilters({ sliceSetups: v })}
              formatOption={(s) => (s.length > 42 ? `${s.slice(0, 39)}…` : s)}
              maxMenuHeight={280}
            />
          )}
          {dimOn('vwap') && (
            <MultiPickFilter
              testId="trades-slice-vwap"
              label="VWAP"
              options={sliceOptions.vwapBands}
              selected={sliceVwapBands}
              onChange={(v) => setTradeFilters({ sliceVwapBands: v })}
              formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
            />
          )}
          {dimOn('hvn') && (
            <MultiPickFilter
              testId="trades-slice-hvn"
              label="HVN"
              options={sliceOptions.hvnBands}
              selected={sliceHvnBands}
              onChange={(v) => setTradeFilters({ sliceHvnBands: v })}
              formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
            />
          )}
          <MultiPickFilter
            testId="trades-slice-session"
            label="Session"
            options={sliceOptions.sessions}
            selected={sliceSessions}
            onChange={(v) => setTradeFilters({ sliceSessions: v })}
            formatOption={(s) => (s === 'asian' ? 'Asian' : s === 'london' ? 'London' : s === 'newYork' ? 'NY' : s)}
          />
          <MultiPickFilter
            testId="trades-slice-weekday"
            label="Weekday"
            options={SLICE_WEEKDAY_ORDER}
            selected={sliceWeekdays}
            onChange={(v) => setTradeFilters({ sliceWeekdays: v })}
            formatOption={formatWeekdaySliceOption}
            allButtonLabel="All days"
            allButtonTitle="Include every weekday (clear day filter)"
            emptyHint="Weekdays"
          />
          <MultiPickFilter
            testId="trades-slice-tags"
            label="Tags"
            options={sliceOptions.tags}
            selected={sliceTags}
            onChange={(v) => setTradeFilters({ sliceTags: v })}
            emptyHint="Journal tags"
          />
          <button
            type="button"
            className="btn-reset-filters"
            data-testid="trades-reset-all-slice"
            onClick={resetTradeFilters}
            disabled={filtersAreDefault}
            title="Reset all filters including tabs, symbol, and slice picks"
          >
            Reset all
          </button>
          <FilterTemplatesControl
            tradeFilters={tradeFilters}
            setTradeFilters={setTradeFilters}
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            analyticsCustomRange={analyticsCustomRange}
            setAnalyticsCustomRange={setAnalyticsCustomRange}
            results={templateResults}
            filterSummary={dashboardStatsFilterSummary}
            testIdPrefix="trades-filter-templates"
          />
          <span className="filter-slice-hint">No selection = all · several ticked = match any of them</span>
        </div>

        {loading ? <SkeletonTable rows={8} /> : (
          <TradeTable
            trades={filteredTrades}
            selectedIds={selectedIds}
            customTradeColumns={Array.isArray(settings?.customTradeColumns) ? settings.customTradeColumns : []}
            tradeBuiltinColumns={Array.isArray(settings?.tradeBuiltinColumns) ? settings.tradeBuiltinColumns : []}
            breakEvenAmount={Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50)}
            onToggleSelect={handleToggleSelect}
            screenerBiasMap={screenerBiasMap}
            onOpenScreenshots={(trade) => {
              setShotsTrade(trade);
              setActiveShotIdx(0);
            }}
            onOpenTradeDetail={(trade) => setDetailTrade(trade)}
            emptyStateText={
              signalsTab === 'BLOCKED'
                ? 'No blocked or filtered signals in this scope. Trades stopped by schedule, news guard, or filters appear here with a reason — they are not sent to MT5.'
                : signalsTab === 'LIVE'
                  ? 'No open pipeline trades (pending / sent / active) in this scope.'
                  : signalsTab === 'CLOSED'
                    ? 'No closed trades in this scope yet.'
                    : undefined
            }
          />
        )}
        <AiInsightsPanel
          ref={aiPanelRef}
          enabled={!!settings?.aiCheck?.enabled}
          pollActive={routeVisible}
          selectedTradeIds={selectedTradeIds}
        />
        <DashboardStatsAiCard
          enabled={!!settings?.aiCheck?.enabled}
          filterSummary={dashboardStatsFilterSummary}
          tradeIds={dashboardStatsAiTradeIds}
          scopeKey={dashboardStatsAiScopeKey}
        />
        <LogsPanel />
      </div>

      {/* Right: Status — slim sidebar + floating toggle (same pattern as left nav) */}
      <div className={`session-sidebar ${rightPanelCollapsed ? 'collapsed' : 'expanded'}`}>
        <button
          type="button"
          className="session-sidebar-toggle"
          data-testid="session-sidebar-toggle"
          onClick={() => setRightPanelCollapsed((v) => !v)}
          title={rightPanelCollapsed ? 'Expand session panel' : 'Collapse session panel'}
          aria-expanded={!rightPanelCollapsed}
        >
          {rightPanelCollapsed ? '◀' : '▶'}
        </button>
        {!rightPanelCollapsed && (
          <StatusPanel
            mt5Connected={mt5Connected}
            bridgeMeta={bridgeMeta}
            trades={filteredTrades}
            lastUpdatedAt={lastUpdatedAt}
            accountSnapshot={accountSnapshot}
            currentMt5Account={currentMt5Account}
            settings={settings}
            analytics={analytics}
            onConfigure={onOpenSettingsPage}
          />
        )}
      </div>

      {shotsTrade && (
        <div className="trade-shots-overlay" onClick={() => setShotsTrade(null)}>
          <div className="trade-shots-modal" onClick={(e) => e.stopPropagation()}>
            <div className="trade-shots-header">
              <h3>Trade Screenshots - {shotsTrade.symbol} {shotsTrade.type}</h3>
              <button className="modal-close" onClick={() => setShotsTrade(null)}>×</button>
            </div>
            {shotsDisplayList.length > 0 ? (
              <>
                <div className="trade-shots-stagebar">
                  {shotsDisplayList.map((shot, idx) => (
                    <button
                      key={shot.id || `${shot.path}-${idx}`}
                      className={`trade-shot-pill ${idx === activeShotIdx ? 'active' : ''}`}
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

      {manualTradeOpen && (
        <ManualTradeModal
          onClose={() => setManualTradeOpen(false)}
          onSaved={(trade) => {
            if (trade?.id) {
              setTrades((prev) => [trade, ...prev.filter((t) => String(t.id) !== String(trade.id))]);
              pushToast(`Manual trade saved: ${trade.type} ${trade.symbol}`, 'success');
            }
          }}
        />
      )}

      {detailTrade && (
        <TradeDetailModal
          trade={detailTradeLive || detailTrade}
          tagPresets={Array.isArray(settings?.tradePresets) ? settings.tradePresets : []}
          saving={savingJournal}
          onClose={() => setDetailTrade(null)}
          onSave={async ({ patch, journalPatch, applyToMt5 }) => {
            setSavingJournal(true);
            try {
              const tradeId = (detailTradeLive || detailTrade).id;
              const hintTrade = detailTrade || detailTradeLive;
              const result = await window.electronAPI?.updateTrade?.(
                tradeId,
                { patch, journalPatch, applyToMt5, hintTrade }
              );
              if (result?.success && result.trade) {
                setTrades((prev) => prev.map((t) => (
                  String(t.id) === String(result.trade.id) ? result.trade : t
                )));
                setDetailTrade(result.trade);
                onTradeUpdated?.(result.trade);
                pushToast('Trade saved', 'success', 'Saved');
                if (applyToMt5) {
                  pushToast(
                    result.mt5Modify?.sent ? 'SL/TP sent to MT5' : 'Saved locally — MT5 bridge unavailable',
                    result.mt5Modify?.sent ? 'success' : 'warning',
                    'Modify'
                  );
                }
              } else {
                pushToast(result?.reason || result?.error || 'Save failed', 'error', 'Trade update');
              }
            } catch (e) {
              pushToast(e?.message || 'Save failed', 'error', 'Trade update');
            } finally {
              setSavingJournal(false);
            }
          }}
        />
      )}

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger
          onCancel={() => setConfirmAction(null)}
          onConfirm={executeConfirmAction}
          confirmDisabled={confirmAction.type === 'deleteAccounts' && !(confirmAction.keys?.length > 0)}
        >
          {confirmAction.type === 'deleteAccounts' && Array.isArray(confirmAction.keys) && confirmAction.keys.length > 0 && (
            <div className="confirm-account-picker confirm-account-delete-list">
              <div className="hint">Accounts to remove from this device:</div>
              <ul className="confirm-account-delete-ul">
                {confirmAction.keys.map((k) => {
                  const label = mergedAccountOptions.find((a) => a.key === k)?.label || k;
                  return (
                    <li key={k}>{label}</li>
                  );
                })}
              </ul>
            </div>
          )}
        </ConfirmModal>
      )}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

