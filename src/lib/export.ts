import { invoke } from '@tauri-apps/api/core';
import { imageRefsInHtml, readImageAsBase64, rewriteImageRefs } from './images';
import { save, message } from '@tauri-apps/plugin-dialog';
import TurndownService from 'turndown';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import type { ExportData, ChipData } from './exportData';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { getCategoryEmoji } from '../components/wiki/WikiList';

// ── helpers ────────────────────────────────────────────────────────────────

export function htmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeDataImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(trimmed) ? trimmed : null;
}


async function embedImages(html: string): Promise<string> {
  const refs = [...new Set(imageRefsInHtml(html))];
  if (refs.length === 0) return html;

  const resolved = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      try {
        resolved.set(ref, await readImageAsBase64(ref));
      } catch {
        // Datei fehlt — leeres src statt eines toten Verweises im Export.
        resolved.set(ref, '');
      }
    })
  );

  return rewriteImageRefs(html, (ref) => resolved.get(ref) ?? null);
}

function stripImages(html: string): string {
  return html.replace(/<img[^>]*>/gi, '');
}

/**
 * Pre-resolve missing data-icon attributes on internal link spans.
 * TipTap only stores the icon at save-time; if it was null then, we fill it now.
 */
function resolveInternalLinkIcons(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = doc.querySelectorAll<HTMLElement>('span[data-type="internalLink"]');
  if (!links.length) return html;

  const { articles, wikiCategories } = useWikiStore.getState();
  const { operations, categories: opCats } = useOperationStore.getState();

  for (const el of links) {
    // Only fill missing icons
    if (el.getAttribute('data-icon')) continue;
    const id        = el.getAttribute('data-id');
    const entryType = el.getAttribute('data-entry-type');
    if (!id) continue;

    let icon = '';
    if (entryType === 'wiki') {
      const article = articles.find(a => a.id === id);
      if (article) {
        if (article.icon?.startsWith('data:')) {
          icon = article.icon;
        } else {
          const cat = wikiCategories.find(c => c.id === article.category_id);
          icon = cat?.emoji ?? getCategoryEmoji(article.category_id);
        }
      }
    } else if (entryType === 'operation') {
      const op = operations.find(o => o.id === id);
      if (op) {
        const cat = opCats.find(c => c.id === op.category_id);
        icon = op.icon ?? cat?.emoji ?? '⚡';
      }
    }
    if (icon) el.setAttribute('data-icon', icon);
  }

  return doc.body.innerHTML;
}

/**
 * Replaces the inner content of every `<span data-type="internalLink">` with
 * the visible chip elements (icon `<img>` or `<span>` + label `<span>`) and
 * strips the now-redundant `data-icon` / `data-label` attributes.
 *
 * This used to run as an inline `<script>` in the export HTML
 * (`TRANSFORM_LINKS_JS`). The native-webview PDF path drives the app's own
 * webview, which applies the app CSP — `script-src 'self'` blocks inline
 * scripts. Doing the transformation in TypeScript here keeps the rendered
 * chip identical to the live app and lets us drop the inline script (and
 * the `img.emoji` rasterization CSS that came with the old wkhtmltopdf
 * path) entirely.
 */
function transformInternalLinks(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = doc.querySelectorAll<HTMLElement>('span[data-type="internalLink"]');
  if (!links.length) return html;

  for (const el of Array.from(links)) {
    const icon  = el.getAttribute('data-icon')  || '';
    const label = el.getAttribute('data-label') || el.textContent || '';

    // Drop attributes the CSS no longer reads — they're now baked into the children.
    el.removeAttribute('data-icon');
    el.removeAttribute('data-label');

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
  }

  return doc.body.innerHTML;
}

function safeFilename(title: string): string {
  return title.replace(/[^\w\s\-äöüÄÖÜß]/g, '').trim().replace(/\s+/g, '_') || 'export';
}

function exportFilename(title: string, date: string, ext: string): string {
  const base = safeFilename(title);
  const dateStr = format(new Date(date), 'yyyy-MM-dd');
  return `${base}_${dateStr}.${ext}`;
}

// Render a chip for the metadata header (icon can be data-URL or emoji)
function chip(data: ChipData, extra = ''): string {
  const safeIconDataUrl = sanitizeDataImageUrl(data.icon);
  const iconHtml = safeIconDataUrl
    ? `<img src="${safeIconDataUrl}" class="chip-img">`
    : data.icon ? `<span class="chip-emoji">${htmlEscape(data.icon)}</span>` : '';
  return `<span class="chip${extra ? ' ' + extra : ''}">${iconHtml}<span class="chip-label">${htmlEscape(data.label)}</span></span>`;
}

// Top bar: exactly like the main view — 🌕 January 15, 2026 · Full Moon
function buildTopBar(data: ExportData): string {
  const dateStr = format(new Date(data.createdAt), 'MMMM d, yyyy');

  // Pick a left icon
  let icon = '📓'; // journal default
  let moonName = '';

  if (data.moonPhase) {
    // data.moonPhase = "🌕 Full Moon" — split at first space
    const sp = data.moonPhase.indexOf(' ');
    icon     = sp > 0 ? data.moonPhase.slice(0, sp) : data.moonPhase;
    moonName = sp > 0 ? data.moonPhase.slice(sp + 1) : '';
  } else if (data.wikiCategory) {
    const ic = data.entryIcon ?? data.wikiCategory.icon;
    icon = (!ic || ic.startsWith('data:')) ? '📖' : ic;
    moonName = data.wikiCategory.label;
  } else if (data.opCategory) {
    const ic = data.entryIcon ?? data.opCategory.icon;
    icon = (!ic || ic.startsWith('data:')) ? '⚡' : ic;
    moonName = data.opCategory.label;
  }

  // Render icon: data-URL → <img>, else emoji text
  const safeEntryIcon = sanitizeDataImageUrl(data.entryIcon);
  const iconHtml = (safeEntryIcon && (data.wikiCategory || data.opCategory))
    ? `<img src="${safeEntryIcon}" class="topbar-icon-img">`
    : `<span class="topbar-icon">${htmlEscape(icon)}</span>`;

  const suffix = moonName ? ` · ${htmlEscape(moonName)}` : '';
  return `<div class="entry-topbar">${iconHtml}<span class="topbar-date">${dateStr}${suffix}</span></div>`;
}

// Build the metadata section HTML below the top bar
function buildMetaHtml(data: ExportData): string {
  const parts: string[] = [];

  // Journal: paradigma / bannung / meditation
  const propChips: string[] = [];
  if (data.paradigma) propChips.push(chip(data.paradigma));
  if (data.bannung)   propChips.push(chip(data.bannung));
  if (data.meditation) {
    const dur = data.meditation.duration ? ` <span class="chip-badge">${data.meditation.duration} min</span>` : '';
    propChips.push(chip(data.meditation) + dur);
  }
  // wikiCategory and opCategory are shown in the topbar, not here
  if (data.isActive !== undefined) {
    propChips.push(`<span class="chip chip-${data.isActive ? 'active' : 'stone'}">${data.isActive ? 'Active' : 'Inactive'}</span>`);
  }
  if (data.endDate) propChips.push(`<span class="chip chip-stone">Ends ${format(new Date(data.endDate), 'MMM d, yyyy')}</span>`);
  if (data.version)  propChips.push(`<span class="chip chip-stone">v${htmlEscape(data.version)}</span>`);
  if (propChips.length) parts.push(`<div class="meta-row">${propChips.join('')}</div>`);

  // Linked ops
  if (data.linkedOps?.length) {
    parts.push(`<div class="meta-row">${data.linkedOps.map(o => chip(o)).join('')}</div>`);
  }
  // Linked wiki
  if (data.linkedWiki?.length) {
    parts.push(`<div class="meta-row">${data.linkedWiki.map(w => chip(w)).join('')}</div>`);
  }
  // Tags
  if (data.tagNames?.length) {
    const tags = data.tagNames.map(t => `<span class="tag">${htmlEscape(t)}</span>`).join('');
    parts.push(`<div class="meta-row">${tags}</div>`);
  }
  return parts.length ? `<div class="meta-section">${parts.join('\n')}</div>` : '';
}

// CSS for the print window
const PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
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
  .chip {
    display: inline-flex; align-items: baseline; gap: 4px;
    font-family: system-ui,sans-serif; font-size: 0.78em;
    background: #f2f2f2; border: 1px solid #ddd; border-radius: 6px;
    padding: 2px 8px; color: #333; white-space: nowrap;
  }
  .chip-img { width: 14px; height: 14px; object-fit: cover; border-radius: 2px; }
  .chip-emoji { font-size: 1em; line-height: 1; }
  .chip-stone { background: #f2f2f2; }
  .chip-active { background: #d4f5e7; border-color: #7ecba6; color: #1a5c3a; }
  .chip-badge {
    display: inline-block; font-size: 0.9em;
    background: #e8e8e8; border-radius: 4px; padding: 0 5px; margin-left: 2px;
  }
  .tag {
    display: inline-block; font-family: system-ui,sans-serif; font-size: 0.78em;
    background: #e8e8e8; border-radius: 12px; padding: 2px 10px; color: #444;
  }
  /* Content */
  .entry-content h1, .entry-content h2, .entry-content h3 { margin-top: 1.3em; margin-bottom: 0.4em; }
  .entry-content p  { margin-bottom: 0.8em; }
  .entry-content img { display: block; max-width: 100%; height: auto; margin: 0.6em 0; border-radius: 4px; }
  .entry-content pre {
    background: #f5f5f5; padding: 0.8em 1em; border-radius: 4px;
    white-space: pre-wrap; font-size: 0.85em; margin: 0.8em 0;
  }
  .entry-content code { background: #f0f0f0; padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.9em; }
  .entry-content blockquote {
    border-left: 3px solid #bbb; padding-left: 1em; color: #555; margin: 0.8em 0;
  }
  .entry-content table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
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
  }
`;

// JS that used to run in the print window to transform internal link
// nodes into chips. Removed in Phase 4 of the native-webview migration —
// the equivalent transformation now runs in TypeScript via
// `transformInternalLinks` before the HTML is handed to the backend,
// because the new webview's CSP blocks inline scripts. The function is
// kept (translated to TS) so the rendered chip matches the live app.

// ── PDF export ──────────────────────────────────────────────────────────────
//
// Direct PDF write via the platform's own webview. The user picks where
// to save in a native dialog and the PDF is generated on disk by the Rust
// side — no print dialog, no printer selection, no extra window. Same UX
// shape as the Markdown / Emerald exports.

export async function exportAsPDF(data: ExportData): Promise<void> {
  const resolvedContent  = resolveInternalLinkIcons(data.content);
  const embeddedContent  = await embedImages(resolvedContent);
  // Pre-render the internal-link chips in TS — the new webview's CSP
  // (`script-src 'self'`) blocks inline scripts, so the JS that used to
  // live in `TRANSFORM_LINKS_JS` now has to run before we hand the HTML
  // to the backend.
  const transformedContent = transformInternalLinks(embeddedContent);

  const topBarHtml = buildTopBar(data);
  const metaHtml   = buildMetaHtml(data);
  const numStr     = data.entryNumber ? `<span class="entry-number">#${data.entryNumber}</span>` : '';

  const escapedTitle = htmlEscape(data.title);
  const fullHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div id="page">
    ${topBarHtml}
    <h1 class="entry-title">${escapedTitle}${numStr}</h1>
    ${metaHtml}
    <div class="entry-content">${DOMPurify.sanitize(transformedContent, {
      ADD_ATTR: ['data-type', 'data-id', 'data-entry-type', 'data-label', 'data-icon', 'data-entry-number', 'data-href'],
    })}</div>
  </div>
</body>
</html>`;

  // Same UX as Markdown / Emerald: native save dialog first, then render.
  const path = await save({
    defaultPath: exportFilename(data.title, data.createdAt, 'pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!path) return;

  try {
    await invoke('export_pdf', { html: fullHtml, path });
    await message(`PDF saved:\n${path}`, { title: 'Export', kind: 'info' });
  } catch (err) {
    console.error('[emerald] export_pdf: failed', err);
    throw err; // re-throw so the caller's exportErrorMessage shows a toast
  }
}

// ── Markdown export ─────────────────────────────────────────────────────────

/** Returns the icon as text for markdown. Falls back to fallbackIcon when icon is a data-URL. */
function mdIcon(icon?: string | null, fallbackIcon?: string | null): string {
  if (!icon) return fallbackIcon ? fallbackIcon + ' ' : '';
  if (icon.startsWith('data:')) return fallbackIcon ? fallbackIcon + ' ' : '';
  return icon + ' ';
}

export async function exportAsMarkdown(data: ExportData): Promise<void> {
  const stripped = stripImages(data.content);

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

  // Build frontmatter / header block
  const lines: string[] = [`# ${data.title}`, ''];
  lines.push(`Type: ${data.type}`);
  lines.push(`*${format(new Date(data.createdAt), 'MMMM d, yyyy')}*`);
  if (data.moonPhase)   lines.push(`Moon: ${data.moonPhase}`);
  if (data.paradigma)   lines.push(`Paradigma: ${mdIcon(data.paradigma.icon, data.paradigma.fallbackIcon)}${data.paradigma.label}`.trim());
  if (data.bannung)     lines.push(`Bannung: ${mdIcon(data.bannung.icon, data.bannung.fallbackIcon)}${data.bannung.label}`.trim());
  if (data.meditation)  {
    const dur = data.meditation.duration ? ` (${data.meditation.duration} min)` : '';
    lines.push(`Meditation: ${mdIcon(data.meditation.icon, data.meditation.fallbackIcon)}${data.meditation.label}${dur}`.trim());
  }
  if (data.linkedOps?.length)   lines.push(`Operations: ${data.linkedOps.map(o => (`${mdIcon(o.icon, o.fallbackIcon)}${o.label}`.trim()) + (o.id ? ` [${o.id}]` : '')).join(', ')}`);
  if (data.linkedWiki?.length)  lines.push(`Wiki: ${data.linkedWiki.map(w => (`${mdIcon(w.icon, w.fallbackIcon)}${w.label}`.trim()) + (w.id ? ` [${w.id}]` : '')).join(', ')}`);
  if (data.wikiCategory)        lines.push(`Category: ${mdIcon(data.wikiCategory.icon, data.wikiCategory.fallbackIcon)}${data.wikiCategory.label}`.trim());
  if (data.opCategory)          lines.push(`Category: ${mdIcon(data.opCategory.icon, data.opCategory.fallbackIcon)}${data.opCategory.label}`.trim());
  if (data.isActive !== undefined) lines.push(`Status: ${data.isActive ? 'Active' : 'Inactive'}`);
  if (data.endDate)             lines.push(`End Date: ${format(new Date(data.endDate), 'MMM d, yyyy')}`);
  if (data.version)             lines.push(`Version: ${data.version}`);
  if (data.tagNames?.length)    lines.push(`Tags: ${data.tagNames.join(', ')}`);
  lines.push('', '---', '');
  lines.push(td.turndown(stripped), '');

  const markdown = lines.join('\n');

  const path = await save({
    defaultPath: exportFilename(data.title, data.createdAt, 'md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!path) return;
  await invoke('write_file', { path, content: markdown });
}

// ── guard ──────────────────────────────────────────────────────────────────

export async function noEntryMessage(): Promise<void> {
  await message('Please open a journal entry, wiki article, or operation first.', {
    title: 'Export', kind: 'info',
  });
}

/** Show a non-blocking error toast for an export failure. */
export async function exportErrorMessage(err: unknown, kind: string): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(detail, { title: `${kind} failed`, kind: 'error' });
}
