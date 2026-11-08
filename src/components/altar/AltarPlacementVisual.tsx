import { memo } from 'react';
import type { TFunction } from 'i18next';
import { PenTool } from 'lucide-react';
import { isCandleEmoji } from '../../lib/altarConstants';
import { drawnLabel } from '../../lib/altarElements';
import type { AltarPlacement, AltarShapeStyle, AltarShapeType } from '../../types';
import { polygonPoints } from '../editors/canvas';
import { AltarItemVisual } from './AltarItemVisual';

/** Outlines of the drawn shapes in a 24×24 box, for lists and previews. */
const SHAPE_PATHS: Record<Exclude<AltarShapeType, 'polygon' | 'star'>, string> = {
  rect: 'M3 5h18v14H3z',
  ellipse: 'M12 4a9 8 0 1 0 0.01 0z',
  triangle: 'M12 3l9.5 17h-19z',
  hexagon: 'M21 12l-4.5 7.8h-9L3 12l4.5-7.8h9z',
};

/** A shape's outline in the 24×24 box; polygons and stars with their corners, as the canvas draws them. */
function shapeGlyph(shape: AltarShapeStyle | undefined): string {
  const type = shape?.type ?? 'rect';
  if (type !== 'polygon' && type !== 'star') return SHAPE_PATHS[type];
  const points = polygonPoints(type, shape?.sides ?? (type === 'star' ? 5 : 6), 12, 12, 9.5, 9.5);
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}z`;
}

/** What sits on an altar, small: the item's picture or emoji, a drawn shape or symbol, or the letter of a text. */
export const AltarPlacementVisual = memo(function AltarPlacementVisual({ placement, size, animate = true }: {
  placement: AltarPlacement;
  size: number;
  /** Candles flicker. */
  animate?: boolean;
}) {
  if (placement.kind === 'shape') {
    const shape = placement.shape;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="flex-shrink-0">
        <path
          d={shapeGlyph(shape)}
          fill={shape?.fill ?? 'none'}
          stroke={shape?.stroke ?? (shape?.fill ? 'none' : 'currentColor')}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (placement.kind === 'drawing') return <PenTool size={size} className="flex-shrink-0 text-muted" aria-hidden />;
  if (placement.kind === 'symbol') {
    const symbol = placement.symbol;
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="flex-shrink-0">
        <path d={symbol?.d} fill={symbol?.fill ?? 'none'} stroke={symbol?.color ?? 'currentColor'} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (placement.kind === 'text') {
    return (
      <span
        className="altar-text-glyph"
        style={{ fontSize: Math.round(size * 0.85), width: size, height: size, color: placement.text?.color }}
        aria-hidden
      >
        T
      </span>
    );
  }
  return <AltarItemVisual item={placement} size={size} candleAnimate={animate && isCandleEmoji(placement.emoji)} />;
});

/** The name of what sits on an altar: the item's, a text's first line, or the kind of shape. */
export function placementLabel(placement: AltarPlacement, t: TFunction): string {
  if (placement.kind === 'item') return placement.name;
  return drawnLabel(placement, (type) => t(`canvas.shape.${type}`), t('canvas.drawing'), (id) => t(`symbols.${id}`));
}
