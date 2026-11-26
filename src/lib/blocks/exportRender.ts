import { escapeHtml } from '../internalLinkHtml';
import { isBlockHidden, showsTitleInRead } from './blockAttrs';
import { parseBlocks } from './blockHtml';
import { phraseText, valueLabel, type BlockExportFormat, type BlockExportPart, type BlockExportValue, type ExportContext } from './blockType';
import { blockReadState, entryEffects, resolveBlockType, UNREADABLE_NOTICE } from './blockTypes';
import type { BlockInstance } from './types';
import { localIsoDay } from '../helpers';

/**
 * The blocks of an entry as HTML for PDF, HTML and Markdown. Every block is
 * asked for its parts in the format at hand (`BlockTypeDef.export`, with what
 * the entry's blocks conceal today); this file only lays them out and knows
 * no block type:
 * - hidden blocks (the eye) are missing,
 * - a block the entry's effects conceal as a whole is covered in HTML, with a
 *   switch to uncover it, and missing in PDF and Markdown — a concealed part
 *   of a block is the block's own to cover or leave out,
 * - a type without an export of its own shows its markup (the text block),
 * - a block this app cannot read (`blockReadState`) shows the notice read
 *   mode shows, never what it holds,
 * - the block title appears as a heading where read mode shows it,
 * - a block that ends up empty in the process is missing entirely.
 *
 * What comes out is plain HTML without `<section>`: the usual export steps
 * then run (DOMPurify, embedding images, link chips, Turndown). The images
 * of the blocks carry their label as alt text and `data-export-placeholder` —
 * in the Markdown it stays in its place. A covered part is a
 * `.export-concealed` box: the cover with its switch, then the content; the
 * HTML file's script switches it (`htmlExport.ts`).
 *
 * Pure and DOM-free; the caller passes in the texts (language, formats).
 */

export interface ExportText {
  /** What the block is called (`blockLabel` with `t`). */
  title: (block: BlockInstance) => string;
  yes: string;
  no: string;
  /** A `YYYY-MM-DD` for humans. */
  date: (iso: string) => string;
  number: (value: number) => string;
  /** A text by its i18n key — the labels a block's export parts name. */
  t: (key: string) => string;
  /** What a cover says: concealed until a day (formatted), or until lifted (`null`). */
  concealed: (until: string | null) => string;
  /** The cover's switch: uncover, cover again. */
  reveal: string;
  conceal: string;
}

function row(label: string, valueHtml: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`;
}

function imageHtml(src: string, label: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" data-export-placeholder="1">`;
}

function valueHtml(value: BlockExportValue | null, label: string, text: ExportText): string {
  if (!value) return '—';
  switch (value.kind) {
    case 'html': return value.html;
    case 'image': return imageHtml(value.file, value.alt ?? label);
    case 'phrase': return escapeHtml(phraseText(value, text.t));
    case 'link': return escapeHtml(value.label);
    case 'date': return escapeHtml(text.date(value.iso));
    case 'number': return escapeHtml(text.number(value.value));
    case 'bool': return escapeHtml(value.value ? text.yes : text.no);
    case 'text': return escapeHtml(value.text);
  }
}

/** Content the reader uncovers: the cover with its switch, the content behind it (shown by the file's script). */
function coveredHtml(until: string | null, inner: string, text: ExportText): string {
  return '<div class="export-concealed">'
    + `<p class="export-concealed-cover"><span>${escapeHtml(text.concealed(until))}</span>`
    + `<button type="button" class="export-concealed-toggle" data-reveal="${escapeHtml(text.reveal)}" data-conceal="${escapeHtml(text.conceal)}">${escapeHtml(text.reveal)}</button></p>`
    + `<div class="export-concealed-body">${inner}</div></div>`;
}

/**
 * A block's export parts as HTML: consecutive rows in one `<dl>`, a part's
 * heading one level below the block's title, a picture without alt key named
 * `title`. A concealed part is covered in HTML, under its heading, and left
 * out in the others with its heading.
 */
function partsHtml(parts: readonly BlockExportPart[], format: BlockExportFormat, title: string, text: ExportText): string {
  let html = '';
  let rows = '';
  const flush = () => {
    if (rows) html += `<dl>${rows}</dl>`;
    rows = '';
  };
  for (const part of parts) {
    if (part.kind === 'row') {
      const label = valueLabel(part, text.t);
      rows += row(label, valueHtml(part.value, label, text));
      continue;
    }
    flush();
    switch (part.kind) {
      case 'heading': html += `<h4>${escapeHtml(text.t(part.labelKey))}</h4>`; break;
      case 'note': html += `<p>${escapeHtml(text.t(part.textKey))}</p>`; break;
      case 'text': html += `<p>${escapeHtml(part.text)}</p>`; break;
      case 'html': html += part.html; break;
      case 'image': html += imageHtml(part.file, part.altKey ? text.t(part.altKey) : title); break;
      case 'concealed': {
        if (format !== 'html') break;
        const inner = partsHtml(part.parts, format, title, text);
        if (!inner.trim()) break;
        if (part.labelKey) html += `<h4>${escapeHtml(text.t(part.labelKey))}</h4>`;
        html += coveredHtml(part.until, inner, text);
        break;
      }
    }
  }
  flush();
  return html;
}

function bodyHtml(block: BlockInstance, ctx: ExportContext, text: ExportText): string {
  // A block this app cannot read goes out as the notice it shows, never as what it holds.
  const state = blockReadState(block);
  if (state !== 'readable') return `<p>${escapeHtml(text.t(UNREADABLE_NOTICE[state]))}</p>`;
  const meta = resolveBlockType(block);
  // Without an export of its own (the text block): its markup.
  if (!meta?.export) return block.html;
  return partsHtml(meta.export(block, ctx), ctx.format, text.title(block), text);
}

export function renderBlocksForExport(
  content: string,
  format: BlockExportFormat,
  text: ExportText,
  today = localIsoDay(),
): string {
  const blocks = parseBlocks(content);
  const { concealed } = entryEffects(blocks, { today });
  const ctx: ExportContext = { format, today, concealed };
  const parts: string[] = [];
  for (const block of blocks) {
    if (isBlockHidden(block)) continue;
    const covered = concealed.has(block.id);
    if (covered && format !== 'html') continue;
    let body = bodyHtml(block, ctx, text);
    if (!body.trim()) continue;
    if (covered) body = coveredHtml(concealed.get(block.id) ?? null, body, text);
    const title = showsTitleInRead(block) ? `<h3>${escapeHtml(text.title(block))}</h3>` : '';
    parts.push(title + body);
  }
  return parts.join('');
}
