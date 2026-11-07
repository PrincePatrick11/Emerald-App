/**
 * Writing SVG: a path that records the canvas path calls as path data, and
 * the escaping of text and attributes. The SVG export of the canvas editor
 * builds on these (`exportImage.ts`), and the types' `svg` use them.
 */

/** The path calls the drawing code makes, met by `Path2D` and by `SvgPath` alike. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw?: boolean): void;
  closePath(): void;
}

/** A number for path data and attributes: rounded to hundredths, without trailing zeros. */
export function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Path data from canvas path calls. */
export class SvgPath implements PathSink {
  private parts: string[] = [];
  private open = false;

  get d(): string {
    return this.parts.join('');
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Starts over, like `beginPath` on a context. */
  beginPath(): void {
    this.parts = [];
    this.open = false;
  }

  moveTo(x: number, y: number): void {
    this.parts.push(`M${num(x)} ${num(y)}`);
    this.open = true;
  }

  lineTo(x: number, y: number): void {
    this.parts.push(`${this.open ? 'L' : 'M'}${num(x)} ${num(y)}`);
    this.open = true;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.open) this.moveTo(cpx, cpy);
    this.parts.push(`Q${num(cpx)} ${num(cpy)} ${num(x)} ${num(y)}`);
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    if (!this.open) this.moveTo(cp1x, cp1y);
    this.parts.push(`C${num(cp1x)} ${num(cp1y)} ${num(cp2x)} ${num(cp2y)} ${num(x)} ${num(y)}`);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.parts.push(`M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`);
    this.open = false;
  }

  /** A rectangle with rounded corners, all of radius `r`. */
  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const k = Math.max(0, Math.min(r, w / 2, h / 2));
    if (!k) { this.rect(x, y, w, h); return; }
    const a = `A${num(k)} ${num(k)} 0 0 1`;
    this.parts.push(
      `M${num(x + k)} ${num(y)}H${num(x + w - k)}${a} ${num(x + w)} ${num(y + k)}V${num(y + h - k)}${a} ${num(x + w - k)} ${num(y + h)}`
      + `H${num(x + k)}${a} ${num(x)} ${num(y + h - k)}V${num(y + k)}${a} ${num(x + k)} ${num(y)}Z`,
    );
    this.open = false;
  }

  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw = false): void {
    const point = (a: number) => {
      const px = rx * Math.cos(a), py = ry * Math.sin(a);
      return [x + px * Math.cos(rotation) - py * Math.sin(rotation), y + px * Math.sin(rotation) + py * Math.cos(rotation)];
    };
    let sweep = ccw ? start - end : end - start;
    const full = sweep >= Math.PI * 2 - 1e-9;
    if (!full) sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const [sx, sy] = point(start);
    this.parts.push(`${this.open ? 'L' : 'M'}${num(sx)} ${num(sy)}`);
    this.open = true;
    const deg = num((rotation * 180) / Math.PI);
    const dir = ccw ? -1 : 1;
    // An arc command cannot close a full turn, so it goes in halves.
    const steps = full ? 2 : sweep > Math.PI ? 2 : 1;
    const step = (full ? Math.PI * 2 : sweep) / steps;
    for (let i = 1; i <= steps; i++) {
      const [ex, ey] = point(start + dir * step * i);
      this.parts.push(`A${num(rx)} ${num(ry)} ${deg} ${step > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${num(ex)} ${num(ey)}`);
    }
    if (full) this.closePath();
  }

  closePath(): void {
    this.parts.push('Z');
    this.open = false;
  }
}

/** Text for SVG content or an attribute value. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** An element's attributes from a record; `null`, `undefined` and `false` are left out. */
export function attrs(values: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? num(v) : esc(String(v))}"`)
    .join('');
}
