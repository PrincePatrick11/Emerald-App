import type { CanvasDrawEnv, CanvasElement, CanvasTypes } from './types';

/**
 * Drawing an element through its type, shared by the stage and the export so
 * both show the same. An element whose type is not registered is drawn as a
 * dashed box, so it stays visible and can be moved or removed.
 */
export function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, types: CanvasTypes, env: CanvasDrawEnv): void {
  ctx.save();
  const type = types[el.type];
  if (type) {
    type.draw(ctx, el, env);
  } else {
    ctx.strokeStyle = '#888888';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, el.width, el.height);
  }
  ctx.restore();
}

/** Draws `el` where it sits on the artboard: position, rotation and opacity applied. */
export function drawPlaced(ctx: CanvasRenderingContext2D, el: CanvasElement, types: CanvasTypes, env: CanvasDrawEnv): void {
  ctx.save();
  ctx.translate(el.x, el.y);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);
  ctx.globalAlpha *= el.opacity;
  drawElement(ctx, el, types, env);
  ctx.restore();
}

/** The picture sources and fonts the given elements draw with. */
export function resourcesOf(elements: readonly CanvasElement[], types: CanvasTypes): { sources: string[]; fonts: string[] } {
  const sources = new Set<string>();
  const fonts = new Set<string>();
  for (const el of elements) {
    const type = types[el.type];
    for (const src of type?.sources?.(el) ?? []) if (src) sources.add(src);
    for (const font of type?.fonts?.(el) ?? []) fonts.add(font);
  }
  return { sources: [...sources], fonts: [...fonts] };
}
