import { parseBlocks } from './blockHtml';
import { blockInterfaces, resolveBlockType } from './blockTypes';
import { RefReporter, type BlockRef } from './toolkit';
import type { BlockInstance } from './types';

/**
 * What a block points at — the one list (`block_refs`) that "Linked
 * entries", "include linked entries" in the export, "Images", the image
 * cleanup and the tags a block gives its entry all read. Rewritten whenever
 * the block is saved (`blockStore.ts`). Each type reports its own
 * (`BlockTypeDef.refs`), the tags from its properties (`properties.tags`);
 * this file only asks, and knows no block type or field kind.
 *
 * Pure: the database path and `scripts/check-blocks.mjs` run it under Node.
 */

export type { BlockRef, BlockRefRole } from './toolkit';

export function blockRefs(block: BlockInstance): BlockRef[] {
  const report = new RefReporter();
  const def = blockInterfaces(block);
  def.refs?.(block, report);
  for (const tag of def.properties?.tags?.(block) ?? []) report.tag(tag);
  return report.refs;
}

/** The tags the blocks of a content give their entry — the same the save writes to `block_refs`. */
export function blockTagsOf(blocks: readonly BlockInstance[]): string[] {
  const tags = new Set<string>();
  for (const block of blocks) {
    // Only types that give tags: the rest would report every link and picture for nothing.
    if (!resolveBlockType(block)?.properties?.tags) continue;
    for (const ref of blockRefs(block)) if (ref.kind === 'tag') tags.add(ref.target);
  }
  return [...tags];
}

/** Is the reference a link the block shows (a chip, a link field) — not a prefill or a picture? */
export function isLinkRef(ref: BlockRef): boolean {
  return ref.kind === 'entry' && ref.role === 'content';
}

/** Does the block link to this entry or task (`isLinkRef`)? */
export function blockLinksTo(block: BlockInstance, id: string): boolean {
  return blockRefs(block).some((ref) => isLinkRef(ref) && ref.target === id);
}

/** The entries and tasks a content links to, in order — what "Linked entries" lists. */
export function linkedIdsOf(content: string): Set<string> {
  const ids = new Set<string>();
  for (const block of parseBlocks(content)) {
    for (const ref of blockRefs(block)) if (isLinkRef(ref)) ids.add(ref.target);
  }
  return ids;
}

/**
 * The block without a picture where it shows it as one of its own — its
 * type's `withoutImage`; a type without one (a drawing) keeps it, as does a
 * known type in a newer format; an unknown type loses it from its markup.
 */
export function blockWithoutImage(block: BlockInstance, file: string): BlockInstance {
  return blockInterfaces(block).withoutImage?.(block, file) ?? block;
}
