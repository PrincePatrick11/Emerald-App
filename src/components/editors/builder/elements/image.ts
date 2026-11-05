import type { BuilderElement, BuilderElementType } from '../types';

/** A picture, contained in its box; without a loaded source, the emoji. */
export interface ImageProps {
  src: string | null;
  emoji: string;
  /** A warm glow that flickers (a candle). */
  glow?: boolean;
}

export type ImageElement = BuilderElement<ImageProps>;

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

export const imageType: BuilderElementType<ImageProps> = {
  type: 'image',
  keepRatio: true,
  handles: 'corners',
  sources: (el) => [el.props.src],
  animated: (el) => !!el.props.glow,
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
