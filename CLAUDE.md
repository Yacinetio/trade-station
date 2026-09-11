# Trade Station (signal-copier) — guide for AI assistants

## What this is

- **Trade Station** is an Electron + React desktop app that bridges **Telegram trading signals** to **MetaTrader 4/5** via a local TCP connection to an Expert Advisor (EA), with analytics, fundamentals, and persistent trade storage.
- **Repository layout:** `src/main` (Node/Electron), `src/renderer` (React), `mt5/SignalCopierEA.mq5`, `mt4/SignalCopierEA.mq4`.
- **Packaged app title:** “Trade Station” (single instance lock in main process).

## Build and run

- **Dev:** `npm install` then `npm run dev` (Vite + Electron hot reload).
- **Production build:** `npm run build` → `dist/Trade-Station-Setup.exe` and `dist/win-unpacked/`.
- **Tests:** `npm test` (Vitest).
- If the build fails on Windows with **file lock** on the installer, close the running app or the locked process, then rebuild.

## Data and persistence (critical)

- **Config / global store:** `electron-store` under the user’s **Documents** tree — typically `Documents\TradeStation\` with `tradesync-config.json`.
- **Trades:** stored **per account** under `Documents\TradeStation\accounts\<accountKey>\` via `src/main/tradeStore.js`.
- **Do not** delete user production data without explicit user permission.
- **IPC:** `storage:getInfo` / `storage:openDataFolder` expose paths and open Explorer.

## Main process — important modules

- **`src/main/main.js`:** IPC, Telegram `onMessage` → parse → filters → news guard → `tcpBridge.sendSignal`, trade persistence, notifications.
- **`src/main/signalFilters.js`:** schedule/session/day filters before sending signals to the EA.
- **`src/main/tcpBridge.js`:** TCP to EA; `SIGNAL`, `SYNC_REQUEST`, `SETTINGS_UPDATE`, etc.
- **`src/main/telegramClient.js`:** Telegram user session, channels.
- **`src/main/signalParser.js`:** Parses messages; respects ignored keywords, excluded pairs, etc.
- **`src/main/fundamentalsService.js`:** Fundamentals + **news guard** for high-impact windows around events.
- **`src/main/tradeStore.js`:** Per-account JSON trade files + migration.
- **Preload:** `src/main/preload.js` — whitelisted `electronAPI` for renderer.

## Renderer — pages (high level)

- **Analytics “Dashboard”** (`AnalyticsDashboardPage.jsx`): KPIs, equity curve, calendar.
- **Signals** (`DashboardPage.jsx`): execution monitor, All / Live / Closed / Blocked tabs.
- **Fundamentals, Calendar Stats, Settings, Telegram, Connections** use shared **AccountScopePicker**.

## EAs (MT5 / MT4)

- **`mt5/SignalCopierEA.mq5`:** TCP client to app; signal execution, sync, screenshots, PnL push, break-even / trailing.
- **MT4** EA exists but feature parity with MT5 is not guaranteed.

## What to preserve when editing

- Match existing code style, imports, and patterns.
- Minimize scope: only files needed for the task.
- Avoid deleting user data or schema without permission.

## Fundamentals — real data only

- **Never** show mocked or invented values as live market data.
- When a feed is unavailable, return `available: false` with a clear reason and show **N/A** in the UI.
- **Real sources:** Yahoo Finance, ForexFactory, Alternative.me, CFTC COT, FRED (when `FRED_API_KEY` env var is set), World Bank, CoinGecko.

## Quick file map

| Area | Path |
|------|------|
| App shell / routing | `src/renderer/App.jsx` |
| Global CSS | `src/renderer/styles/global.css` |
| Account picker | `src/renderer/components/AccountScopePicker.jsx` |
| Trades table | `src/renderer/components/TradeTable.jsx` |
| Settings UI | `src/renderer/components/SettingsModal.jsx` |
