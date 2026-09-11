/**
 * Built-in notebook templates. `instantiateTemplate(id)` returns
 * `{ title, folder, body }` with `{{date}}` / `{{weekStart}}` / `{{weekEnd}}`
 * placeholders filled in for "now".
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Monday of the ISO week containing `d`. */
function mondayOf(d) {
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return m;
}

const TEMPLATES = [
  {
    id: 'pre-market-plan',
    name: 'Pre-market plan',
    folder: 'Plans',
    description: 'Bias checklist, key levels, news to watch, max-loss commitment',
    title: 'Pre-market plan — {{date}}',
    body: `# Pre-market plan — {{date}}

## Bias checklist
- [ ] HTF trend (D1/H4): bullish / bearish / range
- [ ] Yesterday's close vs today's open: gap? continuation?
- [ ] Asian session range marked
- [ ] Key correlated markets checked (DXY, yields, indices)
- [ ] My bias for today: **LONG / SHORT / NEUTRAL** — because:

## Key levels
| Symbol | Support | Resistance | Notes |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |

## News to watch
- [ ] High-impact events checked in the calendar
- Events today (time, currency, event):
  -

## Risk plan
- Max loss today (hard stop): **$**
- Max trades today: **#**
- Risk per trade: **%**
- If I hit max loss I will: close the platform and journal why.

## One focus for today
> `
  },
  {
    id: 'daily-recap',
    name: 'Daily recap',
    folder: 'Journal',
    description: "What worked, what didn't, rule breaches, tomorrow's focus",
    title: 'Daily recap — {{date}}',
    body: `# Daily recap — {{date}}

## Stats
_Use "Insert today's stats" to drop the numbers here._

## What worked
-

## What didn't work
-

## Rule breaches
- [ ] Traded outside plan hours
- [ ] Moved / removed a stop loss
- [ ] Oversized a position
- [ ] Revenge traded after a loss
- Details:

## Emotional state (before / during / after)
>

## Tomorrow's focus
1. `
  },
  {
    id: 'weekly-review',
    name: 'Weekly review',
    folder: 'Reviews',
    description: 'Stats block, top mistakes, action items',
    title: 'Weekly review — {{weekStart}} to {{weekEnd}}',
    body: `# Weekly review — {{weekStart}} → {{weekEnd}}

## Stats
| Metric | This week | Last week |
| --- | --- | --- |
| Net P&L |  |  |
| Win rate |  |  |
| Trades taken |  |  |
| Avg R |  |  |
| Biggest loss |  |  |

## Top 3 mistakes (with cost)
1.
2.
3.

## Best trade of the week — why it worked
>

## Worst trade of the week — what I'd do differently
>

## Rule compliance
- Followed the plan on __ / __ trades.

## Action items for next week
- [ ]
- [ ] `
  },
  {
    id: 'watchlist',
    name: 'Watchlist',
    folder: 'Watchlists',
    description: 'Symbol table skeleton with levels and triggers',
    title: 'Watchlist — {{date}}',
    body: `# Watchlist — {{date}}

| Symbol | Bias | Entry zone | Stop | Target | Trigger / setup | Status |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  | watching |
|  |  |  |  |  |  | watching |
|  |  |  |  |  |  | watching |

## Notes
- Only take entries when the trigger condition actually prints.
- Remove a symbol once invalidated — keep this list short.`
  },
  {
    id: 'strategy-idea',
    name: 'Strategy idea',
    folder: 'Plans',
    description: 'Hypothesis, entry/exit, invalidation, test plan',
    title: 'Strategy idea — {{date}}',
    body: `# Strategy idea

## Hypothesis
> When X happens under condition Y, price tends to Z.

## Market / session
- Symbols:
- Sessions / hours:

## Entry rules
1.
2.

## Exit rules
- Take profit:
- Stop loss:
- Time-based exit:

## Invalidation
_What single observation would prove this idea wrong?_
>

## Test plan
- [ ] Collect 20 historical examples
- [ ] Forward-test on demo for 2 weeks
- [ ] Minimum sample before going live: 30 trades
- [ ] Success criteria: profit factor > 1.5 and drawdown < __%`
  },
  {
    id: 'loss-autopsy',
    name: 'Loss autopsy',
    folder: 'Reviews',
    description: 'What happened, was it per plan, emotional state, prevention',
    title: 'Loss autopsy — {{date}}',
    body: `# Loss autopsy — {{date}}

## The trade
- Symbol / direction:
- Size and risk:
- Loss: **$**

## What happened (facts only)
>

## Was it per plan?
- [ ] Setup matched my written rules
- [ ] Size was within my risk limit
- [ ] Stop was placed and never touched
- [ ] Entry timing followed the trigger

If any box is unchecked, this was a **discipline loss**, not a market loss.

## Emotional state
- Before entry:
- While in the trade:
- After the exit:

## Root cause (pick the deepest one)
>

## Prevention
_One concrete change that makes this exact loss impossible or smaller next time:_
- `
  }
];

function listTemplates() {
  return TEMPLATES.map(({ id, name, folder, description }) => ({ id, name, folder, description }));
}

function fillPlaceholders(text, now = new Date()) {
  const monday = mondayOf(now);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return String(text || '')
    .replace(/\{\{date\}\}/g, toDateKey(now))
    .replace(/\{\{weekStart\}\}/g, toDateKey(monday))
    .replace(/\{\{weekEnd\}\}/g, toDateKey(sunday));
}

/** Returns `{ templateId, title, folder, body }` or null for unknown ids. */
function instantiateTemplate(templateId, now = new Date()) {
  const tpl = TEMPLATES.find((t) => t.id === String(templateId || ''));
  if (!tpl) return null;
  return {
    templateId: tpl.id,
    title: fillPlaceholders(tpl.title, now),
    folder: tpl.folder,
    body: fillPlaceholders(tpl.body, now)
  };
}

module.exports = { TEMPLATES, listTemplates, instantiateTemplate, fillPlaceholders };
