/**
 * Custom themes: a small JSON file with a few base colours, from which every
 * colour token is derived. A file can only ever set validated hex values, never
 * CSS, so a shared theme cannot load anything or change anything but colour.
 * Format: Documentation/themes.md.
 */
import { TEXT_COLOR_SHADES } from '../lib/textColors';

export interface CustomThemeColors {
  frame: string;
  sheet: string;
  panel: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  onAccent: string;
  danger: string;
  warning: string;
  success: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  base: 'dark' | 'light';
  colors: CustomThemeColors;
}

export type CustomThemeError = 'invalidFile' | 'tooLarge' | 'unreadableText';

export const CUSTOM_THEME_FILE_VERSION = 1;
export const MAX_CUSTOM_THEMES = 20;
export const MAX_CUSTOM_THEME_FILE_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 40;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const REQUIRED_COLORS = ['frame', 'sheet', 'panel', 'text', 'textMuted', 'border', 'accent', 'onAccent'] as const;

const OPTIONAL_COLORS: Record<CustomTheme['base'], Pick<CustomThemeColors, 'danger' | 'warning' | 'success'>> = {
  dark: { danger: '#f87171', warning: '#e2a854', success: '#4ade80' },
  light: { danger: '#b63f32', warning: '#a75924', success: '#1f7a43' },
};

const MIN_TEXT_CONTRAST = 2;


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The shape shared by a file and a stored theme; everything unknown is dropped. */
function readTheme(raw: unknown, id: string): CustomTheme | null {
  if (!isRecord(raw) || !isRecord(raw.colors)) return null;
  if (raw.base !== 'dark' && raw.base !== 'light') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) return null;

  const colors = raw.colors;
  const pick = (key: keyof CustomThemeColors, fallback?: string): string | null => {
    const value = colors[key];
    if (value === undefined) return fallback ?? null;
    return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null;
  };

  const result = {} as CustomThemeColors;
  for (const key of REQUIRED_COLORS) {
    const value = pick(key);
    if (!value) return null;
    result[key] = value;
  }
  for (const key of ['danger', 'warning', 'success'] as const) {
    const value = pick(key, OPTIONAL_COLORS[raw.base][key]);
    if (!value) return null;
    result[key] = value;
  }
  return { id, name, base: raw.base, colors: result };
}

/** Below this floor the controls that would remove the theme are unreadable too. */
function hasReadableText({ text, sheet, panel }: CustomThemeColors): boolean {
  return contrastRatio(text, sheet) >= MIN_TEXT_CONTRAST && contrastRatio(text, panel) >= MIN_TEXT_CONTRAST;
}

/** A theme file as text. The caller assigns the id. */
export function parseCustomThemeFile(
  text: string,
  id: string,
): { theme: CustomTheme } | { error: CustomThemeError } {
  if (new Blob([text]).size > MAX_CUSTOM_THEME_FILE_BYTES) return { error: 'tooLarge' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'invalidFile' };
  }
  if (!isRecord(raw) || raw.emeraldTheme !== CUSTOM_THEME_FILE_VERSION) return { error: 'invalidFile' };
  const theme = readTheme(raw, id);
  if (!theme) return { error: 'invalidFile' };
  return hasReadableText(theme.colors) ? { theme } : { error: 'unreadableText' };
}

/** Stored themes pass the same check as a file: settings can come from a backup. */
export function normalizeCustomThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const themes: CustomTheme[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[\w-]{1,64}$/.test(item.id)) continue;
    if (seen.has(item.id)) continue;
    const theme = readTheme(item, item.id);
    if (!theme || !hasReadableText(theme.colors)) continue;
    seen.add(theme.id);
    themes.push(theme);
    if (themes.length === MAX_CUSTOM_THEMES) break;
  }
  return themes;
}

/** Every colour token of the theme files, derived from the base colours. */
export function customThemeTokens({ base, colors: c }: CustomTheme): Record<string, string> {
  const mix = (a: string, percent: number, b: string) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;
  const fade = (a: string, percent: number) => mix(a, percent, 'transparent');
  const shadow = base === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.18)';
  // The editor's text colours, the same as in the built-in theme of the same base.
  const textColors = TEXT_COLOR_SHADES[base];

  const subtle = mix(c.textMuted, 80, c.sheet);
  const secondary = mix(c.text, 85, c.textMuted);
  const soft = mix(c.text, 50, c.textMuted);
  const hover = fade(c.text, 7);
  const active = fade(c.text, 12);
  const raised = mix(c.panel, 88, c.text);
  const borderStrong = mix(c.border, 75, c.text);
  const borderSoft = fade(c.border, 70);
  const accentSoft = fade(c.accent, 18);
  const accentStrong = mix(c.accent, 82, c.text);
  const accentHover = mix(c.accent, 88, c.text);
  const accentEdge = fade(c.accent, 60);
  const accentText = mix(c.accent, 85, c.text);
  const dangerSoft = fade(c.danger, 10);
  const dangerStrong = fade(c.danger, 35);
  const dangerHover = mix(c.danger, 75, c.text);
  const warningSoft = fade(c.warning, 15);

  return {
    'bg-app': c.frame,
    'bg-surface-1': fade(c.panel, 80),
    'bg-surface-2': c.panel,
    'text-primary': c.text,
    'text-secondary': secondary,
    'text-soft': soft,
    'text-muted': c.textMuted,
    'text-subtle': subtle,
    'text-raise': c.text,
    'text-on-accent': accentText,
    'border-soft': borderSoft,
    'border-strong': borderStrong,
    'border-default': c.border,
    'interactive-hover': hover,
    'interactive-active': active,
    'code-bg': active,
    'accent': c.accent,
    'accent-strong': accentStrong,
    'accent-text': accentText,
    'accent-text-raise': c.accent,
    'accent-edge': accentEdge,
    'accent-wash': fade(c.accent, 12),
    'accent-wash-strong': fade(c.accent, 25),
    'accent-track': fade(c.accent, 60),
    'accent-fill': accentSoft,
    'accent-fill-strong': fade(c.accent, 35),
    'focus-ring': fade(c.accent, 45),
    'scrollbar': c.border,
    'scrollbar-hover': borderStrong,
    'link-chip-bg': accentSoft,
    'link-chip-bg-hover': fade(c.accent, 28),
    'link-chip-border': 'transparent',
    'link-chip-text': accentText,
    'link-chip-text-hover': c.accent,
    'editor-code-bg': active,
    'editor-code-text': accentText,
    'editor-mark-bg': accentSoft,
    'editor-mark-text': c.text,
    'editor-color-red': textColors.red,
    'editor-color-orange': textColors.orange,
    'editor-color-yellow': textColors.yellow,
    'editor-color-green': textColors.green,
    'editor-color-blue': textColors.blue,
    'editor-color-purple': textColors.purple,
    'editor-toolbar-active-bg': accentSoft,
    'editor-toolbar-active-text': accentText,
    'link-picker-tab-active-bg': accentSoft,
    'link-picker-tab-active-text': accentText,
    'link-picker-tab-active-count': accentText,
    'link-picker-tab-idle-text': c.textMuted,
    'link-picker-tab-idle-hover-bg': hover,
    'link-picker-tab-idle-hover-text': c.text,
    'link-picker-row-hover-bg': hover,
    'link-picker-row-hover-text': c.text,
    'menu-bg': c.panel,
    'menu-border': c.border,
    'menu-shadow': `0 14px 36px ${shadow}`,
    'menu-item-hover-bg': hover,
    'menu-item-hover-text': c.text,
    'menu-item-active-bg': accentSoft,
    'menu-item-active-text': accentText,
    'linked-chip-bg': active,
    'linked-chip-border': borderSoft,
    'linked-chip-text': c.textMuted,
    'warning-text': c.warning,
    'danger-text': c.danger,
    'danger-bg': dangerSoft,
    'danger-border': dangerStrong,
    'danger-hover-text': dangerHover,
    'danger-hover-bg': fade(c.danger, 18),
    'danger-hover-border': fade(c.danger, 50),
    'danger-solid-bg': c.danger,
    'danger-solid-border': dangerHover,
    'danger-solid-text': c.sheet,
    'danger-solid-hover-bg': dangerHover,
    'danger-soft-text': c.danger,
    'danger-soft-border': dangerStrong,
    'danger-wash': dangerSoft,
    'success-text': c.success,
    'select-option-bg': c.panel,
    'select-option-text': secondary,
    'select-option-active-bg': accentSoft,
    'select-option-active-text': accentText,
    'switch-thumb': c.text,
    'switch-thumb-on': c.accent,
    'field-bg': fade(c.panel, 80),
    'field-bg-hover': raised,
    'field-border': c.border,
    'field-border-hover': borderStrong,
    'field-inset-bg': c.frame,
    'primary-solid-bg': c.accent,
    'primary-solid-border': accentStrong,
    'primary-solid-text': c.onAccent,
    'primary-solid-hover-bg': accentHover,
    'primary-solid-hover-text': c.onAccent,
    'shell-bg': c.frame,
    'sheet-bg': c.sheet,
    'sheet-border': borderSoft,
    'panel-bg': c.panel,
    'panel-border': borderSoft,
    'panel-hover-bg': raised,
    'panel-hover-border': c.border,
    'tab-pill-active': active,
    'tab-pill-hover': hover,
    'tab-close-hover-bg': active,
    'search-bg': fade(c.panel, 80),
    'search-border': c.border,
    'search-inset': 'inset 0 0 0 transparent',
    'list-search-bg': hover,
    'choice-bg': fade(c.panel, 80),
    'choice-bg-hover': raised,
    'choice-border': c.border,
    'choice-border-hover': borderStrong,
    'choice-text': secondary,
    'choice-text-hover': c.text,
    'choice-active-bg': accentSoft,
    'choice-active-border': accentEdge,
    'choice-active-text': accentText,
    'modal-scrim': 'rgba(0, 0, 0, 0.5)',
    'tone-jade-bg': accentSoft,
    'tone-jade-bg-hover': fade(c.accent, 28),
    'tone-jade-border': accentEdge,
    'tone-jade-border-hover': c.accent,
    'tone-jade-text': accentText,
    'tone-jade-text-hover': accentText,
    'tone-amber-bg': warningSoft,
    'tone-amber-bg-hover': fade(c.warning, 25),
    'tone-amber-border': fade(c.warning, 60),
    'tone-amber-border-hover': c.warning,
    'tone-amber-text': c.warning,
    'tone-amber-text-hover': c.warning,
    'tone-danger-bg': dangerSoft,
    'tone-danger-bg-hover': fade(c.danger, 18),
    'tone-danger-border': dangerStrong,
    'tone-danger-border-hover': c.danger,
    'tone-danger-text': c.danger,
    'tone-danger-text-hover': dangerHover,
    'tone-neutral-bg': fade(c.panel, 80),
    'tone-neutral-bg-hover': raised,
    'tone-neutral-border': c.border,
    'tone-neutral-border-hover': borderStrong,
    'tone-neutral-text': c.textMuted,
    'tone-neutral-text-hover': c.text,
    'secondary-bg': fade(c.panel, 80),
    'secondary-bg-hover': raised,
    'secondary-border': c.border,
    'secondary-border-hover': borderStrong,
    'secondary-text': secondary,
    'secondary-text-hover': c.text,
    'mark-accent': c.accent,
    'mark-line': mix(c.accent, 20, '#fff'),
    'edge': borderSoft,
    'edge-strong': c.border,
    'edge-raise': borderStrong,
    'well': fade(c.panel, 50),
    'well-strong': fade(c.panel, 70),
    'well-raise': raised,
    'well-solid': c.panel,
    'well-active': active,
    'well-sunk': fade(c.frame, 45),
    'well-deep': fade(c.frame, 35),
    'well-tint': fade(c.panel, 80),
    'well-page': c.sheet,
    'overlay': fade(c.frame, 85),
    'canvas': fade(c.frame, 80),
  };
}

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Colour pairs below the contrast rule of Documentation/design.md. A warning, not a refusal. */
export function customThemeContrastProblems({ colors: c }: CustomTheme): string[] {
  const pairs: Array<[string, string, string]> = [
    ['text / sheet', c.text, c.sheet],
    ['text / panel', c.text, c.panel],
    ['textMuted / sheet', c.textMuted, c.sheet],
    ['textMuted / panel', c.textMuted, c.panel],
    ['textMuted / frame', c.textMuted, c.frame],
    ['accent / sheet', c.accent, c.sheet],
    ['onAccent / accent', c.onAccent, c.accent],
    ['danger / sheet', c.danger, c.sheet],
    ['warning / sheet', c.warning, c.sheet],
  ];
  return pairs.filter(([, a, b]) => contrastRatio(a, b) < 4.5).map(([label]) => label);
}
