import type { FontId, ThemeId } from '../store/uiStore';

export const DEFAULT_THEME_ID: ThemeId = 'emerald-noctis';

export const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: 'emerald-noctis', label: 'Emerald Noctis' },
  { id: 'emerald-parchment', label: 'Emerald Parchment' },
];

export const DEFAULT_UI_FONT_ID: FontId = 'inter';
export const DEFAULT_EDITOR_FONT_ID: FontId = 'lora';

export const FONT_OPTIONS: Array<{ id: FontId; label: string }> = [
  { id: 'inter', label: 'Inter' },
  { id: 'source-sans-3', label: 'Source Sans 3' },
  { id: 'nunito', label: 'Nunito' },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans' },
  { id: 'alegreya', label: 'Alegreya' },
  { id: 'cormorant-garamond', label: 'Cormorant Garamond' },
  { id: 'lora', label: 'Lora' },
  { id: 'merriweather', label: 'Merriweather' },
];

const VALID_THEME_IDS = new Set<ThemeId>(THEME_OPTIONS.map(({ id }) => id));
const VALID_FONT_IDS = new Set<FontId>(FONT_OPTIONS.map(({ id }) => id));

export function normalizeThemeId(raw: string | null): ThemeId {
  if (raw && VALID_THEME_IDS.has(raw as ThemeId)) return raw as ThemeId;
  if (raw === 'light') return 'emerald-parchment';
  return DEFAULT_THEME_ID;
}

export function applyTheme(themeId: ThemeId) {
  document.documentElement.dataset.theme = themeId;
}

export function normalizeUIFontId(raw: string | null): FontId {
  if (raw && VALID_FONT_IDS.has(raw as FontId)) return raw as FontId;
  return DEFAULT_UI_FONT_ID;
}

export function normalizeEditorFontId(raw: string | null): FontId {
  if (raw && VALID_FONT_IDS.has(raw as FontId)) return raw as FontId;
  return DEFAULT_EDITOR_FONT_ID;
}

export function applyUIFont(fontId: FontId) {
  document.documentElement.dataset.uiFont = fontId;
}

export function applyEditorFont(fontId: FontId) {
  document.documentElement.dataset.editorFont = fontId;
}
