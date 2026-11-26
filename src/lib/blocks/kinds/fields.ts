import { SlidersHorizontal } from 'lucide-react';
import { MOON_PHASE_SYMBOLS } from '../../moonPhase';
import type { MoonPhase } from '../../../types';
import { decodeHtmlAttr } from '../../internalLinkHtml';
import type {
  BlockExportPart, BlockExportValue, BlockFieldValue, BlockGroup, BlockPreset, BlockPropertyRow, BlockTypeDef, BlockValue,
} from '../blockType';
import {
  checklistHtml, createFieldsBlock, ELEMENT_KIND_ICONS, ELEMENT_KINDS, elementKindLabelKey, elementUses, fieldFallbackText, fieldLabel, FIELDS_BLOCK_TYPE, isElementEmpty, isHiddenInRead,
  parseFields, serializeFields, withoutElementContent,
  type ChecklistItem, type ElementDef, type ElementKind, type FieldUse, type FieldsModel,
} from '../fields';
import { extractInternalLinks, withoutInternalLinksTo } from '../../internalLinkHtml';
import type { ListInfoPart } from '../listInfo';
import { htmlPlainText } from '../plainText';
import { blockTypeTextKey, imageFromSlot, linkFromSlot, type RefReporter } from '../toolkit';
import type { BlockInstance } from '../types';

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
}

/**
 * The block without its link to `target`: a link field holding it emptied, a
 * chip in a text field turned into its word (the text stays). Text fields
 * with a mounted editor are reached through the editor first (the stack's
 * link requests); this is for the rest.
 */
function fieldsWithoutLink(block: BlockInstance, target: string, t: (key: string) => string): BlockInstance {
  const model = parseFields(block);
  const slots = { ...model.slots };
  let changed = false;
  for (const element of model.elements) {
    const slot = slots[element.id];
    if (!slot) continue;
    if (element.kind === 'link' && linkFromSlot(slot)?.id === target) {
      delete slots[element.id];
      changed = true;
    } else if (element.kind === 'text' && extractInternalLinks(slot).some((link) => link.id === target)) {
      slots[element.id] = withoutInternalLinksTo(slot, target);
      changed = true;
    }
  }
  return changed ? serializeFields(block, { ...model, slots }, fieldFallbackText(t)) : block;
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

/** How much of a long text the info line and the panel get. */
const LONG_TEXT_SHOWN = 120;

/**
 * A field's value as the info line, the panel and the dashboards take it —
 * `null` for empty. A long text by its plain text (none if it holds only a
 * rule or a picture), a checklist as "done/all"; a picture has none
 * (`canUse`). The export takes the same values except where it shows markup
 * or the picture (`fieldExportValue`).
 */
function fieldValue(element: ElementDef, model: FieldsModel): BlockValue | null {
  if (isElementEmpty(element, model)) return null;
  const value = model.values[element.id];
  switch (element.kind) {
    case 'text': {
      // Shown in a line, never filtered by: its beginning is enough.
      const text = htmlPlainText(model.slots[element.id] ?? '');
      if (!text) return null;
      return { kind: 'text', text: text.length > LONG_TEXT_SHOWN ? `${text.slice(0, LONG_TEXT_SHOWN).trimEnd()}…` : text };
    }
    case 'link': {
      const link = linkFromSlot(model.slots[element.id]);
      return link ? { kind: 'link', id: link.id, targetKind: link.targetKind, label: link.label } : null;
    }
    case 'checklist': {
      const items = value as ChecklistItem[];
      return { kind: 'text', text: `${items.filter((i) => i.checked).length}/${items.length}` };
    }
    case 'image':
      return null;
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
    case 'moon':
      return { kind: 'phrase', key: `moonPhase.${value as MoonPhase}`, symbol: MOON_PHASE_SYMBOLS[value as MoonPhase] };
  }
}

/**
 * The fields of a readable block used so, in block order, each with its key
 * and value. The key is the element's ID: every copy of one custom block
 * carries the same IDs, so its field has the same key in every entry. An
 * empty field ranks after a filled one, so that of two copies in an entry
 * the filled one speaks.
 */
function usedFields(block: BlockInstance, use: FieldUse) {
  const model = parseFields(block);
  return model.elements
    .filter((element) => elementUses(element)[use])
    .map((element) => {
      const value = fieldValue(element, model);
      return { key: `field:${element.id}`, ...fieldLabel(element), value, rank: value === null ? 1 : 0, kind: element.kind };
    });
}

/** The type's marker in the raw content — the cheap pre-check of lists. */
const mayHold = (content: string) => content.includes(FIELDS_BLOCK_TYPE);

/** A field's value as the export shows it — `null` for empty (a dash): markup for a link, a text and a checklist, the picture of an image field, else `fieldValue`. */
function fieldExportValue(element: ElementDef, model: FieldsModel): BlockExportValue | null {
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
    case 'checklist':
      return isElementEmpty(element, model) ? null : { kind: 'html', html: checklistHtml(model.values[element.id] as ChecklistItem[]) };
    default:
      return fieldValue(element, model);
  }
}

/** What read mode shows: a row per field it shows (empty ones missing as the display rule says). */
function fieldsExport(block: BlockInstance): BlockExportPart[] {
  const model = parseFields(block);
  return model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .map((element): BlockExportPart => {
      return { kind: 'row', ...fieldLabel(element), value: fieldExportValue(element, model) };
    });
}

const KIND_GROUPS: Partial<Record<ElementKind, BlockGroup>> = { link: 'reference', image: 'media', moon: 'moon' };

/** "Add block" offers a single field of each kind — but no text field: one inserts the text block. */
const FIELD_PRESETS: readonly BlockPreset[] = ELEMENT_KINDS.filter((kind) => kind !== 'text').map((kind) => ({
  id: `field.${kind}`,
  labelKey: elementKindLabelKey(kind),
  icon: ELEMENT_KIND_ICONS[kind],
  group: KIND_GROUPS[kind] ?? 'fields',
  create: () => createFieldsBlock(kind),
}));

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
  presets: FIELD_PRESETS,
  isBroken: (block) => parseFields(block).broken,
  // Its text fields are editors of the stack's, under the element's ID.
  textEditors: (block) => parseFields(block).elements.filter((el) => el.kind === 'text').map((el) => el.id),
  // Each field as its settings say (`FieldUses`): the short info line shows the value alone, the long one and the panel "Field: value".
  listInfo: {
    mayContribute: mayHold,
    parts: (block) => usedFields(block, 'info').map(({ kind: _kind, ...field }): ListInfoPart => field),
  },
  properties: {
    mayContribute: mayHold,
    rows: (block) => usedFields(block, 'panel')
      .flatMap(({ kind: _kind, rank: _rank, value, ...field }): BlockPropertyRow[] => (value ? [{ ...field, value }] : [])),
    overridable: { icon: true, cover: true },
    // A copy of a custom block carries its name and emoji; a single field is named and iconed after its label or kind.
    name: (block) => {
      const model = parseFields(block);
      const single = model.elements.length === 1 ? model.elements[0] : null;
      return {
        name: model.name.trim() ? { label: model.name.trim() } : single ? fieldLabel(single) : undefined,
        glyph: model.icon || (single ? ELEMENT_KIND_ICONS[single.kind] : undefined),
      };
    },
  },
  values: {
    mayContribute: mayHold,
    // "done/all" is no order: a checklist filters, it does not sort.
    read: (block) => usedFields(block, 'values')
      .map(({ kind, ...field }): BlockFieldValue => ({ ...field, filter: true, sort: kind !== 'checklist' })),
  },
  // The readable fallback (`<dl>`) is what there is to find.
  searchText: (block) => htmlPlainText(block.html),
  export: fieldsExport,
  refs: fieldsRefs,
  withoutImage: fieldsWithoutImage,
  withoutLink: fieldsWithoutLink,
};
