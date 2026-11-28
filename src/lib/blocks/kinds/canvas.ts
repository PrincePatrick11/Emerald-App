import { Frame, ImageDown } from 'lucide-react';
import { AltarIcon } from '../../altarIcon';
import { isRecord } from '../../helpers';
import type { BlockActionDef, BlockExportPart, BlockTypeDef, ExportContext } from '../blockType';
import {
  ALTAR_BLOCK_TYPE, CANVAS_BLOCK_TYPE, canvasElementFile, createCanvasBlock, parseCanvasBlock, withoutCanvasFile,
} from '../canvas';
import { backgroundFile, blockTypeTextKey, type RefReporter } from '../toolkit';
import type { BlockInstance } from '../types';

/** A canvas's pictures: those on it (shown), its background, and its rendered picture (the thing itself). */
function canvasRefs(block: BlockInstance, report: RefReporter): void {
  const { scene, render } = parseCanvasBlock(block);
  for (const el of scene.elements) report.image(canvasElementFile(el), 'content');
  report.image(backgroundFile(scene.background), 'background');
  report.image(render, 'render');
}

/** The ID of the canvas's "Save as picture" — the view carries it out (`CanvasBlock`). */
export const SAVE_PICTURE_ACTION = 'savePicture';

const CANVAS_ACTIONS: readonly BlockActionDef[] = [{
  id: SAVE_PICTURE_ACTION,
  labelKey: 'blocks.canvas.savePicture',
  icon: ImageDown,
  inRead: true,
  // Nothing on it, nothing to save — read mode does not even show the editor then.
  available: (block) => {
    const { scene } = parseCanvasBlock(block);
    return scene.elements.length > 0 || drawsBackground(scene.background);
  },
}];

/** Does a stored background draw anything — a fill, a picture or a tint (as the canvas editor's `hasBackground`)? */
function drawsBackground(background: unknown): boolean {
  if (!isRecord(background)) return false;
  const fill = isRecord(background.fill) ? background.fill : null;
  return (!!fill && fill.kind !== 'none') || !!background.image || !!background.tint;
}

/**
 * The rendered picture, named after the block; the pictures behind it are
 * only references. A scene without a kept picture yet (an altar from before
 * pictures were kept, or never opened since) is drawn here, as the block
 * draws it when it keeps one; Markdown shows only the picture's name, so it
 * is not drawn for it.
 */
async function canvasExport(block: BlockInstance, ctx: ExportContext): Promise<BlockExportPart[]> {
  const { render, scene } = parseCanvasBlock(block);
  if (render) return [{ kind: 'image', file: render }];
  // The empty file stands in for the picture: Markdown keeps only its name (`stripImages`).
  if (ctx.format === 'markdown') return scene.elements.length ? [{ kind: 'image', file: '' }] : [];
  // Drawing needs a page (the block checks run without one). The type's own
  // drawing lives with its view; loaded only here, so this file stays free of
  // React for everything else (an exception in blocks.md).
  if (typeof document === 'undefined') return [];
  try {
    const { scenePicture } = await import('../../../components/blocks/canvasScene');
    const drawn = await scenePicture(scene);
    return drawn ? [{ kind: 'image', file: drawn }] : [];
  } catch (err) {
    // Left out rather than failing the whole export, as a block without a picture always was.
    console.error('[export] canvas scene not drawn', err);
    return [];
  }
}

/** What canvas and altar share: a scene of the canvas editor, no text, pictures as references. */
const canvasLike = {
  origin: 'core',
  group: 'media',
  dataVersion: 1,
  defaultShowTitle: false,
  isBroken: (block: BlockInstance) => parseCanvasBlock(block).broken,
  export: canvasExport,
  refs: canvasRefs,
  withoutImage: withoutCanvasFile,
  actions: CANVAS_ACTIONS,
} satisfies Partial<BlockTypeDef>;

export const canvasBlockType: BlockTypeDef = {
  ...canvasLike,
  id: CANVAS_BLOCK_TYPE,
  icon: Frame,
  labelKey: blockTypeTextKey(CANVAS_BLOCK_TYPE, 'label'),
  descriptionKey: blockTypeTextKey(CANVAS_BLOCK_TYPE, 'description'),
  presets: [{ id: 'canvas', labelKey: blockTypeTextKey(CANVAS_BLOCK_TYPE, 'label'), descriptionKey: blockTypeTextKey(CANVAS_BLOCK_TYPE, 'description'), icon: Frame, group: 'media', create: () => createCanvasBlock() }],
};

/**
 * The altar: the same canvas with "Images" below it, a type of its own so
 * that it is offered, named and iconed as one. Its pictures go under the
 * tag "Altar Library", which its picture list shows until another is chosen.
 */
export const altarBlockType: BlockTypeDef = {
  ...canvasLike,
  id: ALTAR_BLOCK_TYPE,
  icon: AltarIcon,
  labelKey: blockTypeTextKey(ALTAR_BLOCK_TYPE, 'label'),
  descriptionKey: blockTypeTextKey(ALTAR_BLOCK_TYPE, 'description'),
  presets: [{ id: 'altar', labelKey: blockTypeTextKey(ALTAR_BLOCK_TYPE, 'label'), descriptionKey: blockTypeTextKey(ALTAR_BLOCK_TYPE, 'description'), icon: AltarIcon, group: 'media', create: () => createCanvasBlock(ALTAR_BLOCK_TYPE) }],
  storage: { tag: { id: 'altar-library', name: 'Altar Library' } },
};
