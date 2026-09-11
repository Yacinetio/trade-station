//+------------------------------------------------------------------+
//|                                              SignalCopierEA.mq5  |
//|                                TradeSync - Telegram Signal Copier |
//|                                         Version 1.2               |
//+------------------------------------------------------------------+
//| MQL5 Market: use MetaEditor Tools -> Options -> Compiler (or     |
//| Compiling) and set x64 target to "X64 Regular", not AVX/AVX2.   |
//| Then recompile (F7); AVX2 .ex5 uploads are rejected by Market.  |
//+------------------------------------------------------------------+
#property copyright "TradeSync"
#property version   "1.25"
#property description "Connects to TradeSync app and executes signals from Telegram"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>

enum ENUM_SYNC_LOOKBACK_UNIT {
   SYNC_LB_HOURS = 0,   // Hours
   SYNC_LB_DAYS = 1,    // Days
   SYNC_LB_MONTHS = 2,  // Months (30 calendar days each)
   SYNC_LB_ALL = 3      // All available history
};

enum ENUM_MANAGEMENT_UNIT {
   MGMT_UNIT_PIPS = 0,    // Pips
   MGMT_UNIT_PERCENT = 1, // Percent
   MGMT_UNIT_MONEY = 2,    // Money
   MGMT_UNIT_RISK_R = 3    // RR: 1 R = opening risk |entry − SL| (snapshot on first EA tick after SL is set)
};

// Input parameters
input string   ServerIP       = "127.0.0.1"; // TradeSync App IP
input int      ServerPort     = 9999;         // TradeSync App Port
input string   SharedSecret   = "";           // Shared secret (must match Settings → Connection in app; empty = no auth)
input double   DefaultLot     = 0.01;         // Default lot size
input int      Slippage       = 30;           // Max slippage (points)
input bool     UseAppLotSize  = true;         // Use lot size from app
input int      ReconnectDelay = 5000;         // Reconnect delay (ms)
input bool     EnableLogs     = true;         // Enable detailed logs
input bool     EnableStrategyTesterBridge = false; // false = no TCP/timer in tester (MQL5 Market). true = dev only (very chatty logs)
input bool     ForceMarket    = false;        // Force all orders as market orders
input int      PendingExpiry  = 0;            // Pending order expiry in hours (0=no expiry)
input ENUM_SYNC_LOOKBACK_UNIT SyncLookbackUnit = SYNC_LB_HOURS; // Default when app omits lookback fields
input int      SyncLookbackAmount = 24;       // Count for unit above (ignored for All history)
input bool     EnableTradeScreenshots = true; // Capture screenshots on entry/close events
input int      ScreenshotWidth = 1280;        // Screenshot width in pixels
input int      ScreenshotHeight = 720;        // Screenshot height in pixels
input int      PnlPushIntervalSeconds = 5;    // Interval for floating PnL/account activity updates
input int      ExcursionSampleSeconds = 30;   // Interval for sampling running P&L per position (MFE/MAE series)
input int      ManagementCheckIntervalSeconds = 1; // Interval for BE/Trailing checks
input bool     AllowAppToOverrideManagement = true; // If true: Trade Station app SETTINGS_UPDATE controls BE/trailing. If false: only EA inputs below apply.
input bool     ManageManualPositions = false; // Apply management to non-EA manual positions
input bool     SyncManualTradesToApp = false; // When true, send manual deals to app (info + screenshots like EA trades)
input bool     EnableBreakEvenMgmt = true;    // Enable break-even logic (move SL after trigger)
input ENUM_MANAGEMENT_UNIT BreakEvenUnit = MGMT_UNIT_RISK_R; // Break-even trigger/offset unit (R = |entry−SL| cached at first EA tick)
input double   BreakEvenTrigger = 1.0;        // Break-even trigger (e.g. 1 = move SL after +1R favorable move)
input double   BreakEvenOffset = 0.0;         // SL offset past entry (same unit as above; 0 = lock at entry)
input bool     EnableTrailingMgmt = false;    // Enable trailing logic
input ENUM_MANAGEMENT_UNIT TrailingUnit = MGMT_UNIT_PIPS; // Trailing unit
input double   TrailingStart = 20;            // Start trailing threshold
input double   TrailingDistance = 10;         // Trailing distance
input double   TrailingStep = 2;              // Minimum step before updating SL
input double   BreakEvenSyntheticTpRR = 2.0; // If >0: when SL missing/invalid at first capture, estimate 1R = |entry−TP|/this (e.g. 2 when TP ≈ 2R). 0 = off.

// Globals
int    socketHandle  = INVALID_HANDLE;
bool   isConnected   = false;
bool   helloSent     = false;  // track whether HELLO was confirmed
int    helloRetries  = 0;
string recvBuffer    = "";
CTrade     trade;
COrderInfo orderInfo;
CPositionInfo posInfo;

// PnL streaming throttle
datetime lastPnlPush = 0;
datetime lastManagementRun = 0;

bool   gEnableBreakEven = true;
string gBreakEvenUnit = "rr";
double gBreakEvenTrigger = 1.0;
double gBreakEvenOffset = 0.0;
bool   gEnableTrailing = false;
string gTrailingUnit = "pips";
double gTrailingStart = 20.0;
double gTrailingDistance = 10.0;
double gTrailingStep = 2.0;

// Partial close (app-driven via SETTINGS_UPDATE; off by default)
bool   gEnablePartialClose = false;
string gPartialCloseUnit = "pips";
double gPartialCloseTrigger = 0.0;
double gPartialClosePercent = 50.0;

// ── EA-side risk safety net (app-driven via SETTINGS_UPDATE) ──
// Enforced in the EA so the caps survive an app crash/disconnect: even if the
// desktop app (and all its guards) is down, queued/replayed signals cannot
// exceed these limits. 0 = individual guard off.
bool   gRiskGuardEnabled     = false;
int    gRiskMaxConcurrent    = 0;    // max open positions with our magic number
double gRiskMaxDailyLossMoney = 0.0; // account currency
double gRiskMaxDailyLossPct  = 0.0;  // % of start-of-day balance
double gRiskMaxSpreadPips    = 0.0;  // fallback spread cap when signal has none
bool   gRiskRequireStopLoss  = false;

bool   gEnableEodClose = false;
int    gEodHour = 21;
int    gEodMinute = 55;
int    gLastEodCloseYyyymmdd = 0;
ulong  gEodMarkedTickets[];

#define MAGIC_NUMBER  202401
#define MAX_HELLO_RETRY 5
#define MAX_SIGNAL_QUEUE 32

// Incoming SIGNAL lines are queued so socket reads never block behind OrderSend.
string gSignalQueue[];

// Strategy Tester fires millisecond timers very often; TCP reconnect + Print() can exceed Market log limits (~2 GB).
bool SkipTesterTcpLoop() {
   if(MQLInfoInteger(MQL_OPTIMIZATION)) return true;
   if(!MQLInfoInteger(MQL_TESTER)) return false;
   return !EnableStrategyTesterBridge;
}

// RR cache: frozen |entry − initial SL| in price units per ticket (until position closes).
struct RiskRCacheRow {
   ulong  ticket;
   double riskDistance; // absolute price distance (>0 when valid)
};
RiskRCacheRow gRiskRCache[];

int FindRiskRCacheSlot(ulong ticket) {
   for(int i = 0; i < ArraySize(gRiskRCache); i++)
      if(gRiskRCache[i].ticket == ticket) return i;
   return -1;
}

bool TryCaptureInitialRiskRDistance(ulong ticket, ENUM_POSITION_TYPE posType, double entry, double sl, double tp) {
   int ix = FindRiskRCacheSlot(ticket);
   if(ix >= 0 && gRiskRCache[ix].riskDistance > 1e-12)
      return true;

   double rd = 0;
   bool slOkBuy = (posType == POSITION_TYPE_BUY && sl > 0 && sl + 1e-12 < entry);
   bool slOkSell = (posType == POSITION_TYPE_SELL && sl > entry + 1e-12);
   if(slOkBuy)
      rd = entry - sl;
   else if(slOkSell)
      rd = sl - entry;
   else if(BreakEvenSyntheticTpRR > 1e-6 && tp > 0) {
      if(posType == POSITION_TYPE_BUY && tp > entry + 1e-12)
         rd = (tp - entry) / BreakEvenSyntheticTpRR;
      else if(posType == POSITION_TYPE_SELL && tp + 1e-12 < entry)
         rd = (entry - tp) / BreakEvenSyntheticTpRR;
   }
   if(rd <= 0)
      return false;

   if(ix < 0) {
      int n = ArraySize(gRiskRCache);
      ArrayResize(gRiskRCache, n + 1);
      ix = n;
      gRiskRCache[ix].ticket = ticket;
   }
   gRiskRCache[ix].riskDistance = rd;
   return true;
}

void PruneClosedRiskRCacheSlots() {
   for(int i = ArraySize(gRiskRCache) - 1; i >= 0; i--) {
      if(PositionSelectByTicket(gRiskRCache[i].ticket)) continue;
      int last = ArraySize(gRiskRCache) - 1;
      if(i != last)
         gRiskRCache[i] = gRiskRCache[last];
      ArrayResize(gRiskRCache, last);
   }
}

// Favorable move toward profit in chart price units (not pips).
double FavorablePriceMove(ENUM_POSITION_TYPE posType, double entryPrice, double bid, double ask) {
   if(posType == POSITION_TYPE_BUY)
      return MathMax(0.0, bid - entryPrice);
   return MathMax(0.0, entryPrice - ask);
}

double GetRiskRDistanceCached(ulong ticket, ENUM_POSITION_TYPE posType, double entry, double sl, double tp) {
   TryCaptureInitialRiskRDistance(ticket, posType, entry, sl, tp);
   int ix = FindRiskRCacheSlot(ticket);
   if(ix < 0) return 0;
   return gRiskRCache[ix].riskDistance;
}

// ── Excursion tracking (MFE/MAE + sampled running P&L) per our-magic position ──
// Same per-ticket parallel-array pattern as gRiskRCache. Peaks are price-based
// (converted to pips via GetPipSize and to money via GetUsdPerPipPerLot × volume).
#define EXC_MAX_SAMPLES 2000
#define EXC_SERIES_SEND_CAP 400

struct ExcursionRow {
   ulong    ticket;
   double   mfePips;
   double   maePips;
   double   mfeMoney;
   double   maeMoney;
   datetime lastSampleTime;
   datetime closedSince;   // first time we saw the position gone (grace before prune)
   int      sampleCount;
   long     sampleTimes[EXC_MAX_SAMPLES];
   double   samplePnl[EXC_MAX_SAMPLES];
};
ExcursionRow gExcursions[];
datetime lastExcursionRun = 0;

int FindExcursionSlot(ulong ticket) {
   for(int i = 0; i < ArraySize(gExcursions); i++)
      if(gExcursions[i].ticket == ticket) return i;
   return -1;
}

int EnsureExcursionSlot(ulong ticket) {
   int ix = FindExcursionSlot(ticket);
   if(ix >= 0) return ix;
   int n = ArraySize(gExcursions);
   ArrayResize(gExcursions, n + 1);
   gExcursions[n].ticket = ticket;
   gExcursions[n].mfePips = 0.0;
   gExcursions[n].maePips = 0.0;
   gExcursions[n].mfeMoney = 0.0;
   gExcursions[n].maeMoney = 0.0;
   gExcursions[n].lastSampleTime = 0;
   gExcursions[n].closedSince = 0;
   gExcursions[n].sampleCount = 0;
   return n;
}

void RemoveExcursionSlot(ulong ticket) {
   int ix = FindExcursionSlot(ticket);
   if(ix < 0) return;
   int last = ArraySize(gExcursions) - 1;
   if(ix != last)
      gExcursions[ix] = gExcursions[last];
   ArrayResize(gExcursions, last);
}

// Prune rows whose position is gone AND whose close ACK never flushed them.
// 120s grace: OnTradeTransaction (which flushes + removes) may run after OnTimer.
void PruneStaleExcursionSlots() {
   for(int i = ArraySize(gExcursions) - 1; i >= 0; i--) {
      if(PositionSelectByTicket(gExcursions[i].ticket)) {
         gExcursions[i].closedSince = 0;
         continue;
      }
      if(gExcursions[i].closedSince == 0) {
         gExcursions[i].closedSince = TimeCurrent();
         continue;
      }
      if(TimeCurrent() - gExcursions[i].closedSince < 120) continue;
      int last = ArraySize(gExcursions) - 1;
      if(i != last)
         gExcursions[i] = gExcursions[last];
      ArrayResize(gExcursions, last);
   }
}

void UpdateExcursionTracking() {
   PruneStaleExcursionSlots();
   int total = PositionsTotal();
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      if(magic != MAGIC_NUMBER) continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double volume = PositionGetDouble(POSITION_VOLUME);
      double profitMoney = PositionGetDouble(POSITION_PROFIT);
      double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
      if(entry <= 0 || bid <= 0 || ask <= 0) continue;

      double pip = GetPipSize(symbol);
      if(pip <= 0) continue;

      // P&L follows the closing side: BUY exits at bid, SELL exits at ask.
      double closePx = (posType == POSITION_TYPE_BUY) ? bid : ask;
      double favorPips = (posType == POSITION_TYPE_BUY) ? (closePx - entry) / pip
                                                        : (entry - closePx) / pip;
      double usdPerPipPerLot = GetUsdPerPipPerLot(symbol);

      int ix = EnsureExcursionSlot(ticket);
      if(favorPips > gExcursions[ix].mfePips) {
         gExcursions[ix].mfePips = favorPips;
         gExcursions[ix].mfeMoney = favorPips * usdPerPipPerLot * volume;
      }
      double adversePips = -favorPips;
      if(adversePips > gExcursions[ix].maePips) {
         gExcursions[ix].maePips = adversePips;
         gExcursions[ix].maeMoney = adversePips * usdPerPipPerLot * volume;
      }

      int sampleInterval = MathMax(1, ExcursionSampleSeconds);
      if(gExcursions[ix].sampleCount < EXC_MAX_SAMPLES &&
         (gExcursions[ix].lastSampleTime == 0 ||
          TimeCurrent() - gExcursions[ix].lastSampleTime >= sampleInterval)) {
         int n = gExcursions[ix].sampleCount;
         gExcursions[ix].sampleTimes[n] = (long)TimeCurrent();
         gExcursions[ix].samplePnl[n] = profitMoney;
         gExcursions[ix].sampleCount = n + 1;
         gExcursions[ix].lastSampleTime = TimeCurrent();
      }
   }
}

// JSON fragment starting with "," (empty when the ticket has no excursion data).
// includeSeries downsamples the sampled running P&L to <= EXC_SERIES_SEND_CAP
// [unixSec,pnl] pairs (always keeping the final sample) so the line stays small.
string BuildExcursionJson(ulong positionId, bool includeSeries) {
   int ix = FindExcursionSlot(positionId);
   if(ix < 0) return "";
   string json = ",\"mfePips\":" + DoubleToString(gExcursions[ix].mfePips, 1)
               + ",\"maePips\":" + DoubleToString(gExcursions[ix].maePips, 1)
               + ",\"mfeMoney\":" + DoubleToString(gExcursions[ix].mfeMoney, 2)
               + ",\"maeMoney\":" + DoubleToString(gExcursions[ix].maeMoney, 2);
   if(includeSeries && gExcursions[ix].sampleCount > 0) {
      int count = gExcursions[ix].sampleCount;
      int stride = 1;
      if(count > EXC_SERIES_SEND_CAP)
         stride = (int)MathCeil((double)count / (double)EXC_SERIES_SEND_CAP);
      string series = "";
      for(int i = 0; i < count; i += stride) {
         if(StringLen(series) > 0) series += ",";
         series += "[" + IntegerToString(gExcursions[ix].sampleTimes[i]) + ","
                 + DoubleToString(gExcursions[ix].samplePnl[i], 2) + "]";
      }
      if(stride > 1 && ((count - 1) % stride) != 0) {
         series += ",[" + IntegerToString(gExcursions[ix].sampleTimes[count - 1]) + ","
                 + DoubleToString(gExcursions[ix].samplePnl[count - 1], 2) + "]";
      }
      json += ",\"pnlSeries\":[" + series + "]";
   }
   return json;
}

//+------------------------------------------------------------------+
int OnInit() {
   trade.SetExpertMagicNumber(MAGIC_NUMBER);
   trade.SetDeviationInPoints(Slippage);
   trade.SetAsyncMode(true); // Non-blocking OrderSend — keeps timer + signal queue responsive on network loss
   LoadManagementDefaultsFromInputs();

   // Auto-detect the filling mode supported by the broker for this symbol
   ENUM_ORDER_TYPE_FILLING filling = GetSupportedFilling(_Symbol);
   trade.SetTypeFilling(filling);
   Print("[TradeSync EA] Using filling mode: ", EnumToString(filling));

   if(SkipTesterTcpLoop()) {
      Print("[TradeSync EA] Strategy Tester: TCP bridge idle. Enable EnableStrategyTesterBridge to exercise sockets (verbose).");
      return INIT_SUCCEEDED;
   }

   Print("[TradeSync EA] v1.25 Starting... Connecting to ", ServerIP, ":", ServerPort);
   Print("[TradeSync EA] Account: ", AccountInfoString(ACCOUNT_NAME),
         " | Login: ", AccountInfoInteger(ACCOUNT_LOGIN),
         " | Server: ", AccountInfoString(ACCOUNT_SERVER),
         " | TradeAllowed: ", (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED),
         " | TerminalTrade: ", (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED),
         " | Mode: ", AccountInfoInteger(ACCOUNT_TRADE_MODE));  // 0=real 1=demo 2=contest
   ConnectToServer();
   EventSetMillisecondTimer(500);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
// Detect the filling type the broker supports for this symbol
ENUM_ORDER_TYPE_FILLING GetSupportedFilling(string sym) {
   // Use execution mode to determine the right filling policy
   ENUM_SYMBOL_TRADE_EXECUTION execMode =
      (ENUM_SYMBOL_TRADE_EXECUTION)SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);

   // Exchange / instant execution brokers → FOK
   if(execMode == SYMBOL_TRADE_EXECUTION_EXCHANGE ||
      execMode == SYMBOL_TRADE_EXECUTION_INSTANT)
      return ORDER_FILLING_FOK;

   // Request / market execution brokers → RETURN (most ECN/STP brokers)
   return ORDER_FILLING_RETURN;
}

string ToLowerCopy(string value) {
   string out = value;
   StringTrimLeft(out);
   StringTrimRight(out);
   StringToLower(out);
   return out;
}

string NormalizeManagementUnit(string value) {
   string unit = ToLowerCopy(value);
   if(unit == "percent" || unit == "%") return "percent";
   if(unit == "money" || unit == "dollar" || unit == "dollars" || unit == "$") return "money";
   if(unit == "rr" || unit == "r" || unit == "1r" || unit == "risk" || unit == "risk_r" ||
      unit == "1rr") return "rr";
   return "pips";
}

string ManagementUnitToString(ENUM_MANAGEMENT_UNIT unit) {
   if(unit == MGMT_UNIT_PERCENT) return "percent";
   if(unit == MGMT_UNIT_MONEY) return "money";
   if(unit == MGMT_UNIT_RISK_R) return "rr";
   return "pips";
}

void LoadManagementDefaultsFromInputs() {
   gEnableBreakEven = EnableBreakEvenMgmt;
   gBreakEvenUnit = ManagementUnitToString(BreakEvenUnit);
   gBreakEvenTrigger = MathMax(0.0, BreakEvenTrigger);
   gBreakEvenOffset = MathMax(0.0, BreakEvenOffset);

   gEnableTrailing = EnableTrailingMgmt;
   gTrailingUnit = ManagementUnitToString(TrailingUnit);
   gTrailingStart = MathMax(0.0, TrailingStart);
   gTrailingDistance = MathMax(0.0, TrailingDistance);
   gTrailingStep = MathMax(0.0, TrailingStep);
}

double GetPipSize(string symbol) {
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0) return 0.0001;
   if(digits == 3 || digits == 5) return point * 10.0;
   return point;
}

double ProfitPips(string symbol, ENUM_POSITION_TYPE posType, double entryPrice, double bid, double ask) {
   double pip = GetPipSize(symbol);
   if(pip <= 0) return 0;
   if(posType == POSITION_TYPE_BUY) return (bid - entryPrice) / pip;
   return (entryPrice - ask) / pip;
}

double GetDistanceFromMoney(string symbol, double money, double volume) {
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickValue <= 0 || volume <= 0 || money <= 0) return 0;
   double valuePerPriceUnit = (tickValue / tickSize) * volume;
   if(valuePerPriceUnit <= 0) return 0;
   return money / valuePerPriceUnit;
}

double UnitValueToPriceDistance(string symbol, string unit, double value, double referencePrice, double volume) {
   if(value <= 0) return 0;
   if(unit == "rr") return 0;
   if(unit == "percent") return MathAbs(referencePrice) * (value / 100.0);
   if(unit == "money") return GetDistanceFromMoney(symbol, value, volume);
   return value * GetPipSize(symbol);
}

double ProfitMetricByUnit(string unit, double profitMoney, double profitPips) {
   if(unit == "money") return profitMoney;
   if(unit == "percent") {
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      if(bal <= 0) return 0;
      return (profitMoney / bal) * 100.0;
   }
   return profitPips;
}

// Current Ask−Bid spread expressed in pips (same pip convention as GetPipSize).
// USD (deposit currency) P&L per 1.00 standard lot for a one-pip move — same as OB_STATS CalcLotSize.
double GetUsdPerPipPerLot(string symbol) {
   double pip = GetPipSize(symbol);
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if(pip <= 0 || tickSize <= 0 || tickValue <= 0) return 0;
   return (pip / tickSize) * tickValue;
}

double GetCurrentSpreadPips(string symbol) {
   double pip = GetPipSize(symbol);
   if(pip <= 0) return 0;
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   if(ask > 0 && bid > 0 && ask >= bid)
      return (ask - bid) / pip;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   long spreadPoints = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   if(point > 0 && spreadPoints > 0)
      return ((double)spreadPoints * point) / pip;
   return 0;
}

// Round a lot down to the symbol volume step.
double FloorLotToStep(double lotValue, double volStep) {
   if(volStep <= 0) return lotValue;
   return NormalizeDouble(MathFloor(lotValue / volStep + 1e-9) * volStep, 8);
}

// Split totalLot across up to tpCount orders (one per TP level).
// sharesPct: optional percentage weights (only used when shareCount == tpCount,
// e.g. [50,30,20]); otherwise equal split. Slices are floored to the volume
// step, the rounding remainder goes to the FIRST slice, and the order count is
// reduced when slices would fall below the broker minimum lot.
// Returns the number of usable orders and fills slicesOut accordingly.
int BuildTpLotSlices(string symbol, double totalLot, int tpCount,
                     double &sharesPct[], int shareCount, double &slicesOut[]) {
   double volStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double volMin  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   if(volStep <= 0) volStep = 0.01;
   if(volMin  <= 0) volMin  = volStep;

   for(int n = tpCount; n >= 2; n--) {
      bool useShares = (shareCount == tpCount && n == tpCount);
      double shareSum = 0;
      if(useShares)
         for(int s = 0; s < n; s++) shareSum += sharesPct[s];

      ArrayResize(slicesOut, n);
      double assigned = 0;
      bool ok = true;
      for(int i = 0; i < n; i++) {
         double frac = (useShares && shareSum > 0) ? sharesPct[i] / shareSum : 1.0 / n;
         double sliceLot = FloorLotToStep(totalLot * frac, volStep);
         if(sliceLot < volMin - 1e-9) { ok = false; break; }
         slicesOut[i] = sliceLot;
         assigned += sliceLot;
      }
      if(!ok) continue;

      double rem = totalLot - assigned;
      double remRounded = NormalizeDouble(MathFloor(rem / volStep + 0.5) * volStep, 8);
      if(remRounded > 0)
         slicesOut[0] = NormalizeDouble(slicesOut[0] + remRounded, 8);
      return n;
   }

   ArrayResize(slicesOut, 1);
   slicesOut[0] = totalLot;
   return 1;
}

// Partial-close once-per-position state. Persisted as terminal GlobalVariables
// so an EA restart cannot re-fire a partial close on the same position.
string PartialCloseGvName(ulong ticket) {
   return "TSEA_PC_DONE_" + IntegerToString((long)ticket);
}

bool PartialCloseAlreadyDone(ulong ticket) {
   return GlobalVariableCheck(PartialCloseGvName(ticket));
}

void PartialCloseMarkDone(ulong ticket) {
   GlobalVariableSet(PartialCloseGvName(ticket), 1.0);
}

void PartialCloseUnmark(ulong ticket) {
   GlobalVariableDel(PartialCloseGvName(ticket));
}

void PruneClosedPartialCloseMarks() {
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--) {
      string gvName = GlobalVariableName(i);
      if(StringFind(gvName, "TSEA_PC_DONE_") != 0) continue;
      ulong t = (ulong)StringToInteger(StringSubstr(gvName, StringLen("TSEA_PC_DONE_")));
      if(t == 0 || !PositionSelectByTicket(t))
         GlobalVariableDel(gvName);
   }
}

double ClampSlByStopLevel(string symbol, ENUM_POSITION_TYPE posType, double candidateSl, double bid, double ask) {
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   long stopLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (stopLevel + 2) * point;

   if(posType == POSITION_TYPE_BUY) {
      double maxSl = NormalizeDouble(bid - minDist, digits);
      if(candidateSl > maxSl) candidateSl = maxSl;
   } else {
      double minSl = NormalizeDouble(ask + minDist, digits);
      if(candidateSl < minSl) candidateSl = minSl;
   }
   return NormalizeDouble(candidateSl, digits);
}

bool ModifyPositionStops(ulong ticket, string symbol, double sl, double tp) {
   MqlTradeRequest req;
   MqlTradeResult  res;
   ZeroMemory(req);
   ZeroMemory(res);
   req.action = TRADE_ACTION_SLTP;
   req.position = ticket;
   req.symbol = symbol;
   req.sl = sl;
   req.tp = tp;
   // Use position magic so manual legs and other EAs can be modified when ManageManualPositions is on.
   if(PositionSelectByTicket(ticket))
      req.magic = (long)PositionGetInteger(POSITION_MAGIC);
   else
      req.magic = MAGIC_NUMBER;
   if(!OrderSend(req, res)) {
      Print("[TradeSync EA] PositionModify send failed ticket=", (long)ticket, " err=", GetLastError());
      return false;
   }
   if(res.retcode != TRADE_RETCODE_DONE) {
      Print("[TradeSync EA] PositionModify rejected ticket=", (long)ticket, " ret=", res.retcode);
      return false;
   }
   return true;
}

/// After MARKET execution: TP was computed from app entry, but fill is Ask/Bid — pip distance to TP
/// is shorter than RR × risk from fill. Re-set TP from POSITION_PRICE_OPEN so reward:risk matches rrRatio.
bool SnapTpToRiskRewardFromFill(ulong positionTicket, string symbol, double rrRatio) {
   if(positionTicket == 0 || rrRatio <= 1e-12)
      return false;
   if(!PositionSelectByTicket(positionTicket))
      return false;
   if(PositionGetString(POSITION_SYMBOL) != symbol)
      return false;

   double openPx = PositionGetDouble(POSITION_PRICE_OPEN);
   double posSl  = PositionGetDouble(POSITION_SL);
   ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   if(openPx <= 0 || posSl <= 0)
      return false;

   double dist = MathAbs(openPx - posSl);
   if(dist < 1e-12)
      return false;

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double newTp = (pt == POSITION_TYPE_BUY)
                  ? NormalizeDouble(openPx + dist * rrRatio, digits)
                  : NormalizeDouble(openPx - dist * rrRatio, digits);

   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   long stopLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (stopLevel + 2) * point;

   if(pt == POSITION_TYPE_BUY) {
      double minTP = NormalizeDouble(ask + minDist, digits);
      if(newTp <= ask) {
         Print("[TradeSync EA] ⚠ rrSnapTpToFill: computed TP not above Ask — skip snap");
         return false;
      }
      if(newTp < minTP) {
         Print("[TradeSync EA] rrSnapTpToFill: TP lifted to broker min distance → ", minTP);
         newTp = minTP;
      }
   } else {
      double maxTP = NormalizeDouble(bid - minDist, digits);
      if(newTp >= bid) {
         Print("[TradeSync EA] ⚠ rrSnapTpToFill: computed TP not below Bid — skip snap");
         return false;
      }
      if(newTp > maxTP) {
         Print("[TradeSync EA] rrSnapTpToFill: TP lowered to broker min distance → ", maxTP);
         newTp = maxTP;
      }
   }

   double curTp = PositionGetDouble(POSITION_TP);
   if(MathAbs(curTp - newTp) < point * 0.25)
      return true;

   if(ModifyPositionStops(positionTicket, symbol, posSl, newTp)) {
      Print("[TradeSync EA] rrSnapTpToFill: TP ", DoubleToString(curTp, digits), " → ",
            DoubleToString(newTp, digits), " (open=", DoubleToString(openPx, digits),
            " SL=", DoubleToString(posSl, digits), " RR=", DoubleToString(rrRatio, 2), ")");
      return true;
   }
   return false;
}

void ApplyPositionManagement() {
   if(!gEnableBreakEven && !gEnableTrailing && !gEnablePartialClose) return;

   PruneClosedRiskRCacheSlots();
   PruneClosedPartialCloseMarks();

   int total = PositionsTotal();
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      if(!ManageManualPositions && magic != MAGIC_NUMBER) continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double volume = PositionGetDouble(POSITION_VOLUME);
      double profitMoney = PositionGetDouble(POSITION_PROFIT);
      double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
      double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
      if(point <= 0) point = 0.00001;

      double pips = ProfitPips(symbol, posType, entry, bid, ask);

      double riskRDistance = GetRiskRDistanceCached(ticket, posType, entry, sl, tp);

      // Partial close (once per position, before BE so a post-PC BE move uses fresh SL state)
      if(gEnablePartialClose && gPartialCloseTrigger > 0 && gPartialClosePercent > 0 &&
         !PartialCloseAlreadyDone(ticket)) {
         double metricPc = 0;
         if(gPartialCloseUnit == "rr") {
            if(riskRDistance > 0)
               metricPc = FavorablePriceMove(posType, entry, bid, ask) / riskRDistance;
         } else {
            metricPc = ProfitMetricByUnit(gPartialCloseUnit, profitMoney, pips);
         }
         if(metricPc >= gPartialCloseTrigger) {
            double volStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
            double volMin  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
            if(volStep <= 0) volStep = 0.01;
            if(volMin  <= 0) volMin  = volStep;
            double closeVol  = FloorLotToStep(volume * gPartialClosePercent / 100.0, volStep);
            double remainVol = NormalizeDouble(volume - closeVol, 8);
            if(closeVol < volMin - 1e-9 || (remainVol > 1e-9 && remainVol < volMin - 1e-9)) {
               // Cannot split without breaking broker volume limits — never close, never retry.
               PartialCloseMarkDone(ticket);
               Print("[TradeSync EA] ⚠ Partial close skipped for ticket=", (long)ticket,
                     " vol=", DoubleToString(volume, 2), ": close ", DoubleToString(closeVol, 2),
                     " / remainder ", DoubleToString(remainVol, 2), " below min lot ", DoubleToString(volMin, 2));
            } else {
               PartialCloseMarkDone(ticket); // mark first — async mode must not double-fire
               ResetLastError();
               if(trade.PositionClosePartial(ticket, closeVol)) {
                  double closePx = (posType == POSITION_TYPE_BUY) ? bid : ask;
                  double closedProfit = (volume > 0) ? profitMoney * (closeVol / volume) : 0;
                  Print("[TradeSync EA] ✂ Partial close ticket=", (long)ticket, " ", symbol,
                        " closed ", DoubleToString(closeVol, 2), " of ", DoubleToString(volume, 2),
                        " @", DoubleToString(closePx, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)),
                        " (trigger ", DoubleToString(gPartialCloseTrigger, 2), " ", gPartialCloseUnit, ")");
                  SendPartialCloseUpdate(symbol, (posType == POSITION_TYPE_BUY) ? "BUY" : "SELL",
                                         ticket, closeVol, remainVol, closePx, closedProfit);
                  volume = remainVol; // keep later unit conversions on this pass consistent
               } else {
                  PartialCloseUnmark(ticket);
                  Print("[TradeSync EA] ❌ Partial close failed ticket=", (long)ticket, " err=", GetLastError(),
                        " ret=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
               }
            }
         }
      }

      // Break-even management
      if(gEnableBreakEven) {
         double metric = 0;
         if(gBreakEvenUnit == "rr") {
            if(riskRDistance > 0)
               metric = FavorablePriceMove(posType, entry, bid, ask) / riskRDistance;
         } else {
            metric = ProfitMetricByUnit(gBreakEvenUnit, profitMoney, pips);
         }
         if(metric >= gBreakEvenTrigger) {
            double offset = UnitValueToPriceDistance(symbol, gBreakEvenUnit, gBreakEvenOffset, entry, volume);
            if(gBreakEvenUnit == "rr" && riskRDistance > 0)
               offset = gBreakEvenOffset * riskRDistance;
            double target = (posType == POSITION_TYPE_BUY) ? (entry + offset) : (entry - offset);
            target = ClampSlByStopLevel(symbol, posType, target, bid, ask);

            bool shouldMove = false;
            if(posType == POSITION_TYPE_BUY) {
               if(sl <= 0 || target > sl + point * 0.5) shouldMove = true;
            } else {
               if(sl <= 0 || target < sl - point * 0.5) shouldMove = true;
            }

            if(shouldMove && ModifyPositionStops(ticket, symbol, target, tp)) {
               Print("[TradeSync EA] BE moved SL for ", symbol, " ticket=", (long)ticket, " -> ", DoubleToString(target, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)));
               sl = target;
            }
         }
      }

      // Trailing management
      if(gEnableTrailing) {
         double metricTr = 0;
         if(gTrailingUnit == "rr") {
            if(riskRDistance > 0)
               metricTr = FavorablePriceMove(posType, entry, bid, ask) / riskRDistance;
         } else {
            metricTr = ProfitMetricByUnit(gTrailingUnit, profitMoney, pips);
         }
         if(metricTr >= gTrailingStart) {
            double refPrice = (posType == POSITION_TYPE_BUY) ? bid : ask;
            double dist = UnitValueToPriceDistance(symbol, gTrailingUnit, gTrailingDistance, refPrice, volume);
            double step = UnitValueToPriceDistance(symbol, gTrailingUnit, gTrailingStep, refPrice, volume);
            if(gTrailingUnit == "rr" && riskRDistance > 0) {
               dist = gTrailingDistance * riskRDistance;
               step = gTrailingStep * riskRDistance;
            }
            if(step <= 0) step = point;
            if(dist > 0) {
               double target = (posType == POSITION_TYPE_BUY) ? (bid - dist) : (ask + dist);
               target = ClampSlByStopLevel(symbol, posType, target, bid, ask);

               bool shouldMove = false;
               if(posType == POSITION_TYPE_BUY) {
                  if(sl <= 0 || (target - sl) >= step) shouldMove = true;
               } else {
                  if(sl <= 0 || (sl - target) >= step) shouldMove = true;
               }

               if(shouldMove && ModifyPositionStops(ticket, symbol, target, tp)) {
                  Print("[TradeSync EA] Trailing moved SL for ", symbol, " ticket=", (long)ticket, " -> ", DoubleToString(target, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)));
               }
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
string JsonEscape(string value) {
   string out = value;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}

long FindChartBySymbol(string symbol) {
   long chartId = ChartFirst();
   while(chartId >= 0) {
      if(ChartSymbol(chartId) == symbol)
         return chartId;
      chartId = ChartNext(chartId);
   }
   return -1;
}

string MonthName(int month) {
   switch(month) {
      case 1:  return "January";
      case 2:  return "February";
      case 3:  return "March";
      case 4:  return "April";
      case 5:  return "May";
      case 6:  return "June";
      case 7:  return "July";
      case 8:  return "August";
      case 9:  return "September";
      case 10: return "October";
      case 11: return "November";
      case 12: return "December";
      default: return "Unknown";
   }
}

string Pad2(int value) {
   if(value < 10) return "0" + IntegerToString(value);
   return IntegerToString(value);
}

string TimeframeToLabel(ENUM_TIMEFRAMES tf) {
   switch(tf) {
      case PERIOD_M1:  return "M1";
      case PERIOD_M2:  return "M2";
      case PERIOD_M3:  return "M3";
      case PERIOD_M4:  return "M4";
      case PERIOD_M5:  return "M5";
      case PERIOD_M6:  return "M6";
      case PERIOD_M10: return "M10";
      case PERIOD_M12: return "M12";
      case PERIOD_M15: return "M15";
      case PERIOD_M20: return "M20";
      case PERIOD_M30: return "M30";
      case PERIOD_H1:  return "H1";
      case PERIOD_H2:  return "H2";
      case PERIOD_H3:  return "H3";
      case PERIOD_H4:  return "H4";
      case PERIOD_H6:  return "H6";
      case PERIOD_H8:  return "H8";
      case PERIOD_H12: return "H12";
      case PERIOD_D1:  return "D1";
      case PERIOD_W1:  return "W1";
      case PERIOD_MN1: return "MN1";
      default:         return "TF";
   }
}

string SanitizeToken(string value, int maxLen = 14) {
   string out = value;
   StringReplace(out, " ", "");
   StringReplace(out, ".", "");
   StringReplace(out, "/", "");
   StringReplace(out, "\\", "");
   StringReplace(out, ":", "");
   StringReplace(out, "*", "");
   StringReplace(out, "?", "");
   StringReplace(out, "\"", "");
   StringReplace(out, "<", "");
   StringReplace(out, ">", "");
   StringReplace(out, "|", "");
   if(StringLen(out) > maxLen) out = StringSubstr(out, 0, maxLen);
   return out;
}

bool EnsureScreenshotFolders(string &relativeFolder) {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);

   string monthFolder = MonthName(dt.mon) + "-" + IntegerToString(dt.year);
   string dayFolder = IntegerToString(dt.day);
   string baseFolder = "TradeScreenshots";

   if(!FolderCreate(baseFolder) && GetLastError() != 5019) return false;
   string monthPath = baseFolder + "\\" + monthFolder;
   if(!FolderCreate(monthPath) && GetLastError() != 5019) return false;
   string dayPath = monthPath + "\\" + dayFolder;
   if(!FolderCreate(dayPath) && GetLastError() != 5019) return false;

   relativeFolder = dayPath;
   return true;
}

string BuildScreenshotFileName(string stage, string symbol, ENUM_TIMEFRAMES tf) {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   string timePart = Pad2(dt.hour) + Pad2(dt.min) + Pad2(dt.sec);
   string msPart = Pad2((int)(GetTickCount() % 100));
   string safeStage = SanitizeToken(stage, 12);
   string safeSymbol = SanitizeToken(symbol, 12);
   string safeTf = SanitizeToken(TimeframeToLabel(tf), 5);

   string fileName = safeSymbol + "-" + safeTf + "-" + safeStage + "-" + timePart + msPart + ".png";
   if(StringLen(fileName) > 63)
      fileName = StringSubstr(fileName, 0, 59) + ".png";
   return fileName;
}

bool CaptureTradeScreenshot(string stage, string symbol, ulong positionId, ulong dealId, string &fileName, string &fullPath) {
   fileName = "";
   fullPath = "";
   if(!EnableTradeScreenshots) return false;

   long chartId = FindChartBySymbol(symbol);
   bool tempChart = false;
   long currentChart = ChartID();

   if(chartId < 0) {
      chartId = ChartOpen(symbol, PERIOD_M5);
      if(chartId > 0) tempChart = true;
   }
   if(chartId <= 0) chartId = currentChart;

   if(tempChart) Sleep(600);
   else Sleep(150);

   string folder = "";
   if(!EnsureScreenshotFolders(folder)) {
      Print("[TradeSync EA] Failed to create screenshot folders");
      if(tempChart && chartId > 0) ChartClose(chartId);
      return false;
   }

   ENUM_TIMEFRAMES tf = (ENUM_TIMEFRAMES)ChartPeriod(chartId);
   fileName = BuildScreenshotFileName(stage, symbol, tf);
   string relativeFile = folder + "\\" + fileName;
   int width = ScreenshotWidth > 0 ? ScreenshotWidth : 1280;
   int height = ScreenshotHeight > 0 ? ScreenshotHeight : 720;

   bool ok = ChartScreenShot(chartId, relativeFile, width, height, ALIGN_RIGHT);
   fullPath = TerminalInfoString(TERMINAL_DATA_PATH) + "\\MQL5\\Files\\" + relativeFile;

   if(tempChart && chartId > 0)
      ChartClose(chartId);

   if(!ok) {
      Print("[TradeSync EA] Screenshot failed for ", stage, " ", symbol, " (", relativeFile, ")");
      return false;
   }
   Print("[TradeSync EA] Screenshot captured: ", relativeFile);
   return true;
}

string BuildScreenshotJson(string stage, string symbol, string fileName, string fullPath) {
   if(StringLen(fileName) == 0 || StringLen(fullPath) == 0) return "";
   return ",\"screenshot\":{\"stage\":\"" + JsonEscape(stage)
        + "\",\"symbol\":\"" + JsonEscape(symbol)
        + "\",\"file\":\"" + JsonEscape(fileName)
        + "\",\"path\":\"" + JsonEscape(fullPath)
        + "\",\"capturedAt\":\"" + TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS)
        + "\"}";
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
   EventKillTimer();
   if(socketHandle != INVALID_HANDLE) {
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
   }
   Print("[TradeSync EA] Stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
void OnTimer() {
   if(SkipTesterTcpLoop())
      return;

   // ── 1. Check if socket dropped externally ──
   if(isConnected && socketHandle != INVALID_HANDLE) {
      if(!SocketIsConnected(socketHandle)) {
         Print("[TradeSync EA] Connection lost. Reconnecting...");
         isConnected  = false;
         helloSent    = false;
         helloRetries = 0;
         SocketClose(socketHandle);
         socketHandle = INVALID_HANDLE;
      }
   }

   if(!isConnected) {
      ConnectToServer();
      if(TimeCurrent() - lastExcursionRun >= 1) {
         UpdateExcursionTracking();
         lastExcursionRun = TimeCurrent();
      }
      int mgmtInterval = MathMax(1, ManagementCheckIntervalSeconds);
      if(TimeCurrent() - lastManagementRun >= mgmtInterval) {
         ApplyPositionManagement();
         lastManagementRun = TimeCurrent();
      }
      MaybeTriggerScheduledEndOfDayClose();
      return;
   }

   // ── 2. ALWAYS read incoming data first (so HELLO_ACK / PING are processed) ──
   uint bytesAvail = SocketIsReadable(socketHandle);
   if(bytesAvail > 0) {
      uchar buf[];
      int bytesRead = SocketRead(socketHandle, buf, bytesAvail, 100);
      if(bytesRead > 0) {
         recvBuffer += CharArrayToString(buf, 0, bytesRead, CP_UTF8);
         ProcessBuffer();   // may set helloSent = true via HELLO_ACK
      } else if(bytesRead < 0) {
         Print("[TradeSync EA] Read error. Reconnecting...");
         isConnected  = false;
         helloSent    = false;
         helloRetries = 0;
         SocketClose(socketHandle);
         socketHandle = INVALID_HANDLE;
         ArrayResize(gSignalQueue, 0);
         return;
      }
   }

   // Process queued signals after all socket lines are parsed (never inside ProcessBuffer).
   DrainSignalQueue();

   // ── 3. Send HELLO if handshake not yet confirmed ──
   if(!helloSent) {
      if(helloRetries < MAX_HELLO_RETRY) {
         helloRetries++;
         string hello = "{\"type\":\"HELLO\",\"ea\":\"SignalCopierEA\",\"version\":\"1.3\""
                        + ",\"account\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
                        + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
                        + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
                        + (StringLen(SharedSecret) > 0 ? ",\"secret\":\"" + SharedSecret + "\"" : "")
                        + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\"}\n";
         if(SendMessage(hello)) {
            Print("[TradeSync EA] HELLO sent (attempt ", helloRetries, ")");
         } else {
            Print("[TradeSync EA] HELLO attempt ", helloRetries, " failed");
         }
      } else {
         Print("[TradeSync EA] Max HELLO retries (", MAX_HELLO_RETRY, ") reached. Reconnecting...");
         isConnected  = false;
         helloSent    = false;
         helloRetries = 0;
         SocketClose(socketHandle);
         socketHandle = INVALID_HANDLE;
      }
   }

   // ── 4. Push current floating PnL periodically ──
   int pnlInterval = MathMax(1, PnlPushIntervalSeconds);
   if(helloSent && (TimeCurrent() - lastPnlPush >= pnlInterval)) {
      BroadcastOpenPositionsPnL();
      lastPnlPush = TimeCurrent();
   }

   if(TimeCurrent() - lastExcursionRun >= 1) {
      UpdateExcursionTracking();
      lastExcursionRun = TimeCurrent();
   }

   int mgmtInterval = MathMax(1, ManagementCheckIntervalSeconds);
   if(TimeCurrent() - lastManagementRun >= mgmtInterval) {
      ApplyPositionManagement();
      lastManagementRun = TimeCurrent();
   }
   MaybeTriggerScheduledEndOfDayClose();
}

//+------------------------------------------------------------------+
void ConnectToServer() {
   // Always close any existing socket first
   if(socketHandle != INVALID_HANDLE) {
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
   }
   isConnected  = false;
   helloSent    = false;
   helloRetries = 0;

   socketHandle = SocketCreate();
   if(socketHandle == INVALID_HANDLE) {
      if(EnableLogs) Print("[TradeSync EA] Failed to create socket.");
      return;
   }
   if(SocketConnect(socketHandle, ServerIP, ServerPort, 3000)) {
      isConnected = true;
      Print("[TradeSync EA] ✅ Connected to TradeSync app on port ", ServerPort);
      // HELLO will be sent by OnTimer on next tick (avoids race condition)
   } else {
      if(EnableLogs) Print("[TradeSync EA] Connection failed. Retry in ", ReconnectDelay/1000, "s");
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
      Sleep(ReconnectDelay);
   }
}

//+------------------------------------------------------------------+
void ProcessBuffer() {
   int newlinePos;
   while((newlinePos = StringFind(recvBuffer, "\n")) >= 0) {
      string line = StringSubstr(recvBuffer, 0, newlinePos);
      recvBuffer  = StringSubstr(recvBuffer, newlinePos + 1);
      StringTrimRight(line);
      StringTrimLeft(line);
      if(StringLen(line) > 0) ProcessMessage(line);
   }
}

//+------------------------------------------------------------------+
void SortRatesByTimeAscending(MqlRates &rates[]) {
   int n = ArraySize(rates);
   for(int i = 0; i < n - 1; i++) {
      for(int j = i + 1; j < n; j++) {
         if(rates[j].time < rates[i].time) {
            MqlRates tmp = rates[i];
            rates[i] = rates[j];
            rates[j] = tmp;
         }
      }
   }
}

ENUM_TIMEFRAMES TfFromMinutes(int minutes) {
   if(minutes <= 1) return PERIOD_M1;
   if(minutes <= 5) return PERIOD_M5;
   if(minutes <= 15) return PERIOD_M15;
   if(minutes <= 30) return PERIOD_M30;
   if(minutes <= 60) return PERIOD_H1;
   if(minutes <= 240) return PERIOD_H4;
   return PERIOD_D1;
}

void ProcessHistoryRequest(string jsonStr) {
   string reqId = ExtractJsonString(jsonStr, "reqId");
   string symbol = ExtractJsonString(jsonStr, "symbol");
   long fromUnix = (long)ExtractJsonDouble(jsonStr, "from");
   long toUnix = (long)ExtractJsonDouble(jsonStr, "to");
   int tfMin = (int)ExtractJsonDouble(jsonStr, "timeframeMinutes");
   if(StringLen(reqId) < 4 || StringLen(symbol) < 2) {
      SendMessage("{\"type\":\"HISTORY_REPLY\",\"success\":false,\"error\":\"BAD_REQUEST\",\"reqId\":\"" + JsonEscape(reqId) + "\",\"bars\":[]}\n");
      return;
   }
   ENUM_TIMEFRAMES tf = TfFromMinutes(tfMin);
   if(!SymbolSelect(symbol, true)) {
      SendMessage("{\"type\":\"HISTORY_REPLY\",\"success\":false,\"error\":\"SYMBOL_NOT_FOUND\",\"reqId\":\"" + JsonEscape(reqId) + "\",\"bars\":[]}\n");
      return;
   }
   datetime tFrom = (datetime)fromUnix;
   datetime tTo = (datetime)toUnix;
   if((long)tTo <= (long)tFrom) {
      SendMessage("{\"type\":\"HISTORY_REPLY\",\"success\":false,\"error\":\"BAD_RANGE\",\"reqId\":\"" + JsonEscape(reqId) + "\",\"bars\":[]}\n");
      return;
   }
   MqlRates rates[];
   int n = CopyRates(symbol, tf, tFrom, tTo, rates);
   if(n <= 0) {
      SendMessage("{\"type\":\"HISTORY_REPLY\",\"success\":false,\"error\":\"COPY_RATES_EMPTY\",\"reqId\":\"" + JsonEscape(reqId) + "\",\"bars\":[]}\n");
      return;
   }
   SortRatesByTimeAscending(rates);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits < 2) digits = 5;
   int maxBars = 1200;
   int step = 1;
   if(n > maxBars)
      step = (int)MathCeil((double)n / (double)maxBars);
   string bars = "[";
   int emitted = 0;
   for(int i = 0; i < n; i += step) {
      if(emitted > 0) bars += ",";
      bars += "{\"time\":" + IntegerToString((long)rates[i].time)
           + ",\"open\":" + DoubleToString(rates[i].open, digits)
           + ",\"high\":" + DoubleToString(rates[i].high, digits)
           + ",\"low\":" + DoubleToString(rates[i].low, digits)
           + ",\"close\":" + DoubleToString(rates[i].close, digits)
           + "}";
      emitted++;
      if(emitted >= maxBars) break;
   }
   bars += "]";
   string reply = "{\"type\":\"HISTORY_REPLY\",\"success\":true,\"reqId\":\"" + JsonEscape(reqId) + "\",\"bars\":" + bars + "}\n";
   SendMessage(reply);
}

void ProcessSpreadRequest(string jsonStr) {
   string reqId = ExtractJsonString(jsonStr, "reqId");
   string symbol = ExtractJsonString(jsonStr, "symbol");
   if(StringLen(reqId) < 4 || StringLen(symbol) < 2) {
      SendMessage("{\"type\":\"SPREAD_REPLY\",\"success\":false,\"error\":\"BAD_REQUEST\",\"reqId\":\"" + JsonEscape(reqId) + "\"}\n");
      return;
   }
   if(!SymbolSelect(symbol, true)) {
      SendMessage("{\"type\":\"SPREAD_REPLY\",\"success\":false,\"error\":\"SYMBOL_NOT_FOUND\",\"reqId\":\"" + JsonEscape(reqId) + "\",\"symbol\":\"" + JsonEscape(symbol) + "\"}\n");
      return;
   }
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits < 2) digits = 5;
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double spreadPips = GetCurrentSpreadPips(symbol);
   double spreadPrice = 0;
   if(ask > 0 && bid > 0 && ask >= bid) spreadPrice = ask - bid;
   double usdPerPipPerLot = GetUsdPerPipPerLot(symbol);
   string reply = "{\"type\":\"SPREAD_REPLY\",\"success\":true,\"reqId\":\"" + JsonEscape(reqId)
      + "\",\"symbol\":\"" + JsonEscape(symbol)
      + "\",\"spreadPips\":" + DoubleToString(spreadPips, 4)
      + ",\"spreadPrice\":" + DoubleToString(spreadPrice, digits)
      + ",\"usdPerPipPerLot\":" + DoubleToString(usdPerPipPerLot, 6)
      + ",\"ask\":" + DoubleToString(ask, digits)
      + ",\"bid\":" + DoubleToString(bid, digits)
      + "}\n";
   SendMessage(reply);
}

//+------------------------------------------------------------------+
// EA setup diagnostic: trading permissions + quote flow, consumed by the app's
// Connections page "Run EA diagnostic" checklist.
void ProcessDiagRequest(string jsonStr) {
   string reqId = ExtractJsonString(jsonStr, "reqId");
   string symbol = ExtractJsonString(jsonStr, "symbol");
   if(StringLen(symbol) < 2) symbol = _Symbol;

   bool termOk    = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool eaOk      = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   bool accountOk = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);

   bool symbolOk = SymbolSelect(symbol, true);
   double ask = 0, bid = 0;
   long quoteAgeSec = -1;
   if(symbolOk) {
      ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
      bid = SymbolInfoDouble(symbol, SYMBOL_BID);
      datetime lastTick = (datetime)SymbolInfoInteger(symbol, SYMBOL_TIME);
      if((long)lastTick > 0) quoteAgeSec = (long)(TimeTradeServer() - lastTick);
   }
   bool quoteFlowOk = symbolOk && ask > 0 && bid > 0 && quoteAgeSec >= 0 && quoteAgeSec < 300;

   int digits = symbolOk ? (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS) : 5;
   string reply = "{\"type\":\"DIAG_REPLY\",\"reqId\":\"" + JsonEscape(reqId)
      + "\",\"ea\":\"SignalCopierEA\",\"version\":\"1.3\""
      + ",\"terminalTradeAllowed\":" + (termOk ? "true" : "false")
      + ",\"eaTradeAllowed\":" + (eaOk ? "true" : "false")
      + ",\"accountTradeAllowed\":" + (accountOk ? "true" : "false")
      + ",\"terminalConnected\":" + (connected ? "true" : "false")
      + ",\"symbol\":\"" + JsonEscape(symbol)
      + "\",\"symbolFound\":" + (symbolOk ? "true" : "false")
      + ",\"quoteFlowOk\":" + (quoteFlowOk ? "true" : "false")
      + ",\"quoteAgeSec\":" + IntegerToString(quoteAgeSec)
      + ",\"ask\":" + DoubleToString(ask, digits)
      + ",\"bid\":" + DoubleToString(bid, digits)
      + ",\"account\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      + "\",\"server\":\"" + JsonEscape(AccountInfoString(ACCOUNT_SERVER))
      + "\",\"chartSymbol\":\"" + JsonEscape(_Symbol)
      + "\"}\n";
   SendMessage(reply);
}

//+------------------------------------------------------------------+
void ProcessCancelOrders(string jsonStr) {
   string csv = ExtractJsonString(jsonStr, "orderTickets");
   if(StringLen(csv) < 1) {
      Print("[TradeSync EA] CANCEL_ORDER: empty orderTickets");
      return;
   }
   string parts[];
   int n = StringSplit(csv, ',', parts);
   int ok = 0;
   for(int i = 0; i < n; i++) {
      StringTrimLeft(parts[i]);
      StringTrimRight(parts[i]);
      ulong ticket = (ulong)StringToInteger(parts[i]);
      if(ticket == 0) continue;
      if(!OrderSelect(ticket)) {
         if(EnableLogs) Print("[TradeSync EA] CANCEL_ORDER: ticket not found ", (long)ticket);
         continue;
      }
      long mag = OrderGetInteger(ORDER_MAGIC);
      if(mag != (long)MAGIC_NUMBER) {
         if(EnableLogs) Print("[TradeSync EA] CANCEL_ORDER: skip wrong magic ", (long)ticket, " mag=", mag);
         continue;
      }
      ResetLastError();
      if(trade.OrderDelete(ticket)) {
         ok++;
         if(EnableLogs) Print("[TradeSync EA] ✅ Pending order deleted #", (long)ticket);
      } else {
         Print("[TradeSync EA] ❌ OrderDelete failed #", (long)ticket, " err=", GetLastError());
      }
   }
   SendMessage("{\"type\":\"ACK\",\"status\":\"CANCEL_ORDER_DONE\",\"cancelled\":" + IntegerToString(ok) + "}\n");
}

//+------------------------------------------------------------------+
// App-driven close (Telegram close keywords): close one position by ticket.
// The close result itself flows back through OnTradeTransaction (CLOSED_* ACK).
void ProcessCloseTrade(string jsonStr) {
   string ticketStr = ExtractJsonString(jsonStr, "ticket");
   ulong ticket = (ulong)StringToInteger(ticketStr);
   if(ticket == 0) ticket = (ulong)ExtractJsonDouble(jsonStr, "ticket");
   if(ticket == 0) {
      Print("[TradeSync EA] CLOSE_TRADE: missing/invalid ticket");
      return;
   }
   if(!PositionSelectByTicket(ticket)) {
      Print("[TradeSync EA] CLOSE_TRADE: position not found ", (long)ticket);
      SendMessage("{\"type\":\"ACK\",\"status\":\"CLOSE_TRADE_NOT_FOUND\",\"ticket\":\"" + IntegerToString((long)ticket) + "\"}\n");
      return;
   }

   // Optional partial close: "percent" (0 < p < 100) closes that fraction of the
   // position volume, snapped to the symbol's lot step. Falls back to a full
   // close when the volume can't be split (min-lot positions).
   double percent = ExtractJsonDouble(jsonStr, "percent");
   if(percent > 0 && percent < 100) {
      string sym    = PositionGetString(POSITION_SYMBOL);
      double vol    = PositionGetDouble(POSITION_VOLUME);
      double minLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      double step   = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      double closeVol = vol * percent / 100.0;
      if(step > 0) closeVol = MathFloor(closeVol / step + 1e-9) * step;
      bool splittable = (closeVol >= minLot && (vol - closeVol) >= minLot - 1e-9);
      if(splittable) {
         ResetLastError();
         if(trade.PositionClosePartial(ticket, closeVol)) {
            Print("[TradeSync EA] ✅ CLOSE_TRADE partial ", DoubleToString(percent, 1), "% (",
                  DoubleToString(closeVol, 2), "/", DoubleToString(vol, 2), " lot) sent for position #", (long)ticket);
         } else {
            Print("[TradeSync EA] ❌ CLOSE_TRADE partial failed #", (long)ticket, " err=", GetLastError(),
                  " retcode=", trade.ResultRetcode());
            SendMessage("{\"type\":\"ACK\",\"status\":\"CLOSE_TRADE_FAILED\",\"ticket\":\"" + IntegerToString((long)ticket) + "\"}\n");
         }
         return;
      }
      Print("[TradeSync EA] ⚠ CLOSE_TRADE partial ", DoubleToString(percent, 1),
            "%: volume ", DoubleToString(vol, 2), " too small to split (min lot ",
            DoubleToString(minLot, 2), ") — closing fully.");
   }

   ResetLastError();
   if(trade.PositionClose(ticket)) {
      Print("[TradeSync EA] ✅ CLOSE_TRADE: close sent for position #", (long)ticket);
   } else {
      Print("[TradeSync EA] ❌ CLOSE_TRADE failed #", (long)ticket, " err=", GetLastError(),
            " retcode=", trade.ResultRetcode());
      SendMessage("{\"type\":\"ACK\",\"status\":\"CLOSE_TRADE_FAILED\",\"ticket\":\"" + IntegerToString((long)ticket) + "\"}\n");
   }
}

//+------------------------------------------------------------------+
// True when the JSON key exists with a numeric value (not null/string),
// so "sl":null from the app never wipes an existing stop.
bool JsonHasNumber(string json, string key) {
   string search = "\"" + key + "\":";
   int start = StringFind(json, search);
   if(start < 0) return false;
   start += StringLen(search);
   while(start < StringLen(json) && StringGetCharacter(json, start) == ' ') start++;
   if(start >= StringLen(json)) return false;
   ushort c = StringGetCharacter(json, start);
   return (c == '-' || (c >= '0' && c <= '9'));
}

//+------------------------------------------------------------------+
// App-driven SL/TP modify for open positions (trade detail editor, edited
// Telegram signals, break-even keyword commands).
// - "tradeId" targets EVERY position carrying the TS:<tradeId> comment
//   (multi-TP trades open one position per TP level).
// - "tps":[...] maps tps[i] to the i-th position (open order); extra
//   positions get the last TP level.
// - "slToEntry":true moves each position's SL to its own open price.
void ProcessModifyTrade(string jsonStr) {
   ulong ticket = (ulong)StringToInteger(ExtractJsonString(jsonStr, "ticket"));
   if(ticket == 0) ticket = (ulong)ExtractJsonDouble(jsonStr, "ticket");

   string tradeId = ExtractJsonString(jsonStr, "tradeId");
   bool slToEntry = (StringFind(jsonStr, "\"slToEntry\":true") >= 0);

   double tpsArr[10];
   int tpsCount = 0;
   ParseDoubleArray(ExtractJsonArray(jsonStr, "tps"), tpsArr, tpsCount);

   // Collect targets: all positions for the tradeId, oldest ticket first so
   // index order matches TP order at open time.
   ulong targets[];
   if(StringLen(tradeId) > 0) {
      string prefix = "TS:" + tradeId;
      for(int i = 0; i < PositionsTotal(); i++) {
         ulong t = PositionGetTicket(i);
         if(t == 0 || !PositionSelectByTicket(t)) continue;
         string cmt = PositionGetString(POSITION_COMMENT);
         if(StringFind(cmt, prefix) != 0) continue;
         int n = ArraySize(targets);
         ArrayResize(targets, n + 1);
         targets[n] = t;
      }
      if(ArraySize(targets) > 1) ArraySort(targets);
   }
   if(ArraySize(targets) == 0 && ticket > 0 && PositionSelectByTicket(ticket)) {
      ArrayResize(targets, 1);
      targets[0] = ticket;
   }

   if(ArraySize(targets) == 0) {
      Print("[TradeSync EA] MODIFY_TRADE: position not found");
      SendMessage("{\"type\":\"ACK\",\"status\":\"MODIFY_TRADE_NOT_FOUND\"}\n");
      return;
   }

   bool hasSl = !slToEntry && JsonHasNumber(jsonStr, "sl");
   double slIn = hasSl ? ExtractJsonDouble(jsonStr, "sl") : 0;
   bool hasTp = JsonHasNumber(jsonStr, "tp");
   double tpIn = hasTp ? ExtractJsonDouble(jsonStr, "tp") : 0;

   int okCount = 0, failCount = 0;
   ulong firstTicket = targets[0];
   for(int i = 0; i < ArraySize(targets); i++) {
      ulong t = targets[i];
      if(!PositionSelectByTicket(t)) continue;

      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      if(slToEntry)   sl = PositionGetDouble(POSITION_PRICE_OPEN);
      else if(hasSl)  sl = slIn;
      if(tpsCount > 0)     tp = (i < tpsCount) ? tpsArr[i] : tpsArr[tpsCount - 1];
      else if(hasTp)       tp = tpIn;

      ResetLastError();
      if(trade.PositionModify(t, sl, tp)) {
         okCount++;
         Print("[TradeSync EA] ✅ MODIFY_TRADE #", (long)t,
               " SL=", DoubleToString(sl, 5), " TP=", DoubleToString(tp, 5),
               (slToEntry ? " (SL→entry)" : ""));
      } else {
         failCount++;
         Print("[TradeSync EA] ❌ MODIFY_TRADE failed #", (long)t, " err=", GetLastError(),
               " retcode=", trade.ResultRetcode());
      }
   }

   string status = (okCount > 0) ? "MODIFY_TRADE_OK" : "MODIFY_TRADE_FAILED";
   SendMessage("{\"type\":\"ACK\",\"status\":\"" + status + "\",\"positionId\":\"" + IntegerToString((long)firstTicket) + "\""
               + ",\"modified\":" + IntegerToString(okCount)
               + ",\"failed\":" + IntegerToString(failCount) + "}\n");
}

//+------------------------------------------------------------------+
string BuildOrderComment(string tradeId) {
   if(StringLen(tradeId) > 0) return "TS:" + tradeId;
   return "TradeSync";
}

string TradeIdFromComment(string comment) {
   if(StringFind(comment, "TS:") == 0) return StringSubstr(comment, 3);
   return "";
}

bool OpenPositionExistsForTradeId(string tradeId) {
   if(StringLen(tradeId) == 0) return false;
   string prefix = "TS:" + tradeId;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      string cmt = PositionGetString(POSITION_COMMENT);
      if(StringFind(cmt, prefix) == 0) return true;
   }
   return false;
}

#define MAX_RECENT_SIGNAL_IDS 48
#define RECENT_SIGNAL_ID_TTL_SEC 120
string   gRecentSignalIds[];
datetime gRecentSignalIdTimes[];

bool IsRecentDuplicateSignal(string tradeId) {
   if(StringLen(tradeId) == 0) return false;
   datetime now = TimeCurrent();
   for(int i = 0; i < ArraySize(gRecentSignalIds); i++) {
      if(gRecentSignalIds[i] != tradeId) continue;
      if((now - gRecentSignalIdTimes[i]) <= RECENT_SIGNAL_ID_TTL_SEC) return true;
   }
   return false;
}

void RememberRecentSignalId(string tradeId) {
   if(StringLen(tradeId) == 0) return;
   datetime now = TimeCurrent();
   for(int i = 0; i < ArraySize(gRecentSignalIds); i++) {
      if(gRecentSignalIds[i] == tradeId) {
         gRecentSignalIdTimes[i] = now;
         return;
      }
   }
   int n = ArraySize(gRecentSignalIds);
   if(n >= MAX_RECENT_SIGNAL_IDS) {
      for(int i = 0; i < n - 1; i++) {
         gRecentSignalIds[i] = gRecentSignalIds[i + 1];
         gRecentSignalIdTimes[i] = gRecentSignalIdTimes[i + 1];
      }
      n--;
      ArrayResize(gRecentSignalIds, n);
      ArrayResize(gRecentSignalIdTimes, n);
   }
   ArrayResize(gRecentSignalIds, n + 1);
   ArrayResize(gRecentSignalIdTimes, n + 1);
   gRecentSignalIds[n] = tradeId;
   gRecentSignalIdTimes[n] = now;
}

void EnqueueSignal(const string jsonStr) {
   int n = ArraySize(gSignalQueue);
   if(n >= MAX_SIGNAL_QUEUE) {
      Print("[TradeSync EA] ⚠ Signal queue full (", MAX_SIGNAL_QUEUE, ") — dropping oldest");
      for(int i = 0; i < n - 1; i++)
         gSignalQueue[i] = gSignalQueue[i + 1];
      ArrayResize(gSignalQueue, n - 1);
      n = ArraySize(gSignalQueue);
   }
   ArrayResize(gSignalQueue, n + 1);
   gSignalQueue[n] = jsonStr;
   if(EnableLogs) Print("[TradeSync EA] Signal queued (depth ", n + 1, ")");
}

void DrainSignalQueue() {
   while(ArraySize(gSignalQueue) > 0) {
      string jsonStr = gSignalQueue[0];
      int n = ArraySize(gSignalQueue);
      for(int i = 0; i < n - 1; i++)
         gSignalQueue[i] = gSignalQueue[i + 1];
      ArrayResize(gSignalQueue, n - 1);
      ProcessSignal(jsonStr);
   }
}

//+------------------------------------------------------------------+
void ProcessMessage(string jsonStr) {
   if(EnableLogs) Print("[TradeSync EA] Received: ", jsonStr);
   string type = ExtractJsonString(jsonStr, "type");
   if(EnableLogs) Print("[TradeSync EA] Parsed type: ", type);

   // Fallback if JSON has spaces/format variants and parser misses the "type" value
   if(StringLen(type) == 0) {
      if(StringFind(jsonStr, "\"SYNC_REQUEST\"") >= 0) type = "SYNC_REQUEST";
      else if(StringFind(jsonStr, "\"PING\"") >= 0) type = "PING";
      else if(StringFind(jsonStr, "\"SIGNAL\"") >= 0) type = "SIGNAL";
      else if(StringFind(jsonStr, "\"HELLO_ACK\"") >= 0) type = "HELLO_ACK";
      else if(StringFind(jsonStr, "\"CANCEL_ORDER\"") >= 0) type = "CANCEL_ORDER";
      else if(StringFind(jsonStr, "\"CLOSE_TRADE\"") >= 0) type = "CLOSE_TRADE";
      else if(StringFind(jsonStr, "\"MODIFY_TRADE\"") >= 0) type = "MODIFY_TRADE";
      else if(StringFind(jsonStr, "\"HISTORY_REQUEST\"") >= 0) type = "HISTORY_REQUEST";
      else if(StringFind(jsonStr, "\"SPREAD_REQUEST\"") >= 0) type = "SPREAD_REQUEST";
      else if(StringFind(jsonStr, "\"DIAG_REQUEST\"") >= 0) type = "DIAG_REQUEST";
      else if(StringFind(jsonStr, "\"EOD_CLOSE\"") >= 0) type = "EOD_CLOSE";
   }

   if(type == "HELLO_ACK") {
      string ackStatus = ExtractJsonString(jsonStr, "status");
      if(ackStatus == "AUTH_FAILED") {
         Print("[TradeSync EA] ❌ AUTH FAILED — SharedSecret input does not match the app (Settings → Connection). Signals will NOT be received.");
         isConnected  = false;
         helloSent    = false;
         helloRetries = 0;
         SocketClose(socketHandle);
         socketHandle = INVALID_HANDLE;
         return;
      }
      helloSent    = true;
      helloRetries = 0;
      Print("[TradeSync EA] ✅ Handshake complete — ready to receive signals");
   }
   else if(type == "PING") {
      SendMessage("{\"type\":\"PONG\"}\n");
   }
   else if(type == "SIGNAL") {
      EnqueueSignal(jsonStr);
   }
   else if(type == "CANCEL_ORDER") {
      ProcessCancelOrders(jsonStr);
   }
   else if(type == "CLOSE_TRADE") {
      ProcessCloseTrade(jsonStr);
   }
   else if(type == "MODIFY_TRADE") {
      ProcessModifyTrade(jsonStr);
   }
   else if(type == "SYNC_REQUEST") {
      Print("[TradeSync EA] Manual sync requested by app");
      datetime fromTime = ResolveSyncHistoryFromTime(jsonStr);
      if((long)fromTime <= 0)
         Print("[TradeSync EA] Sync window: ALL history");
      else
         Print("[TradeSync EA] Sync window from ", TimeToString(fromTime, TIME_DATE | TIME_MINUTES));
      SendMessage("{\"type\":\"ACK\",\"status\":\"SYNC_STARTED\"}\n");
      SendAccountSnapshot();
      BroadcastOpenPositionsPnL();
      BroadcastRecentClosedDeals(fromTime);
      SendMessage("{\"type\":\"ACK\",\"status\":\"SYNC_DONE\"}\n");
   }
   else if(type == "HISTORY_REQUEST") {
      ProcessHistoryRequest(jsonStr);
   }
   else if(type == "SPREAD_REQUEST") {
      ProcessSpreadRequest(jsonStr);
   }
   else if(type == "DIAG_REQUEST") {
      ProcessDiagRequest(jsonStr);
   }
   else if(type == "EOD_CLOSE") {
      Print("[TradeSync EA] Immediate EOD_CLOSE requested from app");
      ExecuteEndOfDayCloseAll();
   }
   else if(type == "SETTINGS_UPDATE") {
      ApplyEndOfDaySettingsFromJson(jsonStr);
      if(AllowAppToOverrideManagement) {
         if(StringFind(jsonStr, "\"enableBreakEven\"") >= 0)
            gEnableBreakEven = ExtractJsonBool(jsonStr, "enableBreakEven", gEnableBreakEven);
         if(StringFind(jsonStr, "\"breakEvenUnit\"") >= 0)
            gBreakEvenUnit = NormalizeManagementUnit(ExtractJsonString(jsonStr, "breakEvenUnit"));
         if(StringFind(jsonStr, "\"breakEvenTrigger\"") >= 0)
            gBreakEvenTrigger = MathMax(0.0, ExtractJsonDouble(jsonStr, "breakEvenTrigger"));
         if(StringFind(jsonStr, "\"breakEvenOffset\"") >= 0)
            gBreakEvenOffset = MathMax(0.0, ExtractJsonDouble(jsonStr, "breakEvenOffset"));

         if(StringFind(jsonStr, "\"enableTrailingStop\"") >= 0)
            gEnableTrailing = ExtractJsonBool(jsonStr, "enableTrailingStop", gEnableTrailing);
         if(StringFind(jsonStr, "\"trailingUnit\"") >= 0)
            gTrailingUnit = NormalizeManagementUnit(ExtractJsonString(jsonStr, "trailingUnit"));
         if(StringFind(jsonStr, "\"trailingStart\"") >= 0)
            gTrailingStart = MathMax(0.0, ExtractJsonDouble(jsonStr, "trailingStart"));
         if(StringFind(jsonStr, "\"trailingDistance\"") >= 0)
            gTrailingDistance = MathMax(0.0, ExtractJsonDouble(jsonStr, "trailingDistance"));
         if(StringFind(jsonStr, "\"trailingStep\"") >= 0)
            gTrailingStep = MathMax(0.0, ExtractJsonDouble(jsonStr, "trailingStep"));

         if(StringFind(jsonStr, "\"enablePartialClose\"") >= 0)
            gEnablePartialClose = ExtractJsonBool(jsonStr, "enablePartialClose", gEnablePartialClose);
         if(StringFind(jsonStr, "\"partialCloseUnit\"") >= 0)
            gPartialCloseUnit = NormalizeManagementUnit(ExtractJsonString(jsonStr, "partialCloseUnit"));
         if(StringFind(jsonStr, "\"partialCloseTrigger\"") >= 0)
            gPartialCloseTrigger = MathMax(0.0, ExtractJsonDouble(jsonStr, "partialCloseTrigger"));
         if(StringFind(jsonStr, "\"partialClosePercent\"") >= 0)
            gPartialClosePercent = MathMax(0.0, MathMin(100.0, ExtractJsonDouble(jsonStr, "partialClosePercent")));

         Print("[TradeSync EA] Management settings updated from app: BE=", gEnableBreakEven, "(", gBreakEvenUnit, ") Trail=", gEnableTrailing, "(", gTrailingUnit, ") PC=", gEnablePartialClose, "(", gPartialCloseUnit, " @", DoubleToString(gPartialCloseTrigger, 2), " close ", DoubleToString(gPartialClosePercent, 0), "%)");
      } else if(EnableLogs) {
         Print("[TradeSync EA] SETTINGS_UPDATE: app management ignored (AllowAppToOverrideManagement=false); using EA inputs.");
      }

      // EA-side risk safety net — applied regardless of AllowAppToOverrideManagement
      // (these are hard caps that must survive an app crash, not trade management).
      if(StringFind(jsonStr, "\"riskGuardEnabled\"") >= 0) {
         gRiskGuardEnabled = ExtractJsonBool(jsonStr, "riskGuardEnabled", gRiskGuardEnabled);
         if(StringFind(jsonStr, "\"riskMaxConcurrent\"") >= 0)
            gRiskMaxConcurrent = (int)MathMax(0.0, ExtractJsonDouble(jsonStr, "riskMaxConcurrent"));
         if(StringFind(jsonStr, "\"riskMaxDailyLossMoney\"") >= 0)
            gRiskMaxDailyLossMoney = MathMax(0.0, ExtractJsonDouble(jsonStr, "riskMaxDailyLossMoney"));
         if(StringFind(jsonStr, "\"riskMaxDailyLossPct\"") >= 0)
            gRiskMaxDailyLossPct = MathMax(0.0, ExtractJsonDouble(jsonStr, "riskMaxDailyLossPct"));
         if(StringFind(jsonStr, "\"riskMaxSpreadPips\"") >= 0)
            gRiskMaxSpreadPips = MathMax(0.0, ExtractJsonDouble(jsonStr, "riskMaxSpreadPips"));
         if(StringFind(jsonStr, "\"riskRequireStopLoss\"") >= 0)
            gRiskRequireStopLoss = ExtractJsonBool(jsonStr, "riskRequireStopLoss", gRiskRequireStopLoss);
         Print("[TradeSync EA] Risk safety net: ", (gRiskGuardEnabled ? "ON" : "OFF"),
               " maxConcurrent=", gRiskMaxConcurrent,
               " dailyLoss$=", DoubleToString(gRiskMaxDailyLossMoney, 2),
               " dailyLoss%=", DoubleToString(gRiskMaxDailyLossPct, 2),
               " maxSpread=", DoubleToString(gRiskMaxSpreadPips, 2),
               " requireSL=", gRiskRequireStopLoss);
      }
   }
   else {
      if(EnableLogs) Print("[TradeSync EA] Unknown message type. Raw=", jsonStr);
   }
}

//+------------------------------------------------------------------+
// Determine pending order type from signal
// Uses the signal's own symbol for price comparison (not the chart symbol)
ENUM_ORDER_TYPE ResolveOrderType(string sym, string sType, double entryPrice, string orderTypeStr) {
   // Explicit pending type stated in signal
   if(StringFind(orderTypeStr, "BUY LIMIT")  >= 0 || StringFind(sType, "BUY LIMIT")  >= 0) return ORDER_TYPE_BUY_LIMIT;
   if(StringFind(orderTypeStr, "BUY STOP")   >= 0 || StringFind(sType, "BUY STOP")   >= 0) return ORDER_TYPE_BUY_STOP;
   if(StringFind(orderTypeStr, "SELL LIMIT") >= 0 || StringFind(sType, "SELL LIMIT") >= 0) return ORDER_TYPE_SELL_LIMIT;
   if(StringFind(orderTypeStr, "SELL STOP")  >= 0 || StringFind(sType, "SELL STOP")  >= 0) return ORDER_TYPE_SELL_STOP;

   // Explicit MARKET — do not infer BUY_LIMIT/BUY_STOP from stale signal entry vs live Ask/Bid (latency → wrong pendings)
   if(StringFind(orderTypeStr, "MARKET") >= 0) {
      Print("[TradeSync EA] orderType MARKET → market execution");
      if(StringFind(sType, "BUY") >= 0) return ORDER_TYPE_BUY;
      if(StringFind(sType, "SELL") >= 0) return ORDER_TYPE_SELL;
   }

   // Auto-detect: compare entry to CURRENT ASK/BID of the signal's symbol
   if(entryPrice > 0 && !ForceMarket) {
      double ask   = SymbolInfoDouble(sym, SYMBOL_ASK);
      double bid   = SymbolInfoDouble(sym, SYMBOL_BID);
      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      // Use a 2-point threshold — anything beyond 2 points = pending order
      double threshold = 2.0 * point;

      if(StringFind(sType, "BUY") >= 0) {
         // Blend / target entry: if Ask is already at or below entry (better fill), market now — do not wait on LIMIT.
         if(ask <= entryPrice + threshold) {
            Print("[TradeSync EA] Ask ", ask, " <= entry ", entryPrice, " (at or better) → MARKET");
            return ORDER_TYPE_BUY;
         }
         if(entryPrice <= ask - threshold) {
            Print("[TradeSync EA] Entry ", entryPrice, " < Ask ", ask, " → BUY LIMIT");
            return ORDER_TYPE_BUY_LIMIT;
         }
         if(entryPrice >= ask + threshold) {
            Print("[TradeSync EA] Entry ", entryPrice, " > Ask ", ask, " → BUY STOP");
            return ORDER_TYPE_BUY_STOP;
         }
      }
      if(StringFind(sType, "SELL") >= 0) {
         if(bid >= entryPrice - threshold) {
            Print("[TradeSync EA] Bid ", bid, " >= entry ", entryPrice, " (at or better) → MARKET");
            return ORDER_TYPE_SELL;
         }
         if(entryPrice >= bid + threshold) {
            Print("[TradeSync EA] Entry ", entryPrice, " > Bid ", bid, " → SELL LIMIT");
            return ORDER_TYPE_SELL_LIMIT;
         }
         if(entryPrice <= bid - threshold) {
            Print("[TradeSync EA] Entry ", entryPrice, " < Bid ", bid, " → SELL STOP");
            return ORDER_TYPE_SELL_STOP;
         }
      }
      Print("[TradeSync EA] Entry ", entryPrice, " ≈ market price (Ask:", ask, " Bid:", bid, ") → MARKET");
   }

   // Default: market order
   if(StringFind(sType, "BUY")  >= 0) return ORDER_TYPE_BUY;
   if(StringFind(sType, "SELL") >= 0) return ORDER_TYPE_SELL;
   return -1;
}

//+------------------------------------------------------------------+
// Normalize a price to the symbol's digit precision
double NormalizePrice(string sym, double price) {
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   return NormalizeDouble(price, digits);
}

// Some providers list SL/TP in reverse (layout for the opposite side). If both are
// non-zero and on the wrong side of the reference quote for this direction, swap once.
void MaybeSwapStopsIfReversedForMarket(string sym, ENUM_ORDER_TYPE ot, double &sl, double &tp) {
   if(sl <= 0 || tp <= 0) return;
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   if(ot == ORDER_TYPE_BUY) {
      if(sl >= ask && tp <= ask) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync EA] Swapped SL/TP: BUY signal had SELL-side layout (SL≥Ask, TP≤Ask).");
      }
   } else if(ot == ORDER_TYPE_SELL) {
      if(sl <= bid && tp >= bid) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync EA] Swapped SL/TP: SELL signal had BUY-side layout (SL≤Bid, TP≥Bid).");
      }
   }
}

void MaybeSwapStopsIfReversedForPending(ENUM_ORDER_TYPE ot, double entry,
                                         double &sl, double &tp) {
   if(sl <= 0 || tp <= 0 || entry <= 0) return;
   bool isBuy = (ot == ORDER_TYPE_BUY_LIMIT || ot == ORDER_TYPE_BUY_STOP);
   if(isBuy) {
      if(sl >= entry && tp <= entry) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync EA] Swapped SL/TP: pending BUY had SELL-side layout vs entry.");
      }
   } else {
      if(sl <= entry && tp >= entry) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync EA] Swapped SL/TP: pending SELL had BUY-side layout vs entry.");
      }
   }
}

// Validate and adjust SL/TP for a market order so they respect the broker's
// minimum stop level. Returns false if SL/TP are on the wrong side of price.
bool AdjustStopsForMarket(string sym, ENUM_ORDER_TYPE ot,
                           double &sl, double &tp) {
   int    digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double point     = SymbolInfoDouble(sym,  SYMBOL_POINT);
   long   stopLevel = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL); // in points
   double minDist   = (stopLevel + 2) * point; // add 2 points safety margin

   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);

   if(ot == ORDER_TYPE_BUY) {
      double refPrice = ask;
      // SL must be below (ask - minDist)
      if(sl > 0) {
         double maxSL = NormalizeDouble(refPrice - minDist, digits);
         if(sl >= refPrice) {
            Print("[TradeSync EA] ⚠ SL above Ask – zeroing SL. (SL:", sl, " Ask:", ask, ")");
            sl = 0;
         } else if(sl > maxSL) {
            Print("[TradeSync EA] ⚠ SL too close to Ask. Adjusting from ", sl, " to ", maxSL);
            sl = maxSL;
         }
      }
      // TP must be above (ask + minDist)
      if(tp > 0) {
         double minTP = NormalizeDouble(refPrice + minDist, digits);
         if(tp <= refPrice) {
            Print("[TradeSync EA] ⚠ TP below Ask – zeroing TP. (TP:", tp, " Ask:", ask, ")");
            tp = 0;
         } else if(tp < minTP) {
            Print("[TradeSync EA] ⚠ TP too close to Ask. Adjusting from ", tp, " to ", minTP);
            tp = minTP;
         }
      }
   }
   else if(ot == ORDER_TYPE_SELL) {
      double refPrice = bid;
      // SL must be above (bid + minDist)
      if(sl > 0) {
         double minSL = NormalizeDouble(refPrice + minDist, digits);
         if(sl <= refPrice) {
            Print("[TradeSync EA] ⚠ SL below Bid – zeroing SL. (SL:", sl, " Bid:", bid, ")");
            sl = 0;
         } else if(sl < minSL) {
            Print("[TradeSync EA] ⚠ SL too close to Bid. Adjusting from ", sl, " to ", minSL);
            sl = minSL;
         }
      }
      // TP must be below (bid - minDist)
      if(tp > 0) {
         double maxTP = NormalizeDouble(refPrice - minDist, digits);
         if(tp >= refPrice) {
            Print("[TradeSync EA] ⚠ TP above Bid – zeroing TP. (TP:", tp, " Bid:", bid, ")");
            tp = 0;
         } else if(tp > maxTP) {
            Print("[TradeSync EA] ⚠ TP too close to Bid. Adjusting from ", tp, " to ", maxTP);
            tp = maxTP;
         }
      }
   }
   return true;
}

// Validate SL/TP for pending orders against the entry price
void AdjustStopsForPending(string sym, ENUM_ORDER_TYPE ot, double entry,
                            double &sl, double &tp) {
   int    digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double point     = SymbolInfoDouble(sym,  SYMBOL_POINT);
   long   stopLevel = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist   = (stopLevel + 2) * point;

   bool isBuy = (ot == ORDER_TYPE_BUY_LIMIT || ot == ORDER_TYPE_BUY_STOP);
   if(isBuy) {
      if(sl > 0 && sl >= entry - minDist)
         sl = NormalizeDouble(entry - minDist, digits);
      if(tp > 0 && tp <= entry + minDist)
         tp = NormalizeDouble(entry + minDist, digits);
   } else {
      if(sl > 0 && sl <= entry + minDist)
         sl = NormalizeDouble(entry + minDist, digits);
      if(tp > 0 && tp >= entry - minDist)
         tp = NormalizeDouble(entry - minDist, digits);
   }
}

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| EA-side risk safety net helpers                                   |
//| These duplicate the app's pre-trade guards INSIDE the EA so the   |
//| caps still hold if the desktop app crashes or is disconnected.    |
//+------------------------------------------------------------------+
int CountOpenPositionsOurMagic() {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC) == MAGIC_NUMBER) count++;
   }
   return count;
}

// Realized P&L today (broker day, our magic) + floating P&L of our open positions.
double ComputeTodayPnlOurMagic() {
   double pnl = 0.0;
   MqlDateTime dt;
   TimeToStruct(TimeTradeServer(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime dayStart = StructToTime(dt);

   if(HistorySelect(dayStart, TimeTradeServer() + 60)) {
      int deals = HistoryDealsTotal();
      for(int i = 0; i < deals; i++) {
         ulong dealId = HistoryDealGetTicket(i);
         if(dealId == 0) continue;
         if((long)HistoryDealGetInteger(dealId, DEAL_MAGIC) != MAGIC_NUMBER) continue;
         long entryKind = (long)HistoryDealGetInteger(dealId, DEAL_ENTRY);
         if(entryKind != DEAL_ENTRY_OUT && entryKind != DEAL_ENTRY_INOUT && entryKind != DEAL_ENTRY_OUT_BY) continue;
         pnl += HistoryDealGetDouble(dealId, DEAL_PROFIT)
              + HistoryDealGetDouble(dealId, DEAL_SWAP)
              + HistoryDealGetDouble(dealId, DEAL_COMMISSION);
      }
   }

   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MAGIC_NUMBER) continue;
      pnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   return pnl;
}

// Returns "" when the signal may proceed, otherwise a BLOCKED_* ACK status.
string EvaluateEaRiskGuard(double sl) {
   if(!gRiskGuardEnabled) return "";

   if(gRiskRequireStopLoss && sl <= 0)
      return "BLOCKED_EA_NO_SL";

   if(gRiskMaxConcurrent > 0 && CountOpenPositionsOurMagic() >= gRiskMaxConcurrent)
      return "BLOCKED_EA_MAX_CONCURRENT";

   if(gRiskMaxDailyLossMoney > 0 || gRiskMaxDailyLossPct > 0) {
      double pnl = ComputeTodayPnlOurMagic();
      if(pnl < 0) {
         double loss = -pnl;
         if(gRiskMaxDailyLossMoney > 0 && loss >= gRiskMaxDailyLossMoney)
            return "BLOCKED_EA_DAILY_LOSS";
         double balance = AccountInfoDouble(ACCOUNT_BALANCE);
         if(gRiskMaxDailyLossPct > 0 && balance > 0 && (loss * 100.0 / balance) >= gRiskMaxDailyLossPct)
            return "BLOCKED_EA_DAILY_LOSS";
      }
   }
   return "";
}

void ProcessSignal(string jsonStr) {
   string signal = ExtractJsonObject(jsonStr, "signal");
   if(StringLen(signal) == 0) return;

   // ── Check trading permissions and warn clearly ───────────────────
   bool termOk    = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool eaOk      = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   bool accountOk = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);

   Print("[TradeSync EA] Trading flags — Terminal:", termOk,
         " EA:", eaOk, " Account:", accountOk,
         " | Mode:", AccountInfoInteger(ACCOUNT_TRADE_MODE),
         " | ProgramTradeAllowed:", MQLInfoInteger(MQL_TRADE_ALLOWED));

   if(!termOk) {
      Print("[TradeSync EA] ❌ BLOCKED: AutoTrading OFF in toolbar. Click 'Algo Trading' button.");
      SendACK("TRADE_DISABLED_TERMINAL", "", "", 0);
      return;
   }
   if(!eaOk) {
      Print("[TradeSync EA] ❌ BLOCKED: EA has no trade permission. Right-click chart → Expert Advisors → Allow Algo Trading ✓");
      SendACK("TRADE_DISABLED_EA", "", "", 0);
      return;
   }
   if(!accountOk) {
      Print("[TradeSync EA] ⚠ ACCOUNT_TRADE_ALLOWED=false — possibly investor password or prop-firm restriction. Attempting order anyway...");
   }

   string symbol      = ExtractJsonString(signal, "symbol");
   string sType       = ExtractJsonString(signal, "type");
   string orderKind   = ExtractJsonString(signal, "orderType");
   // tradeId is a short string id (e.g. "m1abc2-x9k4"); legacy app versions sent a numeric timestamp.
   string tradeId     = ExtractJsonString(signal, "tradeId");
   if(StringLen(tradeId) == 0) {
      long tradeIdNum = (long)ExtractJsonDouble(signal, "tradeId");
      if(tradeIdNum > 0) tradeId = IntegerToString(tradeIdNum);
   }
   double entry       = ExtractJsonDouble(signal, "entry");
   double sl          = ExtractJsonDouble(signal, "sl");
   double lot         = ExtractJsonDouble(signal, "lot");
   if(lot <= 0) lot   = DefaultLot;

   // Parse all TPs from array
   double tpArr[10];
   int    tpCount = 0;
   string tpRaw   = ExtractJsonArray(signal, "tp");
   ParseDoubleArray(tpRaw, tpArr, tpCount);
   double tp1 = (tpCount > 0) ? tpArr[0] : 0;

   // Optional per-TP lot share percentages, e.g. [50,30,20]. Invalid → equal split.
   double tpShareArr[10];
   int    tpShareCount = 0;
   string tpShareRaw = ExtractJsonArray(signal, "tpLotShares");
   ParseDoubleArray(tpShareRaw, tpShareArr, tpShareCount);
   if(tpShareCount > 0) {
      double shareSum = 0;
      for(int i = 0; i < tpShareCount; i++) shareSum += tpShareArr[i];
      if(tpShareCount != tpCount) {
         Print("[TradeSync EA] ⚠ tpLotShares count ", tpShareCount, " != TP count ", tpCount, " — using equal split.");
         tpShareCount = 0;
      } else if(shareSum < 90.0 || shareSum > 110.0) {
         Print("[TradeSync EA] ⚠ tpLotShares sum ", DoubleToString(shareSum, 1), " not ≈100 — using equal split.");
         tpShareCount = 0;
      }
   }

   // Optional spread cap (pips); 0/absent = no cap
   double maxSpreadPips = ExtractJsonDouble(signal, "maxSpreadPips");

   if(StringLen(symbol) == 0 || StringLen(sType) == 0) {
      Print("[TradeSync EA] Invalid signal: missing symbol/type");
      return;
   }

   // Idempotency: duplicate SIGNAL lines (app double-dispatch / reconnect replay) must not
   // open a second position for the same tradeId.
   if(StringLen(tradeId) > 0) {
      if(OpenPositionExistsForTradeId(tradeId) || IsRecentDuplicateSignal(tradeId)) {
         Print("[TradeSync EA] ⚠ Duplicate SIGNAL ignored — tradeId already active/recent: ", tradeId);
         SendACK("DUPLICATE_SIGNAL", symbol, sType, 0, tradeId);
         return;
      }
      RememberRecentSignalId(tradeId);
   }

   // Select symbol
   if(!SymbolSelect(symbol, true)) {
      Print("[TradeSync EA] Symbol not found: ", symbol);
      SendACK("SYMBOL_NOT_FOUND", symbol, sType, 0);
      return;
   }

   // ── EA-side risk safety net (survives app crash/disconnect) ──
   string riskBlock = EvaluateEaRiskGuard(sl);
   if(StringLen(riskBlock) > 0) {
      Print("[TradeSync EA] ❌ ", riskBlock, ": ", symbol, " ", sType, " blocked by EA-side risk guard.");
      SendACK(riskBlock, symbol, sType, tpCount, tradeId);
      return;
   }
   // Fallback spread cap from SETTINGS_UPDATE when the signal itself carries none.
   if(maxSpreadPips <= 0 && gRiskGuardEnabled && gRiskMaxSpreadPips > 0)
      maxSpreadPips = gRiskMaxSpreadPips;

   // ── Spread guard ──
   double spreadPips = GetCurrentSpreadPips(symbol);
   if(maxSpreadPips > 0 && spreadPips > maxSpreadPips) {
      Print("[TradeSync EA] ❌ BLOCKED_SPREAD: ", symbol, " spread ", DoubleToString(spreadPips, 2),
            " pips > limit ", DoubleToString(maxSpreadPips, 2), " pips — signal not executed.");
      SendACK("BLOCKED_SPREAD", symbol, sType, tpCount, tradeId, 0, 0, 0, "",
              ",\"spreadPips\":" + DoubleToString(spreadPips, 2)
              + ",\"maxSpreadPips\":" + DoubleToString(maxSpreadPips, 2));
      return;
   }

   // Normalize SType to uppercase
   StringToUpper(sType);
   StringToUpper(orderKind);

   // ── Normalize all prices to symbol digits ──
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   entry = NormalizeDouble(entry, digits);
   sl    = sl  > 0 ? NormalizeDouble(sl,  digits) : 0;
   tp1   = tp1 > 0 ? NormalizeDouble(tp1, digits) : 0;
   for(int i = 0; i < tpCount; i++)
      tpArr[i] = NormalizeDouble(tpArr[i], digits);

   // Determine order type — pass signal symbol for correct price lookup
   ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)ResolveOrderType(symbol, sType, entry, orderKind);
   if((int)ot < 0) {
      Print("[TradeSync EA] Unknown order type: ", sType);
      return;
   }

   bool result = false;
   string label = OrderTypeToString(ot);
   string orderComment = BuildOrderComment(tradeId);

   // ── MARKET ORDERS ──
   if(ot == ORDER_TYPE_BUY || ot == ORDER_TYPE_SELL) {
      MaybeSwapStopsIfReversedForMarket(symbol, ot, sl, tp1);
      if(tpCount > 0)
         tpArr[0] = tp1;

      // Multi-TP: split the requested lot across TP levels — one market position
      // per TP slice (same entry/SL), so total exposure ≈ requested lot.
      if(tpCount > 1) {
         double slices[];
         int useCount = BuildTpLotSlices(symbol, lot, tpCount, tpShareArr, tpShareCount, slices);
         if(useCount < tpCount)
            Print("[TradeSync EA] ⚠ Lot ", DoubleToString(lot, 2), " too small to split across ",
                  tpCount, " TPs (min lot) — placing ", useCount, " order(s).");

         int okCount = 0;
         bool anyFilled = false;
         ulong firstPositionId = 0, firstOrderId = 0, firstDealId = 0;
         double firstFillPrice = 0;
         uint lastFailRetcode = 0;
         int lastFailErr = 0;
         string ordersDetail = "";

         for(int i = 0; i < useCount; i++) {
            double tpI = tpArr[i];
            double slI = sl;
            AdjustStopsForMarket(symbol, ot, slI, tpI);

            Print("[TradeSync EA] Placing ", label, " ", symbol, " slice ", i + 1, "/", useCount,
                  " Lot:", DoubleToString(slices[i], 2), " SL:", slI, " TP:", tpI,
                  " (Ask:", SymbolInfoDouble(symbol, SYMBOL_ASK),
                  " Bid:", SymbolInfoDouble(symbol, SYMBOL_BID), ")");

            bool okI;
            if(ot == ORDER_TYPE_BUY)
               okI = trade.Buy(slices[i], symbol, 0, slI, tpI, orderComment);
            else
               okI = trade.Sell(slices[i], symbol, 0, slI, tpI, orderComment);

            uint rcI = trade.ResultRetcode();
            bool successI = okI && (rcI == TRADE_RETCODE_DONE || rcI == TRADE_RETCODE_DONE_PARTIAL ||
                                    rcI == TRADE_RETCODE_PLACED);
            if(successI) {
               okCount++;
               if(rcI == TRADE_RETCODE_DONE || rcI == TRADE_RETCODE_DONE_PARTIAL)
                  anyFilled = true;
               ulong dealI  = trade.ResultDeal();
               ulong orderI = trade.ResultOrder();
               ulong posI   = 0;
               if(dealI > 0 && HistoryDealSelect(dealI))
                  posI = (ulong)HistoryDealGetInteger(dealI, DEAL_POSITION_ID);
               if(firstOrderId == 0 && firstDealId == 0) {
                  firstPositionId = posI;
                  firstOrderId = orderI;
                  firstDealId = dealI;
                  firstFillPrice = trade.ResultPrice();
               }
               if(StringLen(ordersDetail) > 0) ordersDetail += ",";
               ordersDetail += "{\"lot\":" + DoubleToString(slices[i], 3)
                             + ",\"tp\":" + DoubleToString(tpI, digits)
                             + (posI > 0 ? ",\"positionId\":\"" + IntegerToString((long)posI) + "\"" : "")
                             + (orderI > 0 ? ",\"orderId\":\"" + IntegerToString((long)orderI) + "\"" : "")
                             + (dealI > 0 ? ",\"dealId\":\"" + IntegerToString((long)dealI) + "\"" : "")
                             + "}";
               Print("[TradeSync EA] ✅ Market slice ", i + 1, "/", useCount, " placed: Lot ",
                     DoubleToString(slices[i], 2), " TP:", tpI);
            } else {
               lastFailRetcode = rcI;
               lastFailErr = GetLastError();
               Print("[TradeSync EA] ❌ Market slice ", i + 1, "/", useCount, " failed: Error ", lastFailErr,
                     " RetCode:", rcI, " ", trade.ResultRetcodeDescription());
               if(rcI == 10026)
                  Print("[TradeSync EA] ℹ RetCode 10026 = server blocked automated trading. Prop desk must allow EA/API; terminal Algo Trading button ON.");
            }
         }

         string extraJson = ",\"spreadPips\":" + DoubleToString(spreadPips, 2)
                          + ",\"tpOrdersRequested\":" + IntegerToString(tpCount)
                          + ",\"tpOrdersPlaced\":" + IntegerToString(okCount)
                          + ",\"lotTotal\":" + DoubleToString(lot, 3);
         if(useCount < tpCount)
            extraJson += ",\"note\":\"LOT_SPLIT_REDUCED_TO_" + IntegerToString(useCount) + "_ORDERS\"";
         if(StringLen(ordersDetail) > 0)
            extraJson += ",\"ordersDetail\":[" + ordersDetail + "]";
         if(firstFillPrice > 0 && entry > 0) {
            double pointSym = SymbolInfoDouble(symbol, SYMBOL_POINT);
            if(pointSym > 0)
               extraJson += ",\"slippagePoints\":" + DoubleToString(MathAbs(firstFillPrice - entry) / pointSym, 1);
         }

         string mStatus;
         if(okCount > 0)
            mStatus = anyFilled ? "EXECUTED" : "SUBMITTED";
         else
            mStatus = "FAILED_" + IntegerToString(lastFailRetcode > 0 ? (int)lastFailRetcode : lastFailErr);
         SendACK(mStatus, symbol, sType, tpCount, tradeId, firstPositionId, firstOrderId, firstDealId, "", extraJson);
         return;
      }

      // Single-TP market order (existing path)
      // Validate/adjust stops against current market price
      AdjustStopsForMarket(symbol, ot, sl, tp1);

      Print("[TradeSync EA] Placing ", label, " ", symbol,
            " Lot:", lot, " SL:", sl, " TP:", tp1,
            " (Ask:", SymbolInfoDouble(symbol, SYMBOL_ASK),
            " Bid:", SymbolInfoDouble(symbol, SYMBOL_BID), ")");

      if(ot == ORDER_TYPE_BUY)
         result = trade.Buy(lot, symbol, 0, sl, tp1, orderComment);
      else
         result = trade.Sell(lot, symbol, 0, sl, tp1, orderComment);
   }
   // ── PENDING ORDERS ──
   else {
      if(entry <= 0) {
         Print("[TradeSync EA] Pending order requires entry price!");
         SendACK("NO_ENTRY_PRICE", symbol, sType, 0);
         return;
      }

      datetime expiry = 0;
      // Per-signal expiry from the app (seconds) overrides the EA's PendingExpiry input when present.
      long pendingExpirySeconds = (long)ExtractJsonDouble(signal, "pendingExpirySeconds");
      if(pendingExpirySeconds > 0)
         expiry = TimeCurrent() + (int)pendingExpirySeconds;
      else if(PendingExpiry > 0)
         expiry = TimeCurrent() + PendingExpiry * 3600;
      ENUM_ORDER_TYPE_TIME orderTime = (expiry > 0) ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;

      string pendingCsv = "";
      ulong firstOrderTicket = 0;

      int ordersPlaced = 0;

      MaybeSwapStopsIfReversedForPending(ot, entry, sl, tp1);
      if(tpCount > 0)
         tpArr[0] = tp1;

      // Multi-TP: split the requested lot across TP levels so total ≈ requested lot.
      double slices[];
      int numOrders = 1;
      if(tpCount > 1) {
         numOrders = BuildTpLotSlices(symbol, lot, tpCount, tpShareArr, tpShareCount, slices);
         if(numOrders < tpCount)
            Print("[TradeSync EA] ⚠ Lot ", DoubleToString(lot, 2), " too small to split across ",
                  tpCount, " TPs (min lot) — placing ", numOrders, " order(s).");
      } else {
         ArrayResize(slices, 1);
         slices[0] = lot;
      }

      string ordersDetail = "";

      for(int i = 0; i < numOrders; i++) {
         double tpI  = (i < tpCount) ? tpArr[i] : tp1;
         double slI  = sl;
         double lotI = slices[i];

         // Validate/adjust stops against entry price for pending orders
         AdjustStopsForPending(symbol, ot, entry, slI, tpI);

         Print("[TradeSync EA] Placing pending #", i+1, ": ", label,
               " ", symbol, " @", entry, " Lot:", lotI, " SL:", slI, " TP:", tpI,
               " TimeMode:", (orderTime == ORDER_TIME_SPECIFIED ? "SPECIFIED" : "GTC"));

         switch(ot) {
            case ORDER_TYPE_BUY_LIMIT:
               result = trade.BuyLimit(lotI, entry, symbol, slI, tpI, orderTime, expiry, orderComment);
               break;
            case ORDER_TYPE_BUY_STOP:
               result = trade.BuyStop(lotI, entry, symbol, slI, tpI, orderTime, expiry, orderComment);
               break;
            case ORDER_TYPE_SELL_LIMIT:
               result = trade.SellLimit(lotI, entry, symbol, slI, tpI, orderTime, expiry, orderComment);
               break;
            case ORDER_TYPE_SELL_STOP:
               result = trade.SellStop(lotI, entry, symbol, slI, tpI, orderTime, expiry, orderComment);
               break;
         }

         if(result) {
            ordersPlaced++;
            ulong otick = trade.ResultOrder();
            if(otick > 0) {
               if(firstOrderTicket == 0)
                  firstOrderTicket = otick;
               if(StringLen(pendingCsv) > 0) pendingCsv += ",";
               pendingCsv += IntegerToString((long)otick);
            }
            if(StringLen(ordersDetail) > 0) ordersDetail += ",";
            ordersDetail += "{\"lot\":" + DoubleToString(lotI, 3)
                          + ",\"tp\":" + DoubleToString(tpI, digits)
                          + (otick > 0 ? ",\"orderId\":\"" + IntegerToString((long)otick) + "\"" : "")
                          + "}";
            Print("[TradeSync EA] ✅ Pending order #", i+1, " placed: ", label,
                  " ", symbol, " Lot:", lotI, " @", entry,
                  " SL:", slI, " TP:", tpI,
                  expiry > 0 ? " Expiry:" + TimeToString(expiry) : "");
         } else {
            int err = GetLastError();
            Print("[TradeSync EA] ❌ Pending order #", i+1, " failed: Error ", err,
                  " RetCode:", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
            if(trade.ResultRetcode() == 10026)
               Print("[TradeSync EA] ℹ RetCode 10026 = broker/server blocked automated trading (not EA logic). Enable algo trading for this account in terminal + confirm prop rules.");
         }
      }

      result = (ordersPlaced > 0);
      string pendExtraJson = ",\"spreadPips\":" + DoubleToString(spreadPips, 2)
                           + ",\"tpOrdersRequested\":" + IntegerToString(tpCount)
                           + ",\"tpOrdersPlaced\":" + IntegerToString(ordersPlaced)
                           + ",\"lotTotal\":" + DoubleToString(lot, 3);
      if(tpCount > 1 && numOrders < tpCount)
         pendExtraJson += ",\"note\":\"LOT_SPLIT_REDUCED_TO_" + IntegerToString(numOrders) + "_ORDERS\"";
      if(StringLen(ordersDetail) > 0)
         pendExtraJson += ",\"ordersDetail\":[" + ordersDetail + "]";
      SendACK(result ? "PENDING_PLACED" : "PENDING_FAILED", symbol, sType, tpCount, tradeId, 0, firstOrderTicket, 0, pendingCsv, pendExtraJson);
      return;
   }

   // ACK for market orders
   uint retcode = trade.ResultRetcode();
   string marketExtraJson = ",\"spreadPips\":" + DoubleToString(spreadPips, 2);
   if(result && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_DONE_PARTIAL)) {
      Print("[TradeSync EA] ✅ Market order: ", label, " ", symbol,
            " Lot:", lot, " SL:", sl, " TP:", tp1);
      ulong dealTicket = trade.ResultDeal();
      ulong orderTicket = trade.ResultOrder();
      ulong positionTicket = 0;
      if(dealTicket > 0 && HistoryDealSelect(dealTicket))
         positionTicket = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);

      double fillPrice = trade.ResultPrice();
      if(fillPrice > 0 && entry > 0) {
         double pointSym = SymbolInfoDouble(symbol, SYMBOL_POINT);
         if(pointSym > 0)
            marketExtraJson += ",\"slippagePoints\":" + DoubleToString(MathAbs(fillPrice - entry) / pointSym, 1);
      }

      bool rrSnapTpToFill = ExtractJsonBool(signal, "rrSnapTpToFill", false);
      double rrSnapRatio = ExtractJsonDouble(signal, "rrRatio");
      if(rrSnapTpToFill && rrSnapRatio > 1e-6 && positionTicket > 0)
         SnapTpToRiskRewardFromFill(positionTicket, symbol, rrSnapRatio);

      SendACK("EXECUTED", symbol, sType, tpCount, tradeId, positionTicket, orderTicket, dealTicket, "", marketExtraJson);
   } else if(result && retcode == TRADE_RETCODE_PLACED) {
      ulong orderTicket = trade.ResultOrder();
      Print("[TradeSync EA] ⏳ Market order submitted (async): ", label, " ", symbol,
            " order #", (long)orderTicket, " retcode:", retcode);
      SendACK("SUBMITTED", symbol, sType, tpCount, tradeId, 0, orderTicket, 0, "", marketExtraJson);
   } else {
      int err = GetLastError();
      Print("[TradeSync EA] ❌ Order failed: Error ", err,
            " RetCode:", retcode, " ", trade.ResultRetcodeDescription(),
            " - ", symbol, " ", label);
      if(retcode == 10026)
         Print("[TradeSync EA] ℹ RetCode 10026 = server blocked automated trading. Prop desk must allow EA/API; terminal Algo Trading button ON.");
      string failCode = (retcode > 0) ? IntegerToString((int)retcode) : IntegerToString(err);
      SendACK("FAILED_" + failCode, symbol, sType, 0, tradeId);
   }
}

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result) {
   // Notify app as soon as deals are added (entry and close events).
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   if(!HistoryDealSelect(trans.deal))
      return;

   long magic = (long)HistoryDealGetInteger(trans.deal, DEAL_MAGIC);
   if(magic != MAGIC_NUMBER && !SyncManualTradesToApp)
      return;

   string syncOrigin = (magic == MAGIC_NUMBER) ? "AUTO" : "MANUAL";

   long entry = (long)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   string symbol     = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   ulong  positionId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   ulong  orderId    = (ulong)HistoryDealGetInteger(trans.deal, DEAL_ORDER);
   long   dealType   = (long)HistoryDealGetInteger(trans.deal, DEAL_TYPE);
   string side       = (dealType == DEAL_TYPE_BUY || dealType == DEAL_TYPE_BUY_CANCELED) ? "BUY" : "SELL";

   if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT) {
      double entryPrice = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
      double lot = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);
      double sl = 0;
      double tp = 0;
      if(positionId > 0 && PositionSelectByTicket(positionId)) {
         sl = PositionGetDouble(POSITION_SL);
         tp = PositionGetDouble(POSITION_TP);
      }

      string shotFile = "";
      string shotPath = "";
      CaptureTradeScreenshot("ENTRY", symbol, positionId, trans.deal, shotFile, shotPath);
      long openedAtTs = (long)HistoryDealGetInteger(trans.deal, DEAL_TIME);
      string dealComment = HistoryDealGetString(trans.deal, DEAL_COMMENT);
      string linkedTradeId = TradeIdFromComment(dealComment);
      SendPositionUpdate("POSITION_UPDATE", symbol, side, positionId, orderId, trans.deal, 0, entryPrice, sl, tp, lot, shotFile, shotPath, "ENTRY", syncOrigin, openedAtTs, linkedTradeId);
      if(StringLen(linkedTradeId) > 0)
         SendACK("EXECUTED", symbol, side, 1, linkedTradeId, positionId, orderId, trans.deal);
      return;
   }

   if(entry != DEAL_ENTRY_OUT)
      return; // only closed/partial-close events below

   double profit     = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                     + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                     + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
   long   reasonCode = (long)HistoryDealGetInteger(trans.deal, DEAL_REASON);

   bool   closedByEod = EodConsumeMark(positionId);
   string status = closedByEod ? "CLOSED_EOD" : "CLOSED";
   // DEAL_REASON_SL = any stop fill: loss SL, trailing SL, SL moved past entry — not always a losing exit.
   if(!closedByEod && reasonCode == DEAL_REASON_SL)
      status = (profit > 0.0) ? "CLOSED_SL_PROFIT" : "CLOSED_SL";
   else if(!closedByEod && reasonCode == DEAL_REASON_TP) status = "CLOSED_TP";

   string closeStage = "CLOSE";
   if(status == "CLOSED_EOD") closeStage = "CLOSE_EOD";
   if(status == "CLOSED_SL") closeStage = "CLOSE_SL";
   else if(status == "CLOSED_TP") closeStage = "CLOSE_TP";
   string shotFile = "";
   string shotPath = "";
   CaptureTradeScreenshot(closeStage, symbol, positionId, trans.deal, shotFile, shotPath);

   SendCloseUpdate(status, symbol, positionId, orderId, trans.deal, profit, reasonCode, shotFile, shotPath, closeStage);
   SendAccountSnapshot();
}

//+------------------------------------------------------------------+
string OrderTypeToString(ENUM_ORDER_TYPE ot) {
   switch(ot) {
      case ORDER_TYPE_BUY:        return "BUY";
      case ORDER_TYPE_SELL:       return "SELL";
      case ORDER_TYPE_BUY_LIMIT:  return "BUY LIMIT";
      case ORDER_TYPE_BUY_STOP:   return "BUY STOP";
      case ORDER_TYPE_SELL_LIMIT: return "SELL LIMIT";
      case ORDER_TYPE_SELL_STOP:  return "SELL STOP";
      default:                    return "UNKNOWN";
   }
}

//+------------------------------------------------------------------+
// extraJson: optional pre-built JSON fragment starting with "," (e.g. ",\"spreadPips\":1.2")
void SendACK(string status, string symbol, string type, int tpCount, string tradeId = "", ulong positionId = 0, ulong orderId = 0, ulong dealId = 0, string pendingOrdersCsv = "", string extraJson = "") {
   string ack = "{\"type\":\"ACK\",\"status\":\"" + status
              + "\",\"trade\":{\"symbol\":\"" + symbol
              + "\",\"type\":\"" + type
              + "\",\"tpCount\":" + IntegerToString(tpCount)
              + (StringLen(tradeId) > 0 ? ",\"tradeId\":\"" + tradeId + "\"" : "")
              + "}"
              + (positionId > 0 ? ",\"positionId\":\"" + IntegerToString((long)positionId) + "\"" : "")
              + (orderId > 0 ? ",\"orderId\":\"" + IntegerToString((long)orderId) + "\"" : "")
              + (dealId > 0 ? ",\"dealId\":\"" + IntegerToString((long)dealId) + "\"" : "")
              + (StringLen(pendingOrdersCsv) > 0 ? ",\"pendingOrders\":\"" + pendingOrdersCsv + "\"" : "")
              + extraJson
              + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
              + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
              + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\"}\n";
   SendMessage(ack);
}

//+------------------------------------------------------------------+
void SendPositionUpdate(string status, string symbol, string sType, ulong positionId, ulong orderId, ulong dealId, double profit, double entryPrice, double sl, double tp, double lot, string shotFile = "", string shotPath = "", string shotStage = "", string origin = "AUTO", long openedAtTs = 0, string tradeId = "") {
   string screenshotJson = BuildScreenshotJson(shotStage, symbol, shotFile, shotPath);
   string ack = "{\"type\":\"ACK\",\"status\":\"" + status
              + "\",\"profit\":" + DoubleToString(profit, 2)
              + ",\"origin\":\"" + origin + "\""
              + BuildExcursionJson(positionId, false)
              + ",\"positionId\":\"" + IntegerToString((long)positionId) + "\""
              + ",\"orderId\":\"" + IntegerToString((long)orderId) + "\""
              + ",\"dealId\":\"" + IntegerToString((long)dealId) + "\""
              + ",\"trade\":{\"symbol\":\"" + symbol + "\",\"type\":\"" + sType + "\""
              + ",\"entry\":" + DoubleToString(entryPrice, 5)
              + ",\"sl\":" + DoubleToString(sl, 5)
              + ",\"tp\":" + DoubleToString(tp, 5)
              + ",\"lot\":" + DoubleToString(lot, 2)
              + ((StringLen(tradeId) > 0) ? ",\"tradeId\":\"" + tradeId + "\"" : "")
              + ((openedAtTs > 0) ? ",\"openedAtTs\":" + IntegerToString(openedAtTs) : "")
              + "}"
              + ((StringLen(tradeId) > 0) ? ",\"tradeId\":\"" + tradeId + "\"" : "")
              + screenshotJson
              + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
              + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
              + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\"}\n";
   SendMessage(ack);
}

//+------------------------------------------------------------------+
void SendCloseUpdate(string status, string symbol, ulong positionId, ulong orderId, ulong dealId, double profit, long reasonCode, string shotFile = "", string shotPath = "", string shotStage = "", long closedAtTs = 0, long openedAtTs = 0) {
   long dealMagic = (long)HistoryDealGetInteger(dealId, DEAL_MAGIC);
   string origin = (dealMagic == MAGIC_NUMBER) ? "AUTO" : "MANUAL";
   string sType = "SYNC";
   long dealType = (long)HistoryDealGetInteger(dealId, DEAL_TYPE);
   if(dealType == DEAL_TYPE_BUY || dealType == DEAL_TYPE_BUY_CANCELED) sType = "BUY";
   if(dealType == DEAL_TYPE_SELL || dealType == DEAL_TYPE_SELL_CANCELED) sType = "SELL";
   string screenshotJson = BuildScreenshotJson(shotStage, symbol, shotFile, shotPath);
   if(closedAtTs <= 0)
      closedAtTs = (long)HistoryDealGetInteger(dealId, DEAL_TIME);

   // Flush the sampled P&L series only on the FINAL close (position fully gone);
   // partial-close OUT deals keep the slot alive with running MFE/MAE numbers.
   bool positionGone = (positionId == 0) ? true : !PositionSelectByTicket(positionId);
   string excursionJson = BuildExcursionJson(positionId, positionGone);

   string ack = "{\"type\":\"ACK\",\"status\":\"" + status
              + "\",\"profit\":" + DoubleToString(profit, 2)
              + ",\"origin\":\"" + origin + "\""
              + excursionJson
              + ",\"positionId\":\"" + IntegerToString((long)positionId) + "\""
              + ",\"orderId\":\"" + IntegerToString((long)orderId) + "\""
              + ",\"dealId\":\"" + IntegerToString((long)dealId) + "\""
              + ",\"reason\":\"" + IntegerToString((int)reasonCode) + "\""
              + ((closedAtTs > 0) ? ",\"closedAtTs\":" + IntegerToString(closedAtTs) : "")
              + ((openedAtTs > 0) ? ",\"openedAtTs\":" + IntegerToString(openedAtTs) : "")
              + ",\"trade\":{\"symbol\":\"" + symbol + "\",\"type\":\"" + sType + "\"}"
              + screenshotJson
              + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
              + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
              + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\"}\n";
   SendMessage(ack);
   if(positionGone)
      RemoveExcursionSlot(positionId);
}

//+------------------------------------------------------------------+
void SendPartialCloseUpdate(string symbol, string side, ulong positionId, double closedVolume, double remainingVolume, double price, double profit) {
   string msg = "{\"type\":\"PARTIAL_CLOSE\""
              + ",\"ticket\":\"" + IntegerToString((long)positionId) + "\""
              + ",\"positionId\":\"" + IntegerToString((long)positionId) + "\""
              + ",\"closedVolume\":" + DoubleToString(closedVolume, 3)
              + ",\"remainingVolume\":" + DoubleToString(remainingVolume, 3)
              + ",\"price\":" + DoubleToString(price, 5)
              + ",\"profit\":" + DoubleToString(profit, 2)
              + ",\"trade\":{\"symbol\":\"" + symbol + "\",\"type\":\"" + side + "\"}"
              + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
              + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
              + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\"}\n";
   SendMessage(msg);
}

//+------------------------------------------------------------------+
void BroadcastOpenPositionsPnL() {
   int total = PositionsTotal();
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      string origin = (magic == MAGIC_NUMBER) ? "AUTO" : "MANUAL";
      string symbol = PositionGetString(POSITION_SYMBOL);
      double pnl    = PositionGetDouble(POSITION_PROFIT);
      double entry  = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl     = PositionGetDouble(POSITION_SL);
      double tp     = PositionGetDouble(POSITION_TP);
      double lot    = PositionGetDouble(POSITION_VOLUME);
      long pType    = PositionGetInteger(POSITION_TYPE);
      string side   = (pType == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      long openedAtTs = (long)PositionGetInteger(POSITION_TIME);
      string posComment = PositionGetString(POSITION_COMMENT);
      string linkedTradeId = TradeIdFromComment(posComment);
      string msg = "{\"type\":\"ACK\",\"status\":\"POSITION_UPDATE\""
                 + ",\"profit\":" + DoubleToString(pnl, 2)
                 + ",\"origin\":\"" + origin + "\""
                 + BuildExcursionJson(ticket, false)
                 + ",\"positionId\":\"" + IntegerToString((long)ticket) + "\""
                 + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
                 + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
                 + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\""
                 + ",\"trade\":{\"symbol\":\"" + symbol + "\",\"type\":\"" + side + "\",\"entry\":" + DoubleToString(entry, 5)
                 + ",\"sl\":" + DoubleToString(sl, 5) + ",\"tp\":" + DoubleToString(tp, 5) + ",\"lot\":" + DoubleToString(lot, 2)
                 + ((StringLen(linkedTradeId) > 0) ? ",\"tradeId\":\"" + linkedTradeId + "\"" : "")
                 + ((openedAtTs > 0) ? ",\"openedAtTs\":" + IntegerToString(openedAtTs) : "")
                 + "}"
                 + ((StringLen(linkedTradeId) > 0) ? ",\"tradeId\":\"" + linkedTradeId + "\"" : "")
                 + "}\n";
      SendMessage(msg);
   }
}

//+------------------------------------------------------------------+
void SendAccountSnapshot() {
   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity     = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin     = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);

   string msg = "{\"type\":\"ACK\",\"status\":\"ACCOUNT_SNAPSHOT\""
              + ",\"balance\":" + DoubleToString(balance, 2)
              + ",\"equity\":" + DoubleToString(equity, 2)
              + ",\"margin\":" + DoubleToString(margin, 2)
              + ",\"freeMargin\":" + DoubleToString(freeMargin, 2)
              + ",\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
              + ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\""
              + ",\"name\":\"" + AccountInfoString(ACCOUNT_NAME) + "\""
              + "}\n";
   SendMessage(msg);
}

//+------------------------------------------------------------------+
// Map JSON / EA lookback unit to 0=hours, 1=days, 2=months, 3=all, -1=unknown
int ParseJsonLookbackUnit(string s) {
   string u = s;
   StringTrimLeft(u);
   StringTrimRight(u);
   StringToUpper(u);
   if(u == "HOURS" || u == "HOUR" || u == "H") return 0;
   if(u == "DAYS" || u == "DAY" || u == "D") return 1;
   if(u == "MONTHS" || u == "MONTH" || u == "M") return 2;
   if(u == "ALL" || u == "ALL_HISTORY" || u == "FULL") return 3;
   return -1;
}

datetime ComputeSyncFromTimeByUnit(int unit, int amount) {
   datetime toTime = TimeCurrent();
   if(unit == 3)
      return (datetime)0;
   int amt = amount > 0 ? amount : 1;
   long spanSec = 0;
   if(unit == 0)
      spanSec = (long)amt * 3600L;
   else if(unit == 1)
      spanSec = (long)amt * 86400L;
   else
      spanSec = (long)amt * 30L * 86400L;
   return (datetime)((long)toTime - spanSec);
}

datetime ResolveSyncHistoryFromTime(string jsonStr) {
   string unitStr = ExtractJsonString(jsonStr, "lookbackUnit");
   int jsonUnit = ParseJsonLookbackUnit(unitStr);
   int jsonAmt = (int)ExtractJsonDouble(jsonStr, "lookbackAmount");
   int legacyHours = (int)ExtractJsonDouble(jsonStr, "lookbackHours");

   if(jsonUnit >= 0) {
      if(jsonUnit == 3)
         return (datetime)0;
      int amt = jsonAmt > 0 ? jsonAmt : (legacyHours > 0 ? legacyHours : 1);
      return ComputeSyncFromTimeByUnit(jsonUnit, amt);
   }
   if(legacyHours > 0)
      return (datetime)((long)TimeCurrent() - (long)legacyHours * 3600L);

   int amt = SyncLookbackAmount > 0 ? SyncLookbackAmount : 1;
   return ComputeSyncFromTimeByUnit((int)SyncLookbackUnit, amt);
}

//+------------------------------------------------------------------+
// Resolve a position's open time (DEAL_TIME of its first DEAL_ENTRY_IN deal).
// Selects the position's own history, so call it AFTER collecting the range
// scan results — it replaces the current HistorySelect() window.
long ResolvePositionOpenTs(ulong positionId) {
   if(positionId == 0) return 0;
   if(!HistorySelectByPosition(positionId)) return 0;
   long openTs = 0;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++) {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      if((long)HistoryDealGetInteger(t, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      long ts = (long)HistoryDealGetInteger(t, DEAL_TIME);
      if(ts > 0 && (openTs == 0 || ts < openTs)) openTs = ts;
   }
   return openTs;
}

//+------------------------------------------------------------------+
struct ClosedDealRec {
   ulong  dealTicket;
   ulong  positionId;
   ulong  orderId;
   string symbol;
   double profit;
   long   reasonCode;
   long   closedAtTs;
   string status;
};

//+------------------------------------------------------------------+
void BroadcastRecentClosedDeals(datetime fromTime) {
   datetime toTime = TimeCurrent();
   if((long)fromTime > 0 && fromTime >= toTime)
      fromTime = toTime - 3600;
   if(!HistorySelect(fromTime, toTime)) {
      Print("[TradeSync EA] HistorySelect failed for sync");
      return;
   }

   // Pass 1: collect closed (exit) deals from the range window. We must gather
   // everything first because resolving each position's open time below calls
   // HistorySelectByPosition(), which replaces this range selection.
   ClosedDealRec recs[];
   int total = HistoryDealsTotal();
   for(int i = total - 1; i >= 0; i--) {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;

      long entry = (long)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT) continue;

      double profit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                    + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                    + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      long reasonCode = (long)HistoryDealGetInteger(dealTicket, DEAL_REASON);

      string status = "CLOSED";
      if(reasonCode == DEAL_REASON_SL)
         status = (profit > 0.0) ? "CLOSED_SL_PROFIT" : "CLOSED_SL";
      else if(reasonCode == DEAL_REASON_TP) status = "CLOSED_TP";

      int n = ArraySize(recs);
      ArrayResize(recs, n + 1);
      recs[n].dealTicket = dealTicket;
      recs[n].positionId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      recs[n].orderId    = (ulong)HistoryDealGetInteger(dealTicket, DEAL_ORDER);
      recs[n].symbol     = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      recs[n].profit     = profit;
      recs[n].reasonCode = reasonCode;
      recs[n].closedAtTs = (long)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      recs[n].status     = status;
      if(ArraySize(recs) >= 200) break; // avoid flooding on manual refresh
   }

   // Pass 2: resolve each position's real open time and push the close update.
   // SendCloseUpdate reads the close deal's fields via HistorySelectByPosition,
   // which keeps that deal in scope, so the original dealTicket stays valid.
   int sent = 0;
   for(int j = 0; j < ArraySize(recs); j++) {
      long openedAtTs = ResolvePositionOpenTs(recs[j].positionId);
      SendCloseUpdate(recs[j].status, recs[j].symbol, recs[j].positionId, recs[j].orderId,
                      recs[j].dealTicket, recs[j].profit, recs[j].reasonCode,
                      "", "", "", recs[j].closedAtTs, openedAtTs);
      sent++;
   }

   string rangeNote = ((long)fromTime <= 0) ? "ALL→now" : TimeToString(fromTime, TIME_DATE | TIME_MINUTES) + "→now";
   Print("[TradeSync EA] Sync pushed ", sent, " closed deal update(s) (", rangeNote, ")");
}

//+------------------------------------------------------------------+
bool SendMessage(string msg) {
   if(socketHandle == INVALID_HANDLE || !isConnected) return false;
   uchar buf[];
   int len = StringToCharArray(msg, buf, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(buf, len - 1); // strip null terminator
   if(ArraySize(buf) == 0) return false;
   int bytesSent = SocketSend(socketHandle, buf, ArraySize(buf));
   if(bytesSent > 0) {
      if(EnableLogs) Print("[TradeSync EA] Sent: ", StringSubstr(msg, 0, 140));
      return true;
   }
   // bytesSent == 0 → socket closed by remote; < 0 → error
   Print("[TradeSync EA] SocketSend returned ", bytesSent, " for: ", StringSubstr(msg, 0, 40));
   return false; // let caller handle — do NOT destroy socket here
}

//+------------------------------------------------------------------+
// JSON helpers
//+------------------------------------------------------------------+

string ExtractJsonString(string json, string key) {
   string search = "\"" + key + "\":\"";
   int start = StringFind(json, search);
   if(start < 0) return "";
   start += StringLen(search);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

double ExtractJsonDouble(string json, string key) {
   string search = "\"" + key + "\":";
   int start = StringFind(json, search);
   if(start < 0) return 0;
   start += StringLen(search);
   while(start < StringLen(json) && StringGetCharacter(json, start) == ' ') start++;
   string rest = StringSubstr(json, start);
   int end = 0;
   while(end < StringLen(rest)) {
      ushort c = StringGetCharacter(rest, end);
      if(c != '.' && (c < '0' || c > '9') && c != '-') break;
      end++;
   }
   return StringToDouble(StringSubstr(rest, 0, end));
}

bool ExtractJsonBool(string json, string key, bool fallback = false) {
   string search = "\"" + key + "\":";
   int start = StringFind(json, search);
   if(start < 0) return fallback;
   start += StringLen(search);
   while(start < StringLen(json) && StringGetCharacter(json, start) == ' ') start++;

   string rest = StringSubstr(json, start);
   if(StringFind(rest, "true") == 0) return true;
   if(StringFind(rest, "false") == 0) return false;

   int end = 0;
   while(end < StringLen(rest)) {
      ushort c = StringGetCharacter(rest, end);
      if(c != '.' && (c < '0' || c > '9') && c != '-') break;
      end++;
   }
   if(end <= 0) return fallback;
   return StringToDouble(StringSubstr(rest, 0, end)) != 0.0;
}

bool ParseHHMM(string t, int &h, int &m) {
   StringTrimLeft(t);
   StringTrimRight(t);
   int c = StringFind(t, ":");
   if(c < 0) return false;
   h = (int)StringToInteger(StringSubstr(t, 0, c));
   m = (int)StringToInteger(StringSubstr(t, c + 1));
   if(h < 0 || h > 23 || m < 0 || m > 59) return false;
   return true;
}

void ApplyEndOfDaySettingsFromJson(string jsonStr) {
   if(StringFind(jsonStr, "\"enableEndOfDayClose\"") >= 0)
      gEnableEodClose = ExtractJsonBool(jsonStr, "enableEndOfDayClose", gEnableEodClose);
   if(StringFind(jsonStr, "\"endOfDayCloseTime\"") >= 0) {
      string ts = ExtractJsonString(jsonStr, "endOfDayCloseTime");
      int eh = 0, em = 0;
      if(ParseHHMM(ts, eh, em)) {
         gEodHour = eh;
         gEodMinute = em;
         if(EnableLogs)
            Print("[TradeSync EA] End-of-day: server time ", IntegerToString(eh), ":", (em < 10 ? "0" : ""), IntegerToString(em),
                  " enabled=", gEnableEodClose);
      }
   }
}

void EodMarkTicket(ulong ticket) {
   for(int i = 0; i < ArraySize(gEodMarkedTickets); i++)
      if(gEodMarkedTickets[i] == ticket) return;
   int n = ArraySize(gEodMarkedTickets);
   ArrayResize(gEodMarkedTickets, n + 1);
   gEodMarkedTickets[n] = ticket;
}

void EodRemoveMark(ulong ticket) {
   for(int i = 0; i < ArraySize(gEodMarkedTickets); i++) {
      if(gEodMarkedTickets[i] != ticket) continue;
      int last = ArraySize(gEodMarkedTickets) - 1;
      if(i != last) gEodMarkedTickets[i] = gEodMarkedTickets[last];
      ArrayResize(gEodMarkedTickets, last);
      return;
   }
}

bool EodConsumeMark(ulong ticket) {
   for(int i = 0; i < ArraySize(gEodMarkedTickets); i++) {
      if(gEodMarkedTickets[i] != ticket) continue;
      int last = ArraySize(gEodMarkedTickets) - 1;
      if(i != last) gEodMarkedTickets[i] = gEodMarkedTickets[last];
      ArrayResize(gEodMarkedTickets, last);
      return true;
   }
   return false;
}

void ExecuteEndOfDayCloseAll() {
   ulong tickets[];
   int total = PositionsTotal();
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(!ManageManualPositions && magic != MAGIC_NUMBER) continue;
      int n = ArraySize(tickets);
      ArrayResize(tickets, n + 1);
      tickets[n] = ticket;
   }
   if(ArraySize(tickets) == 0) {
      if(EnableLogs) Print("[TradeSync EA] EOD close: no eligible positions (EA magic ", (long)MAGIC_NUMBER, ").");
      return;
   }
   for(int j = 0; j < ArraySize(tickets); j++) {
      EodMarkTicket(tickets[j]);
      ResetLastError();
      if(!trade.PositionClose(tickets[j])) {
         Print("[TradeSync EA] EOD PositionClose failed ticket=", (long)tickets[j], " err=", GetLastError(),
               " ret=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
         EodRemoveMark(tickets[j]);
      }
   }
   Print("[TradeSync EA] End-of-day market close requested for ", IntegerToString(ArraySize(tickets)), " position(s).");
}

void MaybeTriggerScheduledEndOfDayClose() {
   if(!gEnableEodClose) return;
   datetime nowSrv = TimeTradeServer();
   MqlDateTime dt;
   TimeToStruct(nowSrv, dt);
   int ymd = dt.year * 10000 + dt.mon * 100 + dt.day;
   if(dt.hour != gEodHour || dt.min != gEodMinute)
      return;
   if(ymd == gLastEodCloseYyyymmdd)
      return;
   gLastEodCloseYyyymmdd = ymd;
   if(EnableLogs) Print("[TradeSync EA] Scheduled end-of-day close at server time (yyyymmdd=", IntegerToString(ymd), ")");
   ExecuteEndOfDayCloseAll();
}

// Extract raw array string: "key":[...]
string ExtractJsonArray(string json, string key) {
   string search = "\"" + key + "\":[";
   int start = StringFind(json, search);
   if(start < 0) return "";
   int arrStart = StringFind(json, "[", start + StringLen("\"" + key + "\":"));
   if(arrStart < 0) return "";
   int end = StringFind(json, "]", arrStart);
   if(end < 0) return "";
   return StringSubstr(json, arrStart + 1, end - arrStart - 1);
}

// Parse comma-separated doubles into array
void ParseDoubleArray(string raw, double &arr[], int &count) {
   count = 0;
   if(StringLen(raw) == 0) return;
   string parts[];
   int n = StringSplit(raw, ',', parts);
   for(int i = 0; i < n && count < 10; i++) {
      StringTrimLeft(parts[i]);
      StringTrimRight(parts[i]);
      double v = StringToDouble(parts[i]);
      if(v > 0) { arr[count++] = v; }
   }
}

string ExtractJsonObject(string json, string key) {
   string search = "\"" + key + "\":{";
   int start = StringFind(json, search);
   if(start < 0) { search = "\"" + key + "\": {"; start = StringFind(json, search); }
   if(start < 0) return "";
   int braceStart = StringFind(json, "{", start + StringLen("\"" + key + "\":"));
   if(braceStart < 0) return "";
   int depth = 1, pos = braceStart + 1;
   while(pos < StringLen(json) && depth > 0) {
      ushort c = StringGetCharacter(json, pos);
      if(c == '{') depth++;
      else if(c == '}') depth--;
      pos++;
   }
   return StringSubstr(json, braceStart, pos - braceStart);
}

void OnTick() {}
