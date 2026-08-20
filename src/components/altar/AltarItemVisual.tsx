import { memo } from 'react';

// memo prevents re-renders when item reference changes but values are the same,
// which happens on every drag frame for non-dragged items due to the placements
// array being replaced in the store on each movePlacement call.
export const AltarItemVisual = memo(function AltarItemVisual({
  item,
  size = 24,
  candleAnimate = false,
}: {
  item: { emoji: string; image_data?: string };
  size?: number;
  candleAnimate?: boolean;
}) {
  if (item.image_data?.startsWith('data:image/')) {
    return (
      <img
        src={item.image_data}
        alt=""
        style={{ width: size, height: size }}
        className="object-contain rounded"
        draggable={false}
      />
    );
  }

  return (
    <span
      className={`leading-none select-none ${candleAnimate ? 'candle-flame' : ''}`}
      style={{ fontSize: Math.round(size * 0.8) }}
    >
      {item.emoji}
    </span>
  );
});
