import { invoke } from '@tauri-apps/api/core';
import { imageRefsInHtml, readImageAsBase64, rewriteImageRefs } from './images';
import { save, message } from '@tauri-apps/plugin-dialog';
import TurndownService from 'turndown';
import { format } from 'date-fns';
import { exportFilename, safeFileBase } from './helpers';
import { compressDataUrl } from './imageCompression';
import type { ImageMode } from './emerald/manifest';
import DOMPurify from 'dompurify';
import type { ExportData } from './exportData';
import { exportDefaultPath } from './vaultManager';
import { useEntryStore } from '../store/entryStore';
import { useCategoryStore } from '../store/categoryStore';
import { DEFAULT_ENTRY_ICON, entryIcon } from './entryIcon';
import { linkItemKey, linkItemsByKey } from './linkItems';
import { linkItemsSnapshot } from './linkItemsSnapshot';
import { linkTargetKindOf } from './internalLinkHtml';
import { portableIcon } from './icons';
import { typographyCss, type ExportTypography } from './exportFonts';
import { pdfCss, tagStyle } from './exportStyle';
import { formatEntryDateLong } from './formatDate';
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
async function embedImages(source: string, mode: Exclude<ImageMode, 'placeholder'>): Promise<string> {
  // Before the stored pictures become data URLs too: only the drawn ones are compressed here.
  const html = await compressDrawnPictures(source, mode);
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
 * A block's picture the export drew itself (an altar that kept none) comes as
 * a data URL, not a stored file: compressed to the same level here.
 */
async function compressDrawnPictures(html: string, mode: Exclude<ImageMode, 'placeholder'>): Promise<string> {
  if (mode === 'none') return html;
  const drawn = [...html.matchAll(/<img\b[^>]*\bdata-export-placeholder=[^>]*>/gi)]
    .map((m) => /\bsrc="(data:image\/[^"]+)"/i.exec(m[0])?.[1])
    .filter((src): src is string => !!src);
  let out = html;
  for (const src of new Set(drawn)) {
    const smaller = await compressDataUrl(src, mode).catch(() => src);
    out = out.split(`src="${src}"`).join(`src="${smaller}"`);
  }
  return out;
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

  // Live or gone, and a task's icon: from the same list the app's chips and
  // the export's titles read (`linkItemsSnapshot`).
  const byKey = linkItemsByKey(linkItemsSnapshot());
  const { entries } = useEntryStore.getState();
  const { categories } = useCategoryStore.getState();

  for (const el of links) {
    const id        = el.getAttribute('data-id');
    const targetKind = linkTargetKindOf(el.getAttribute('data-target-kind'));
    if (!id) continue;
    const item = byKey.get(linkItemKey({ id, targetKind }));
    if (!item) {
      el.setAttribute('data-gone', '');
      continue;
    }
    // Only fill missing icons
    if (el.getAttribute('data-icon')) continue;

    let icon = '';
    if (targetKind === 'entry') {
      // The same icon as in the app (`entryIcon`).
      const entry = entries.find(e => e.id === id);
      if (entry) icon = entryIcon(entry, categories.find(c => c.id === entry.category_id));
    } else {
      // Task chips from sidebar drags carry no data-icon — as in the
      // editor's live lookup: the list's icon (category emoji, else the fallback).
      icon = item.icon ?? '';
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

/** The date atop an entry in PDF and HTML, in the app language: 28. November 2026. */
export function exportDisplayDate(iso: string | Date): string {
  return formatEntryDateLong(iso);
}

/** The line above the title: the entry's icon and category on the left, its date on the right. */
function buildTopBar(data: ExportData): string {
  const icon = exportIcon(data);
  const iconHtml = icon.image
    ? `<img src="${icon.image}" class="topbar-icon-img" alt="">`
    : `<span class="topbar-icon">${htmlEscape(icon.emoji)}</span>`;
  const category = data.category?.label ? `<span>${htmlEscape(data.category.label)}</span>` : '';
  return `<div class="entry-topbar"><span class="topbar-category">${iconHtml}${category}</span>`
    + `<span class="topbar-date">${htmlEscape(exportDisplayDate(data.createdAt))}</span></div>`;
}

/** The tags as chips in their colours, as in the app. */
function buildTagsHtml(data: ExportData): string {
  if (!data.tags.length) return '';
  const chips = data.tags.map((tag) => `<span class="tag" style="${tagStyle(tag.color)}">${htmlEscape(tag.name)}</span>`);
  return `<div class="entry-tags">${chips.join('')}</div>`;
}

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
  /** What several entries are called inside the document (the HTML sidebar, the PDF footer): the dashboard's name. */
  title?: string;
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

/** The document's title: the collection's name for several entries, else the entry's. */
export function documentTitle(items: readonly ExportItem[], file: ExportFile): string {
  return items.length > 1 && file.title ? file.title : items[0].data.title;
}

/** The `<style>` content that sets the entries in the chosen font and size; empty keeps the stylesheet's own. */
export async function typographyStyle(file: ExportFile): Promise<string> {
  return file.typography ? typographyCss(file.typography) : '';
}

/**
 * One entry as an `<article>` of a PDF or HTML document: top bar, title,
 * tags, a rule and content (styled by `exportStyle.ts`), pictures as `images` says, link chips pre-rendered.
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
  return `<article class="entry-article" id="${entryAnchor(data.id)}" data-title="${htmlEscape(data.title)}" data-category="${htmlEscape(data.category?.label ?? '')}">
    ${buildTopBar(data)}
    <h1 class="entry-title">${htmlEscape(data.title)}${numStr}</h1>
    ${buildTagsHtml(data)}
    <hr class="entry-rule">
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
    defaultPath: await exportDefaultPath(defaultFilename(items, file, 'pdf')),
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
  <title>${htmlEscape(title)}</title>
  <style>${pdfCss({ title, pageOf: i18n.t('exportMenu.pdf.pageOf', { page: '{{page}}', pages: '{{pages}}' }) })}</style>
  <style>${await typographyStyle(file)}</style>
</head>
<body>
  ${articles.join('\n')}
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
  if (data.category)            lines.push(`Category: ${mdIcon(data.category.icon, data.category.fallbackIcon)}${data.category.label}`.trim());
  if (data.tags.length)         lines.push(`Tags: ${data.tags.map((tag) => tag.name).join(', ')}`);
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
    defaultPath: await exportDefaultPath(defaultFilename(items, file, 'md')),
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
