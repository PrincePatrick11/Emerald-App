import { getStroke } from 'perfect-freehand';
import { isShapeTool, PAINT_HEIGHT, PAINT_WIDTH, type PaintDoc, type PaintLayer, type PaintStroke } from '../../../lib/paint/document';

/**
 * Drawing a document onto a canvas. A pen or eraser stroke is a filled
 * outline from `perfect-freehand` (its width follows the pen's pressure, or
 * the speed for a mouse or finger); a shape is a stroked path of the brush's
 * width. The eraser cuts its outline out of its own layer only
 * (`destination-out`), which is why every layer is drawn on its own canvas
 * first and the layers are stacked afterwards.
 */

/** Loaded layer images by file name; a missing one is simply not drawn yet. */
export type LayerImages = ReadonlyMap<string, HTMLImageElement>;

// A stroke never changes once committed, so its path is computed once.
const paths = new WeakMap<PaintStroke, Path2D>();

function freehandOptions(stroke: Pick<PaintStroke, 'tool' | 'size' | 'pressure'>, last: boolean) {
  const eraser = stroke.tool === 'eraser';
  return {
    size: stroke.size,
    thinning: eraser ? 0 : stroke.pressure ? 0.65 : 0.5,
    smoothing: 0.6,
    streamline: stroke.pressure ? 0.4 : 0.5,
    simulatePressure: !stroke.pressure && !eraser,
    last,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  };
}

function triples(points: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
  return out;
}

/** The outline as a closed path of quadratic curves through the midpoints (perfect-freehand's README). */
function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 2) return path;
  const [first, second] = outline;
  path.moveTo(first[0], first[1]);
  path.quadraticCurveTo(second[0], second[1], (first[0] + second[0]) / 2, (first[1] + second[1]) / 2);
  for (let i = 1; i < outline.length - 1; i++) {
    const a = outline[i], b = outline[i + 1];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
  return path;
}

/** The shape between two corners (or the two ends of a line). */
export function shapePath(tool: PaintStroke['tool'], points: readonly number[]): Path2D {
  const path = new Path2D();
  const [x0, y0, , x1 = x0, y1 = y0] = points;
  if (tool === 'line') {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  } else if (tool === 'rect') {
    path.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else {
    path.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
  }
  return path;
}

/** The path of a stroke; `live` while it is still being drawn (not cached, the end not yet final). */
export function strokePath(stroke: PaintStroke, live = false): Path2D {
  if (!live) {
    const cached = paths.get(stroke);
    if (cached) return cached;
  }
  const path = isShapeTool(stroke.tool)
    ? shapePath(stroke.tool, stroke.points)
    : outlinePath(getStroke(triples(stroke.points), freehandOptions(stroke, !live)));
  if (!live) paths.set(stroke, path);
  return path;
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: PaintStroke, live = false): void {
  const path = strokePath(stroke, live);
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  if (isShapeTool(stroke.tool)) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else {
    ctx.fillStyle = stroke.color;
    ctx.fill(path);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * One layer onto a canvas whose transform maps the document's units; the
 * canvas is cleared first. `extra` is a stroke still being drawn.
 */
export function drawLayer(ctx: CanvasRenderingContext2D, layer: PaintLayer, images: LayerImages, extra?: PaintStroke): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  const image = layer.image ? images.get(layer.image) : undefined;
  if (image) ctx.drawImage(image, 0, 0, PAINT_WIDTH, PAINT_HEIGHT);
  for (const stroke of layer.strokes) drawStroke(ctx, stroke);
  if (extra) drawStroke(ctx, extra, true);
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The document as a PNG data URL at its own size, on a transparent ground,
 * hidden layers left out — for wherever the drawing is shown without the
 * editor. The layer images must be loaded (`loadLayerImages`).
 */
export function renderPaintPng(doc: PaintDoc, images: LayerImages): string {
  const out = canvasOf(PAINT_WIDTH, PAINT_HEIGHT);
  const layer = canvasOf(PAINT_WIDTH, PAINT_HEIGHT);
  const octx = out.getContext('2d')!;
  const lctx = layer.getContext('2d')!;
  for (const l of doc.layers) {
    if (l.hidden) continue;
    drawLayer(lctx, l, images);
    octx.drawImage(layer, 0, 0);
  }
  return out.toDataURL('image/png');
}

/**
 * The document drawn by a place that shows it without the paint editor,
 * hidden layers left out. Without `box` it fills the target canvas's width.
 * With `box` it is scaled into that box at the origin of the target's
 * current transform (another editor's element, already moved, turned and
 * scaled there); the target is neither cleared nor resized. The layers are
 * stacked on a canvas of their own, at the pixels the box covers on the
 * target, since an eraser stroke must cut only its own layer.
 */
export function drawPaintDoc(
  target: CanvasRenderingContext2D,
  doc: PaintDoc,
  images: LayerImages,
  box?: { width: number; height: number },
): void {
  const width = box?.width ?? target.canvas.width;
  const height = box?.height ?? (target.canvas.width * PAINT_HEIGHT) / PAINT_WIDTH;
  if (width <= 0 || height <= 0) return;
  const m = target.getTransform();
  const zoom = box ? Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) : 1;
  // Bounded: a huge zoom must not ask for a canvas the browser refuses.
  const pxW = Math.max(1, Math.min(4096, Math.round(width * zoom)));
  const pxH = Math.max(1, Math.min(4096, Math.round(height * zoom)));
  const layer = canvasOf(pxW, pxH);
  const stack = canvasOf(pxW, pxH);
  const lctx = layer.getContext('2d')!;
  const sctx = stack.getContext('2d')!;
  lctx.setTransform(pxW / PAINT_WIDTH, 0, 0, pxH / PAINT_HEIGHT, 0, 0);
  for (const l of doc.layers) {
    if (l.hidden) continue;
    drawLayer(lctx, l, images);
    sctx.drawImage(layer, 0, 0);
  }
  if (box) target.drawImage(stack, 0, 0, width, height);
  else {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(stack, 0, 0);
    target.restore();
  }
}

/**
 * Turns an image reference into a source a canvas can read back from, by
 * default a stored image of the vault as a data URL (`canvasImageSrc`): an
 * image over the `emerald-img` scheme could taint the canvas, and the PNG
 * export would then fail.
 */
export type ImageLoader = (ref: string) => Promise<string>;

/** Loads the layer images a document names; rejects if one cannot be loaded. */
export async function loadLayerImages(refs: readonly string[], load: ImageLoader): Promise<Map<string, HTMLImageElement>> {
  const loaded = await Promise.all([...new Set(refs)].map(async (ref) => {
    const img = new Image();
    img.src = await load(ref);
    await img.decode();
    return [ref, img] as const;
  }));
  return new Map(loaded);
}

/** The image references of a document's layers. */
export function layerImageRefs(doc: PaintDoc): string[] {
  return doc.layers.map((l) => l.image).filter((ref): ref is string => !!ref);
}
