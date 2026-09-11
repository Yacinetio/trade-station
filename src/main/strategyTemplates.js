/**
 * Built-in strategy (playbook) templates — TradeZella "25+ templates" parity.
 *
 * Each template is a complete, immediately usable playbook: concrete rules a
 * trader can check off per trade, entry/exit criteria, and a risk block.
 * `instantiateTemplate` turns one into a saveable strategy record (rules get
 * fresh ids via strategyStore.normalizeStrategy at save time).
 */

const TEMPLATES = [
  // ── ICT family ──────────────────────────────────────────────────────────
  {
    id: 'tpl-ict-fvg-entry',
    name: 'ICT — Fair Value Gap entry',
    description: 'Trade the retrace into a fresh fair value gap left by a displacement leg, in the direction of the higher-timeframe bias.',
    color: '#7c5cff',
    rules: [
      'Daily/H4 bias is established and the FVG forms in the direction of that bias',
      'The FVG was created by a displacement candle that broke short-term structure',
      'Price has NOT already filled more than 50% of the gap before my entry',
      'Entry limit sits inside the gap (ideally the consequent encroachment / midpoint)',
      'Stop loss is beyond the swing that created the displacement, not inside the gap',
      'A clear draw on liquidity (old high/low, imbalance) exists beyond entry for the target',
      'No red-folder news within 15 minutes of entry'
    ],
    entryCriteria: 'Wait for a displacement leg that breaks structure and leaves a clean M5–M15 FVG. Set a limit order at the gap midpoint. Only take it if HTF bias, displacement direction, and draw on liquidity all agree.',
    exitCriteria: 'First target at the nearest opposing liquidity pool; runner to the origin of the HTF range. Invalidate and exit if the gap is fully closed and price closes through the far side.',
    riskRules: 'Risk 0.5–1% per attempt, max 2 attempts per session on the same idea. SL beyond the displacement swing; never widen the stop.',
    suggestedTags: ['ict', 'fvg', 'imbalance']
  },
  {
    id: 'tpl-ict-silver-bullet',
    name: 'ICT — Silver Bullet window',
    description: 'One setup, one hour: trade the first clean FVG that forms inside the 10–11am New York Silver Bullet window toward an obvious liquidity draw.',
    color: '#8b5cf6',
    rules: [
      'Trade is taken ONLY between 10:00 and 11:00 New York time',
      'A liquidity pool (session high/low, previous day high/low) was taken before the window or is the clear draw',
      'Entry is on an M1–M5 FVG formed by displacement inside the window',
      'Direction agrees with the daily bias / higher-timeframe draw on liquidity',
      'Minimum 2R available to the draw before entering',
      'Only one Silver Bullet trade per session — win or lose, done',
      'No entry in the last 10 minutes of the window'
    ],
    entryCriteria: 'Inside 10–11am NY only: after a sweep or with a clear draw overhead/below, enter on the retrace into the first displacement FVG in the direction of the draw.',
    exitCriteria: 'Fixed target at the draw on liquidity (minimum 2R). Scratch the trade if it has not moved in your favor by the end of the window.',
    riskRules: 'Max 1% risk, one trade per window per instrument. Hard daily stop of -2% still applies.',
    suggestedTags: ['ict', 'silver-bullet', 'ny-session']
  },
  {
    id: 'tpl-ict-judas-swing',
    name: 'ICT — Judas swing',
    description: 'Fade the fake move: the early-session run that sweeps liquidity opposite to the real daily direction, then reverses hard.',
    color: '#6d28d9',
    rules: [
      'Daily bias is defined BEFORE the session opens (previous day analysis written down)',
      'The Judas leg sweeps an obvious pool: Asian high/low or previous day high/low',
      'The sweep happens in the first 90 minutes of the London or New York session',
      'Reversal is confirmed by displacement back through the swept level / market structure shift',
      'Entry on the retrace (OTE or FVG) of the reversal leg, not on the initial spike',
      'Stop beyond the extreme of the Judas swing',
      'Target is liquidity on the opposite side of the session range'
    ],
    entryCriteria: 'After the opening drive sweeps Asian/PDH-PDL liquidity against the daily bias, wait for an M5 market structure shift with displacement, then enter the pullback into OTE/FVG.',
    exitCriteria: 'Primary target: opposing session liquidity or the daily bias objective. Exit early if price re-closes beyond the sweep extreme.',
    riskRules: '0.5–1% risk. If stopped, no re-entry until a NEW sweep + shift forms. Never fade the move without the structure shift.',
    suggestedTags: ['ict', 'judas-swing', 'liquidity-sweep']
  },
  {
    id: 'tpl-ict-power-of-3',
    name: 'ICT — Power of 3 (AMD)',
    description: 'Accumulation → Manipulation → Distribution: enter after the manipulation leg of the daily candle and ride the distribution.',
    color: '#5b21b6',
    rules: [
      'Accumulation range is identified (Asian session / pre-open consolidation)',
      'Manipulation leg has swept one side of the accumulation range',
      'The manipulation direction is AGAINST the anticipated daily expansion',
      'Entry only after displacement confirms distribution has begun',
      'Entry price is within the upper/lower third of the anticipated daily range (not chasing mid-range)',
      'Stop beyond the manipulation extreme',
      'Trade is in sync with the weekly profile (e.g. Tuesday/Wednesday expansion days preferred)'
    ],
    entryCriteria: 'Mark the accumulation range. When price runs one side (manipulation) and then displaces back through the range in the opposite direction, enter the first pullback.',
    exitCriteria: 'Hold through distribution toward the daily range projection or opposing HTF liquidity. Close before the daily candle enters late-session consolidation.',
    riskRules: '1% max risk. One AMD interpretation per day — if the model fails, stand down rather than re-mapping the day mid-session.',
    suggestedTags: ['ict', 'power-of-3', 'amd']
  },
  {
    id: 'tpl-ict-breaker-block',
    name: 'ICT — Breaker block',
    description: 'Trade the failed order block: when a swing that took liquidity gets violated, the originating candles flip into support/resistance (breaker).',
    color: '#4c1d95',
    rules: [
      'A liquidity sweep occurred (old high/low taken) before the structure break',
      'Displacement broke back through the origin of the sweep leg, creating the breaker',
      'Entry is on the FIRST retest of the breaker block, not the second or third',
      'Higher-timeframe bias supports the breaker direction',
      'Stop goes beyond the breaker block, not inside it',
      'At least 2R to the next opposing liquidity pool',
      'Breaker is on M15 or higher (M1 breakers only inside a killzone)'
    ],
    entryCriteria: 'After a sweep + displacement through the sweep origin, place a limit at the breaker candle body. Confirmation entry allowed on an M1 shift inside the breaker.',
    exitCriteria: 'Target opposing liquidity. Invalidate on a full candle close through the far side of the breaker.',
    riskRules: 'Max 1% risk, max 2 breaker trades per day. Skip the setup entirely if no sweep preceded the break.',
    suggestedTags: ['ict', 'breaker', 'liquidity-sweep']
  },
  {
    id: 'tpl-ict-ob-ote',
    name: 'ICT — Order block + OTE',
    description: 'Institutional entry: retrace into the 62–79% (OTE) zone of an impulse that also holds a fresh order block.',
    color: '#7e22ce',
    rules: [
      'The impulse leg broke market structure in the trade direction',
      'Fibonacci is drawn on the impulse: entry zone is the 62–79% retracement (OTE)',
      'A fresh (untested) order block overlaps the OTE zone',
      'Order block shows displacement away from it (not a random opposing candle)',
      'Stop below/above the order block low/high or the 100% of the leg',
      'Target at least the -27% extension or the next liquidity pool for 2R+',
      'Entry occurs during London or New York killzone hours'
    ],
    entryCriteria: 'Draw the fib on the structure-breaking impulse. Limit order where the OTE zone and the order block body overlap; stop beyond the OB extreme.',
    exitCriteria: 'Scale 50% at 1:2, runner to the -27/-62% extension or opposing liquidity. Exit fully if the OB is closed through on M15.',
    riskRules: 'Risk 0.5–1%. Skip if the retrace already happened without you — never chase past 50% of the way back up the leg.',
    suggestedTags: ['ict', 'order-block', 'ote']
  },
  {
    id: 'tpl-ict-fair-value-rebalance',
    name: 'ICT — Fair value rebalance',
    description: 'After an aggressive one-sided move, price returns to rebalance the inefficiency before continuing — trade the continuation, not the retrace.',
    color: '#9333ea',
    rules: [
      'A large displacement leg left multiple stacked inefficiencies (FVGs) behind',
      'Price is returning to the inefficiency WITHOUT displacement (corrective, overlapping candles)',
      'The rebalance reaches the nearest gap but does not close beyond the leg midpoint',
      'Entry on reaction at the gap with a lower-timeframe confirmation (M1/M5 shift)',
      'Stop beyond the midpoint of the displacement leg',
      'Continuation target beyond the origin high/low of the retrace',
      'Trend context: no opposing HTF level sitting directly beyond entry'
    ],
    entryCriteria: 'Let the corrective pullback tap the first unfilled FVG of the impulse. Enter on the M1–M5 structure shift back in the impulse direction.',
    exitCriteria: 'Target the extension beyond the impulse extreme. Cut it if candles start CLOSING inside gaps below/above your entry gap.',
    riskRules: '1% max. Only one rebalance entry per impulse leg — if the first gap fails, the leg is suspect.',
    suggestedTags: ['ict', 'fvg', 'continuation']
  },
  {
    id: 'tpl-ict-equal-highs-lows',
    name: 'ICT — Equal highs/lows magnet',
    description: 'Equal highs or equal lows are resting liquidity; trade toward them, and trade the reaction after they are swept.',
    color: '#a855f7',
    rules: [
      'Clean equal highs/lows are visible on M15 or higher (2+ touches, near-identical price)',
      'Trade direction is TOWARD the equal highs/lows while they remain unswept',
      'Entry comes from a pullback structure (OB/FVG), not a market order mid-range',
      'Take-profit sits just in FRONT of the equal highs/lows, never behind them',
      'If already swept: only trade the reversal after displacement confirms rejection',
      'Stop beyond the most recent protected swing',
      'No entry when equal highs/lows are less than 1R away'
    ],
    entryCriteria: 'Identify the resting pool. Enter with-trend pullbacks targeting the pool, or after the pool is purged and price displaces away, enter the retrace of the purge.',
    exitCriteria: 'Front-run the pool by a few pips/points for targets. Post-sweep trades target the opposite side of the range.',
    riskRules: '0.5–1% risk. Never hold a target THROUGH obvious liquidity — assume the pool is where the move ends.',
    suggestedTags: ['ict', 'liquidity', 'equal-highs-lows']
  },
  {
    id: 'tpl-ict-premium-discount',
    name: 'ICT — Premium/discount array',
    description: 'Only buy from discount and sell from premium: range-based entries using the 50% equilibrium of the dealing range.',
    color: '#c084fc',
    rules: [
      'The active dealing range (swing high to swing low) is marked correctly',
      'Longs are taken ONLY below equilibrium (50%), shorts only above it',
      'Entry aligns with a PD array in that zone (OB, FVG, breaker) — not the 50% line alone',
      'HTF bias agrees with the direction traded from the zone',
      'Stop beyond the dealing-range extreme or the PD array',
      'Target minimum: return to equilibrium; full target: opposing side of the range',
      'Range is re-drawn after any confirmed break of either extreme'
    ],
    entryCriteria: 'Mark the dealing range from the last major swing points. Wait for price to enter premium (for shorts) or discount (for longs) and react at a PD array there.',
    exitCriteria: 'Partial at equilibrium, remainder at the opposing extreme. Invalidate if price closes through the range extreme behind entry.',
    riskRules: '1% max risk. No trades within the middle 20% of the range — that is where chop lives.',
    suggestedTags: ['ict', 'premium-discount', 'range']
  },
  {
    id: 'tpl-ict-smt-divergence',
    name: 'ICT — SMT divergence',
    description: 'Smart money technique: when correlated pairs disagree at a high/low (one sweeps, the other fails to), the failure signals the reversal.',
    color: '#d8b4fe',
    rules: [
      'Compared instruments are genuinely correlated (EU vs GU, ES vs NQ, Gold vs DXY inverse)',
      'One instrument makes a new high/low while the correlated one fails to (cracked correlation)',
      'The divergence forms AT a meaningful level (session extreme, PDH/PDL, liquidity pool)',
      'Entry confirmation: displacement + structure shift on the traded instrument',
      'Trade taken on the RELATIVELY weaker (for shorts) or stronger (for longs) instrument',
      'Stop beyond the divergence swing',
      'SMT alone is never the entry — it filters/confirms an existing setup'
    ],
    entryCriteria: 'Spot the divergence at a key level during a killzone. Enter on the traded instrument\u2019s M5 shift + retrace, in the direction the failed sweep implies.',
    exitCriteria: 'Target the nearest draw on liquidity. Abandon the idea if both instruments resync and make fresh extremes together.',
    riskRules: '0.5–1% risk. One SMT-based position at a time — never long one leg and short the other simultaneously.',
    suggestedTags: ['ict', 'smt', 'divergence']
  },
  {
    id: 'tpl-ict-daily-bias-m15',
    name: 'ICT — Daily bias + M15 entry',
    description: 'Top-down model: derive tomorrow\u2019s draw on liquidity from the daily chart, then execute with a single M15 confirmation pattern.',
    color: '#e9d5ff',
    rules: [
      'Daily bias and draw on liquidity are written down BEFORE the session (no mid-session flips)',
      'Only trades in the bias direction are allowed today',
      'M15 confirmation: sweep of a session low/high + displacement in bias direction',
      'Entry on the M15 FVG or OB created by the confirmation leg',
      'Stop beyond the M15 confirmation swing',
      'Target is the pre-written daily draw on liquidity',
      'Maximum 2 executions per day on the model',
      'If the daily bias objective is hit, no more trades that day'
    ],
    entryCriteria: 'With the pre-written bias, wait in the killzone for an M15 sweep-and-displace in the bias direction; enter the retrace into the created imbalance.',
    exitCriteria: 'Hold to the daily draw. Move stop to breakeven only after an opposing M15 swing forms between price and entry.',
    riskRules: '1% per trade, 2 trades max, stop trading at -1.5% on the day. Bias flip mid-day = flat, not reverse.',
    suggestedTags: ['ict', 'daily-bias', 'top-down']
  },
  {
    id: 'tpl-session-high-low-raid',
    name: 'Session high/low raid',
    description: 'Trade the run on a prior session\u2019s high or low: enter after the raid rejects, targeting the opposite side of the session range.',
    color: '#f472b6',
    rules: [
      'The raided level is a TRUE session extreme (Asia/London/NY), marked in advance',
      'Price sweeps the level and closes back inside the range within 3 candles (M5/M15)',
      'Rejection shows displacement, not a slow drift back',
      'Entry on the retrace after the reclaim, not on the reclaim candle itself',
      'Stop beyond the raid wick',
      'Target: midpoint of the session range first, opposite extreme second',
      'Skip the setup if a major news release caused the raid'
    ],
    entryCriteria: 'Pre-mark session extremes. When one is swept and price snaps back inside with displacement, enter the first pullback toward the reclaimed level.',
    exitCriteria: 'Scale at range midpoint, exit remainder at the opposite session extreme. Full exit if the raid wick extreme is violated again.',
    riskRules: '0.5–1% risk. Max one raid trade per session side — the second raid of the same level usually goes through.',
    suggestedTags: ['liquidity-sweep', 'session', 'raid']
  },
  {
    id: 'tpl-liquidity-sweep-reversal',
    name: 'Liquidity sweep reversal',
    description: 'Classic stop-hunt reversal: an obvious pool gets purged, sellers/buyers are trapped, and price reverses with displacement.',
    color: '#fb7185',
    rules: [
      'The swept pool was obvious: equal highs/lows, trendline cluster, or round number with multiple touches',
      'Sweep candle has a pronounced wick and closes back through the level',
      'Market structure shifts on the lower timeframe within 15 minutes of the sweep',
      'Entry on the pullback after the shift (not the wick itself)',
      'Stop beyond the sweep extreme with buffer for spread',
      'Minimum 2R to the first opposing pool',
      'Volume/velocity on the reversal leg exceeds the sweep leg'
    ],
    entryCriteria: 'Wait for the purge of a well-defined pool, then an LTF change of character. Enter the retrace into the shift\u2019s origin (OB/FVG).',
    exitCriteria: 'First target at the range midpoint, final at the opposing pool. Invalidate on a close beyond the sweep extreme.',
    riskRules: '1% max. Never pre-empt the sweep — no orders resting inside the pool before it is taken.',
    suggestedTags: ['liquidity-sweep', 'reversal', 'stop-hunt']
  },

  // ── Session momentum / breakout family ──────────────────────────────────
  {
    id: 'tpl-break-retest',
    name: 'Break & retest',
    description: 'Break a well-tested horizontal level, wait for the retest to hold, enter in the breakout direction.',
    color: '#38bdf8',
    rules: [
      'The level has at least 3 clean touches before the break',
      'Breakout candle CLOSES through the level on the entry timeframe (no wick-only breaks)',
      'Retest happens within a reasonable time (no entry if price ran 2R+ away first)',
      'Retest holds: rejection candle or LTF structure shift at the level',
      'Stop on the far side of the retested level',
      'Target at least 2R or the next HTF level',
      'No entry into immediately overhead/underlying HTF resistance/support'
    ],
    entryCriteria: 'Mark the level, wait for a body close through it, then enter on the first successful retest — either a limit at the level or confirmation candle close.',
    exitCriteria: 'Fixed 2R minimum or next structural level. Exit immediately on a body close back through the broken level.',
    riskRules: '1% per trade. One re-entry allowed if the first retest stops out but the level reclaims within 3 candles.',
    suggestedTags: ['break-retest', 'structure', 'breakout']
  },
  {
    id: 'tpl-london-open-momentum',
    name: 'London open momentum',
    description: 'Ride the initial London impulse when it aligns with the overnight setup and the daily bias.',
    color: '#0ea5e9',
    rules: [
      'Setup is prepared before 07:55 London time (bias, levels, news check)',
      'Asian range is narrow relative to ADR (compression before expansion)',
      'The opening drive breaks the Asian range with conviction (full-body M5 candles)',
      'Entry on the first M1–M5 pullback after the range break, not the initial candle',
      'Direction agrees with the daily bias or the overnight higher-timeframe level reaction',
      'Stop below/above the pullback swing or the Asian range midpoint',
      'Done trading this model by 10:30 London'
    ],
    entryCriteria: 'After the Asian range breaks with momentum in the bias direction, buy/sell the first shallow pullback (flag or FVG) with a stop under the pullback low/high.',
    exitCriteria: 'Partial at 1R, trail remainder under M5 swings toward the ADR objective or London session projection.',
    riskRules: '1% risk, max 2 attempts. If both fail, the day is likely rangebound — stand down.',
    suggestedTags: ['london', 'momentum', 'session-open'],
  },
  {
    id: 'tpl-ny-open-momentum',
    name: 'New York open momentum',
    description: 'Trade the 9:30 equity-open impulse or the 8:30 data-driven expansion in FX/indices with the prevailing London trend.',
    color: '#22d3ee',
    rules: [
      'Pre-market plan written before 09:15 NY: bias, key levels, scheduled news',
      'London session established a clear trend or broke a significant level',
      'Entry between 09:30 and 11:00 NY only',
      'The opening drive direction agrees with the London trend (continuation model)',
      'Entry on the first pullback that holds a rising/falling M5 structure',
      'Stop beyond the pullback swing; no stops inside the opening range',
      'Skip the model entirely on FOMC/CPI days unless trading the post-release structure'
    ],
    entryCriteria: 'After 09:30, let the opening range form (first 5–15 min). Enter on the pullback following the range break in the London-trend direction.',
    exitCriteria: 'Scale at 1R and at the session projection; exit all by 12:00 NY (lunch chop).',
    riskRules: '1% per trade, max 2 morning trades. Hard stop for the model at -1.5% on the day.',
    suggestedTags: ['ny-session', 'momentum', 'session-open']
  },
  {
    id: 'tpl-asian-range-breakout',
    name: 'Asian range breakout',
    description: 'Fade or follow the break of the Asian consolidation at the London handover, with strict rules for which side to take.',
    color: '#67e8f9',
    rules: [
      'Asian range is well-defined: at least 4 hours of consolidation with clear high/low',
      'Range height is below 60% of the 20-day ADR (genuine compression)',
      'Trade the break only in the direction of the daily bias; counter-bias breaks are faded instead',
      'Entry on the M15 close beyond the range, or the retest of the broken boundary',
      'Stop at the opposite third of the Asian range',
      'First target = 1× range height projected from the breakout point',
      'Cancel the setup if the break happens before 07:00 London'
    ],
    entryCriteria: 'Mark the Asian high/low. At London open, take the with-bias break on close-through + retest; if the break is against bias, wait for the failure pattern and fade it back through the range.',
    exitCriteria: 'Target 1× then 1.5× the range height. Time-stop: exit if nothing has happened 2 hours after entry.',
    riskRules: '1% max risk, one breakout attempt and one fade attempt max per day.',
    suggestedTags: ['asian-range', 'breakout', 'london']
  },
  {
    id: 'tpl-index-opening-drive',
    name: 'Index opening drive',
    description: 'US index model: aggressive one-directional drive off the 09:30 cash open when pre-market structure and gap context align.',
    color: '#a5f3fc',
    rules: [
      'Gap analysis done pre-open: gap size vs 5-day average and vs unfilled gaps',
      'Pre-market high/low and overnight high/low are marked',
      'The drive breaks pre-market structure within the first 15 minutes',
      'Entry on the micro pullback that holds above/below the opening print',
      'Stop beyond the opening print or the first 5-min swing',
      'No opening-drive trades on days with 10:00 red-folder data',
      'If the first 5-min candle is an indecision doji, the model is off'
    ],
    entryCriteria: 'At 09:30, if price drives through pre-market structure with expanding range, enter the first 1-min pullback holding the opening print.',
    exitCriteria: 'Scale at 1R, then trail below 5-min swings. All out by 10:30 unless a trend day is confirmed (VWAP untouched).',
    riskRules: '1% risk, single attempt. If stopped, switch to the balanced-day playbook instead of re-trying the drive.',
    suggestedTags: ['indices', 'opening-drive', 'ny-session']
  },
  {
    id: 'tpl-inside-bar-breakout',
    name: 'Inside-bar breakout',
    description: 'Volatility contraction entry: trade the break of an inside bar (or multi-bar coil) in the trend direction on H1–D1.',
    color: '#2dd4bf',
    rules: [
      'Mother bar occurs at a meaningful location (trend pullback, key level, not mid-chop)',
      'Inside bar (or 2–3 bar coil) is fully contained by the mother bar',
      'Trade only in the direction of the prevailing H4/D1 trend',
      'Entry stop-order a few ticks beyond the inside bar extreme',
      'Stop loss at the opposite end of the inside bar (aggressive) or mother bar (conservative)',
      'Cancel the unfilled order if the opposite side breaks first',
      'Minimum 2R to the next structural level before placing the order'
    ],
    entryCriteria: 'Find the inside bar at a trend-continuation location. Place a stop entry beyond its extreme in the trend direction; cancel on the opposite break.',
    exitCriteria: 'First target 2R or the next swing extreme; optional runner trailed behind subsequent bar lows/highs.',
    riskRules: '1% per setup. Skip inside bars that form in the middle of a range or immediately after news spikes.',
    suggestedTags: ['inside-bar', 'breakout', 'price-action']
  },
  {
    id: 'tpl-trendline-break-retest',
    name: 'Trendline break + retest',
    description: 'End-of-trend rotation: a multi-touch trendline breaks, then the retest from the other side offers the entry.',
    color: '#34d399',
    rules: [
      'Trendline has a minimum of 3 respected touches and a consistent slope',
      'Break is a full candle close through the line on the drawing timeframe',
      'A structural swing also broke with the trendline (not just the diagonal)',
      'Entry on the retest of the broken line or the broken swing (confluence preferred)',
      'Stop beyond the retest swing',
      'Target the origin of the last trend leg (minimum 2R)',
      'No entries against a strong HTF trend without a HTF level backing the reversal'
    ],
    entryCriteria: 'After the close-through break plus structure break, wait for the pullback to kiss the broken trendline/level and reject; enter on the rejection.',
    exitCriteria: 'Scale at the last consolidation, target the trend-leg origin. Invalidate on a close back above/below the trendline.',
    riskRules: '1% risk. One retest entry only — if the retest fails, the original trend is likely resuming.',
    suggestedTags: ['trendline', 'break-retest', 'reversal']
  },

  // ── Trend / mean-reversion / range family ────────────────────────────────
  {
    id: 'tpl-trend-pullback-ema',
    name: 'Trend pullback to EMA',
    description: 'Buy the dip / sell the rally to the 20/50 EMA zone in an established trend, entering on rejection.',
    color: '#4ade80',
    rules: [
      'Trend filter passes: 20 EMA above 50 EMA for longs (below for shorts) on the trade timeframe',
      'Price structure confirms the trend: higher highs/lows (or lower for shorts)',
      'Pullback reaches the 20–50 EMA zone without CLOSING beyond the 50 EMA',
      'Entry trigger: rejection candle (pin/engulf) or LTF structure shift at the zone',
      'Stop beyond the pullback swing, not merely beyond the EMA',
      'Minimum 1.5R to the recent trend extreme',
      'Skip the first pullback after a parabolic/exhaustion leg'
    ],
    entryCriteria: 'In a stacked-EMA trend, wait for the retrace into the EMA zone and a clear rejection trigger; enter on the trigger close.',
    exitCriteria: 'First target at the prior extreme; runner trails the 20 EMA (exit on close through it).',
    riskRules: '1% per trade, max 3 pullback entries per trend. Stand down after two consecutive failures — the trend may be rolling over.',
    suggestedTags: ['trend', 'pullback', 'ema']
  },
  {
    id: 'tpl-vwap-mean-reversion',
    name: 'VWAP mean reversion',
    description: 'Fade stretched moves back to VWAP on rangebound/balanced days, using deviation bands for entries.',
    color: '#86efac',
    rules: [
      'Day type is balanced: price has crossed VWAP at least twice already today',
      'Entry only from the 2nd deviation band or beyond (no fading the 1st band)',
      'Momentum is stalling at the band: divergence or shrinking candle bodies',
      'No fading a trend day (VWAP one-sided, bands expanding)',
      'Stop beyond the local extreme past the band',
      'Primary target is VWAP itself, not the opposite band',
      'No entries in the first 30 minutes of the session',
      'Skip the fade if a red-folder release is due within 30 minutes'
    ],
    entryCriteria: 'On a confirmed balanced day, fade the touch of the outer deviation band when momentum stalls, entering on the first LTF reversal trigger.',
    exitCriteria: 'Cover at VWAP (full or 75%). Optional runner to the opposite 1st band. Hard exit if the band-side extreme breaks.',
    riskRules: '0.5% risk per fade, max 3 fades per day, stop for the day after 2 losers in this model.',
    suggestedTags: ['vwap', 'mean-reversion', 'intraday']
  },
  {
    id: 'tpl-range-scalp',
    name: 'Range scalp',
    description: 'Scalp both edges of a mature, well-defined range: sell the highs, buy the lows, skip the middle.',
    color: '#bbf7d0',
    rules: [
      'Range has at least 2 clean touches on EACH boundary before the first trade',
      'Range height is at least 3× the spread + typical slippage',
      'Entries only in the outer 20% of the range — never mid-range',
      'Entry trigger: rejection wick or micro double-top/bottom at the boundary',
      'Stop just beyond the boundary extreme (tight, this is a scalp)',
      'Target the opposite boundary or range midpoint minimum',
      'STOP trading the range after the first true breakout closes outside',
      'News check passed: no scheduled releases during the scalp window'
    ],
    entryCriteria: 'In an established range, fade boundary touches on rejection triggers only. Limit or trigger-candle entries — no chasing toward the middle.',
    exitCriteria: 'Midpoint = scale, opposite boundary = final. Exit instantly on a boundary body-close breach.',
    riskRules: '0.5% per scalp, max 4 range trades per session. After a breakout, wait for a NEW range to form (2+ touches per side again).',
    suggestedTags: ['range', 'scalp', 'intraday']
  },
  {
    id: 'tpl-double-top-bottom-div',
    name: 'Double top/bottom + divergence',
    description: 'Reversal at the second test of an extreme when momentum diverges — the retail classic, executed with strict confirmation.',
    color: '#fbbf24',
    rules: [
      'The two tests are at a significant HTF level, not a random intraday high/low',
      'Second test shows clear momentum divergence (RSI/MACD or plain candle velocity)',
      'Second test does NOT close beyond the first extreme (sweep-throughs allowed, closes not)',
      'Entry only after the neckline/confirmation swing breaks',
      'Stop beyond the second extreme',
      'Target at minimum the pattern height projected from the neckline',
      'No counter-trend double tops in a strong HTF trend without HTF confluence'
    ],
    entryCriteria: 'Spot the second test with divergence at a real level. Enter on the neckline break, or on the retest of the neckline after the break for better R.',
    exitCriteria: 'Pattern-height projection as the main target; scale at the first support/resistance on the way.',
    riskRules: '1% per pattern, single entry plus one neckline-retest re-entry maximum.',
    suggestedTags: ['double-top', 'divergence', 'reversal']
  },
  {
    id: 'tpl-momentum-continuation',
    name: 'Momentum continuation',
    description: 'Join a move already in progress on the first orderly pause: flags, pennants, and micro-channels in strong momentum.',
    color: '#f59e0b',
    rules: [
      'The impulse leg is unambiguous: consecutive full-body candles, minimal overlap',
      'The pause is orderly and shallow: retraces less than 38% of the impulse',
      'Consolidation drifts AGAINST the impulse (bull flag drifts down, bear flag up)',
      'Entry on the break of the pause structure in the impulse direction',
      'Stop below/above the pause extreme',
      'Measured-move target: impulse length projected from the break',
      'Skip if the impulse was a news spike rather than an orderly trend leg',
      'Maximum 2 continuation entries per impulse chain'
    ],
    entryCriteria: 'After a strong displacement leg, buy/sell the break of the first tight flag/pennant with a stop under the flag low/high.',
    exitCriteria: 'Scale at 1R, hold the rest for the measured move. Exit if the flag extreme breaks against you before the target.',
    riskRules: '1% per entry. Never add to a continuation position after the second pause — late legs fail more often.',
    suggestedTags: ['momentum', 'continuation', 'flag']
  },
  {
    id: 'tpl-weekly-open-bias',
    name: 'Weekly open bias',
    description: 'Use the weekly open as the dividing line: look for the weekly manipulation early in the week, then position for the expansion.',
    color: '#fde047',
    rules: [
      'Weekly open price is marked on all charts before Monday trading',
      'Directional idea for the week is written down on Sunday/Monday (bias + draw)',
      'Longs preferred below the weekly open in a bullish week (buy the discount), shorts above it in a bearish week',
      'Entry requires a daily-timeframe reaction: sweep of Monday/Tuesday extreme or key level tap',
      'Stop beyond the weekly manipulation extreme',
      'Target the weekly draw on liquidity (previous week high/low or major HTF level)',
      'If Wednesday closes against the bias, flatten and re-assess — no Thursday hero trades'
    ],
    entryCriteria: 'Early-week (Mon–Tue) sweep against the weekly bias into a level, then a daily/H4 confirmation back in the bias direction — that is the entry window.',
    exitCriteria: 'Hold toward the weekly objective, scaling at daily levels. Exit by Friday lunch regardless of target.',
    riskRules: '1–2% for the weekly swing (this is a multi-day hold), one position per instrument per week.',
    suggestedTags: ['weekly-open', 'swing', 'bias']
  },

  // ── Instrument / event specific ─────────────────────────────────────────
  {
    id: 'tpl-gold-ny-session',
    name: 'Gold NY session',
    description: 'XAUUSD playbook for the New York window: trade the post-8:30 structure with wide-spread and velocity discipline.',
    color: '#eab308',
    rules: [
      'Levels from Asia and London are marked before 08:00 NY (session extremes, imbalances)',
      'The 08:30 data reaction (if any) has resolved — no positions through the release itself',
      'Entry aligns with the London trend OR a confirmed London reversal at a HTF level',
      'Setup is a sweep + displacement or a break-retest at a marked level — no naked breakout chases on gold',
      'Stop distance respects gold\u2019s velocity: beyond the full setup swing, minimum 3× spread',
      'Minimum 2R to the next session liquidity level',
      'No new entries after 11:30 NY (lunch chop) and none 15 min before PM fixing'
    ],
    entryCriteria: 'In the 08:30–11:30 NY window, trade sweeps of London/Asian extremes that displace back, entering the retrace with structure-based stops.',
    exitCriteria: 'Partial at 1R (gold gives it fast or not at all), remainder at the session liquidity target.',
    riskRules: '0.5–1% risk — gold slippage is real; size with the actual stop distance, never a fixed lot. Max 2 gold trades per NY session.',
    suggestedTags: ['gold', 'xauusd', 'ny-session']
  },
  {
    id: 'tpl-news-fade',
    name: 'News fade',
    description: 'Fade the emotional over-extension after a scheduled release once the initial spike exhausts and structure flips back.',
    color: '#f97316',
    rules: [
      'The release is scheduled (CPI/NFP/central bank) — never fade surprise headlines',
      'Wait a minimum of 5 minutes after the release; NEVER enter during the spike',
      'The spike reached or exceeded a meaningful HTF level or liquidity pool',
      'Exhaustion is visible: wick rejection, then an M1–M5 structure shift against the spike',
      'The actual data was roughly in line or mixed — do not fade a genuine large surprise',
      'Stop beyond the post-news extreme',
      'Target the pre-news price first; beyond it only if structure supports',
      'Spread has normalized before entry (check the ticket, not the chart)'
    ],
    entryCriteria: 'After the spike into a level exhausts and LTF structure shifts back, enter the retrace with a stop beyond the news extreme.',
    exitCriteria: 'Primary target: pre-release price. Scale there; runner only if the full round-trip has momentum.',
    riskRules: '0.5% max — news trades have the fattest tails. One fade attempt per release, no averaging in.',
    suggestedTags: ['news', 'fade', 'event']
  },
  {
    id: 'tpl-supply-demand-flip',
    name: 'Supply & demand flip',
    description: 'Trade the zone-role reversal: when a demand zone breaks it becomes supply (and vice versa) — enter on the first return to the flipped zone.',
    color: '#fb923c',
    rules: [
      'The original zone was fresh and caused a real impulse (visible departure)',
      'The zone broke with a full-body close through it, not a wick',
      'Entry is on the FIRST return to the flipped zone',
      'Return move is corrective (overlapping, small-bodied candles), not a displacement through',
      'Stop beyond the far edge of the flipped zone',
      'Minimum 2R to the next opposing zone',
      'HTF trend or bias agrees with the flip direction'
    ],
    entryCriteria: 'After the body-close breach of a fresh zone, set a limit at the near edge of the flipped zone with a stop beyond the far edge; confirmation entry optional on LTF shift.',
    exitCriteria: 'Target the next untested opposing zone. Invalidate on a body close back through the flipped zone.',
    riskRules: '1% risk, first-touch only — a second return through the zone usually means the flip has failed.',
    suggestedTags: ['supply-demand', 'flip', 'zones']
  }
];

/** All templates (frozen copies — callers must not mutate). */
function listTemplates() {
  return TEMPLATES.map((t) => ({
    ...t,
    rules: [...t.rules],
    suggestedTags: [...(t.suggestedTags || [])]
  }));
}

function getTemplate(templateId) {
  const tid = String(templateId || '');
  const found = TEMPLATES.find((t) => t.id === tid);
  if (!found) return null;
  return { ...found, rules: [...found.rules], suggestedTags: [...(found.suggestedTags || [])] };
}

/**
 * Turn a template into a strategy input ready for strategyStore.saveStrategy
 * (rule ids are assigned by the store's normalizer).
 */
function instantiateTemplate(templateId) {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  return {
    name: tpl.name,
    description: tpl.description,
    color: tpl.color || '#6c8cff',
    rules: tpl.rules.map((text) => ({ text })),
    entryCriteria: tpl.entryCriteria || '',
    exitCriteria: tpl.exitCriteria || '',
    riskRules: tpl.riskRules || '',
    linkedTags: [...(tpl.suggestedTags || [])],
    linkedChannels: [],
    archived: false
  };
}

module.exports = { TEMPLATES, listTemplates, getTemplate, instantiateTemplate };
