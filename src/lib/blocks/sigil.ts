import { decodeHtmlAttr, escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { neutralizeSectionTags } from './blockHtml';
import { readBlockData, withBlockData } from './blockJson';
import type { BlockEntryEffect, BlockSettingDef } from './blockType';
import { parseSigilCalc } from './sigilCalc';
import { readBlockSettings } from './toolkit';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * The sigil block (`core.sigil`): calculator, drawing and charge as the
 * parts of one block, each switched on or off in the block's settings
 * (`SIGIL_SETTINGS`, interface 14).
 *
 * - Calculator: intention, letter bank, implemented letters (`sigilCalc.ts`).
 * - Drawing: the paint document of `lib/blocks/paint.ts`.
 * - Charge: loaded, target date, charging technique (a link chip), and what
 *   "loaded" locks — the whole entry or only this sigil.
 *
 * A loaded charge acts on the entry through the block's effect (interface
 * 6, `sigilEffect`): it locks calculator and drawing of its own block, and
 * conceals them until the target date (or, without one, until unloaded); with
 * the lock "whole entry" the entry cannot be edited. What concealed means for
 * search and export the block's other interfaces say (`kinds/sigil.ts`).
 *
 * Where things are — as for every block: each part keeps its data JSON under
 * its name in the block's data JSON, and its markup (the readable version of
 * the calculator, the drawing's pictures, the technique's chip) in a slot of
 * the inner HTML, `<div data-sigil-part="…">`. Each part is read and written
 * as a block of its own (`sigilPartBlock`, `withSigilPart`), under the ID
 * `<block ID>:<part>` — the ID the effect locks and conceals. A part switched
 * off keeps what it holds.
 *
 * Pure and DOM-free like the rest of `lib/blocks`.
 */

export const SIGIL_BLOCK_TYPE = 'core.sigil' satisfies BlockTypeId;

export const SIGIL_PARTS = ['calc', 'drawing', 'charge'] as const;
export type SigilPartName = (typeof SIGIL_PARTS)[number];

/** The parts as the block's settings: one switch each, all on to start with. */
export const SIGIL_SETTINGS: readonly BlockSettingDef[] = SIGIL_PARTS.map((part) => ({
  key: part,
  labelKey: `blocks.types.sigil.parts.${part}`,
  kind: 'toggle',
  initial: true,
}));

/** The ID under which a part is locked and concealed. */
export function sigilPartId(blockId: string, part: SigilPartName): string {
  return `${blockId}:${part}`;
}

/* ---------------- The block's model ---------------- */

interface SigilModel {
  /** The data JSON is unreadable. */
  broken: boolean;
  data: Record<string, unknown>;
  slots: Partial<Record<SigilPartName, string>>;
}

// Only the opening tag is a regex, with bounded attribute sections; its end is
// found with one `indexOf`. Matching up to `</div>` in the regex itself would
// take quadratic time on foreign markup with opening tags and no closing one.
// A slot never holds a `</div>` — escaped text, `<img>` tags and a link chip.
const SLOT_OPEN_RE = /<div\b[^<>]{0,256}?\bdata-sigil-part="([^"]{1,32})"[^<>]{0,256}>/gi;

/**
 * The inner markup of each element `open` matches, up to the first `close`
 * after it — in linear time: without a closing tag after this point there is
 * none after any later one either.
 */
function* taggedSlots(html: string, open: RegExp, close: string): Generator<[string, string]> {
  const lower = html.toLowerCase();
  const re = new RegExp(open.source, 'gi');
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const end = lower.indexOf(close, re.lastIndex);
    if (end < 0) return;
    yield [m[1] ?? '', html.slice(re.lastIndex, end)];
    re.lastIndex = end + close.length;
  }
}

const modelCache = new WeakMap<BlockInstance, SigilModel>();

function isPartName(name: string): name is SigilPartName {
  return (SIGIL_PARTS as readonly string[]).includes(name);
}

function parseSigil(block: BlockInstance): SigilModel {
  const cached = modelCache.get(block);
  if (cached) return cached;
  const { broken, data } = readBlockData(block);
  const slots: SigilModel['slots'] = {};
  for (const [name, inner] of taggedSlots(block.html, SLOT_OPEN_RE, '</div>')) {
    const part = decodeHtmlAttr(name);
    if (isPartName(part) && inner.trim()) slots[part] = inner;
  }
  const model = { broken, data, slots };
  modelCache.set(block, model);
  return model;
}

/**
 * Is the block's stored data unreadable — its own, or that of its calculator
 * or charge? Then the app cannot read it (`BlockTypeDef.isBroken`): no
 * interface is asked, it is shown as a notice and saved as it is.
 */
export function isSigilBroken(block: BlockInstance): boolean {
  return parseSigil(block).broken
    || parseSigilCalc(sigilPartBlock(block, 'calc')).broken
    || parseSigilCharge(sigilPartBlock(block, 'charge')).broken;
}

/** One part as a block of its own: its data JSON and its slot's markup. */
export function sigilPartBlock(block: BlockInstance, part: SigilPartName): BlockInstance {
  const { data, slots } = parseSigil(block);
  const value = data[part];
  return {
    id: sigilPartId(block.id, part),
    type: `sigil.${part}`,
    html: slots[part] ?? '',
    attrs: value !== undefined ? { [BLOCK_ATTR.data]: JSON.stringify(value) } : {},
  };
}

/** The block with one part written back; without data JSON the part's value goes (an emptied drawing). */
export function withSigilPart(block: BlockInstance, part: SigilPartName, next: BlockInstance): BlockInstance {
  const { data, slots } = parseSigil(block);
  const raw = next.attrs[BLOCK_ATTR.data];
  const nextData = { ...data };
  if (raw !== undefined) nextData[part] = JSON.parse(raw) as unknown;
  else delete nextData[part];
  const nextSlots = { ...slots, [part]: next.html };
  const html = SIGIL_PARTS
    .filter((p) => nextSlots[p])
    // Defused like editor HTML: a `<section` in a slot must not nest the block format.
    .map((p) => `<div data-sigil-part="${p}">${neutralizeSectionTags(nextSlots[p]!)}</div>`)
    .join('');
  return withBlockData(block, nextData, html);
}

/**
 * Which parts the block shows: those switched on — and the charge while it
 * is loaded, whatever its switch says, so a loaded sigil can always be
 * unloaded and its effect never hangs on a part one cannot see.
 */
export function shownSigilParts(block: BlockInstance): Record<SigilPartName, boolean> {
  const settings = readBlockSettings(block, SIGIL_SETTINGS);
  const charge = parseSigilCharge(sigilPartBlock(block, 'charge'));
  return {
    calc: settings.calc === true,
    drawing: settings.drawing === true,
    charge: settings.charge === true || charge.loaded,
  };
}

export function createSigilBlock(): BlockInstance {
  return { id: generateId(), type: SIGIL_BLOCK_TYPE, html: '', attrs: {} };
}

/* ---------------- Charge ---------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/** What a loaded sigil locks: the whole entry, or only its own calculator and drawing. */
export type SigilLockScope = 'entry' | 'sigil';

export interface SigilCharge {
  broken: boolean;
  loaded: boolean;
  /** `YYYY-MM-DD`; until then a loaded sigil stays concealed. Without a date: until unloaded. */
  revealDate: string | null;
  lock: SigilLockScope;
  /** Inner HTML of the charging technique slot (a link chip) — or `null`. */
  technique: string | null;
}

export type SigilChargeData = Omit<SigilCharge, 'broken'>;

// As the slots: the opening tag with bounded attribute sections, its end by `indexOf`
// (it runs for every card, on markup that may come from an import).
const TECHNIQUE_OPEN_RE = /<p\b[^<>]{0,256}?\bdata-block-slot="technique"[^<>]{0,256}>/i;

/** The charge, read from its part block (`sigilPartBlock(block, 'charge')`). */
export function parseSigilCharge(part: BlockInstance): SigilCharge {
  const { broken, data } = readBlockData(part);
  const technique = taggedSlots(part.html, TECHNIQUE_OPEN_RE, '</p>').next().value?.[1];
  return {
    broken,
    loaded: data.loaded === true,
    revealDate: isIsoDate(data.revealDate) ? data.revealDate : null,
    lock: data.lock === 'sigil' ? 'sigil' : 'entry',
    technique: technique?.trim() ? technique : null,
  };
}

export function serializeSigilCharge(part: BlockInstance, charge: SigilChargeData): BlockInstance {
  const date = charge.revealDate ? `<p>${escapeHtml(charge.revealDate)}</p>` : '';
  const technique = charge.technique ? `<p data-block-slot="technique">${neutralizeSectionTags(charge.technique)}</p>` : '';
  return withBlockData(part, { loaded: charge.loaded, revealDate: charge.revealDate, lock: charge.lock }, date + technique);
}

/** Does the charge currently conceal: loaded, and the target date has not been reached (or there is none). */
export function chargeConceals(charge: Pick<SigilCharge, 'loaded' | 'revealDate'>, today: string): boolean {
  return charge.loaded && (!charge.revealDate || charge.revealDate > today);
}

/** The block's charge if it shows one — else `null`. */
function shownCharge(block: BlockInstance): SigilCharge | null {
  return shownSigilParts(block).charge ? parseSigilCharge(sigilPartBlock(block, 'charge')) : null;
}

/**
 * The target date for the info line, the panel and sorting — `null` without a
 * charge; `iso: null` for a charge without a date.
 */
export function sigilTargetDate(block: BlockInstance): { iso: string | null; loaded: boolean } | null {
  const charge = shownCharge(block);
  return charge ? { iso: charge.revealDate, loaded: charge.loaded } : null;
}

/* ---------------- Effect on the entry (6) ---------------- */

/**
 * What the block's charge does to the entry: while loaded it locks the
 * block's calculator and drawing (and, with the lock "whole entry", the
 * entry), and until the target date it conceals them. Asked only of a
 * readable block (`isSigilBroken`).
 */
export function sigilEffect(block: BlockInstance, today: string): BlockEntryEffect {
  const charge = parseSigilCharge(sigilPartBlock(block, 'charge'));
  if (!charge.loaded) return {};
  const tools = [sigilPartId(block.id, 'calc'), sigilPartId(block.id, 'drawing')];
  return {
    lockEntry: charge.lock === 'entry',
    lockReasonKey: 'blocks.types.sigil.locksEntry',
    locked: tools,
    concealed: chargeConceals(charge, today) ? new Map(tools.map((id) => [id, charge.revealDate])) : undefined,
  };
}
