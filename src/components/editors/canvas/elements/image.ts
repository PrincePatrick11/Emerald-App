import type { CanvasElement, CanvasElementType } from '../types';
import { attrs, esc } from '../svg';

/** A picture, contained in its box; without a loaded source, the emoji. */
export interface ImageProps {
  src: string | null;
  emoji: string;
  /** A warm glow that flickers (a candle). */
  glow?: boolean;
}

export type ImageElement = CanvasElement<ImageProps>;

/**
 * The flicker of a flame at `time` (ms): small changes of height, width and
 * brightness.
 */
function flicker(time: number): { sx: number; sy: number; alpha: number } {
  const t = (time / 1800) * Math.PI * 2;
  return {
    sx: 1 + 0.03 * Math.sin(t * 2 + 1),
    sy: 1 + 0.04 * Math.sin(t * 2),
    alpha: 0.92 + 0.08 * Math.sin(t * 3 + 0.5),
  };
}

export const imageType: CanvasElementType<ImageProps> = {
  type: 'image',
  label: (el, t) => (el.props.src || !el.props.emoji ? t('canvas.image') : el.props.emoji),
  keepRatio: true,
  handles: 'corners',
  sources: (el) => [el.props.src],
  animated: (el) => !!el.props.glow,
  svg: (el, env) => {
    const { width: w, height: h } = el;
    let glow: string | null = null;
    if (el.props.glow) {
      glow = env.id();
      // The canvas's shadowBlur is about twice the Gaussian's deviation.
      env.defs.push(`<filter id="${glow}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0"${attrs({ stdDeviation: Math.max(w, h) * 0.06 })} flood-color="#ff8c00"/></filter>`);
    }
    const filter = glow ? `url(#${glow})` : null;
    const href = el.props.src ? env.href(el.props.src) : null;
    if (href) return `<image${attrs({ href, width: w, height: h, preserveAspectRatio: 'xMidYMid meet', filter })}/>`;
    return `<text${attrs({
      x: w / 2, y: h / 2, 'font-size': Math.round(Math.max(w, h) * 0.8), 'font-family': 'serif',
      'text-anchor': 'middle', 'dominant-baseline': 'central', filter,
    })}>${esc(el.props.emoji)}</text>`;
  },
  draw: (ctx, el, env) => {
    const { width: w, height: h } = el;
    if (el.props.glow) {
      ctx.shadowColor = '#ff8c00';
      ctx.shadowBlur = Math.max(w, h) * 0.12;
      if (env.time !== null) {
        const { sx, sy, alpha } = flicker(env.time);
        ctx.globalAlpha *= alpha;
        ctx.translate(w / 2, h);
        ctx.scale(sx, sy);
        ctx.translate(-w / 2, -h);
      }
    }
    const image = el.props.src ? env.image(el.props.src) : null;
    if (image) {
      const iw = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width;
      const ih = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height;
      if (iw > 0 && ih > 0) {
        const scale = Math.min(w / iw, h / ih);
        ctx.drawImage(image, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
        return;
      }
    }
    // Opaque: WebKit draws a colour emoji with the alpha of the current fill,
    // which may still be whatever the caller painted last (an overlay).
    ctx.fillStyle = '#000000';
    ctx.font = `${Math.round(Math.max(w, h) * 0.8)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.props.emoji, w / 2, h / 2);
  },
};
