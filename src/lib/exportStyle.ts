import { TEXT_COLORS, TEXT_COLOR_SHADES } from './textColors';
import { FONT_OPTIONS, type FontId } from '../themes/theme';
import { tagChipColors } from './tagChipColors';

/**
 * The look of the PDF and HTML exports, in one place: colours, fonts,
 * sizes, spacing — and the stylesheets built from them. `export.ts` (PDF)
 * and `htmlExport.ts` (HTML) only write markup and take their CSS from here;
 * to change how an export looks, change the values at the top of this file.
 *
 * The colours are copies of the app's themes (Parchment light, Noctis dark,
 * `src/themes/*.css`), not read from them: an export is a file of its own
 * and keeps the look it was written with. A change to a theme does not reach
 * the export by itself — bring it over here when it should.
 *
 * The entry's title and text are set in the font and size the export menu
 * chooses (`--doc-font`, `--doc-size`, from `exportFonts.ts`); labels, dates,
 * chips and the HTML file's own controls in the UI font (`--ui-font`).
 */

// ── Colours ─────────────────────────────────────────────────────────────────

export interface ExportPalette {
  /** Behind the sheet: the HTML page (the app's frame). */
  page: string;
  /** The sheet the entry stands on. */
  sheet: string;
  sheetBorder: string;
  /** Quiet fills: table heads, the search field, code. */
  panel: string;
  text: string;
  textSoft: string;
  muted: string;
  /** Labels, dates, counts. */
  subtle: string;
  /** Lines and frames: rules, tables, boxes. */
  border: string;
  accent: string;
  accentHover: string;
  /** Text on a filled accent (the Print button). */
  onAccent: string;
  accentText: string;
  /** The selected entry in the sidebar, focus rings. */
  accentSoft: string;
  accentEdge: string;
  /** A link chip. */
  chipBg: string;
  chipBorder: string;
  chipText: string;
  /** A search hit in the HTML file. */
  mark: string;
}

/** HTML, light — the app's Parchment theme. */
const LIGHT: ExportPalette = {
  page: '#ecdec7',
  sheet: '#faf3e6',
  sheetBorder: 'rgba(145, 108, 70, 0.28)',
  panel: '#f3e7d2',
  text: '#2c2014',
  textSoft: '#433121',
  muted: '#5b442e',
  subtle: '#775c41',
  border: 'rgba(166, 129, 91, 0.35)',
  accent: '#008a57',
  accentHover: '#006941',
  onAccent: '#ffffff',
  accentText: '#0a7a53',
  accentSoft: 'rgba(0, 138, 87, 0.10)',
  accentEdge: 'rgba(0, 138, 87, 0.45)',
  chipBg: 'rgba(0, 122, 77, 0.12)',
  chipBorder: 'rgba(0, 122, 77, 0.28)',
  chipText: '#0b6e48',
  mark: 'rgba(255, 196, 0, 0.38)',
};

/** HTML, dark — the app's Noctis theme. */
const DARK: ExportPalette = {
  page: '#100d0a',
  sheet: '#1c1712',
  sheetBorder: 'rgba(87, 83, 78, 0.35)',
  panel: '#26201b',
  text: '#f5f5f4',
  textSoft: '#e7e5e4',
  muted: '#a8a29e',
  subtle: '#8a837d',
  border: '#44403c',
  accent: '#00c47f',
  accentHover: '#00a066',
  onAccent: '#0b1a12',
  accentText: '#00c47f',
  accentSoft: 'rgba(0, 92, 58, 0.25)',
  accentEdge: 'rgba(0, 196, 127, 0.7)',
  chipBg: 'rgba(0, 160, 102, 0.12)',
  chipBorder: 'transparent',
  chipText: '#00e699',
  mark: 'rgba(255, 214, 10, 0.32)',
};

/** PDF and print — Parchment's ink on white paper. */
const PAPER: ExportPalette = {
  ...LIGHT,
  page: '#ffffff',
  sheet: '#ffffff',
  panel: '#f7efe1',
};

export const EXPORT_COLORS = { light: LIGHT, dark: DARK, paper: PAPER } as const;

// ── Fonts and sizes ─────────────────────────────────────────────────────────

/** The app font labels, dates and chips are set in, embedded like the text font (`exportFonts.ts`). */
export const EXPORT_UI_FONT: FontId = 'inter';

/** The UI font's stack: its name, then where it is missing. The PDF footer needs it spelled out (margin boxes do not inherit `:root`). */
const UI_STACK = `"${FONT_OPTIONS.find((font) => font.id === EXPORT_UI_FONT)?.label ?? 'Inter'}", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;

/** The text font and size where the export menu gives none. */
const TEXT_FALLBACK = 'Georgia, "Times New Roman", serif';
const TEXT_SIZE_FALLBACK = '17px';

const TYPE = {
  /** The entry's title: times the text size. */
  titleScale: 1.6,
  /** Headings in a text, relative to the text size. */
  h1: '1.5em',
  h2: '1.3em',
  h3: '1.1em',
  lineHeight: '1.7',
  /** Category and date above the title, the HTML file's controls. */
  meta: '12px',
  /** Labels in capitals: field names, a part's heading, sidebar groups. */
  label: '11px',
  labelSpacing: '0.07em',
  /** A tag. */
  tag: '12px',
  /** The HTML file's running UI text: sidebar rows, the search, the crumb, the outline. */
  body: '14px',
  small: '13px',
  /** The sidebar's title. */
  bundle: '15px',
  /** A link chip, relative to the text. */
  chip: '0.8em',
  /** The PDF's footer. */
  footer: '8pt',
} as const;

// ── Spacing and shapes ──────────────────────────────────────────────────────

const SPACE = {
  /** Below a paragraph, a list, a row group, a box. */
  block: '0.8em',
  /** Above a heading in a text. */
  heading: '1.2em',
  /** Above a part's heading (a sigil's "Charge"). */
  part: '1.5em',
  /** Between the label column and the value column of field rows. */
  rowGap: '20px',
  /** Width of the label column of field rows. */
  labelColumn: 'minmax(120px, 32%)',
  /** Around the entry on the HTML sheet; narrow windows use `sheetPaddingNarrow`. */
  sheetPadding: '40px 48px',
  sheetPaddingNarrow: '24px 20px',
  /** The text column of the HTML file. */
  docWidth: '700px',
  sidebarWidth: '280px',
  /** Height of the HTML file's buttons and search field. */
  control: '32px',
  outlineWidth: '200px',
} as const;

const RADIUS = {
  /** Icons in a chip or row, inline code, a search hit. */
  tiny: '3px',
  /** Link chips, notes, small buttons. */
  small: '6px',
  /** Buttons, the search field, sidebar rows. */
  medium: '8px',
  /** Content frames: the sheet, tables, sections, block pictures, covers. */
  large: '12px',
  /** Tags: pills, as in the app. */
  pill: '999px',
} as const;

/**
 * The PDF's page margins — the native page setup repeats them
 * (`src-tauri/src/pdf_export/mod.rs`), so change both.
 */
const PDF_MARGINS = '2cm 2.5cm';

// ── Built from the values above ─────────────────────────────────────────────

/** Icons as CSS masks, coloured by `background-color` (lucide's lock and chevron). */
const svgMask = (path: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${path}</svg>`)}")`;
const LOCK_ICON = svgMask("<rect x='3' y='11' width='18' height='11' rx='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/>");
const CHEVRON_ICON = svgMask("<path d='m6 9 6 6 6-6'/>");

/** A palette and the editor's text colours as the custom properties the stylesheets read. */
export function paletteVars(palette: ExportPalette, shades: keyof typeof TEXT_COLOR_SHADES): string {
  const vars = Object.entries(palette).map(([key, value]) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`);
  const colors = TEXT_COLORS.map((c) => `--color-${c}: ${TEXT_COLOR_SHADES[shades][c]};`);
  return [...vars, ...colors].join(' ');
}

/** A tag's chip colours as an inline style, by the app's rule (`tagChipColors`); empty keeps the neutral chip. */
export function tagStyle(color: string | null | undefined): string {
  const colors = tagChipColors(color);
  return colors ? `background-color: ${colors.background}; color: ${colors.text}; border-color: ${colors.border};` : '';
}

/** A label in capitals, the app's `label-xs`. */
const LABEL = `font-family: var(--ui-font); font-size: ${TYPE.label}; font-weight: 600; letter-spacing: ${TYPE.labelSpacing}; text-transform: uppercase; color: var(--subtle);`;

/** An entry as an `<article>` (`exportArticle`): head, tags, content — the same on paper and on screen. */
const ENTRY_CSS = `
:root { --ui-font: ${UI_STACK}; }
.entry-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-family: var(--ui-font); font-size: ${TYPE.meta}; color: var(--subtle); margin-bottom: 14px;
}
.topbar-category { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-weight: 500; min-width: 0; }
.topbar-icon { font-size: 1.15em; line-height: 1; }
.topbar-icon-img { width: 1.3em; height: 1.3em; object-fit: cover; border-radius: ${RADIUS.tiny}; flex-shrink: 0; }
.topbar-date { white-space: nowrap; }
h1.entry-title {
  font-family: var(--doc-font, ${TEXT_FALLBACK}); font-size: calc(var(--doc-size, ${TEXT_SIZE_FALLBACK}) * ${TYPE.titleScale});
  font-weight: 600; line-height: 1.25; color: var(--text); margin: 0 0 12px; overflow-wrap: anywhere;
}
.entry-number { font-family: var(--ui-font); font-size: 0.45em; font-weight: 500; color: var(--subtle); margin-left: 0.5em; vertical-align: middle; }
.entry-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.tag {
  display: inline-block; font-family: var(--ui-font); font-size: ${TYPE.tag}; font-weight: 500; line-height: 22px;
  padding: 0 10px; border-radius: ${RADIUS.pill}; border: 1px solid var(--border); background-color: var(--panel); color: var(--muted);
}
.entry-rule { height: 0; border: 0; border-top: 1px solid var(--border); margin: 18px 0 22px; }

.entry-content {
  font-family: var(--doc-font, ${TEXT_FALLBACK}); font-size: var(--doc-size, ${TEXT_SIZE_FALLBACK});
  line-height: ${TYPE.lineHeight}; color: var(--text); overflow-wrap: break-word;
}
.entry-content > :first-child { margin-top: 0; }
.entry-content p { margin: 0 0 ${SPACE.block}; }
.entry-content h1, .entry-content h2, .entry-content h3, .entry-content h4 { font-weight: 600; line-height: 1.3; margin: ${SPACE.heading} 0 0.45em; }
.entry-content h1 { font-size: ${TYPE.h1}; }
.entry-content h2 { font-size: ${TYPE.h2}; }
.entry-content h3 { font-size: ${TYPE.h3}; }
.entry-content h4 { font-size: 1em; }
/* A block's part (a sigil's "Charge"): a label with a line, not a heading of the text. */
.entry-content h4.export-part {
  ${LABEL} line-height: 1.4; margin: ${SPACE.part} 0 0.6em; display: flex; align-items: center; gap: 10px;
}
.entry-content h4.export-part::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
/* A block's note (a sigil's "Loaded"): a small accent chip. */
.entry-content p.export-note {
  display: inline-flex; align-items: center; gap: 6px; font-family: var(--ui-font); font-size: ${TYPE.meta}; font-weight: 500;
  line-height: 1.6; color: var(--accent-text); background: var(--chip-bg); border-radius: ${RADIUS.small}; padding: 1px 9px;
}
.entry-content p.export-note::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
/* Field rows: the name in capitals on the left, the value on the right. */
.entry-content dl {
  display: grid; grid-template-columns: ${SPACE.labelColumn} 1fr; column-gap: ${SPACE.rowGap}; row-gap: 6px;
  align-items: baseline; margin: 0 0 ${SPACE.block};
}
.entry-content dt { ${LABEL} line-height: 1.4; padding-top: 0.15em; }
.entry-content dd { margin: 0; min-width: 0; }
.entry-content dd > :last-child { margin-bottom: 0; }
.entry-content ul, .entry-content ol { padding-left: 1.4em; margin: 0 0 ${SPACE.block}; }
/* A list in a field's value (a checklist, a text field's bullets) keeps its bullets, without the gap below. */
.entry-content dd ul, .entry-content dd ol { margin: 0; }
.entry-content li { margin-bottom: 0.15em; }
.entry-content li > p { margin: 0; }
.entry-content li::marker { color: var(--subtle); }
.entry-content blockquote {
  margin: 0.2em 0 ${SPACE.block}; padding: 0.1em 0 0.1em 1em; border-left: 2px solid var(--accent);
  font-style: italic; color: var(--muted);
}
.entry-content blockquote > :last-child { margin-bottom: 0; }
/* An image's alignment comes as margin-left/-right in its style attribute; only the vertical spacing is set here. */
.entry-content img { display: block; max-width: 100%; height: auto; margin: 0.6em 0; border-radius: ${RADIUS.small}; }
/* A block's picture (an altar, a drawing, an image field) in a frame. */
.entry-content img[data-export-placeholder] { border: 1px solid var(--border); border-radius: ${RADIUS.large}; margin: 0.4em 0 ${SPACE.block}; }
.entry-content dd img[data-export-placeholder] { margin: 0.2em 0; }
.entry-content hr { border: 0; border-top: 1px solid var(--border); margin: 1.6em 0; }
.entry-content pre {
  background: var(--panel); padding: 0.8em 1em; border-radius: ${RADIUS.medium};
  white-space: pre-wrap; font-size: 0.85em; margin: 0 0 ${SPACE.block};
}
.entry-content code { background: var(--panel); padding: 0.12em 0.35em; border-radius: ${RADIUS.tiny}; font-size: 0.88em; }
.entry-content pre code { background: none; padding: 0; }
/* A table whose columns were resized carries a pixel width inline; on the
   page it is the text column, or the right columns would be cut off. */
.entry-content table {
  border-collapse: separate; border-spacing: 0; width: 100% !important; max-width: 100%; table-layout: fixed;
  border: 1px solid var(--border); border-radius: ${RADIUS.large}; margin: 0.4em 0 ${SPACE.block}; font-size: 0.95em;
}
/* The corner cells are rounded themselves: clipping a table (overflow) differs between engines, also across page breaks. */
.entry-content tr:first-child > :first-child { border-top-left-radius: ${RADIUS.large}; }
.entry-content tr:first-child > :last-child { border-top-right-radius: ${RADIUS.large}; }
.entry-content tr:last-child > :first-child { border-bottom-left-radius: ${RADIUS.large}; }
.entry-content tr:last-child > :last-child { border-bottom-right-radius: ${RADIUS.large}; }
.entry-content col { width: auto !important; }
.entry-content th { background: var(--panel); font-weight: 600; text-align: left; }
.entry-content td, .entry-content th { padding: 0.45em 0.8em; border-bottom: 1px solid var(--border); vertical-align: top; }
.entry-content td + td, .entry-content th + th, .entry-content td + th, .entry-content th + td { border-left: 1px solid var(--border); }
.entry-content tr:last-child > td, .entry-content tr:last-child > th { border-bottom: 0; }
.entry-content td p, .entry-content th p { margin: 0; }
.entry-content details { border: 1px solid var(--border); border-radius: ${RADIUS.large}; padding: 0.5em 0.9em; margin: 0 0 ${SPACE.block}; }
.entry-content details > :last-child { margin-bottom: 0; }
.entry-content summary { font-weight: 600; list-style: none; display: flex; align-items: center; gap: 6px; }
.entry-content summary::-webkit-details-marker { display: none; }
.entry-content summary::before {
  content: ""; display: inline-block; vertical-align: -0.15em; width: 14px; height: 14px; flex-shrink: 0; background-color: var(--subtle);
  -webkit-mask: ${CHEVRON_ICON} center / contain no-repeat; mask: ${CHEVRON_ICON} center / contain no-repeat;
}
.entry-content details:not([open]) > summary::before { transform: rotate(-90deg); }
.entry-content details > :not(summary) { margin-left: 20px; }
.entry-content details > summary + * { margin-top: 0.3em; }
${TEXT_COLORS.map((c) => `.entry-content span[data-color="${c}"] { color: var(--color-${c}); }`).join('\n')}
/* Link chips, as in the app. */
.entry-content [data-type="internalLink"] {
  display: inline-flex; align-items: center; gap: 4px; font-family: var(--ui-font); font-size: ${TYPE.chip}; font-weight: 500;
  line-height: 1.5; padding: 0 0.45em; border-radius: ${RADIUS.small}; vertical-align: 0.05em; text-decoration: none;
  background: var(--chip-bg); border: 1px solid var(--chip-border); color: var(--chip-text);
}
.entry-content [data-type="internalLink"] .il-icon-img { width: 13px; height: 13px; object-fit: cover; border-radius: ${RADIUS.tiny}; margin: 0; display: inline; border: 0; }
.entry-content [data-type="internalLink"] .il-icon-emoji { font-size: 0.95em; line-height: 1; }
.entry-content [data-type="internalLink"].il-external { background: var(--panel); border: 1px dashed var(--border); color: var(--muted); }
.entry-content [data-type="internalLink"].il-gone { background: transparent; border: 1px solid var(--border); color: var(--subtle); text-decoration: line-through; }
.entry-content a { color: var(--accent-text); }
/* Covered content (a concealed sigil part): the cover with a lock and, in HTML, its switch. */
.export-concealed { margin: 0 0 ${SPACE.block}; }
.export-concealed-cover {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 !important;
  padding: 10px 14px; border: 1px dashed var(--border); border-radius: ${RADIUS.large};
  font-family: var(--ui-font); font-size: ${TYPE.small}; line-height: 1.4; color: var(--muted);
}
.export-concealed-cover::before {
  content: ""; width: 14px; height: 14px; flex-shrink: 0; background-color: var(--subtle);
  -webkit-mask: ${LOCK_ICON} center / contain no-repeat; mask: ${LOCK_ICON} center / contain no-repeat;
}
.export-concealed-toggle {
  margin-left: auto; font: inherit; font-size: ${TYPE.meta}; font-weight: 500; color: var(--text-soft); background: transparent;
  border: 1px solid var(--border); border-radius: ${RADIUS.medium}; padding: 3px 10px; cursor: pointer;
}
.export-concealed-toggle:hover { background: var(--panel); }
.export-concealed-toggle:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.export-concealed-body { display: none; padding-top: 0.6em; }
.export-concealed.revealed .export-concealed-body { display: block; }
`;

/**
 * A CSS string for `content:`, written into a `<style>` element. Every
 * character outside a plain set is a CSS hex escape, so a title can neither
 * end the string nor the element (`</style>`); CSS shows it unchanged.
 */
export function cssString(text: string): string {
  const escaped = Array.from(text.replace(/[\r\n]+/g, ' '), (c) =>
    /[\p{L}\p{N} .,:;·'!?()&+\-–—]/u.test(c) ? c : `\\${c.codePointAt(0)!.toString(16)} `).join('');
  return `"${escaped}"`;
}

/**
 * The PDF document's stylesheet. The footer names the document on the left
 * and "Emerald · Page n of m" on the right; `pageOf` is the page text with
 * `{{page}}` and `{{pages}}` in it. The footer is drawn in the page margin
 * (`@page` margin boxes) — where a webview cannot draw them, the pages
 * simply have none.
 */
export function pdfCss({ title, pageOf }: { title: string; pageOf: string }): string {
  const pageContent = pageOf.split(/(\{\{pages?\}\})/).filter(Boolean)
    .map((piece) => (piece === '{{page}}' ? 'counter(page)' : piece === '{{pages}}' ? 'counter(pages)' : cssString(piece)))
    .join(' ');
  const footerBox = `font-family: ${UI_STACK}; font-size: ${TYPE.footer}; color: ${PAPER.subtle};
    border-top: 0.5pt solid ${PAPER.border}; vertical-align: top; padding-top: 6pt; margin-top: 0.8cm;`;
  return `
:root { ${paletteVars(PAPER, 'light')} }
/* Both webviews print without backgrounds by default; chips, tags and boxes keep theirs. */
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: var(--sheet); }
${ENTRY_CSS}
/* Mirrored for the native page setup in src-tauri/src/pdf_export/mod.rs. */
@page {
  margin: ${PDF_MARGINS};
  @bottom-left { content: ${cssString(title)}; ${footerBox} text-align: left; }
  @bottom-right { content: "Emerald · " ${pageContent}; ${footerBox} text-align: right; }
}
@media print {
  /* Keep WKWebView from avoiding page breaks inside elements, which leaves large gaps before page boundaries. */
  * {
    page-break-inside: auto !important; break-inside: auto !important;
    page-break-before: auto !important; break-before: auto !important;
    page-break-after: auto !important; break-after: auto !important;
  }
  /* A part's heading stays with its first row. */
  .entry-content h4.export-part { page-break-after: avoid !important; break-after: avoid !important; }
  /* Several entries: each starts on a page of its own. */
  .entry-article + .entry-article { page-break-before: always !important; break-before: page !important; }
}
@media screen { .entry-article + .entry-article { margin-top: 3em; } }
`;
}

/** The HTML file's stylesheet: its sheet, sidebar, toolbar and outline around the entries, light and dark. */
export const HTML_CSS = `
:root { ${paletteVars(LIGHT, 'light')} color-scheme: light; }
:root[data-theme="dark"] { ${paletteVars(DARK, 'dark')} color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--page); color: var(--text);
  font-family: var(--ui-font); font-size: ${TYPE.body}; -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
button { font-family: inherit; }
.app { display: flex; min-height: 100vh; }
${ENTRY_CSS}

/* Sidebar */
.sidebar {
  width: ${SPACE.sidebarWidth}; flex-shrink: 0; background: var(--page);
  position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column;
}
.sidebar-head { padding: 18px 14px 6px; }
.bundle-title { font-weight: 600; font-size: ${TYPE.bundle}; line-height: 1.3; padding: 0 6px; overflow-wrap: anywhere; }
.bundle-sub { color: var(--subtle); font-size: ${TYPE.meta}; margin: 2px 0 12px; padding: 0 0 0 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sort-btn {
  font-size: ${TYPE.meta}; color: var(--subtle); background: transparent; border: 1px solid transparent;
  border-radius: ${RADIUS.small}; padding: 1px 6px; cursor: pointer; flex-shrink: 0;
}
.sort-btn:hover { color: var(--text); background: var(--panel); }
.sort-btn:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search {
  width: 100%; height: ${SPACE.control}; padding: 0 10px; border-radius: ${RADIUS.medium}; border: 1px solid var(--border);
  background: var(--panel); color: var(--text); font: inherit; font-size: ${TYPE.small}; outline: none;
}
.search::placeholder { color: var(--subtle); }
.search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.nav { overflow-y: auto; padding: 0 12px 24px; flex: 1; }
.nav-group { margin-top: 8px; }
.nav-group[hidden] { display: none; }
.nav-group-title { ${LABEL} padding: 8px 8px 6px; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 6px 10px; margin-bottom: 2px; border-radius: ${RADIUS.medium};
  border: 1px solid transparent; text-decoration: none; color: var(--text);
}
.nav-item:hover { background: var(--panel); }
.nav-item.active { background: var(--accent-soft); border-color: var(--accent-edge); }
.nav-item.active .nav-title { color: var(--accent-text); }
.nav-item[hidden] { display: none; }
.nav-icon { width: 20px; text-align: center; flex-shrink: 0; line-height: 1; }
.nav-icon-img, .ref-icon img { width: 18px; height: 18px; border-radius: ${RADIUS.tiny}; object-fit: cover; vertical-align: middle; }
.nav-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.nav-title { font-size: ${TYPE.body}; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-sub { font-size: ${TYPE.meta}; color: var(--subtle); }
.nav-media { font-size: 11px; flex-shrink: 0; opacity: .8; }
.nav-hits { font-size: 11px; font-weight: 600; background: var(--accent); color: var(--on-accent); border-radius: 10px; padding: 0 7px; line-height: 18px; }
.no-results { color: var(--subtle); font-size: ${TYPE.small}; padding: 16px; text-align: center; }

/* Main: the toolbar on the frame, the sheet below it */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 0 8px 8px 0; }
.toolbar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px;
  padding: 8px 6px; background: var(--page);
}
.crumb { flex: 1; min-width: 0; color: var(--subtle); font-size: ${TYPE.small}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: ${SPACE.control}; min-width: ${SPACE.control};
  font-size: ${TYPE.meta}; font-weight: 500; color: var(--muted); background: transparent; border: 1px solid var(--border);
  border-radius: ${RADIUS.medium}; padding: 0 10px; cursor: pointer; line-height: 1;
}
.tb-btn:hover { background: var(--panel); color: var(--text); }
.tb-btn:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tb-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; padding: 0 14px; }
.tb-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-accent); }
.tb-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
/* The theme switch shows the theme it switches to. */
.icon-sun, :root[data-theme="dark"] .icon-moon { display: none; }
:root[data-theme="dark"] .icon-sun { display: block; }
#sidebar-btn { display: none; }
.content-wrap {
  flex: 1; display: flex; justify-content: center; gap: 40px; padding: ${SPACE.sheetPadding};
  background: var(--sheet); border: 1px solid var(--sheet-border); border-radius: ${RADIUS.large};
}
.doc { width: 100%; max-width: ${SPACE.docWidth}; min-width: 0; }
body.has-sidebar .entry-article:not(.active) { display: none; }
.entry-content h1, .entry-content h2, .entry-content h3 { scroll-margin-top: 64px; }
mark.hit { background: var(--mark); color: inherit; border-radius: ${RADIUS.tiny}; padding: 0 1px; }

/* References */
.refs { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); display: grid; gap: 14px; }
.refs h2 { ${LABEL} margin: 0 0 8px; }
.refs-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ref {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: ${RADIUS.medium}; font-size: ${TYPE.small};
  border: 1px solid var(--border); text-decoration: none; color: var(--text-soft);
}
.ref:hover { border-color: var(--accent); color: var(--accent-text); }
.footer { text-align: center; color: var(--subtle); font-size: ${TYPE.meta}; margin-top: 28px; }
.footer a { color: var(--accent-text); font-weight: 600; text-decoration: none; }
.footer a:hover { text-decoration: underline; }

/* Outline */
.outline { width: ${SPACE.outlineWidth}; flex-shrink: 0; position: sticky; top: 64px; align-self: flex-start; max-height: calc(100vh - 100px); overflow-y: auto; padding-top: 4px; }
.outline-title { ${LABEL} margin-bottom: 10px; }
.outline a { display: block; font-size: ${TYPE.small}; color: var(--muted); text-decoration: none; padding: 3px 0 3px 10px; border-left: 2px solid var(--border); }
.outline a:hover { color: var(--text); }
.outline a.active { color: var(--accent-text); border-left-color: var(--accent); }
.outline a.lvl-2 { padding-left: 20px; }
.outline a.lvl-3 { padding-left: 30px; }
@media (max-width: 1180px) { .outline { display: none !important; } }

/* Narrow screens: the sidebar becomes a drawer */
@media (max-width: 820px) {
  #sidebar-btn { display: inline-flex; }
  .main { padding: 0 6px 6px; }
  .sidebar { position: fixed; left: 0; top: 0; z-index: 20; transform: translateX(-100%); transition: transform .2s ease; }
  body.sidebar-open .sidebar { transform: none; box-shadow: 0 0 40px rgba(0,0,0,.25); }
  .content-wrap { padding: ${SPACE.sheetPaddingNarrow}; }
}

@media print {
  :root, :root[data-theme="dark"] { ${paletteVars(PAPER, 'light')} }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: var(--sheet); }
  .sidebar, .toolbar, .outline, .footer, .refs { display: none !important; }
  .main { padding: 0; }
  .content-wrap { padding: 0; display: block; border: 0; border-radius: 0; }
  .doc { max-width: none; }
  body.has-sidebar .entry-article:not(.active) { display: block; }
  .entry-article + .entry-article { break-before: page; }
  mark.hit { background: none; }
  .export-concealed-toggle, .export-concealed.revealed .export-concealed-cover { display: none; }
}
`;
