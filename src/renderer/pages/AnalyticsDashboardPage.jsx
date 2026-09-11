import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bolt, RotateCcw, Settings2 } from 'lucide-react';
import TradeTable from '../components/TradeTable.jsx';
import TradeDetailModal from '../components/TradeDetailModal.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import AccountScopePicker from '../components/AccountScopePicker.jsx';
import CalendarDaySelector from '../components/ui/calendar-day-selector.jsx';
import ScopeDateRangeToolbar from '../components/ScopeDateRangeToolbar.jsx';
import { MetricPill } from '../components/ui';
import HourlyPnLHeatmap from '../components/HourlyPnLHeatmap.jsx';
import FundamentalsDigestCard from '../components/FundamentalsDigestCard.jsx';
import DashboardGrid from '../components/dashboard/DashboardGrid.jsx';
import { tradeMatchesTimeScope, isoYmdCustomRangeBounds } from '../utils/timeCalendarScope.js';
import { tradeSelectionKey } from '../utils/tradeSelectionKey.js';
import { tradeMatchesSlice, uniqueSortedStrings, canonicalTradeVwapBand, canonicalTradeHvnBand, SLICE_SESSION_KEYS, SLICE_WEEKDAY_ORDER, formatWeekdaySliceOption } from '../utils/tradeSliceFilters.js';
import { sortTradeScreenshotsForDisplay } from '../utils/tradeScreenshotsDisplay.js';
import { useScreenshotViewerKeys } from '../hooks/useScreenshotViewerKeys.js';
import AdvancedAnalyticsPanel from '../components/AdvancedAnalyticsPanel.jsx';
import { buildFilterSummaryText } from '../utils/filterSummaryText.js';
import MultiPickFilter from '../components/MultiPickFilter.jsx';
import FilterTemplatesControl from '../components/FilterTemplatesControl.jsx';
import { computeTemplateResults } from '../utils/filterPresetMatch.js';
import { effectiveAccountKeysForScope, tradeMatchesAccountScope } from '../utils/accountScope.js';
import {
  tradeIsBlocked as isBlockedTrade,
  tradeIsClosed as isClosedTrade,
  tradeIsLive,
  tradeMatchesFocusStatus,
  getTradeOutcome
} from '../utils/tradeStatus.js';
import { tradeFiltersAreDefault } from '../hooks/usePersistedTradeFilters.js';
import { resolveFilterDimensions, stripDisabledSliceFilters } from '../utils/filterDimensions.js';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Columns for the Weekday × Session matrix (canonical sessionModel keys as used by analytics). */
const SESSION_MATRIX_COLS = [
  { key: 'asian', label: 'Asia' },
  { key: 'london', label: 'London' },
  { key: 'newYork', label: 'NY' },
  { key: 'off', label: 'Off' }
];
const SESSION_MATRIX_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Display order + labels for ICT killzone slices (see main/sessionModel.getKillzone). */
const KILLZONE_DISPLAY = [
  { key: 'asia-kz', label: 'Asia KZ', hint: '00:00–04:00 UTC' },
  { key: 'london-open-kz', label: 'London Open KZ', hint: '07:00–10:00 UTC' },
  { key: 'ny-am-kz', label: 'NY AM KZ', hint: 'NY open → +2h30 (DST-aware)' },
  { key: 'silver-bullet', label: 'Silver Bullet', hint: 'NY 10–11am (15–16 UTC summer / 16–17 winter)' },
  { key: 'london-close-kz', label: 'London Close KZ', hint: '15:00–17:00 UTC' },
  { key: 'none', label: 'No killzone', hint: 'Outside every killzone window' }
];

function formatMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

function formatDurationHours(ms) {
  const totalHours = Number(ms || 0) / (1000 * 60 * 60);
  if (!Number.isFinite(totalHours) || totalHours <= 0) return '0h';
  if (totalHours < 1) return `${Math.round(totalHours * 60)}m`;
  return `${totalHours.toFixed(1)}h`;
}

function parseTradeDate(trade) {
  const candidates = [trade?.openedAt, trade?.lastUpdateAt, trade?.time];
  for (const value of candidates) {
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}



function weekdayName(raw = '') {
  const idx = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].indexOf(String(raw || '').toUpperCase());
  return idx >= 0 ? WEEK_DAYS[idx] : raw;
}

function hourLabel(raw = '') {
  const h = Number(raw);
  if (!Number.isFinite(h)) return raw;
  return `${String(h).padStart(2, '0')}:00`;
}

export default function AnalyticsDashboardPage({
  trades = [],
  setTrades,
  currentMt5Account,
  timeScope = 'DAY',
  setTimeScope,
  analyticsCustomRange = null,
  setAnalyticsCustomRange = () => {},
  onOpenSettingsPage,
  onOpenFundamentalsPage,
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  routeVisible = true,
  tradeFilters,
  setTradeFilters = () => {},
  resetTradeFilters = () => {}
}) {
  const [settings, setSettings] = useState(null);
  const lastUpdatedAt = useMemo(() => {
    const times = trades.flatMap((t) => [t.lastUpdateAt, t.openedAt]).filter(Boolean);
    return times.length ? times.sort().at(-1) : null;
  }, [trades]);
  const [analytics, setAnalytics] = useState(null);
  const [excursionSummary, setExcursionSummary] = useState(null);
  const [excursionLoading, setExcursionLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setExcursionLoading(true);
    window.electronAPI?.getExcursionSummary?.({ accountKeys: selectedAccountKeys })
      .then((res) => { if (alive && res?.success) setExcursionSummary(res); })
      .catch(() => {})
      .finally(() => { if (alive) setExcursionLoading(false); });
    return () => { alive = false; };
  }, [trades, selectedAccountKeys]);
  const [loading, setLoading] = useState(true);
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

  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardEditMode, setDashboardEditMode] = useState(false);
  const [dashboardLayoutResetNonce, setDashboardLayoutResetNonce] = useState(0);

  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [selectedNotifIds, setSelectedNotifIds] = useState(() => new Set());
  const notifWrapRef = useRef(null);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [shotsTrade, setShotsTrade] = useState(null);
  const [activeShotIdx, setActiveShotIdx] = useState(0);
  const shotsDisplayList = useMemo(
    () => sortTradeScreenshotsForDisplay(shotsTrade?.screenshots),
    [shotsTrade?.screenshots]
  );
  useScreenshotViewerKeys(!!shotsTrade, shotsDisplayList.length, setActiveShotIdx);
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

  const [calendarMeasuredHeight, setCalendarMeasuredHeight] = useState(0);

  const selectionSeeded = useRef(false);

  useEffect(() => {
    if (signalsTab === 'LIVE') setActiveTab('live');
    else if (signalsTab === 'CLOSED') setActiveTab('closed');
    else if (signalsTab === 'ALL' || signalsTab === 'BLOCKED') setActiveTab('overview');
  }, [signalsTab]);

  const handleAnalyticsTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
    if (tabId === 'live') setTradeFilters({ signalsTab: 'LIVE' });
    else if (tabId === 'closed') setTradeFilters({ signalsTab: 'CLOSED' });
    else setTradeFilters({ signalsTab: 'ALL' });
  }, [setTradeFilters]);

  useEffect(() => {
    if (selectionSeeded.current) return;
    if (!Array.isArray(trades) || trades.length === 0) return;
    selectionSeeded.current = true;
    setSelectedIds(new Set(trades.map((x) => tradeSelectionKey(x.id))));
  }, [trades]);

  /** New trades from App are prepended — select newest id if missing */
  useEffect(() => {
    if (!Array.isArray(trades) || trades.length === 0) return;
    const newestKey = tradeSelectionKey(trades[0].id);
    setSelectedIds((prev) => {
      if (prev.has(newestKey)) return prev;
      return new Set([...prev, newestKey]);
    });
  }, [trades]);

  useEffect(() => {
    window.electronAPI?.getSettings?.().then((s) => {
      setSettings(s || null);
      setLoading(false);
    }).catch(() => setLoading(false));
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
      if (!notifWrapRef.current.contains(evt.target)) setNotificationOpen(false);
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

  const channels = useMemo(() => [...new Set(trades.map((t) => t.channel).filter(Boolean))], [trades]);
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

  const analysisTradesBase = useMemo(() => {
    const beAmount = Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50);
    return accountScopedTrades.filter((t) => {
      if (signalsTab === 'LIVE' && !tradeIsLive(t)) return false;
      if (signalsTab === 'CLOSED' && !isClosedTrade(t)) return false;
      if (signalsTab === 'BLOCKED' && !isBlockedTrade(t)) return false;
      if (filterSymbol && !String(t.symbol || '').toLowerCase().includes(filterSymbol.toLowerCase())) return false;
      if (filterType !== 'ALL' && String(t.type || '').toUpperCase() !== filterType) return false;
      if (!tradeMatchesFocusStatus(t, filterStatus, beAmount)) return false;
      if (filterChannel !== 'ALL' && t.channel !== filterChannel) return false;
      return tradeMatchesTimeScope(t, timeScope, new Date(), customScopeBounds);
    });
  }, [accountScopedTrades, signalsTab, filterSymbol, filterType, filterStatus, settings?.analyticsBreakEvenAmount, filterChannel, timeScope, customScopeBounds]);

  const sliceOptions = useMemo(() => ({
    tfs: uniqueSortedStrings(
      analysisTradesBase.map((t) => String(t.timeframe || '').toUpperCase().trim()).filter(Boolean)
    ),
    pairs: uniqueSortedStrings(analysisTradesBase.map((t) => t.symbol)),
    biases: uniqueSortedStrings(analysisTradesBase.map((t) => t.bias)),
    setups: uniqueSortedStrings(
      [
        ...analysisTradesBase.flatMap((t) => (Array.isArray(t.presetTags) ? t.presetTags : [])),
        ...analysisTradesBase.map((t) => t.setup).filter(Boolean),
        ...(Array.isArray(settings?.tradePresets) ? settings.tradePresets : [])
      ],
      { limit: 200 }
    ),
    vwapBands: (() => {
      const raw = [...new Set(analysisTradesBase.map((t) => canonicalTradeVwapBand(t)).filter(Boolean))];
      const order = { yes: 0, no: 1, na: 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    hvnBands: (() => {
      const raw = [...new Set(analysisTradesBase.map((t) => canonicalTradeHvnBand(t)).filter(Boolean))];
      const order = { yes: 0, no: 1, na: 2 };
      raw.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
      return raw;
    })(),
    sessions: [...SLICE_SESSION_KEYS],
    tags: uniqueSortedStrings(
      analysisTradesBase.flatMap((t) => [
        ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
        ...(Array.isArray(t?.presetTags) ? t.presetTags : []),
      ]),
      { limit: 100 }
    ),
  }), [analysisTradesBase, settings?.tradePresets]);

  const analysisTrades = useMemo(() => {
    return analysisTradesBase.filter((t) => {
      if (!tradeMatchesSlice(t, sliceFilterPayload)) return false;
      if (sliceTags.length > 0) {
        const tags = [
          ...(Array.isArray(t?.journal?.tags) ? t.journal.tags : []),
          ...(Array.isArray(t?.presetTags) ? t.presetTags : []),
        ].map((x) => String(x || '').toLowerCase());
        if (!sliceTags.some((wanted) => tags.includes(String(wanted).toLowerCase()))) return false;
      }
      return true;
    });
  }, [analysisTradesBase, sliceFilterPayload, sliceTags]);

  /** Enriched rows for calendar-style weekday / pair tables (same basis as Analytics calendar). */
  const dashboardAnalysisRows = useMemo(() => {
    const out = [];
    for (const t of analysisTrades) {
      const d = parseTradeDate(t);
      if (!d) continue;
      out.push({
        ...t,
        _date: d,
        _hour: d.getHours(),
        _profit: Number(t.profit || 0)
      });
    }
    return out;
  }, [analysisTrades]);

  const analyticsDashWeekdayRows = useMemo(() => {
    const buckets = WEEK_DAYS.map((name, index) => ({ name, index, pnl: 0, trades: 0, wins: 0 }));
    for (const t of dashboardAnalysisRows) {
      const b = buckets[t._date.getDay()];
      b.pnl += t._profit;
      b.trades += 1;
      if (t._profit > 0) b.wins += 1;
    }
    return buckets;
  }, [dashboardAnalysisRows]);

  const maxAnalyticsDashWeekdayTrades = useMemo(() =>
    Math.max(...analyticsDashWeekdayRows.map((x) => x.trades), 1),
  [analyticsDashWeekdayRows]);

  const analyticsDashPairRows = useMemo(() => {
    const map = new Map();
    for (const t of dashboardAnalysisRows) {
      const key = t.symbol || 'UNKNOWN';
      const prev = map.get(key) || { symbol: key, pnl: 0, trades: 0, wins: 0, buy: 0, sell: 0 };
      prev.pnl += t._profit;
      prev.trades += 1;
      if (t._profit > 0) prev.wins += 1;
      if (String(t.type || '').toUpperCase() === 'BUY') prev.buy += 1;
      if (String(t.type || '').toUpperCase() === 'SELL') prev.sell += 1;
      map.set(key, prev);
    }
    return [...map.values()].sort((a, b) => b.trades - a.trades).slice(0, 12);
  }, [dashboardAnalysisRows]);

  const maxAnalyticsDashPairTrades = useMemo(() =>
    Math.max(...analyticsDashPairRows.map((p) => p.trades), 1),
  [analyticsDashPairRows]);

  const dashboardFilterSummary = useMemo(() => buildFilterSummaryText({
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

  const templateResults = useMemo(
    () => computeTemplateResults(
      analysisTrades,
      Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50)
    ),
    [analysisTrades, settings?.analyticsBreakEvenAmount]
  );

  const analyticsFilters = useMemo(() => ({
    accountKeys: effectiveAccountKeys,
    symbol: filterSymbol,
    type: filterType,
    status: filterStatus,
    channel: filterChannel,
    timeScope,
    scopeFrom: String(timeScope || '').toUpperCase() === 'CUSTOM' ? (analyticsCustomRange?.from || '') : '',
    scopeTo: String(timeScope || '').toUpperCase() === 'CUSTOM' ? (analyticsCustomRange?.to || '') : '',
    analyticsBreakEvenAmount: Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50),
    timeframes: sliceTimeframes,
    symbols: slicePairs,
    biasTerms: sliceBiases,
    setupTerms: sliceSetups,
    vwapBands: sliceVwapBands,
    hvnBands: sliceHvnBands,
    sessionNames: sliceSessions,
    weekdayIndices: sliceWeekdays
  }), [effectiveAccountKeys, filterSymbol, filterType, filterStatus, filterChannel, timeScope, analyticsCustomRange?.from, analyticsCustomRange?.to, settings?.analyticsBreakEvenAmount, sliceTimeframes, slicePairs, sliceBiases, sliceSetups, sliceVwapBands, sliceHvnBands, sliceSessions, sliceWeekdays]);

  useEffect(() => {
    if (!routeVisible) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      window.electronAPI?.getAnalyticsSummary?.(analyticsFilters).then((summary) => {
        if (!active) return;
        setAnalytics(summary || null);
      }).catch(() => {
        if (!active) return;
        setAnalytics(null);
      });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [analyticsFilters, trades, routeVisible]);

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

  const totals = analytics?.totals || {};
  const advanced = analytics?.advanced || {};
  const sessions = advanced?.sessions || {};
  const breakdowns = analytics?.breakdowns || {};
  const sessionRows = ['asian', 'london', 'newYork', 'off'].map((name) => ({
    name,
    pnl: Number(sessions?.[name]?.pnl || 0),
    trades: Number(sessions?.[name]?.trades || 0),
    winRate: Number(sessions?.[name]?.winRate || 0)
  }));
  const bestSession = [...sessionRows].sort((a, b) => b.pnl - a.pnl)[0] || null;
  const worstSession = [...sessionRows].sort((a, b) => a.pnl - b.pnl)[0] || null;
  const topSymbol = (breakdowns?.bySymbol || [])[0] || null;
  const topChannel = (breakdowns?.byChannel || [])[0] || null;
  const worstWeekday = [...(breakdowns?.byWeekday || [])].sort((a, b) => a.pnl - b.pnl)[0] || null;
  const bestHour = [...(breakdowns?.byHour || [])].sort((a, b) => b.pnl - a.pnl)[0] || null;

  const weekdaySessionMatrix = useMemo(() => {
    const cells = new Map();
    let maxAbs = 0;
    for (const row of (analytics?.breakdowns?.byWeekdaySession || [])) {
      cells.set(`${row.weekday}|${row.session}`, row);
      if (SESSION_MATRIX_WEEKDAYS.includes(row.weekday)) {
        maxAbs = Math.max(maxAbs, Math.abs(Number(row.pnl) || 0));
      }
    }
    return { cells, maxAbs: Math.max(maxAbs, 0.01) };
  }, [analytics?.breakdowns?.byWeekdaySession]);

  const killzoneRows = useMemo(() => {
    const byKey = new Map((analytics?.breakdowns?.byKillzone || []).map((r) => [r.key, r]));
    return KILLZONE_DISPLAY
      .map((kz) => ({ ...kz, ...(byKey.get(kz.key) || { pnl: 0, trades: 0, winRate: 0 }) }))
      .filter((kz) => kz.trades > 0 || kz.key !== 'none');
  }, [analytics?.breakdowns?.byKillzone]);

  const tpSlWinRate = totals?.tpSlWinRate;
  const tpHits = Number(totals?.tpHits || 0);
  const slHits = Number(totals?.slHits || 0);
  const beCount = Number(totals?.breakevens || 0);

  const healthScore = useMemo(() => {
    const wr = tpSlWinRate != null ? Number(tpSlWinRate) : Number(totals?.winRate || 0);
    const winRateScore = Math.max(0, Math.min(100, wr));
    const pfScore = Math.max(0, Math.min(100, Number(advanced?.profitFactor || 0) * 30));
    const ddPenalty = Math.max(0, Math.min(40, Number(advanced?.maxDrawdown || 0) / 100));
    return Math.max(0, Math.min(100, Math.round((winRateScore * 0.45) + (pfScore * 0.45) - ddPenalty)));
  }, [tpSlWinRate, totals?.winRate, advanced?.profitFactor, advanced?.maxDrawdown]);

  const insights = useMemo(() => {
    const rows = [];
    if (topSymbol) rows.push(`Top symbol edge: ${topSymbol.key} (${formatMoney(topSymbol.pnl)} across ${topSymbol.trades} trades).`);
    if (topChannel) rows.push(`Best channel contribution: ${topChannel.key} (${formatMoney(topChannel.pnl)}).`);
    if (bestHour) rows.push(`Best trading hour: ${hourLabel(bestHour.key)} (${formatMoney(bestHour.pnl)}).`);
    if (worstWeekday) rows.push(`Weak weekday detected: ${weekdayName(worstWeekday.key)} (${formatMoney(worstWeekday.pnl)}).`);
    if (tpSlWinRate != null && Number(tpSlWinRate) < 50 && tpHits + slHits >= 5) {
      rows.push(`TP/SL win rate is ${Number(tpSlWinRate).toFixed(1)}% (${tpHits} TP vs ${slHits} SL).`);
    }
    return rows.slice(0, 5);
  }, [topSymbol, topChannel, bestHour, worstWeekday, tpSlWinRate, tpHits, slHits]);

  const alerts = [
    Number(advanced?.maxDrawdown || 0) > Math.max(50, Math.abs(Number(totals?.totalPnl || 0)) * 0.8)
      ? `Drawdown is elevated (${formatMoney(advanced?.maxDrawdown || 0)}).`
      : null,
    Number(totals?.rr || 0) < 1 ? `Average R:R is below 1 (${Number(totals?.rr || 0).toFixed(2)}).` : null,
    (tpSlWinRate != null ? Number(tpSlWinRate) : Number(totals?.winRate || 0)) < 45
      ? `TP/SL win rate is weak (${(tpSlWinRate != null ? Number(tpSlWinRate) : Number(totals?.winRate || 0)).toFixed(1)}%).`
      : null
  ].filter(Boolean);

  const filteredTableTrades = useMemo(() => {
    return analysisTrades.filter((t) => {
      if (activeTab === 'live' && isClosedTrade(t)) return false;
      if (activeTab === 'closed' && !isClosedTrade(t)) return false;
      return true;
    });
  }, [analysisTrades, activeTab]);

  const visibleSelectedIds = useMemo(
    () => new Set(
      filteredTableTrades.filter((t) => selectedIds.has(tradeSelectionKey(t.id))).map((t) => tradeSelectionKey(t.id))
    ),
    [filteredTableTrades, selectedIds]
  );
  const visibleSelectedCount = visibleSelectedIds.size;

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
      await window.electronAPI?.refreshTrades?.();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setConfirmAction({
      type: 'clearAll',
      title: 'Delete all trades?',
      message: 'This will permanently remove all trades from local history.',
      confirmLabel: 'Delete all'
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const ids = filteredTableTrades.filter((t) => selectedIds.has(tradeSelectionKey(t.id))).map((t) => t.id);
    if (ids.length === 0) return;
    setConfirmAction({
      type: 'deleteSelected',
      ids,
      title: `Delete ${ids.length} selected trade(s)?`,
      message: 'Selected trades will be removed permanently.',
      confirmLabel: `Delete ${ids.length}`
    });
  }, [filteredTableTrades, selectedIds]);

  const handleDeleteAccounts = useCallback(() => {
    const keys = Array.isArray(selectedAccountKeys) ? selectedAccountKeys.filter(Boolean) : [];
    if (keys.length === 0) {
      window.alert('Select one or more accounts in All Accounts first.');
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
  }, [selectedAccountKeys]);

  const executeConfirmAction = useCallback(async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'clearAll') {
      await window.electronAPI?.clearTrades?.();
      setTrades([]);
      setSelectedIds(new Set());
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
        if (skipped.length > 0) {
          window.alert(
            `Removed ${removedKeys.length} account(s).\nSkipped (still connected): ${skipped.join(', ')}`
          );
        }
      } else if (res?.reason === 'CANNOT_DELETE_CURRENT_ACCOUNT') {
        window.alert('Cannot delete the currently connected account.');
      } else {
        window.alert(res?.reason || 'Delete failed');
      }
      setConfirmAction(null);
      return;
    }
  }, [confirmAction, onSelectedAccountsChange, setTrades]);

  const toFileUrl = useCallback((p) => {
    const raw = String(p || '').trim();
    if (!raw) return '';
    if (raw.startsWith('file://')) return encodeURI(raw);
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    return encodeURI(`file:///${normalized}`);
  }, []);

  const navigateToPage = useCallback((pageId) => {
    document.querySelector(`[data-testid="nav-${pageId}"]`)?.click();
  }, []);

  const exitDashboardEditMode = useCallback(() => {
    setDashboardEditMode(false);
  }, []);

  const dashboardSharedCtx = useMemo(() => ({
    totals,
    advanced,
    analytics,
    excursionSummary,
    excursionLoading,
    timeScope,
    setTimeScope,
    analysisTrades,
    effectiveAccountKeys,
    selectedAccountKeys,
    settings,
    loading,
    scopeMetricLabel,
    tpSlWinRate,
    tpHits,
    slHits,
    beCount,
    topSymbol,
    topChannel,
    bestSession,
    sessionRows,
    tradesRevision: trades.length,
    navigateToPage,
    onOpenTradeDetail: setDetailTrade
  }), [
    totals,
    advanced,
    analytics,
    excursionSummary,
    excursionLoading,
    timeScope,
    setTimeScope,
    analysisTrades,
    effectiveAccountKeys,
    selectedAccountKeys,
    settings,
    loading,
    scopeMetricLabel,
    tpSlWinRate,
    tpHits,
    slHits,
    beCount,
    topSymbol,
    topChannel,
    bestSession,
    sessionRows,
    trades.length,
    navigateToPage
  ]);

  const fixedOverviewSections = ['fundamentals', 'calendar', 'middle', 'main', 'breakdown'];

  function renderOverviewWidget(wid) {
    switch (wid) {
      case 'fundamentals':
        return (
          <div className="analytics-fundamentals-above-calendar">
            <FundamentalsDigestCard
              routeVisible={routeVisible}
              aiEnabled={!!settings?.aiCheck?.enabled}
              onOpenFundamentals={onOpenFundamentalsPage}
            />
          </div>
        );
      case 'calendar':
        return (
          <div
            className="analytics-card analytics-card-calendar-full dash-widget-calendar-card"
            style={{ minHeight: calendarMeasuredHeight > 0 ? `${calendarMeasuredHeight + 30}px` : undefined }}
          >
            <CalendarDaySelector
              trades={analysisTrades}
              analyticsBreakEvenAmount={Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50)}
              compact
              showViewControls={false}
              showRangeControls={false}
              className="dashboard-calendar-selector"
              style={{ gap: 8 }}
              onHeightChange={setCalendarMeasuredHeight}
              onOpenTradeDetail={(trade) => setDetailTrade(trade)}
            />
          </div>
        );
      case 'middle':
        return (
          <div className="analytics-post-calendar">
            <div className="analytics-card analytics-card-heatmap-dash">
              <HourlyPnLHeatmap
                byHour={analytics?.breakdowns?.byHour}
                title="Hourly Trading Heatmap"
                subtitle="P&L by hour of day"
                valueMode={['WEEK', 'MONTH', 'YEAR', 'ALL', 'CUSTOM'].includes(String(timeScope || '').toUpperCase()) ? 'avg' : 'sum'}
                scopeLabel={scopeMetricLabel}
                className="analytics-dash-hourly-heatmap-inner"
              />
              <div className="analytics-dash-hourly-legend">
                <span>Green = profitable hour</span>
                <span>Red = loss hour</span>
                <span>Darker = higher intensity</span>
              </div>
            </div>

            <div className="analytics-post-calendar-split">
              <div className="analytics-card analytics-card-weekday-split">
                <div className="analytics-card-head analytics-card-head-inline">
                  <span className="title-with-emoji"><span aria-hidden="true">📅</span> Weekday Performance</span>
                  <span className="analytics-card-head-muted">— {scopeMetricLabel} scope</span>
                </div>
                <table className="stats-table analytics-dash-stats-table">
                  <thead>
                    <tr><th>Day</th><th>Trades</th><th>Win %</th><th>P&L</th></tr>
                  </thead>
                  <tbody>
                    {analyticsDashWeekdayRows.map((w) => {
                      const wr = w.trades > 0 ? (w.wins / w.trades) * 100 : 0;
                      return (
                        <tr key={`wd-${w.name}`}>
                          <td style={{ fontWeight: 600 }}>{w.name}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{w.trades}</span>
                              {w.trades > 0 && (
                                <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', maxWidth: 60 }}>
                                  <div
                                    style={{
                                      height: '100%',
                                      width: `${(w.trades / maxAnalyticsDashWeekdayTrades) * 100}%`,
                                      background: 'var(--accent)',
                                      borderRadius: 2
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className={wr >= 50 ? 'pos' : wr > 0 ? 'warn' : ''}>{wr.toFixed(1)}%</td>
                          <td className={w.pnl >= 0 ? 'pos' : 'neg'}>{w.pnl >= 0 ? '+' : ''}{Number(w.pnl || 0).toFixed(2)}$</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="analytics-card analytics-card-pair-split">
                <div className="analytics-card-head analytics-card-head-inline title-with-emoji"><span aria-hidden="true">💱</span> Pair Performance</div>
                <table className="stats-table analytics-dash-stats-table">
                  <thead>
                    <tr><th>Pair</th><th>Volume</th><th>B/S</th><th>WR%</th><th>P&L</th></tr>
                  </thead>
                  <tbody>
                    {analyticsDashPairRows.length === 0 && (
                      <tr><td colSpan={5} style={{ color: 'var(--text3)', textAlign: 'center' }}>No trades in this scope</td></tr>
                    )}
                    {analyticsDashPairRows.map((p) => {
                      const wr = p.trades > 0 ? (p.wins / p.trades) * 100 : 0;
                      const barWidth = (p.trades / maxAnalyticsDashPairTrades) * 100;
                      return (
                        <tr key={`pair-${p.symbol}`}>
                          <td style={{ fontWeight: 700, fontSize: 11 }}>{p.symbol}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 10 }}>{p.trades}</span>
                              <div style={{ height: 3, width: 50, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${barWidth}%`,
                                    background: p.pnl >= 0 ? 'var(--success)' : 'var(--danger)',
                                    borderRadius: 2
                                  }}
                                />
                              </div>
                            </div>
                          </td>
                          <td style={{ fontSize: 10 }}>
                            <span style={{ color: 'var(--success)' }}>{p.buy}B</span>
                            <span style={{ color: 'var(--text3)' }}>/</span>
                            <span style={{ color: 'var(--danger)' }}>{p.sell}S</span>
                          </td>
                          <td className={wr >= 50 ? 'pos' : 'warn'}>{wr.toFixed(0)}%</td>
                          <td className={p.pnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{p.pnl >= 0 ? '+' : ''}{Number(p.pnl || 0).toFixed(2)}$</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      case 'main':
        return (
          <div className="analytics-main-grid">
            <div className="analytics-card">
              <div className="analytics-card-head">Session Performance</div>
              <div className="analytics-session-table">
                {sessionRows.map((row) => (
                  <div key={row.name} className="analytics-session-row">
                    <span>{row.name}</span>
                    <span>{row.trades} trades</span>
                    <span className={row.pnl >= 0 ? 'pos' : 'neg'}>{formatMoney(row.pnl)}</span>
                    <span>{row.winRate.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="analytics-card analytics-card-weekday-session">
              <div className="analytics-card-head analytics-card-head-inline">
                <span>Weekday × Session</span>
                <span className="analytics-card-head-muted">— UTC sessions, DST-aware NY open</span>
              </div>
              <div
                className="weekday-session-matrix"
                style={{ display: 'grid', gridTemplateColumns: `44px repeat(${SESSION_MATRIX_COLS.length}, 1fr)`, gap: 4 }}
              >
                <div />
                {SESSION_MATRIX_COLS.map((col) => (
                  <div key={`wsm-h-${col.key}`} style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', fontWeight: 600 }}>
                    {col.label}
                  </div>
                ))}
                {SESSION_MATRIX_WEEKDAYS.map((wd) => (
                  <React.Fragment key={`wsm-r-${wd}`}>
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, alignSelf: 'center' }}>{wd}</div>
                    {SESSION_MATRIX_COLS.map((col) => {
                      const cell = weekdaySessionMatrix.cells.get(`${wd}|${col.key}`);
                      const pnl = Number(cell?.pnl || 0);
                      const cTrades = Number(cell?.trades || 0);
                      const winRate = Number(cell?.winRate || 0);
                      const hasData = cTrades > 0;
                      const intensity = hasData ? Math.min(Math.abs(pnl) / weekdaySessionMatrix.maxAbs, 1) : 0;
                      const isPos = pnl >= 0;
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
                      const tooltip = hasData
                        ? `${wd} · ${col.label} — ${cTrades} trade${cTrades !== 1 ? 's' : ''} | ${formatMoney(pnl)} | WR ${winRate.toFixed(1)}%`
                        : `${wd} · ${col.label} — no trades`;
                      return (
                        <div
                          key={`wsm-${wd}-${col.key}`}
                          title={tooltip}
                          style={{
                            background: bg,
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            padding: '4px 2px',
                            textAlign: 'center',
                            minWidth: 0,
                            transition: 'all 0.2s'
                          }}
                        >
                          {hasData ? (
                            <>
                              <div style={{ fontSize: 10, fontWeight: 700, color: isPos ? 'var(--success)' : 'var(--danger)' }}>
                                {formatMoney(pnl)}
                              </div>
                              <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 1 }}>
                                {cTrades}t · {winRate.toFixed(0)}%
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: 9, color: 'var(--text3)' }}>—</div>
                          )}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
              <div className="killzone-chips-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {killzoneRows.map((kz) => {
                  const hasData = Number(kz.trades || 0) > 0;
                  const isPos = Number(kz.pnl || 0) >= 0;
                  return (
                    <span
                      key={`kz-${kz.key}`}
                      title={`${kz.label} — ${kz.hint}${hasData ? ` | WR ${Number(kz.winRate || 0).toFixed(1)}%` : ''}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 10,
                        border: `1px solid ${!hasData ? 'rgba(36,53,84,0.4)' : isPos ? 'rgba(36, 208, 132, 0.45)' : 'rgba(255, 92, 117, 0.45)'}`,
                        background: !hasData
                          ? 'color-mix(in srgb, var(--surface2) 80%, transparent)'
                          : isPos
                            ? 'rgba(36, 208, 132, 0.12)'
                            : 'rgba(255, 92, 117, 0.12)',
                        color: 'var(--text2)'
                      }}
                    >
                      <strong style={{ fontWeight: 600 }}>{kz.label}</strong>
                      <span style={{ color: !hasData ? 'var(--text3)' : isPos ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                        {hasData ? formatMoney(kz.pnl) : '—'}
                      </span>
                      <span style={{ color: 'var(--text3)' }}>{Number(kz.trades || 0)}t</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="analytics-card">
              <div className="analytics-card-head">Trade Outcomes</div>
              <div className="analytics-outcomes">
                <div className="analytics-outcome-item"><span>TP</span><strong className="pos">{Number(totals?.tpHits ?? totals?.wins ?? 0)}</strong></div>
                <div className="analytics-outcome-item"><span>SL</span><strong className="neg">{Number(totals?.slHits ?? totals?.losses ?? 0)}</strong></div>
                <div className="analytics-outcome-item"><span>BE</span><strong>{Number(totals?.breakevens || 0)}</strong></div>
                <div className="analytics-outcome-item"><span>EOD</span><strong>{Number(totals?.eodCloses || 0)}</strong></div>
                <div className="analytics-outcome-item"><span>Other</span><strong>{Number(totals?.otherCloses || 0)}</strong></div>
                <div className="analytics-outcome-item"><span>Win Rate (TP/SL)</span><strong>{Number(totals?.winRate || 0).toFixed(1)}%</strong></div>
              </div>
            </div>

            <div className="analytics-card">
              <div className="analytics-card-head">Top Insights</div>
              {insights.length === 0 && <div className="analytics-muted">Not enough data yet for deeper insights.</div>}
              {insights.map((item) => <div key={item} className="analytics-alert ok">{item}</div>)}
            </div>

            <div className="analytics-card">
              <div className="analytics-card-head">Risk Alerts</div>
              {loading && <div className="analytics-muted">Loading risk checks...</div>}
              {!loading && alerts.length === 0 && (
                <div className="analytics-alert ok">No critical warnings. System profile is stable.</div>
              )}
              {!loading && alerts.map((message, idx) => (
                <div key={`${message}-${idx}`} className="analytics-alert warn">{message}</div>
              ))}
            </div>

            <AdvancedAnalyticsPanel routeVisible={routeVisible} />

          </div>
        );
      case 'breakdown':
        return (
          <div className="analytics-breakdown-grid">
            <div className="analytics-card">
              <div className="analytics-card-head">By Channel</div>
              {(breakdowns?.byChannel || []).slice(0, 6).map((row) => (
                <div key={`ch-${row.key}`} className="analytics-break-row">
                  <span>{row.key}</span>
                  <span>{row.trades}t</span>
                  <strong className={row.pnl >= 0 ? 'pos' : 'neg'}>{formatMoney(row.pnl)}</strong>
                </div>
              ))}
            </div>
            <div className="analytics-card">
              <div className="analytics-card-head">Close Reasons</div>
              {(breakdowns?.byCloseReason || []).slice(0, 8).map((row) => (
                <div key={`reason-${row.key}`} className="analytics-break-row">
                  <span>{row.key}</span>
                  <span>{row.trades}t</span>
                  <strong className={row.pnl >= 0 ? 'pos' : 'neg'}>{formatMoney(row.pnl)}</strong>
                </div>
              ))}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="dashboard-shell analytics-dashboard" data-testid="page-dashboard">
      <div className="titlebar" data-onboarding="page-header">
        <div className="brand">
          <img src="brand-mark.svg" className="app-logo-mark" alt="Trade Station" />
          <span className="brand-icon"><Bolt size={16} /></span>
          <span className="brand-name">Trade Station</span>
          <span className="subtitle">Portfolio Intelligence Dashboard</span>
        </div>
        <div className="titlebar-actions dashboard-top-actions">
          <div ref={notifWrapRef} className={`notif-top-wrap ${notificationOpen ? 'open' : ''}`}>
            <button
              className="btn btn-outline btn-titlebar btn-titlebar-compact notif-top-btn"
              onClick={() => setNotificationOpen((v) => !v)}
              title="Notifications"
            >
              <Bell size={14} />
              <span>Notifications</span>
              {unreadNotifications > 0 && (
                <span className="notif-top-badge">{Math.min(unreadNotifications, 99)}</span>
              )}
            </button>
            {notificationOpen && (
              <div className="notif-top-popover">
                <div className="notif-top-header">
                  <strong>Recent Notifications</strong>
                  <button className="btn btn-outline" onClick={markAllNotificationsRead}>Mark all read</button>
                </div>
                <div className="notif-top-list">
                  {notificationHistory.length === 0 && (
                    <div className="fund-empty-inline">No notifications yet.</div>
                  )}
                  {notificationHistory.slice(0, 20).map((item) => (
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
                  <button type="button" className="btn btn-outline" onClick={onOpenSettingsPage}>Open full history</button>
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

          {activeTab === 'overview' && (
            dashboardEditMode ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-titlebar btn-titlebar-compact"
                  onClick={() => setDashboardLayoutResetNonce((n) => n + 1)}
                  title="Restore default widget layout"
                >
                  <RotateCcw size={14} />
                  <span>Reset layout</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-titlebar btn-titlebar-compact"
                  onClick={exitDashboardEditMode}
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-titlebar btn-titlebar-compact"
                onClick={() => setDashboardEditMode(true)}
                title="Customize dashboard widgets"
              >
                <Settings2 size={14} />
                <span>Customize</span>
              </button>
            )
          )}

          <ScopeDateRangeToolbar
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            customRange={
              analyticsCustomRange && analyticsCustomRange.from && analyticsCustomRange.to
                ? analyticsCustomRange
                : { from: '', to: '' }
            }
            setCustomRange={setAnalyticsCustomRange}
            testIdPrefix="analytics"
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

      <div className="center-panel" data-onboarding="dashboard-workspace">
        <div className="analytics-tabs" style={{ marginBottom: 12 }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'live', label: 'Live', count: accountScopedTrades.filter((t) => tradeIsLive(t)).length },
            { id: 'closed', label: 'Closed', count: accountScopedTrades.filter((t) => isClosedTrade(t)).length }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`analytics-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleAnalyticsTabChange(tab.id)}
            >
              {tab.label}
              {tab.count != null && (
                <span className="analytics-tab-count">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="stats-bar animate-enter">
          <MetricPill label="Scope" value={scopeMetricLabel} tone="accent" />
          <MetricPill label="Trades" value={String(Number(analytics?.tradeCount || 0))} />
          <MetricPill label="Closed" value={String(Number(analytics?.closedCount || 0))} />
          <MetricPill label="Win Rate (TP/SL)" value={`${Number(totals?.winRate || 0).toFixed(1)}%`} tone={Number(totals?.winRate || 0) >= 50 ? 'success' : 'danger'} />
          <MetricPill label="Total P&L" value={formatMoney(totals?.totalPnl || 0)} tone={Number(totals?.totalPnl || 0) >= 0 ? 'success' : 'danger'} />
          <MetricPill label="Profit Factor" value={advanced?.profitFactor == null ? 'N/A' : Number(advanced?.profitFactor || 0).toFixed(2)} tone={Number(advanced?.profitFactor || 0) >= 1.3 ? 'success' : 'warning'} />
          <MetricPill
            label="Health Score"
            value={`${healthScore}/100`}
            tone={healthScore >= 70 ? 'success' : healthScore >= 45 ? 'warning' : 'danger'}
            title={'Composite of this scope: 45% TP/SL win rate + 45% profit factor (capped), minus a drawdown penalty.\n70+ healthy · 45-69 needs attention · below 45 weak.\nSmall samples swing hard — ignore it under ~10 closed trades.'}
          />
          <MetricPill
            label="Efficiency"
            value={excursionSummary?.avgEfficiencyPct == null ? 'N/A' : `${Number(excursionSummary.avgEfficiencyPct).toFixed(0)}%`}
            tone={excursionSummary?.avgEfficiencyPct == null ? 'neutral' : Number(excursionSummary.avgEfficiencyPct) >= 60 ? 'success' : 'warning'}
            title={'Average share of each trade\'s peak open profit (MFE) that was actually realized.\nNeeds excursion data — tracked live by the EA or backfilled from 1-min bars.'}
          />
          <MetricPill
            label="Left on table"
            value={excursionSummary?.totalLeftOnTable == null ? 'N/A' : `${Number(excursionSummary.totalLeftOnTable).toFixed(2)}$`}
            tone={Number(excursionSummary?.totalLeftOnTable || 0) > 0 ? 'warning' : 'neutral'}
            title={'Σ (peak open profit − realized) across winning trades with excursion data — money given back before the exit.'}
          />
        </div>

        <div className="analytics-filter-row" data-testid="analytics-filter-row">
          <input
            className="filter-input"
            data-testid="analytics-filter-symbol"
            placeholder="Focus symbol..."
            value={filterSymbol}
            onChange={(e) => setTradeFilters({ filterSymbol: e.target.value })}
          />
          <select className="filter-select" data-testid="analytics-filter-type" value={filterType} onChange={(e) => setTradeFilters({ filterType: e.target.value })}>
            <option value="ALL">All Types</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <select className="filter-select" data-testid="analytics-filter-status" value={filterStatus} onChange={(e) => setTradeFilters({ filterStatus: e.target.value })}>
            <option value="ALL">All Status</option>
            <option value="LIVE">Live</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="CLOSED">Closed</option>
            <option value="TP">TP</option>
            <option value="SL">SL</option>
            <option value="BE">BE</option>
            <option value="EOD">EOD close</option>
            <option value="BLOCKED">Blocked / filtered</option>
          </select>
          <select className="filter-select" data-testid="analytics-filter-channel" value={filterChannel} onChange={(e) => setTradeFilters({ filterChannel: e.target.value })}>
            <option value="ALL">All Channels</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            className="btn-reset-filters"
            data-testid="analytics-reset-filters"
            onClick={resetTradeFilters}
            disabled={filtersAreDefault}
            title="Reset all filters including slice filters (shared with Trades)"
          >
            Reset all
          </button>
          <span className="filter-slice-label" style={{ marginLeft: 8 }}>Slice</span>
          {dimOn('timeframe') && (
            <MultiPickFilter testId="analytics-slice-tf" label="TF" options={sliceOptions.tfs} selected={sliceTimeframes} onChange={(v) => setTradeFilters({ sliceTimeframes: v })} />
          )}
          {dimOn('symbol') && (
            <MultiPickFilter testId="analytics-slice-pair" label="Pair" options={sliceOptions.pairs} selected={slicePairs} onChange={(v) => setTradeFilters({ slicePairs: v })} />
          )}
          {dimOn('bias') && (
            <MultiPickFilter testId="analytics-slice-bias" label="Bias" options={sliceOptions.biases} selected={sliceBiases} onChange={(v) => setTradeFilters({ sliceBiases: v })} />
          )}
          {dimOn('setup') && (
            <MultiPickFilter
              testId="analytics-slice-setup"
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
              testId="analytics-slice-vwap"
              label="VWAP"
              options={sliceOptions.vwapBands}
              selected={sliceVwapBands}
              onChange={(v) => setTradeFilters({ sliceVwapBands: v })}
              formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
            />
          )}
          {dimOn('hvn') && (
            <MultiPickFilter
              testId="analytics-slice-hvn"
              label="HVN"
              options={sliceOptions.hvnBands}
              selected={sliceHvnBands}
              onChange={(v) => setTradeFilters({ sliceHvnBands: v })}
              formatOption={(v) => (v === 'yes' ? 'YES' : v === 'no' ? 'NO' : 'n/a')}
            />
          )}
          <MultiPickFilter
            testId="analytics-slice-session"
            label="Session"
            options={sliceOptions.sessions}
            selected={sliceSessions}
            onChange={(v) => setTradeFilters({ sliceSessions: v })}
            formatOption={(s) => (s === 'asian' ? 'Asian' : s === 'london' ? 'London' : s === 'newYork' ? 'NY' : s)}
          />
          <MultiPickFilter
            testId="analytics-slice-weekday"
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
            testId="analytics-slice-tags"
            label="Tags"
            options={sliceOptions.tags}
            selected={sliceTags}
            onChange={(v) => setTradeFilters({ sliceTags: v })}
            emptyHint="Journal tags"
          />
          <button
            type="button"
            className="btn-reset-filters"
            data-testid="analytics-reset-all-slice"
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
            filterSummary={dashboardFilterSummary}
            testIdPrefix="dashboard-filter-templates"
          />
          <span className="filter-count">Last update: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : 'N/A'}</span>
        </div>

        {activeTab === 'overview' && (
          <>
            <DashboardGrid
              sharedCtx={dashboardSharedCtx}
              editMode={dashboardEditMode}
              onEditModeChange={setDashboardEditMode}
              showToolbar={false}
              resetNonce={dashboardLayoutResetNonce}
            />
            {fixedOverviewSections.map((wid) => (
              <React.Fragment key={`fixed-${wid}`}>{renderOverviewWidget(wid)}</React.Fragment>
            ))}
          </>
        )}

        {(activeTab === 'live' || activeTab === 'closed') && (
          <>
            <div className="filter-bar">
              <span className="filter-count">{filteredTableTrades.length} / {analysisTrades.length} (filtered)</span>
              <button className="btn-refresh-trades" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <button className="btn-delete" onClick={handleDeleteSelected} disabled={visibleSelectedCount === 0}>
                Delete Selected
              </button>
              <button className="btn-clear" onClick={handleClear}>Clear</button>
            </div>

            <TradeTable
              trades={filteredTableTrades}
              selectedIds={selectedIds}
              customTradeColumns={Array.isArray(settings?.customTradeColumns) ? settings.customTradeColumns : []}
              tradeBuiltinColumns={Array.isArray(settings?.tradeBuiltinColumns) ? settings.tradeBuiltinColumns : []}
              breakEvenAmount={Math.max(0, Number(settings?.analyticsBreakEvenAmount ?? 50) || 50)}
              onToggleSelect={handleToggleSelect}
              onOpenScreenshots={(trade) => {
                setShotsTrade(trade);
                setActiveShotIdx(0);
              }}
              onOpenTradeDetail={(trade) => setDetailTrade(trade)}
            />
          </>
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

      {detailTrade && (
        <TradeDetailModal
          trade={detailTradeLive || detailTrade}
          tagPresets={Array.isArray(settings?.tradePresets) ? settings.tradePresets : []}
          saving={savingJournal}
          onClose={() => setDetailTrade(null)}
          onSave={async ({ patch, journalPatch, applyToMt5 }) => {
            setSavingJournal(true);
            try {
              const result = await window.electronAPI?.updateTrade?.(
                (detailTradeLive || detailTrade).id,
                { patch, journalPatch, applyToMt5 }
              );
              if (result?.success && result.trade) {
                setTrades((prev) => prev.map((t) => (
                  String(t.id) === String(result.trade.id) ? result.trade : t
                )));
                setDetailTrade(result.trade);
              }
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
    </div>
  );
}
