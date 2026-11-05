import type { Box } from './geometry';

/** A line to draw while snapping, across the artboard, in artboard pixels. */
export interface Guide {
  orientation: 'vertical' | 'horizontal';
  at: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * Snaps a moving box to the artboard's edges and centre and to the edges and
 * centres of the other boxes: each axis on its own, to the nearest line within
 * `threshold`. Returns the shift to apply and the lines it snapped to.
 */
export function snapToGuides(moving: Box, others: readonly Box[], artboard: { width: number; height: number }, threshold: number): SnapResult {
  const verticalStops = [0, artboard.width / 2, artboard.width];
  const horizontalStops = [0, artboard.height / 2, artboard.height];
  for (const b of others) {
    verticalStops.push(b.x, b.x + b.width / 2, b.x + b.width);
    horizontalStops.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  const vertical = nearest([moving.x, moving.x + moving.width / 2, moving.x + moving.width], verticalStops, threshold);
  const horizontal = nearest([moving.y, moving.y + moving.height / 2, moving.y + moving.height], horizontalStops, threshold);
  const guides: Guide[] = [];
  if (vertical) guides.push({ orientation: 'vertical', at: vertical.stop });
  if (horizontal) guides.push({ orientation: 'horizontal', at: horizontal.stop });
  return { dx: vertical?.shift ?? 0, dy: horizontal?.shift ?? 0, guides };
}

function nearest(edges: number[], stops: number[], threshold: number): { shift: number; stop: number } | null {
  let best: { shift: number; stop: number } | null = null;
  for (const edge of edges) {
    for (const stop of stops) {
      const shift = stop - edge;
      if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, stop };
    }
  }
  return best;
}

/** A value on the nearest multiple of `step`. */
export function snapToStep(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

