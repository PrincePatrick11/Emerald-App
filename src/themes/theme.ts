import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauri } from '../lib/platform';
import { oneOf } from '../lib/helpers';
import { customThemeTokens, type CustomTheme } from './customTheme';

export type ThemeId = 'emerald-noctis' | 'emerald-parchment';
/** A built-in theme, or an imported one of this vault. */
export type ThemeSelection = ThemeId | `custom:${string}`;
export type FontId = 'inter' | 'source-sans-3' | 'nunito' | 'ibm-plex-sans' | 'alegreya' | 'cormorant-garamond' | 'lora' | 'merriweather';

export const DEFAULT_THEME_ID: ThemeId = 'emerald-noctis';

/** A new theme additionally needs a branch in the boot script in
 *  `index.html` — it runs before the bundle and cannot call
 *  `normalizeThemeId()`. Without the branch, the new theme starts with the
 *  colours of Noctis's loading screen. */
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

/** Size of the interface in percent, as the WebView's zoom. A root
 *  `font-size` was not enough: columns and bars with a fixed px width did not
 *  grow with it, and the larger text broke out of them. */
export const UI_SCALE_OPTIONS = [90, 100, 110, 120] as const;
export type UIScale = (typeof UI_SCALE_OPTIONS)[number];
export const DEFAULT_UI_SCALE: UIScale = 100;

/** Text size in the editor and in field values, in px — independent of the
 *  interface. 17 was the fixed value before. */
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

export function customThemeSelection(id: string): ThemeSelection {
  return `custom:${id}`;
}

/** A selection pointing at a theme that no longer exists falls back to the default. */
export function normalizeThemeSelection(raw: string | null, customThemes: CustomTheme[]): ThemeSelection {
  if (raw?.startsWith('custom:')) {
    return customThemes.some((theme) => customThemeSelection(theme.id) === raw)
      ? (raw as ThemeSelection)
      : DEFAULT_THEME_ID;
  }
  return normalizeThemeId(raw);
}

let appliedCustomTokens: string[] = [];

/** A custom theme's values go through `style.setProperty`: a `<style>` element would
 *  collide with the release build's CSP nonce (see `public/splash.css`). */
export function applyTheme(selection: ThemeSelection, customThemes: CustomTheme[] = []) {
  const html = document.documentElement;
  for (const name of appliedCustomTokens) html.style.removeProperty(`--${name}`);
  appliedCustomTokens = [];
  html.style.removeProperty('color-scheme');

  const custom = customThemes.find((theme) => customThemeSelection(theme.id) === selection);
  if (!custom) {
    html.dataset.theme = selection.startsWith('custom:') ? DEFAULT_THEME_ID : selection;
    return;
  }
  const tokens = customThemeTokens(custom);
  for (const [name, value] of Object.entries(tokens)) html.style.setProperty(`--${name}`, value);
  appliedCustomTokens = Object.keys(tokens);
  html.style.setProperty('color-scheme', custom.base);
  html.dataset.theme = 'custom';
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

export function normalizeUIScale(raw: unknown): UIScale {
  // The boot mirror delivers numbers as text.
  return oneOf(typeof raw === 'string' ? Number(raw) : raw, UI_SCALE_OPTIONS, DEFAULT_UI_SCALE);
}

export function normalizeEditorFontSize(raw: unknown): EditorFontSize {
  return oneOf(typeof raw === 'string' ? Number(raw) : raw, EDITOR_FONT_SIZE_OPTIONS, DEFAULT_EDITOR_FONT_SIZE);
}

export function applyUIScale(scale: UIScale) {
  // Outside Tauri (Vite in the browser) there is no WebView to zoom —
  // `getCurrentWebview()` would already throw synchronously there.
  if (!isTauri) return;
  getCurrentWebview().setZoom(scale / 100).catch((err: unknown) => {
    console.warn('[theme] could not set webview zoom', err);
  });
}

export function applyEditorFontSize(size: EditorFontSize) {
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
}
