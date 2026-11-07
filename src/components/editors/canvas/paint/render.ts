import { getStroke } from 'perfect-freehand';
import { SvgPath, attrs, esc, type PathSink } from '../svg';
import { isBoxShape, isShapeTool, PAINT_HEIGHT, PAINT_WIDTH, type PaintDoc, type PaintLayer, type PaintStroke } from '../../../../lib/paint/document';

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
function outlinePath<T extends PathSink>(outline: number[][], path: T): T {
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

/** The corners of a polygon (or the points and notches of a star) in the ellipse of its box, the first at the top. */
export function polygonPoints(tool: 'polygon' | 'star', sides: number, cx: number, cy: number, rx: number, ry: number): [number, number][] {
  const count = tool === 'star' ? sides * 2 : sides;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    // A star's notches lie at a little under half its radius.
    const k = tool === 'star' && i % 2 ? 0.45 : 1;
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}

/**
 * The shape between two corners (or the two ends of a line), a box shape
 * turned by `rotation` around its centre; a polygon or star has `sides`.
 */
export function shapePath<T extends PathSink = Path2D>(
  tool: PaintStroke['tool'], points: readonly number[], rotation = 0, sides = 5, path: T = new Path2D() as unknown as T,
): T {
  const [x0, y0, , x1 = x0, y1 = y0] = points;
  if (tool === 'polygon' || tool === 'star') {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cos = Math.cos(rotation), sin = Math.sin(rotation);
    const pts = polygonPoints(tool, sides, cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2)
      .map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
    path.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) path.lineTo(x, y);
    path.closePath();
  } else if (tool === 'line') {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  } else if (tool === 'rect') {
    if (!rotation) {
      path.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cos = Math.cos(rotation), sin = Math.sin(rotation);
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) =>
        [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
      path.moveTo(corners[0][0], corners[0][1]);
      for (const [x, y] of corners.slice(1)) path.lineTo(x, y);
      path.closePath();
    }
  } else {
    path.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, rotation, 0, Math.PI * 2);
  }
  return path;
}

/** A corner sharper than this (the turn between its edges, in radians) stays a corner when a fill is smoothed. */
const SHARP_TURN = 0.9;

/**
 * A fill's outlines as one path, smoothed by curves through the midpoints of
 * their edges; a sharp corner (a square's, a star's tip) stays a corner.
 */
function ringsPath<T extends PathSink>(rings: readonly number[][], path: T): T {
  for (const ring of rings) {
    const n = ring.length / 2;
    if (n < 3) continue;
    const pt = (i: number): [number, number] => [ring[((i + n) % n) * 2], ring[((i + n) % n) * 2 + 1]];
    const mid = (i: number): [number, number] => {
      const [ax, ay] = pt(i), [bx, by] = pt(i + 1);
      return [(ax + bx) / 2, (ay + by) / 2];
    };
    const start = mid(n - 1);
    path.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) {
      const [px, py] = pt(i - 1), [x, y] = pt(i), [nx, ny] = pt(i + 1);
      let turn = Math.abs(Math.atan2(ny - y, nx - x) - Math.atan2(y - py, x - px));
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      const [mx, my] = mid(i);
      if (turn > SHARP_TURN) {
        path.lineTo(x, y);
        path.lineTo(mx, my);
      } else {
        path.quadraticCurveTo(x, y, mx, my);
      }
    }
    path.closePath();
  }
  return path;
}

/** The path of a stroke; `live` while it is still being drawn (not cached, the end not yet final). */
export function strokePath(stroke: PaintStroke, live = false): Path2D {
  if (!live) {
    const cached = paths.get(stroke);
    if (cached) return cached;
  }
  const path = buildStrokePath(stroke, new Path2D(), live);
  if (!live) paths.set(stroke, path);
  return path;
}

function buildStrokePath<T extends PathSink>(stroke: PaintStroke, path: T, live = false): T {
  return stroke.tool === 'fill'
    ? ringsPath(stroke.rings, path)
    : isShapeTool(stroke.tool)
    ? shapePath(stroke.tool, stroke.points, stroke.rotation, stroke.sides, path)
    : outlinePath(getStroke(triples(stroke.points), freehandOptions(stroke, !live)), path);
}

/**
 * The document as SVG content in its own units (`PAINT_WIDTH` × `PAINT_HEIGHT`),
 * hidden layers left out: each layer a group with its opacity, its image and
 * its strokes as paths. An eraser stroke masks what its layer has before it,
 * so it cuts that layer only, as on the canvas. `href` gives a layer image's
 * source to embed (`null` leaves it out); `id` makes ids unique in the file;
 * masks go into `defs`.
 */
export function paintDocSvg(doc: PaintDoc, href: (ref: string) => string | null, id: () => string, defs: string[]): string {
  const out: string[] = [];
  for (const layer of doc.layers) {
    if (layer.hidden) continue;
    let body = '';
    const image = layer.image ? href(layer.image) : null;
    if (image) {
      const r = layer.imageRect;
      body += `<image${attrs({ href: image, x: r.x, y: r.y, width: r.width, height: r.height, preserveAspectRatio: 'none' })}/>`;
    }
    for (const stroke of layer.strokes) {
      const d = buildStrokePath(stroke, new SvgPath()).d;
      if (!d) continue;
      if (stroke.tool === 'eraser') {
        const mask = id();
        defs.push(`<mask id="${mask}" maskUnits="userSpaceOnUse"${attrs({ x: 0, y: 0, width: PAINT_WIDTH, height: PAINT_HEIGHT })}>`
          + `<rect${attrs({ width: PAINT_WIDTH, height: PAINT_HEIGHT, fill: '#fff' })}/><path d="${esc(d)}" fill="#000"/></mask>`);
        body = `<g mask="url(#${mask})">${body}</g>`;
      } else if (stroke.tool === 'fill' || (isBoxShape(stroke.tool) && stroke.filled)) {
        body += `<path${attrs({ d, fill: stroke.color, 'fill-rule': 'evenodd' })}/>`;
      } else if (isShapeTool(stroke.tool)) {
        body += `<path${attrs({ d, fill: 'none', stroke: stroke.color, 'stroke-width': stroke.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })}/>`;
      } else {
        body += `<path${attrs({ d, fill: stroke.color })}/>`;
      }
    }
    if (body) out.push(`<g${attrs({ opacity: layer.opacity < 1 ? layer.opacity : null })}>${body}</g>`);
  }
  return out.join('');
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: PaintStroke, live = false): void {
  const path = strokePath(stroke, live);
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  if (stroke.tool === 'fill' || (isBoxShape(stroke.tool) && stroke.filled)) {
    ctx.fillStyle = stroke.color;
    ctx.fill(path, 'evenodd');
  } else if (isShapeTool(stroke.tool)) {
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
  const r = layer.imageRect;
  if (image) ctx.drawImage(image, r.x, r.y, r.width, r.height);
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
    octx.globalAlpha = l.opacity;
    octx.drawImage(layer, 0, 0);
  }
  octx.globalAlpha = 1;
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
    sctx.globalAlpha = l.opacity;
    sctx.drawImage(layer, 0, 0);
  }
  sctx.globalAlpha = 1;
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
