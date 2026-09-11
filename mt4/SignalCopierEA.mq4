//+------------------------------------------------------------------+
//|                                              SignalCopierEA.mq4  |
//|                           TradeSync - Telegram Signal Copier MT4 |
//|                                         Version 1.4               |
//+------------------------------------------------------------------+
#property copyright "TradeSync"
#property strict

enum ENUM_SYNC_LOOKBACK_UNIT {
   SYNC_LB_HOURS = 0,   // Hours
   SYNC_LB_DAYS = 1,    // Days
   SYNC_LB_MONTHS = 2,  // Months (30 calendar days each)
   SYNC_LB_ALL = 3      // All history in terminal
};

enum ENUM_TS_MT4_ROLE {
   TS_MT4_EXECUTE_AND_SYNC = 0, // Receive SIGNAL and place orders (classic copier)
   TS_MT4_SYNC_ONLY = 1         // Import/sync trades only; SIGNAL never executes
};

// Input parameters (bridge is FILE-only — shared folder with Trade Station)
input string   FileBridgeFolder = "TradeStationFileBridge"; // Subfolder under terminal MQL4\\Files (same absolute path as app settings)
input double   DefaultLot     = 0.01;         // Default lot size
input int      Slippage       = 30;           // Max slippage (points)
input bool     UseAppLotSize  = true;         // Use lot size from app
input bool     EnableLogs     = true;         // Enable detailed logs
input ENUM_TS_MT4_ROLE EARole = TS_MT4_SYNC_ONLY; // SYNC_ONLY = retrieve trades only (no OrderSend from app)
input ENUM_SYNC_LOOKBACK_UNIT SyncLookbackUnit = SYNC_LB_HOURS; // Default window when app omits lookback fields
input int      SyncLookbackAmount = 24;       // Count for unit above (ignored when unit is ALL)
input bool     ForceMarket    = false;        // Force all orders as market orders
input int      PendingExpiry  = 0;            // Pending order expiry in hours (0=no expiry)
input bool     EnableTradeScreenshots = true; // Capture screenshots on entry/close events
input int      ScreenshotWidth = 1280;        // Screenshot width in pixels
input int      ScreenshotHeight = 720;        // Screenshot height in pixels

#define MAGIC_NUMBER  202401
#define MAX_HELLO_RETRY 5

bool     isConnected = false;
bool     helloSent = false;
int      helloRetries = 0;
datetime lastPnlPush = 0;
string   recvBuffer = "";
long     gAppToEaReadPos = 0;

int knownHistoryTickets[];
int knownHistoryCount = 0;

//+------------------------------------------------------------------+
// Map JSON / EA lookback unit -> 0=hours, 1=days, 2=months, 3=all, -1=unknown (aligned with MT5 EA)
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
      spanSec = (long)amt * 3600;
   else if(unit == 1)
      spanSec = (long)amt * 86400;
   else
      spanSec = (long)amt * 30 * 86400;
   return (datetime)((long)toTime - spanSec);
}

datetime IncrementalHistoryFromTime() {
   if(SyncLookbackUnit == SYNC_LB_ALL)
      return (datetime)((long)TimeCurrent() - 172800); // 48h cap
   return ComputeSyncFromTimeByUnit((int)SyncLookbackUnit, SyncLookbackAmount > 0 ? SyncLookbackAmount : 1);
}

//+------------------------------------------------------------------+
// JSON helpers (used by TCP messages and signals)
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

void ParseDoubleArray(string raw, double &arr[], int &count) {
   count = 0;
   if(StringLen(raw) == 0) return;
   string parts[];
   int n = StringSplit(raw, ',', parts);
   for(int i = 0; i < n && count < 10; i++) {
      StringTrimLeft(parts[i]);
      StringTrimRight(parts[i]);
      double v = StringToDouble(parts[i]);
      if(v > 0) arr[count++] = v;
   }
}

string ExtractJsonObject(string json, string key) {
   string search = "\"" + key + "\":{";
   int start = StringFind(json, search);
   if(start < 0) {
      search = "\"" + key + "\": {";
      start = StringFind(json, search);
   }
   if(start < 0) return "";
   int braceStart = StringFind(json, "{", start + StringLen("\"" + key + "\":"));
   if(braceStart < 0) return "";
   int depth = 1;
   int pos = braceStart + 1;
   while(pos < StringLen(json) && depth > 0) {
      ushort c = StringGetCharacter(json, pos);
      if(c == '{') depth++;
      else if(c == '}') depth--;
      pos++;
   }
   return StringSubstr(json, braceStart, pos - braceStart);
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
      return (datetime)((long)TimeCurrent() - (long)legacyHours * 3600);

   int amt = SyncLookbackAmount > 0 ? SyncLookbackAmount : 1;
   return ComputeSyncFromTimeByUnit((int)SyncLookbackUnit, amt);
}

//+------------------------------------------------------------------+
int OnInit() {
   SeedKnownHistoryTickets();
   recvBuffer = "";
   gAppToEaReadPos = 0;

   string folderUse = FileBridgeFolder;
   StringTrimLeft(folderUse);
   StringTrimRight(folderUse);
   if(StringLen(folderUse) < 1)
      folderUse = "TradeStationFileBridge";

   Print("[TradeSync MT4 EA] v1.4 FILE bridge — folder MQL4\\Files\\", folderUse);
   Print("[TradeSync MT4 EA] Role: ", (EARole == TS_MT4_SYNC_ONLY ? "SYNC_ONLY (no execution)" : "EXECUTE_AND_SYNC"),
         " | Sync default: unit=", SyncLookbackUnit, " amount=", SyncLookbackAmount);
   Print("[TradeSync MT4 EA] Account: ", AccountName(),
         " | Login: ", AccountNumber(),
         " | Server: ", AccountServer());
   Print("[TradeSync MT4 EA] Paste this path into Trade Station Settings: ",
         TerminalInfoString(TERMINAL_DATA_PATH), "\\MQL4\\Files\\", folderUse);

   FolderCreate(folderUse);
   isConnected = true;
   helloSent = false;
   helloRetries = 0;
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
   EventKillTimer();
   isConnected = false;
   helloSent = false;
}

//+------------------------------------------------------------------+
void OnTick() {}

//+------------------------------------------------------------------+
void OnTrade() {
   if(!helloSent) return;
   BroadcastOpenPositionsPnL();
   BroadcastRecentClosedOrders(IncrementalHistoryFromTime(), false);
   SendAccountSnapshot();
}

//+------------------------------------------------------------------+
void OnTimer() {
   if(!helloSent && helloRetries < MAX_HELLO_RETRY) {
      if(SendHello()) {
         helloRetries++;
         Print("[TradeSync MT4 EA] HELLO sent FILE (attempt ", helloRetries, ")");
      }
   }
   PollAppToEaFile();
   if(helloSent && (TimeCurrent() - lastPnlPush >= 2)) {
      BroadcastOpenPositionsPnL();
      lastPnlPush = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
void PollAppToEaFile() {
   string folderUse = FileBridgeFolder;
   StringTrimLeft(folderUse);
   StringTrimRight(folderUse);
   if(StringLen(folderUse) < 1)
      folderUse = "TradeStationFileBridge";
   string fn = folderUse + "\\app_to_ea.txt";

   int fh = FileOpen(fn, FILE_READ | FILE_BIN);
   if(fh == INVALID_HANDLE)
      return;

   int sz = (int)FileSize(fh);
   if(sz < gAppToEaReadPos)
      gAppToEaReadPos = 0;
   if(sz <= gAppToEaReadPos) {
      FileClose(fh);
      return;
   }

   FileSeek(fh, gAppToEaReadPos, SEEK_SET);
   int nBytes = sz - (int)gAppToEaReadPos;
   uchar raw[];
   ArrayResize(raw, nBytes);
   uint got = FileReadArray(fh, raw, 0, nBytes);
   FileClose(fh);
   gAppToEaReadPos = sz;

   if(got <= 0)
      return;

   string chunk = CharArrayToString(raw, 0, (int)got, CP_UTF8);
   recvBuffer += chunk;
   ProcessBuffer();
}

//+------------------------------------------------------------------+
void ProcessBuffer() {
   int newlinePos;
   while((newlinePos = StringFind(recvBuffer, "\n")) >= 0) {
      string line = StringSubstr(recvBuffer, 0, newlinePos);
      recvBuffer = StringSubstr(recvBuffer, newlinePos + 1);
      StringTrimLeft(line);
      StringTrimRight(line);
      if(StringLen(line) > 0) ProcessMessage(line);
   }
}

//+------------------------------------------------------------------+
void ProcessMessage(string jsonStr) {
   if(EnableLogs) Print("[TradeSync MT4 EA] Received: ", jsonStr);
   string msgType = ExtractJsonString(jsonStr, "type");
   if(StringLen(msgType) == 0) {
      if(StringFind(jsonStr, "\"SYNC_REQUEST\"") >= 0) msgType = "SYNC_REQUEST";
      else if(StringFind(jsonStr, "\"PING\"") >= 0) msgType = "PING";
      else if(StringFind(jsonStr, "\"SIGNAL\"") >= 0) msgType = "SIGNAL";
      else if(StringFind(jsonStr, "\"HELLO_ACK\"") >= 0) msgType = "HELLO_ACK";
   }

   if(msgType == "HELLO_ACK") {
      helloSent = true;
      helloRetries = 0;
      Print("[TradeSync MT4 EA] Handshake complete.");
      return;
   }
   if(msgType == "PING") {
      SendMessage("{\"type\":\"PONG\"}\n");
      return;
   }
   if(msgType == "SIGNAL") {
      ProcessSignal(jsonStr);
      return;
   }
   if(msgType == "SYNC_REQUEST") {
      datetime fromTime = ResolveSyncHistoryFromTime(jsonStr);
      if(EnableLogs) {
         if((long)fromTime <= 0)
            Print("[TradeSync MT4 EA] SYNC_REQUEST window: ALL history");
         else
            Print("[TradeSync MT4 EA] SYNC_REQUEST from ", TimeToString(fromTime, TIME_DATE | TIME_MINUTES));
      }
      SendMessage("{\"type\":\"ACK\",\"status\":\"SYNC_STARTED\"}\n");
      SendAccountSnapshot();
      BroadcastOpenPositionsPnL();
      BroadcastRecentClosedOrders(fromTime, true);
      SendMessage("{\"type\":\"ACK\",\"status\":\"SYNC_DONE\"}\n");
      return;
   }
}

//+------------------------------------------------------------------+
int ResolveOrderCmd(string sym, string side, double entryPrice, string orderKind) {
   string s = side;
   string k = orderKind;
   StringToUpper(s);
   StringToUpper(k);

   if(StringFind(k, "BUY LIMIT") >= 0 || StringFind(s, "BUY LIMIT") >= 0) return OP_BUYLIMIT;
   if(StringFind(k, "BUY STOP") >= 0  || StringFind(s, "BUY STOP") >= 0) return OP_BUYSTOP;
   if(StringFind(k, "SELL LIMIT") >= 0 || StringFind(s, "SELL LIMIT") >= 0) return OP_SELLLIMIT;
   if(StringFind(k, "SELL STOP") >= 0  || StringFind(s, "SELL STOP") >= 0) return OP_SELLSTOP;

   // Explicit MARKET - do not infer pending types from stale signal entry vs live Bid/Ask
   if(StringFind(k, "MARKET") >= 0) {
      if(EnableLogs) Print("[TradeSync MT4 EA] orderType MARKET -> market execution");
      if(StringFind(s, "BUY") >= 0) return OP_BUY;
      if(StringFind(s, "SELL") >= 0) return OP_SELL;
   }

   if(entryPrice > 0 && !ForceMarket) {
      double ask = MarketInfo(sym, MODE_ASK);
      double bid = MarketInfo(sym, MODE_BID);
      double point = MarketInfo(sym, MODE_POINT);
      double threshold = 2.0 * point;

      if(StringFind(s, "BUY") >= 0) {
         if(entryPrice <= ask - threshold) return OP_BUYLIMIT;
         if(entryPrice >= ask + threshold) return OP_BUYSTOP;
      }
      if(StringFind(s, "SELL") >= 0) {
         if(entryPrice >= bid + threshold) return OP_SELLLIMIT;
         if(entryPrice <= bid - threshold) return OP_SELLSTOP;
      }
   }

   if(StringFind(s, "BUY") >= 0) return OP_BUY;
   if(StringFind(s, "SELL") >= 0) return OP_SELL;
   return -1;
}

//+------------------------------------------------------------------+
void AdjustStopsForPending(string sym, int cmd, double entry, double &sl, double &tp) {
   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   int stopLevel = (int)MarketInfo(sym, MODE_STOPLEVEL);
   double minDist = (stopLevel + 2) * point;

   bool isBuy = (cmd == OP_BUYLIMIT || cmd == OP_BUYSTOP);
   if(isBuy) {
      if(sl > 0 && sl >= entry - minDist) sl = NormalizeDouble(entry - minDist, digits);
      if(tp > 0 && tp <= entry + minDist) tp = NormalizeDouble(entry + minDist, digits);
   } else {
      if(sl > 0 && sl <= entry + minDist) sl = NormalizeDouble(entry + minDist, digits);
      if(tp > 0 && tp >= entry - minDist) tp = NormalizeDouble(entry - minDist, digits);
   }
}

//+------------------------------------------------------------------+
void MaybeSwapStopsIfReversedForMarket(string sym, int cmd, double &sl, double &tp) {
   if(sl <= 0 || tp <= 0) return;
   RefreshRates();
   double ask = MarketInfo(sym, MODE_ASK);
   double bid = MarketInfo(sym, MODE_BID);
   if(cmd == OP_BUY) {
      if(sl >= ask && tp <= ask) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync MT4 EA] Swapped SL/TP: BUY signal had SELL-side layout.");
      }
   } else if(cmd == OP_SELL) {
      if(sl <= bid && tp >= bid) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync MT4 EA] Swapped SL/TP: SELL signal had BUY-side layout.");
      }
   }
}

void MaybeSwapStopsIfReversedForPending(int cmd, double entry, double &sl, double &tp) {
   if(sl <= 0 || tp <= 0 || entry <= 0) return;
   bool isBuy = (cmd == OP_BUYLIMIT || cmd == OP_BUYSTOP);
   if(isBuy) {
      if(sl >= entry && tp <= entry) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync MT4 EA] Swapped SL/TP: pending BUY vs entry.");
      }
   } else {
      if(sl <= entry && tp >= entry) {
         double tmp = sl;
         sl = tp;
         tp = tmp;
         Print("[TradeSync MT4 EA] Swapped SL/TP: pending SELL vs entry.");
      }
   }
}

//+------------------------------------------------------------------+
void AdjustStopsForMarket(string sym, int cmd, double &sl, double &tp) {
   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   int stopLevel = (int)MarketInfo(sym, MODE_STOPLEVEL);
   double minDist = (stopLevel + 2) * point;

   double ask = MarketInfo(sym, MODE_ASK);
   double bid = MarketInfo(sym, MODE_BID);

   if(cmd == OP_BUY) {
      double refPrice = ask;
      if(sl > 0) {
         double maxSL = NormalizeDouble(refPrice - minDist, digits);
         if(sl >= refPrice) {
            Print("[TradeSync MT4 EA] WARN: SL above Ask - zeroing SL. (SL:", sl, " Ask:", ask, ")");
            sl = 0;
         } else if(sl > maxSL) {
            Print("[TradeSync MT4 EA] WARN: SL too close to Ask. Adjusting from ", sl, " to ", maxSL);
            sl = maxSL;
         }
      }
      if(tp > 0) {
         double minTP = NormalizeDouble(refPrice + minDist, digits);
         if(tp <= refPrice) {
            Print("[TradeSync MT4 EA] WARN: TP below Ask - zeroing TP. (TP:", tp, " Ask:", ask, ")");
            tp = 0;
         } else if(tp < minTP) {
            Print("[TradeSync MT4 EA] WARN: TP too close to Ask. Adjusting from ", tp, " to ", minTP);
            tp = minTP;
         }
      }
   } else if(cmd == OP_SELL) {
      double refPrice = bid;
      if(sl > 0) {
         double minSL = NormalizeDouble(refPrice + minDist, digits);
         if(sl <= refPrice) {
            Print("[TradeSync MT4 EA] WARN: SL below Bid - zeroing SL. (SL:", sl, " Bid:", bid, ")");
            sl = 0;
         } else if(sl < minSL) {
            Print("[TradeSync MT4 EA] WARN: SL too close to Bid. Adjusting from ", sl, " to ", minSL);
            sl = minSL;
         }
      }
      if(tp > 0) {
         double maxTP = NormalizeDouble(refPrice - minDist, digits);
         if(tp >= refPrice) {
            Print("[TradeSync MT4 EA] WARN: TP above Bid - zeroing TP. (TP:", tp, " Bid:", bid, ")");
            tp = 0;
         } else if(tp > maxTP) {
            Print("[TradeSync MT4 EA] WARN: TP too close to Bid. Adjusting from ", tp, " to ", maxTP);
            tp = maxTP;
         }
      }
   }
}

//+------------------------------------------------------------------+
void ProcessSignal(string jsonStr) {
   string signal = ExtractJsonObject(jsonStr, "signal");
   if(StringLen(signal) == 0) return;

   string symbol = ExtractJsonString(signal, "symbol");
   string side = ExtractJsonString(signal, "type");
   string orderKind = ExtractJsonString(signal, "orderType");
   StringToUpper(side);
   StringToUpper(orderKind);
   string tradeId = ExtractJsonString(signal, "tradeId");
   if(StringLen(tradeId) == 0) {
      long tradeIdNum = (long)ExtractJsonDouble(signal, "tradeId");
      if(tradeIdNum > 0) tradeId = IntegerToString(tradeIdNum);
   }
   double entry = ExtractJsonDouble(signal, "entry");
   double sl = ExtractJsonDouble(signal, "sl");
   double lot = ExtractJsonDouble(signal, "lot");
   if(lot <= 0 || !UseAppLotSize) lot = DefaultLot;

   double tpArr[10];
   int tpCount = 0;
   string tpRaw = ExtractJsonArray(signal, "tp");
   ParseDoubleArray(tpRaw, tpArr, tpCount);
   double tp1 = (tpCount > 0 ? tpArr[0] : 0);

   if(StringLen(symbol) == 0 || StringLen(side) == 0) return;

   if(EARole == TS_MT4_SYNC_ONLY) {
      if(EnableLogs) Print("[TradeSync MT4 EA] SYNC_ONLY: SIGNAL ignored (no execution)");
      SendACK("IGNORED_SYNC_ONLY", symbol, side, tpCount, tradeId);
      return;
   }

   if(!SymbolSelect(symbol, true)) {
      SendACK("SYMBOL_NOT_FOUND", symbol, side, 0, tradeId);
      return;
   }

   int digits = (int)MarketInfo(symbol, MODE_DIGITS);
   entry = NormalizeDouble(entry, digits);
   sl = (sl > 0 ? NormalizeDouble(sl, digits) : 0);
   tp1 = (tp1 > 0 ? NormalizeDouble(tp1, digits) : 0);
   for(int i = 0; i < tpCount; i++) tpArr[i] = NormalizeDouble(tpArr[i], digits);

   int cmd = ResolveOrderCmd(symbol, side, entry, orderKind);
   if(cmd < 0) return;

   bool market = (cmd == OP_BUY || cmd == OP_SELL);
   int ordersPlaced = 0;
   int lastTicket = -1;

   if(market) {
      RefreshRates();
      MaybeSwapStopsIfReversedForMarket(symbol, cmd, sl, tp1);
      AdjustStopsForMarket(symbol, cmd, sl, tp1);
      double price = (cmd == OP_BUY ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID));
      lastTicket = OrderSend(symbol, cmd, lot, price, Slippage, sl, tp1, "TradeSync", MAGIC_NUMBER, 0, clrNONE);
      if(lastTicket > 0) {
         ordersPlaced = 1;
         string shotFile = "";
         string shotPath = "";
         CaptureTradeScreenshot("ENTRY", symbol, shotFile, shotPath);
         SendPositionUpdate("POSITION_UPDATE", symbol, side, lastTicket, lastTicket, lastTicket, 0, price, sl, tp1, lot, shotFile, shotPath, "ENTRY");
      }
   } else {
      if(entry <= 0) {
         SendACK("NO_ENTRY_PRICE", symbol, side, 0, tradeId);
         return;
      }
      int numOrders = (tpCount > 1 ? tpCount : 1);
      datetime expiry = 0;
      if(PendingExpiry > 0) expiry = TimeCurrent() + PendingExpiry * 3600;

      MaybeSwapStopsIfReversedForPending(cmd, entry, sl, tp1);
      if(tpCount > 0) tpArr[0] = tp1;

      for(int j = 0; j < numOrders; j++) {
         double tpX = (j < tpCount ? tpArr[j] : tp1);
         double slX = sl;
         AdjustStopsForPending(symbol, cmd, entry, slX, tpX);
         int tk = OrderSend(symbol, cmd, lot, entry, Slippage, slX, tpX, "TradeSync", MAGIC_NUMBER, expiry, clrNONE);
         if(tk > 0) {
            ordersPlaced++;
            lastTicket = tk;
         }
      }
   }

   if(ordersPlaced > 0) {
      if(market) SendACK("EXECUTED", symbol, side, tpCount, tradeId, lastTicket, lastTicket, lastTicket);
      else SendACK("PENDING_PLACED", symbol, side, tpCount, tradeId, lastTicket, lastTicket, lastTicket);
   } else {
      int err = GetLastError();
      if(err == 4756)
         Print("[TradeSync MT4 EA] INFO: Error ", err,
               " often means broker/server blocked EA/automated trading or trading disabled (confirm prop rules + terminal AutoTrading).");
      if(market) SendACK("FAILED_" + IntegerToString(err), symbol, side, 0, tradeId);
      else SendACK("PENDING_FAILED", symbol, side, tpCount, tradeId);
   }
}

//+------------------------------------------------------------------+
void SendACK(string status, string symbol, string side, int tpCount, string tradeId = "", int positionId = 0, int orderId = 0, int dealId = 0) {
   string ack = "{\"type\":\"ACK\",\"status\":\"" + status
              + "\",\"trade\":{\"symbol\":\"" + JsonEscape(symbol)
              + "\",\"type\":\"" + JsonEscape(side)
              + "\",\"tpCount\":" + IntegerToString(tpCount)
              + (StringLen(tradeId) > 0 ? ",\"tradeId\":\"" + JsonEscape(tradeId) + "\"" : "")
              + "}"
              + (positionId > 0 ? ",\"positionId\":\"" + IntegerToString(positionId) + "\"" : "")
              + (orderId > 0 ? ",\"orderId\":\"" + IntegerToString(orderId) + "\"" : "")
              + (dealId > 0 ? ",\"dealId\":\"" + IntegerToString(dealId) + "\"" : "")
              + ",\"login\":\"" + IntegerToString(AccountNumber()) + "\""
              + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
              + ",\"name\":\"" + JsonEscape(AccountName()) + "\"}\n";
   SendMessage(ack);
}

//+------------------------------------------------------------------+
void SendPositionUpdate(string status, string symbol, string side, int positionId, int orderId, int dealId, double profit, double entryPrice, double sl, double tp, double lot, string shotFile = "", string shotPath = "", string shotStage = "") {
   string screenshotJson = BuildScreenshotJson(shotStage, symbol, shotFile, shotPath);
   string ack = "{\"type\":\"ACK\",\"status\":\"" + status
              + "\",\"profit\":" + DoubleToString(profit, 2)
              + ",\"origin\":\"AUTO\""
              + ",\"positionId\":\"" + IntegerToString(positionId) + "\""
              + ",\"orderId\":\"" + IntegerToString(orderId) + "\""
              + ",\"dealId\":\"" + IntegerToString(dealId) + "\""
              + ",\"trade\":{\"symbol\":\"" + JsonEscape(symbol) + "\",\"type\":\"" + JsonEscape(side) + "\""
              + ",\"entry\":" + DoubleToString(entryPrice, 5)
              + ",\"sl\":" + DoubleToString(sl, 5)
              + ",\"tp\":" + DoubleToString(tp, 5)
              + ",\"lot\":" + DoubleToString(lot, 2)
              + "}"
              + screenshotJson
              + ",\"login\":\"" + IntegerToString(AccountNumber()) + "\""
              + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
              + ",\"name\":\"" + JsonEscape(AccountName()) + "\"}\n";
   SendMessage(ack);
}

//+------------------------------------------------------------------+
void SendCloseUpdate(string status, string symbol, int positionId, int orderId, int dealId, double profit, string side, string origin, string shotFile = "", string shotPath = "", string shotStage = "") {
   string screenshotJson = BuildScreenshotJson(shotStage, symbol, shotFile, shotPath);
   string ack = "{\"type\":\"ACK\",\"status\":\"" + status
              + "\",\"profit\":" + DoubleToString(profit, 2)
              + ",\"origin\":\"" + JsonEscape(origin) + "\""
              + ",\"positionId\":\"" + IntegerToString(positionId) + "\""
              + ",\"orderId\":\"" + IntegerToString(orderId) + "\""
              + ",\"dealId\":\"" + IntegerToString(dealId) + "\""
              + ",\"trade\":{\"symbol\":\"" + JsonEscape(symbol) + "\",\"type\":\"" + JsonEscape(side) + "\"}"
              + screenshotJson
              + ",\"login\":\"" + IntegerToString(AccountNumber()) + "\""
              + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
              + ",\"name\":\"" + JsonEscape(AccountName()) + "\"}\n";
   SendMessage(ack);
}

//+------------------------------------------------------------------+
void SendAccountSnapshot() {
   string msg = "{\"type\":\"ACK\",\"status\":\"ACCOUNT_SNAPSHOT\""
              + ",\"balance\":" + DoubleToString(AccountBalance(), 2)
              + ",\"equity\":" + DoubleToString(AccountEquity(), 2)
              + ",\"margin\":" + DoubleToString(AccountMargin(), 2)
              + ",\"freeMargin\":" + DoubleToString(AccountFreeMargin(), 2)
              + ",\"login\":\"" + IntegerToString(AccountNumber()) + "\""
              + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
              + ",\"name\":\"" + JsonEscape(AccountName()) + "\"}\n";
   SendMessage(msg);
}

//+------------------------------------------------------------------+
void BroadcastOpenPositionsPnL() {
   for(int i = OrdersTotal() - 1; i >= 0; i--) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int cmd = OrderType();
      if(cmd != OP_BUY && cmd != OP_SELL) continue;

      string side = (cmd == OP_BUY ? "BUY" : "SELL");
      string origin = (OrderMagicNumber() == MAGIC_NUMBER ? "AUTO" : "MANUAL");
      double pnl = OrderProfit() + OrderSwap() + OrderCommission();
      int ticket = OrderTicket();

      string msg = "{\"type\":\"ACK\",\"status\":\"POSITION_UPDATE\""
                 + ",\"profit\":" + DoubleToString(pnl, 2)
                 + ",\"origin\":\"" + origin + "\""
                 + ",\"positionId\":\"" + IntegerToString(ticket) + "\""
                 + ",\"orderId\":\"" + IntegerToString(ticket) + "\""
                 + ",\"dealId\":\"" + IntegerToString(ticket) + "\""
                 + ",\"login\":\"" + IntegerToString(AccountNumber()) + "\""
                 + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
                 + ",\"name\":\"" + JsonEscape(AccountName()) + "\""
                 + ",\"trade\":{\"symbol\":\"" + JsonEscape(OrderSymbol()) + "\",\"type\":\"" + side + "\""
                 + ",\"entry\":" + DoubleToString(OrderOpenPrice(), 5)
                 + ",\"sl\":" + DoubleToString(OrderStopLoss(), 5)
                 + ",\"tp\":" + DoubleToString(OrderTakeProfit(), 5)
                 + ",\"lot\":" + DoubleToString(OrderLots(), 2) + "}}\n";
      SendMessage(msg);
   }
}

//+------------------------------------------------------------------+
void SeedKnownHistoryTickets() {
   knownHistoryCount = 0;
   ArrayResize(knownHistoryTickets, 0);
   int total = OrdersHistoryTotal();
   int limit = MathMin(total, 2000);
   for(int i = total - 1; i >= 0 && knownHistoryCount < limit; i--) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int t = OrderTicket();
      ArrayResize(knownHistoryTickets, knownHistoryCount + 1);
      knownHistoryTickets[knownHistoryCount] = t;
      knownHistoryCount++;
   }
}

//+------------------------------------------------------------------+
bool IsKnownHistoryTicket(int ticket) {
   for(int i = 0; i < knownHistoryCount; i++) {
      if(knownHistoryTickets[i] == ticket) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
void AddKnownHistoryTicket(int ticket) {
   if(ticket <= 0 || IsKnownHistoryTicket(ticket)) return;
   ArrayResize(knownHistoryTickets, knownHistoryCount + 1);
   knownHistoryTickets[knownHistoryCount] = ticket;
   knownHistoryCount++;
}

//+------------------------------------------------------------------+
void BroadcastRecentClosedOrders(datetime fromTime, bool forcePush) {
   datetime toTime = TimeCurrent();
   if((long)fromTime > (long)toTime)
      fromTime = (datetime)((long)toTime - 3600);
   bool allHistory = ((long)fromTime <= 0);
   int maxSend = forcePush ? (allHistory ? 800 : 400) : 200;
   int sent = 0;

   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int cmd = OrderType();
      if(cmd != OP_BUY && cmd != OP_SELL) continue;

      datetime closeAt = OrderCloseTime();
      if(closeAt <= 0) continue;
      if(!allHistory && closeAt < fromTime) continue;

      int ticket = OrderTicket();
      if(!forcePush && IsKnownHistoryTicket(ticket)) continue;

      string symbol = OrderSymbol();
      string side = (cmd == OP_BUY ? "BUY" : "SELL");
      double profit = OrderProfit() + OrderSwap() + OrderCommission();
      string status = "CLOSED";
      double pt = MarketInfo(symbol, MODE_POINT);
      if(OrderStopLoss() > 0 && MathAbs(OrderClosePrice() - OrderStopLoss()) <= pt * 2.0) status = "CLOSED_SL";
      else if(OrderTakeProfit() > 0 && MathAbs(OrderClosePrice() - OrderTakeProfit()) <= pt * 2.0) status = "CLOSED_TP";

      string stage = "CLOSE";
      if(status == "CLOSED_SL") stage = "CLOSE_SL";
      else if(status == "CLOSED_TP") stage = "CLOSE_TP";
      string shotFile = "";
      string shotPath = "";
      CaptureTradeScreenshot(stage, symbol, shotFile, shotPath);

      string origin = (OrderMagicNumber() == MAGIC_NUMBER ? "AUTO" : "MANUAL");
      SendCloseUpdate(status, symbol, ticket, ticket, ticket, profit, side, origin, shotFile, shotPath, stage);
      AddKnownHistoryTicket(ticket);
      sent++;
      if(sent >= maxSend) break;
   }

   if(EnableLogs) {
      string note = allHistory ? "ALL->now" : TimeToString(fromTime, TIME_DATE | TIME_MINUTES) + "->now";
      Print("[TradeSync MT4 EA] Closed-history sync pushed ", sent, " row(s) (", note, ", force=", forcePush, ")");
   }
}

//+------------------------------------------------------------------+
bool SendHello() {
   string hello = "{\"type\":\"HELLO\",\"ea\":\"SignalCopierEA-MT4\",\"version\":\"1.4\""
                + ",\"account\":\"" + IntegerToString(AccountNumber()) + "\""
                + ",\"login\":\"" + IntegerToString(AccountNumber()) + "\""
                + ",\"server\":\"" + JsonEscape(AccountServer()) + "\""
                + ",\"name\":\"" + JsonEscape(AccountName()) + "\"}\n";
   return SendMessage(hello);
}

//+------------------------------------------------------------------+
bool SendMessage(string msg) {
   string folderUse = FileBridgeFolder;
   StringTrimLeft(folderUse);
   StringTrimRight(folderUse);
   if(StringLen(folderUse) < 1)
      folderUse = "TradeStationFileBridge";
   string fn = folderUse + "\\ea_to_app.txt";

   int fh = FileOpen(fn, FILE_READ | FILE_WRITE | FILE_BIN);
   if(fh == INVALID_HANDLE) {
      Print("[TradeSync MT4 EA] FileOpen ea_to_app failed err=", GetLastError(), " path=", fn);
      return false;
   }
   FileSeek(fh, 0, SEEK_END);

   uchar buf[];
   int len = StringToCharArray(msg, buf, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0)
      ArrayResize(buf, len - 1);
   if(ArraySize(buf) <= 0) {
      FileClose(fh);
      return false;
   }

   if(FileWriteArray(fh, buf, 0, ArraySize(buf)) != (uint)ArraySize(buf)) {
      Print("[TradeSync MT4 EA] FileWriteArray failed err=", GetLastError());
      FileClose(fh);
      return false;
   }
   FileFlush(fh);
   FileClose(fh);
   if(EnableLogs)
      Print("[TradeSync MT4 EA] Sent(file): ", StringSubstr(msg, 0, 140));
   return true;
}

//+------------------------------------------------------------------+
string JsonEscape(string value) {
   string out = value;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}

//+------------------------------------------------------------------+
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
   }
   return "Unknown";
}

string Pad2(int v) {
   if(v < 10) return "0" + IntegerToString(v);
   return IntegerToString(v);
}

string TimeframeToLabel(int tf) {
   switch(tf) {
      case PERIOD_M1: return "M1";
      case PERIOD_M5: return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1: return "H1";
      case PERIOD_H4: return "H4";
      case PERIOD_D1: return "D1";
      case PERIOD_W1: return "W1";
      case PERIOD_MN1: return "MN1";
   }
   return "TF";
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

string BuildScreenshotFileName(string stage, string symbol) {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   string timePart = Pad2(dt.hour) + Pad2(dt.min) + Pad2(dt.sec);
   string msPart = Pad2((int)(GetTickCount() % 100));
   string safeStage = SanitizeToken(stage, 12);
   string safeSymbol = SanitizeToken(symbol, 12);
   string safeTf = SanitizeToken(TimeframeToLabel(Period()), 5);
   string fileName = safeSymbol + "-" + safeTf + "-" + safeStage + "-" + timePart + msPart + ".png";
   if(StringLen(fileName) > 63) fileName = StringSubstr(fileName, 0, 59) + ".png";
   return fileName;
}

bool CaptureTradeScreenshot(string stage, string symbol, string &fileName, string &fullPath) {
   fileName = "";
   fullPath = "";
   if(!EnableTradeScreenshots) return false;
   string folder = "";
   if(!EnsureScreenshotFolders(folder)) return false;

   fileName = BuildScreenshotFileName(stage, symbol);
   string relativeFile = folder + "\\" + fileName;
   int width = (ScreenshotWidth > 0 ? ScreenshotWidth : 1280);
   int height = (ScreenshotHeight > 0 ? ScreenshotHeight : 720);

   bool ok = WindowScreenShot(relativeFile, width, height);
   fullPath = TerminalInfoString(TERMINAL_DATA_PATH) + "\\MQL4\\Files\\" + relativeFile;
   return ok;
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
