import { readFileAsDataUrl } from './helpers';
import { EXPORT_UI_FONT } from './exportStyle';
import {
  EDITOR_FONT_SIZE_OPTIONS, FONT_OPTIONS,
  type EditorFontSize, type FontId,
} from '../themes/theme';

/**
 * The fonts of a PDF or HTML export: the app's, which ship with it and
 * are embedded into the file, and a few common ones that Windows and macOS
 * both have and that are left to the system that opens the file.
 */

const SYSTEM_FONTS = [
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
] as const;

export type ExportFontId = FontId | (typeof SYSTEM_FONTS)[number]['id'];

export const EXPORT_FONT_OPTIONS: ReadonlyArray<{ id: ExportFontId; label: string }> = [
  ...FONT_OPTIONS,
  ...SYSTEM_FONTS.map(({ id, label }) => ({ id, label })),
];
export const EXPORT_FONT_IDS: readonly ExportFontId[] = EXPORT_FONT_OPTIONS.map(({ id }) => id);
export const EXPORT_FONT_SIZES = EDITOR_FONT_SIZE_OPTIONS;

/** The font and size the entries' title and text are set in. */
export interface ExportTypography {
  font: ExportFontId;
  size: EditorFontSize;
}

/** The serif app fonts; their fallbacks as in `index.css` (`--font-*`). */
const SERIF_APP_FONTS: ReadonlySet<FontId> = new Set(['alegreya', 'cormorant-garamond', 'lora', 'merriweather']);

function appFont(id: ExportFontId): (typeof FONT_OPTIONS)[number] | undefined {
  return FONT_OPTIONS.find((font) => font.id === id);
}

/** The CSS `font-family` of a font, with fallbacks for a system that lacks it. */
export function fontStack(id: ExportFontId): string {
  const system = SYSTEM_FONTS.find((font) => font.id === id);
  if (system) return system.stack;
  const font = appFont(id);
  if (!font) return SYSTEM_FONTS[0].stack;
  return SERIF_APP_FONTS.has(font.id)
    ? `"${font.label}", Georgia, serif`
    : `"${font.label}", "Segoe UI", system-ui, sans-serif`;
}

/**
 * The `@font-face` rules of an app font, its files inlined as data URLs — the
 * export document reaches no file of the app. Read from the app's own
 * stylesheet (`fonts.css`), so every weight and style the app has comes along
 * with its character ranges. Empty for a system font.
 */
export async function embeddedFontCss(id: ExportFontId): Promise<string> {
  const font = appFont(id);
  if (!font) return '';
  const faces: Array<{ rule: CSSFontFaceRule; base: string }> = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule
        && rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim() === font.label) {
        faces.push({ rule, base: sheet.href ?? document.baseURI });
      }
    }
  }
  const out = await Promise.all(faces.map(async ({ rule, base }) => {
    const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(rule.style.getPropertyValue('src'))?.[1];
    if (!url) return '';
    try {
      const response = await fetch(new URL(url, base));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await readFileAsDataUrl(await response.blob())).split(',')[1];
      const prop = (name: string) => rule.style.getPropertyValue(name);
      return `@font-face { font-family: "${font.label}"; font-style: ${prop('font-style') || 'normal'}; `
        + `font-weight: ${prop('font-weight') || '400'}; font-display: block; `
        + `src: url(data:font/woff2;base64,${data}) format("woff2");`
        + `${prop('unicode-range') ? ` unicode-range: ${prop('unicode-range')};` : ''} }`;
    } catch (err) {
      // Without the file the fallback of `fontStack` steps in.
      console.warn('[export] font file not embedded', url, err);
      return '';
    }
  }));
  return out.filter(Boolean).join('\n');
}

/**
 * CSS that sets the entries in the font and size: `@font-face` rules of the
 * text font and of the UI font labels and chips are set in
 * (`EXPORT_UI_FONT`, `exportStyle.ts`), and the custom properties the
 * export's stylesheet reads.
 */
export async function typographyCss({ font, size }: ExportTypography): Promise<string> {
  const faces = [await embeddedFontCss(font), font === EXPORT_UI_FONT ? '' : await embeddedFontCss(EXPORT_UI_FONT)];
  return `${faces.filter(Boolean).join('\n')}\n:root { --doc-font: ${fontStack(font)}; --doc-size: ${size}px; }`;
}
