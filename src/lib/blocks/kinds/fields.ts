import { SlidersHorizontal } from 'lucide-react';
import { decodeHtmlAttr } from '../../internalLinkHtml';
import type {
  BlockExportPart, BlockExportValue, BlockFieldValue, BlockPreset, BlockPropertyRow, BlockTypeDef, BlockValue,
} from '../blockType';
import { fieldKinds } from '../fieldKinds';
import {
  createFieldsBlock, elementKind, elementUses, fieldFallbackText, fieldLabel, fieldRead, FIELDS_BLOCK_TYPE, isElementEmpty, isHiddenInRead,
  parseFields, reportPrefillRefs, serializeFields, withFieldStored, withoutElementContent,
  type ElementDef, type FieldUse, type FieldsModel,
} from '../fields';
import type { ListInfoPart } from '../listInfo';
import { htmlPlainText } from '../plainText';
import { blockTypeTextKey, type RefReporter } from '../toolkit';
import type { BlockInstance } from '../types';

/**
 * The fields block's interfaces. Each one asks the fields' kinds
 * (`FieldKindDef`, `fieldKinds.ts`) and names none of them.
 */

/** Every slot reports the link chips and pictures of its markup; each prefill what its kind says it points at. */
function fieldsRefs(block: BlockInstance, report: RefReporter): void {
  const model = parseFields(block);
  for (const html of Object.values(model.slots)) report.markup(html);
  report.icon(model.icon);
  for (const element of model.elements) reportPrefillRefs(element, report);
}

/**
 * The block without its link to `target`, as each field's kind takes it out
 * (a link field emptied, a chip in a text turned into its word). Text fields
 * with a mounted editor are reached through the editor first (the stack's
 * link requests); this is for the rest.
 */
function fieldsWithoutLink(block: BlockInstance, target: string, t: (key: string) => string): BlockInstance {
  let model = parseFields(block);
  let changed = false;
  for (const element of model.elements) {
    const slot = model.slots[element.id];
    const without = slot ? elementKind(element).withoutLink?.(slot, target) : undefined;
    if (without === undefined) continue;
    model = withFieldStored(model, element, without ?? undefined);
    changed = true;
  }
  return changed ? serializeFields(block, model, fieldFallbackText(t)) : block;
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

/** A field's value as the info line, the panel and the dashboards take it — `null` for empty or none (its kind's `value`). */
function fieldValue(element: ElementDef, model: FieldsModel): BlockValue | null {
  return isElementEmpty(element, model) ? null : elementKind(element).value(fieldRead(element, model));
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
      return { key: `field:${element.id}`, ...fieldLabel(element), value, rank: value === null ? 1 : 0, element };
    });
}

/** The type's marker in the raw content — the cheap pre-check of lists. */
const mayHold = (content: string) => content.includes(FIELDS_BLOCK_TYPE);

/** A field's value as the export shows it — `null` for empty (a dash): its kind's `exportValue` (markup, a picture), else its `value`. */
function fieldExportValue(element: ElementDef, model: FieldsModel): BlockExportValue | null {
  if (isElementEmpty(element, model)) return null;
  const kind = elementKind(element);
  const field = fieldRead(element, model);
  return kind.exportValue ? kind.exportValue(field) : kind.value(field);
}

/** What read mode shows: a row per field it shows (empty ones missing as the display rule says). */
function fieldsExport(block: BlockInstance): BlockExportPart[] {
  const model = parseFields(block);
  return model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .map((element): BlockExportPart => ({ kind: 'row', ...fieldLabel(element), value: fieldExportValue(element, model) }));
}

/** "Add block" offers a single field of each kind that says where (no text field: one inserts the text block). */
const FIELD_PRESETS: readonly BlockPreset[] = fieldKinds().flatMap((kind) => (kind.presetGroup
  ? [{
      id: `field.${kind.id}`,
      labelKey: kind.labelKey,
      icon: kind.icon,
      group: kind.presetGroup,
      create: () => createFieldsBlock(kind.id),
    }]
  : []));

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
  // Its fields whose kind is a text editor are editors of the stack's, under the element's ID.
  textEditors: (block) => parseFields(block).elements.filter((el) => elementKind(el).textEditor).map((el) => el.id),
  // Each field as its settings say (`FieldUses`): the short info line shows the value alone, the long one and the panel "Field: value".
  listInfo: {
    mayContribute: mayHold,
    parts: (block) => usedFields(block, 'info').map(({ element: _element, ...field }): ListInfoPart => field),
  },
  properties: {
    mayContribute: mayHold,
    rows: (block) => usedFields(block, 'panel')
      .flatMap(({ element: _element, rank: _rank, value, ...field }): BlockPropertyRow[] => (value ? [{ ...field, value }] : [])),
    overridable: { icon: true, cover: true },
    // A copy of a custom block carries its name and emoji; a single field is named and iconed after its label or kind.
    name: (block) => {
      const model = parseFields(block);
      const single = model.elements.length === 1 ? model.elements[0] : null;
      return {
        name: model.name.trim() ? { label: model.name.trim() } : single ? fieldLabel(single) : undefined,
        glyph: model.icon || (single ? elementKind(single).icon : undefined),
      };
    },
  },
  values: {
    mayContribute: mayHold,
    read: (block) => usedFields(block, 'values')
      .map(({ element, ...field }): BlockFieldValue => ({ ...field, filter: true, sort: elementKind(element).sortable })),
  },
  // The readable fallback (`<dl>`) is what there is to find.
  searchText: (block) => htmlPlainText(block.html),
  export: fieldsExport,
  refs: fieldsRefs,
  withoutImage: fieldsWithoutImage,
  withoutLink: fieldsWithoutLink,
};
