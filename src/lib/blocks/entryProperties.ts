import { isBlockHidden } from './blockAttrs';
import { parseBlocks } from './blockHtml';
import type { BlockContext, BlockPropertyRow } from './blockType';
import { propertyProviders, resolveBlockType } from './blockTypes';
import type { BlockInstance } from './types';

/**
 * What the blocks add to an entry's properties (`BlockTypeDef.properties`,
 * interface 3), folded with the entry's own values and its category's:
 * **the user before the block before the category** — unless the block's
 * type says its value is not to be overridden, then the block's stands.
 * Each value says where it comes from, so the panel can show a suggested
 * one as the block's (#181 draws it; this step delivers the values).
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

export interface EntryBlockProperties {
  icon: SourcedValue | null;
  cover: SourcedValue | null;
  /** The rows the blocks add, in stack order. */
  rows: (BlockPropertyRow & { blockId: string })[];
}

interface Suggestion {
  value: string;
  blockId: string;
  overridable: boolean;
}

/** User, block, category — a block value that may not be overridden first of all. */
function decide(user: string | null | undefined, block: Suggestion | null, category: string | null | undefined): SourcedValue | null {
  if (block && !block.overridable) return { value: block.value, source: 'block', blockId: block.blockId };
  if (user) return { value: user, source: 'user' };
  if (block) return { value: block.value, source: 'block', blockId: block.blockId };
  return category ? { value: category, source: 'category' } : null;
}

/** Can any block type say something about this content? The cheap pre-check, as for the info line. */
export function mayHaveBlockProperties(content: string): boolean {
  return propertyProviders().some((properties) => properties.mayContribute(content));
}

/**
 * The entry's properties with what its visible blocks suggest. The first
 * block (in stack order) that suggests an icon or a cover is the one asked;
 * a hidden block suggests nothing.
 */
export function entryProperties(
  entry: { icon?: string | null; cover_image?: string | null },
  blocks: readonly BlockInstance[],
  category: { emoji: string } | null | undefined,
  ctx: BlockContext,
): EntryBlockProperties {
  let icon: Suggestion | null = null;
  let cover: Suggestion | null = null;
  const rows: EntryBlockProperties['rows'] = [];
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
  return {
    icon: decide(entry.icon, icon, category?.emoji),
    cover: decide(entry.cover_image, cover, null),
    rows,
  };
}

/** `entryProperties` from a content, without parsing it when no type can contribute. */
export function entryPropertiesOf(
  entry: { icon?: string | null; cover_image?: string | null; content: string },
  category: { emoji: string } | null | undefined,
  ctx: BlockContext,
): EntryBlockProperties {
  const blocks = mayHaveBlockProperties(entry.content) ? parseBlocks(entry.content) : [];
  return entryProperties(entry, blocks, category, ctx);
}
