import { getCurrentWebview } from '@tauri-apps/api/webview';

export type ThemeId = 'emerald-noctis' | 'emerald-parchment';
export type FontId = 'inter' | 'source-sans-3' | 'nunito' | 'ibm-plex-sans' | 'alegreya' | 'cormorant-garamond' | 'lora' | 'merriweather';

export const DEFAULT_THEME_ID: ThemeId = 'emerald-noctis';

/** Ein neues Theme braucht zusätzlich einen Zweig im Boot-Skript in
 *  `index.html` — das läuft vor dem Bundle und kann `normalizeThemeId()`
 *  nicht aufrufen. Fehlt der Zweig, startet das neue Theme mit den Farben
 *  des Ladebildschirms von Noctis. */
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

/** Größe der Oberfläche in Prozent, als Zoom des WebViews. Ein Wurzel-
 *  `font-size` reichte nicht: Spalten und Leisten mit fester px-Breite wuchsen
 *  nicht mit, und der größere Text brach aus ihnen heraus. */
export const UI_SCALE_OPTIONS = [90, 100, 110, 120] as const;
export type UIScale = (typeof UI_SCALE_OPTIONS)[number];
export const DEFAULT_UI_SCALE: UIScale = 100;

/** Textgröße im Editor und in Feldwerten, in px — unabhängig von der
 *  Oberfläche. 17 war der feste Wert davor. */
export const EDITOR_FONT_SIZE_OPTIONS = [14, 15, 16, 17, 18, 20, 22] as const;
export type EditorFontSize = (typeof EDITOR_FONT_SIZE_OPTIONS)[number];
export const DEFAULT_EDITOR_FONT_SIZE: EditorFontSize = 17;

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

function normalizeNumberOption<T extends number>(raw: unknown, options: readonly T[], fallback: T): T {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return options.includes(value as T) ? (value as T) : fallback;
}

export function normalizeUIScale(raw: unknown): UIScale {
  return normalizeNumberOption(raw, UI_SCALE_OPTIONS, DEFAULT_UI_SCALE);
}

export function normalizeEditorFontSize(raw: unknown): EditorFontSize {
  return normalizeNumberOption(raw, EDITOR_FONT_SIZE_OPTIONS, DEFAULT_EDITOR_FONT_SIZE);
}

export function applyUIScale(scale: UIScale) {
  // Außerhalb von Tauri (Vite im Browser) gibt es kein WebView zum Zoomen.
  getCurrentWebview().setZoom(scale / 100).catch((err: unknown) => {
    console.warn('[theme] could not set webview zoom', err);
  });
}

export function applyEditorFontSize(size: EditorFontSize) {
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
}
