import { drawPlaced, fontString } from './draw';
import { byZ, type BuilderElement, type BuilderImageElement } from './types';

export interface RenderOptions {
  /** The artboard in its own pixels. */
  width: number;
  height: number;
  elements: readonly BuilderElement[];
  /** Width of the picture; the height follows the artboard. Default: the artboard's. */
  outWidth?: number;
  /** Paints what lies behind the elements, in output pixels. */
  drawBackground?: (ctx: CanvasRenderingContext2D, outWidth: number, outHeight: number) => Promise<void> | void;
  /**
   * The picture of an image element. For a canvas that is read back
   * (`toBlob`), it must not come from a foreign origin.
   */
  resolveImage: (element: BuilderImageElement) => Promise<CanvasImageSource | null>;
}

/**
 * Draws the artboard onto a fresh canvas, without the editor: the same drawing
 * as on the stage (`drawPlaced`), with flames standing still. For previews,
 * thumbnails and saving as a file.
 */
export async function renderBuilderImage(options: RenderOptions): Promise<HTMLCanvasElement | null> {
  const outW = Math.max(1, Math.round(options.outWidth ?? options.width));
  const scale = outW / options.width;
  const outH = Math.max(1, Math.round(options.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  await options.drawBackground?.(ctx, outW, outH);

  const visible = byZ(options.elements).filter((el) => !el.hidden);
  // Text needs its font before measuring and drawing, or the fallback is drawn.
  await Promise.all(
    visible.filter((el) => el.kind === 'text').map((el) => document.fonts?.load(fontString(el)).catch(() => [])),
  );
  const images = await Promise.all(
    visible.map((el) => (el.kind === 'image' ? options.resolveImage(el).catch(() => null) : Promise.resolve(null))),
  );

  ctx.save();
  ctx.scale(scale, scale);
  visible.forEach((el, i) => drawPlaced(ctx, el, { image: images[i], time: null }));
  ctx.restore();
  return canvas;
}

/** A canvas as a data URL in the given format, via `toBlob`. */
export function canvasToDataUrl(canvas: HTMLCanvasElement, mime = 'image/png', quality?: number): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }, mime, quality);
  });
}
