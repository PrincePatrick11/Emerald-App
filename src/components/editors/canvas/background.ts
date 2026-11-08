import { attrs, num } from './svg';

/**
 * The artboard's background, a setting of the canvas, not an element: a fill
 * (a colour, a linear or a radial gradient, or nothing), a picture over it,
 * and a tint over both. The place stores it; the picture's `src` is the
 * place's reference, which it resolves for showing and loads for exporting.
 */
export interface CanvasBackground {
  fill: CanvasFill;
  image: { src: string; fit: 'cover' | 'contain' } | null;
  /** A colour laid over fill and picture, to darken or lighten them. */
  tint: { color: string; opacity: number } | null;
}

export type CanvasFill =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  /** `angle` in degrees as in CSS: 0 runs upward, 90 to the right. */
  | { kind: 'linear'; colors: string[]; angle: number }
  /** A circle from (`cx`, `cy`), as fractions of the artboard, out to its farthest corner. */
  | { kind: 'radial'; colors: string[]; cx: number; cy: number };

export const EMPTY_BACKGROUND: CanvasBackground = { fill: { kind: 'none' }, image: null, tint: null };

/** A gradient has two or three colours. */
export const MIN_STOPS = 2;
export const MAX_STOPS = 3;

const HEX = /^#[0-9a-f]{6}$/i;

const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const fraction = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);

/** A background from stored JSON, with anything unusable dropped; `null` if it is not one. */
export function parseCanvasBackground(v: unknown): CanvasBackground | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const f = (o.fill && typeof o.fill === 'object' ? o.fill : {}) as Record<string, unknown>;
  const colors = (Array.isArray(f.colors) ? f.colors : []).slice(0, MAX_STOPS).map((c) => hex(c, '#000000'));
  while (colors.length < MIN_STOPS) colors.push(colors[0] ?? '#000000');
  let fill: CanvasFill = { kind: 'none' };
  if (f.kind === 'color') fill = { kind: 'color', color: hex(f.color, '#000000') };
  else if (f.kind === 'linear') fill = { kind: 'linear', colors, angle: typeof f.angle === 'number' && Number.isFinite(f.angle) ? ((f.angle % 360) + 360) % 360 : 180 };
  else if (f.kind === 'radial') fill = { kind: 'radial', colors, cx: fraction(f.cx, 0.5), cy: fraction(f.cy, 0.5) };
  const i = (o.image && typeof o.image === 'object' ? o.image : null) as Record<string, unknown> | null;
  const image = i && typeof i.src === 'string' && i.src ? { src: i.src, fit: i.fit === 'contain' ? 'contain' as const : 'cover' as const } : null;
  const tn = (o.tint && typeof o.tint === 'object' ? o.tint : null) as Record<string, unknown> | null;
  const tint = tn ? { color: hex(tn.color, '#000000'), opacity: fraction(tn.opacity, 0) } : null;
  return { fill, image, tint: tint && tint.opacity > 0 ? tint : null };
}

/** Whether anything is drawn at all. */
export function hasBackground(bg: CanvasBackground | null | undefined): bg is CanvasBackground {
  return !!bg && (bg.fill.kind !== 'none' || !!bg.image || !!bg.tint);
}

function stops(colors: readonly string[]): string {
  return colors.map((c, i) => `${c} ${Math.round((i / (colors.length - 1)) * 100)}%`).join(', ');
}

function rgba(color: string, opacity: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

/** The background as a CSS `background` value; `resolve` turns the picture's reference into a URL. */
export function backgroundCss(bg: CanvasBackground, resolve: (src: string) => string): string {
  const layers: string[] = [];
  if (bg.tint) layers.push(`linear-gradient(${rgba(bg.tint.color, bg.tint.opacity)}, ${rgba(bg.tint.color, bg.tint.opacity)})`);
  if (bg.image) {
    const url = resolve(bg.image.src);
    if (url) layers.push(`url("${url.replace(/"/g, '%22')}") center / ${bg.image.fit} no-repeat`);
  }
  const f = bg.fill;
  if (f.kind === 'color') layers.push(`linear-gradient(${f.color}, ${f.color})`);
  else if (f.kind === 'linear') layers.push(`linear-gradient(${num(f.angle)}deg, ${stops(f.colors)})`);
  else if (f.kind === 'radial') layers.push(`radial-gradient(circle farthest-corner at ${num(f.cx * 100)}% ${num(f.cy * 100)}%, ${stops(f.colors)})`);
  return layers.join(', ') || 'transparent';
}

/** The ends of a CSS linear gradient's line across a `w` × `h` box. */
function linearEnds(angle: number, w: number, h: number): [number, number, number, number] {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half];
}

function farthestCorner(cx: number, cy: number, w: number, h: number): number {
  return Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
}

/** The picture's box in a `w` × `h` artboard: covering it or contained in it, centred. */
function imageBox(fit: 'cover' | 'contain', iw: number, ih: number, w: number, h: number) {
  const scale = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  return { x: (w - iw * scale) / 2, y: (h - ih * scale) / 2, width: iw * scale, height: ih * scale };
}

/** Draws the background over `w` × `h` at the origin; `image` is the loaded picture, or `null`. */
export function drawCanvasBackground(ctx: CanvasRenderingContext2D, bg: CanvasBackground, w: number, h: number, image: CanvasImageSource | null): void {
  ctx.save();
  const f = bg.fill;
  if (f.kind === 'color') {
    ctx.fillStyle = f.color;
    ctx.fillRect(0, 0, w, h);
  } else if (f.kind === 'linear' || f.kind === 'radial') {
    const g = f.kind === 'linear'
      ? ctx.createLinearGradient(...linearEnds(f.angle, w, h))
      : ctx.createRadialGradient(f.cx * w, f.cy * h, 0, f.cx * w, f.cy * h, farthestCorner(f.cx * w, f.cy * h, w, h));
    f.colors.forEach((c, i) => g.addColorStop(i / (f.colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (bg.image && image) {
    const iw = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width;
    const ih = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height;
    if (iw > 0 && ih > 0) {
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      const b = imageBox(bg.image.fit, iw, ih, w, h);
      ctx.drawImage(image, b.x, b.y, b.width, b.height);
    }
  }
  if (bg.tint) {
    ctx.fillStyle = rgba(bg.tint.color, bg.tint.opacity);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** The background as SVG content over `w` × `h`, gradients as gradients; `href` is the picture as a data URL, or `null`. */
export function backgroundSvg(bg: CanvasBackground, w: number, h: number, href: string | null, id: () => string, defs: string[]): string {
  const out: string[] = [];
  const f = bg.fill;
  const svgStops = (colors: readonly string[]) => colors.map((c, i) => `<stop${attrs({ offset: i / (colors.length - 1), 'stop-color': c })}/>`).join('');
  if (f.kind === 'color') {
    out.push(`<rect${attrs({ width: w, height: h, fill: f.color })}/>`);
  } else if (f.kind === 'linear') {
    const g = id();
    const [x1, y1, x2, y2] = linearEnds(f.angle, w, h);
    defs.push(`<linearGradient id="${g}" gradientUnits="userSpaceOnUse"${attrs({ x1, y1, x2, y2 })}>${svgStops(f.colors)}</linearGradient>`);
    out.push(`<rect${attrs({ width: w, height: h, fill: `url(#${g})` })}/>`);
  } else if (f.kind === 'radial') {
    const g = id();
    const cx = f.cx * w, cy = f.cy * h;
    defs.push(`<radialGradient id="${g}" gradientUnits="userSpaceOnUse"${attrs({ cx, cy, r: farthestCorner(cx, cy, w, h) })}>${svgStops(f.colors)}</radialGradient>`);
    out.push(`<rect${attrs({ width: w, height: h, fill: `url(#${g})` })}/>`);
  }
  if (bg.image && href) {
    out.push(`<image${attrs({ href, width: w, height: h, preserveAspectRatio: bg.image.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet' })}/>`);
  }
  if (bg.tint) out.push(`<rect${attrs({ width: w, height: h, fill: bg.tint.color, 'fill-opacity': bg.tint.opacity })}/>`);
  return out.join('');
}
