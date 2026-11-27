import { isBlockHidden } from './blockAttrs';
import type { BlockContext, BlockPropertyRow } from './blockType';
import { resolveBlockType } from './blockTypes';
import type { BlockInstance } from './types';

/**
 * What the blocks add to an entry's properties (`BlockTypeDef.properties`,
 * interface 3), folded with the entry's own values and its category's:
 * **the user before the block before the category** — unless the block's
 * type says its value is not to be overridden, then the block's stands.
 * Each value says where it comes from, so the panel can mark a suggested
 * one as the block's.
 *
 * Two halves: `blockSuggestions` reads the blocks (cached per entry with
 * the rest of what lists want, `entryBlockSummary`), `resolveProperty`
 * folds one suggestion with the user's and the category's value.
 *
 * The tags a block gives are not folded in here: they are references
 * (`block_refs`, kind `tag`) and come with the entry (`Entry.block_tags`).
 */

export type PropertySource = 'user' | 'block' | 'category';

export interface SourcedValue {
  value: string;
  source: PropertySource;
  /** The block that suggested it (`source: 'block'`). */
  blockId?: string;
}

/** A value a block suggests for a fixed property. */
export interface Suggestion {
  value: string;
  blockId: string;
  /** May the user's own value take its place? */
  overridable: boolean;
}

/** A row a block adds, with the block it comes from. */
export type SourcedPropertyRow = BlockPropertyRow & { blockId: string };

/** What the visible blocks of an entry suggest and add. */
export interface BlockSuggestions {
  icon: Suggestion | null;
  cover: Suggestion | null;
  /** The rows the blocks add, in stack order. */
  rows: readonly SourcedPropertyRow[];
}

export const NO_SUGGESTIONS: BlockSuggestions = { icon: null, cover: null, rows: [] };

/**
 * User, block, category — a block value that may not be overridden first of all.
 * `null` without any of them.
 */
export function resolveProperty(
  user: string | null | undefined,
  block: Suggestion | null,
  category: string | null | undefined,
): SourcedValue | null {
  if (block && !block.overridable) return { value: block.value, source: 'block', blockId: block.blockId };
  if (user) return { value: user, source: 'user' };
  if (block) return { value: block.value, source: 'block', blockId: block.blockId };
  return category ? { value: category, source: 'category' } : null;
}

/**
 * What the visible blocks suggest. The first block (in stack order) that
 * suggests an icon or a cover is the one asked; a hidden block suggests
 * nothing and adds no rows.
 */
export function blockSuggestions(blocks: readonly BlockInstance[], ctx: BlockContext): BlockSuggestions {
  let icon: Suggestion | null = null;
  let cover: Suggestion | null = null;
  const rows: SourcedPropertyRow[] = [];
  for (const block of blocks) {
    const properties = resolveBlockType(block)?.properties;
    if (!properties || isBlockHidden(block)) continue;
    if (!icon) {
      const value = properties.icon?.(block, ctx);
      if (value) icon = { value, blockId: block.id, overridable: properties.overridable.icon };
    }
    if (!cover) {
      const value = properties.cover?.(block, ctx);
      if (value) cover = { value, blockId: block.id, overridable: properties.overridable.cover };
    }
    for (const row of properties.rows?.(block, ctx) ?? []) rows.push({ ...row, blockId: block.id });
  }
  return icon || cover || rows.length ? { icon, cover, rows } : NO_SUGGESTIONS;
}
