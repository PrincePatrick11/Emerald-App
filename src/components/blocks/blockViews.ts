import type { ComponentType } from 'react';
import { TEXT_BLOCK_TYPE, type BlockInstance } from '../../lib/blocks/types';
import { FIELDS_BLOCK_TYPE, type ElementDef } from '../../lib/blocks/fields';
import { SIGIL_CALC_TYPE, SIGIL_CANVAS_TYPE, SIGIL_CHARGE_TYPE, type SigilState } from '../../lib/blocks/sigil';
import { ALTAR_BLOCK_TYPE, CANVAS_BLOCK_TYPE } from '../../lib/blocks/canvas';
import { PAINT_BLOCK_TYPE } from '../../lib/blocks/paint';
import TextBlock from './TextBlock';
import CanvasBlock from './CanvasBlock';
import PaintBlock from './PaintBlock';
import FieldsBlock from './FieldsBlock';
import SigilCalcBlock from './SigilCalcBlock';
import SigilCanvasBlock from './SigilCanvasBlock';
import SigilChargeBlock from './SigilChargeBlock';

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
  /**
   * All blocks of the entry, as of the last structural change, for types
   * that point at other blocks (the charge picks its calculators and
   * drawings). The HTML of text blocks in it may be stale.
   */
  blocks: readonly BlockInstance[];
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
  /** What the charge block gives the entry: locked, concealed (see `sigilState`). */
  sigil: SigilState;
  /**
   * Only for a sigil part of a custom block (`SigilPart`): its
   * element, with the settings from the builder (calculator mode, brush).
   */
  part?: ElementDef;
}

export const BLOCK_VIEWS: ReadonlyMap<string, ComponentType<BlockViewProps>> = new Map<string, ComponentType<BlockViewProps>>([
  [TEXT_BLOCK_TYPE, TextBlock],
  [FIELDS_BLOCK_TYPE, FieldsBlock],
  [SIGIL_CALC_TYPE, SigilCalcBlock],
  [SIGIL_CANVAS_TYPE, SigilCanvasBlock],
  [SIGIL_CHARGE_TYPE, SigilChargeBlock],
  [CANVAS_BLOCK_TYPE, CanvasBlock],
  [ALTAR_BLOCK_TYPE, CanvasBlock],
  [PAINT_BLOCK_TYPE, PaintBlock],
]);
