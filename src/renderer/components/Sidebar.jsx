import React, { useMemo } from 'react';
import {
  LayoutDashboard, Target, FlaskConical, Microscope, Bot, Calendar,
  RadioTower, Landmark, Plug, Send, Settings, Rocket,
  /* TradeZella-parity page icons (pre-imported so feature agents never edit this import) */
  Layers, BarChart3, NotebookPen, PlayCircle, Trophy, CandlestickChart
} from 'lucide-react';
import { ADVANCED_ONLY_PAGES } from '../hooks/useUiMode.js';

const NAV_ICON_SIZE = 17;

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'trades', label: 'Trades', Icon: Target },
  { id: 'filter-lab', label: 'Filter Lab', Icon: FlaskConical, advanced: true },
  { id: 'parser-lab', label: 'Parser Lab', Icon: Microscope, advanced: true },
  { id: 'ai', label: 'AI', Icon: Bot, advanced: true },
  { id: 'calendar', label: 'Calendar', Icon: Calendar },
  { id: 'channels', label: 'Channels', Icon: RadioTower, advanced: true },
  { id: 'fundamentals', label: 'Fundamentals', Icon: Landmark, advanced: true },
  { id: 'connections', label: 'Connections', Icon: Plug },
  { id: 'telegram', label: 'Telegram', Icon: Send },
  // ─── TradeZella-parity pages — agents: replace ONLY your own anchor line ───
  { id: 'strategies', label: 'Strategies', Icon: Layers },
  { id: 'reports', label: 'Reports', Icon: BarChart3 },
  { id: 'notebook', label: 'Notebook', Icon: NotebookPen },
  { id: 'replay', label: 'Replay', Icon: PlayCircle },
  { id: 'prop-firm', label: 'Prop Firm', Icon: Trophy },
  { id: 'backtest', label: 'Backtest', Icon: CandlestickChart, advanced: true },
  { id: 'settings', label: 'Settings', Icon: Settings },
];
void Layers; void BarChart3; void NotebookPen; void PlayCircle; void Trophy; void CandlestickChart;

export default function Sidebar({
  currentPage,
  onPageChange,
  isExpanded,
  onToggle,
  theme = 'studio',
  themes = [],
  onThemeChange,
  onOpenSetup,
  isAdvanced = false,
  setUiMode,
  instanceInfo = null,
}) {
  const visiblePages = useMemo(
    () => PAGES.filter((page) => isAdvanced || !ADVANCED_ONLY_PAGES.has(page.id)),
    [isAdvanced]
  );
  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`} data-onboarding="sidebar">
      <button
        type="button"
        className="sidebar-toggle"
        data-testid="sidebar-toggle"
        onClick={onToggle}
        title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {isExpanded ? '◀' : '▶'}
      </button>

      <div className="sidebar-content">
        <div className="sidebar-header" title={instanceInfo?.label ? `Trade Station — ${instanceInfo.label}` : 'Trade Station'}>
          <img src="brand-mark.svg" className="sidebar-logo-mark" alt="Trade Station" />
          {isExpanded && (
            <div className="sidebar-title-wrap">
              <span className="sidebar-title">Trade Station</span>
              {instanceInfo?.id ? (
                <span className="sidebar-instance-badge" title={`Instance: ${instanceInfo.id} · EA port ${instanceInfo.defaultTcpPort || '?'}`}>
                  {instanceInfo.label || instanceInfo.id}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            {isExpanded && <div className="nav-label">PAGES</div>}
            {visiblePages.map((page) => (
              <button
                type="button"
                key={page.id}
                data-testid={`nav-${page.id}`}
                className={`nav-item ${currentPage === page.id ? 'active' : ''} ${isExpanded ? '' : 'collapsed'}`}
                onClick={() => onPageChange(page.id)}
                title={page.label}
                aria-label={page.label}
                aria-current={currentPage === page.id ? 'page' : undefined}
              >
                <span className="nav-icon"><page.Icon size={NAV_ICON_SIZE} aria-hidden="true" /></span>
                {isExpanded && <span className="nav-text">{page.label}</span>}
              </button>
            ))}
          </div>
          {typeof onOpenSetup === 'function' && (
            <div className="nav-section">
              {isExpanded && <div className="nav-label">HELP</div>}
              <button
                type="button"
                data-testid="nav-setup"
                className={`nav-item ${isExpanded ? '' : 'collapsed'}`}
                onClick={onOpenSetup}
                title="Setup checklist — Telegram, MetaTrader EA, channels"
              >
                <span className="nav-icon"><Rocket size={NAV_ICON_SIZE} aria-hidden="true" /></span>
                {isExpanded && <span className="nav-text">Setup</span>}
              </button>
            </div>
          )}
        </nav>

        {isExpanded && onThemeChange && Array.isArray(themes) && themes.length > 0 && (
          <div className="sidebar-theme">
            <label className="sidebar-theme-label" htmlFor="app-theme-select">Look &amp; feel</label>
            <select
              id="app-theme-select"
              data-testid="theme-selector"
              className="theme-selector sidebar-theme-select"
              value={theme}
              onChange={(e) => onThemeChange(e.target.value)}
              title="Visual theme: layout, type, and chrome — not just colors"
            >
              {themes.map((t) => (
                <option key={t.id} value={t.id} title={t.blurb || t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="sidebar-theme-hint">Fonts, radii, panels &amp; density change per option.</p>
            {typeof setUiMode === 'function' && (
              <div className="sidebar-mode-row">
                <span className="sidebar-mode-label">Advanced mode</span>
                <label className="toggle sidebar-mode-toggle" title="Show Filter Lab, AI, Fundamentals, and Channels">
                  <input
                    type="checkbox"
                    checked={isAdvanced}
                    data-testid="sidebar-advanced-mode-toggle"
                    onChange={(e) => setUiMode(e.target.checked ? 'advanced' : 'simple')}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            )}
          </div>
        )}

        {isExpanded && (
          <div className="sidebar-footer">
            <div className="sidebar-version">v1.2</div>
          </div>
        )}
      </div>
    </div>
  );
}
