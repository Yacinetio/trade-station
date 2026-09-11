import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { tradeSelectionKey } from '../utils/tradeSelectionKey.js';
import { canonicalTradeVwapBand, canonicalTradeHvnBand } from '../utils/tradeSliceFilters.js';
import { formatBlockReasonTooltip } from '../utils/blockReasonHelp.js';
import { formatTradeNewsContextLabel, tradeHasNewsContext } from '../utils/tradeNewsContext.js';
import {
  buildTradeColumnDefs,
  getDefaultVisibleColumnIds,
  normalizeStoredVisibleColumns
} from '../utils/tradeColumnDefs.js';

const VIRTUAL_ROW_THRESHOLD = 80;
const ESTIMATED_ROW_HEIGHT = 34;

function tradeSetupColumnSortKey(trade) {
  const pts = Array.isArray(trade?.presetTags) ? trade.presetTags.filter((x) => String(x || '').trim()) : [];
  if (pts.length) return pts.map((x) => String(x).toLowerCase()).sort().join('|');
  return String(trade?.setup || '').trim().toLowerCase();
}

function tradeSetupColumnLabel(trade) {
  const pts = Array.isArray(trade?.presetTags) ? trade.presetTags.filter((x) => String(x || '').trim()) : [];
  if (pts.length) return pts.join(', ');
  const leg = String(trade?.setup || '').trim();
  return leg || '';
}

/** Journal tags only — setup presets already have their own SETUP column. */
function tradeJournalTags(trade) {
  const raw = Array.isArray(trade?.journal?.tags) ? trade.journal.tags : [];
  return raw.map((x) => String(x || '').trim()).filter(Boolean);
}

function typeBadge(type, orderType) {
  const t = String(type || '').trim();
  const o = String(orderType || '').trim();
  const isBuy = /^BUY(\b|_|\s)/i.test(t) || t.toUpperCase() === 'BUY';
  const oUp = o.toUpperCase();
  const tUp = t.toUpperCase();
  let sub = '';
  if (o && oUp !== 'MARKET' && oUp !== tUp) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rest = o.replace(new RegExp(`^${escaped}\\s*`, 'i'), '').trim();
    if (rest && rest.toUpperCase() !== tUp) sub = rest;
  }
  return (
    <span className="type-badge-wrap">
      <span className={`badge ${isBuy ? 'badge-buy' : 'badge-sell'}`}>{t || '—'}</span>
      {sub ? <span className="type-order-sub">{sub}</span> : null}
    </span>
  );
}

function CommentCell({ trade, cellStyle }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(trade.comment || '');

  useEffect(() => {
    setValue(trade.comment || '');
  }, [trade.comment]);

  const handleSave = async () => {
    await window.electronAPI?.updateTradeComment?.(trade.id, value);
    setEditing(false);
  };

  if (editing) {
    return (
      <td style={cellStyle}>
        <input
          className="comment-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
          placeholder="Add note..."
        />
      </td>
    );
  }
  return (
    <td
      className="td-comment"
      style={cellStyle}
      onClick={() => setEditing(true)}
      title={trade.comment || 'Click to add note'}
    >
      {trade.comment || <span className="comment-placeholder">+</span>}
    </td>
  );
}

function statusBadge(status, trade = null) {
  const s = (status || '').toUpperCase();
  if (s === 'BLOCKED_OPPOSITE_SYMBOL')
    return <span className="badge badge-blocked" title="Opposite direction blocked while same instrument is open">OPP LOCK</span>;
  if (s === 'BLOCKED_CORRELATED_PAIR')
    return <span className="badge badge-blocked" title="Opposing signals on correlated symbols while one leg is open">CORR LOCK</span>;
  if (s === 'CLOSED_TP' || s === 'TP_HIT')
    return <span className="badge badge-tp-hit">TP HIT</span>;
  if (s === 'CLOSED_SL' || s === 'SL_HIT')
    return <span className="badge badge-sl-hit">SL HIT</span>;
  if (s === 'CLOSED_EOD')
    return (
      <span className="badge badge-eod-close" title="Closed by end-of-day rule (EA market close at scheduled server time)">
        EOD close
      </span>
    );
  if (s.includes('CLOSED'))
    return <span className="badge badge-closed" title="Manual/other close — not counted in TP/SL win rate">CLOSED</span>;
  if (s === 'PENDING') return <span className="badge badge-pending">PENDING</span>;
  if (s === 'DISPATCHED' || s === 'NO_MT5_QUEUED') {
    return (
      <span className="badge badge-dispatched" title={s === 'NO_MT5_QUEUED' ? 'Queued — MT5 offline' : 'Sent to EA — awaiting broker fill'}>
        {s === 'NO_MT5_QUEUED' ? 'QUEUED' : 'SENDING'}
      </span>
    );
  }
  if (s === 'SENT')    return <span className="badge badge-sent">SENT</span>;
  if (s.startsWith('FAILED')) {
    return <span className="badge badge-error" title={trade?.blockedReason || status}>FAILED</span>;
  }
  if (s === 'BLOCKED_SCHEDULE') return <span className="badge badge-blocked-schedule">SCHEDULE</span>;
  if (s === 'BLOCKED_HIGH_NEWS') return <span className="badge badge-blocked-news">NEWS</span>;
  if (s === 'BLOCKED_SIGNAL_FILTERS')
    return <span className="badge badge-blocked" title="Matched Settings → Filters block profile">FILTERS</span>;
  if (s === 'BLOCKED_INVALID_SL')
    return <span className="badge badge-blocked" title="Stop loss missing or on wrong side of entry">NO SL</span>;
  if (s.includes('BLOCKED')) return <span className="badge badge-blocked">BLOCKED</span>;
  if (s === 'SYMBOL_NOT_FOUND') return <span className="badge badge-error">SYM?</span>;
  return <span className="badge badge-status">{status}</span>;
}

function toNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.+-]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Mirrors main/excursionMetrics computeEfficiencyPct: realized ÷ MFE money, clamped 0–150. */
function excursionEfficiencyPct(trade) {
  const profit = toNumeric(trade?.profit);
  const mfeMoney = toNumeric(trade?.excursion?.mfeMoney);
  if (profit == null || mfeMoney == null || mfeMoney <= 0) return null;
  return Math.max(0, Math.min(150, (profit / mfeMoney) * 100));
}

/** Max `maxDecimals` places; strip trailing zeros (e.g. 1.23000 → 1.23). */
function formatTradePx(value, maxDecimals = 5) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  let s = n.toFixed(maxDecimals);
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

/** Local wall time like MT5 history: yyyy.mm.dd HH:MM:SS */
function formatMqlStyleDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}:${ss}`;
}

function getOpenedAtIso(t) {
  if (!t) return '';
  for (const raw of [t.openedAt, t.executedAt]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return raw;
  }
  return '';
}

function getClosedAtIso(t) {
  if (!t) return '';
  const raw = t.closedAt;
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : raw;
}

function isTradeClosedTimeline(t) {
  const s = String(t?.status || '').toUpperCase();
  return s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!t?.closeTime || !!t?.closedAt;
}

function openedAtSortMs(t) {
  const iso = getOpenedAtIso(t);
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function closedAtSortMs(t) {
  if (!isTradeClosedTimeline(t)) return 0;
  const iso = getClosedAtIso(t);
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function timeInOutTooltip(t) {
  const o = formatMqlStyleDateTime(getOpenedAtIso(t));
  const c = formatMqlStyleDateTime(getClosedAtIso(t));
  const lines = [];
  if (o) lines.push(`Open (entry): ${o}`);
  if (isTradeClosedTimeline(t)) {
    lines.push(c ? `Close (exit): ${c}` : 'Close (exit): —');
  } else {
    lines.push('Close (exit): — (still open)');
  }
  lines.push('Aligned with MT5 History open/close times when the bridge sends full timestamps.');
  return lines.join('\n');
}

function statusBadgeWithBreakEven(trade, breakEvenAmount = 50) {
  const s = String(trade?.status || '').toUpperCase();
  if (s === 'CLOSED_EOD') return statusBadge(s, trade);
  if (s === 'CLOSED_SL_PROFIT') {
    const p = toNumeric(trade?.profit);
    const threshold = Math.max(0, Number(breakEvenAmount) || 0);
    if (p != null && Math.abs(p) <= threshold) {
      return <span className="badge badge-be">BE</span>;
    }
    return statusBadge(s, trade);
  }
  if (s === 'CLOSED_TP' || s === 'TP_HIT') return statusBadge(s, trade);
  if (s === 'CLOSED_SL' || s === 'SL_HIT') {
    const p = toNumeric(trade?.profit);
    const threshold = Math.max(0, Number(breakEvenAmount) || 0);
    if (p != null && Math.abs(p) <= threshold) {
      return <span className="badge badge-be">BE</span>;
    }
    return statusBadge(s, trade);
  }
  const isClosed = s.includes('CLOSED') || s.includes('SL_HIT') || s.includes('TP_HIT') || !!trade?.closeTime || !!trade?.closedAt;
  if (isClosed) {
    const p = toNumeric(trade?.profit);
    const threshold = Math.max(0, Number(breakEvenAmount) || 0);
    if (p != null && Math.abs(p) <= threshold) {
      return <span className="badge badge-be">BE</span>;
    }
  }
  return statusBadge(s, trade);
}

function calcRR(entry, sl, tp) {
  if (!entry || !sl || !tp) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0) return null;
  return reward / risk;
}

/** Short table tag; full `blockedReason` stays on `title` tooltip */
function getBlockReasonTag(trade) {
  const s = String(trade?.status || '').toUpperCase();
  if (s.startsWith('FAILED')) return 'MT5';
  if (s === 'DISPATCHED' || s === 'NO_MT5_QUEUED') return '';
  if (s === 'BLOCKED_SCHEDULE') return 'TIME';
  if (s === 'BLOCKED_HIGH_NEWS') return 'NEWS';
  if (s === 'BLOCKED_SIGNAL_FILTERS') return 'FILT';
  if (s === 'BLOCKED_OPPOSITE_SYMBOL') return 'OPP';
  if (s === 'BLOCKED_CORRELATED_PAIR') return 'CORR';
  if (s === 'BLOCKED_MIN_PIPS') return 'EXEC';
  if (s === 'BLOCKED_INVALID_SL') return 'SL';
  if (s === 'BLOCKED_DAILY_TRADES') return 'LMT';
  if (s === 'BLOCKED_CONCURRENT') return 'LMT';
  if (s === 'BLOCKED_DAILY_LOSS' || s === 'BLOCKED_DAILY_LOSS_PCT') return 'RISK';
  if (!s.includes('BLOCKED') && !String(trade?.blockedReason || '').trim()) return '';
  const r = String(trade?.blockedReason || '');
  if (/outside allowed time|time window|schedule|trading hours|local\s+\d/i.test(r)) return 'TIME';
  if (/news|guard|high.impact|release|NFP|CPI|FOMC/i.test(r)) return 'NEWS';
  if (/pip|spread|min.*distance|distance|symbol|not found/i.test(r)) return 'EXEC';
  if (/concurrent|max.*order|max.*trade|open.*position|slot/i.test(r)) return 'LMT';
  if (/daily|loss|drawdown|pct|equity|limit/i.test(r)) return 'RISK';
  if (/blocked.*guard|opp(osite)?|correlat/i.test(r)) return 'GUARD';
  if (r.trim()) return 'BLOCK';
  if (s.includes('BLOCKED')) return 'BLOCK';
  return '';
}

const STORAGE_KEY = 'tradesync-visible-columns-v8';
const LEGACY_VISIBLE_COLUMNS_KEYS = [
  'tradesync-visible-columns-v7',
  'tradesync-visible-columns-v6',
  'tradesync-visible-columns-v5',
  'tradesync-visible-columns-v4',
  'tradesync-visible-columns-v3',
  'tradesync-visible-columns-v2',
  'tradesync-visible-columns-v1'
];
function loadVisibleColumns(columnDefs) {
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    let fromLegacy = false;
    if (!raw) {
      for (const legacyKey of LEGACY_VISIBLE_COLUMNS_KEYS) {
        raw = window.localStorage.getItem(legacyKey);
        if (raw) { fromLegacy = true; break; }
      }
    }
    if (!raw) return getDefaultVisibleColumnIds(columnDefs);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return getDefaultVisibleColumnIds(columnDefs);
    const cols = normalizeStoredVisibleColumns(parsed, columnDefs);
    if (fromLegacy) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
    return cols;
  } catch {
    return getDefaultVisibleColumnIds(columnDefs);
  }
}

export default function TradeTable({
  trades,
  selectedIds,
  breakEvenAmount = 50,
  onToggleSelect,
  onOpenScreenshots,
  /** Opens Trade Detail modal (journal + OHLC replay). Optional. */
  onOpenTradeDetail = null,
  emptyStateText,
  /** Max rows per page; header "select all" applies to the current page only. */
  pageSize = 15,
  /** User-defined columns from Settings → Columns */
  customTradeColumns = [],
  /** Built-in column overrides (enable / label / width) from Settings → Columns */
  tradeBuiltinColumns = []
}) {
  const parentRef = useRef(null);
  const [sorting, setSorting] = useState([]);
  const [page, setPage] = useState(1);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnDefs = useMemo(
    () => buildTradeColumnDefs(customTradeColumns, tradeBuiltinColumns),
    [customTradeColumns, tradeBuiltinColumns]
  );
  const customColumnIds = useMemo(
    () => new Set(columnDefs.filter((c) => !c.builtin).map((c) => c.id)),
    [columnDefs]
  );
  const [visibleColumns, setVisibleColumns] = useState(() => loadVisibleColumns(buildTradeColumnDefs(customTradeColumns, tradeBuiltinColumns)));

  useEffect(() => {
    setVisibleColumns((prev) => normalizeStoredVisibleColumns(prev, columnDefs));
  }, [columnDefs]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const columns = useMemo(() => {
    const builtins = [
    { id: 'timeIn', accessorFn: (r) => openedAtSortMs(r) },
    { id: 'timeOut', accessorFn: (r) => closedAtSortMs(r) },
    { id: 'account', accessorFn: (r) => r.accountKey || 'unknown' },
    { id: 'channel', accessorFn: (r) => r.channel || '' },
    { id: 'symbol', accessorFn: (r) => r.symbol || '' },
    { id: 'timeframe', accessorFn: (r) => String(r.timeframe || '').toUpperCase() },
    { id: 'bias', accessorFn: (r) => String(r.bias || '').toLowerCase() },
    { id: 'setup', accessorFn: (r) => tradeSetupColumnSortKey(r) },
    { id: 'tags', accessorFn: (r) => tradeJournalTags(r).map((x) => x.toLowerCase()).sort().join('|') },
    { id: 'vwapBand', accessorFn: (r) => {
      const v = canonicalTradeVwapBand(r);
      if (v === 'yes') return 2;
      if (v === 'no') return 1;
      if (v === 'na') return 0;
      return -1;
    }},
    { id: 'hvnBand', accessorFn: (r) => {
      const v = canonicalTradeHvnBand(r);
      if (v === 'yes') return 2;
      if (v === 'no') return 1;
      if (v === 'na') return 0;
      return -1;
    }},
    { id: 'trendAlign', accessorFn: (r) => String(r.trendAlign || '').toLowerCase() },
    { id: 'obSize', accessorFn: (r) => String(r.obSize || '').toLowerCase() },
    { id: 'type', accessorFn: (r) => r.type || '' },
    {
      id: 'sigEntry',
      accessorFn: (r) => {
        const se = r.signalEntry != null && Number(r.signalEntry) > 0 ? Number(r.signalEntry) : 0;
        return se;
      }
    },
    { id: 'entry', accessorFn: (r) => Number(r.entry || 0) },
    { id: 'avgEntry', accessorFn: (r) => Number(r.avgEntry || 0) },
    { id: 'sl', accessorFn: (r) => Number(r.sl || 0) },
    { id: 'tp', accessorFn: (r) => Number(r.tp || 0) },
    { id: 'lot', accessorFn: (r) => Number(r.lot || 0) },
    { id: 'rr', accessorFn: (r) => calcRR(r.entry, r.sl, r.tp) ?? -9999 },
    { id: 'profit', accessorFn: (r) => toNumeric(r.profit) ?? 0 },
    { id: 'status', accessorFn: (r) => String(r.status || '') },
    { id: 'blockReason', accessorFn: (r) => String(r.blockedReason || '') },
    { id: 'shots', accessorFn: (r) => (Array.isArray(r.screenshots) ? r.screenshots.length : 0) },
    { id: 'replay', accessorFn: () => 0 },
    { id: 'rating', accessorFn: (r) => String(r?.journal?.rating || 'Z') },
    { id: 'mfe', accessorFn: (r) => toNumeric(r?.excursion?.mfePips) ?? -1 },
    { id: 'mae', accessorFn: (r) => toNumeric(r?.excursion?.maePips) ?? -1 },
    { id: 'efficiency', accessorFn: (r) => excursionEfficiencyPct(r) ?? -1 },
    ];
    const custom = columnDefs
      .filter((c) => !c.builtin)
      .map((c) => ({
        id: c.id,
        accessorFn: (r) => String(r?.customFields?.[c.id] || '').toLowerCase()
      }));
    return [...builtins, ...custom];
  }, [columnDefs]);

  const table = useReactTable({
    data: trades,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 15));
  const totalPages = Math.max(1, Math.ceil(rows.length / ps));

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pageStart = (page - 1) * ps;
  const pageRows = rows.slice(pageStart, pageStart + ps);
  const keyboardNavEnabled = typeof onOpenTradeDetail === 'function';
  const [focusedRowIndex, setFocusedRowIndex] = useState(-1);

  useEffect(() => {
    setFocusedRowIndex(-1);
  }, [page, rows.length, sorting]);

  const sel = (tid) => tradeSelectionKey(tid);

  useEffect(() => {
    if (!keyboardNavEnabled || pageRows.length === 0) return undefined;
    const onKeyDown = (evt) => {
      const tag = String(evt.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || evt.target?.isContentEditable) return;
      if (evt.key === 'j' || evt.key === 'ArrowDown') {
        evt.preventDefault();
        setFocusedRowIndex((idx) => Math.min(pageRows.length - 1, idx < 0 ? 0 : idx + 1));
      } else if (evt.key === 'k' || evt.key === 'ArrowUp') {
        evt.preventDefault();
        setFocusedRowIndex((idx) => Math.max(0, idx <= 0 ? 0 : idx - 1));
      } else if (evt.key === 'Enter' && focusedRowIndex >= 0) {
        evt.preventDefault();
        onOpenTradeDetail?.(pageRows[focusedRowIndex]?.original);
      } else if (evt.key === ' ' && focusedRowIndex >= 0) {
        evt.preventDefault();
        const t = pageRows[focusedRowIndex]?.original;
        if (t) onToggleSelect?.(sel(t.id), !selectedIds?.has(sel(t.id)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardNavEnabled, pageRows, focusedRowIndex, onOpenTradeDetail, onToggleSelect, selectedIds]);

  const pageTrades = pageRows.map((r) => r.original);
  const allSelected = pageTrades.length > 0 && pageTrades.every((t) => selectedIds?.has(sel(t.id)));
  const someSelected = pageTrades.some((t) => selectedIds?.has(sel(t.id)));

  const handleSelectAll = () => {
    if (allSelected) pageTrades.forEach((t) => onToggleSelect(sel(t.id), false));
    else pageTrades.forEach((t) => onToggleSelect(sel(t.id), true));
  };

  useEffect(() => {
    if (parentRef.current) parentRef.current.scrollTop = 0;
  }, [sorting, page]);

  const sortableIds = new Set(columnDefs.filter((c) => c.sortable).map((c) => c.id));
  const renderedColumns = useMemo(
    () => columnDefs.filter((col) => visibleColumns.includes(col.id)),
    [columnDefs, visibleColumns]
  );
  const colWidths = useMemo(() => [36, ...renderedColumns.map((c) => c.width)], [renderedColumns]);

  const toggleColumn = (colId) => {
    setVisibleColumns((prev) => {
      if (prev.includes(colId)) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== colId);
      }
      return [...prev, colId];
    });
  };

  const renderCell = (colId, trade, rr, profit, width) => {
    const cellStyle = { width };
    if (colId === 'timeIn') {
      const raw = getOpenedAtIso(trade);
      const label = raw ? formatMqlStyleDateTime(raw) : (String(trade.time || '').trim() || '—');
      return (
        <td className="td-time-mql" style={cellStyle} title={timeInOutTooltip(trade)}>{label}</td>
      );
    }
    if (colId === 'timeOut') {
      const raw = getClosedAtIso(trade);
      const label = isTradeClosedTimeline(trade)
        ? (raw ? formatMqlStyleDateTime(raw) : '—')
        : '—';
      return (
        <td className="td-time-mql" style={cellStyle} title={timeInOutTooltip(trade)}>{label}</td>
      );
    }
    if (colId === 'account') return <td className="td-channel" style={cellStyle}>{trade.accountKey || 'unknown'}</td>;
    if (colId === 'channel') return <td className="td-channel" style={cellStyle}>{trade.channel}</td>;
    if (colId === 'symbol') return <td className="td-symbol" style={cellStyle}>{trade.symbol}</td>;
    if (colId === 'timeframe') return <td className="td-tf" style={cellStyle}>{trade.timeframe ? String(trade.timeframe).toUpperCase() : '—'}</td>;
    if (colId === 'bias') {
      const b = String(trade.bias || '').trim();
      return (
        <td className="td-meta-clip" style={cellStyle} title={b || undefined}>
          {b || '—'}
        </td>
      );
    }
    if (colId === 'setup') {
      const s = tradeSetupColumnLabel(trade);
      return (
        <td className="td-meta-clip td-setup-tight" style={cellStyle} title={s || undefined}>
          {s || '—'}
        </td>
      );
    }
    if (colId === 'tags') {
      const tags = tradeJournalTags(trade);
      if (tags.length === 0) return <td className="td-tags muted" style={cellStyle}>—</td>;
      const shown = tags.slice(0, 3);
      return (
        <td className="td-tags" style={cellStyle} title={tags.join(', ')}>
          {shown.map((tag) => (
            <span key={tag} className="trade-tag-chip">{tag}</span>
          ))}
          {tags.length > shown.length ? <span className="trade-tag-chip trade-tag-chip-more">+{tags.length - shown.length}</span> : null}
        </td>
      );
    }
    if (colId === 'rating') {
      const rating = String(trade?.journal?.rating || '').toUpperCase();
      if (!rating) return <td className="td-tags muted" style={cellStyle}>—</td>;
      const color = rating <= 'B' ? 'var(--success)' : rating <= 'D' ? 'var(--warning, #e0a93e)' : 'var(--danger)';
      return (
        <td className="td-tags" style={cellStyle} title={`Execution grade: ${rating}`}>
          <span className="trade-tag-chip" style={{ fontWeight: 700, color }}>{rating}</span>
        </td>
      );
    }
    if (colId === 'vwapBand') {
      const v = canonicalTradeVwapBand(trade);
      if (v === 'yes') {
        return (
          <td className="td-vwap" style={cellStyle} title="From signal: OB intersects SD-1..SD+1 at hit (partial overlap OK)">
            <span className="badge badge-vwap-yes">YES</span>
          </td>
        );
      }
      if (v === 'no') {
        return (
          <td className="td-vwap" style={cellStyle} title="From signal: OB does not cross ±1σ corridor at hit">
            <span className="badge badge-vwap-no">NO</span>
          </td>
        );
      }
      if (v === 'na') {
        return (
          <td className="td-vwap" style={cellStyle} title="VWAP not in signal">
            <span className="badge badge-vwap-na">n/a</span>
          </td>
        );
      }
      return <td className="td-vwap muted" style={cellStyle} title="No VWAP line in signal">—</td>;
    }
    if (colId === 'hvnBand') {
      const v = canonicalTradeHvnBand(trade);
      if (v === 'yes') {
        return (
          <td className="td-vwap" style={cellStyle} title="From signal: OB zone overlaps VP HVN cluster">
            <span className="badge badge-vwap-yes">YES</span>
          </td>
        );
      }
      if (v === 'no') {
        return (
          <td className="td-vwap" style={cellStyle} title="From signal: OB zone does not overlap HVN cluster">
            <span className="badge badge-vwap-no">NO</span>
          </td>
        );
      }
      if (v === 'na') {
        return (
          <td className="td-vwap" style={cellStyle} title="HVN not classified (VP unavailable)">
            <span className="badge badge-vwap-na">n/a</span>
          </td>
        );
      }
      return <td className="td-vwap muted" style={cellStyle} title="No HVN line in signal">—</td>;
    }
    if (colId === 'trendAlign') {
      const t = String(trade.trendAlign || '').trim().toLowerCase();
      const label = t === 'with' ? 'WITH' : t === 'against' ? 'AGAINST' : t === 'neutral' ? 'NEUTRAL' : t === 'na' ? 'n/a' : '';
      const cls = t === 'with' ? 'badge-vwap-yes' : t === 'against' ? 'badge-vwap-no' : 'badge-vwap-na';
      return (
        <td className="td-vwap" style={cellStyle} title={label ? `Trade ${label.toLowerCase()} TF trend` : undefined}>
          {label ? <span className={`badge ${cls}`}>{label}</span> : '—'}
        </td>
      );
    }
    if (colId === 'obSize') {
      const s = String(trade.obSize || '').trim();
      return <td className="td-meta-clip" style={cellStyle} title={s || undefined}>{s || '—'}</td>;
    }
    if (colId === 'type') return <td style={cellStyle}>{typeBadge(trade.type, trade.orderType)}</td>;
    if (colId === 'sigEntry') {
      const se = trade.signalEntry != null && Number(trade.signalEntry) > 0 ? Number(trade.signalEntry) : null;
      const txt = se != null ? formatTradePx(se) : null;
      return (
        <td
          className="td-num td-sig-entry"
          style={cellStyle}
          title={se != null ? 'Telegram ENTRY line (before blend / avg / exec)' : undefined}
        >
          {txt ?? '—'}
        </td>
      );
    }
    if (colId === 'entry') {
      const e = Number(trade.entry);
      const txt = Number.isFinite(e) ? formatTradePx(e) : (trade.entry != null && trade.entry !== '' ? String(trade.entry) : null);
      return (
        <td
          className="td-num"
          style={cellStyle}
          title="Executed entry — used for lot size (→SL) and R:R TP"
        >
          {txt ?? '—'}
        </td>
      );
    }
    if (colId === 'avgEntry') {
      const ae = trade.avgEntry != null && Number(trade.avgEntry) > 0 ? Number(trade.avgEntry) : null;
      return <td className="td-num td-avg-entry" style={cellStyle}>{ae != null ? formatTradePx(ae) : '—'}</td>;
    }
    if (colId === 'sl') {
      const x = Number(trade.sl);
      const txt = Number.isFinite(x) ? formatTradePx(x) : (trade.sl != null && trade.sl !== '' ? String(trade.sl) : null);
      return <td className="td-num td-sl" style={cellStyle}>{txt ?? '—'}</td>;
    }
    if (colId === 'tp') {
      const x = Number(trade.tp);
      const txt = Number.isFinite(x) ? formatTradePx(x) : (trade.tp != null && trade.tp !== '' ? String(trade.tp) : null);
      return <td className="td-num td-tp" style={cellStyle}>{txt ?? '—'}</td>;
    }
    if (colId === 'lot') return <td className="td-num td-lot" style={cellStyle}>{trade.lot > 0 ? trade.lot.toFixed(2) : '—'}</td>;
    if (colId === 'rr') return <td className={`td-num td-rr ${rr != null ? (rr >= 1 ? 'pos' : 'warn') : 'muted'}`} style={cellStyle}>{rr != null ? `1:${rr.toFixed(1)}` : '—'}</td>;
    if (colId === 'profit') {
      const p = profit;
      const cls = p == null ? 'muted' : p >= 0 ? 'pos' : 'neg';
      return (
        <td className={`td-num td-profit ${cls}`} style={cellStyle}>
          {p != null ? `${p >= 0 ? '+' : ''}${p.toFixed(2)}$` : '—'}
        </td>
      );
    }
    if (colId === 'mfe') {
      const v = toNumeric(trade?.excursion?.mfePips);
      const m = toNumeric(trade?.excursion?.mfeMoney);
      return (
        <td className={`td-num ${v != null ? 'pos' : 'muted'}`} style={cellStyle} title={v != null ? `Max favorable excursion${m != null ? ` (${m.toFixed(2)}$)` : ''}` : 'No excursion data (EA-tracked or backfilled)'}>
          {v != null ? `+${v.toFixed(1)}p` : '—'}
        </td>
      );
    }
    if (colId === 'mae') {
      const v = toNumeric(trade?.excursion?.maePips);
      const m = toNumeric(trade?.excursion?.maeMoney);
      return (
        <td className={`td-num ${v != null ? 'neg' : 'muted'}`} style={cellStyle} title={v != null ? `Max adverse excursion${m != null ? ` (-${Math.abs(m).toFixed(2)}$)` : ''}` : 'No excursion data (EA-tracked or backfilled)'}>
          {v != null ? `-${v.toFixed(1)}p` : '—'}
        </td>
      );
    }
    if (colId === 'efficiency') {
      const v = excursionEfficiencyPct(trade);
      const cls = v == null ? 'muted' : v >= 60 ? 'pos' : v >= 30 ? 'warn' : 'neg';
      return (
        <td className={`td-num ${cls}`} style={cellStyle} title="Realized profit ÷ peak open profit (MFE)">
          {v != null ? `${v.toFixed(0)}%` : '—'}
        </td>
      );
    }
    if (colId === 'status') {
      const newsLabel = formatTradeNewsContextLabel(trade);
      const showNewsHint = tradeHasNewsContext(trade) && !String(trade?.status || '').toUpperCase().includes('BLOCKED_HIGH_NEWS');
      return (
        <td style={cellStyle} title={showNewsHint ? newsLabel : undefined}>
          {statusBadgeWithBreakEven(trade, breakEvenAmount)}
          {showNewsHint ? (
            <span className="trade-news-context-tag" title={newsLabel}>{newsLabel.length > 28 ? `${newsLabel.slice(0, 25)}…` : newsLabel}</span>
          ) : null}
        </td>
      );
    }
    if (colId === 'blockReason') {
      const text = String(trade.blockedReason || '').trim();
      const tag = getBlockReasonTag(trade);
      const tip = formatBlockReasonTooltip(trade) || (text ? `${tag ? `${tag}\n` : ''}${text}` : (tag || undefined));
      return (
        <td className="td-block-reason" style={cellStyle} title={tip || undefined}>
          {tag ? <span className="block-reason-tag">{tag}</span>
            : text ? <span className="td-block-reason-text">{text}</span> : '—'}
        </td>
      );
    }
    if (colId === 'comment') {
      return <CommentCell trade={trade} cellStyle={cellStyle} />;
    }
    if (colId === 'shots') {
      return (
        <td style={cellStyle}>
          <button
            type="button"
            className="btn-trade-shots"
            onClick={() => onOpenScreenshots?.(trade)}
            disabled={!Array.isArray(trade.screenshots) || trade.screenshots.length === 0}
            title="Open trade screenshots"
          >
            View
          </button>
        </td>
      );
    }
    if (colId === 'replay') {
      return (
        <td style={cellStyle}>
          <button
            type="button"
            className="btn-trade-replay"
            disabled={typeof onOpenTradeDetail !== 'function'}
            onClick={() => onOpenTradeDetail?.(trade)}
            title={typeof onOpenTradeDetail === 'function' ? 'Open trade detail / OHLC replay' : ''}
          >
            Chart
          </button>
        </td>
      );
    }
    if (customColumnIds.has(colId)) {
      const val = String(trade?.customFields?.[colId] || '').trim();
      return (
        <td className="td-meta-clip" style={cellStyle} title={val || undefined}>
          {val || '—'}
        </td>
      );
    }
    return <td style={cellStyle}>—</td>;
  };

  const sortIndicator = (id) => {
    const current = sorting.find((s) => s.id === id);
    if (!current) return '';
    return current.desc ? ' ▼' : ' ▲';
  };
  const onHeaderSort = (id) => {
    if (!sortableIds.has(id)) return;
    table.getColumn(id)?.toggleSorting();
  };

  return (
    <div className="trade-table-wrap" ref={parentRef} data-testid="trade-table">
      <div className="trade-table-toolbar">
        <div className="trade-table-toolbar-left">
          <span>
            {rows.length} trades
            {rows.length > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--text3)', fontWeight: 500 }}>
                · Page {page}/{totalPages}
              </span>
            )}
          </span>
          {typeof onOpenTradeDetail === 'function' ? (
            <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 500, color: 'var(--text3)' }}>
              j/k navigate · Enter detail · Space select · double‑click row
            </span>
          ) : null}
        </div>
        <div className="trade-table-toolbar-right">
          <button type="button" className="btn-column-toggle" onClick={() => setColumnMenuOpen((v) => !v)}>
            Columns ({visibleColumns.length})
          </button>
          {columnMenuOpen && (
            <div className="column-picker">
              {columnDefs.map((col) => (
                <label key={col.id} className="column-picker-item">
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(col.id)}
                    onChange={() => toggleColumn(col.id)}
                  />
                  <span>{col.label}{col.builtin === false ? ' ✦' : ''}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <table className="trade-table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="th-select">
              <input
                type="checkbox"
                className="trade-checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={handleSelectAll}
                title={`Select all trades on this page (${Math.min(ps, Math.max(0, rows.length - pageStart))} of ${rows.length})`}
              />
            </th>
            {renderedColumns.map((col) => {
              const sorted = sorting.find((s) => s.id === col.id);
              return (
                <th
                  key={col.id}
                  onClick={() => col.sortable && onHeaderSort(col.id)}
                  style={{ cursor: col.sortable ? 'pointer' : 'default' }}
                  title={col.sortable ? `Sort by ${col.label}` : undefined}
                  aria-sort={sorted ? (sorted.desc ? 'descending' : 'ascending') : (col.sortable ? 'none' : undefined)}
                >
                  {col.label}
                  {col.sortable
                    ? (sortIndicator(col.id) || <span className="th-sort-hint" aria-hidden="true"> ↕</span>)
                    : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <VirtualizedTbody
          rows={pageRows}
          parentRef={parentRef}
          renderedColumns={renderedColumns}
          renderCell={renderCell}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onOpenTradeDetail={onOpenTradeDetail}
          emptyStateText={emptyStateText}
          sel={sel}
          focusedRowIndex={focusedRowIndex}
        />
      </table>
      {rows.length > ps && (
        <div className="trade-table-pagination" role="navigation" aria-label="Trade table pages">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="trade-table-pagination-meta">
            Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            {' · '}
            Showing <strong>{pageStart + 1}</strong>–<strong>{Math.min(pageStart + ps, rows.length)}</strong>
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function VirtualizedTbody({
  rows,
  parentRef,
  renderedColumns,
  renderCell,
  selectedIds,
  onToggleSelect,
  onOpenTradeDetail,
  emptyStateText,
  sel,
  focusedRowIndex = -1
}) {
  const colCount = renderedColumns.length + 1;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 12,
    enabled: rows.length > VIRTUAL_ROW_THRESHOLD
  });

  if (rows.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={colCount} className="trade-empty-state">
            {emptyStateText || 'No trades yet. Enable channels to start copying signals.'}
          </td>
        </tr>
      </tbody>
    );
  }

  const renderRow = (row, rowIndex) => {
    const t = row.original;
    const rr = calcRR(t.entry, t.sl, t.tp);
    const profit = toNumeric(t.profit);
    const key = sel(t.id);
    const isSelected = selectedIds?.has(key);
    const isFocused = rowIndex === focusedRowIndex;
    return (
      <tr
        key={t.id}
        className={`${isSelected ? 'row-selected' : ''}${isFocused ? ' row-keyboard-focus' : ''}`}
        style={{
          ...(isSelected ? { background: 'rgba(0,229,255,0.04)' } : {}),
          ...(isFocused ? { outline: '1px solid var(--accent)', outlineOffset: -1 } : {})
        }}
        onDoubleClick={(e) => {
          if (typeof onOpenTradeDetail !== 'function') return;
          const el = e.target;
          if (el instanceof HTMLElement) {
            if (el.closest('input,button,a,textarea,select')) return;
          }
          onOpenTradeDetail(t);
        }}
      >
        <td className="td-select" style={{ width: 36 }}>
          <input
            type="checkbox"
            className="trade-checkbox"
            checked={!!isSelected}
            onChange={(e) => onToggleSelect(key, e.target.checked)}
          />
        </td>
        {renderedColumns.map((col) => (
          <React.Fragment key={col.id}>
            {renderCell(col.id, t, rr, profit, col.width)}
          </React.Fragment>
        ))}
      </tr>
    );
  };

  if (rows.length <= VIRTUAL_ROW_THRESHOLD) {
    return <tbody>{rows.map((row, i) => renderRow(row, i))}</tbody>;
  }

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom = items.length > 0 ? totalSize - items[items.length - 1].end : 0;

  return (
    <tbody>
      {paddingTop > 0 && (
        <tr aria-hidden="true" style={{ height: paddingTop }}>
          <td colSpan={colCount} style={{ padding: 0, border: 'none', background: 'transparent' }} />
        </tr>
      )}
      {items.map((virtualRow) => renderRow(rows[virtualRow.index], virtualRow.index))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true" style={{ height: paddingBottom }}>
          <td colSpan={colCount} style={{ padding: 0, border: 'none', background: 'transparent' }} />
        </tr>
      )}
    </tbody>
  );
}
