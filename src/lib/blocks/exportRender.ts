import { escapeHtml } from '../internalLinkHtml';
import { isBlockHidden, showsTitleInRead } from './blockAttrs';
import { parseBlocks } from './blockHtml';
import type { BlockExportPart, BlockExportValue } from './blockType';
import { entryEffects, resolveBlockType, type BlockTypeDef } from './blockTypes';
import {
  FIELDS_BLOCK_TYPE, fieldValueHtml, imageFromSlot, isElementEmpty, isHiddenInRead, isSlotKind, parseFields,
  type ElementDef, type FallbackText, type FieldsModel,
} from './fields';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './types';
import { ALTAR_BLOCK_TYPE, CANVAS_BLOCK_TYPE, parseCanvasBlock } from './canvas';
import { drawingImage, PAINT_BLOCK_TYPE } from './paint';
import { localIsoDay } from '../helpers';

/**
 * The blocks of an entry as HTML for PDF and Markdown — one serializer per
 * type, following the same rules as read mode:
 * - hidden blocks (the eye) are missing,
 * - what a block's effect conceals today is missing (a loaded sigil's
 *   calculator and drawing): a concealed block here, a concealed part by
 *   its block's own export,
 * - a type with an export of its own (`BlockTypeDef.export`) is laid out
 *   from the parts it delivers,
 * - field blocks show only what read mode shows (archived and — per
 *   the display rule — empty fields do not appear), date and number formatted,
 * - the block title appears as a heading where read mode shows it,
 * - a block that ends up empty in the process is missing entirely.
 *
 * What comes out is plain HTML without `<section>`: the usual export steps
 * then run (DOMPurify, embedding images, link chips, Turndown). The images
 * of the blocks (drawing, image field) carry their label as alt text
 * and `data-export-placeholder` — in the Markdown it stays in its place.
 *
 * Pure and DOM-free; the caller passes in the texts (language, formats).
 */

export interface ExportText {
  /** What the block is called (`blockLabel` with `t`). */
  title: (block: BlockInstance, meta: BlockTypeDef | undefined) => string;
  fields: FallbackText;
  /** A `YYYY-MM-DD` for humans. */
  date: (iso: string) => string;
  number: (value: number) => string;
  /** A text by its i18n key — the labels a block's export parts name. */
  t: (key: string) => string;
}

function row(label: string, valueHtml: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`;
}

function imageHtml(src: string, label: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" data-export-placeholder="1">`;
}

function fieldValue(element: ElementDef, model: FieldsModel, text: ExportText): string | null {
  const value = model.values[element.id];
  switch (element.kind) {
    case 'image': {
      const filename = imageFromSlot(model.slots[element.id]);
      return filename ? imageHtml(filename, text.fields.label(element)) : null;
    }
    case 'link':
      return model.slots[element.id] ?? null;
    case 'text':
      return isElementEmpty(element, model) ? null : model.slots[element.id]!;
    case 'date':
      return typeof value === 'string' && value.trim() ? escapeHtml(text.date(value)) : null;
    case 'number':
      return typeof value === 'number' ? escapeHtml(text.number(value)) : null;
    default:
      return isSlotKind(element.kind) ? null : fieldValueHtml(element, model, text.fields);
  }
}

function fieldsHtml(block: BlockInstance, text: ExportText): string {
  const model = parseFields(block);
  if (model.broken) return block.html;
  const rows = model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .map((element) => row(text.fields.label(element), fieldValue(element, model, text) ?? '—'));
  return rows.length ? `<dl>${rows.join('')}</dl>` : '';
}

function valueHtml(value: BlockExportValue | null, text: ExportText): string {
  if (!value) return '—';
  switch (value.kind) {
    case 'html': return value.html;
    case 'date': return escapeHtml(text.date(value.iso));
    case 'number': return escapeHtml(text.number(value.value));
    case 'bool': return escapeHtml(value.value ? text.fields.yes : text.fields.no);
    case 'text': return escapeHtml(value.text);
  }
}

/** A block's export parts as HTML: consecutive rows in one `<dl>`, a part's heading one level below the block's title. */
function partsHtml(parts: readonly BlockExportPart[], text: ExportText): string {
  let html = '';
  let rows = '';
  const flush = () => {
    if (rows) html += `<dl>${rows}</dl>`;
    rows = '';
  };
  for (const part of parts) {
    if (part.kind === 'row') {
      rows += row(text.t(part.labelKey), valueHtml(part.value, text));
      continue;
    }
    flush();
    switch (part.kind) {
      case 'heading': html += `<h4>${escapeHtml(text.t(part.labelKey))}</h4>`; break;
      case 'note': html += `<p>${escapeHtml(text.t(part.textKey))}</p>`; break;
      case 'text': html += `<p>${escapeHtml(part.text)}</p>`; break;
      case 'html': html += part.html; break;
      case 'image': html += imageHtml(part.file, text.t(part.altKey)); break;
    }
  }
  flush();
  return html;
}

function bodyHtml(block: BlockInstance, meta: BlockTypeDef | undefined, text: ExportText, today: string): string {
  if (meta?.export) return partsHtml(meta.export(block, { today }), text);
  switch (meta?.id) {
    case FIELDS_BLOCK_TYPE:
      return fieldsHtml(block, text);
    case PAINT_BLOCK_TYPE: {
      const image = drawingImage(block);
      return image ? imageHtml(image, text.title(block, meta)) : '';
    }
    case CANVAS_BLOCK_TYPE:
    case ALTAR_BLOCK_TYPE: {
      // The rendered picture; the pictures behind it are only references.
      const { render } = parseCanvasBlock(block);
      return render ? imageHtml(render, text.title(block, meta)) : '';
    }
    case TEXT_BLOCK_TYPE:
    default: // Unknown type or format too new: the stored fallback.
      return block.html;
  }
}

export function renderBlocksForExport(content: string, text: ExportText, today = localIsoDay()): string {
  const blocks = parseBlocks(content);
  const { concealed } = entryEffects(blocks, { today });
  const parts: string[] = [];
  for (const block of blocks) {
    if (isBlockHidden(block) || concealed.has(block.id)) continue;
    const meta = resolveBlockType(block);
    const body = bodyHtml(block, meta, text, today);
    if (!body.trim()) continue;
    const title = showsTitleInRead(block, meta) ? `<h3>${escapeHtml(text.title(block, meta))}</h3>` : '';
    parts.push(title + body);
  }
  return parts.join('');
}
