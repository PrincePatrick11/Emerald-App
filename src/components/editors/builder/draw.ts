import type {
  BuilderElement, BuilderFont, BuilderImageElement, BuilderShapeElement, BuilderTextElement,
} from './types';

/**
 * Drawing an element onto a 2D context, shared by the stage and the export so
 * both show the same. The context's origin is the element box's top-left
 * corner; rotation, position and opacity are the caller's.
 */

/** The CSS families behind the builder's fonts — all bundled with the app (`fonts.css`). */
export const FONT_FAMILIES: Record<BuilderFont, string> = {
  serif: '"Cormorant Garamond", Georgia, serif',
  book: 'Lora, Georgia, serif',
  sans: 'Inter, system-ui, sans-serif',
};

export const TEXT_LINE_HEIGHT = 1.25;

export function fontString(el: Pick<BuilderTextElement, 'font' | 'fontSize' | 'bold' | 'italic'>): string {
  return `${el.italic ? 'italic ' : ''}${el.bold ? 600 : 400} ${el.fontSize}px ${FONT_FAMILIES[el.font]}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/**
 * The lines of a text box: explicit line breaks, then words wrapped at the
 * box's width; a word longer than the width breaks between characters.
 */
export function layoutText(el: Pick<BuilderTextElement, 'text' | 'width' | 'font' | 'fontSize' | 'bold' | 'italic'>): string[] {
  const ctx = measurer();
  const paragraphs = el.text.split('\n');
  if (!ctx) return paragraphs;
  ctx.font = fontString(el);
  const max = Math.max(1, el.width);
  const lines: string[] = [];
  const fits = (s: string) => ctx.measureText(s).width <= max;
  for (const paragraph of paragraphs) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (fits(line + token)) {
        line += token;
        continue;
      }
      // Spaces at a break vanish.
      if (!token.trim()) {
        lines.push(line.trimEnd());
        line = '';
        continue;
      }
      if (line.trim()) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (fits(token)) {
        line = token;
        continue;
      }
      // A single word wider than the box: break it between characters.
      for (const char of token) {
        if (line && !fits(line + char)) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The height a text box needs for its lines. */
export function textHeight(el: Parameters<typeof layoutText>[0]): number {
  return Math.max(1, layoutText(el).length) * el.fontSize * TEXT_LINE_HEIGHT;
}

/** The outline of a shape in its box, as a path on `ctx`. */
export function shapePath(ctx: CanvasRenderingContext2D, el: Pick<BuilderShapeElement, 'shape' | 'width' | 'height' | 'cornerRadius'>): void {
  const { width: w, height: h } = el;
  ctx.beginPath();
  switch (el.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(el.cornerRadius, w / 2, h / 2));
      if (r > 0) ctx.roundRect(0, 0, w, h, r);
      else ctx.rect(0, 0, w, h);
      break;
    }
    case 'ellipse':
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    case 'star': {
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? 1 : 0.42;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        const px = w / 2 + Math.cos(angle) * (w / 2) * radius;
        const py = h / 2 + Math.sin(angle) * (h / 2) * radius * 1.05 + h * 0.03;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const px = w / 2 + Math.cos(angle) * (w / 2);
        const py = h / 2 + Math.sin(angle) * (h / 2);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
  }
}

function drawShape(ctx: CanvasRenderingContext2D, el: BuilderShapeElement): void {
  shapePath(ctx, el);
  if (el.fill) {
    ctx.fillStyle = el.fill;
    ctx.fill();
  }
  if (el.stroke && el.strokeWidth > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function drawText(ctx: CanvasRenderingContext2D, el: BuilderTextElement): void {
  const lines = layoutText(el);
  const lineHeight = el.fontSize * TEXT_LINE_HEIGHT;
  ctx.font = fontString(el);
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = el.align;
  const x = el.align === 'left' ? 0 : el.align === 'right' ? el.width : el.width / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, i * lineHeight + lineHeight / 2));
}

/**
 * The flicker of a flame at `time` (ms): small changes of height, width and
 * brightness, as the altar's candles had as a CSS animation.
 */
function flicker(time: number): { sx: number; sy: number; alpha: number } {
  const t = (time / 1800) * Math.PI * 2;
  return {
    sx: 1 + 0.03 * Math.sin(t * 2 + 1),
    sy: 1 + 0.04 * Math.sin(t * 2),
    alpha: 0.92 + 0.08 * Math.sin(t * 3 + 0.5),
  };
}

function drawImage(ctx: CanvasRenderingContext2D, el: BuilderImageElement, image: CanvasImageSource | null, time: number | null): void {
  const { width: w, height: h } = el;
  if (el.flame) {
    ctx.shadowColor = '#ff8c00';
    ctx.shadowBlur = Math.max(w, h) * 0.12;
    if (time !== null) {
      const { sx, sy, alpha } = flicker(time);
      ctx.globalAlpha *= alpha;
      ctx.translate(w / 2, h);
      ctx.scale(sx, sy);
      ctx.translate(-w / 2, -h);
    }
  }
  if (image) {
    const iw = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width;
    const ih = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height;
    if (iw > 0 && ih > 0) {
      const scale = Math.min(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return;
    }
  }
  ctx.font = `${Math.round(Math.max(w, h) * 0.8)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(el.emoji, w / 2, h / 2);
}

export interface DrawOptions {
  /** The loaded picture of an image element, or `null` while it loads (the emoji stands in). */
  image?: CanvasImageSource | null;
  /** For flames: the moment to draw, or `null` for a still picture. */
  time?: number | null;
}

/** Draws `el` with its box's top-left corner at the origin. */
export function drawElement(ctx: CanvasRenderingContext2D, el: BuilderElement, options: DrawOptions = {}): void {
  ctx.save();
  switch (el.kind) {
    case 'image':
      drawImage(ctx, el, options.image ?? null, options.time ?? null);
      break;
    case 'shape':
      drawShape(ctx, el);
      break;
    case 'text':
      drawText(ctx, el);
      break;
  }
  ctx.restore();
}

/** Draws `el` where it sits on the artboard: position, rotation and opacity applied. */
export function drawPlaced(ctx: CanvasRenderingContext2D, el: BuilderElement, options: DrawOptions = {}): void {
  ctx.save();
  ctx.translate(el.x, el.y);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);
  ctx.globalAlpha *= el.opacity;
  drawElement(ctx, el, options);
  ctx.restore();
}
