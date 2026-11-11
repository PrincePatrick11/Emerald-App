import { num } from '../svg';

/**
 * Small builders for the symbols' path data, in a box of 100 × 100. A symbol
 * is drawn as lines of the element's weight, so its paths are centre lines:
 * a circle is its outline, not a filled disc.
 */

/** A circle as two half arcs. */
export function circle(cx: number, cy: number, r: number): string {
  return `M${num(cx - r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 1 ${num(cx + r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 1 ${num(cx - r)} ${num(cy)}Z`;
}

/** A line from point to point. */
export function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M${num(x1)} ${num(y1)}L${num(x2)} ${num(y2)}`;
}

/** A polyline through the points, closed if asked. */
export function poly(points: readonly (readonly [number, number])[], closed = false): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('') + (closed ? 'Z' : '');
}

/** The corners of a regular polygon in a circle, the first at the top (or `start` degrees from it). */
export function corners(n: number, cx = 50, cy = 50, r = 40, start = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((start + (i * 360) / n - 90) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/** A star polygon {n/k}: every k-th corner joined, in as many closed runs as it takes; turned by `start` degrees. */
export function starPolygon(n: number, k: number, cx = 50, cy = 50, r = 40, start = 0): string {
  const pts = corners(n, cx, cy, r, start);
  const seen = new Set<number>();
  let d = '';
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue;
    const run: [number, number][] = [];
    let i = s;
    do {
      seen.add(i);
      run.push(pts[i]);
      i = (i + k) % n;
    } while (i !== s);
    d += poly(run, true);
  }
  return d;
}

/** A point at `deg` degrees from the top, clockwise, `r` from the centre. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

/** An Archimedean spiral from the centre outward, `turns` times round, as a polyline. */
export function spiral(cx: number, cy: number, r: number, turns: number): string {
  const steps = Math.round(turns * 36);
  return poly(Array.from({ length: steps + 1 }, (_, i) => polar(cx, cy, (r * i) / steps, (i / steps) * turns * 360)));
}

/** A lens between two points: two arcs of radius `bulge` × their distance. */
export function lens(x1: number, y1: number, x2: number, y2: number, bulge = 0.62): string {
  const r = Math.hypot(x2 - x1, y2 - y1) * bulge;
  return `M${num(x1)} ${num(y1)}A${num(r)} ${num(r)} 0 0 1 ${num(x2)} ${num(y2)}A${num(r)} ${num(r)} 0 0 1 ${num(x1)} ${num(y1)}Z`;
}

/** Several paths as one. */
export function join(...parts: string[]): string {
  return parts.join('');
}
