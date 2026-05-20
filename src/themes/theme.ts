import type { ThemeId } from '../store/uiStore';

export const DEFAULT_THEME_ID: ThemeId = 'emerald-noctis';

export const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: 'emerald-noctis', label: 'Emerald Noctis' },
  { id: 'emerald-parchment', label: 'Emerald Parchment' },
];

export function normalizeThemeId(raw: string | null): ThemeId {
  if (raw === 'emerald-noctis' || raw === 'emerald-parchment') return raw;
  if (raw === 'light') return 'emerald-parchment';
  return DEFAULT_THEME_ID;
}

export function applyTheme(themeId: ThemeId) {
  document.documentElement.dataset.theme = themeId;
}
