import { useCallback, useContext, useEffect, useRef } from 'react';
import { blockStorageTag } from '../../lib/blocks/blockTypes';
import type { BlockInstance } from '../../lib/blocks/types';
import { fileBaseName, storeImageFromPath } from '../../lib/storeImage';
import { useImageStore } from '../../store/imageStore';
import { useTagStore } from '../../store/tagStore';
import { BlockStackContext, type BlockActionHandler } from './blockStackContext';

/**
 * The toolkit's component half (the pure half is `lib/blocks/toolkit.ts`):
 * what a block view uses instead of building it — storing a picture safely
 * in the vault, binding it to the type's tag, carrying out its actions.
 */

/**
 * A picture from the disk into the vault and into "Images", under its file
 * name and with `tags`: checked and converted as every picture is
 * (`storeImageFromPath`), stored under its content's name. Returns the stored name.
 */
export async function storeBlockPicture(path: string, tags: readonly string[] = []): Promise<string> {
  const file = await storeImageFromPath(path);
  await useImageStore.getState().takeIn(file, { name: fileBaseName(path), tags: [...tags] });
  return file;
}

/**
 * The tag the block's type keeps its pictures under (`BlockTypeDef.storage`)
 * — its ID, and `ensure`, which makes the tag in this vault if it is not there
 * yet (with the type's name for it) and returns its ID. `null` for a type
 * without storage.
 */
export function useBlockStorage(block: BlockInstance): { tagId: string; ensure: () => Promise<string> } | null {
  const tag = blockStorageTag(block);
  const tagId = tag?.id ?? '';
  const name = tag?.name ?? '';
  // Made before the early return: a hook may not be skipped. Only called with a tag.
  const ensure = useCallback(async () => (await useTagStore.getState().ensureTag(name, tagId)).id, [tagId, name]);
  return tag ? { tagId, ensure } : null;
}

/**
 * How the view carries out one of its type's actions: offered in the block's
 * menu while editing and, if the type allows, in the "Actions" section of the
 * properties panel while reading. The latest `handler` is called.
 */
export function useBlockAction(blockId: string, actionId: string, handler: BlockActionHandler): void {
  const stack = useContext(BlockStackContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => stack?.registerAction(blockId, actionId, () => latest.current()), [stack, blockId, actionId]);
}
