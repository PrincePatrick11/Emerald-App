import { parseCanvasBackground, type CanvasBackground } from '../editors/canvas/background';
import { canvasToDataUrl, renderCanvasImage, type RenderOptions } from '../editors/canvas/exportImage';
import { fullProfile } from '../editors/canvas/profiles';
import type { CanvasTypes } from '../editors/canvas/types';
import type { CanvasScene } from '../../lib/blocks/canvas';
import { loadCanvasImage } from '../../lib/images';
import { emptyPaintDoc, paintDocFromJson, type PaintDoc } from '../../lib/paint/document';

/**
 * A stored scene of a canvas or altar block drawn off the editor: the
 * picture the block keeps for the export and the card (`CanvasBlock`), and
 * the one the export draws itself for a block that has none yet
 * (`kinds/canvas.ts`).
 */

/** The width of the rendered picture the export and the card show. */
export const RENDER_WIDTH = 1200;

/** A drawing's document from the stored JSON (`paintDocToJson`), checked like every foreign one. */
export function drawingDoc(raw: unknown): PaintDoc {
  return paintDocFromJson(raw) ?? emptyPaintDoc();
}

/** What drawing the scene off the editor takes: its elements with their pictures by file, read back as data URLs (`loadCanvasImage`). */
export function sceneRenderOptions(scene: CanvasScene, types: CanvasTypes, background: CanvasBackground | null, outWidth: number): RenderOptions {
  return {
    types,
    width: scene.width,
    height: scene.height,
    elements: scene.elements.map((el) => (el.type === 'drawing'
      ? { ...el, props: { ...el.props, doc: drawingDoc(el.props.doc) } }
      : { ...el, props: { emoji: '', ...el.props } })),
    outWidth,
    background,
    loadImage: loadCanvasImage,
  };
}

/**
 * The scene as a PNG data URL, `RENDER_WIDTH` wide; `null` if it holds
 * nothing to draw or drawing failed. The part switches of a block only
 * decide what can be added, so the full set of types draws every element.
 */
export async function scenePicture(scene: CanvasScene, types: CanvasTypes = fullProfile().types): Promise<string | null> {
  const background = parseCanvasBackground(scene.background);
  if (!scene.elements.length && !background) return null;
  const canvas = await renderCanvasImage(sceneRenderOptions(scene, types, background, RENDER_WIDTH));
  return canvas ? canvasToDataUrl(canvas, 'image/png') : null;
}
