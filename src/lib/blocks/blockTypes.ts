import type { BlockActionDef, BlockCopyContext, BlockProperties, BlockSettingDef, BlockTypeDef } from './blockType';
import type { ListInfoProvider } from './listInfo';
import { htmlPlainText } from './plainText';
import { blockDataVersion, withDataVersion, withoutImageInMarkup, type RefReporter } from './toolkit';
import { BLOCK_ATTR, type BlockInstance } from './types';
import { textBlockType } from './kinds/text';
import { fieldsBlockType } from './kinds/fields';
import { altarBlockType, canvasBlockType } from './kinds/canvas';
import { paintBlockType } from './kinds/paint';

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
 * readable type has, `resolveBlockType(block)` (`entryProperties.ts`).
 */

// A Map instead of an object: the type comes from stored content, and
// `BLOCK_TYPES['constructor']` would otherwise find the prototype.
const BLOCK_TYPES = new Map<string, BlockTypeDef>();
/** `listInfoProviders()`, made once per state of the registry: lists ask it for every entry. */
let providers: ListInfoProvider[] | null = null;

/** Adds a type. Built-in ones register below; the ID must be new. */
export function registerBlockType(def: BlockTypeDef): void {
  if (BLOCK_TYPES.has(def.id)) throw new Error(`block type ${def.id} is already registered`);
  BLOCK_TYPES.set(def.id, def);
  providers = null;
}

for (const def of [textBlockType, fieldsBlockType, canvasBlockType, paintBlockType, altarBlockType]) registerBlockType(def);

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

/** What every block type adds to the info line in lists — for the summary's pre-check. */
export function listInfoProviders(): readonly ListInfoProvider[] {
  providers ??= [...BLOCK_TYPES.values()].flatMap((def) => def.listInfo ?? []);
  return providers;
}

/** What every type adds to the entry's properties — for the pre-check of `entryProperties`. */
export function propertyProviders(): BlockProperties[] {
  return [...BLOCK_TYPES.values()].flatMap((def) => def.properties ?? []);
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
export function blockSearchText(block: BlockInstance): string {
  return blockInterfaces(block).searchText?.(block) ?? '';
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

/**
 * The stack with a copy of one block right after it: the copy under `newId`,
 * and every other block told (`siblingCopied`), so a charge covering the
 * original covers the copy too.
 */
export function withDuplicatedBlock(blocks: readonly BlockInstance[], sourceId: string, newId: string): BlockInstance[] {
  const index = blocks.findIndex((b) => b.id === sourceId);
  if (index < 0) return [...blocks];
  const source = blocks[index];
  const next = blocks.map((b) => (b.id === sourceId ? b : resolveBlockType(b)?.siblingCopied?.(b, sourceId, newId) ?? b));
  next.splice(index + 1, 0, copiedBlock({ ...source, id: newId, attrs: { ...source.attrs } }, { ids: new Map([[sourceId, newId]]) }));
  return next;
}
