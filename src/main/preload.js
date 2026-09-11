const { contextBridge, ipcRenderer } = require('electron');

/** Stable listener + unsubscribe (avoids removeAllListeners wiping other subscribers). */
function ipcOn(channel, callback) {
  const listener = (_, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Telegram Auth
  sendCode: (phone) => ipcRenderer.invoke('telegram:sendCode', phone),
  signIn: (phone, phoneCodeHash, code) => ipcRenderer.invoke('telegram:signIn', phone, phoneCodeHash, code),
  signInWith2FA: (password) => ipcRenderer.invoke('telegram:signInWith2FA', password),
  signOut: () => ipcRenderer.invoke('telegram:signOut'),
  checkSession: () => ipcRenderer.invoke('telegram:checkSession'),

  // Channels
  getChannels: (opts) => ipcRenderer.invoke('telegram:getChannels', opts),
  reconnectTelegram: () => ipcRenderer.invoke('telegram:reconnect'),
  enableChannel: (channelId, enabled) => ipcRenderer.invoke('telegram:enableChannel', channelId, enabled),
  getEnabledChannels: () => ipcRenderer.invoke('telegram:getEnabledChannels'),
  sendDailyReport: (channelId) => ipcRenderer.invoke('telegram:sendDailyReport', channelId),
  sendWeeklyReport: (channelId) => ipcRenderer.invoke('telegram:sendWeeklyReport', channelId),
  sendMonthlyReport: (channelId) => ipcRenderer.invoke('telegram:sendMonthlyReport', channelId),
  getDailyReportTarget: () => ipcRenderer.invoke('telegram:getDailyReportTarget'),
  setDailyReportTarget: (target) => ipcRenderer.invoke('telegram:setDailyReportTarget', target),
  getReportSettings: () => ipcRenderer.invoke('telegram:getReportSettings'),
  saveReportSettings: (settings) => ipcRenderer.invoke('telegram:saveReportSettings', settings),

  debugParserMessage: (payload) => ipcRenderer.invoke('parser:debugMessage', payload),
  runDataIntegrityAudit: () => ipcRenderer.invoke('audit:runDataIntegrity'),
  getMonteCarlo: (opts) => ipcRenderer.invoke('analytics:monteCarlo', opts),
  getUnderwaterSeries: () => ipcRenderer.invoke('analytics:underwaterSeries'),
  getEaHealth: () => ipcRenderer.invoke('bridge:getEaHealth'),
  forceEaSettingsUpdate: () => ipcRenderer.invoke('bridge:forceSettingsUpdate'),
  runEaDiagnostic: (opts) => ipcRenderer.invoke('bridge:runEaDiagnostic', opts),
  getSettingsProfiles: () => ipcRenderer.invoke('settings:getProfiles'),
  saveSettingsProfile: (payload) => ipcRenderer.invoke('settings:saveProfile', payload),
  applySettingsProfile: (profileId) => ipcRenderer.invoke('settings:applyProfile', profileId),
  getInstanceInfo: () => ipcRenderer.invoke('instance:getInfo'),
  toggleMiniMode: () => ipcRenderer.invoke('miniMode:toggle'),

  // Trades
  getTrades: () => ipcRenderer.invoke('trades:getAll'),
  clearTrades: () => ipcRenderer.invoke('trades:clear'),
  e2eSeedSyntheticTrades: () => ipcRenderer.invoke('trades:e2eSeedSyntheticTrades'),
  e2eClearSyntheticTrades: () => ipcRenderer.invoke('trades:e2eClearSyntheticTrades'),
  resendTrades: (ids) => ipcRenderer.invoke('trades:resend', ids),
  refreshTrades: () => ipcRenderer.invoke('trades:refresh'),
  updateTradeJournal: (tradeId, journalPatch) => ipcRenderer.invoke('trades:updateJournal', tradeId, journalPatch),
  updateTrade: (tradeId, payload) => ipcRenderer.invoke('trades:update', tradeId, payload),
  updateTradeComment: (tradeId, comment) => ipcRenderer.invoke('trades:updateComment', tradeId, comment),
  deleteTrades: (ids) => ipcRenderer.invoke('trades:deleteMany', ids),
  deleteTradesByAccount: (accountKey) => ipcRenderer.invoke('trades:deleteByAccount', accountKey),
  deleteAccounts: (accountKeys) => ipcRenderer.invoke('trades:deleteAccounts', accountKeys),
  importMtStatementDialog: (opts) => ipcRenderer.invoke('trades:importMtStatementDialog', opts),
  parseManualTelegram: (payload) => ipcRenderer.invoke('trades:parseManualTelegram', payload),
  addManualTrade: (payload) => ipcRenderer.invoke('trades:addManual', payload),
  e2eFixtureImportMtStatement: (opts) =>
    ipcRenderer.invoke('trades:e2eFixtureImportMtStatement', opts),
  isTradeStationE2e: () => ipcRenderer.invoke('app:isTradeStationE2e'),

  // Analytics
  getAnalyticsSummary: (filters) => ipcRenderer.invoke('analytics:getSummary', filters),
  validateLiveAnalytics: () => ipcRenderer.invoke('analytics:validateLive'),
  exportWeeklyPack: (filters) => ipcRenderer.invoke('exports:weeklyPack', filters),
  exportTrades: (payload) => ipcRenderer.invoke('trades:export', payload),
  getFundamentalsDashboard: (options) => ipcRenderer.invoke('fundamentals:getDashboard', options),
  analyzeFundamentalsHeadlineAi: (payload) => ipcRenderer.invoke('fundamentals:analyzeHeadlineAi', payload),
  getFundamentalsDigestAi: (payload) => ipcRenderer.invoke('fundamentals:getDigestAi', payload),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getDefaultSettings: () => ipcRenderer.invoke('settings:getDefaults'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getOnboardingStatus: () => ipcRenderer.invoke('onboarding:getStatus'),
  completeOnboarding: (step) => ipcRenderer.invoke('onboarding:complete', step),
  skipOnboarding: (opts) => ipcRenderer.invoke('onboarding:skip', opts),
  getMarketBars: (query) => ipcRenderer.invoke('marketHistory:getBars', query),
  getStorageInfo: () => ipcRenderer.invoke('storage:getInfo'),
  openDataFolder: () => ipcRenderer.invoke('storage:openDataFolder'),
  exportDataZip: () => ipcRenderer.invoke('storage:exportDataZip'),
  importDataZip: () => ipcRenderer.invoke('storage:importDataZip'),

  // TCP Bridge status
  getTcpStatus: () => ipcRenderer.invoke('tcp:status'),
  getMt5AccountSnapshot: () => ipcRenderer.invoke('mt5:getAccountSnapshot'),
  getCurrentMt5Account: () => ipcRenderer.invoke('mt5:getCurrentAccount'),
  getKnownMt5Accounts: () => ipcRenderer.invoke('mt5:getKnownAccounts'),
  forgetKnownMt5Account: (accountKey) => ipcRenderer.invoke('mt5:forgetKnownAccount', accountKey),
  getConnections: () => ipcRenderer.invoke('connections:getAll'),
  upsertConnection: (payload) => ipcRenderer.invoke('connections:upsert', payload),
  deleteConnection: (id) => ipcRenderer.invoke('connections:delete', id),
  testConnection: (id) => ipcRenderer.invoke('connections:test', id),
  cloudBridgeGetConfig: () => ipcRenderer.invoke('cloudBridge:getConfig'),
  cloudBridgeSaveConfig: (patch) => ipcRenderer.invoke('cloudBridge:saveConfig', patch),
  cloudBridgeDeploy: (connectionId) => ipcRenderer.invoke('cloudBridge:deploy', connectionId),
  cloudBridgeStop: (connectionId) => ipcRenderer.invoke('cloudBridge:stop', connectionId),
  cloudBridgeRestart: (connectionId) => ipcRenderer.invoke('cloudBridge:restart', connectionId),
  cloudBridgeSync: (connectionId) => ipcRenderer.invoke('cloudBridge:sync', connectionId),
  cloudBridgeCredentialLink: (connectionId) => ipcRenderer.invoke('cloudBridge:credentialLink', connectionId),

  // Logs
  getLogs: () => ipcRenderer.invoke('logs:getAll'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  onLogEvent: (cb) => ipcOn('log:new', cb),
  getNotificationHistory: () => ipcRenderer.invoke('notifications:getHistory'),
  clearNotificationHistory: () => ipcRenderer.invoke('notifications:clearHistory'),
  removeNotificationsByIds: (ids) => ipcRenderer.invoke('notifications:removeByIds', ids),
  markNotificationsRead: (ids, read = true) => ipcRenderer.invoke('notifications:markRead', ids, read),
  onNewNotificationEvent: (cb) => ipcOn('notifications:new', cb),

  // Event listeners
  onNewTrade: (cb) => ipcOn('trade:new', cb),
  onTradeUpdate: (cb) => ipcOn('trade:update', cb),
  onTradesRemoved: (cb) => ipcOn('trades:removed', cb),
  onStatementImported: (cb) => ipcOn('trades:statementImported', cb),
  onConnectionStatus: (cb) => ipcOn('connection:status', cb),
  onNewSignal: (cb) => ipcOn('signal:new', cb),
  onMt5Activity: (cb) => ipcOn('mt5:activity', cb),
  onMt5Account: (cb) => ipcOn('mt5:account', cb),
  onMt5AccountIdentity: (cb) => ipcOn('mt5:accountIdentity', cb),
  onMt5KnownAccounts: (cb) => ipcOn('mt5:knownAccounts', cb),
  onConnectionsChanged: (cb) => ipcOn('connections:changed', cb),
  onSettingsUpdated: (cb) => ipcOn('settings:updated', cb),
  onDataRestored: (cb) => ipcOn('data:restored', cb),

  // License
  getLicenseStatus: () => ipcRenderer.invoke('license:getStatus'),
  activateLicense: (token) => ipcRenderer.invoke('license:activate', token),
  onLicenseStatusChanged: (cb) => ipcOn('license:statusChanged', cb),

  // Diagnostics
  reportRendererError: (payload) => ipcRenderer.invoke('app:reportRendererError', payload),

  // Drawdown guardian
  getDrawdownGuardStatus: () => ipcRenderer.invoke('drawdownGuard:getStatus'),
  clearDrawdownGuardHalt: () => ipcRenderer.invoke('drawdownGuard:clear'),

  // Channel scoreboard / backtester
  getChannelScoreboard: (opts) => ipcRenderer.invoke('channels:getScoreboard', opts),
  runChannelBacktest: (opts) => ipcRenderer.invoke('backtest:runChannel', opts),

  // Free AI signal-check (no API key required)
  getAiRecentVerdicts: (opts) => ipcRenderer.invoke('ai:getRecentVerdicts', opts),
  clearAiVerdictHistory: () => ipcRenderer.invoke('ai:clearVerdictHistory'),
  getAiPerformanceSummary: (opts) => ipcRenderer.invoke('ai:summarizePerformance', opts),
  getAiDashboardStatsSummary: (opts) => ipcRenderer.invoke('ai:summarizeDashboardStats', opts),
  searchBestFilterCombinations: (opts) => ipcRenderer.invoke('filters:searchBestCombinations', opts),
  analyzeWorstTrades: (opts) => ipcRenderer.invoke('filters:analyzeWorstTrades', opts),
  getAiFilterOptimizerSummary: (opts) => ipcRenderer.invoke('ai:summarizeFilterOptimizer', opts),
  getAiWorstTradesSummary: (opts) => ipcRenderer.invoke('ai:summarizeWorstTrades', opts),
  analyzeClosedTrade: (tradeId) => ipcRenderer.invoke('ai:analyzeClosedTrade', tradeId),
  getAiMonthSummary: (opts) => ipcRenderer.invoke('ai:getMonthSummary', opts),
  pingAi: () => ipcRenderer.invoke('ai:ping'),
  getAiUsage: () => ipcRenderer.invoke('ai:getUsage'),
  resetAiUsage: () => ipcRenderer.invoke('ai:resetUsage'),
  getFreeTextModels: () => ipcRenderer.invoke('ai:getFreeTextModels'),

  // AI chat (dedicated AI page)
  getAiChatSessions: () => ipcRenderer.invoke('aiChat:listSessions'),
  getAiChatMessages: (sessionId) => ipcRenderer.invoke('aiChat:getMessages', sessionId),
  newAiChatSession: (opts) => ipcRenderer.invoke('aiChat:newSession', opts),
  sendAiChatMessage: (payload) => ipcRenderer.invoke('aiChat:sendMessage', payload),
  patchAiChatSession: (sessionId, patch) => ipcRenderer.invoke('aiChat:patchSession', sessionId, patch),
  renameAiChatSession: (sessionId, title) => ipcRenderer.invoke('aiChat:renameSession', sessionId, title),
  deleteAiChatSession: (sessionId) => ipcRenderer.invoke('aiChat:deleteSession', sessionId),
  clearAiChatHistory: () => ipcRenderer.invoke('aiChat:clearAll'),

  // ─── TradeZella-parity feature APIs ───
  // Feature agents: replace ONLY your own [anchor:...] line with your methods
  // (each line `name: (args) => ipcRenderer.invoke('channel', args),`).
  backfillExcursion: (opts) => ipcRenderer.invoke('excursion:backfill', opts),
  getBestExit: (tradeId) => ipcRenderer.invoke('excursion:bestExit', tradeId),
  getExcursionSummary: (opts) => ipcRenderer.invoke('excursion:summary', opts),
  listStrategies: (opts) => ipcRenderer.invoke('strategies:list', opts),
  saveStrategy: (strategy) => ipcRenderer.invoke('strategies:save', strategy),
  deleteStrategy: (strategyId) => ipcRenderer.invoke('strategies:delete', strategyId),
  listStrategyTemplates: () => ipcRenderer.invoke('strategies:listTemplates'),
  createStrategyFromTemplate: (templateId) => ipcRenderer.invoke('strategies:createFromTemplate', templateId),
  attachTradeStrategy: (payload) => ipcRenderer.invoke('strategies:attachTrade', payload),
  setStrategyRuleChecks: (payload) => ipcRenderer.invoke('strategies:setRuleChecks', payload),
  getStrategyAnalytics: (opts) => ipcRenderer.invoke('strategies:analytics', opts),
  exportStrategy: (strategyId) => ipcRenderer.invoke('strategies:exportOne', strategyId),
  importStrategy: (json) => ipcRenderer.invoke('strategies:importOne', json),
  listMissedTrades: () => ipcRenderer.invoke('strategies:listMissed'),
  addMissedTrade: (payload) => ipcRenderer.invoke('strategies:addMissed', payload),
  deleteMissedTrade: (missedId) => ipcRenderer.invoke('strategies:deleteMissed', missedId),
  simulateMissedTrade: (missedId) => ipcRenderer.invoke('strategies:simulateMissed', missedId),
  onStrategiesChanged: (cb) => ipcOn('strategies:changed', cb),
  listReportDimensions: () => ipcRenderer.invoke('reports:listDimensions'),
  computeReport: (opts) => ipcRenderer.invoke('reports:compute', opts),
  compareReports: (opts) => ipcRenderer.invoke('reports:compare', opts),
  getWinsVsLosses: (opts) => ipcRenderer.invoke('reports:winsVsLosses', opts),
  listSavedReportFilters: () => ipcRenderer.invoke('reports:listSavedFilters'),
  saveReportFilter: (payload) => ipcRenderer.invoke('reports:saveFilter', payload),
  deleteSavedReportFilter: (id) => ipcRenderer.invoke('reports:deleteSavedFilter', id),
  listNotebookNotes: (opts) => ipcRenderer.invoke('notebook:list', opts),
  getNotebookNote: (noteId) => ipcRenderer.invoke('notebook:get', noteId),
  saveNotebookNote: (input) => ipcRenderer.invoke('notebook:save', input),
  deleteNotebookNote: (noteId) => ipcRenderer.invoke('notebook:delete', noteId),
  searchNotebook: (query) => ipcRenderer.invoke('notebook:search', query),
  listNotebookTemplates: () => ipcRenderer.invoke('notebook:listTemplates'),
  upsertDailyNote: (opts) => ipcRenderer.invoke('notebook:upsertDaily', opts),
  saveNotebookAttachment: (opts) => ipcRenderer.invoke('notebook:saveAttachment', opts),
  readNotebookAttachment: (opts) => ipcRenderer.invoke('notebook:readAttachment', opts),
  getTodayStatsBlock: () => ipcRenderer.invoke('notebook:getTodayStatsBlock'),
  getTradeReplayBundle: (tradeId) => ipcRenderer.invoke('replay:getTradeBundle', tradeId),
  getDayReplayBundle: (opts) => ipcRenderer.invoke('replay:getDayBundle', opts),
  saveReplaySnapshot: (opts) => ipcRenderer.invoke('replay:saveSnapshot', opts),
  getAiAgentsStatus: () => ipcRenderer.invoke('aiAgents:getStatus'),
  runBriefingNow: () => ipcRenderer.invoke('aiAgents:runBriefingNow'),
  runSessionReviewNow: (opts) => ipcRenderer.invoke('aiAgents:runSessionReviewNow', opts),
  autoTagHistory: () => ipcRenderer.invoke('aiAgents:autoTagHistory'),
  suggestTradeTags: (tradeId) => ipcRenderer.invoke('aiAgents:suggestTags', tradeId),
  acceptSuggestedTags: (opts) => ipcRenderer.invoke('aiAgents:acceptSuggestedTags', opts),
  listPropProfiles: () => ipcRenderer.invoke('propfirm:listProfiles'),
  savePropProfile: (input) => ipcRenderer.invoke('propfirm:saveProfile', input),
  deletePropProfile: (profileId) => ipcRenderer.invoke('propfirm:deleteProfile', profileId),
  listPropPresets: () => ipcRenderer.invoke('propfirm:listPresets'),
  evaluatePropProfile: (profileId) => ipcRenderer.invoke('propfirm:evaluate', profileId),
  evaluateAllPropProfiles: () => ipcRenderer.invoke('propfirm:evaluateAll'),
  simulateChallenge: (opts) => ipcRenderer.invoke('propfirm:simulate', opts),
  getPropRiskSensitivity: (opts) => ipcRenderer.invoke('propfirm:riskSensitivity', opts),
  exportJournalPack: (opts) => ipcRenderer.invoke('propfirm:exportPack', opts),
  importJournalPack: () => ipcRenderer.invoke('propfirm:importPack'),
  listBacktestSessions: (opts) => ipcRenderer.invoke('backtest:listSessions', opts),
  createBacktestSession: (input) => ipcRenderer.invoke('backtest:createSession', input),
  deleteBacktestSession: (payload) => ipcRenderer.invoke('backtest:deleteSession', payload),
  getBacktestBars: (query) => ipcRenderer.invoke('backtest:getBars', query),
  saveBacktestSnapshot: (payload) => ipcRenderer.invoke('backtest:saveSnapshot', payload),
  recordBacktestTrades: (payload) => ipcRenderer.invoke('backtest:recordClosedTrades', payload),
  getBacktestSessionStats: (sessionId) => ipcRenderer.invoke('backtest:sessionStats', sessionId),
  ping: () => true
});


