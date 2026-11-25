import { SlidersHorizontal } from 'lucide-react';
import { decodeHtmlAttr } from '../../internalLinkHtml';
import type { BlockTypeDef } from '../blockType';
import {
  FIELDS_BLOCK_TYPE, isSigilElement, parseFields, withoutElementContent, type ElementDef, type ElementKind, type FieldsModel,
} from '../fields';
import { fieldsListInfo } from '../listInfo';
import { htmlPlainText } from '../plainText';
import { sigilPartBlock, withChargesCoveringCopy, withMappedChargeTargets } from '../sigil';
import { blockTypeTextKey, copiedBlockRef, type RefReporter } from '../toolkit';
import { BLOCK_ATTR, type BlockInstance } from '../types';
import { reportDrawing } from './paint';

/**
 * What a kind of field points at beyond its slot's markup — the fields
 * block's own knowledge about its kinds, as `ELEMENT_LIST_INFO` is for the
 * info line. A kind not listed reports the link chips and pictures of its
 * slot (text, link, image fields alike).
 */
interface ElementRefs {
  /** Instead of the slot's markup. */
  slot?: (block: BlockInstance, element: ElementDef, model: FieldsModel, report: RefReporter) => void;
  /** What the element's prefill names. */
  prefill?: (element: ElementDef, report: RefReporter) => void;
}

const ELEMENT_REFS: Partial<Record<ElementKind, ElementRefs>> = {
  // A drawing part is a drawing of its own: render and layers, no pictures of its own.
  sigilCanvas: {
    slot: (block, element, model, report) => {
      if (isSigilElement(element)) reportDrawing(sigilPartBlock(block, element, model), report);
    },
  },
  image: {
    prefill: (element, report) => {
      if (typeof element.defaultValue === 'string') report.image(element.defaultValue, 'default');
    },
  },
  link: {
    prefill: (element, report) => {
      const value = element.defaultValue;
      if (value && typeof value === 'object' && 'id' in value) report.entry(String(value.id), 'default');
    },
  },
};

function fieldsRefs(block: BlockInstance, report: RefReporter): void {
  const model = parseFields(block);
  const byId = new Map(model.elements.map((el) => [el.id, el]));
  for (const [id, html] of Object.entries(model.slots)) {
    const element = byId.get(id);
    const slot = element && ELEMENT_REFS[element.kind]?.slot;
    if (slot) slot(block, element, model, report);
    else report.markup(html);
  }
  report.icon(model.icon);
  for (const element of model.elements) ELEMENT_REFS[element.kind]?.prefill?.(element, report);
  // A broken block keeps what its markup and JSON name, so nothing it holds goes unseen.
  if (model.broken) {
    report.markup(block.html);
    report.imagesIn(block.attrs[BLOCK_ATTR.config], 'default');
  }
}

const SLOT_RE = /\bdata-block-slot="el:([^"]{1,200})"[^<>]*>([\s\S]*?)<\/dd>/gi;

/** The block without the picture in its image fields and texts; a drawing part keeps its pictures (they are the drawing). */
function fieldsWithoutImage(block: BlockInstance, file: string): BlockInstance {
  if (!block.html.includes(file)) return block;
  const drawings = new Set(parseFields(block).elements.filter(isSigilElement).map((el) => el.id));
  const slots = new Set<string>();
  for (const [, id, inner] of block.html.matchAll(SLOT_RE)) {
    if (inner.includes(file) && !drawings.has(decodeHtmlAttr(id))) slots.add(id);
  }
  return withoutElementContent(block, slots);
}

/**
 * The fields block: user-built blocks, single fields, and — until the sigil
 * becomes one block (#182) — a sigil's calculator and charge. A copy points
 * its charges at the copied parts; a charge covering a block that was
 * duplicated covers the copy too, so a loaded sigil stays loaded.
 */
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
  listInfo: fieldsListInfo,
  // The readable fallback (`<dl>`) is what there is to find.
  searchText: (block) => htmlPlainText(block.html),
  refs: fieldsRefs,
  withoutImage: fieldsWithoutImage,
  copy: (block, { ids }) => withMappedChargeTargets(block, (target) => copiedBlockRef(target, ids)),
  siblingCopied: withChargesCoveringCopy,
};
