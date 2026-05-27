export function AltarItemVisual({
  item,
  size = 24,
  candleAnimate = false,
}: {
  item: { emoji: string; image_data?: string; category?: string };
  size?: number;
  candleAnimate?: boolean;
}) {
  if (item.image_data) {
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
}
