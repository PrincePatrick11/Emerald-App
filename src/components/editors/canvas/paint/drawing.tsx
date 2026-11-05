import { PenTool } from 'lucide-react';
import {
  emptyPaintDoc, PAINT_HEIGHT, PAINT_WIDTH, type PaintDoc,
} from '../../../../lib/paint/document';
import type { CanvasElement, CanvasElementType } from '../types';
import { drawPaintDoc, layerImageRefs } from './render';

/** A drawing: a paint document in the element's box. */
export interface DrawingProps {
  doc: PaintDoc;
}

export type DrawingElement = CanvasElement<DrawingProps>;

export interface DrawingTypeOptions {
  /**
   * A layer image's reference (as the document stores it) as a source the
   * canvas can load. For a canvas that is read back, a data URL.
   */
  resolveImage?: (ref: string) => string;
}

/**
 * The drawn picture of a document at a pixel size, kept until the document
 * or the size changes: the stage redraws a whole layer for every move, and a
 * drawing with thousands of strokes would otherwise be painted anew each time.
 */
const rendered = new WeakMap<PaintDoc, { width: number; height: number; images: number; canvas: HTMLCanvasElement }>();

function picture(doc: PaintDoc, images: ReadonlyMap<string, HTMLImageElement>, width: number, height: number): HTMLCanvasElement {
  const hit = rendered.get(doc);
  if (hit && hit.width === width && hit.height === height && hit.images === images.size) return hit.canvas;
  const canvas = hit?.canvas ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  drawPaintDoc(ctx, doc, images, { width, height });
  rendered.set(doc, { width, height, images: images.size, canvas });
  return canvas;
}

/**
 * The element type of a drawing, made by the place that registers it (it
 * knows where layer images live). Painted in the paint mode: a double click
 * or Enter on the element, or the place fixes the editor in it
 * (`paintElementId`). The document's own space is 3:2; the box keeps that
 * shape when scaled.
 */
export function createDrawingType({ resolveImage = (ref) => ref }: DrawingTypeOptions = {}): CanvasElementType<DrawingProps> {
  const sources = (el: DrawingElement) => layerImageRefs(el.props.doc).map(resolveImage);
  return {
    type: 'drawing',
    keepRatio: true,
    handles: 'corners',
    sources,
    draw: (ctx, el, env) => {
      const images = new Map<string, HTMLImageElement>();
      for (const ref of layerImageRefs(el.props.doc)) {
        const image = env.image(resolveImage(ref));
        if (image) images.set(ref, image as HTMLImageElement);
      }
      // As many pixels as the box covers on the target, bounded.
      const m = ctx.getTransform();
      const zoom = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
      const pxW = Math.max(1, Math.min(4096, Math.round(el.width * zoom)));
      const pxH = Math.max(1, Math.min(4096, Math.round(el.height * zoom)));
      ctx.drawImage(picture(el.props.doc, images, pxW, pxH), 0, 0, el.width, el.height);
    },
    paint: {
      get: (el) => el.props.doc,
      set: (el, doc) => ({ ...el.props, doc }),
      resolveImage,
    },
    additions: [{
      key: 'drawing',
      icon: <PenTool size={14} />,
      label: (t) => t('canvas.addDrawing'),
      create: (_centre, artboard) => {
        const width = Math.round(Math.min(artboard.width * 0.5, (artboard.height * 0.6 * PAINT_WIDTH) / PAINT_HEIGHT));
        return { width, height: Math.round((width * PAINT_HEIGHT) / PAINT_WIDTH), props: { doc: emptyPaintDoc() } };
      },
    }],
  };
}
