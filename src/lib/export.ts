import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import TurndownService from 'turndown';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import type { ExportData, ChipData } from './exportData';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { getCategoryEmoji } from '../components/wiki/WikiList';
import { compressDataUrl, compressImagesInHtml, type ImageCompression } from './imageCompression';
import i18n from '../i18n';
import { audioTitle, isLocalMediaPath, readMediaAsBase64 } from './media';
import { mapLimit } from './helpers';

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

/** The `<img>` / `<audio>` elements in `doc` whose `src` is a local path — never a `src="…"` that only appears in text. */
export function localMediaElements(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('img[src], audio[src]'))
    .filter((el) => isLocalMediaPath(el.getAttribute('src')));
}

/**
 * Files read from disk at once while embedding or compressing — each holds a
 * full-size base64 copy (and a decoded bitmap) in memory until it's done.
 */
export const MEDIA_CONCURRENCY = 4;

/**
 * Renders the entries of a bundle one after another, so a bulk export of
 * hundreds of entries never has all their images in memory at once.
 */
export function renderSequentially<T>(entries: readonly T[], render: (entry: T) => Promise<string>): Promise<string[]> {
  return mapLimit(entries, 1, render);
}

/** Replaces every local `src` path (images and sound files) with its data URL. */
async function embedMedia(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const elements = localMediaElements(doc);
  if (!elements.length) return html;
  await mapLimit(elements, MEDIA_CONCURRENCY, async (el) => {
    try {
      el.setAttribute('src', await readMediaAsBase64(el.getAttribute('src')!));
    } catch {
      el.setAttribute('src', '');
    }
  });
  return doc.body.innerHTML;
}

/** What an export does with each kind of embedded file. */
export interface MediaModes {
  /** `keep` leaves `<img>` as it is; `placeholder` replaces it with a note. */
  images: 'keep' | 'placeholder';
  /**
   * `keep` leaves `<audio>` as it is (Emerald), `embed` turns it into a
   * captioned `<audio controls>` (interactive HTML), `placeholder` into a note
   * naming the file (PDF, Markdown, or when chosen in the export modal).
   */
  audio: 'keep' | 'embed' | 'placeholder';
}

/** Splits the modal's image choice into "replace by a note?" and the compression for embedded ones. */
export function splitImageOption(images: ExportOptions['images']): { mode: MediaModes['images']; compression: ImageCompression } {
  return images === 'placeholder' ? { mode: 'placeholder', compression: 'none' } : { mode: 'keep', compression: images };
}

/**
 * Prepares embedded files for an export, before anything is read from disk —
 * a placeholder must replace the element before `embedMedia` would load the
 * file. A player keeps its `src`, which `embedMedia` then turns into a data URL.
 */
export function transformMedia(html: string, modes: MediaModes): string {
  const wantImages = modes.images === 'placeholder' && html.includes('<img');
  const wantAudio = modes.audio !== 'keep' && html.includes('<audio');
  if (!wantImages && !wantAudio) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  if (wantImages) {
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const figure = doc.createElement('figure');
      figure.className = 'image-placeholder';
      const name = img.getAttribute('alt') || img.getAttribute('title') || i18n.t('exportModal.placeholder.image');
      figure.textContent = `🖼 ${i18n.t('exportModal.placeholder.notExported', { name })}`;
      img.replaceWith(figure);
    }
  }

  if (wantAudio) {
    const embed = modes.audio === 'embed';
    for (const el of Array.from(doc.querySelectorAll('audio'))) {
      const src = el.getAttribute('src') ?? '';
      const figure = doc.createElement('figure');
      figure.className = embed ? 'audio-embed' : 'audio-placeholder';
      // Keep the width the player was given in the editor.
      if (embed && el.style.width) figure.style.width = el.style.width;
      const caption = doc.createElement('figcaption');
      const title = audioTitle(src, el.getAttribute('data-title'));
      // A placeholder says plainly that the file was left out on purpose.
      caption.textContent = `🔊 ${embed ? title : i18n.t('exportModal.placeholder.notExported', { name: title })}`;
      figure.appendChild(caption);
      if (embed && src) {
        const audio = doc.createElement('audio');
        audio.setAttribute('src', src);
        audio.setAttribute('controls', '');
        audio.setAttribute('preload', 'metadata');
        figure.appendChild(audio);
      }
      el.replaceWith(figure);
    }
  }
  return doc.body.innerHTML;
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
          const cat = wikiCategories.find(c => c.id === article.category);
          icon = cat?.emoji ?? getCategoryEmoji(article.category);
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
 *
 * Links whose target is part of `bundleIds` (a multi-entry export) become
 * `<a href="#entry-<id>">` anchors so they jump to the bundled copy; links
 * to entries outside the bundle stay plain chips, marked `il-external`.
 */
function transformInternalLinks(html: string, bundleIds?: ReadonlySet<string>): string {
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

/** DOM id of a bundled entry — shared by the PDF / HTML exports and their link rewriting. */
export function entryAnchor(id: string): string {
  return `entry-${id.replace(/[^\w-]/g, '')}`;
}

/** DOMPurify config for entry content: keeps the internal-link data attributes. */
const CONTENT_PURIFY_CONFIG = {
  ADD_ATTR: ['data-type', 'data-id', 'data-entry-type', 'data-label', 'data-icon', 'data-entry-number', 'data-href'],
};

function safeFilename(title: string): string {
  return title.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '_') || 'export';
}

export function exportFilename(title: string, date: string, ext: string): string {
  const base = safeFilename(title);
  const dateStr = format(new Date(date), 'yyyy-MM-dd');
  return `${base}_${dateStr}.${ext}`;
}

/** How an export treats the files embedded in entries. */
export interface ExportOptions {
  /** Embed images (optionally compressed), or show a placeholder instead. */
  images: ImageCompression | 'placeholder';
  /** Embed sound files where the format can play them (HTML, Emerald), or show a placeholder. */
  audio: 'embed' | 'placeholder';
  /** Title of a bulk export's document, instead of its first entry's title. */
  bundleTitle?: string;
  /** Suggested file name of a bulk export, without extension. */
  bundleFilename?: string;
  /**
   * Interactive HTML: a sigil's hidden parts get a Show / Hide toggle (`toggle`,
   * hidden on screen only — they are in the file) or are left out (`omit`).
   */
  sigilHidden?: 'toggle' | 'omit';
  /** Date order the entries were put in — the HTML export's sort button starts from it. */
  order?: 'asc' | 'desc';
  /** Entries bundled because they are linked, when their attachments are handled differently. */
  linked?: { ids: ReadonlySet<string>; images: ExportOptions['images']; audio: ExportOptions['audio'] };
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { images: 'none', audio: 'embed' };

/** The attachment handling for one entry of an export: its own, or the linked entries'. */
export function mediaFor(entry: ExportData, opts: ExportOptions): Pick<ExportOptions, 'images' | 'audio'> {
  const m = opts.linked?.ids.has(entry.id) ? opts.linked : opts;
  return { images: m.images, audio: m.audio };
}

/** The suggested file name: a bulk export's own, else the first entry's title and date. */
export function defaultFilename(main: ExportData, opts: ExportOptions, ext: string): string {
  return opts.bundleFilename ? `${safeFilename(opts.bundleFilename)}.${ext}` : exportFilename(main.title, main.createdAt, ext);
}

export function documentTitle(main: ExportData, opts: ExportOptions): string {
  return opts.bundleTitle ?? main.title;
}

// Render a chip for the metadata header (icon can be data-URL or emoji).
// Chips pointing at an entry that's part of the export bundle become links.
function chip(data: ChipData, extra = '', bundleIds?: ReadonlySet<string>): string {
  const safeIconDataUrl = sanitizeDataImageUrl(data.icon);
  const iconHtml = safeIconDataUrl
    ? `<img src="${safeIconDataUrl}" class="chip-img">`
    : data.icon ? `<span class="chip-emoji">${htmlEscape(data.icon)}</span>` : '';
  const inner = `${iconHtml}<span class="chip-label">${htmlEscape(data.label)}</span>`;
  if (data.id && bundleIds?.has(data.id)) {
    return `<a href="#${entryAnchor(data.id)}" class="chip chip-link${extra ? ' ' + extra : ''}">${inner}</a>`;
  }
  return `<span class="chip${extra ? ' ' + extra : ''}">${inner}</span>`;
}

/**
 * A date in the app language — "4. Nov. 2026" / "Nov 4, 2026" (`medium`) or
 * with the month spelled out (`long`). For exported documents and the export
 * modal; the Markdown header keeps its fixed English format for the import.
 */
export function exportDate(value: string | number | Date, style: 'medium' | 'long' = 'medium'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: style }).format(date);
}

function formatCustomPropValue(prop: { type: string; value: string | null; meta: string | null }): string {
  if (prop.value === null || prop.value === '') return '—';
  if (prop.type === 'checkbox' || prop.type === 'toggle') {
    let trueLabel = 'Yes', falseLabel = 'No';
    if (prop.meta) {
      try {
        const m = JSON.parse(prop.meta);
        trueLabel  = m.trueLabel  ?? trueLabel;
        falseLabel = m.falseLabel ?? falseLabel;
      } catch { /* ignore */ }
    }
    return prop.value === 'true' ? trueLabel : falseLabel;
  }
  if (prop.type === 'date') {
    try { return format(new Date(prop.value), 'MMM d, yyyy'); } catch { return prop.value; }
  }
  return prop.value;
}

// Top bar: exactly like the main view — 🌕 January 15, 2026 · Full Moon
function buildTopBar(data: ExportData): string {
  const dateStr = htmlEscape(exportDate(data.createdAt, 'long'));

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
function buildMetaHtml(data: ExportData, bundleIds?: ReadonlySet<string>): string {
  const parts: string[] = [];

  // Journal: paradigma / bannung / meditation
  const propChips: string[] = [];
  if (data.paradigma) propChips.push(chip(data.paradigma, '', bundleIds));
  if (data.bannung)   propChips.push(chip(data.bannung, '', bundleIds));
  if (data.meditation) {
    // Number() so a non-numeric value from an imported file can't inject markup.
    const minutes = Number(data.meditation.duration);
    const dur = Number.isFinite(minutes) && minutes > 0 ? ` <span class="chip-badge">${minutes} min</span>` : '';
    propChips.push(chip(data.meditation, '', bundleIds) + dur);
  }
  // wikiCategory and opCategory are shown in the topbar, not here
  if (data.isActive !== undefined) {
    const status = i18n.t(data.isActive ? 'operations.active' : 'operations.inactive');
    propChips.push(`<span class="chip chip-${data.isActive ? 'active' : 'stone'}">${htmlEscape(status)}</span>`);
  }
  if (data.endDate) {
    propChips.push(`<span class="chip chip-stone">${htmlEscape(i18n.t('exportModal.meta.ends', { date: exportDate(data.endDate) }))}</span>`);
  }
  if (data.version)  propChips.push(`<span class="chip chip-stone">v${htmlEscape(data.version)}</span>`);
  if (propChips.length) parts.push(`<div class="meta-row">${propChips.join('')}</div>`);

  // Linked ops
  if (data.linkedOps?.length) {
    parts.push(`<div class="meta-row">${data.linkedOps.map(o => chip(o, '', bundleIds)).join('')}</div>`);
  }
  // Linked wiki
  if (data.linkedWiki?.length) {
    parts.push(`<div class="meta-row">${data.linkedWiki.map(w => chip(w, '', bundleIds)).join('')}</div>`);
  }
  // Tags
  if (data.tagNames?.length) {
    const tags = data.tagNames.map(t => `<span class="tag">${htmlEscape(t)}</span>`).join('');
    parts.push(`<div class="meta-row">${tags}</div>`);
  }
  // Custom props
  if (data.customProps?.length) {
    const badges = data.customProps.map(p =>
      `<span class="prop-badge"><span class="prop-name">${htmlEscape(p.name)}</span><span class="prop-val">${htmlEscape(formatCustomPropValue(p))}</span></span>`
    ).join('');
    parts.push(`<div class="meta-row">${badges}</div>`);
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
  .prop-badge {
    display: inline-flex; align-items: center;
    font-family: system-ui,sans-serif; font-size: 0.78em;
    border: 1px solid #ddd; border-radius: 6px; overflow: hidden;
  }
  .prop-name { background: #f2f2f2; padding: 2px 7px; color: #666; border-right: 1px solid #ddd; }
  .prop-val  { padding: 2px 7px; color: #333; }
  /* Content */
  .entry-content h1, .entry-content h2, .entry-content h3 { margin-top: 1.3em; margin-bottom: 0.4em; }
  .entry-content p  { margin-bottom: 0.8em; }
  .entry-content img { display: block; max-width: 100%; height: auto; margin: 0.6em 0; border-radius: 4px; }
  .sigil { margin: 0 0 1.4em; padding-bottom: 1em; border-bottom: 1px solid #eee; font-family: system-ui, sans-serif; }
  .sigil-badge { display: inline-block; font-size: 0.75em; color: #006b42; background: #e6faf3; border: 1px solid #99dfc0; border-radius: 10px; padding: 1px 9px; margin-bottom: 0.8em; }
  .sigil-part { margin-bottom: 0.9em; }
  .sigil-label { font-size: 0.7em; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #888; margin-bottom: 0.3em; }
  .sigil-img { display: block; max-width: 60%; border: 1px solid #ddd; border-radius: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sigil-cover { font-size: 0.85em; color: #555; background: #f6f6f6; border: 1px dashed #ccc; border-radius: 6px; padding: 0.5em 0.8em; }
  .sigil-intention { font-family: Georgia, serif; font-style: italic; }
  .sigil-letters { display: flex; flex-wrap: wrap; gap: 4px; }
  .sigil-letter { display: inline-block; min-width: 1.8em; text-align: center; font-weight: 600; border: 1px solid #ccc; border-radius: 4px; padding: 2px 4px; }
  .sigil-letter.done { color: #006b42; background: #e6faf3; border-color: #99dfc0; }
  .sigil-details { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.85em; margin-bottom: 0.6em; }
  .sigil-detail { display: flex; align-items: center; gap: 6px; }
  .sigil-detail-label { color: #888; }
  .sigil-notes { white-space: pre-wrap; }
  .sigil-empty { color: #999; font-size: 0.85em; }
  .entry-content figure.image-placeholder,
  .entry-content figure.audio-placeholder {
    margin: 0.8em 0; padding: 0.55em 0.9em; border: 1px dashed #99dfc0; border-radius: 6px;
    background: #f1fbf6; font-family: system-ui, sans-serif; font-size: 0.85em; color: #333;
  }
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
  .entry-content [data-type="internalLink"] {
    display: inline-flex; align-items: baseline; gap: 4px;
    font-family: system-ui,sans-serif; font-size: 0.82em;
    background: #e6faf3; border: 1px solid #99dfc0; border-radius: 5px;
    padding: 1px 7px; color: #006b42; vertical-align: middle;
    font-weight: 500;
  }
  .entry-content a[data-type="internalLink"], a.chip-link { text-decoration: none; }
  .entry-content [data-type="internalLink"].il-external { opacity: 0.75; }
  .entry-content [data-type="internalLink"] .il-icon-img {
    width: 13px; height: 13px; object-fit: cover; border-radius: 2px;
  }
  .entry-content [data-type="internalLink"] .il-icon-emoji { font-size: 0.9em; line-height: 1; }
  @page { margin: 2cm 2.5cm; }
  @media print {
    body { background: #fff; }
    #toolbar { display: none; }
    #page { margin: 0; padding: 0; box-shadow: none; max-width: none; }
    /* Prevent WKWebView from avoiding page breaks inside elements,
       which causes large whitespace gaps before page boundaries.
       Bundled entries are the exception: each one starts on a new page. */
    *:not(.entry-article) {
      page-break-inside: auto !important;
      break-inside:      auto !important;
      page-break-before: auto !important;
      page-break-after:  auto !important;
      break-before:      auto !important;
      break-after:       auto !important;
    }
    .entry-article + .entry-article { page-break-before: always !important; break-before: page !important; }
  }
  .entry-article + .entry-article { margin-top: 3em; padding-top: 2em; border-top: 2px solid #eee; }
  @media print { .entry-article + .entry-article { margin-top: 0; padding-top: 0; border-top: none; } }
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

// ── Sigils ──────────────────────────────────────────────────────────────────

/**
 * The surface sigils are drawn on in the app (`.sigil-canvas-shell`): dark in
 * Emerald Noctis, parchment in Emerald Parchment. The drawing is shown on the
 * one of the theme it was exported from — its default ink is white, so it
 * can't follow the export file's own light / dark theme.
 */
function sigilCanvasColor(): string {
  return document.documentElement.getAttribute('data-theme') === 'emerald-parchment' ? '#ece2d1' : '#0c0a09';
}

/**
 * The block a sigil operation gets above its content: drawing, intention,
 * letter bank, then charging technique, reveal date and notes.
 *
 * `interactive` (HTML): a loaded sigil's three parts each carry a toggle and
 * start shown or hidden exactly as in the app — the reader can switch them,
 * the file never changes the vault. `static` (PDF): a hidden part is replaced
 * by a note saying so.
 */
async function buildSigilHtml(
  data: ExportData,
  mode: 'interactive' | 'static',
  images: ExportOptions['images'],
  bundleIds?: ReadonlySet<string>,
): Promise<string> {
  const sigil = data.sigil;
  if (!sigil) return '';
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
  const hiddenNote = sigilHiddenNote(sigil);

  // In the HTML file, hidden parts are hidden on screen only (they are in the
  // page source); the toggle is a reading aid. PDF and Markdown leave them out.
  const part = (label: string, shown: boolean, body: string) => {
    const head = `<div class="sigil-label">${htmlEscape(label)}</div>`;
    if (mode === 'interactive' && (sigil.loaded || !shown)) {
      return `<div class="sigil-part" data-hidden="${shown ? 'false' : 'true'}">
        <div class="sigil-part-head">${head}
          <button type="button" class="sigil-toggle" aria-expanded="${shown}" data-show="${htmlEscape(t('exportModal.sigil.show'))}" data-hide="${htmlEscape(t('exportModal.sigil.hide'))}">${htmlEscape(shown ? t('exportModal.sigil.hide') : t('exportModal.sigil.show'))}</button>
        </div>
        <div class="sigil-cover">🔒 ${htmlEscape(hiddenNote)}</div>
        <div class="sigil-content">${body}</div>
      </div>`;
    }
    if (!shown) return `<div class="sigil-part">${head}<div class="sigil-cover">🔒 ${htmlEscape(hiddenNote)}</div></div>`;
    return `<div class="sigil-part">${head}<div class="sigil-content">${body}</div></div>`;
  };

  let drawing: string;
  if (!sigil.drawing) drawing = `<p class="sigil-empty">—</p>`;
  else if (images === 'placeholder') {
    drawing = `<figure class="image-placeholder">🖼 ${htmlEscape(t('exportModal.placeholder.notExported', { name: t('exportModal.sigil.drawing') }))}</figure>`;
  } else {
    const src = sanitizeDataImageUrl(await compressDataUrl(sigil.drawing, images)) ?? '';
    drawing = src
      ? `<img class="sigil-img" src="${src}" alt="${htmlEscape(t('exportModal.sigil.drawing'))}" style="background-color: ${sigilCanvasColor()}">`
      : `<p class="sigil-empty">—</p>`;
  }

  const intention = sigil.intention
    ? `<p class="sigil-intention">${htmlEscape(sigil.intention)}</p>`
    : `<p class="sigil-empty">${htmlEscape(t('creation.intentionEmpty'))}</p>`;

  const done = new Set(sigil.implementedLetters);
  const letters = sigil.letterBank.length
    ? `<div class="sigil-letters">${sigil.letterBank.map(l =>
        `<span class="sigil-letter${done.has(l) ? ' done' : ''}">${htmlEscape(l)}</span>`).join('')}</div>`
    : `<p class="sigil-empty">${htmlEscape(t('creation.noLetters'))}</p>`;

  const details: string[] = [];
  if (sigil.chargingTechnique) details.push(`<span class="sigil-detail-label">${htmlEscape(t('creation.chargingTechnique'))}</span>${chip(sigil.chargingTechnique, '', bundleIds)}`);
  if (sigil.revealDate) details.push(`<span class="sigil-detail-label">${htmlEscape(t('creation.targetDate'))}</span><span>${htmlEscape(sigil.revealDate)}</span>`);
  const notes = sigil.notes
    ? `<div class="sigil-part"><div class="sigil-label">${htmlEscape(t('creation.description'))}</div><p class="sigil-notes">${htmlEscape(sigil.notes)}</p></div>`
    : '';

  return `<section class="sigil">
    ${sigil.loaded ? `<div class="sigil-badge">✦ ${htmlEscape(t('creation.sigilLoaded'))}</div>` : ''}
    ${part(t('exportModal.sigil.drawing'), sigil.showDrawing, drawing)}
    ${part(t('creation.intention'), sigil.showIntention, intention)}
    ${part(t('creation.letterBank'), sigil.showLetterBank, letters)}
    ${details.length ? `<div class="sigil-details">${details.map(d => `<div class="sigil-detail">${d}</div>`).join('')}</div>` : ''}
    ${notes}
  </section>`;
}

/**
 * What a hidden sigil part says: "hidden until …" only while the app hides
 * it automatically until a coming date, "the sigil is loaded" only when it is.
 */
function sigilHiddenNote(sigil: NonNullable<ExportData['sigil']>): string {
  if (sigil.hiddenUntil) return i18n.t('exportModal.sigil.hiddenUntil', { date: sigil.hiddenUntil });
  return sigil.loaded ? i18n.t('exportModal.sigil.hidden') : i18n.t('creation.hidden');
}

/**
 * The sigil as a Markdown section for the body — not the header, whose
 * `Key: value` lines the Markdown import reads as metadata. Hidden parts say so.
 */
function sigilMarkdown(data: ExportData): string[] {
  const sigil = data.sigil;
  if (!sigil) return [];
  const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
  const hidden = `🔒 ${sigilHiddenNote(sigil)}`;
  const lines: string[] = [`## ${t('exportModal.sigil.drawing')}`, ''];
  if (sigil.loaded) lines.push(`✦ ${t('creation.sigilLoaded')}`, '');
  lines.push(`- ${t('exportModal.sigil.drawing')}: ${sigil.showDrawing
    ? (sigil.drawing ? `🖼 ${t('exportModal.placeholder.notExported', { name: t('exportModal.sigil.drawing') })}` : '—')
    : hidden}`);
  lines.push(`- ${t('creation.intention')}: ${sigil.showIntention ? (sigil.intention || '—') : hidden}`);
  if (sigil.showLetterBank) {
    const done = new Set(sigil.implementedLetters);
    lines.push(`- ${t('creation.letterBank')}: ${sigil.letterBank.map(l => (done.has(l) ? `~~${l}~~` : l)).join(' ') || '—'}`);
  } else {
    lines.push(`- ${t('creation.letterBank')}: ${hidden}`);
  }
  if (sigil.chargingTechnique) lines.push(`- ${t('creation.chargingTechnique')}: [[${sigil.chargingTechnique.label}]]`);
  if (sigil.revealDate) lines.push(`- ${t('creation.targetDate')}: ${sigil.revealDate}`);
  if (sigil.notes) lines.push('', `### ${t('creation.description')}`, '', sigil.notes);
  return [...lines, ''];
}

/**
 * Renders one entry as an `<article>`: top bar, title, metadata and content,
 * with images embedded and internal links pre-rendered as chips. Shared by
 * the PDF and interactive HTML exports; `footerHtml` is appended inside the
 * article (the HTML export's references section).
 */
export async function renderEntryArticle(
  data: ExportData,
  opts: {
    bundleIds?: ReadonlySet<string>;
    images: ExportOptions['images'];
    audio: MediaModes['audio'];
    footerHtml?: string;
    /** How a sigil's hidden parts are shown: switchable (HTML) or left out with a note (PDF, or HTML with `omit`). */
    sigil?: 'interactive' | 'static';
  },
): Promise<string> {
  const { bundleIds, footerHtml = '' } = opts;
  const { mode: imageMode, compression } = splitImageOption(opts.images);
  // Placeholders first: they must replace an element before embedMedia
  // would read its file from disk.
  const resolvedContent = transformMedia(resolveInternalLinkIcons(data.content), { images: imageMode, audio: opts.audio });
  const embeddedContent  = await compressImagesInHtml(await embedMedia(resolvedContent), compression);
  // Pre-render the internal-link chips in TS — the new webview's CSP
  // (`script-src 'self'`) blocks inline scripts, so the JS that used to
  // live in `TRANSFORM_LINKS_JS` now has to run before we hand the HTML
  // to the backend.
  const transformedContent = transformInternalLinks(embeddedContent, bundleIds);

  const numStr = data.entryNumber ? `<span class="entry-number">#${data.entryNumber}</span>` : '';
  return `<article class="entry-article" id="${entryAnchor(data.id)}" data-title="${htmlEscape(data.title)}">
    ${buildTopBar(data)}
    <h1 class="entry-title">${htmlEscape(data.title)}${numStr}</h1>
    ${buildMetaHtml(data, bundleIds)}
    ${await buildSigilHtml(data, opts.sigil ?? 'static', opts.images, bundleIds)}
    <div class="entry-content">${DOMPurify.sanitize(transformedContent, CONTENT_PURIFY_CONFIG)}</div>
    ${footerHtml}
  </article>`;
}

/**
 * Exports one or more entries into a single PDF. The first entry is the
 * main one (it names the file); further entries — linked entries bundled
 * by the export modal — each start on a new page.
 */
export async function exportAsPDF(entries: ExportData[], opts: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<boolean> {
  const [main] = entries;
  if (!main) return false;
  const bundleIds = entries.length > 1 ? new Set(entries.map(e => e.id)) : undefined;
  // A PDF can't play sound: always a placeholder.
  const articles = (await renderSequentially(entries, e => renderEntryArticle(e, { bundleIds, images: mediaFor(e, opts).images, audio: 'placeholder' })))
    // The PDF is rendered in a hidden, viewport-sized webview right after
    // the page reports "loaded". WebKit decodes large images lazily, so
    // images further down could still be undecoded when the PDF is captured
    // and come out blank. Force eager loading and synchronous decoding.
    .map(html => html.replace(/<img /g, '<img loading="eager" decoding="sync" '));

  const fullHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(documentTitle(main, opts))}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div id="page">
    ${articles.join('\n')}
  </div>
</body>
</html>`;

  // Same UX as Markdown / Emerald: native save dialog first, then render.
  const path = await save({
    defaultPath: defaultFilename(main, opts, 'pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!path) return false;

  try {
    await invoke('export_pdf', { html: fullHtml, path });
    return true;
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

function entryToMarkdown(data: ExportData): string {
  // Markdown carries no files: images and sound files become notes.
  const stripped = transformMedia(data.content, { images: 'placeholder', audio: 'placeholder' });

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
  // The header stays English with fixed date formats: the Markdown import parses it.
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
  if (data.customProps?.length) {
    for (const p of data.customProps) lines.push(`${p.name}: ${formatCustomPropValue(p)}`);
  }
  lines.push('', '---', '');
  lines.push(...sigilMarkdown(data));
  lines.push(td.turndown(stripped), '');

  return lines.join('\n');
}

/**
 * Exports one or more entries into a single Markdown file. Bundled entries
 * follow the main entry, separated by a horizontal rule; `[[wiki links]]`
 * between them keep working in tools like Obsidian since titles match.
 */
export async function exportAsMarkdown(entries: ExportData[], opts: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<boolean> {
  const [main] = entries;
  if (!main) return false;
  const markdown = entries.map(entryToMarkdown).join('\n\n---\n\n');

  const path = await save({
    defaultPath: defaultFilename(main, opts, 'md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!path) return false;
  await invoke('write_file', { path, content: markdown });
  return true;
}

// ── guard ──────────────────────────────────────────────────────────────────

export async function noEntryMessage(): Promise<void> {
  await message(i18n.t('exportModal.noEntry'), {
    title: i18n.t('exportModal.title'), kind: 'info',
  });
}

/** Show an error dialog for a failed export or import. */
export async function exportErrorMessage(err: unknown, kind: 'export' | 'import'): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(detail, { title: i18n.t(kind === 'export' ? 'exportModal.exportFailed' : 'exportModal.importFailed'), kind: 'error' });
}
