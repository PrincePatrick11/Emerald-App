import { Brush } from 'lucide-react';
import type { BlockTypeDef } from '../blockType';
import { PAINT_BLOCK_TYPE, parseDrawing } from '../paint';
import { blockTypeTextKey, type RefReporter } from '../toolkit';
import type { BlockInstance } from '../types';

/**
 * A drawing's pictures: the rendered one and each layer's. Neither is a
 * picture of its own ("Images" lists neither, and taking a picture out of an
 * entry never touches a drawing) — shared with the sigil's drawing part.
 */
export function reportDrawing(block: BlockInstance, report: RefReporter): void {
  const { render, doc } = parseDrawing(block);
  report.image(render, 'render');
  for (const layer of doc?.layers ?? []) report.image(layer.image, 'layer');
}

/** The paint block: a drawing of its own. No text; keeps its pictures. */
export const paintBlockType: BlockTypeDef = {
  id: PAINT_BLOCK_TYPE,
  origin: 'core',
  icon: Brush,
  labelKey: blockTypeTextKey(PAINT_BLOCK_TYPE, 'label'),
  descriptionKey: blockTypeTextKey(PAINT_BLOCK_TYPE, 'description'),
  group: 'media',
  dataVersion: 1,
  defaultShowTitle: false,
  refs: reportDrawing,
};
