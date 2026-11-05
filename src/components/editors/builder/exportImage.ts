import { drawPlaced, resourcesOf } from './draw';
import { BUILTIN_BUILDER_TYPES } from './elements';
import { byZ, type BuilderElement, type BuilderTypes } from './types';

export interface RenderOptions {
  /** The artboard in its own pixels. */
  width: number;
  height: number;
  elements: readonly BuilderElement[];
  /** The registry; default the built-in types. */
  types?: BuilderTypes;
  /** Width of the picture; the height follows the artboard. Default: the artboard's. */
  outWidth?: number;
  /** Paints what lies behind the elements, in output pixels. */
  drawBackground?: (ctx: CanvasRenderingContext2D, outWidth: number, outHeight: number) => Promise<void> | void;
  /**
   * Loads a picture source the elements name. For a canvas that is read back
   * (`toBlob`), the sources must not be foreign: the place hands in elements
   * whose sources are data URLs.
   */
  loadImage?: (src: string) => Promise<CanvasImageSource | null>;
}

function loadPlain(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Draws the artboard onto a fresh canvas, without the editor: the same drawing
 * as on the stage, with moving types standing still. For previews, thumbnails
 * and saving as a file.
 */
export async function renderBuilderImage(options: RenderOptions): Promise<HTMLCanvasElement | null> {
  const types = options.types ?? BUILTIN_BUILDER_TYPES;
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
  const { sources, fonts } = resourcesOf(visible, types);
  // Text needs its font before measuring and drawing, or the fallback is drawn.
  await Promise.all(fonts.map((font) => document.fonts?.load(font).catch(() => [])));
  const load = options.loadImage ?? loadPlain;
  const images = new Map(await Promise.all(sources.map(async (src) => [src, await load(src).catch(() => null)] as const)));

  ctx.save();
  ctx.scale(scale, scale);
  for (const el of visible) drawPlaced(ctx, el, types, { image: (src) => images.get(src) ?? null, time: null });
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
