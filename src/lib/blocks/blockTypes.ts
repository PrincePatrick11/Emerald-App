import type { BlockActionDef, BlockCopyContext, BlockSettingDef, BlockTypeDef, ReadContext } from './blockType';
import { htmlPlainText } from './plainText';
import { blockDataVersion, withDataVersion, withoutImageInMarkup, type RefReporter } from './toolkit';
import { BLOCK_ATTR, type BlockInstance } from './types';
import { localIsoDay } from '../helpers';
import { textBlockType } from './kinds/text';
import { fieldsBlockType } from './kinds/fields';
import { altarBlockType, canvasBlockType } from './kinds/canvas';
import { paintBlockType } from './kinds/paint';
import { sigilBlockType } from './kinds/sigil';

export type { BlockGroup, BlockTypeDef } from './blockType';

/**
 * The registry of block types — the pure half: what a type is and the
 * interfaces it brings (`BlockTypeDef`, `blockType.ts`), one file per type
 * under `kinds/`. Which component draws a type is the other half
 * (`components/blocks/blockViews.ts`); the separation keeps TipTap out of
 * everything that only wants to know WHAT a block is (picker, sidebar,
 * export, the database path).
 *
 * Views, lists and stores never switch over block types themselves: they
 * ask through the helpers here — `blockInterfaces` for the readers that
 * must also cover a block this version cannot read (`UNKNOWN_BLOCK`, or
 * `TOO_NEW_BLOCK` for a known type in a newer format) — or, for what only a
 * readable type has, `resolveBlockType(block)` (`entryProperties.ts`, `entrySummary.ts`).
 */

// A Map instead of an object: the type comes from stored content, and
// `BLOCK_TYPES['constructor']` would otherwise find the prototype.
const BLOCK_TYPES = new Map<string, BlockTypeDef>();
/** The pre-checks of `mayShowOutside`, made once per state of the registry: lists ask it for every entry. */
let preChecks: ((content: string) => boolean)[] | null = null;
/** The same for `mayAffectEntry`. */
let effectChecks: ((content: string) => boolean)[] | null = null;

/** Adds a type. Built-in ones register below; the ID must be new. */
export function registerBlockType(def: BlockTypeDef): void {
  if (BLOCK_TYPES.has(def.id)) throw new Error(`block type ${def.id} is already registered`);
  BLOCK_TYPES.set(def.id, def);
  preChecks = null;
  effectChecks = null;
}

for (const def of [textBlockType, fieldsBlockType, canvasBlockType, paintBlockType, altarBlockType, sigilBlockType]) registerBlockType(def);

/**
 * The type with which the app can render this block — or `undefined` for
 * an unknown type or a data format that is too new. Both are shown as a
 * fallback and written back unchanged.
 */
export function resolveBlockType(block: BlockInstance): BlockTypeDef | undefined {
  const def = BLOCK_TYPES.get(block.type);
  return def && blockDataVersion(block) <= def.dataVersion ? def : undefined;
}

/**
 * How a block this version cannot read behaves (an unknown type, or a data
 * format too new): its markup is what it shows — the search reads it, its
 * chips and pictures are its references, a picture named in an attribute is
 * its own — and "Images" may take a picture out of its markup. Not a type
 * one can register or insert; only the readers below fall back to it.
 */
type BlockReaders = Pick<BlockTypeDef, 'refs' | 'searchText' | 'withoutImage' | 'properties'>;

const UNKNOWN_BLOCK: BlockReaders = {
  searchText: (block) => htmlPlainText(block.html),
  refs: (block: BlockInstance, report: RefReporter) => {
    report.markup(block.html);
    for (const [name, value] of Object.entries(block.attrs)) report.imagesIn(value, name === BLOCK_ATTR.data ? 'content' : 'default');
  },
  withoutImage: withoutImageInMarkup,
};

/**
 * How a block of a known type in a format too new for this version behaves:
 * like an unknown one, except that its pictures are kept — they may be its
 * rendered picture or a drawing's layers, which "Images" must neither list as
 * pictures of its own nor take out (it is saved unchanged). Its pictures
 * count as `default`, its links as links.
 */
const TOO_NEW_BLOCK: BlockReaders = {
  searchText: UNKNOWN_BLOCK.searchText,
  refs: (block: BlockInstance, report: RefReporter) => {
    report.links(block.html);
    report.imagesIn(block.html, 'default');
    for (const value of Object.values(block.attrs)) report.imagesIn(value, 'default');
  },
};

/** The interfaces to ask about a block: its type's, or the fallback for one this version cannot read. */
export function blockInterfaces(block: BlockInstance): BlockReaders {
  return resolveBlockType(block) ?? (BLOCK_TYPES.has(block.type) ? TOO_NEW_BLOCK : UNKNOWN_BLOCK);
}

/**
 * Can any block of this content show something outside itself — in the info
 * line (1), the properties (3), the values to filter and sort by (4/9)? The
 * cheap pre-check of `entryBlockSummary`: most entries fail it and are not
 * parsed at all.
 */
export function mayShowOutside(content: string): boolean {
  preChecks ??= [...BLOCK_TYPES.values()].flatMap((def) => [def.listInfo, def.properties, def.values].flatMap((i) => i?.mayContribute ?? []));
  return preChecks.some((check) => check(content));
}

/* ---------------- 6 Effect on the entry ---------------- */

/** What the blocks of an entry do to it together (`entryEffects`). */
export interface EntryEffects {
  /** The entry cannot be edited, nor changed from read mode — except by the blocks in `lockedBy`. */
  lockEntry: boolean;
  /** The blocks that lock the entry: they may still write in read mode, so the lock can be lifted where it was set. */
  lockedBy: ReadonlySet<string>;
  /** Block (or part) IDs that cannot be edited. */
  locked: ReadonlySet<string>;
  /** Block (or part) IDs concealed — in both modes, in the search and the export — until a day, or (`null`) until lifted. */
  concealed: ReadonlyMap<string, string | null>;
}

export const NO_EFFECTS: EntryEffects = { lockEntry: false, lockedBy: new Set(), locked: new Set(), concealed: new Map() };

/** Of two blocks concealing the same thing, the longer one holds — "until lifted" is the longest. */
function laterReveal(a: string | null, b: string | null): string | null {
  return a === null || b === null ? null : a > b ? a : b;
}

/** Can any block of this content act on its entry? The cheap pre-check before parsing. */
export function mayAffectEntry(content: string): boolean {
  effectChecks ??= [...BLOCK_TYPES.values()].flatMap((def) => def.entryEffect?.mayContribute ?? []);
  return effectChecks.some((check) => check(content));
}

/**
 * The effects of all blocks folded into one (interface 6): locked if any
 * locks, each locked or concealed ID once — concealed until the latest day
 * any block names. A hidden block (the eye) acts all the same: hiding it
 * does not unload a sigil.
 */
export function entryEffects(blocks: readonly BlockInstance[], ctx: ReadContext): EntryEffects {
  const lockedBy = new Set<string>();
  const locked = new Set<string>();
  const concealed = new Map<string, string | null>();
  for (const block of blocks) {
    const read = resolveBlockType(block)?.entryEffect?.read;
    if (!read) continue;
    const effect = read(block, blocks, ctx);
    if (effect.lockEntry) lockedBy.add(block.id);
    for (const id of effect.locked ?? []) locked.add(id);
    for (const [id, until] of effect.concealed ?? []) {
      concealed.set(id, concealed.has(id) ? laterReveal(concealed.get(id)!, until) : until);
    }
  }
  return lockedBy.size > 0 || locked.size > 0 || concealed.size > 0
    ? { lockEntry: lockedBy.size > 0, lockedBy, locked, concealed }
    : NO_EFFECTS;
}

/** The settings the block's type describes (none for an unknown type). */
export function blockSettingsOf(block: BlockInstance): readonly BlockSettingDef[] {
  return resolveBlockType(block)?.settings ?? [];
}

/* ---------------- 13 Data version ---------------- */

/** The block brought up to its type's data version (`upgrade`); a current, unknown or too new one stays as it is. */
export function upgradeBlock(block: BlockInstance): BlockInstance {
  const def = resolveBlockType(block);
  const from = blockDataVersion(block);
  if (!def?.upgrade || from >= def.dataVersion) return block;
  return withDataVersion(def.upgrade(block, from), def.dataVersion);
}

/* ---------------- 8 Search ---------------- */

/**
 * The text the search finds in a block — its type's `searchText`, none if
 * the type has no text; an unknown type is read as its markup.
 */
export function blockSearchText(block: BlockInstance, ctx: ReadContext = { today: localIsoDay() }): string {
  return blockInterfaces(block).searchText?.(block, ctx) ?? '';
}

/* ---------------- 7 Storage ---------------- */

/** The tag the block's pictures go under, if its type has one. */
export function blockStorageTag(block: BlockInstance): { id: string; name: string } | null {
  return resolveBlockType(block)?.storage?.tag ?? null;
}

/* ---------------- 10 Actions ---------------- */

/** The commands the block offers now; `reading` leaves out those only meant while editing. */
export function blockActionsOf(block: BlockInstance, { reading }: { reading: boolean }): BlockActionDef[] {
  return (resolveBlockType(block)?.actions ?? []).filter((a) => (!reading || a.inRead) && (a.available?.(block) ?? true));
}

/* ---------------- 12 Copy ---------------- */

/** One block as a copy — it already carries its new ID; `ctx.ids` maps every block copied with it. */
export function copiedBlock(block: BlockInstance, ctx: BlockCopyContext): BlockInstance {
  return resolveBlockType(block)?.copy?.(block, ctx) ?? block;
}

/** The stack with a copy of one block right after it, under `newId`. */
export function withDuplicatedBlock(blocks: readonly BlockInstance[], sourceId: string, newId: string): BlockInstance[] {
  const index = blocks.findIndex((b) => b.id === sourceId);
  if (index < 0) return [...blocks];
  const source = blocks[index];
  const next = [...blocks];
  next.splice(index + 1, 0, copiedBlock({ ...source, id: newId, attrs: { ...source.attrs } }, { ids: new Map([[sourceId, newId]]) }));
  return next;
}
