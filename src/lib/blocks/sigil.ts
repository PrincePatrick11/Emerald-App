import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { neutralizeSectionTags, parseBlocks, serializeBlocks } from './blockHtml';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, isSigilElement, SIGIL_CALC_ELEMENT_ID, SIGIL_CHARGE_ELEMENT_ID, parseFields, withElementValue, withoutElementContent,
  type ElementDef, type FieldsModel, type SigilElement, type SigilElementKind,
} from './fields';
import { createSigilDrawingBlock, isSigilDrawing, PAINT_BLOCK_TYPE } from './paint';
import { readBlockData, withBlockData } from './blockJson';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * A sigil: calculator, drawing, charge.
 * - Calculator (field kind `sigilCalc`): intention, letter bank, implemented letters.
 * - Drawing: a paint block marked as a sigil drawing (`isSigilDrawing`), or
 *   the drawing part of a custom block (field kind `sigilCanvas`) — the
 *   paint document of `lib/blocks/paint.ts` either way.
 * - Charge (field kind `sigilCharge`): loaded, target date, charging technique
 *   (as a link chip in the markup), what "loaded" locks and which calculators
 *   and drawings it conceals.
 *
 * Calculator and charge are always elements of a fields block — on their own a
 * fields block with that one element, as every single field is. A part is
 * read as a virtual block with the ID `<block ID>:<element ID>` and the field
 * kind as its type (`sigilUnits`); a sigil drawing block is a unit of its own.
 * Loading, concealing and locking do not distinguish where a unit sits.
 *
 * The state of the entry — locked, which blocks are concealed — results
 * from the charges (`sigilState`), not from the "Sigils" category.
 *
 * Pure and DOM-free like the rest of `lib/blocks`: the migration uses it.
 */

/** The virtual block types of the parts: the field kinds themselves. */
export const SIGIL_CALC_KIND = 'sigilCalc' satisfies SigilElementKind;
export const SIGIL_CANVAS_KIND = 'sigilCanvas' satisfies SigilElementKind;
export const SIGIL_CHARGE_KIND = 'sigilCharge' satisfies SigilElementKind;

// A sigil part appears in the config JSON of a field block. Deliberately only
// the kind name, without quotes: those are entity-encoded in the attribute, and
// imported content may encode them differently (`&#34;`, single
// quotes) — a pre-filter that is too narrow would let concealed parts through.
const SIGIL_ELEMENT_MARKERS = [SIGIL_CALC_KIND, SIGIL_CANVAS_KIND, SIGIL_CHARGE_KIND];

/** Can the content carry a sigil (part or sigil drawing)? The pre-filter before parsing. */
export function mayHoldSigil(content: string): boolean {
  return SIGIL_ELEMENT_MARKERS.some((m) => content.includes(m))
    || (content.includes(PAINT_BLOCK_TYPE) && content.includes('sigil'));
}

/** Can the content carry a charge? Without a charge nothing is concealed or locked. */
function mayHoldCharge(content: string): boolean {
  return content.includes(SIGIL_CHARGE_KIND);
}

/**
 * Is a unit of `sigilUnits` a drawing (a sigil drawing block or a drawing part)?
 * Only for the type of a unit: a plain paint block is never one, `sigilUnits` leaves it out.
 */
export function isDrawingUnitType(type: string): boolean {
  return type === SIGIL_CANVAS_KIND || type === PAINT_BLOCK_TYPE;
}

/** Calculator and drawing — what a loaded sigil conceals and locks. For the type of a unit (`sigilUnits`). */
export function isSigilToolType(type: string): boolean {
  return type === SIGIL_CALC_KIND || isDrawingUnitType(type);
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
  const { broken, data } = readBlockData(block);
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
  return withBlockData(block, { intention: calc.intention, letters: calc.letters, implemented: calc.implemented }, intention + letters);
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
  const { broken, data } = readBlockData(block);
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
  return withBlockData(block, data, date + technique);
}

/** Does the charge currently conceal: loaded, and the target date has not been reached (or there is none). */
export function chargeConceals(charge: Pick<SigilCharge, 'loaded' | 'revealDate'>, today: string): boolean {
  return charge.loaded && (!charge.revealDate || charge.revealDate > today);
}

/** Does this charge conceal the calculator or drawing with this ID? */
export function chargeCovers(charge: Pick<SigilCharge, 'targets'>, blockId: string): boolean {
  return charge.targets === null || charge.targets.includes(blockId);
}

/* ---------------- Parts ---------------- */

/** The ID under which a part is tracked as a sigil — also the target that a charge stores. */
export function sigilPartId(blockId: string, elementId: string): string {
  return `${blockId}:${elementId}`;
}

/** The part as a virtual block: the field kind as its type, its value as data JSON, its slot as inner HTML. */
export function sigilPartBlock(
  block: BlockInstance,
  element: SigilElement,
  model: FieldsModel,
): BlockInstance {
  const value = model.values[element.id];
  return {
    id: sigilPartId(block.id, element.id),
    type: element.kind,
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

/** A sigil of the entry: a sigil drawing block, or the part of a fields block (then with element and field block). */
export interface SigilUnit {
  block: BlockInstance;
  part?: { parent: BlockInstance; element: ElementDef };
}

/**
 * All sigils of the entry in stack order: sigil drawing blocks, and parts as virtual blocks.
 * Archived calculators and drawings count — their content is still in the
 * block and must stay concealed; an archived charge does not, it could
 * no longer be unloaded anywhere.
 */
export function sigilUnits(blocks: readonly BlockInstance[]): SigilUnit[] {
  const units: SigilUnit[] = [];
  for (const block of blocks) {
    if (isSigilDrawing(block)) {
      units.push({ block });
      continue;
    }
    if (block.type !== FIELDS_BLOCK_TYPE) continue;
    const model = parseFields(block);
    if (model.broken) continue;
    for (const element of model.elements) {
      if (!isSigilElement(element) || (element.archived && element.kind === 'sigilCharge')) continue;
      units.push({ block: sigilPartBlock(block, element, model), part: { parent: block, element } });
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
 * Rewrite the targets of every charge in the block (the charge parts of a
 * fields block). `map` receives each target (block ID or
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

/** Every charge part of the block with the targets `rewrite` returns; `null` leaves a charge as it is. */
function withChargesRewritten(block: BlockInstance, rewrite: (charge: SigilCharge) => string[] | null): BlockInstance {
  let result = block;
  for (const unit of sigilUnits([block])) {
    if (!unit.part || unit.block.type !== SIGIL_CHARGE_KIND) continue;
    const charge = parseSigilCharge(unit.block);
    if (charge.broken) continue;
    const targets = rewrite(charge);
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
    .filter((b) => b.type === SIGIL_CHARGE_KIND)
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

/**
 * The attributes of a fields block holding this one sigil part, as every
 * single field is. As the sigil always did, read mode shows it even empty and
 * under its title (`FieldsBlock` then shows the part without a label row).
 * The converter of the old sigil blocks writes the same.
 */
export function sigilFieldAttrs(kind: SigilElementKind, elementId: string): Record<string, string> {
  const element: ElementDef = { id: elementId, kind, label: '' };
  return {
    [BLOCK_ATTR.config]: JSON.stringify({ elements: [element], display: { ...DEFAULT_DISPLAY, readHideEmpty: false } }),
    [BLOCK_ATTR.showTitle]: '1',
  };
}

function sigilFieldBlock(kind: SigilElementKind, elementId: string): BlockInstance {
  return { id: generateId(), type: FIELDS_BLOCK_TYPE, html: '', attrs: sigilFieldAttrs(kind, elementId) };
}

export function createSigilCalcBlock(): BlockInstance {
  return sigilFieldBlock(SIGIL_CALC_KIND, SIGIL_CALC_ELEMENT_ID);
}

/** The drawing of a sigil set — a sigil drawing block; named alongside the calculator and the charge. */
export function createSigilCanvasBlock(): BlockInstance {
  return createSigilDrawingBlock();
}

export function createSigilChargeBlock(): BlockInstance {
  return sigilFieldBlock(SIGIL_CHARGE_KIND, SIGIL_CHARGE_ELEMENT_ID);
}

/** The sigil set: calculator, drawing, charge — the default layout of the "Sigils" category. */
export function sigilBlockSet(): BlockInstance[] {
  return [createSigilCalcBlock(), createSigilCanvasBlock(), createSigilChargeBlock()];
}
