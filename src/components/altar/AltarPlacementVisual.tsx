import { memo } from 'react';
import type { TFunction } from 'i18next';
import { PenTool } from 'lucide-react';
import { isCandleEmoji } from '../../lib/altarConstants';
import { drawnLabel } from '../../lib/altarElements';
import type { AltarPlacement, AltarShapeType } from '../../types';
import { AltarItemVisual } from './AltarItemVisual';

/** Outlines of the drawn shapes in a 24×24 box, for lists and previews. */
const SHAPE_PATHS: Record<AltarShapeType, string> = {
  rect: 'M3 5h18v14H3z',
  ellipse: 'M12 4a9 8 0 1 0 0.01 0z',
  triangle: 'M12 3l9.5 17h-19z',
  star: 'M12 2.5l2.8 6.2 6.7.6-5.1 4.4 1.6 6.6L12 16.8l-6 3.5 1.6-6.6-5.1-4.4 6.7-.6z',
  hexagon: 'M21 12l-4.5 7.8h-9L3 12l4.5-7.8h9z',
};

/** What sits on an altar, small: the item's picture or emoji, a drawn shape, or the letter of a text. */
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
          d={SHAPE_PATHS[shape?.type ?? 'rect']}
          fill={shape?.fill ?? 'none'}
          stroke={shape?.stroke ?? (shape?.fill ? 'none' : 'currentColor')}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (placement.kind === 'drawing') return <PenTool size={size} className="flex-shrink-0 text-muted" aria-hidden />;
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
  return drawnLabel(placement, (type) => t(`canvas.shape.${type}`), t('canvas.drawing'));
}
