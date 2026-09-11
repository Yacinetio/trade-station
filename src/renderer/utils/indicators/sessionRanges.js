/**
 * Asian (0–7), London (7–13), NY (13–21) UTC session range boxes per day.
 */

function utcDayKey(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function hourUtc(sec) {
  return new Date(sec * 1000).getUTCHours();
}

export const SESSIONS = [
  { id: 'asian', label: 'Asian', startHour: 0, endHour: 7 },
  { id: 'london', label: 'London', startHour: 7, endHour: 13 },
  { id: 'ny', label: 'New York', startHour: 13, endHour: 21 }
];

export function computeSessionRanges(bars, _opts = {}) {
  /** @type {Map<string, Map<string, { startSec, endSec, high, low }>>} */
  const byDay = new Map();

  for (const bar of bars || []) {
    const t = Number(bar.time);
    const h = hourUtc(t);
    const day = utcDayKey(t);
    if (!byDay.has(day)) byDay.set(day, new Map());

    for (const sess of SESSIONS) {
      if (h < sess.startHour || h >= sess.endHour) continue;
      const dayMap = byDay.get(day);
      let box = dayMap.get(sess.id);
      if (!box) {
        const startSec = Math.floor(new Date(`${day}T${String(sess.startHour).padStart(2, '0')}:00:00.000Z`).getTime() / 1000);
        const endSec = Math.floor(new Date(`${day}T${String(sess.endHour).padStart(2, '0')}:00:00.000Z`).getTime() / 1000);
        box = { id: sess.id, label: sess.label, day, startSec, endSec, high: bar.high, low: bar.low };
        dayMap.set(sess.id, box);
      } else {
        box.high = Math.max(box.high, Number(bar.high));
        box.low = Math.min(box.low, Number(bar.low));
      }
    }
  }

  const boxes = [];
  for (const dayMap of byDay.values()) {
    for (const box of dayMap.values()) boxes.push(box);
  }
  return boxes.sort((a, b) => a.startSec - b.startSec);
}
