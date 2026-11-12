import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { decodeHtmlAttr } from './blockHtml';
import { readBlockData, withBlockData } from './blockJson';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';
import { paintDocFromImage, paintDocFromJson, paintDocToJson, type PaintDoc } from '../paint/document';

/**
 * The paint block: a drawing of its own, painted in the canvas editor's
 * paint mode with its layers, brushes and symmetry. The vector document is
 * its data JSON, the rendered picture and every layer's picture are stored
 * files in its inner HTML (`parseDrawing`, `withDrawing`).
 *
 * A sigil drawing is a paint block too, marked in its config
 * (`{"sigil":true}`, `isSigilDrawing`): it is named and iconed as one, paints
 * in the sigil's colours, and a charge in the entry can conceal and lock it
 * (`lib/blocks/sigil.ts`). An unmarked paint block is never concealed.
 */
export const PAINT_BLOCK_TYPE = 'core.paint' satisfies BlockTypeId;

export function createPaintBlock(): BlockInstance {
  return { id: generateId(), type: PAINT_BLOCK_TYPE, html: '', attrs: {} };
}

/** The config that marks a paint block as a sigil drawing. */
export const SIGIL_DRAWING_CONFIG = JSON.stringify({ sigil: true });

/**
 * The attributes of a sigil drawing: marked, and its title shown in read mode,
 * as the sigil drawing's always was. The converter of the old sigil blocks writes the same.
 */
export const SIGIL_DRAWING_ATTRS: Readonly<Record<string, string>> = {
  [BLOCK_ATTR.config]: SIGIL_DRAWING_CONFIG,
  [BLOCK_ATTR.showTitle]: '1',
};

/** A new sigil drawing: an empty paint block, marked. */
export function createSigilDrawingBlock(): BlockInstance {
  return { ...createPaintBlock(), attrs: { ...SIGIL_DRAWING_ATTRS } };
}

/** A block that holds a drawing in that form — the paint block, marked or not. Kept as the one question the image cleanup asks. */
export function isDrawingBlockType(type: string): boolean {
  return type === PAINT_BLOCK_TYPE;
}

/** Is this a paint block marked as a sigil drawing? Unreadable config: no. */
export function isSigilDrawing(block: BlockInstance): boolean {
  if (block.type !== PAINT_BLOCK_TYPE) return false;
  const raw = block.attrs[BLOCK_ATTR.config];
  if (raw === undefined || !raw.includes('sigil')) return false;
  try {
    const config: unknown = JSON.parse(raw);
    return typeof config === 'object' && config !== null && (config as Record<string, unknown>).sigil === true;
  } catch {
    return false;
  }
}

/* ---------------- Drawing ---------------- */

/** The file name of the drawing's rendered picture (the first image) — or `null`. */
export function drawingImage(block: BlockInstance): string | null {
  const src = /\bsrc="([^"]*)"/i.exec(block.html)?.[1];
  return src ? decodeHtmlAttr(src) : null;
}

/** A drawing holding only this picture (no vector document) — what drawings from before the vector format look like. */
export function withDrawingImage(block: BlockInstance, filename: string | null): BlockInstance {
  return { ...block, html: filename ? `<img src="${escapeHtml(filename)}" alt="">` : '' };
}

/** Marks the drawing's rendered image; a layer's image carries its layer ID instead. */
const PAINT_RENDER = 'render';
// Bounded: it runs over foreign markup.
const IMG_RE = /<img\b[^<>]{0,2048}>/gi;
const PAINT_ATTR_RE = /\bdata-paint="([^"]*)"/i;

export interface DrawingData {
  /** The rendered image — what read mode, the card and the export show. */
  render: string | null;
  /** The vector document, with the old image as a layer where there was no document yet. */
  doc: PaintDoc | null;
}

/**
 * The drawing of a block (the paint block, or a custom block's drawing part as
 * its virtual block). The vector document is its data JSON; the inner HTML
 * holds the rendered image first (`data-paint="render"`), then the image of
 * every layer that has one (`data-paint="<layer ID>"`), so that backups,
 * exports and the image cleanup find them as they find every other image.
 *
 * A drawing without a document (from before the vector format), or one whose
 * rendered image is no longer marked as such (something else replaced it),
 * becomes a document with that image as its only layer: nothing it shows is lost.
 */
export function parseDrawing(block: BlockInstance): DrawingData {
  const images = new Map<string, string>();
  let render: string | null = null;
  let marked = false;
  for (const [tag] of block.html.matchAll(IMG_RE)) {
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
    if (!src) continue;
    const role = PAINT_ATTR_RE.exec(tag)?.[1];
    if (render === null) {
      render = decodeHtmlAttr(src);
      marked = role === PAINT_RENDER;
    } else if (role && role !== PAINT_RENDER) {
      images.set(decodeHtmlAttr(role), decodeHtmlAttr(src));
    }
  }
  const { broken, data } = readBlockData(block);
  const doc = marked && !broken ? paintDocFromJson(data, images) : null;
  if (doc) return { render, doc };
  return { render, doc: render ? paintDocFromImage(render) : null };
}

/** The drawing with a new rendered image and document; `null` for both empties it. */
export function withDrawing(block: BlockInstance, render: string | null, doc: PaintDoc | null): BlockInstance {
  if (!render || !doc) {
    const attrs = { ...block.attrs };
    delete attrs[BLOCK_ATTR.data];
    return { ...block, html: '', attrs };
  }
  const layerImages = doc.layers
    .filter((l) => l.image)
    .map((l) => `<img src="${escapeHtml(l.image!)}" alt="" data-paint="${escapeHtml(l.id)}">`)
    .join('');
  return withBlockData(block, paintDocToJson(doc), `<img src="${escapeHtml(render)}" alt="" data-paint="${PAINT_RENDER}">${layerImages}`);
}
