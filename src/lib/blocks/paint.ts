import { generateId } from '../helpers';
import { SIGIL_CANVAS_TYPE } from './sigil';
import type { BlockInstance, BlockTypeId } from './types';

/**
 * The paint block: a drawing of its own, painted in the canvas editor's
 * paint mode with its layers, brushes and symmetry. It keeps the drawing as
 * the sigil drawing does (`parseSigilDrawing`, `withSigilDrawing` in
 * `sigil.ts`): the vector document as its data, the rendered picture and
 * every layer's picture as stored files in its inner HTML.
 */
export const PAINT_BLOCK_TYPE = 'core.paint' satisfies BlockTypeId;

export function createPaintBlock(): BlockInstance {
  return { id: generateId(), type: PAINT_BLOCK_TYPE, html: '', attrs: {} };
}

/** A block that holds a drawing in that form: the paint block and the sigil drawing. */
export function isDrawingBlockType(type: string): boolean {
  return type === PAINT_BLOCK_TYPE || type === SIGIL_CANVAS_TYPE;
}
