/**
 * Visual themes: more than color — typography, radii, shadows, background treatment.
 * Aligned with website (Tailwind) marketing look + app defaults.
 */
export const THEME_LIST = [
  {
    id: 'terminal-pro',
    name: 'Terminal Pro',
    blurb: 'Flagship trading desk — near-black surface ladder, hairline borders, scarce emerald, desaturated P&L'
  },
  { id: 'studio', name: 'Glass Studio', blurb: 'Glass rail, tabular figures, soft glow — original app shell' },
  { id: 'site', name: 'Zinc Dark', blurb: 'Pill nav, flat titlebar, zinc cards like marketing site' },
  { id: 'site-light', name: 'Zinc Light', blurb: 'Light sheets, soft elevation, spacious type' }
];

const STORAGE_KEY = 'tradeStationThemeV2';
const CANON = new Set(THEME_LIST.map((t) => t.id));

/** Retired themes → migrate to studio (CSS blocks kept in themes.css for old installs). */
const RETIRED_THEME_FALLBACK = {
  aurora: 'studio',
  nord: 'studio',
  sunset: 'studio',
  terminal: 'studio',
  paper: 'site-light',
  oled: 'studio',
  tradezella: 'studio',
  'tradezella-light': 'site-light',
  chartflow: 'studio'
};

export function normalizeThemeId(raw) {
  if (!raw || typeof raw !== 'string') return 'studio';
  if (raw === 'siteLight') return 'site-light';
  if (RETIRED_THEME_FALLBACK[raw]) return RETIRED_THEME_FALLBACK[raw];
  if (CANON.has(raw)) return raw;
  return 'studio';
}

export function getStoredTheme() {
  try {
    return normalizeThemeId(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'studio';
  }
}

export function applyTheme(id) {
  const theme = normalizeThemeId(id);
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  const light = theme === 'site-light' || theme === 'paper' || theme === 'tradezella-light';
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  try {
    window.dispatchEvent(new CustomEvent('tradestation-theme-changed', { detail: { theme } }));
  } catch {
    // ignore (non-browser tests)
  }
}
