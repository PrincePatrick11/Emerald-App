import { CalendarClock, SlidersHorizontal } from 'lucide-react';
import { decodeHtmlAttr } from '../../internalLinkHtml';
import { isBlockHidden } from '../blockAttrs';
import type {
  BlockFieldValue, BlockPropertyRow, BlockTypeDef, BlockValues, BlockProperties,
} from '../blockType';
import {
  FIELDS_BLOCK_TYPE, isSigilElement, parseFields, withoutElementContent, type ElementDef, type ElementKind, type FieldsModel,
} from '../fields';
import type { ListInfoPart, ListInfoProvider } from '../listInfo';
import { htmlPlainText } from '../plainText';
import { chargeTargetDate, sigilPartBlock, SIGIL_CHARGE_KIND, withChargesCoveringCopy, withMappedChargeTargets } from '../sigil';
import { blockTypeTextKey, copiedBlockRef, type RefReporter } from '../toolkit';
import { BLOCK_ATTR, type BlockInstance } from '../types';
import { reportDrawing } from './paint';

/**
 * What a kind of field points at beyond its slot's markup — the fields
 * block's own knowledge about its kinds, as `ELEMENT_OUTSIDE` is for what it
 * shows outside. A kind not listed reports the link chips and pictures of its
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

/**
 * What a kind of field shows of itself outside the block — in the info line
 * of lists, as rows of the properties panel, as values to filter and sort
 * by: the fields block's own knowledge about its kinds, handed on through
 * its interfaces. The kind's name is the cheap pre-check's marker.
 * (Until the sigil becomes one block, #182, the charge speaks from here.)
 */
interface ElementOutside {
  /** The info line also when its block is hidden (`ListInfoProvider.evenWhenHidden`). */
  infoWhenHidden?: boolean;
  info?: (block: BlockInstance, element: ElementDef, model: FieldsModel) => ListInfoPart[];
  rows?: (block: BlockInstance, element: ElementDef, model: FieldsModel) => BlockPropertyRow[];
  values?: (block: BlockInstance, element: ElementDef, model: FieldsModel) => BlockFieldValue[];
}

const TARGET_DATE = { key: 'sigil.targetDate', labelKey: 'creation.targetDate', icon: CalendarClock } as const;

/**
 * A charge's target date with its rank — for the info line and the values
 * alike, so both pick the same charge: of several the first loaded one
 * speaks, otherwise the first; a loaded one without a date therefore shows
 * none, even if another has one.
 */
function rankedTargetDate(block: BlockInstance, element: ElementDef, model: FieldsModel) {
  const target = chargeTargetDate(block, element, model);
  if (!target) return null;
  return { rank: target.loaded ? 0 : 1, value: target.iso ? { kind: 'date' as const, iso: target.iso } : null };
}

const ELEMENT_OUTSIDE: Partial<Record<ElementKind, ElementOutside>> = {
  [SIGIL_CHARGE_KIND]: {
    // A hidden sigil keeps showing its target date — the date matters most then.
    infoWhenHidden: true,
    info: (block, element, model) => {
      const ranked = rankedTargetDate(block, element, model);
      return ranked ? [{ ...TARGET_DATE, ...ranked }] : [];
    },
    rows: (block, element, model) => {
      const iso = chargeTargetDate(block, element, model)?.iso;
      return iso ? [{ ...TARGET_DATE, key: `${TARGET_DATE.key}:${element.id}`, value: { kind: 'date', iso } }] : [];
    },
    values: (block, element, model) => {
      const ranked = rankedTargetDate(block, element, model);
      return ranked ? [{ key: TARGET_DATE.key, labelKey: TARGET_DATE.labelKey, ...ranked, filter: true, sort: true }] : [];
    },
  },
};

// Bare kind names, as `mayHoldSigil` does: quotes are encoded differently depending on the source.
const OUTSIDE_MARKERS = Object.keys(ELEMENT_OUTSIDE);
const hasOutsideKind = (content: string) => OUTSIDE_MARKERS.some((m) => content.includes(m));

/** Each live field's contribution of one kind; archived fields say nothing. */
function fromElements<T>(
  block: BlockInstance,
  pick: (outside: ElementOutside, hidden: boolean) => ((block: BlockInstance, element: ElementDef, model: FieldsModel) => T[]) | undefined,
): T[] {
  const model = parseFields(block);
  if (model.broken) return [];
  const hidden = isBlockHidden(block);
  return model.elements.flatMap((element) => {
    const outside = ELEMENT_OUTSIDE[element.kind];
    const read = !element.archived && outside ? pick(outside, hidden) : undefined;
    return read ? read(block, element, model) : [];
  });
}

const fieldsListInfo: ListInfoProvider = {
  mayContribute: hasOutsideKind,
  // Asked always; whether a hidden block speaks is each kind's own `infoWhenHidden`.
  evenWhenHidden: true,
  parts: (block) => fromElements(block, (o, hidden) => (hidden && !o.infoWhenHidden ? undefined : o.info)),
};

const fieldsProperties: BlockProperties = {
  mayContribute: hasOutsideKind,
  rows: (block) => fromElements(block, (o) => o.rows),
  overridable: { icon: true, cover: true },
};

const fieldsValues: BlockValues = {
  mayContribute: hasOutsideKind,
  read: (block) => fromElements(block, (o) => o.values),
};

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
  properties: fieldsProperties,
  values: fieldsValues,
  // The readable fallback (`<dl>`) is what there is to find.
  searchText: (block) => htmlPlainText(block.html),
  refs: fieldsRefs,
  withoutImage: fieldsWithoutImage,
  copy: (block, { ids }) => withMappedChargeTargets(block, (target) => copiedBlockRef(target, ids)),
  siblingCopied: withChargesCoveringCopy,
};
