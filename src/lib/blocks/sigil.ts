import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { decodeHtmlAttr, neutralizeSectionTags, parseBlocks, serializeBlocks } from './blockHtml';
import {
  FIELDS_BLOCK_TYPE, isSigilKind, parseFields, withElementValue, withoutElementContent,
  type ElementDef, type FieldsModel, type SigilElementKind,
} from './fields';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';
import { paintDocFromImage, paintDocFromJson, paintDocToJson, type PaintDoc } from '../paint/document';

/**
 * The three sigil blocks (since v42; previously a separate view with its own
 * columns on `operations`):
 * - Calculator (`core.sigil.calc`): intention, letter bank, implemented letters.
 * - Drawing (`core.sigil.canvas`): the canvas editor's paint document as data
 *   JSON, its rendered image and layer images as `<img src="{sha}.png">` in the
 *   inner HTML so that the image cleanup sees them (`parseSigilDrawing`).
 * - Charge (`core.sigil.charge`): loaded, target date, charging technique (as a
 *   link chip in the markup), what "loaded" locks and which calculators and
 *   drawings it conceals.
 *
 * The state of the entry — locked, which blocks are concealed — results
 * from the charges (`sigilState`), no longer from the "Sigils"
 * category.
 *
 * The same three exist as parts of a custom block (field kinds
 * `sigilCalc`/`sigilCanvas`/`sigilCharge`). A part here is a virtual
 * block with the ID `<block ID>:<element ID>` (`sigilUnits`) — loading, concealing
 * and locking do not distinguish whether a sigil is a block or a part.
 *
 * Pure and DOM-free like the rest of `lib/blocks`: the migration uses it.
 */

export const SIGIL_CALC_TYPE = 'core.sigil.calc' satisfies BlockTypeId;
export const SIGIL_CANVAS_TYPE = 'core.sigil.canvas' satisfies BlockTypeId;
export const SIGIL_CHARGE_TYPE = 'core.sigil.charge' satisfies BlockTypeId;

/** Appears in the content as soon as it carries a sigil block — the cheap pre-filter before parsing. */
export const SIGIL_BLOCK_MARKER = 'data-block="core.sigil.';

// A sigil part appears in the config JSON of a field block. Deliberately only
// the kind name, without quotes: those are entity-encoded in the attribute, and
// imported content may encode them differently (`&#34;`, single
// quotes) — a pre-filter that is too narrow would let concealed parts through.
const SIGIL_ELEMENT_MARKERS = ['sigilCalc', 'sigilCanvas', 'sigilCharge'];

/** Can the content carry a sigil (block or part)? The pre-filter before parsing. */
export function mayHoldSigil(content: string): boolean {
  return content.includes('core.sigil.') || SIGIL_ELEMENT_MARKERS.some((m) => content.includes(m));
}

/** Can the content carry a charge? Without a charge nothing is concealed or locked. */
function mayHoldCharge(content: string): boolean {
  return content.includes(SIGIL_CHARGE_TYPE) || content.includes('sigilCharge');
}

/** Calculator and drawing — what a loaded sigil conceals and locks. */
export function isSigilToolType(type: string): boolean {
  return type === SIGIL_CALC_TYPE || type === SIGIL_CANVAS_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON data of a block. Unreadable input sets `broken` — such a block is never overwritten. */
function readData(block: BlockInstance): { broken: boolean; data: Record<string, unknown> } {
  const raw = block.attrs[BLOCK_ATTR.data];
  if (raw === undefined) return { broken: false, data: {} };
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? { broken: false, data: value } : { broken: true, data: {} };
  } catch {
    return { broken: true, data: {} };
  }
}

function withData(block: BlockInstance, data: Record<string, unknown>, html: string): BlockInstance {
  return { ...block, html, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify(data) } };
}

/* ---------------- Date and text ---------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/** Today's date as `YYYY-MM-DD`, local — that is how it compares with the target date. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Plain text as paragraphs, one line per `<p>`, escaped. */
export function textParagraphs(text: string): string {
  return text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

/* ---------------- Calculator ---------------- */

export interface SigilCalc {
  broken: boolean;
  intention: string;
  /** The letter bank: each letter once, in order of first appearance. */
  letters: string[];
  /** Those of them already implemented in the drawing. */
  implemented: string[];
}

/**
 * A letter list from a foreign source: only short strings, at most
 * 500. The limit protects against doctored imports — a bank of
 * hundreds of thousands of entries would otherwise cripple migration and rendering.
 */
export function letterList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((l): l is string => typeof l === 'string' && l.length > 0 && l.length <= 8).slice(0, 500)
    : [];
}

/** Each letter once, uppercased, without accents — as the sigil view always did. */
export function extractUniqueLetters(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const char of input.normalize('NFKD').toUpperCase()) {
    if (!/\p{L}/u.test(char) || seen.has(char)) continue;
    seen.add(char);
    result.push(char);
  }
  return result;
}

/** Only what is also in the bank. */
export function implementedIn(letters: readonly string[], implemented: readonly string[]): string[] {
  const bank = new Set(letters);
  return implemented.filter((l) => bank.has(l));
}

export function parseSigilCalc(block: BlockInstance): SigilCalc {
  const { broken, data } = readData(block);
  const letters = letterList(data.letters);
  return {
    broken,
    intention: typeof data.intention === 'string' ? data.intention : '',
    letters,
    implemented: implementedIn(letters, letterList(data.implemented)),
  };
}

/** The calculator with new data; the inner HTML is the readable fallback (intention, letters). */
export function serializeSigilCalc(block: BlockInstance, calc: Omit<SigilCalc, 'broken'>): BlockInstance {
  const done = new Set(calc.implemented);
  const intention = calc.intention.trim() ? textParagraphs(calc.intention) : '';
  const letters = calc.letters.length
    ? `<p>${calc.letters.map((l) => (done.has(l) ? `<s>${escapeHtml(l)}</s>` : escapeHtml(l))).join(' ')}</p>`
    : '';
  return withData(block, { intention: calc.intention, letters: calc.letters, implemented: calc.implemented }, intention + letters);
}

/* ---------------- Drawing ---------------- */

/** The file name of the drawing — or `null`. */
export function sigilImage(block: BlockInstance): string | null {
  const src = /\bsrc="([^"]*)"/i.exec(block.html)?.[1];
  return src ? decodeHtmlAttr(src) : null;
}

export function withSigilImage(block: BlockInstance, filename: string | null): BlockInstance {
  return { ...block, html: filename ? `<img src="${escapeHtml(filename)}" alt="">` : '' };
}

/** Marks the drawing's rendered image; a layer's image carries its layer ID instead. */
const PAINT_RENDER = 'render';
// Bounded like TECHNIQUE_RE below: it runs over foreign markup.
const IMG_RE = /<img\b[^<>]{0,2048}>/gi;
const PAINT_ATTR_RE = /\bdata-paint="([^"]*)"/i;

export interface SigilDrawing {
  /** The rendered image — what read mode, the card and the export show. */
  render: string | null;
  /** The vector document, with the old image as a layer where there was no document yet. */
  doc: PaintDoc | null;
}

/**
 * The drawing of a block. The vector document is its data JSON; the inner
 * HTML holds the rendered image first (`data-paint="render"`), then the image
 * of every layer that has one (`data-paint="<layer ID>"`), so that backups,
 * exports and the image cleanup find them as they find every other image.
 *
 * A drawing without a document (from before the vector format), or one whose
 * rendered image is no longer marked as such (something else replaced it),
 * becomes a document with that image as its only layer: nothing it shows is lost.
 */
export function parseSigilDrawing(block: BlockInstance): SigilDrawing {
  const images = new Map<string, string>();
  let render: string | null = null;
  let marked = false;
  for (const [tag] of block.html.matchAll(IMG_RE)) {
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
    if (!src) continue;
    const role = PAINT_ATTR_RE.exec(tag)?.[1];
    if (render === null) {
      render = decodeHtmlAttr(src);
      marked = role === PAINT_RENDER;
    } else if (role && role !== PAINT_RENDER) {
      images.set(decodeHtmlAttr(role), decodeHtmlAttr(src));
    }
  }
  const { broken, data } = readData(block);
  const doc = marked && !broken ? paintDocFromJson(data, images) : null;
  if (doc) return { render, doc };
  return { render, doc: render ? paintDocFromImage(render) : null };
}

/** The drawing with a new rendered image and document; `null` for both empties it. */
export function withSigilDrawing(block: BlockInstance, render: string | null, doc: PaintDoc | null): BlockInstance {
  if (!render || !doc) {
    const attrs = { ...block.attrs };
    delete attrs[BLOCK_ATTR.data];
    return { ...block, html: '', attrs };
  }
  const layerImages = doc.layers
    .filter((l) => l.image)
    .map((l) => `<img src="${escapeHtml(l.image!)}" alt="" data-paint="${escapeHtml(l.id)}">`)
    .join('');
  return withData(block, paintDocToJson(doc), `<img src="${escapeHtml(render)}" alt="" data-paint="${PAINT_RENDER}">${layerImages}`);
}

/* ---------------- Charge ---------------- */

/** What a loaded sigil locks: the whole entry (as before) or only the concealed calculators and drawings. */
export type SigilLockScope = 'entry' | 'sigil';

export interface SigilCharge {
  broken: boolean;
  loaded: boolean;
  /** `YYYY-MM-DD`; until then a loaded sigil stays concealed. Without a date: until unloaded. */
  revealDate: string | null;
  lock: SigilLockScope;
  /** Inner HTML of the charging technique slot (a link chip) — or `null`. */
  technique: string | null;
  /**
   * The block IDs of the calculators and drawings that this charge conceals —
   * `null` means all in the entry, including ones added later (that is how
   * every charge behaved before one could choose).
   */
  targets: string[] | null;
}

// A block ID, or `<block ID>:<element ID>` for the part of a custom block.
const TARGET_ID_RE = /^[\w-]{1,64}(?::[\w-]{1,64})?$/;

/** Block IDs from a foreign source: only short, harmless strings, at most 100. */
function targetList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === 'string' && TARGET_ID_RE.test(id));
  return [...new Set(ids)].slice(0, 100);
}

// The attribute sections are bounded: unbounded, the regex would run quadratically on
// doctored markup ("<p " hundreds of thousands of times) — and it runs for every card.
const TECHNIQUE_RE = /<p\b[^<>]{0,256}?\bdata-block-slot="technique"[^<>]{0,256}>([\s\S]*?)<\/p>/i;

export function parseSigilCharge(block: BlockInstance): SigilCharge {
  const { broken, data } = readData(block);
  const technique = TECHNIQUE_RE.exec(block.html)?.[1];
  return {
    broken,
    loaded: data.loaded === true,
    revealDate: isIsoDate(data.revealDate) ? data.revealDate : null,
    lock: data.lock === 'sigil' ? 'sigil' : 'entry',
    technique: technique?.trim() ? technique : null,
    targets: targetList(data.targets),
  };
}

export function serializeSigilCharge(block: BlockInstance, charge: Omit<SigilCharge, 'broken'>): BlockInstance {
  const date = charge.revealDate ? `<p>${escapeHtml(charge.revealDate)}</p>` : '';
  // Defused like editor HTML: a `<section` in the chip must not nest the block format.
  const technique = charge.technique ? `<p data-block-slot="technique">${neutralizeSectionTags(charge.technique)}</p>` : '';
  const data: Record<string, unknown> = { loaded: charge.loaded, revealDate: charge.revealDate, lock: charge.lock };
  if (charge.targets) data.targets = charge.targets;
  return withData(block, data, date + technique);
}

/** Does the charge currently conceal: loaded, and the target date has not been reached (or there is none). */
export function chargeConceals(charge: Pick<SigilCharge, 'loaded' | 'revealDate'>, today: string): boolean {
  return charge.loaded && (!charge.revealDate || charge.revealDate > today);
}

/** Does this charge conceal the calculator or drawing with this ID? */
export function chargeCovers(charge: Pick<SigilCharge, 'targets'>, blockId: string): boolean {
  return charge.targets === null || charge.targets.includes(blockId);
}

/* ---------------- Parts of custom blocks ---------------- */

const KIND_TYPES: Record<SigilElementKind, string> = {
  sigilCalc: SIGIL_CALC_TYPE,
  sigilCanvas: SIGIL_CANVAS_TYPE,
  sigilCharge: SIGIL_CHARGE_TYPE,
};

/** The ID under which a part is tracked as a sigil — also the target that a charge stores. */
export function sigilPartId(blockId: string, elementId: string): string {
  return `${blockId}:${elementId}`;
}

/** The part as a virtual block: its value as data JSON, its slot as inner HTML. */
export function sigilPartBlock(
  block: BlockInstance,
  element: ElementDef & { kind: SigilElementKind },
  model: FieldsModel,
): BlockInstance {
  const value = model.values[element.id];
  return {
    id: sigilPartId(block.id, element.id),
    type: KIND_TYPES[element.kind],
    html: model.slots[element.id] ?? '',
    attrs: value !== undefined ? { [BLOCK_ATTR.data]: JSON.stringify(value) } : {},
  };
}

/** Back into the model: data JSON as value, inner HTML as slot (empty = no slot). */
export function withSigilPart(model: FieldsModel, element: ElementDef, part: BlockInstance): FieldsModel {
  const values = { ...model.values };
  const slots = { ...model.slots };
  const raw = part.attrs[BLOCK_ATTR.data];
  // Without data JSON the value goes too: an emptied drawing drops its document.
  if (raw !== undefined) values[element.id] = JSON.parse(raw) as Record<string, unknown>;
  else delete values[element.id];
  if (part.html) slots[element.id] = part.html;
  else delete slots[element.id];
  return { ...model, values, slots };
}

/** A sigil of the entry: a block, or the part of a custom block (then with element and field block). */
export interface SigilUnit {
  block: BlockInstance;
  part?: { parent: BlockInstance; element: ElementDef };
}

/**
 * All sigils of the entry in stack order, parts as virtual blocks.
 * Archived calculators and drawings count — their content is still in the
 * block and must stay concealed; an archived charge does not, it could
 * no longer be unloaded anywhere.
 */
export function sigilUnits(blocks: readonly BlockInstance[]): SigilUnit[] {
  const units: SigilUnit[] = [];
  for (const block of blocks) {
    if (block.type.startsWith('core.sigil.')) {
      units.push({ block });
      continue;
    }
    if (block.type !== FIELDS_BLOCK_TYPE) continue;
    const model = parseFields(block);
    if (model.broken) continue;
    for (const element of model.elements) {
      if (!isSigilKind(element.kind) || (element.archived && element.kind === 'sigilCharge')) continue;
      units.push({ block: sigilPartBlock(block, { ...element, kind: element.kind }, model), part: { parent: block, element } });
    }
  }
  return units;
}

/* ---------------- State of the entry ---------------- */

export interface SigilState {
  /** The target date of the first loaded charge, otherwise of the first — what the card in the list shows. */
  revealDate: string | null;
  /** A loaded charge with the "whole entry" lock: no editing, no change from read mode. */
  lockEntry: boolean;
  /**
   * The concealed calculators and drawings — block ID → the date until which
   * they stay concealed (`null`: until unloaded). Concealed while editing too,
   * otherwise "Edit" (lock "sigil only") would show them prematurely.
   */
  concealed: ReadonlyMap<string, string | null>;
  /** Calculators and drawings that a loaded charge makes read-only even while editing. */
  locked: ReadonlySet<string>;
}

/**
 * Rewrite the targets of every charge in the block — a charge block itself or
 * the charge parts of a field block. `map` receives each target (block ID or
 * `<block ID>:<element ID>`) and returns the new one, or several; if none
 * changes, the charge is left untouched.
 */
export function withMappedChargeTargets(block: BlockInstance, map: (target: string) => string | readonly string[]): BlockInstance {
  return withChargesRewritten(block, (charge) => {
    if (!charge.targets) return null;
    const before = charge.targets;
    const targets = before.flatMap(map);
    return targets.length !== before.length || targets.some((id, i) => id !== before[i]) ? targets : null;
  });
}

/**
 * Blocks that join an entry which already has content (a template appended):
 * a charge covering "every sigil in the entry" (`targets: null`) covers only
 * the calculators and drawings among these blocks — it would otherwise
 * conceal what the entry already held.
 */
export function withChargesCoveringOnly(blocks: readonly BlockInstance[]): BlockInstance[] {
  const tools = sigilUnits(blocks).filter(({ block }) => isSigilToolType(block.type)).map(({ block }) => block.id);
  return blocks.map((block) => withChargesRewritten(block, (charge) => (charge.targets ? null : tools)));
}

/** Every charge in the block — a charge block itself or the charge parts of a field block — with the targets `rewrite` returns; `null` leaves a charge as it is. */
function withChargesRewritten(block: BlockInstance, rewrite: (charge: SigilCharge) => string[] | null): BlockInstance {
  const targetsOf = (charge: SigilCharge) => (charge.broken ? null : rewrite(charge));
  if (block.type === SIGIL_CHARGE_TYPE) {
    const charge = parseSigilCharge(block);
    const targets = targetsOf(charge);
    return targets ? serializeSigilCharge(block, { ...charge, targets }) : block;
  }
  let result = block;
  for (const unit of sigilUnits([block])) {
    if (!unit.part || unit.block.type !== SIGIL_CHARGE_TYPE) continue;
    const charge = parseSigilCharge(unit.block);
    const targets = targetsOf(charge);
    if (!targets) continue;
    const next = serializeSigilCharge(unit.block, { ...charge, targets });
    result = withElementValue(result, unit.part.element.id, JSON.parse(next.attrs[BLOCK_ATTR.data]));
  }
  return result;
}

/**
 * A duplicated field block: the charge parts of the copy target the parts
 * of the copy, no longer those of the original — otherwise loading the
 * copy would conceal the original and leave its own parts open.
 */
export function withRenamedPartTargets(block: BlockInstance, oldId: string, newId: string): BlockInstance {
  const from = `${oldId}:`;
  return withMappedChargeTargets(block, (id) => (id.startsWith(from) ? `${newId}:${id.slice(from.length)}` : id));
}

/**
 * A block was duplicated: a charge in `block` that conceals the original (or
 * parts of it) also conceals the copy. A loaded sigil stays loaded
 * when duplicated — and the copy does not show what the original conceals.
 */
export function withChargesCoveringCopy(block: BlockInstance, oldId: string, newId: string): BlockInstance {
  const from = `${oldId}:`;
  return withMappedChargeTargets(block, (id) => {
    if (id === oldId) return [id, newId];
    return id.startsWith(from) ? [id, `${newId}:${id.slice(from.length)}`] : id;
  });
}

const NO_SIGIL: SigilState = { revealDate: null, lockEntry: false, concealed: new Map(), locked: new Set() };

/** Of two charges that conceal the same block, the longer one applies — "until unloaded" is the longest. */
function laterReveal(a: string | null, b: string | null): string | null {
  return a === null || b === null ? null : a > b ? a : b;
}

/**
 * The state that the charges give the entry — blocks and parts alike.
 * Each loaded charge acts on the calculators and drawings that it
 * conceals; unreadable ones do not count.
 */
export function sigilState(blocks: readonly BlockInstance[], today: string): SigilState {
  const units = sigilUnits(blocks).map((u) => u.block);
  const charges = units
    .filter((b) => b.type === SIGIL_CHARGE_TYPE)
    .map(parseSigilCharge)
    .filter((c) => !c.broken);
  if (charges.length === 0) return NO_SIGIL;

  const concealed = new Map<string, string | null>();
  const locked = new Set<string>();
  let lockEntry = false;
  for (const charge of charges) {
    if (!charge.loaded) continue;
    if (charge.lock === 'entry') lockEntry = true;
    const hides = chargeConceals(charge, today);
    for (const block of units) {
      if (!isSigilToolType(block.type) || !chargeCovers(charge, block.id)) continue;
      locked.add(block.id);
      if (!hides) continue;
      concealed.set(block.id, concealed.has(block.id)
        ? laterReveal(concealed.get(block.id)!, charge.revealDate)
        : charge.revealDate);
    }
  }
  const shown = charges.find((c) => c.loaded) ?? charges[0];
  return { revealDate: shown.revealDate, lockEntry, concealed, locked };
}

/** The element IDs of the concealed parts of this field block. */
function concealedParts(block: BlockInstance, concealed: ReadonlyMap<string, string | null>): Set<string> {
  const prefix = `${block.id}:`;
  const ids = new Set<string>();
  for (const id of concealed.keys()) if (id.startsWith(prefix)) ids.add(id.slice(prefix.length));
  return ids;
}

/**
 * A field block without value and slot of its concealed parts — for every place
 * that shows its stored HTML instead of reading it (unknown type, format
 * too new, export of the fallback).
 */
export function withoutConcealedParts(block: BlockInstance, concealed: ReadonlyMap<string, string | null>): BlockInstance {
  return block.type === FIELDS_BLOCK_TYPE ? withoutElementContent(block, concealedParts(block, concealed)) : block;
}

/** The content without the concealed calculators and drawings (blocks and parts) — for search and export. */
export function withoutConcealed(content: string, today: string): string {
  if (!mayHoldCharge(content)) return content;
  const blocks = parseBlocks(content);
  const { concealed } = sigilState(blocks, today);
  if (concealed.size === 0) return content;
  return serializeBlocks(blocks.filter((b) => !concealed.has(b.id)).map((b) => withoutConcealedParts(b, concealed)));
}

/* ---------------- New ---------------- */

function emptyBlock(type: string): BlockInstance {
  return { id: generateId(), type, html: '', attrs: {} };
}

export function createSigilCalcBlock(): BlockInstance {
  return serializeSigilCalc(emptyBlock(SIGIL_CALC_TYPE), { intention: '', letters: [], implemented: [] });
}

export function createSigilCanvasBlock(): BlockInstance {
  return emptyBlock(SIGIL_CANVAS_TYPE);
}

export function createSigilChargeBlock(): BlockInstance {
  return serializeSigilCharge(emptyBlock(SIGIL_CHARGE_TYPE), {
    loaded: false, revealDate: null, lock: 'entry', technique: null, targets: null,
  });
}

/** The sigil set: calculator, drawing, charge — the default layout of the "Sigils" category. */
export function sigilBlockSet(): BlockInstance[] {
  return [createSigilCalcBlock(), createSigilCanvasBlock(), createSigilChargeBlock()];
}
