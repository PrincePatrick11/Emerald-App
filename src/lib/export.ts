import { invoke } from '@tauri-apps/api/core';
import { imageRefsInHtml, readImageAsBase64, rewriteImageRefs } from './images';
import { save, message } from '@tauri-apps/plugin-dialog';
import TurndownService from 'turndown';
import { TEXT_COLORS, TEXT_COLOR_SHADES } from './textColors';
import { format } from 'date-fns';
import { exportFilename, safeFileBase } from './helpers';
import { compressDataUrl } from './imageCompression';
import type { ImageMode } from './emerald/manifest';
import DOMPurify from 'dompurify';
import type { ExportData } from './exportData';
import { useEntryStore } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import { useCategoryStore } from '../store/categoryStore';
import { DEFAULT_ENTRY_ICON, DEFAULT_TASK_ICON, entryIcon } from './entryIcon';
import { portableIcon } from './icons';
import { typographyCss, type ExportTypography } from './exportFonts';
import type { ExportOrder } from './exportMenu';
import i18n from '../i18n';

// ── helpers ────────────────────────────────────────────────────────────────

export function htmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeDataImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(trimmed) ? trimmed : null;
}


/** The vault's pictures in the HTML as data URLs, compressed by `mode` (`placeholder` is `stripImages`' job). */
async function embedImages(html: string, mode: Exclude<ImageMode, 'placeholder'>): Promise<string> {
  const refs = [...new Set(imageRefsInHtml(html))];
  if (refs.length === 0) return html;

  const resolved = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      try {
        const original = await readImageAsBase64(ref);
        resolved.set(ref, mode === 'none' ? original : await compressDataUrl(original, mode));
      } catch {
        // File is missing — empty src instead of a dead reference in the export.
        resolved.set(ref, '');
      }
    })
  );

  return rewriteImageRefs(html, (ref) => resolved.get(ref) ?? null);
}

/**
 * Images are dropped from the Markdown. The images of the blocks (sigil drawing,
 * image field; `data-export-placeholder`) leave their caption behind as a
 * placeholder — images in the text disappear entirely, as before.
 */
function stripImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = /\bdata-export-placeholder=/i.test(tag) ? /\balt="([^"]+)"/i.exec(tag)?.[1] : undefined;
    return alt ? `<em>[${alt}]</em>` : '';
  });
}

/**
 * Pre-resolve missing data-icon attributes on internal link spans.
 * TipTap only stores the icon at save-time; if it was null then, we fill it now.
 * An uploaded icon is a file the export document cannot reach: it goes in as
 * a data URL (`portableIcon`).
 *
 * A link whose target is in the trash or deleted for good gets `data-gone`,
 * so the export shows it struck through like the app does (`il-gone`).
 */
async function resolveInternalLinkIcons(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = doc.querySelectorAll<HTMLElement>('span[data-type="internalLink"]');
  if (!links.length) return html;

  const { entries } = useEntryStore.getState();
  const { tasks } = useTaskStore.getState();
  const { categories } = useCategoryStore.getState();

  for (const el of links) {
    const id        = el.getAttribute('data-id');
    const targetKind = el.getAttribute('data-target-kind');
    if (!id) continue;
    const exists = targetKind === 'task' ? tasks.some((t) => t.id === id) : entries.some((e) => e.id === id);
    if (!exists) {
      el.setAttribute('data-gone', '');
      continue;
    }
    // Only fill missing icons
    if (el.getAttribute('data-icon')) continue;

    let icon = '';
    if (targetKind === 'entry') {
      // The same icon as in the app; the moon phase is left out, as the chip shows it live only.
      const entry = entries.find(e => e.id === id);
      if (entry) icon = entryIcon(entry, categories.find(c => c.id === entry.category_id), false);
    } else if (targetKind === 'task') {
      // Task chips from sidebar drags carry no data-icon — as in the
      // editor's live lookup: category emoji, otherwise the chip fallback.
      const task = tasks.find(t => t.id === id);
      if (task) icon = categories.find(c => c.id === task.category_id)?.emoji ?? DEFAULT_TASK_ICON;
    }
    icon = await portableIcon(icon);
    if (icon) el.setAttribute('data-icon', icon);
  }

  return doc.body.innerHTML;
}

/** DOM id of an entry in a PDF or HTML export — what its links jump to. */
export function entryAnchor(id: string): string {
  return `entry-${id.replace(/[^\w-]/g, '')}`;
}

/**
 * Replaces the inner content of every `<span data-type="internalLink">` with
 * the visible chip elements (icon `<img>` or `<span>` + label `<span>`) and
 * strips the now-redundant `data-icon` / `data-label` attributes.
 *
 * Runs in TypeScript before the HTML is handed to `export_pdf`, so the PDF
 * document needs no script of its own: it is loaded over `file://`, where
 * the app CSP does not apply, and stays script-free on purpose.
 *
 * With `bundleIds` (the HTML export) a link to an entry in the same file
 * becomes an `<a href="#entry-…">` that jumps there; one to an entry outside
 * stays a chip, marked `il-external`. A link to a gone target is marked
 * `il-gone` (see `resolveInternalLinkIcons`).
 */
function transformInternalLinks(html: string, bundleIds?: ReadonlySet<string>): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = doc.querySelectorAll<HTMLElement>('span[data-type="internalLink"]');
  if (!links.length) return html;

  for (const el of Array.from(links)) {
    const icon  = el.getAttribute('data-icon')  || '';
    const label = el.getAttribute('data-label') || el.textContent || '';
    const gone  = el.hasAttribute('data-gone');

    // Drop attributes the CSS no longer reads — they're now baked into the children.
    el.removeAttribute('data-icon');
    el.removeAttribute('data-label');
    el.removeAttribute('data-gone');

    el.textContent = '';
    if (icon.startsWith('data:')) {
      const img = doc.createElement('img');
      img.src = icon;
      img.className = 'il-icon-img';
      el.appendChild(img);
    } else if (icon) {
      const sp = doc.createElement('span');
      sp.textContent = icon;
      sp.className = 'il-icon-emoji';
      el.appendChild(sp);
    }
    const lbl = doc.createElement('span');
    lbl.textContent = label;
    el.appendChild(lbl);

    // Target in the trash or deleted: struck through, never a jump.
    if (gone) {
      el.classList.add('il-gone');
      continue;
    }
    if (!bundleIds) continue;
    const targetId = el.getAttribute('data-id') ?? '';
    if (bundleIds.has(targetId)) {
      const a = doc.createElement('a');
      for (const attr of Array.from(el.attributes)) a.setAttribute(attr.name, attr.value);
      a.setAttribute('href', `#${entryAnchor(targetId)}`);
      while (el.firstChild) a.appendChild(el.firstChild);
      el.replaceWith(a);
    } else {
      el.classList.add('il-external');
    }
  }

  return doc.body.innerHTML;
}

/** The entry's icon (`ExportData.icon`) as a picture or an emoji; an icon file that could not be read is the default. */
export function exportIcon(data: ExportData): { image: string | null; emoji: string } {
  const image = sanitizeDataImageUrl(data.icon);
  const emojiIcon = !image && data.icon && !data.icon.startsWith('data:');
  return { image, emoji: emojiIcon ? data.icon : DEFAULT_ENTRY_ICON };
}

/** The date an export shows, in English like the Markdown it shares with the import: January 15, 2026. */
export function exportDate(iso: string | Date): string {
  return format(new Date(iso), 'MMMM d, yyyy');
}

// Top bar: icon, date and the moon phase's or category's name — 🌕 January 15, 2026 · Full Moon
function buildTopBar(data: ExportData): string {
  const dateStr = exportDate(data.createdAt);

  // data.moonPhase = "🌕 Full Moon" — the name after the first space
  const sp = data.moonPhase?.indexOf(' ') ?? -1;
  const subtitle = data.moonPhase ? (sp > 0 ? data.moonPhase.slice(sp + 1) : '') : data.category?.label ?? '';

  const icon = exportIcon(data);
  const iconHtml = icon.image
    ? `<img src="${icon.image}" class="topbar-icon-img">`
    : `<span class="topbar-icon">${htmlEscape(icon.emoji)}</span>`;

  const suffix = subtitle ? ` · ${htmlEscape(subtitle)}` : '';
  return `<div class="entry-topbar">${iconHtml}<span class="topbar-date">${dateStr}${suffix}</span></div>`;
}

// Build the metadata section HTML below the top bar
function buildMetaHtml(data: ExportData): string {
  const parts: string[] = [];

  // the category is shown in the topbar, not here
  // Tags
  if (data.tagNames?.length) {
    const tags = data.tagNames.map(t => `<span class="tag">${htmlEscape(t)}</span>`).join('');
    parts.push(`<div class="meta-row">${tags}</div>`);
  }
  return parts.length ? `<div class="meta-section">${parts.join('\n')}</div>` : '';
}

// CSS for the print window
const PRINT_CSS = `
  /* Both webviews print without backgrounds by default; chips, tags and code keep theirs. */
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: var(--doc-font, Georgia, 'Times New Roman', serif);
    font-size: var(--doc-size, 12pt);
    line-height: 1.75;
    color: #111;
    background: #f0f0f0;
  }
  /* No more img.emoji rasterization — the native webview renders
     Segoe UI Emoji / Apple Color Emoji / Noto Color Emoji directly, so
     emoji glyphs flow like any other text and the flex containers
     (align-items: baseline) keep them on the text baseline. The whole
     canvas-rasterize-and-position-shift dance (see git history of the
     pre-native-webview branch) evaporates with the engine swap. */
  #toolbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: #1c1c1e; padding: 0 24px;
    display: flex; align-items: center; gap: 12px; height: 48px;
  }
  #toolbar span { color: #aaa; font-family: system-ui,sans-serif; font-size: 13px; flex: 1; }
  #print-btn {
    font-family: system-ui,sans-serif; font-size: 14px; font-weight: 600;
    color: #fff; background: #00a066; border: none; border-radius: 8px;
    padding: 8px 22px; cursor: pointer;
  }
  #print-btn:hover { background: #00c47a; }
  #page {
    max-width: 21cm; margin: 64px auto 32px; background: #fff;
    padding: 2.2cm 2.8cm; box-shadow: 0 2px 16px rgba(0,0,0,0.18);
  }
  h1.entry-title {
    font-size: 2em; font-weight: bold;
    margin-bottom: 0.5em; padding-bottom: 0.4em; border-bottom: 2px solid #eee;
  }
  .entry-number { font-size: 0.5em; font-weight: normal; color: #999; margin-left: 0.4em; vertical-align: middle; }
  /* Top bar: 🌕 January 15, 2026 · Full Moon — plain, like the main view */
  .entry-topbar {
    display: flex; align-items: baseline; gap: 6px;
    margin-bottom: 0.5em;
    font-family: system-ui, sans-serif;
    font-size: 0.9em; color: #666;
  }
  .topbar-icon { font-size: 1.1em; line-height: 1; }
  .topbar-icon-img { width: 1.2em; height: 1.2em; object-fit: cover; border-radius: 3px; flex-shrink: 0; }
  .topbar-date { color: #555; }
  /* Metadata section */
  .meta-section { margin-bottom: 1.2em; padding-bottom: 0.8em; border-bottom: 1px solid #eee; }
  .meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
  .meta-date { font-size: 0.85em; color: #666; font-style: italic; margin-right: 4px; }
  .tag {
    display: inline-block; font-family: system-ui,sans-serif; font-size: 0.78em;
    background: #e8e8e8; border-radius: 12px; padding: 2px 10px; color: #444;
  }
  /* Content */
  .entry-content h1, .entry-content h2, .entry-content h3 { margin-top: 1.3em; margin-bottom: 0.4em; }
  .entry-content p  { margin-bottom: 0.8em; }
  .entry-content dl { margin-bottom: 0.8em; }
  .entry-content dt { font-size: 0.85em; font-weight: 600; color: #666; margin-top: 0.4em; }
  .entry-content dd { margin: 0 0 0.3em 0; }
  .entry-content dd ul { margin-bottom: 0; }
  /* An image's alignment is set as margin-left/-right in its
     style attribute and beats this shorthand — only the vertical
     spacing comes from here. */
  .entry-content img { display: block; max-width: 100%; height: auto; margin: 0.6em 0; border-radius: 4px; }
  .entry-content hr { border: 0; border-top: 1px solid #ccc; margin: 1.4em 0; }
  .entry-content pre {
    background: #f5f5f5; padding: 0.8em 1em; border-radius: 4px;
    white-space: pre-wrap; font-size: 0.85em; margin: 0.8em 0;
  }
  .entry-content code { background: #f0f0f0; padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.9em; }
  .entry-content blockquote {
    border-left: 3px solid #bbb; padding-left: 1em; color: #555; margin: 0.8em 0;
  }
  /* A table whose columns were resized carries a pixel width inline; on the
     page it is the text column, or the right columns would be cut off. */
  .entry-content table { border-collapse: collapse; width: 100% !important; max-width: 100%; table-layout: fixed; margin: 0.8em 0; }
  .entry-content col { width: auto !important; }
  .entry-content details { margin: 0.6em 0; padding: 0.3em 0.6em; border: 1px solid #ddd; border-radius: 4px; }
  .entry-content summary { font-weight: 600; list-style: none; }
  .entry-content summary::-webkit-details-marker { display: none; }
  ${TEXT_COLORS.map((c) => `.entry-content span[data-color="${c}"] { color: ${TEXT_COLOR_SHADES.light[c]}; }`).join('\n  ')}
  .entry-content td, .entry-content th { border: 1px solid #ccc; padding: 0.4em 0.6em; }
  .entry-content ul, .entry-content ol { padding-left: 1.6em; margin-bottom: 0.8em; }
  .entry-content li { margin-bottom: 0.2em; }
  /* Internal link chips — jade accent like in the app */
  .entry-content span[data-type="internalLink"] {
    display: inline-flex; align-items: baseline; gap: 4px;
    font-family: system-ui,sans-serif; font-size: 0.82em;
    background: #e6faf3; border: 1px solid #99dfc0; border-radius: 5px;
    padding: 1px 7px; color: #006b42; vertical-align: middle;
    font-weight: 500;
  }
  .entry-content span[data-type="internalLink"] .il-icon-img {
    width: 13px; height: 13px; object-fit: cover; border-radius: 2px;
  }
  .entry-content span[data-type="internalLink"] .il-icon-emoji { font-size: 0.9em; line-height: 1; }
  .entry-content span[data-type="internalLink"].il-gone {
    background: transparent; border-color: #ccc; color: #888; text-decoration: line-through;
  }
  /* Mirrored for the native page setup in src-tauri/src/pdf_export/mod.rs. */
  @page { margin: 2cm 2.5cm; }
  @media print {
    body { background: #fff; }
    #toolbar { display: none; }
    #page { margin: 0; padding: 0; box-shadow: none; max-width: none; }
    /* Prevent WKWebView from avoiding page breaks inside elements,
       which causes large whitespace gaps before page boundaries. */
    * {
      page-break-inside: auto !important;
      break-inside:      auto !important;
      page-break-before: auto !important;
      page-break-after:  auto !important;
      break-before:      auto !important;
      break-after:       auto !important;
    }
    /* Several entries: each starts on a page of its own. */
    .entry-article + .entry-article { page-break-before: always !important; break-before: page !important; }
  }
  /* On screen a gap instead of the page break; every platform prints with the print styles. */
  @media screen { .entry-article + .entry-article { margin-top: 3em; padding-top: 2em; border-top: 1px solid #ddd; } }
`;

// ── PDF export ──────────────────────────────────────────────────────────────
//
// Direct PDF write via the platform's own webview. The user picks where
// to save in a native dialog and the PDF is generated on disk by the Rust
// side — no print dialog, no printer selection, no extra window. Same UX
// shape as the Markdown / Emerald exports.

/** One entry of an export, with what happens to its pictures (PDF and HTML; Markdown has none). */
export interface ExportItem {
  data: ExportData;
  images: ImageMode;
}

/**
 * The file an export writes: one entry is named after its title and date;
 * several after `bundle` — a name chosen by the export menu, which also titles
 * the document. PDF and HTML set the entries in `typography`.
 */
export interface ExportFile {
  bundle?: string;
  typography?: ExportTypography;
  /** The HTML sidebar's starting order; the entries come in the order given. */
  order?: ExportOrder;
}

/** The save dialog's path with the format's ending: the GTK dialog on Linux does not add it to a name typed without. */
export function withEnding(path: string, ext: string): string {
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
}

export function defaultFilename(items: readonly ExportItem[], file: ExportFile, ext: string): string {
  if (items.length > 1 && file.bundle) return `${safeFileBase(file.bundle)}.${ext}`;
  return exportFilename(items[0].data.title, items[0].data.createdAt, ext);
}

/** The document's title: the bundle's name for several entries, else the entry's. */
export function documentTitle(items: readonly ExportItem[], file: ExportFile): string {
  return items.length > 1 && file.bundle ? file.bundle : items[0].data.title;
}

/** The `<style>` content that sets the entries in the chosen font and size; empty keeps the stylesheet's own. */
export async function typographyStyle(file: ExportFile): Promise<string> {
  return file.typography ? typographyCss(file.typography) : '';
}

/**
 * One entry as an `<article>` of a PDF or HTML document: top bar, title,
 * tags and content, pictures as `images` says, link chips pre-rendered.
 * `bundleIds` and `footerHtml` are the HTML export's: links into the file,
 * and the references inside the article.
 */
export async function exportArticle(
  { data, images }: ExportItem,
  opts: { bundleIds?: ReadonlySet<string>; footerHtml?: string } = {},
): Promise<string> {
  const resolvedContent  = await resolveInternalLinkIcons(data.content);
  const embeddedContent  = images === 'placeholder' ? stripImages(resolvedContent) : await embedImages(resolvedContent, images);
  // Pre-render the internal-link chips here, so the export document stays
  // script-free (see `transformInternalLinks`).
  // Collapsible sections print open, or their content would be missing on paper.
  const transformedContent = transformInternalLinks(embeddedContent, opts.bundleIds).replace(/<details(?![^>]*\sopen)/g, '<details open');
  const numStr = data.entryNumber ? `<span class="entry-number">#${data.entryNumber}</span>` : '';
  return `<article class="entry-article" id="${entryAnchor(data.id)}" data-title="${htmlEscape(data.title)}">
    ${buildTopBar(data)}
    <h1 class="entry-title">${htmlEscape(data.title)}${numStr}</h1>
    ${buildMetaHtml(data)}
    <div class="entry-content">${DOMPurify.sanitize(transformedContent, {
      ADD_ATTR: ['data-type', 'data-id', 'data-target-kind', 'data-label', 'data-icon', 'data-entry-number', 'data-href', 'colwidth', 'data-color'],
    })}</div>
    ${opts.footerHtml ?? ''}
  </article>`;
}

/**
 * The entries as one PDF, one after another, each from a new page. Resolves
 * to `false` when the save dialog was cancelled.
 */
export async function exportAsPDF(items: readonly ExportItem[], file: ExportFile = {}): Promise<boolean> {
  if (items.length === 0) throw new Error(i18n.t('emeraldExport.nothing'));
  // Same UX as Markdown / Emerald: native save dialog first, then render.
  const chosen = await save({
    defaultPath: defaultFilename(items, file, 'pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!chosen) return false;
  const path = withEnding(chosen, 'pdf');

  const articles: string[] = [];
  for (const item of items) articles.push(await exportArticle(item));
  const title = documentTitle(items, file);
  const fullHtml = `<!DOCTYPE html>
<html lang="${i18n.language}">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
  <style>${PRINT_CSS}</style>
  <style>${await typographyStyle(file)}</style>
</head>
<body>
  <div id="page">
    ${articles.join('\n')}
  </div>
</body>
</html>`;

  try {
    await invoke('export_pdf', { html: fullHtml, path });
    await message(i18n.t('emeraldExport.pdfSaved', { path }), { title: i18n.t('emeraldExport.title'), kind: 'info' });
  } catch (err) {
    console.error('[emerald] export_pdf: failed', err);
    throw err; // re-throw so the caller's exportErrorMessage shows a toast
  }
  return true;
}

// ── Markdown export ─────────────────────────────────────────────────────────

/** Returns the icon as text for markdown. Falls back to fallbackIcon when icon is a data-URL. */
function mdIcon(icon?: string | null, fallbackIcon?: string | null): string {
  if (!icon) return fallbackIcon ? fallbackIcon + ' ' : '';
  if (icon.startsWith('data:')) return fallbackIcon ? fallbackIcon + ' ' : '';
  return icon + ' ';
}

/** HTML of the content to Markdown, with the rules for what the app's content holds beyond plain HTML. */
function createMarkdownConverter(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

  td.addRule('internalLink', {
    filter: (node) =>
      node.nodeName === 'SPAN' &&
      (node as HTMLElement).getAttribute('data-type') === 'internalLink',
    replacement: (_content, node) => {
      const label =
        (node as HTMLElement).getAttribute('data-label') ||
        (node as HTMLElement).textContent || '';
      return `[[${label.trim()}]]`;
    },
  });

  // Field blocks come as `<dl>`: "**Label:** Value", one paragraph per field.
  // A multi-line value (checklist) starts on its own line, otherwise its
  // first item would stick to the label. Turndown joins pieces using the
  // larger number of line breaks at their edges — hence two each.
  td.addRule('definitionTerm', {
    filter: 'dt',
    replacement: (content) => `\n\n**${content.trim()}:** `,
  });
  td.addRule('definitionValue', {
    filter: 'dd',
    replacement: (content) => {
      const value = content.trim();
      return value.includes('\n') ? `\n\n${value}\n\n` : `${value}\n\n`;
    },
  });
  // Tables as GFM pipe tables; the first row is the header, as GFM requires
  // one. A cell's paragraphs are joined by `<br>`, pipes escaped.
  td.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).rows).map((row) =>
        Array.from(row.cells).map((cell) =>
          td.turndown(cell.innerHTML).trim().replace(/\n+/g, '<br>').replace(/\|/g, '\\|')));
      if (rows.length === 0) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
      return `\n\n${[line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')}\n\n`;
    },
  });
  // A collapsible section's heading line in bold; its content follows as usual.
  td.addRule('detailsSummary', {
    filter: 'summary',
    replacement: (content) => `\n\n**${content.trim()}**\n\n`,
  });
  // Struck-through letters of the sigil calculator.
  td.addRule('strikethrough', {
    filter: ['s', 'del'],
    replacement: (content) => `~~${content}~~`,
  });
  return td;
}

function markdownOf(data: ExportData, td: TurndownService): string {
  const lines: string[] = [`# ${data.title}`, ''];
  lines.push(`*${exportDate(data.createdAt)}*`);
  if (data.moonPhase)   lines.push(`Moon: ${data.moonPhase}`);
  if (data.category)            lines.push(`Category: ${mdIcon(data.category.icon, data.category.fallbackIcon)}${data.category.label}`.trim());
  if (data.tagNames?.length)    lines.push(`Tags: ${data.tagNames.join(', ')}`);
  lines.push('', '---', '');
  lines.push(td.turndown(stripImages(data.content)), '');
  return lines.join('\n');
}

/**
 * The entries as one Markdown file, one after another, without pictures.
 * Resolves to `false` when the save dialog was cancelled.
 */
export async function exportAsMarkdown(items: readonly ExportItem[], file: ExportFile = {}): Promise<boolean> {
  if (items.length === 0) throw new Error(i18n.t('emeraldExport.nothing'));
  const td = createMarkdownConverter();
  const markdown = items.map((item) => markdownOf(item.data, td)).join('\n');

  const chosen = await save({
    defaultPath: defaultFilename(items, file, 'md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!chosen) return false;
  await invoke('write_file', { path: withEnding(chosen, 'md'), content: markdown });
  return true;
}

// ── errors ─────────────────────────────────────────────────────────────────

/** Show a non-blocking error toast for an export failure. */
export async function exportErrorMessage(
  err: unknown,
  kind: 'pdf' | 'html' | 'markdown' | 'emerald' | 'vault' | 'canvas',
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(detail, { title: i18n.t('emeraldExport.failed', { kind: i18n.t(`emeraldExport.kinds.${kind}`) }), kind: 'error' });
}
