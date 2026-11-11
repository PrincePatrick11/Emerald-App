import { drawElement, drawPlaced, resourcesOf } from './draw';
import { BUILTIN_CANVAS_TYPES } from './elements';
import type { Box } from './geometry';
import { attrs, num } from './svg';
import { backgroundSvg, drawCanvasBackground, hasBackground, type CanvasBackground } from './background';
import { byZ, type CanvasElement, type CanvasTypes } from './types';

export interface RenderOptions {
  /** The artboard in its own pixels. */
  width: number;
  height: number;
  elements: readonly CanvasElement[];
  /** The registry; default the built-in types. */
  types?: CanvasTypes;
  /** Width of the picture; the height follows the artboard (or the region). Default: the artboard's (the region's). */
  outWidth?: number;
  /** Only this part of the artboard, in artboard pixels; default the whole of it. */
  region?: Box;
  /** The artboard's background (its picture's `src` loaded with `loadImage`); without it, transparent. */
  background?: CanvasBackground | null;
  /** Paints what else lies behind the elements, over `background`, in output pixels of the whole artboard. */
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
export async function renderCanvasImage(options: RenderOptions): Promise<HTMLCanvasElement | null> {
  const types = options.types ?? BUILTIN_CANVAS_TYPES;
  const frame = frameOf(options);
  const canvas = document.createElement('canvas');
  canvas.width = frame.outW;
  canvas.height = frame.outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(-frame.region.x * frame.scale, -frame.region.y * frame.scale);
  const { visible, images } = await loadScene(options, types);
  const fullW = Math.round(options.width * frame.scale), fullH = Math.round(options.height * frame.scale);
  if (hasBackground(options.background)) {
    const src = options.background.image?.src;
    drawCanvasBackground(ctx, options.background, fullW, fullH, src ? images.get(src) ?? null : null);
  }
  await options.drawBackground?.(ctx, fullW, fullH);

  ctx.scale(frame.scale, frame.scale);
  for (const el of visible) drawPlaced(ctx, el, types, { image: (src) => images.get(src) ?? null, time: null });
  return canvas;
}

/** The part of the artboard drawn, the picture's size, and the scale between them. */
function frameOf(options: RenderOptions): { region: Box; outW: number; outH: number; scale: number } {
  const region = options.region ?? { x: 0, y: 0, width: options.width, height: options.height };
  const outW = Math.max(1, Math.round(options.outWidth ?? region.width));
  const scale = outW / Math.max(1, region.width);
  return { region, outW, outH: Math.max(1, Math.round(region.height * scale)), scale };
}

/** The visible elements bottom first, with their fonts loaded and their pictures by source. */
async function loadScene(options: RenderOptions, types: CanvasTypes) {
  const visible = byZ(options.elements).filter((el) => !el.hidden);
  const { sources, fonts } = resourcesOf(visible, types);
  const backgroundSrc = hasBackground(options.background) ? options.background.image?.src : undefined;
  if (backgroundSrc && !sources.includes(backgroundSrc)) sources.push(backgroundSrc);
  // Text needs its font before measuring and drawing, or the fallback is drawn.
  await Promise.all(fonts.map((font) => document.fonts?.load(font).catch(() => [])));
  const load = options.loadImage ?? loadPlain;
  const images = new Map(await Promise.all(sources.map(async (src) => [src, await load(src).catch(() => null)] as const)));
  return { visible, images };
}

/** Pixels an embedded picture keeps on its long side per pixel it covers in the output: sharp on a dense screen. */
const SVG_PICTURE_DENSITY = 2;
const SVG_PHOTO_QUALITY = 0.85;

/** Whether every pixel is opaque — then the picture goes in as a JPEG. */
function isOpaque(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
  return true;
}

/**
 * A loaded picture for embedding, at most `maxSide` pixels on its long side
 * (what it covers in the output, times the density): a photo in its full
 * size, and as a PNG, would make the file many times larger than the
 * picture it shows. Opaque as a JPEG, with transparency as a PNG; `null` if
 * the canvas cannot be read back.
 */
function pictureHref(image: CanvasImageSource, maxSide: number): string | null {
  const w = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width;
  const h = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height;
  if (!w || !h) return null;
  const fit = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * fit));
  canvas.height = Math.max(1, Math.round(h * fit));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return isOpaque(ctx, canvas.width, canvas.height)
      ? canvas.toDataURL('image/jpeg', SVG_PHOTO_QUALITY)
      : canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * The artboard as an SVG document, with vectors where the types can write
 * themselves (`svg`): shapes as paths, text as text in its fonts (named, not
 * embedded), drawings as their strokes; pictures embedded as data URLs; a
 * type without `svg` as its drawn picture. The background, if any, is
 * embedded as a picture behind them. `outWidth` and `region` as for
 * `renderCanvasImage`.
 */
export async function renderCanvasSvg(options: RenderOptions): Promise<string> {
  const types = options.types ?? BUILTIN_CANVAS_TYPES;
  const frame = frameOf(options);
  const { region } = frame;
  const { visible, images } = await loadScene(options, types);
  const defs: string[] = [];
  let next = 0;
  const id = () => `e${++next}`;
  // The largest a picture is shown in the output (output pixels, long side): that is all it needs.
  const shown = new Map<string, number>();
  const note = (src: string, side: number) => shown.set(src, Math.max(shown.get(src) ?? 0, side));
  for (const el of visible) {
    for (const src of types[el.type]?.sources?.(el) ?? []) if (src) note(src, Math.max(el.width, el.height) * frame.scale);
  }
  const backgroundSrc = hasBackground(options.background) ? options.background.image?.src : undefined;
  if (backgroundSrc) note(backgroundSrc, Math.max(options.width, options.height) * frame.scale);
  const hrefs = new Map<string, string | null>();
  const href = (src: string) => {
    if (!hrefs.has(src)) {
      const image = images.get(src);
      const side = Math.ceil((shown.get(src) ?? Math.max(frame.outW, frame.outH)) * SVG_PICTURE_DENSITY);
      hrefs.set(src, image ? pictureHref(image, side) : src.startsWith('data:') ? src : null);
    }
    return hrefs.get(src) ?? null;
  };

  const body: string[] = [];
  if (hasBackground(options.background)) {
    const src = options.background.image?.src;
    body.push(backgroundSvg(options.background, options.width, options.height, src ? href(src) : null, id, defs));
  }
  if (options.drawBackground) {
    const bg = document.createElement('canvas');
    // As many pixels as the picture has across the artboard, bounded.
    bg.width = Math.max(1, Math.min(8192, Math.round(options.width * frame.scale)));
    bg.height = Math.max(1, Math.round((bg.width * options.height) / options.width));
    const ctx = bg.getContext('2d');
    if (ctx) {
      await options.drawBackground(ctx, bg.width, bg.height);
      const data = pictureHref(bg, Infinity);
      if (data) body.push(`<image${attrs({ href: data, width: options.width, height: options.height, preserveAspectRatio: 'none' })}/>`);
    }
  }

  for (const el of visible) {
    let content = types[el.type]?.svg?.(el, { href, id, defs }) ?? null;
    if (content === null) {
      // The drawn picture, at the output's pixels.
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.min(8192, Math.round(el.width * frame.scale)));
      canvas.height = Math.max(1, Math.min(8192, Math.round(el.height * frame.scale)));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(canvas.width / el.width, canvas.height / el.height);
        drawElement(ctx, el, types, { image: (src) => images.get(src) ?? null, time: null });
      }
      const data = pictureHref(canvas, Infinity);
      content = data ? `<image${attrs({ href: data, width: el.width, height: el.height, preserveAspectRatio: 'none' })}/>` : '';
    }
    const transform = `translate(${num(el.x - el.width / 2)} ${num(el.y - el.height / 2)})`
      + (el.rotation ? ` rotate(${num(el.rotation)} ${num(el.width / 2)} ${num(el.height / 2)})` : '');
    body.push(`<g${attrs({ transform, opacity: el.opacity < 1 ? el.opacity : null })}>${content}</g>`);
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg"${attrs({
      width: frame.outW, height: frame.outH, viewBox: `${num(region.x)} ${num(region.y)} ${num(region.width)} ${num(region.height)}`,
    })}>`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '')
    + body.join('')
    + '</svg>\n';
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
