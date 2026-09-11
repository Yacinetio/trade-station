import { describe, it, expect } from 'vitest';

const {
  isUsDst,
  getSession,
  getKillzone,
  nyOpenUtcMinutes,
  nyCloseUtcMinutes
} = require('../src/main/sessionModel');
const { evaluateSignalSchedule } = require('../src/main/signalFilters');

// 2026: DST starts Sun 2026-03-08 07:00 UTC, ends Sun 2026-11-01 06:00 UTC.
const SUMMER = '2026-06-09'; // EDT
const WINTER = '2026-01-13'; // EST

const at = (ymd, hm) => new Date(`${ymd}T${hm}:00.000Z`);

describe('sessionModel.isUsDst — US DST rule (2nd Sun March → 1st Sun November)', () => {
  it('spring-forward boundary (2026-03-08, transition at 07:00 UTC)', () => {
    expect(isUsDst(at('2026-03-08', '06:59'))).toBe(false);
    expect(isUsDst(at('2026-03-08', '07:00'))).toBe(true);
    expect(isUsDst(at('2026-03-07', '12:00'))).toBe(false); // day before
    expect(isUsDst(at('2026-03-09', '01:00'))).toBe(true); // day after
  });

  it('fall-back boundary (2026-11-01, transition at 06:00 UTC)', () => {
    expect(isUsDst(at('2026-11-01', '05:59'))).toBe(true);
    expect(isUsDst(at('2026-11-01', '06:00'))).toBe(false);
    expect(isUsDst(at('2026-10-31', '12:00'))).toBe(true);
    expect(isUsDst(at('2026-11-02', '01:00'))).toBe(false);
  });

  it('mid-season values', () => {
    expect(isUsDst(at('2026-07-15', '12:00'))).toBe(true);
    expect(isUsDst(at('2026-01-15', '12:00'))).toBe(false);
    expect(isUsDst(at('2026-12-25', '12:00'))).toBe(false);
  });
});

describe('sessionModel.getSession — UTC boundaries at exact minutes', () => {
  it('asia / london boundary at 08:00 UTC', () => {
    expect(getSession(at(SUMMER, '07:59'))).toBe('asia');
    expect(getSession(at(SUMMER, '08:00'))).toBe('london');
    expect(getSession(at(WINTER, '07:59'))).toBe('asia');
    expect(getSession(at(WINTER, '08:00'))).toBe('london');
  });

  it('NY open is DST-aware: 13:30 UTC summer, 14:30 UTC winter', () => {
    expect(getSession(at(SUMMER, '13:29'))).toBe('london');
    expect(getSession(at(SUMMER, '13:30'))).toBe('newYork');
    expect(getSession(at(WINTER, '13:30'))).toBe('london'); // not yet open in winter
    expect(getSession(at(WINTER, '14:29'))).toBe('london');
    expect(getSession(at(WINTER, '14:30'))).toBe('newYork');
    expect(nyOpenUtcMinutes(at(SUMMER, '12:00'))).toBe(13 * 60 + 30);
    expect(nyOpenUtcMinutes(at(WINTER, '12:00'))).toBe(14 * 60 + 30);
  });

  it('NY close is DST-aware: 20:00 UTC summer, 21:00 UTC winter (indicator boundaries)', () => {
    expect(getSession(at(SUMMER, '19:59'))).toBe('newYork');
    expect(getSession(at(SUMMER, '20:00'))).toBe('off');
    expect(getSession(at(WINTER, '20:59'))).toBe('newYork');
    expect(getSession(at(WINTER, '21:00'))).toBe('off');
    expect(nyCloseUtcMinutes(at(SUMMER, '12:00'))).toBe(20 * 60);
    expect(nyCloseUtcMinutes(at(WINTER, '12:00'))).toBe(21 * 60);
  });

  it('asia session wraps midnight: 22:00 → 08:00 UTC', () => {
    expect(getSession(at(SUMMER, '21:59'))).toBe('off');
    expect(getSession(at(SUMMER, '22:00'))).toBe('asia');
    expect(getSession(at(SUMMER, '23:30'))).toBe('asia');
    expect(getSession(at(SUMMER, '03:00'))).toBe('asia');
    expect(getSession(at(WINTER, '22:00'))).toBe('asia');
  });

  it('returns null for unparseable input', () => {
    expect(getSession('not-a-date')).toBe(null);
    expect(getKillzone('not-a-date')).toBe(null);
  });
});

describe('sessionModel.getKillzone — ICT windows (UTC, DST-aware)', () => {
  it('asia killzone 00:00–04:00 UTC', () => {
    expect(getKillzone(at(SUMMER, '00:00'))).toBe('asia-kz');
    expect(getKillzone(at(SUMMER, '03:59'))).toBe('asia-kz');
    expect(getKillzone(at(SUMMER, '04:00'))).toBe(null); // asia session but no KZ
  });

  it('london open killzone 07:00–10:00 UTC', () => {
    expect(getKillzone(at(SUMMER, '06:59'))).toBe(null);
    expect(getKillzone(at(SUMMER, '07:00'))).toBe('london-open-kz');
    expect(getKillzone(at(SUMMER, '09:59'))).toBe('london-open-kz');
    expect(getKillzone(at(SUMMER, '10:00'))).toBe(null);
  });

  it('summer: NY AM 13:30–15:00, silver bullet 15:00–16:00, london close 16:00–17:00', () => {
    expect(getKillzone(at(SUMMER, '13:29'))).toBe(null);
    expect(getKillzone(at(SUMMER, '13:30'))).toBe('ny-am-kz');
    expect(getKillzone(at(SUMMER, '14:59'))).toBe('ny-am-kz');
    expect(getKillzone(at(SUMMER, '15:00'))).toBe('silver-bullet'); // shadows ny-am + london-close
    expect(getKillzone(at(SUMMER, '15:59'))).toBe('silver-bullet');
    expect(getKillzone(at(SUMMER, '16:00'))).toBe('london-close-kz');
    expect(getKillzone(at(SUMMER, '16:59'))).toBe('london-close-kz');
    expect(getKillzone(at(SUMMER, '17:00'))).toBe(null);
  });

  it('winter: NY AM 14:30–16:00 (shifted open), silver bullet 16:00–17:00', () => {
    expect(getKillzone(at(WINTER, '14:00'))).toBe(null); // before winter NY open, outside other KZs? no — 14:00 not in any
    expect(getKillzone(at(WINTER, '14:30'))).toBe('ny-am-kz');
    expect(getKillzone(at(WINTER, '15:30'))).toBe('ny-am-kz'); // ny-am shadows london-close in winter
    expect(getKillzone(at(WINTER, '16:00'))).toBe('silver-bullet'); // NY 10–11am = 16–17 UTC in winter
    expect(getKillzone(at(WINTER, '16:59'))).toBe('silver-bullet');
    expect(getKillzone(at(WINTER, '17:00'))).toBe(null);
  });

  it('mid-london lull has no killzone', () => {
    expect(getKillzone(at(SUMMER, '12:00'))).toBe(null);
    expect(getKillzone(at(WINTER, '12:00'))).toBe(null);
  });
});

describe('signalFilters session schedule uses the canonical session model', () => {
  const base = { enableSessionFilter: true, sessions: { asian: true, london: true, newYork: true } };

  it('allows trades inside enabled sessions', () => {
    expect(evaluateSignalSchedule(base, at(SUMMER, '02:00')).allowed).toBe(true); // asia
    expect(evaluateSignalSchedule(base, at(SUMMER, '09:00')).allowed).toBe(true); // london
    expect(evaluateSignalSchedule(base, at(SUMMER, '14:00')).allowed).toBe(true); // NY (summer open 13:30)
  });

  it('blocks the off dead zone between NY close and asia open', () => {
    const r = evaluateSignalSchedule(base, at(SUMMER, '20:30')); // after 20:00 UTC summer close
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/session/i);
    expect(evaluateSignalSchedule(base, at(WINTER, '21:30')).allowed).toBe(false);
  });

  it('respects per-session toggles with DST-aware NY boundaries', () => {
    const nyOnly = { enableSessionFilter: true, sessions: { asian: false, london: false, newYork: true } };
    expect(evaluateSignalSchedule(nyOnly, at(WINTER, '14:00')).allowed).toBe(false); // still london in winter
    expect(evaluateSignalSchedule(nyOnly, at(WINTER, '14:30')).allowed).toBe(true);
    expect(evaluateSignalSchedule(nyOnly, at(SUMMER, '13:45')).allowed).toBe(true);
    const noNy = { enableSessionFilter: true, sessions: { asian: true, london: true, newYork: false } };
    expect(evaluateSignalSchedule(noNy, at(SUMMER, '14:00')).allowed).toBe(false);
  });

  it('asia wrap-around: 23:00 UTC allowed when asian session is on', () => {
    const asiaOnly = { enableSessionFilter: true, sessions: { asian: true, london: false, newYork: false } };
    expect(evaluateSignalSchedule(asiaOnly, at(SUMMER, '23:00')).allowed).toBe(true);
    expect(evaluateSignalSchedule(asiaOnly, at(SUMMER, '07:59')).allowed).toBe(true);
    expect(evaluateSignalSchedule(asiaOnly, at(SUMMER, '08:00')).allowed).toBe(false);
  });
});
