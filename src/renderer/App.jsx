import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TelegramConnectModal from './components/TelegramConnectModal.jsx';
import OnboardingModal from './components/OnboardingModal.jsx';
import SetupChecklist from './components/SetupChecklist.jsx';
import StatusStrip from './components/StatusStrip.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { applyTheme, getStoredTheme, THEME_LIST } from './theme.js';
import CommandPalette, { useCommandPaletteHotkey } from './components/CommandPalette.jsx';
import MiniOverlay from './components/MiniOverlay.jsx';
import { usePersistedTradeFilters } from './hooks/usePersistedTradeFilters.js';
import { mergeTradeUpdatePreservingUserEdits } from './utils/tradeMerge.js';
import { useUiMode, ADVANCED_ONLY_PAGES } from './hooks/useUiMode.js';
/** Default routes load eagerly — lazy-loading them pulled ~1.3MB of chart code on first paint and froze the window. */
import AnalyticsDashboardPage from './pages/AnalyticsDashboardPage.jsx';
import SignalsPage from './pages/DashboardPage.jsx';

/** Lazy-loaded routes — secondary pages only. */
const CalendarStatsPage = lazy(() => import('./pages/CalendarStatsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const TelegramPage = lazy(() => import('./pages/TelegramPage.jsx'));
const FundamentalsPage = lazy(() => import('./pages/FundamentalsPage.jsx'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage.jsx'));
const ChannelsScoreboardPage = lazy(() => import('./pages/ChannelsScoreboardPage.jsx'));
const AiAssistantPage = lazy(() => import('./pages/AiAssistantPage.jsx'));
const FilterLabPage = lazy(() => import('./pages/FilterLabPage.jsx'));
const ParserDebugPage = lazy(() => import('./pages/ParserDebugPage.jsx'));
// ─── TradeZella-parity pages — agents: replace ONLY your own anchor line ───
const StrategiesPage = lazy(() => import('./pages/StrategiesPage.jsx'));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'));
const NotebookPage = lazy(() => import('./pages/NotebookPage.jsx'));
const ReplayPage = lazy(() => import('./pages/ReplayPage.jsx'));
const PropFirmPage = lazy(() => import('./pages/PropFirmPage.jsx'));
const BacktestPage = lazy(() => import('./pages/BacktestPage.jsx'));

const isMiniMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mini') === '1';

function RouteFallback() {
  return (
    <div className="route-loading-fallback" role="status" aria-live="polite">
      <div className="route-loading-spinner" aria-hidden="true" />
      <span>Loading page…</span>
    </div>
  );
}

/** Keep route subtree mounted after first visit; parent toggles visibility */
function RouteSlot({ pageId, currentPage, visitedPages, children }) {
  if (!visitedPages.has(pageId)) return null;
  const visible = currentPage === pageId;
  return (
    <div
      className={`page-route-slot${visible ? ' page-route-slot--visible' : ''}`}
      aria-hidden={!visible}
    >
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default function App() {
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [telegramAuthenticated, setTelegramAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [showTelegramConnect, setShowTelegramConnect] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [trades, setTrades] = useState([]);
  const [accountSnapshot, setAccountSnapshot] = useState(null);
  const [mt5Connected, setMt5Connected] = useState(false);
  const [bridgeMeta, setBridgeMeta] = useState({ fileBridge: false, fileHandshake: false });
  const [currentMt5Account, setCurrentMt5Account] = useState(null);
  const [knownMt5Accounts, setKnownMt5Accounts] = useState([]);
  const [connectionProfiles, setConnectionProfiles] = useState([]);
  const [selectedAccountKeys, setSelectedAccountKeys] = useState([]);
  /** Shared Dashboard ↔ Trades analytics scope */
  const [timeScope, setTimeScope] = useState('DAY');
  /** YYYY-MM-DD when timeScope === 'CUSTOM' */
  const [analyticsCustomRange, setAnalyticsCustomRange] = useState(null);
  /** Shared Dashboard ↔ Trades filters (symbol, status, slices, tab) — persisted in localStorage */
  const { filters: tradeFilters, setFilters: setTradeFilters, resetFilters: resetTradeFilters } = usePersistedTradeFilters();
  /** Routes stay mounted after first open — faster switching + preserves UI state */
  const [visitedPages, setVisitedPages] = useState(() => new Set(['dashboard']));
  const [uiTheme, setUiTheme] = useState(() => getStoredTheme());
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [startupProgress, setStartupProgress] = useState(0);
  const [startupMessage, setStartupMessage] = useState('Initializing...');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  /** Channels with copying enabled — feeds the setup checklist + status strip. */
  const [enabledChannelsCount, setEnabledChannelsCount] = useState(0);
  /** Setup checklist forced open via the sidebar "Setup" button. */
  const [setupOpen, setSetupOpen] = useState(false);
  const [instanceInfo, setInstanceInfo] = useState(null);
  const { setUiMode, isSimple, isAdvanced } = useUiMode();

  useCommandPaletteHotkey(setCommandPaletteOpen);

  useEffect(() => {
    if (isSimple && ADVANCED_ONLY_PAGES.has(currentPage)) {
      setCurrentPage('dashboard');
    }
  }, [isSimple, currentPage]);

  useEffect(() => {
    setVisitedPages((prev) => new Set(prev).add(currentPage));
  }, [currentPage]);

  const loadSession = () => {
    window.electronAPI?.checkSession().then((res) => {
      if (res?.authenticated) {
        setTelegramAuthenticated(true);
        setUser(res.user);
      }
    }).catch(() => {});
  };

  useEffect(() => {
    const messages = [
      { msg: 'Loading configuration...', pct: 10 },
      { msg: 'Connecting to services...', pct: 40 },
      { msg: 'Loading trade data...', pct: 70 },
      { msg: 'Initializing UI...', pct: 90 }
    ];
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < messages.length) {
        setStartupMessage(messages[idx].msg);
        setStartupProgress(messages[idx].pct);
        idx++;
      } else {
        clearInterval(interval);
      }
    }, 400);

    Promise.all([
      window.electronAPI?.getLicenseStatus?.().catch(() => null),
      window.electronAPI?.getOnboardingStatus?.().catch(() => ({ completed: true })),
    ]).then(([status, onboarding]) => {
      setLicenseStatus(status || null);
      loadSession();
      setShowOnboarding(!onboarding?.completed);
      setChecking(false);
      setStartupProgress(100);
      setStartupMessage('Ready');
      clearInterval(interval);
    }).catch(() => { setChecking(false); clearInterval(interval); });
  }, []);

  useEffect(() => {
    window.electronAPI?.getInstanceInfo?.().then((info) => {
      if (info?.isNamedInstance) setInstanceInfo(info);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const sub = window.electronAPI?.onLicenseStatusChanged;
    if (!sub) return undefined;
    return sub((status) => {
      setLicenseStatus(status ?? null);
    });
  }, []);

  useEffect(() => {
    const unsubs = [];
    const sub = (maybeUnsub) => {
      if (typeof maybeUnsub === 'function') unsubs.push(maybeUnsub);
    };
    sub(window.electronAPI?.onNewTrade?.((trade) => {
      setTrades((prev) => [trade, ...prev.filter((t) => String(t.id) !== String(trade.id))]);
    }));
    sub(window.electronAPI?.onTradesRemoved?.((removedIds) => {
      const idSet = new Set((Array.isArray(removedIds) ? removedIds : []).map((id) => String(id)));
      if (!idSet.size) return;
      setTrades((prev) => prev.filter((t) => !idSet.has(String(t.id))));
    }));
    sub(window.electronAPI?.onTradeUpdate?.((updated) => {
      setTrades((prev) => {
        const idx = prev.findIndex((t) => String(t.id) === String(updated.id));
        if (idx < 0) return [updated, ...prev.filter((t) => String(t.id) !== String(updated.id))];
        const existing = prev[idx];
        const merged = mergeTradeUpdatePreservingUserEdits(existing, updated);
        return prev.map((t) => (String(t.id) === String(updated.id) ? merged : t));
      });
    }));
    sub(window.electronAPI?.onMt5Account?.((snap) => {
      setAccountSnapshot(snap || null);
      if (snap?.accountKey) {
        setKnownMt5Accounts((prev) => {
          const idx = prev.findIndex((acc) => acc.key === snap.accountKey);
          const nextAcc = {
            key: snap.accountKey,
            login: snap.accountLogin || '',
            server: snap.accountServer || '',
            name: snap.accountName || ''
          };
          if (idx >= 0) {
            const clone = [...prev];
            clone[idx] = { ...clone[idx], ...nextAcc };
            return clone;
          }
          return [...prev, nextAcc];
        });
      }
    }));
    sub(window.electronAPI?.onMt5KnownAccounts?.((rows) => {
      if (Array.isArray(rows)) setKnownMt5Accounts(rows);
    }));
    sub(window.electronAPI?.onMt5AccountIdentity?.((identity) => {
      if (identity?.key) {
        setCurrentMt5Account(identity);
        setKnownMt5Accounts((prev) => {
          const idx = prev.findIndex((acc) => acc.key === identity.key);
          if (idx >= 0) {
            const clone = [...prev];
            clone[idx] = { ...clone[idx], ...identity };
            return clone;
          }
          return [...prev, identity];
        });
      }
    }));
    sub(window.electronAPI?.onConnectionsChanged?.((rows) => {
      setConnectionProfiles(Array.isArray(rows) ? rows : []);
    }));
    sub(window.electronAPI?.onConnectionStatus?.((status) => {
      if (status?.mt5 !== undefined) setMt5Connected(!!status.mt5);
      if (status?.telegram !== undefined) setTelegramAuthenticated(!!status.telegram);
      setBridgeMeta((prev) => ({
        fileBridge: status?.fileBridge !== undefined ? !!status.fileBridge : prev.fileBridge,
        fileHandshake: status?.fileHandshake !== undefined ? !!status.fileHandshake : prev.fileHandshake
      }));
    }));
    sub(window.electronAPI?.onDataRestored?.(() => {
      window.electronAPI?.getTrades?.().then((rows) => {
        setTrades(Array.isArray(rows) ? rows : []);
      }).catch(() => {});
      window.electronAPI?.getConnections?.().then((rows) => {
        setConnectionProfiles(Array.isArray(rows) ? rows : []);
      }).catch(() => {});
    }));
    return () => {
      for (const u of unsubs) {
        try { u(); } catch (_) { /* noop */ }
      }
    };
  }, []);

  // Enabled-channel count for the setup checklist + status strip (cheap, local store read)
  useEffect(() => {
    let active = true;
    const load = () => {
      window.electronAPI?.getEnabledChannels?.().then((channels) => {
        if (active) setEnabledChannelsCount(Array.isArray(channels) ? channels.length : 0);
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const accountOptions = useMemo(() => {
    const map = new Map();
    for (const t of (Array.isArray(trades) ? trades : [])) {
      const key = t.accountKey || 'unknown';
      if (!map.has(key)) {
        const login = t.accountLogin || key;
        const server = t.accountServer || '';
        map.set(key, server ? `${login}@${server}` : login);
      }
    }
    if (accountSnapshot?.accountKey && !map.has(accountSnapshot.accountKey)) {
      const login = accountSnapshot.accountLogin || accountSnapshot.accountKey;
      const server = accountSnapshot.accountServer || '';
      map.set(accountSnapshot.accountKey, server ? `${login}@${server}` : login);
    }
    if (currentMt5Account?.key && !map.has(currentMt5Account.key)) {
      const login = currentMt5Account.login || currentMt5Account.key;
      const server = currentMt5Account.server || '';
      map.set(currentMt5Account.key, server ? `${login}@${server}` : login);
    }
    for (const acc of (knownMt5Accounts || [])) {
      if (!acc?.key || map.has(acc.key)) continue;
      const login = acc.login || acc.key;
      const server = acc.server || '';
      map.set(acc.key, server ? `${login}@${server}` : login);
    }
    for (const c of (connectionProfiles || [])) {
      const login = String(c?.auth?.login || '').trim();
      const server = String(c?.auth?.server || '').trim();
      if (!login || !server) continue;
      const key = `${login}@${server}`;
      if (map.has(key)) continue;
      map.set(key, `${key}${c?.provider ? ` (${String(c.provider).toUpperCase()})` : ''}`);
    }
    const hasManualChannel = (Array.isArray(trades) ? trades : []).some(
      (t) => String(t?.channel || '') === 'Manual' || String(t?.accountKey || '') === 'manual'
    );
    if (hasManualChannel && !map.has('manual')) {
      map.set('manual', 'Manual entries');
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [trades, accountSnapshot, currentMt5Account, knownMt5Accounts, connectionProfiles]);

  useEffect(() => {
    setSelectedAccountKeys((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return [];
      const valid = new Set(accountOptions.map((acc) => acc.key));
      const next = prev.filter((key) => valid.has(key));
      if (next.length === prev.length) return prev;
      return next;
    });
  }, [accountOptions]);

  // Load trades for pages
  useEffect(() => {
    Promise.all([
      window.electronAPI?.getTrades(),
      window.electronAPI?.getMt5AccountSnapshot?.(),
      window.electronAPI?.getCurrentMt5Account?.(),
      window.electronAPI?.getKnownMt5Accounts?.(),
      window.electronAPI?.getConnections?.(),
      window.electronAPI?.getTcpStatus?.(),
    ]).then(([t, snap, currentAccount, knownAccounts, connections, tcp]) => {
      setTrades(Array.isArray(t) ? t : []);
      setMt5Connected(!!tcp?.connected);
      setBridgeMeta({
        fileBridge: !!tcp?.fileBridge,
        fileHandshake: !!tcp?.fileHandshake
      });
      setAccountSnapshot(snap || null);
      setCurrentMt5Account(
        currentAccount
        || (snap?.accountKey ? {
          key: snap.accountKey,
          login: snap.accountLogin || '',
          server: snap.accountServer || '',
          name: snap.accountName || ''
        } : null)
      );
      if (Array.isArray(knownAccounts)) {
        setKnownMt5Accounts(knownAccounts);
      }
      setConnectionProfiles(Array.isArray(connections) ? connections : []);
    }).catch(err => console.error('Error loading data:', err));
  }, []);

  if (checking) {
    return (
      <div className="splash">
        <div className="splash-logo">
          <img src="brand-mark.svg" className="sidebar-logo-mark" alt="Trade Station" />
          <span className="logo-text">Trade Station</span>
        </div>
        <div className="splash-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${startupProgress}%` }} />
          </div>
          <span className="progress-message">{startupMessage}</span>
        </div>
      </div>
    );
  }

  if (isMiniMode) {
    return (
      <MiniOverlay
        trades={trades}
        mt5Connected={mt5Connected}
        onRestore={() => window.electronAPI?.toggleMiniMode?.()}
      />
    );
  }

  return (
    <div className="app-with-sidebar" data-testid="app-root">
      <Sidebar
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        isExpanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded(v => !v)}
        theme={uiTheme}
        themes={THEME_LIST}
        onThemeChange={(id) => {
          applyTheme(id);
          setUiTheme(getStoredTheme());
        }}
        onOpenSetup={() => setSetupOpen(true)}
        isAdvanced={isAdvanced}
        setUiMode={setUiMode}
        instanceInfo={instanceInfo}
      />
      <div className="page-container">
        {(currentPage === 'dashboard' || currentPage === 'trades') && (
          <StatusStrip
            telegramConnected={telegramAuthenticated}
            mt5Connected={mt5Connected}
            enabledChannelsCount={enabledChannelsCount}
            onNavigate={setCurrentPage}
          />
        )}
        <RouteSlot pageId="dashboard" currentPage={currentPage} visitedPages={visitedPages}>
          <AnalyticsDashboardPage
            trades={trades}
            setTrades={setTrades}
            currentMt5Account={currentMt5Account}
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            analyticsCustomRange={analyticsCustomRange}
            setAnalyticsCustomRange={setAnalyticsCustomRange}
            routeVisible={currentPage === 'dashboard'}
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={setSelectedAccountKeys}
            onOpenSettingsPage={() => setCurrentPage('settings')}
            onOpenFundamentalsPage={() => setCurrentPage('fundamentals')}
            tradeFilters={tradeFilters}
            setTradeFilters={setTradeFilters}
            resetTradeFilters={resetTradeFilters}
          />
        </RouteSlot>
        <RouteSlot pageId="trades" currentPage={currentPage} visitedPages={visitedPages}>
          <SignalsPage
            trades={trades}
            setTrades={setTrades}
            accountSnapshot={accountSnapshot}
            currentMt5Account={currentMt5Account}
            mt5Connected={mt5Connected}
            bridgeMeta={bridgeMeta}
            timeScope={timeScope}
            setTimeScope={setTimeScope}
            analyticsCustomRange={analyticsCustomRange}
            setAnalyticsCustomRange={setAnalyticsCustomRange}
            routeVisible={currentPage === 'trades'}
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={setSelectedAccountKeys}
            onTradeUpdated={(updatedTrade) => {
              if (!updatedTrade?.id) return;
              setTrades((prev) => prev.map((t) => (
                String(t.id) === String(updatedTrade.id)
                  ? mergeTradeUpdatePreservingUserEdits(t, updatedTrade)
                  : t
              )));
            }}
            onOpenSettingsPage={() => setCurrentPage('settings')}
            tradeFilters={tradeFilters}
            setTradeFilters={setTradeFilters}
            resetTradeFilters={resetTradeFilters}
          />
        </RouteSlot>
        <RouteSlot pageId="telegram" currentPage={currentPage} visitedPages={visitedPages}>
          <TelegramPage
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={setSelectedAccountKeys}
            telegramAuthenticated={telegramAuthenticated}
            user={user}
            onRequestTelegramConnect={() => setShowTelegramConnect(true)}
            onTelegramDisconnect={async () => {
              await window.electronAPI?.signOut();
              setTelegramAuthenticated(false);
              setUser(null);
            }}
          />
        </RouteSlot>
        {isAdvanced && (
          <RouteSlot pageId="fundamentals" currentPage={currentPage} visitedPages={visitedPages}>
            <FundamentalsPage
              selectedAccountKeys={selectedAccountKeys}
              accountOptions={accountOptions}
              onSelectedAccountsChange={setSelectedAccountKeys}
              trades={trades}
              setTimeScope={setTimeScope}
              setAnalyticsCustomRange={setAnalyticsCustomRange}
              onNavigateToTrades={() => setCurrentPage('trades')}
            />
          </RouteSlot>
        )}
        <RouteSlot pageId="calendar" currentPage={currentPage} visitedPages={visitedPages}>
          <CalendarStatsPage
            trades={trades}
            accountSnapshot={accountSnapshot}
            user={user}
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={setSelectedAccountKeys}
            tradeFilters={tradeFilters}
            onTradeUpdated={(updatedTrade) => {
              if (!updatedTrade?.id) return;
              setTrades((prev) => prev.map((t) => (
                String(t.id) === String(updatedTrade.id)
                  ? mergeTradeUpdatePreservingUserEdits(t, updatedTrade)
                  : t
              )));
            }}
          />
        </RouteSlot>
        <RouteSlot pageId="connections" currentPage={currentPage} visitedPages={visitedPages}>
          <ConnectionsPage
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={setSelectedAccountKeys}
          />
        </RouteSlot>
        {isAdvanced && (
          <RouteSlot pageId="channels" currentPage={currentPage} visitedPages={visitedPages}>
            <ChannelsScoreboardPage
              selectedAccountKeys={selectedAccountKeys}
              accountOptions={accountOptions}
              onSelectedAccountsChange={setSelectedAccountKeys}
            />
          </RouteSlot>
        )}
        {isAdvanced && (
          <RouteSlot pageId="ai" currentPage={currentPage} visitedPages={visitedPages}>
            <AiAssistantPage routeVisible={currentPage === 'ai'} />
          </RouteSlot>
        )}
        {isAdvanced && (
          <RouteSlot pageId="filter-lab" currentPage={currentPage} visitedPages={visitedPages}>
            <FilterLabPage
              trades={trades}
              timeScope={timeScope}
              setTimeScope={setTimeScope}
              analyticsCustomRange={analyticsCustomRange}
              setAnalyticsCustomRange={setAnalyticsCustomRange}
              routeVisible={currentPage === 'filter-lab'}
              selectedAccountKeys={selectedAccountKeys}
              accountOptions={accountOptions}
              onSelectedAccountsChange={setSelectedAccountKeys}
              tradeFilters={tradeFilters}
              setTradeFilters={setTradeFilters}
              resetTradeFilters={resetTradeFilters}
            />
          </RouteSlot>
        )}
        {isAdvanced && (
          <RouteSlot pageId="parser-lab" currentPage={currentPage} visitedPages={visitedPages}>
            <ParserDebugPage routeVisible={currentPage === 'parser-lab'} />
          </RouteSlot>
        )}
        {/* ─── TradeZella-parity routes — agents: replace ONLY your own anchor ─── */}
        <RouteSlot pageId="strategies" currentPage={currentPage} visitedPages={visitedPages}>
          <StrategiesPage routeVisible={currentPage === 'strategies'} />
        </RouteSlot>
        {isAdvanced && (
          <RouteSlot pageId="reports" currentPage={currentPage} visitedPages={visitedPages}>
            <ReportsPage
              routeVisible={currentPage === 'reports'}
              trades={trades}
              tradeFilters={tradeFilters}
              setTradeFilters={setTradeFilters}
              resetTradeFilters={resetTradeFilters}
              timeScope={timeScope}
              setTimeScope={setTimeScope}
              analyticsCustomRange={analyticsCustomRange}
              setAnalyticsCustomRange={setAnalyticsCustomRange}
              selectedAccountKeys={selectedAccountKeys}
              accountOptions={accountOptions}
              onSelectedAccountsChange={setSelectedAccountKeys}
            />
          </RouteSlot>
        )}
        <RouteSlot pageId="notebook" currentPage={currentPage} visitedPages={visitedPages}>
          <NotebookPage routeVisible={currentPage === 'notebook'} />
        </RouteSlot>
        {isAdvanced && (
          <RouteSlot pageId="replay" currentPage={currentPage} visitedPages={visitedPages}>
            <ReplayPage routeVisible={currentPage === 'replay'} />
          </RouteSlot>
        )}
        <RouteSlot pageId="prop-firm" currentPage={currentPage} visitedPages={visitedPages}>
          <PropFirmPage routeVisible={currentPage === 'prop-firm'} accountOptions={accountOptions} />
        </RouteSlot>
        {isAdvanced && (
          <RouteSlot pageId="backtest" currentPage={currentPage} visitedPages={visitedPages}>
            <BacktestPage routeVisible={currentPage === 'backtest'} />
          </RouteSlot>
        )}
        <RouteSlot pageId="settings" currentPage={currentPage} visitedPages={visitedPages}>
          <SettingsPage
            licenseStatus={licenseStatus}
            selectedAccountKeys={selectedAccountKeys}
            accountOptions={accountOptions}
            onSelectedAccountsChange={setSelectedAccountKeys}
            onReplayOnboarding={() => setShowOnboarding(true)}
          />
        </RouteSlot>
      </div>
      <SetupChecklist
        telegramConnected={telegramAuthenticated}
        mt5Connected={mt5Connected}
        enabledChannelsCount={enabledChannelsCount}
        currentPage={currentPage}
        forcedOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onNavigate={(page) => {
          setSetupOpen(false);
          setCurrentPage(page);
        }}
        onConnectTelegram={() => setShowTelegramConnect(true)}
      />
      {showTelegramConnect && (
        <TelegramConnectModal
          onClose={() => setShowTelegramConnect(false)}
          onAuth={(u) => {
            setTelegramAuthenticated(true);
            setUser(u);
            setShowTelegramConnect(false);
          }}
        />
      )}
      {showOnboarding && (
        <OnboardingModal
          onNavigatePage={setCurrentPage}
          onComplete={async () => {
            await window.electronAPI?.completeOnboarding?.('finish');
            setShowOnboarding(false);
          }}
          onSkip={async ({ persist = true } = {}) => {
            await window.electronAPI?.skipOnboarding?.({ persist });
            setShowOnboarding(false);
          }}
        />
      )}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} setPage={setCurrentPage} />
    </div>
  );
}
