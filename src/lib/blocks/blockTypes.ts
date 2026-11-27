import type { BlockActionDef, BlockCopyContext, BlockInstanceName, BlockPreset, BlockSettingDef, BlockTypeDef, ReadContext } from './blockType';
import { blockDataVersion, withDataVersion, type RefReporter } from './toolkit';
import type { BlockInstance } from './types';
import { localIsoDay } from '../helpers';
import { isBlockHidden } from './blockAttrs';
import { textBlockType } from './kinds/text';
import { fieldsBlockType } from './kinds/fields';
import { altarBlockType, canvasBlockType } from './kinds/canvas';
import { paintBlockType } from './kinds/paint';
import { sigilBlockType } from './kinds/sigil';
import { moonBlockType } from './kinds/moon';

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
 * must also cover a block this version cannot read (`UNREADABLE_BLOCK`) —
 * or, for what only a readable type has, `resolveBlockType(block)`
 * (`entryProperties.ts`, `entrySummary.ts`).
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

for (const def of [textBlockType, fieldsBlockType, canvasBlockType, paintBlockType, altarBlockType, sigilBlockType, moonBlockType]) registerBlockType(def);

/** What "Add block" offers of all types, in the order they were registered (`BlockTypeDef.presets`). */
export function blockTypePresets(): BlockPreset[] {
  return [...BLOCK_TYPES.values()].flatMap((def) => def.presets ?? []);
}

/* ---------------- 13 Readable or not ---------------- */

/**
 * Whether this app can read a block — one rule for every type, with no
 * knowledge of any:
 * - `readable`: a registered type, at or below its data version, its data
 *   intact;
 * - `newer`: a type this app does not know (from a newer version or an
 *   extension), or a known one in a data format above its version — the
 *   upward direction; the downward one is `upgrade`;
 * - `broken`: a known type whose stored data cannot be read (`isBroken`).
 *
 * An unreadable block shows only a notice (`UnreadableBlock`), is not found
 * by the search, goes into no export as content and is saved as it is; once
 * an app that can read it opens it, it is back as it was.
 */
export type BlockReadState = 'readable' | 'newer' | 'broken';

/** The text key of what an unreadable block says, by why — in the stack and the export alike. */
export const UNREADABLE_NOTICE = { newer: 'blocks.unreadable.newer', broken: 'blocks.unreadable.broken' } as const;

// Blocks are values: a changed block is a new object, so the answer per object holds.
const readStates = new WeakMap<BlockInstance, BlockReadState>();

export function blockReadState(block: BlockInstance): BlockReadState {
  const cached = readStates.get(block);
  if (cached) return cached;
  const def = BLOCK_TYPES.get(block.type);
  const state: BlockReadState = !def || blockDataVersion(block) > def.dataVersion ? 'newer'
    : def.isBroken?.(block) ? 'broken'
    : 'readable';
  readStates.set(block, state);
  return state;
}

/**
 * The type through which the app reads and renders this block — `undefined`
 * if it cannot read it (`blockReadState`). Every interface is asked through it.
 */
export function resolveBlockType(block: BlockInstance): BlockTypeDef | undefined {
  return blockReadState(block) === 'readable' ? BLOCK_TYPES.get(block.type) : undefined;
}

/**
 * The registered type of a block whether or not it can be read — for what it
 * is called and its icon (an unreadable sigil is still named "Sigil"), and for
 * rules that go by the stored type as the database does (`blockCountsLinks`).
 */
export function registeredBlockType(block: BlockInstance): BlockTypeDef | undefined {
  return BLOCK_TYPES.get(block.type);
}

/**
 * How a block this version cannot read behaves in the readers that must
 * cover every block: it finds nothing in the search (its markup may hold
 * what its type conceals), and its references keep whatever it names —
 * chips as links, every stored picture in its markup or attributes as
 * `default`, so "Images" neither lists a picture as its own nor takes one out
 * of a block that is saved unchanged. Not a type one can register or insert.
 */
type BlockReaders = Pick<BlockTypeDef, 'refs' | 'searchText' | 'withoutImage' | 'properties'>;

const UNREADABLE_BLOCK: BlockReaders = {
  refs: (block: BlockInstance, report: RefReporter) => {
    report.links(block.html);
    report.imagesIn(block.html, 'default');
    for (const value of Object.values(block.attrs)) report.imagesIn(value, 'default');
  },
};

/** The interfaces to ask about a block: its type's, or those of a block this version cannot read. */
export function blockInterfaces(block: BlockInstance): BlockReaders {
  return resolveBlockType(block) ?? UNREADABLE_BLOCK;
}

/**
 * Whether a block's links count as the entry's linked entries — one rule for
 * "Linked entries", the export's link lists and "include linked entries"
 * (`typesLinkingWhenHidden` in SQL). Shown: always. Hidden (the eye): only
 * where its registered type allows it (`BlockTypeDef.linksWhenHidden`),
 * readable or not, as the database goes by the stored type. What a block this
 * version cannot read links to comes from what it stores (`UNREADABLE_BLOCK.refs`).
 */
export function blockCountsLinks(block: BlockInstance): boolean {
  return !isBlockHidden(block) || registeredBlockType(block)?.linksWhenHidden === true;
}

/** The types whose hidden blocks still count their links — the same rule in SQL (`linkedEntriesOf`), by the stored type. */
export function typesLinkingWhenHidden(): string[] {
  return [...BLOCK_TYPES.values()].filter((def) => def.linksWhenHidden).map((def) => def.id);
}

/** What one block is called (its own title aside) and its icon: what the type says of this block (`properties.name`), else nothing. */
export function blockInstanceName(block: BlockInstance): BlockInstanceName {
  return resolveBlockType(block)?.properties?.name?.(block) ?? {};
}

/* ---------------- 15 Text editors ---------------- */

/** The keys of the text editors a block holds (`textEditors`): `''` is the block itself. */
export function blockTextEditors(block: BlockInstance): string[] {
  return resolveBlockType(block)?.textEditors?.(block) ?? [];
}

/** The block without its link to `target` (`withoutLink`); the same block if its type has none or it holds none. */
export function blockWithoutLink(block: BlockInstance, target: string, t: (key: string) => string): BlockInstance {
  return resolveBlockType(block)?.withoutLink?.(block, target, t) ?? block;
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
  /** Why, as the first locking block words it (`lockReasonKey`); `null` without a lock or a reason. */
  lockReasonKey: string | null;
  /** Block (or part) IDs that cannot be edited. */
  locked: ReadonlySet<string>;
  /** Block (or part) IDs concealed — in both modes, in the search and the export — until a day, or (`null`) until lifted. */
  concealed: ReadonlyMap<string, string | null>;
}

export const NO_EFFECTS: EntryEffects = { lockEntry: false, lockedBy: new Set(), lockReasonKey: null, locked: new Set(), concealed: new Map() };

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
  let lockReasonKey: string | null = null;
  const locked = new Set<string>();
  const concealed = new Map<string, string | null>();
  for (const block of blocks) {
    const read = resolveBlockType(block)?.entryEffect?.read;
    if (!read) continue;
    const effect = read(block, blocks, ctx);
    if (effect.lockEntry) {
      lockedBy.add(block.id);
      lockReasonKey ??= effect.lockReasonKey ?? null;
    }
    for (const id of effect.locked ?? []) locked.add(id);
    for (const [id, until] of effect.concealed ?? []) {
      concealed.set(id, concealed.has(id) ? laterReveal(concealed.get(id)!, until) : until);
    }
  }
  return lockedBy.size > 0 || locked.size > 0 || concealed.size > 0
    ? { lockEntry: lockedBy.size > 0, lockedBy, lockReasonKey, locked, concealed }
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
 * The text the search finds in a block — its type's `searchText`; none if
 * the type has no text or the block cannot be read here.
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
