import type { TFunction } from 'i18next';
import { generateId } from '../helpers';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { translatedOr } from './blockAttrs';
import { readBlockData } from './blockJson';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, serializeFields, SIGIL_CALC_ELEMENT_ID, SIGIL_CHARGE_ELEMENT_ID, type ElementDef, type FallbackText, type FieldsModel, type SigilElementKind,
} from './fields';
import { PAINT_BLOCK_TYPE, SIGIL_DRAWING_ATTRS } from './paint';
import { sigilFieldAttrs, sigilPartId, withMappedChargeTargets } from './sigil';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * The sigil blocks of v42 to v63 and their conversion (v64) — the only place
 * that still knows their types.
 *
 * Up to v63 a sigil was three block types of its own: calculator
 * (`core.sigil.calc`), drawing (`core.sigil.canvas`) and charge
 * (`core.sigil.charge`). Since v64 they are what a custom block's sigil parts
 * always were, so there is one form instead of two:
 * - calculator and charge: a fields block with one element of that kind,
 *   under the same block ID (`sigilFieldAttrs`); the element's value is the old
 *   data JSON, its slot the old inner HTML;
 * - drawing: a paint block marked as a sigil drawing (`SIGIL_DRAWING_ATTRS`),
 *   the same paint document and HTML under the same block ID.
 *
 * Charge targets follow: a calculator `X` becomes the part `X:calc`, a drawing
 * keeps its ID, `null` stays "every calculator and drawing of the entry",
 * which covers the same blocks afterwards. A target naming no calculator of
 * the same content stays as it is.
 *
 * A calculator or charge with unreadable data JSON, or any block with a data
 * version this app does not know, is left as it is: the app shows it as an
 * unknown block, as it did. A drawing with unreadable data is converted anyway.
 *
 * Pure and DOM-free, so the imports (`.emerald`), the drafts and
 * `npm run check:blocks` share it; v64 and the backup import run it over the
 * database through `convertLegacySigilsInPlace` (`migrateLegacySigils.ts`).
 */

export const LEGACY_SIGIL_CALC_TYPE = 'core.sigil.calc';
export const LEGACY_SIGIL_CANVAS_TYPE = 'core.sigil.canvas';
export const LEGACY_SIGIL_CHARGE_TYPE = 'core.sigil.charge';

/** In the content as soon as it carries an old sigil block — the cheap pre-filter. */
export const LEGACY_SIGIL_MARKER = 'core.sigil.';

/** Does the content (still) carry old sigil blocks? */
export function hasLegacySigilBlocks(content: string): boolean {
  return content.includes(LEGACY_SIGIL_MARKER);
}

/** An old sigil block, empty — only the legacy row conversion (`migrateLegacySigils.ts`) still builds them. */
export function legacySigilBlock(type: string): BlockInstance {
  return { id: generateId(), type, html: '', attrs: {} };
}

/** The fallback label of the converted fields block — the caller passes the translated ones. */
export interface LegacySigilLabels {
  calc: string;
  charge: string;
}

const ENGLISH: LegacySigilLabels = { calc: 'Sigil calculator', charge: 'Charge' };

/** The labels in the current language — they stay in the content, so English if i18n is not ready. */
export function legacySigilLabels(t: TFunction): LegacySigilLabels {
  return {
    calc: translatedOr(t, 'blocks.kinds.sigilCalc', ENGLISH.calc),
    charge: translatedOr(t, 'blocks.kinds.sigilCharge', ENGLISH.charge),
  };
}

interface ElementSpec {
  kind: SigilElementKind;
  id: string;
  label: keyof LegacySigilLabels;
}

// A Map: the type comes from stored content, and an object would answer
// `constructor` or `__proto__` with its prototype.
const ELEMENTS = new Map<string, ElementSpec>([
  [LEGACY_SIGIL_CALC_TYPE, { kind: 'sigilCalc', id: SIGIL_CALC_ELEMENT_ID, label: 'calc' }],
  [LEGACY_SIGIL_CHARGE_TYPE, { kind: 'sigilCharge', id: SIGIL_CHARGE_ELEMENT_ID, label: 'charge' }],
]);

/** Can this app read the block's format? A newer data version stays untouched. */
function isVersionOne(block: BlockInstance): boolean {
  const version = block.attrs[BLOCK_ATTR.version];
  return version === undefined || Number(version) === 1;
}

/** The instance attributes that travel along: hidden, title, show title and whatever else a newer app put there. */
function instanceAttrs(block: BlockInstance): Record<string, string> {
  const attrs = { ...block.attrs };
  delete attrs[BLOCK_ATTR.data];
  delete attrs[BLOCK_ATTR.config];
  delete attrs[BLOCK_ATTR.version];
  return attrs;
}

function toFieldsBlock(block: BlockInstance, spec: ElementSpec, labels: LegacySigilLabels): BlockInstance | null {
  const { broken, data } = readBlockData(block);
  if (broken || !isVersionOne(block)) return null;
  const element: ElementDef = { id: spec.id, kind: spec.kind, label: '' };
  const model: FieldsModel = {
    broken: false,
    elements: [element],
    display: { ...DEFAULT_DISPLAY, readHideEmpty: false },
    values: block.attrs[BLOCK_ATTR.data] !== undefined ? { [spec.id]: data } : {},
    orphans: {},
    slots: block.html ? { [spec.id]: block.html } : {},
    name: '',
    icon: '',
  };
  const text: FallbackText = { label: () => labels[spec.label], yes: '', no: '', moonName: () => '' };
  // The instance's own attributes win over the defaults — a title switched off stays off.
  const base = { ...block, type: FIELDS_BLOCK_TYPE, attrs: { ...sigilFieldAttrs(spec.kind, spec.id), ...instanceAttrs(block) } };
  return serializeFields(base, model, text);
}

// Unlike calculator and charge, a drawing with unreadable data is converted too:
// left as it was it would no longer be a sigil, and a charge would stop concealing
// it. The paint block reads such data as no document and shows the picture.
function toSigilDrawing(block: BlockInstance): BlockInstance | null {
  if (!isVersionOne(block)) return null;
  const attrs: Record<string, string> = { ...SIGIL_DRAWING_ATTRS, ...instanceAttrs(block), [BLOCK_ATTR.config]: SIGIL_DRAWING_ATTRS[BLOCK_ATTR.config] };
  if (block.attrs[BLOCK_ATTR.data] !== undefined) attrs[BLOCK_ATTR.data] = block.attrs[BLOCK_ATTR.data];
  return { id: block.id, type: PAINT_BLOCK_TYPE, html: block.html, attrs };
}

/** The blocks with every old sigil block converted and the charge targets following; the same array if there is none. */
export function convertLegacySigilBlocks(blocks: readonly BlockInstance[], labels: LegacySigilLabels = ENGLISH): readonly BlockInstance[] {
  if (!blocks.some((b) => b.type.startsWith(LEGACY_SIGIL_MARKER))) return blocks;
  const calcs = new Set<string>();
  const converted = blocks.map((block) => {
    const spec = ELEMENTS.get(block.type);
    let next: BlockInstance | null = null;
    if (block.type === LEGACY_SIGIL_CANVAS_TYPE) next = toSigilDrawing(block);
    else if (spec) next = toFieldsBlock(block, spec, labels);
    if (next && block.type === LEGACY_SIGIL_CALC_TYPE) calcs.add(block.id);
    return next ?? block;
  });
  if (calcs.size === 0) return converted;
  return converted.map((block) => withMappedChargeTargets(
    block,
    (target) => (calcs.has(target) ? sigilPartId(target, SIGIL_CALC_ELEMENT_ID) : target),
  ));
}

/** The content with its old sigil blocks converted; unchanged (the same string) without any. */
export function contentWithoutLegacySigils(content: string, labels?: LegacySigilLabels): string {
  if (!hasLegacySigilBlocks(content)) return content;
  const blocks = parseBlocks(content);
  const converted = convertLegacySigilBlocks(blocks, labels);
  return converted === blocks ? content : serializeBlocks([...converted]);
}
