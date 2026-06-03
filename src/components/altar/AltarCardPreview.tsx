import { memo } from 'react';
import type { AltarPlacement, AltarRecord } from '../../types';
import { ALTAR_BACKGROUND_PRESETS, ALTAR_BACKGROUND_STYLES, DEFAULT_ALTAR_BACKGROUND } from '../../lib/altarConstants';
import { AltarItemVisual } from './AltarItemVisual';
import { useBackgroundPreview } from './useAltarBackgroundPreview';

function resolvePresetStyle(altar: AltarRecord): string {
  const preset = ALTAR_BACKGROUND_PRESETS.includes(altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number])
    ? altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number]
    : DEFAULT_ALTAR_BACKGROUND;
  return ALTAR_BACKGROUND_STYLES[preset];
}

function buildImageStyle(imageSrc: string): string {
  return `linear-gradient(rgba(10, 10, 15, 0.35), rgba(10, 10, 15, 0.55)), url("${imageSrc}") center / cover no-repeat`;
}

export const AltarCardPreview = memo(function AltarCardPreview({
  altar,
  previewItems,
  compact = false,
}: {
  altar: AltarRecord;
  previewItems: AltarPlacement[];
  compact?: boolean;
}) {
  const previewSrc = useBackgroundPreview(altar.background_image_data);
  const hasImage = !!previewSrc?.startsWith('data:');
  const background = hasImage && previewSrc ? buildImageStyle(previewSrc) : resolvePresetStyle(altar);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-stone-700/40 ${compact ? 'h-8 w-8' : 'h-36 w-full'}`}
      style={{ background }}
    >
      <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-stone-700/50 to-transparent pointer-events-none" />
      <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-stone-800/30 to-transparent pointer-events-none" />
      {previewItems.slice(0, compact ? 1 : 7).map((placement) => {
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
            <AltarItemVisual item={placement} size={size} candleAnimate={placement.category === 'candle'} />
          </div>
        );
      })}
    </div>
  );
});
