/**
 * The colours text can take in the editor (`TextColorMark`), stored by name
 * only (`data-color`), never as a value. Each theme sets the shade: the
 * built-in ones as `--editor-color-<name>` in their CSS files, a custom theme
 * through `customThemeTokens`, the PDF export with the light shades. So
 * coloured text stays readable on a dark and on a light sheet alike.
 */
export const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

export function isTextColor(value: unknown): value is TextColor {
  return (TEXT_COLORS as readonly unknown[]).includes(value);
}

/**
 * The shades per kind of sheet: light enough on a dark one, dark enough on a
 * light one. The same values as in `emerald-noctis.css` (dark) and
 * `emerald-parchment.css` (light), which CSS cannot import.
 */
export const TEXT_COLOR_SHADES: Record<'dark' | 'light', Record<TextColor, string>> = {
  dark: { red: '#f2837b', orange: '#f0a35e', yellow: '#e6cf6a', green: '#6fd69a', blue: '#7fb2f0', purple: '#b99af0' },
  light: { red: '#b4372c', orange: '#a85a17', yellow: '#8a6d00', green: '#23794a', blue: '#2b5fa8', purple: '#6d47b0' },
};
