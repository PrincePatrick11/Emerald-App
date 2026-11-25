import type { ComponentType } from 'react';
import { TEXT_BLOCK_TYPE, type BlockInstance } from '../../lib/blocks/types';
import { FIELDS_BLOCK_TYPE } from '../../lib/blocks/fields';
import { SIGIL_BLOCK_TYPE } from '../../lib/blocks/sigil';
import type { BlockContext } from '../../lib/blocks/blockType';
import type { EntryEffects } from '../../lib/blocks/blockTypes';
import { ALTAR_BLOCK_TYPE, CANVAS_BLOCK_TYPE } from '../../lib/blocks/canvas';
import { PAINT_BLOCK_TYPE } from '../../lib/blocks/paint';
import TextBlock from './TextBlock';
import CanvasBlock from './CanvasBlock';
import PaintBlock from './PaintBlock';
import FieldsBlock from './FieldsBlock';
import SigilBlock from './SigilBlock';

/**
 * Which component renders a block type: the component part of the
 * registry (the metadata is in `lib/blocks/blockTypes.ts`).
 *
 * Import rule: only `BlockStack` (and later the blocks view) import
 * this file. The text block pulls in TipTap, and that must not come along via the eagerly
 * loaded sidebar.
 */
export interface BlockViewProps {
  /**
   * The block. For the text block `block.html` is an INITIAL VALUE: after the first
   * keystroke the live state exists only in the stack's ref; the
   * editor reads it once and manages it itself afterwards. Other types are
   * controlled and read the block on every render.
   */
  block: BlockInstance;
  isEditing: boolean;
  /** Text block: new inner HTML, into the ref only, no re-render per keystroke. */
  onHtmlChange: (html: string) => void;
  /** Edit mode: replace the whole block (structural change, re-renders). */
  onBlockChange: (next: BlockInstance) => void;
  /**
   * Read mode: write a permitted change (tick a checklist, yes/no, charge a
   * sigil) into the entry immediately. Absent if the entry does not allow it.
   */
  onPersist?: (next: BlockInstance) => void;
  /** What the blocks do to the entry (interface 6): locked, and which blocks and parts are locked or concealed. */
  effects: EntryEffects;
  /** Where the block is: its entry and the entry's date (toolkit, `blockContext`). */
  context: BlockContext;
}

export const BLOCK_VIEWS: ReadonlyMap<string, ComponentType<BlockViewProps>> = new Map<string, ComponentType<BlockViewProps>>([
  [TEXT_BLOCK_TYPE, TextBlock],
  [FIELDS_BLOCK_TYPE, FieldsBlock],
  [CANVAS_BLOCK_TYPE, CanvasBlock],
  [ALTAR_BLOCK_TYPE, CanvasBlock],
  [PAINT_BLOCK_TYPE, PaintBlock],
  [SIGIL_BLOCK_TYPE, SigilBlock],
]);
