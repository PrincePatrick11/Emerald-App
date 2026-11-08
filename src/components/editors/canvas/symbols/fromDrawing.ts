import { isBoxShape, isShapeTool, strokeBounds, type PaintDoc, type PaintStroke } from '../../../../lib/paint/document';
import { buildStrokePath } from '../paint/render';
import { SvgPath, type PathSink } from '../svg';
import { DEFAULT_WEIGHT, MAX_WEIGHT, MIN_WEIGHT } from './limits';

/** The space kept round a symbol made from a drawing, in the box of 100. */
const MARGIN = 6;

/** Passes path calls on with every point scaled by `k` and moved by (`dx`, `dy`). */
class Mapped implements PathSink {
  constructor(private readonly to: SvgPath, private readonly k: number, private readonly dx: number, private readonly dy: number) {}
  private x(v: number) { return v * this.k + this.dx; }
  private y(v: number) { return v * this.k + this.dy; }
  moveTo(x: number, y: number) { this.to.moveTo(this.x(x), this.y(y)); }
  lineTo(x: number, y: number) { this.to.lineTo(this.x(x), this.y(y)); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) { this.to.quadraticCurveTo(this.x(cx), this.y(cy), this.x(x), this.y(y)); }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.to.bezierCurveTo(this.x(a), this.y(b), this.x(c), this.y(d), this.x(x), this.y(y));
  }
  rect(x: number, y: number, w: number, h: number) { this.to.rect(this.x(x), this.y(y), w * this.k, h * this.k); }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw?: boolean) {
    this.to.ellipse(this.x(x), this.y(y), rx * this.k, ry * this.k, rotation, start, end, ccw);
  }
  closePath() { this.to.closePath(); }
}

/** A stroke that is drawn as lines of its width (an outlined shape or a line); the rest is filled. */
const isLine = (s: PaintStroke) => isShapeTool(s.tool) && !(isBoxShape(s.tool) && s.filled);

/**
 * A drawing as a symbol: its visible strokes fitted into the box of 100 ×
 * 100, the pen strokes, fills and filled shapes as filled parts (`solid`),
 * the lines and outlined shapes as lines (`d`) of their mean width. The
 * colours become the symbol's one colour; eraser strokes and layer pictures
 * are left out. `null` if nothing is drawn.
 */
export function symbolFromDrawing(doc: PaintDoc): { d: string; solid: string; weight: number } | null {
  const strokes = doc.layers.filter((l) => !l.hidden).flatMap((l) => l.strokes).filter((s) => s.tool !== 'eraser');
  if (!strokes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    const b = strokeBounds(s);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const k = (100 - MARGIN * 2) / Math.max(w, h);
  const dx = (100 - w * k) / 2 - minX * k, dy = (100 - h * k) / 2 - minY * k;

  const lines = new SvgPath();
  const solid = new SvgPath();
  const widths: number[] = [];
  for (const s of strokes) {
    if (isLine(s)) {
      buildStrokePath(s, new Mapped(lines, k, dx, dy));
      widths.push(s.size * k);
    } else {
      buildStrokePath(s, new Mapped(solid, k, dx, dy));
    }
  }
  const mean = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : DEFAULT_WEIGHT;
  return { d: lines.d, solid: solid.d, weight: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(mean * 10) / 10)) };
}
