import { PAINT_HEIGHT, PAINT_WIDTH, type PaintDoc } from '../../../../lib/paint/document';
import { drawPaintDoc, type LayerImages } from './render';

/**
 * The paint bucket, made a vector: the area around a spot that looks like
 * the spot (on what is visible of the drawing, at the document's own size),
 * as closed outlines with its holes. The area is flooded on the pixels, grown
 * by a pixel so it tucks under the soft edges of the lines around it, traced
 * along the pixel edges, and straightened (Douglas–Peucker); the renderer
 * draws the outlines with curves through their midpoints, so they come out
 * smooth. The result is a stroke like any other: it can be selected, moved,
 * scaled and undone, and stays sharp at every size.
 */

/** How far a pixel's colour may differ from the spot's, per channel (0–255). */
const TOLERANCE = 40;
/** How far the outline may leave the pixel edges when straightened, in pixels. */
const SIMPLIFY = 0.8;
/** Outlines around fewer pixels than this are specks and left out. */
const MIN_AREA = 4;

/** The area around (`x`, `y`), in document units, or `null` when the spot is outside the page. */
export function fillArea(doc: PaintDoc, images: LayerImages, x: number, y: number): number[][] | null {
  const W = PAINT_WIDTH, H = PAINT_HEIGHT;
  const sx = Math.floor(x), sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  drawPaintDoc(ctx, doc, images);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    // A layer image that cannot be read: nothing to fill on.
    return null;
  }

  // Flood: every pixel reachable from the spot whose colour is close to the spot's.
  const seed = (sy * W + sx) * 4;
  const [r0, g0, b0, a0] = [data[seed], data[seed + 1], data[seed + 2], data[seed + 3]];
  const like = (i: number) => {
    const p = i * 4;
    const a = data[p + 3];
    // Two nearly clear pixels are alike whatever their colour.
    if (a0 < TOLERANCE && a < TOLERANCE) return true;
    return Math.abs(a - a0) <= TOLERANCE && Math.abs(data[p] - r0) <= TOLERANCE
      && Math.abs(data[p + 1] - g0) <= TOLERANCE && Math.abs(data[p + 2] - b0) <= TOLERANCE;
  };
  const filled = new Uint8Array(W * H);
  const stack = [sy * W + sx];
  filled[sy * W + sx] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % W, py = (i - px) / W;
    if (px > 0 && !filled[i - 1] && like(i - 1)) { filled[i - 1] = 1; stack.push(i - 1); }
    if (px < W - 1 && !filled[i + 1] && like(i + 1)) { filled[i + 1] = 1; stack.push(i + 1); }
    if (py > 0 && !filled[i - W] && like(i - W)) { filled[i - W] = 1; stack.push(i - W); }
    if (py < H - 1 && !filled[i + W] && like(i + W)) { filled[i + W] = 1; stack.push(i + W); }
  }

  // Grown by one pixel, under the lines' soft edges.
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!filled[i]) continue;
    const px = i % W;
    mask[i] = 1;
    if (px > 0) mask[i - 1] = 1;
    if (px < W - 1) mask[i + 1] = 1;
    if (i >= W) mask[i - W] = 1;
    if (i < W * (H - 1)) mask[i + W] = 1;
  }

  const rings = traceOutlines(mask, W, H)
    .filter((ring) => Math.abs(ringArea(ring)) >= MIN_AREA)
    .map((ring) => simplifyRing(ring, SIMPLIFY))
    .filter((ring) => ring.length >= 6);
  return rings.length ? rings : null;
}

/**
 * The outlines of the set pixels, along the pixel edges: every edge between a
 * set and a clear pixel, directed so the set side is on the right (clockwise
 * around an area, the other way around a hole), chained into closed rings.
 * Where two areas touch at a corner, a ring turns right, which keeps them apart.
 */
function traceOutlines(mask: Uint8Array, W: number, H: number): number[][] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const V = W + 1;
  // Out-edges per vertex: up to two (where areas touch at a corner). Direction 0 right, 1 down, 2 left, 3 up.
  const out = new Map<number, number[]>();
  const add = (x: number, y: number, dir: number) => {
    const key = y * V + x;
    const list = out.get(key);
    if (list) list.push(dir);
    else out.set(key, [dir]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!at(x, y - 1)) add(x, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, 3);
    }
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const rings: number[][] = [];
  for (const [startKey, dirs] of out) {
    while (dirs.length) {
      const ring: number[] = [];
      let key = startKey;
      let dir = dirs.pop()!;
      for (let guard = 0; guard < 4 * W * H; guard++) {
        const x = key % V, y = (key - x) / V;
        ring.push(x, y);
        key = (y + DY[dir]) * V + (x + DX[dir]);
        // Back at the start: the ring is closed (another edge leaving there starts a ring of its own).
        if (key === startKey) break;
        const next = out.get(key);
        if (!next || !next.length) break;
        // Prefer a right turn, then straight on, then left.
        const pick = [(dir + 1) % 4, dir, (dir + 3) % 4].find((d) => next.includes(d)) ?? next[0];
        next.splice(next.indexOf(pick), 1);
        dir = pick;
      }
      rings.push(dropStraight(ring));
    }
  }
  return rings;
}

/** Drops the corners of a ring that lie on a straight line between their neighbours. */
function dropStraight(ring: number[]): number[] {
  const n = ring.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + n - 1) % n) * 2, b = i * 2, c = ((i + 1) % n) * 2;
    const cross = (ring[b] - ring[a]) * (ring[c + 1] - ring[b + 1]) - (ring[b + 1] - ring[a + 1]) * (ring[c] - ring[b]);
    if (cross !== 0) out.push(ring[b], ring[b + 1]);
  }
  return out;
}

function ringArea(ring: number[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return area / 2;
}

/** Douglas–Peucker on a closed ring, split at its first corner and the corner farthest from it. */
function simplifyRing(ring: number[], epsilon: number): number[] {
  const n = ring.length / 2;
  if (n <= 4) return ring;
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i * 2] - ring[0], ring[i * 2 + 1] - ring[1]);
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const point = (i: number) => [ring[(i % n) * 2], ring[(i % n) * 2 + 1]];
  const walk = (from: number, to: number) => {
    const stack: [number, number][] = [[from, to]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      if (e - s < 2) continue;
      const [ax, ay] = point(s), [bx, by] = point(e);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let worst = -1, at = -1;
      for (let i = s + 1; i < e; i++) {
        const [px, py] = point(i);
        const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
        if (d > worst) { worst = d; at = i; }
      }
      if (worst > epsilon) {
        keep[at % n] = 1;
        stack.push([s, at], [at, e]);
      }
    }
  };
  walk(0, far);
  walk(far, n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i * 2], ring[i * 2 + 1]);
  return out;
}
