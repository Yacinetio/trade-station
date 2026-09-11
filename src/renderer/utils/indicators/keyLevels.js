/**
 * Previous day / previous week high-low as horizontal levels per day.
 */

function utcDayKey(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function isoWeekKey(sec) {
  const d = new Date(sec * 1000);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function computeKeyLevels(bars, _opts = {}) {
  const dayStats = new Map();
  const weekStats = new Map();

  for (const bar of bars || []) {
    const t = Number(bar.time);
    const day = utcDayKey(t);
    const week = isoWeekKey(t);
    if (!dayStats.has(day)) dayStats.set(day, { high: bar.high, low: bar.low });
    else {
      const s = dayStats.get(day);
      s.high = Math.max(s.high, Number(bar.high));
      s.low = Math.min(s.low, Number(bar.low));
    }
    if (!weekStats.has(week)) weekStats.set(week, { high: bar.high, low: bar.low });
    else {
      const s = weekStats.get(week);
      s.high = Math.max(s.high, Number(bar.high));
      s.low = Math.min(s.low, Number(bar.low));
    }
  }

  const days = [...dayStats.keys()].sort();
  const weeks = [...weekStats.keys()].sort();
  const levels = [];

  for (let i = 1; i < days.length; i++) {
    const prev = dayStats.get(days[i - 1]);
    const day = days[i];
    const startSec = Math.floor(new Date(`${day}T00:00:00.000Z`).getTime() / 1000);
    levels.push(
      { day, kind: 'prevDayHigh', price: prev.high, startSec },
      { day, kind: 'prevDayLow', price: prev.low, startSec }
    );
  }

  for (let i = 1; i < weeks.length; i++) {
    const prev = weekStats.get(weeks[i - 1]);
    const week = weeks[i];
    const firstDay = days.find((d) => isoWeekKey(Math.floor(new Date(`${d}T00:00:00.000Z`).getTime() / 1000)) === week);
    const startSec = firstDay
      ? Math.floor(new Date(`${firstDay}T00:00:00.000Z`).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    levels.push(
      { week, kind: 'prevWeekHigh', price: prev.high, startSec },
      { week, kind: 'prevWeekLow', price: prev.low, startSec }
    );
  }

  return levels;
}
