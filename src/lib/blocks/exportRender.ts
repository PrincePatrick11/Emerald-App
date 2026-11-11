import { escapeHtml } from '../internalLinkHtml';
import { isBlockHidden, showsTitleInRead } from './blockAttrs';
import { parseBlocks } from './blockHtml';
import { resolveBlockType, type BlockTypeMeta } from './blockTypes';
import {
  FIELDS_BLOCK_TYPE, fieldValueHtml, imageFromSlot, isElementEmpty, isHiddenInRead, isSigilKind, isSlotKind, linkFromSlot, parseFields,
  type ElementDef, type FallbackText, type FieldsModel,
} from './fields';
import {
  parseSigilCharge, sigilImage, sigilPartBlock, sigilState, SIGIL_CALC_TYPE, SIGIL_CANVAS_TYPE, SIGIL_CHARGE_TYPE,
  withoutConcealedParts,
  todayIso,
} from './sigil';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './types';
import { CANVAS_BLOCK_TYPE, parseCanvasBlock } from './canvas';

/**
 * The blocks of an entry as HTML for PDF and Markdown — one serializer per
 * type, following the same rules as read mode:
 * - hidden blocks (the eye) are missing,
 * - calculators and drawings that a loaded sigil still conceals are missing,
 * - an altar field shows the altar's preview image and its link chip,
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
  title: (block: BlockInstance, meta: BlockTypeMeta | undefined) => string;
  fields: FallbackText;
  /** A `YYYY-MM-DD` for humans. */
  date: (iso: string) => string;
  number: (value: number) => string;
  targetDate: string;
  technique: string;
  loaded: string;
  notLoaded: string;
  /** Label of the drawing — in the Markdown the placeholder in its place. */
  drawing: string;
  /** An altar with its stored preview image (file name or data URL) — `null` if it no longer exists. */
  altar: (altarId: string) => { title: string; image: string | null } | null;
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
    case 'altar': {
      const slot = model.slots[element.id];
      if (!slot) return null;
      // The image carries the current name, like read mode; a deleted altar stays with the chip.
      const link = linkFromSlot(slot);
      const altar = link?.entryType === 'altar' ? text.altar(link.id) : null;
      const image = altar?.image ? imageHtml(altar.image, altar.title || link!.label) : '';
      return `${image}${slot}`;
    }
    case 'date':
      return typeof value === 'string' && value.trim() ? escapeHtml(text.date(value)) : null;
    case 'number':
      return typeof value === 'number' ? escapeHtml(text.number(value)) : null;
    default:
      return isSlotKind(element.kind) ? null : fieldValueHtml(element, model, text.fields);
  }
}

function fieldsHtml(block: BlockInstance, text: ExportText, concealed: ReadonlyMap<string, string | null>): string {
  const model = parseFields(block);
  if (model.broken) return block.html;
  const rows = model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .flatMap((element) => {
      if (!isSigilKind(element.kind)) return [row(text.fields.label(element), fieldValue(element, model, text) ?? '—')];
      // A sigil part like a block of the same kind — if concealed it is missing entirely.
      const part = sigilPartBlock(block, { ...element, kind: element.kind }, model);
      if (concealed.has(part.id)) return [];
      const body = sigilHtml(part, text);
      return body.trim() ? [row(text.fields.label(element), body)] : [];
    });
  return rows.length ? `<dl>${rows.join('')}</dl>` : '';
}

/** Calculator, drawing or charge — as a block as well as a part of a custom block. */
function sigilHtml(block: BlockInstance, text: ExportText): string {
  switch (block.type) {
    case SIGIL_CANVAS_TYPE: {
      const image = sigilImage(block);
      return image ? imageHtml(image, text.drawing) : '';
    }
    case SIGIL_CHARGE_TYPE:
      return chargeHtml(block, text);
    default: // Calculator: its stored fallback is already the read version (intention, letters).
      return block.html;
  }
}

function chargeHtml(block: BlockInstance, text: ExportText): string {
  const charge = parseSigilCharge(block);
  if (charge.broken) return block.html;
  return `<dl>${row(text.targetDate, charge.revealDate ? escapeHtml(text.date(charge.revealDate)) : '—')}`
    + `${row(text.technique, charge.technique ?? '—')}</dl>`
    + `<p>${escapeHtml(charge.loaded ? text.loaded : text.notLoaded)}</p>`;
}

function bodyHtml(
  block: BlockInstance,
  meta: BlockTypeMeta | undefined,
  text: ExportText,
  concealed: ReadonlyMap<string, string | null>,
): string {
  switch (meta?.id) {
    case FIELDS_BLOCK_TYPE:
      return fieldsHtml(block, text, concealed);
    case SIGIL_CALC_TYPE:
    case SIGIL_CANVAS_TYPE:
    case SIGIL_CHARGE_TYPE:
      return sigilHtml(block, text);
    case CANVAS_BLOCK_TYPE: {
      // The rendered picture; the pictures behind it are only references.
      const { render } = parseCanvasBlock(block);
      return render ? imageHtml(render, text.title(block, meta)) : '';
    }
    case TEXT_BLOCK_TYPE:
    default: // Unknown type or format too new: the stored fallback.
      return block.html;
  }
}

export function renderBlocksForExport(content: string, text: ExportText, today = todayIso()): string {
  const blocks = parseBlocks(content);
  const { concealed } = sigilState(blocks, today);
  const parts: string[] = [];
  for (const original of blocks) {
    if (isBlockHidden(original) || concealed.has(original.id)) continue;
    // Also the fallback of a field block (format too new) without concealed parts.
    const block = withoutConcealedParts(original, concealed);
    const meta = resolveBlockType(block);
    const body = bodyHtml(block, meta, text, concealed);
    if (!body.trim()) continue;
    const title = showsTitleInRead(block, meta) ? `<h3>${escapeHtml(text.title(block, meta))}</h3>` : '';
    parts.push(title + body);
  }
  return parts.join('');
}
