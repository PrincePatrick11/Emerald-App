import type { ComponentType } from 'react';
import type { BlockAttrName, BlockInstance } from '../../lib/blocks/types';
import { FIELDS_BLOCK_TYPE } from '../../lib/blocks/fields';
import FieldsSidebarEdit from './FieldsSidebarEdit';

/**
 * Settings that a block type brings into the right sidebar: one
 * read and one edit variant, like the properties panels. The
 * block management shows them below the row of a selected block whose
 * type is listed here. Lookup goes via the
 * resolved type (`resolveBlockType`): a block with too new a data format
 * gets an edit view here just as little as in the stack.
 *
 * The text block registers nothing: title and visibility apply to every
 * block and are in the management list. The field block brings its
 * settings along (labels, options, display rules).
 *
 * Import rule: only `BlockSidebarArea` imports this file, and it must not
 * pull in anything that loads TipTap, since the sidebar is loaded eagerly.
 */
export interface BlockSidebarReadProps {
  block: BlockInstance;
}

export interface BlockSidebarEditProps extends BlockSidebarReadProps {
  /**
   * Set an instance attribute; goes through the stack, Cancel rolls it
   * back. Only the edit variant gets write access: a change
   * in read mode would end up in no autosave and be swallowed by the next
   * cancel baseline.
   */
  setAttr: (name: BlockAttrName, value: string | null) => void;
  /** Replace the whole block (attributes and inner HTML), for types whose fallback travels along. */
  update: (next: BlockInstance) => void;
}

export interface BlockSidebarViews {
  Read?: ComponentType<BlockSidebarReadProps>;
  Edit?: ComponentType<BlockSidebarEditProps>;
}

export const BLOCK_SIDEBAR_VIEWS: ReadonlyMap<string, BlockSidebarViews> = new Map<string, BlockSidebarViews>([
  [FIELDS_BLOCK_TYPE, { Edit: FieldsSidebarEdit }],
]);
