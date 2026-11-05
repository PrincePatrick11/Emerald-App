/**
 * The paint editor's document: layers of vector strokes, stored as JSON.
 *
 * A layer may carry an image under its strokes: a drawing from before the
 * vector format becomes the image of the first layer, so nothing of it is
 * lost, and the eraser takes from it as it took from the old canvas. The
 * image's file name is not part of the JSON; the place that stores the
 * document keeps it where image references are found (an `<img src>`), and
 * hands it back by layer ID.
 *
 * Pure and DOM-free: `lib/blocks/sigil.ts` and the block checks use it.
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
}

export interface PaintLayer {
  id: string;
  /** Empty: the editor numbers it. */
  name: string;
  hidden: boolean;
  /** A stored image under the strokes, filling the document. */
  image: string | null;
  strokes: PaintStroke[];
}

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
  return { id: paintId(), name, hidden: false, image: null, strokes: [] };
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
 * and the JSON sits in an attribute of the entry. Coordinates are rounded to
 * a tenth, pressure to a hundredth. Layer images are left out (see above).
 */
export function paintDocToJson(doc: PaintDoc): Record<string, unknown> {
  return {
    v: 1,
    layers: doc.layers.map((layer) => {
      const out: Record<string, unknown> = { id: layer.id };
      if (layer.name) out.name = layer.name;
      if (layer.hidden) out.hidden = true;
      if (layer.image) out.image = true;
      out.strokes = layer.strokes.map((s) => {
        const p: number[] = [];
        for (let i = 0; i + 2 < s.points.length; i += 3) p.push(round1(s.points[i]), round1(s.points[i + 1]), round2(s.points[i + 2]));
        const stroke: Record<string, unknown> = { id: s.id, t: s.tool, s: round1(s.size), p };
        if (s.tool !== 'eraser') stroke.c = s.color;
        if (s.pressure) stroke.pr = true;
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
      image: raw.image === true ? images.get(raw.id) ?? null : null,
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
    // Room around the page: a stroke may start or end outside it.
    points[i] = clamp(x, -PAINT_WIDTH, PAINT_WIDTH * 2);
    points[i + 1] = clamp(y, -PAINT_HEIGHT, PAINT_HEIGHT * 2);
    points[i + 2] = clamp(p, 0, 1);
  }
  return {
    id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : paintId(),
    tool,
    color,
    size: clamp(size, PAINT_SIZE_MIN, PAINT_SIZE_MAX),
    points,
    pressure: raw.pr === true,
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
