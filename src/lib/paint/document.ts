/**
 * The paint document of the canvas editor's drawings: layers of vector strokes, stored as JSON.
 *
 * A layer may carry an image under its strokes: a drawing from before the
 * vector format becomes the image of the first layer, so nothing of it is
 * lost, and the eraser takes from it as it took from the old canvas. The
 * image's file name is not part of the JSON; the place that stores the
 * document keeps it where image references are found (an `<img src>`), and
 * hands it back by layer ID.
 *
 * Pure and DOM-free, so that storage code and checks running under Node can use it.
 */

/** The document's own coordinate space; a stroke's points are in it. */
export const PAINT_WIDTH = 1200;
export const PAINT_HEIGHT = 800;

export const PAINT_TOOLS = ['pen', 'eraser', 'line', 'ellipse', 'rect'] as const;
export type PaintTool = (typeof PAINT_TOOLS)[number];

/** Tools whose stroke is two points, the start and the end of a drag. */
export function isShapeTool(tool: PaintTool): boolean {
  return tool === 'line' || tool === 'ellipse' || tool === 'rect';
}

export const PAINT_SIZE_MIN = 1;
export const PAINT_SIZE_MAX = 120;

export interface PaintStroke {
  id: string;
  tool: PaintTool;
  /** `#rrggbb`; ignored by the eraser. */
  color: string;
  /** Diameter in document units. */
  size: number;
  /** Flat `x, y, pressure` triples; pressure 0–1. */
  points: number[];
  /** Pressure came from a pen; otherwise the width follows the speed. */
  pressure: boolean;
  /** Ellipse and rectangle only: turned by this many radians around their centre. */
  rotation: number;
}

/** Where a layer's image lies, in document units; by default the whole page. */
export interface PaintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaintLayer {
  id: string;
  /** Empty: the editor numbers it. */
  name: string;
  hidden: boolean;
  /** Nothing is drawn on, selected in or moved on a locked layer. */
  locked: boolean;
  /** 0–1, applied when the layers are stacked. */
  opacity: number;
  /** A stored image under the strokes. */
  image: string | null;
  imageRect: PaintRect;
  strokes: PaintStroke[];
}

export const FULL_PAGE: PaintRect = { x: 0, y: 0, width: PAINT_WIDTH, height: PAINT_HEIGHT };

export interface PaintDoc {
  layers: PaintLayer[];
}

// Bounds against doctored imports: a document beyond them would cripple
// rendering and saving; real drawings stay far below.
export const MAX_LAYERS = 16;
const MAX_STROKES = 10_000;
const MAX_POINTS = 1_500_000; // numbers, over all strokes
const MAX_NAME = 60;
const ID_RE = /^[\w-]{1,64}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

let counter = 0;
/** A short ID, unique within a document. */
export function paintId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyLayer(name = ''): PaintLayer {
  return { id: paintId(), name, hidden: false, locked: false, opacity: 1, image: null, imageRect: FULL_PAGE, strokes: [] };
}

export function emptyPaintDoc(): PaintDoc {
  return { layers: [emptyLayer()] };
}

/** A drawing that exists only as an image: one layer with it under no strokes. */
export function paintDocFromImage(image: string): PaintDoc {
  return { layers: [{ ...emptyLayer(), image }] };
}

export function isPaintDocEmpty(doc: PaintDoc): boolean {
  return doc.layers.every((l) => !l.image && l.strokes.length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------------- Stored form ---------------- */

/**
 * The JSON of a document. Short keys: a drawing holds thousands of points,
 * and the JSON is stored inside other content. Coordinates are rounded to
 * a tenth, pressure to a hundredth. Layer images are left out (see above).
 */
export function paintDocToJson(doc: PaintDoc): Record<string, unknown> {
  return {
    v: 1,
    layers: doc.layers.map((layer) => {
      const out: Record<string, unknown> = { id: layer.id };
      if (layer.name) out.name = layer.name;
      if (layer.hidden) out.hidden = true;
      if (layer.locked) out.locked = true;
      if (layer.opacity < 1) out.opacity = round2(layer.opacity);
      if (layer.image) {
        out.image = true;
        const r = layer.imageRect;
        if (r.x !== 0 || r.y !== 0 || r.width !== PAINT_WIDTH || r.height !== PAINT_HEIGHT) {
          out.imageRect = [round1(r.x), round1(r.y), round1(r.width), round1(r.height)];
        }
      }
      out.strokes = layer.strokes.map((s) => {
        const p: number[] = [];
        for (let i = 0; i + 2 < s.points.length; i += 3) p.push(round1(s.points[i]), round1(s.points[i + 1]), round2(s.points[i + 2]));
        const stroke: Record<string, unknown> = { id: s.id, t: s.tool, s: round1(s.size), p };
        if (s.tool !== 'eraser') stroke.c = s.color;
        if (s.pressure) stroke.pr = true;
        if (s.rotation) stroke.r = Math.round(s.rotation * 10_000) / 10_000;
        return stroke;
      });
      return out;
    }),
  };
}

/**
 * A document from stored JSON — `null` if it is not one. `images` gives a
 * layer's image by layer ID; a layer that had one whose reference is gone
 * keeps its strokes. Everything is checked and bounded, unknown parts dropped.
 */
export function paintDocFromJson(value: unknown, images: ReadonlyMap<string, string> = new Map()): PaintDoc | null {
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.layers)) return null;
  let strokesLeft = MAX_STROKES;
  let pointsLeft = MAX_POINTS;
  const seen = new Set<string>();
  const layers: PaintLayer[] = [];
  for (const raw of value.layers.slice(0, MAX_LAYERS)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !ID_RE.test(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const strokes: PaintStroke[] = [];
    for (const s of Array.isArray(raw.strokes) ? raw.strokes : []) {
      if (strokesLeft <= 0) break;
      const stroke = strokeFromJson(s, pointsLeft);
      if (!stroke) continue;
      strokes.push(stroke);
      strokesLeft -= 1;
      pointsLeft -= stroke.points.length;
    }
    layers.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME) : '',
      hidden: raw.hidden === true,
      locked: raw.locked === true,
      opacity: Number.isFinite(raw.opacity) ? clamp(raw.opacity as number, 0, 1) : 1,
      image: raw.image === true ? images.get(raw.id) ?? null : null,
      imageRect: rectFromJson(raw.imageRect),
      strokes,
    });
  }
  return layers.length ? { layers } : null;
}

function strokeFromJson(raw: unknown, pointsLeft: number): PaintStroke | null {
  if (!isRecord(raw)) return null;
  const tool = raw.t as PaintTool;
  if (!PAINT_TOOLS.includes(tool) || !Array.isArray(raw.p)) return null;
  const size = Number(raw.s);
  if (!Number.isFinite(size)) return null;
  const color = typeof raw.c === 'string' && COLOR_RE.test(raw.c) ? raw.c.toLowerCase() : '#000000';
  const count = Math.min(raw.p.length - (raw.p.length % 3), pointsLeft - (pointsLeft % 3), isShapeTool(tool) ? 6 : Infinity);
  if (count < 3) return null;
  const points = new Array<number>(count);
  for (let i = 0; i < count; i += 3) {
    const x = Number(raw.p[i]), y = Number(raw.p[i + 1]), p = Number(raw.p[i + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) return null;
    // Room around the page: a stroke may start, end or be moved outside it.
    points[i] = clamp(x, -PAINT_WIDTH * 4, PAINT_WIDTH * 4);
    points[i + 1] = clamp(y, -PAINT_HEIGHT * 4, PAINT_HEIGHT * 4);
    points[i + 2] = clamp(p, 0, 1);
  }
  return {
    id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : paintId(),
    tool,
    color,
    size: clamp(size, PAINT_SIZE_MIN, PAINT_SIZE_MAX),
    points,
    pressure: raw.pr === true,
    rotation: (tool === 'rect' || tool === 'ellipse') && Number.isFinite(raw.r) ? (raw.r as number) % (Math.PI * 2) : 0,
  };
}

function rectFromJson(raw: unknown): PaintRect {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => Number.isFinite(n))) return FULL_PAGE;
  const [x, y, width, height] = raw as number[];
  if (width < 1 || height < 1) return FULL_PAGE;
  return {
    x: clamp(x, -PAINT_WIDTH * 4, PAINT_WIDTH * 4),
    y: clamp(y, -PAINT_HEIGHT * 4, PAINT_HEIGHT * 4),
    width: Math.min(width, PAINT_WIDTH * 8),
    height: Math.min(height, PAINT_HEIGHT * 8),
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function isPaintColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_RE.test(value);
}

/* ---------------- Changes ---------------- */

export function updateLayer(doc: PaintDoc, id: string, change: (layer: PaintLayer) => PaintLayer): PaintDoc {
  return { layers: doc.layers.map((l) => (l.id === id ? change(l) : l)) };
}

export function withStroke(doc: PaintDoc, layerId: string, stroke: PaintStroke): PaintDoc {
  return updateLayer(doc, layerId, (l) => ({ ...l, strokes: [...l.strokes, stroke] }));
}

/** Moves a layer one place up (towards the top, `+1`) or down (`-1`). */
export function moveLayer(doc: PaintDoc, id: string, by: 1 | -1): PaintDoc {
  const i = doc.layers.findIndex((l) => l.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { layers };
}

/**
 * Drops points closer than `min` to the last kept one; the last point always
 * stays, so a stroke still ends where the pen lifted.
 */
export function thinPoints(points: readonly number[], min = 0.6): number[] {
  if (points.length <= 6) return [...points];
  const out = [points[0], points[1], points[2]];
  const minSq = min * min;
  for (let i = 3; i < points.length - 3; i += 3) {
    const dx = points[i] - out[out.length - 3];
    const dy = points[i + 1] - out[out.length - 2];
    if (dx * dx + dy * dy >= minSq) out.push(points[i], points[i + 1], points[i + 2]);
  }
  out.push(points[points.length - 3], points[points.length - 2], points[points.length - 1]);
  return out;
}

/* ---------------- Geometry ---------------- */

/** A move, a uniform scale and a turn around a pivot, in that order of thought: scale and turn around the pivot, then move. */
export interface PaintTransform {
  dx: number;
  dy: number;
  scale: number;
  angle: number;
  cx: number;
  cy: number;
}

export const IDENTITY: PaintTransform = { dx: 0, dy: 0, scale: 1, angle: 0, cx: 0, cy: 0 };

export function applyTransform(t: PaintTransform, x: number, y: number): [number, number] {
  const cos = Math.cos(t.angle) * t.scale, sin = Math.sin(t.angle) * t.scale;
  const px = x - t.cx, py = y - t.cy;
  return [t.cx + px * cos - py * sin + t.dx, t.cy + px * sin + py * cos + t.dy];
}

/**
 * The stroke with the transform baked in: its points move, its width
 * scales. A rectangle or ellipse keeps its two corners around its centre
 * unturned and carries the turn in `rotation`, so it stays one shape.
 */
export function transformStroke(stroke: PaintStroke, t: PaintTransform): PaintStroke {
  const size = clamp(stroke.size * t.scale, PAINT_SIZE_MIN, PAINT_SIZE_MAX);
  if (stroke.tool === 'rect' || stroke.tool === 'ellipse') {
    const [x0, y0, p0, x1, y1, p1] = stroke.points;
    const [cx, cy] = applyTransform(t, (x0 + x1) / 2, (y0 + y1) / 2);
    const hw = (Math.abs(x1 - x0) / 2) * t.scale, hh = (Math.abs(y1 - y0) / 2) * t.scale;
    return { ...stroke, id: stroke.id, size, points: [cx - hw, cy - hh, p0, cx + hw, cy + hh, p1], rotation: stroke.rotation + t.angle };
  }
  const points = [...stroke.points];
  for (let i = 0; i + 2 < points.length; i += 3) [points[i], points[i + 1]] = applyTransform(t, points[i], points[i + 1]);
  return { ...stroke, size, points };
}

/** The box around a stroke, its width included. */
export function strokeBounds(stroke: PaintStroke): PaintRect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  if ((stroke.tool === 'rect' || stroke.tool === 'ellipse') && stroke.rotation) {
    for (const [x, y] of shapeCorners(stroke)) add(x, y);
  } else {
    for (let i = 0; i + 2 < stroke.points.length; i += 3) add(stroke.points[i], stroke.points[i + 1]);
  }
  const pad = stroke.size / 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + stroke.size, height: maxY - minY + stroke.size };
}

/** The four corners of a rectangle or ellipse's box, turned with it. */
export function shapeCorners(stroke: PaintStroke): [number, number][] {
  const [x0, y0, , x1, y1] = stroke.points;
  const t: PaintTransform = { ...IDENTITY, angle: stroke.rotation, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => applyTransform(t, x, y));
}

export function unionRects(rects: readonly PaintRect[]): PaintRect | null {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The whole layer moved: its strokes and its image. */
export function translateLayer(layer: PaintLayer, dx: number, dy: number): PaintLayer {
  const t: PaintTransform = { ...IDENTITY, dx, dy };
  return {
    ...layer,
    imageRect: { ...layer.imageRect, x: layer.imageRect.x + dx, y: layer.imageRect.y + dy },
    strokes: layer.strokes.map((s) => transformStroke(s, t)),
  };
}

/**
 * Points along a stroke for picking it with a rectangle or a lasso: a
 * freehand stroke's own points, a shape's ends, corners and edge midpoints
 * (an ellipse: points around it).
 */
export function strokeSamples(stroke: PaintStroke): [number, number][] {
  const [x0, y0, , x1 = x0, y1 = y0] = stroke.points;
  if (stroke.tool === 'line') return [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]];
  if (stroke.tool === 'rect' || stroke.tool === 'ellipse') {
    const t: PaintTransform = { ...IDENTITY, angle: stroke.rotation, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    const out: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      // A rectangle's outline: the ellipse's directions pushed out to the box.
      const k = stroke.tool === 'rect' ? 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) : 1;
      out.push(applyTransform(t, t.cx + Math.cos(a) * rx * k, t.cy + Math.sin(a) * ry * k));
    }
    return out;
  }
  const out: [number, number][] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) out.push([stroke.points[i], stroke.points[i + 1]]);
  return out;
}

/** Is the point inside the polygon (even-odd)? */
export function inPolygon(x: number, y: number, polygon: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const xi = polygon[i], yi = polygon[i + 1], xj = polygon[j], yj = polygon[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A copy of the layer, with new IDs for it and its strokes. */
export function copyLayer(layer: PaintLayer): PaintLayer {
  return { ...layer, id: paintId(), strokes: layer.strokes.map((s) => ({ ...s, id: paintId() })) };
}

/**
 * Can the layer go into the one below without its look changing? Not when it
 * holds an image (that would lie under the lower layer's strokes) or eraser
 * strokes (they would cut the lower layer too).
 */
export function canMergeDown(doc: PaintDoc, id: string): boolean {
  const i = doc.layers.findIndex((l) => l.id === id);
  const layer = doc.layers[i];
  return i > 0 && !!layer && !layer.image && !layer.strokes.some((s) => s.tool === 'eraser');
}

/** The layer's strokes onto the end of the one below, the layer gone. */
export function mergeDown(doc: PaintDoc, id: string): PaintDoc {
  if (!canMergeDown(doc, id)) return doc;
  const i = doc.layers.findIndex((l) => l.id === id);
  const upper = doc.layers[i];
  const layers = doc.layers.filter((l) => l.id !== id);
  layers[i - 1] = { ...layers[i - 1], strokes: [...layers[i - 1].strokes, ...upper.strokes] };
  return { layers };
}

/** The layer moved to `index` (counted from the bottom). */
export function moveLayerTo(doc: PaintDoc, id: string, index: number): PaintDoc {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(from, 1);
  layers.splice(clamp(index, 0, layers.length), 0, layer);
  return { layers };
}
