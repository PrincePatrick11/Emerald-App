import { SlidersHorizontal } from 'lucide-react';
import { decodeHtmlAttr } from '../../internalLinkHtml';
import type { BlockTypeDef } from '../blockType';
import { FIELDS_BLOCK_TYPE, parseFields, withoutElementContent, type ElementDef, type ElementKind } from '../fields';
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
  refs: fieldsRefs,
  withoutImage: fieldsWithoutImage,
};
