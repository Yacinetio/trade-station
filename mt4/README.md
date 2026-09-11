# MT4 Expert Advisor

- EA file: `mt4/SignalCopierEA.mq4`
- Purpose: MT4-compatible TradeSync signal execution bridge.

## Install

1. Copy `SignalCopierEA.mq4` to your MT4 Experts folder:
   - `...\MQL4\Experts\`
2. Open MetaEditor (MT4), compile the EA.
3. In MT4, enable:
   - AutoTrading
   - DLL imports (required for TCP socket bridge)
4. Attach EA to any chart.

## Notes

- Uses the same TCP protocol as MT5 EA (`127.0.0.1:9999` by default).
- Supports market and pending orders, account snapshots, sync requests, and screenshot metadata.

