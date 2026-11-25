import { SlidersHorizontal } from 'lucide-react';
import { MOON_PHASE_SYMBOLS } from '../../moonPhase';
import type { MoonPhase } from '../../../types';
import { decodeHtmlAttr } from '../../internalLinkHtml';
import type { BlockExportPart, BlockExportValue, BlockTypeDef } from '../blockType';
import {
  checklistHtml, elementKindLabelKey, FIELDS_BLOCK_TYPE, imageFromSlot, isElementEmpty, isHiddenInRead, parseFields, withoutElementContent,
  type ChecklistItem, type ElementDef, type ElementKind, type FieldsModel,
} from '../fields';
import { htmlPlainText } from '../plainText';
import { blockTypeTextKey, type RefReporter } from '../toolkit';
import { BLOCK_ATTR, type BlockInstance } from '../types';

/**
 * What a kind of field's prefill points at — the fields block's own
 * knowledge about its kinds. Every slot reports the link chips and pictures
 * of its markup (text, link, image fields alike).
 */
const ELEMENT_PREFILL_REFS: Partial<Record<ElementKind, (element: ElementDef, report: RefReporter) => void>> = {
  image: (element, report) => {
    if (typeof element.defaultValue === 'string') report.image(element.defaultValue, 'default');
  },
  link: (element, report) => {
    const value = element.defaultValue;
    if (value && typeof value === 'object' && 'id' in value) report.entry(String(value.id), 'default');
  },
};

function fieldsRefs(block: BlockInstance, report: RefReporter): void {
  const model = parseFields(block);
  for (const html of Object.values(model.slots)) report.markup(html);
  report.icon(model.icon);
  for (const element of model.elements) ELEMENT_PREFILL_REFS[element.kind]?.(element, report);
  // A broken block keeps what its markup and JSON name, so nothing it holds goes unseen.
  if (model.broken) {
    report.markup(block.html);
    report.imagesIn(block.attrs[BLOCK_ATTR.config], 'default');
  }
}

const SLOT_RE = /\bdata-block-slot="el:([^"]{1,200})"[^<>]*>([\s\S]*?)<\/dd>/gi;

/** The block without the picture in its image fields and texts. */
function fieldsWithoutImage(block: BlockInstance, file: string): BlockInstance {
  if (!block.html.includes(file)) return block;
  const slots = new Set<string>();
  for (const [, id, inner] of block.html.matchAll(SLOT_RE)) {
    if (inner.includes(file)) slots.add(decodeHtmlAttr(id));
  }
  return withoutElementContent(block, slots);
}

/** A field's value as the export shows it — `null` for empty (a dash). The readable fallback maps the same kinds (`fieldValueHtml`). */
function fieldExportValue(element: ElementDef, model: FieldsModel): BlockExportValue | null {
  const value = model.values[element.id];
  const slot = model.slots[element.id];
  switch (element.kind) {
    case 'image': {
      const file = imageFromSlot(slot);
      // Named after its row.
      return file ? { kind: 'image', file } : null;
    }
    case 'link':
      return slot ? { kind: 'html', html: slot } : null;
    case 'text':
      return isElementEmpty(element, model) ? null : { kind: 'html', html: slot! };
  }
  // The slot kinds are answered above; the rest are values.
  if (isElementEmpty(element, model)) return null;
  switch (element.kind) {
    case 'shorttext':
      return { kind: 'text', text: value as string };
    case 'date':
      return { kind: 'date', iso: value as string };
    case 'number':
      return { kind: 'number', value: value as number };
    case 'select':
      return { kind: 'text', text: element.options!.find((o) => o.id === value)!.label };
    case 'toggle':
      return { kind: 'bool', value: value === true };
    case 'checklist':
      return { kind: 'html', html: checklistHtml(value as ChecklistItem[]) };
    case 'moon':
      return { kind: 'phrase', key: `moonPhase.${value as MoonPhase}`, symbol: MOON_PHASE_SYMBOLS[value as MoonPhase] };
    default:
      return null;
  }
}

/** What read mode shows: a row per field it shows (archived and — per the display rule — empty ones are missing). */
function fieldsExport(block: BlockInstance): BlockExportPart[] {
  const model = parseFields(block);
  // Unreadable: its readable fallback, as read mode shows it.
  if (model.broken) return block.html ? [{ kind: 'html', html: block.html }] : [];
  return model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .map((element): BlockExportPart => {
      const value = fieldExportValue(element, model);
      const label = element.label.trim();
      return label ? { kind: 'row', label, value } : { kind: 'row', labelKey: elementKindLabelKey(element.kind), value };
    });
}

/** The fields block: user-built blocks and single fields. */
export const fieldsBlockType: BlockTypeDef = {
  id: FIELDS_BLOCK_TYPE,
  origin: 'core',
  icon: SlidersHorizontal,
  labelKey: blockTypeTextKey(FIELDS_BLOCK_TYPE, 'label'),
  descriptionKey: blockTypeTextKey(FIELDS_BLOCK_TYPE, 'description'),
  group: 'fields',
  dataVersion: 1,
  // A single field carries its label in the row anyway.
  defaultShowTitle: false,
  // The readable fallback (`<dl>`) is what there is to find.
  searchText: (block) => htmlPlainText(block.html),
  export: fieldsExport,
  refs: fieldsRefs,
  withoutImage: fieldsWithoutImage,
};
