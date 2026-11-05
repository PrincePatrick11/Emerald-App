import { memo } from 'react';
import type { AltarPlacement, AltarRecord } from '../../types';
import { getAltarBackgroundStyle, resolveResolutionPixels } from '../../lib/altarConstants';
import { AltarPlacementVisual } from './AltarPlacementVisual';
import { imageSrc } from '../../lib/images';

export const AltarCardPreview = memo(function AltarCardPreview({
  altar,
  previewItems,
  compact = false,
}: {
  altar: AltarRecord;
  previewItems: AltarPlacement[];
  compact?: boolean;
}) {
  const previewSrc = imageSrc(altar.background_image_data);
  const background = getAltarBackgroundStyle(altar, previewSrc);
  const { w, h } = resolveResolutionPixels(altar.resolution ?? '1920x1080');

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-edge ${compact ? 'h-8 w-8' : 'w-full'}`}
      style={{ background, ...(compact ? {} : { aspectRatio: `${w}/${h}` }) }}
    >
      <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-edge-strong to-transparent pointer-events-none" />
      <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-well to-transparent pointer-events-none" />
      {previewItems.filter((placement) => !placement.hidden).slice(0, compact ? 1 : 7).map((placement) => {
        const size = compact
          ? 16
          : Math.max(16, Math.min(52, Math.round((placement.width ?? 8) * 2)));
        return (
          <div
            key={placement.id}
            className="absolute flex items-center justify-center"
            style={{
              left: `${placement.x}%`,
              top: `${placement.y}%`,
              transform: 'translate(-50%, -50%)',
              width: size,
              height: size,
            }}
          >
            <AltarPlacementVisual placement={placement} size={size} />
          </div>
        );
      })}
    </div>
  );
});
