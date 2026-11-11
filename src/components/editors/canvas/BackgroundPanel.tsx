import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Minus, Plus, Trash2, Wallpaper } from 'lucide-react';
import PopoverButton from '../shared/PopoverButton';
import Button from '../../ui/Button';
import SegmentedControl, { type SegmentOption } from '../../ui/SegmentedControl';
import { ColorPanel, RangeField } from './elements/controlParts';
import { MAX_STOPS, MIN_STOPS, backgroundCss, type CanvasBackground, type CanvasFill } from './background';

/** What the place offers for the background's picture. */
export interface CanvasBackgroundImages {
  /** The picture's reference as a URL to show. */
  resolve: (src: string) => string;
  /** Lets the user choose a picture; its reference, or `null` if nothing was chosen. */
  pick: () => Promise<string | null>;
}

type FillKind = CanvasFill['kind'];

/** Where a radial gradient starts: the top, the middle, or the bottom of the artboard. */
const RADIAL_CENTRES = [
  { key: 'top', cy: 0.25 },
  { key: 'middle', cy: 0.5 },
  { key: 'bottom', cy: 0.75 },
] as const;

/** The colours a fill carries over when its kind changes: a colour becomes a gradient's first stop, and back. */
function fillOfKind(kind: FillKind, from: CanvasFill): CanvasFill {
  const colors = from.kind === 'linear' || from.kind === 'radial' ? from.colors
    : from.kind === 'color' ? [from.color, '#0a0a0f'] : ['#2b253d', '#0a0a0f'];
  switch (kind) {
    case 'none': return { kind: 'none' };
    case 'color': return { kind: 'color', color: colors[0] };
    case 'linear': return { kind: 'linear', colors, angle: from.kind === 'linear' ? from.angle : 180 };
    case 'radial': return { kind: 'radial', colors, cx: 0.5, cy: from.kind === 'radial' ? from.cy : 0.25 };
  }
}

/**
 * The bar's background button and its panel: the fill (none, a colour, a
 * linear or radial gradient of two or three colours), a picture over it
 * (covering or contained), and a tint over both. Every change applies at once.
 */
export default function BackgroundPanel({ value, onChange, images, onDismiss }: {
  value: CanvasBackground;
  onChange: (background: CanvasBackground) => void;
  images?: CanvasBackgroundImages;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const [stop, setStop] = useState(0);
  const [picking, setPicking] = useState(false);
  const { fill, image, tint } = value;
  const set = (patch: Partial<CanvasBackground>) => onChange({ ...value, ...patch });
  const setFill = (next: CanvasFill) => set({ fill: next });
  const gradient = fill.kind === 'linear' || fill.kind === 'radial' ? fill : null;
  const current = Math.min(stop, (gradient?.colors.length ?? 1) - 1);

  const segment = <T extends string>(options: SegmentOption<T>[], active: T | null, pick: (v: T) => void) => (
    <SegmentedControl options={options} value={active} onChange={pick} className="canvas-bg-segments" />
  );

  const choosePicture = async () => {
    if (!images || picking) return;
    setPicking(true);
    try {
      const src = await images.pick();
      if (src) set({ image: { src, fit: image?.fit ?? 'cover' } });
    } finally {
      setPicking(false);
    }
  };

  return (
    <PopoverButton
      icon={<Wallpaper size={14} />}
      title={t('canvas.background.title')}
      active={false}
      onDismiss={onDismiss}
    >
      {() => (
        <div className="canvas-panel canvas-bg-panel">
          <div className="canvas-bg-preview" style={{ background: backgroundCss(value, images?.resolve ?? ((src) => src)) }} />

          <div className="canvas-bg-heading">{t('canvas.background.fill')}</div>
          {segment<FillKind>([
            { value: 'none', label: t('canvas.background.none') },
            { value: 'color', label: t('canvas.background.color') },
            { value: 'linear', label: t('canvas.background.linear') },
            { value: 'radial', label: t('canvas.background.radial') },
          ], fill.kind, (kind) => { setFill(fillOfKind(kind, fill)); setStop(0); })}

          {fill.kind === 'color' && <ColorPanel value={fill.color} onPick={(color) => color && setFill({ ...fill, color })} />}

          {gradient && (<>
            <div className="canvas-bg-stops">
              {gradient.colors.map((color, i) => (
                <button
                  key={i}
                  type="button"
                  className={`canvas-swatch${i === current ? ' canvas-swatch-active' : ''}`}
                  style={{ background: color }}
                  title={t('canvas.background.stop', { n: i + 1 })}
                  onClick={() => setStop(i)}
                />
              ))}
              <Button
                tone="neutral"
                compact
                small
                disabled={gradient.colors.length >= MAX_STOPS}
                title={t('canvas.background.addStop')}
                onClick={() => { setFill({ ...gradient, colors: [...gradient.colors, gradient.colors[gradient.colors.length - 1]] }); setStop(gradient.colors.length); }}
              >
                <Plus size={12} />
              </Button>
              <Button
                tone="neutral"
                compact
                small
                disabled={gradient.colors.length <= MIN_STOPS}
                title={t('canvas.background.removeStop')}
                onClick={() => setFill({ ...gradient, colors: gradient.colors.filter((_, i) => i !== current) })}
              >
                <Minus size={12} />
              </Button>
            </div>
            <ColorPanel
              value={gradient.colors[current]}
              onPick={(color) => color && setFill({ ...gradient, colors: gradient.colors.map((c, i) => (i === current ? color : c)) })}
            />
            {gradient.kind === 'linear' && (
              <RangeField
                label={t('canvas.background.angle')}
                value={gradient.angle}
                min={0}
                max={359}
                onChange={(angle) => setFill({ ...gradient, angle })}
                format={(angle) => `${Math.round(angle)}°`}
              />
            )}
            {gradient.kind === 'radial' && segment(
              RADIAL_CENTRES.map((c) => ({ value: c.key, label: t(`canvas.background.${c.key}`) })),
              RADIAL_CENTRES.find((c) => Math.abs(c.cy - gradient.cy) < 0.01 && gradient.cx === 0.5)?.key ?? null,
              (key) => setFill({ ...gradient, cx: 0.5, cy: RADIAL_CENTRES.find((c) => c.key === key)!.cy }),
            )}
          </>)}

          {images && (<>
            <div className="canvas-bg-heading">{t('canvas.background.image')}</div>
            <div className="canvas-bg-row">
              <Button tone="neutral" small fill disabled={picking} onClick={() => void choosePicture()}>
                <ImagePlus size={12} />
                {t(image ? 'canvas.background.changeImage' : 'canvas.background.chooseImage')}
              </Button>
              {image && (
                <Button
                  tone="neutral"
                  compact
                  small
                  title={t('canvas.background.removeImage')}
                  onClick={() => set({ image: null })}
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
            {image && segment(
              [{ value: 'cover', label: t('canvas.background.cover') }, { value: 'contain', label: t('canvas.background.contain') }],
              image.fit,
              (fit) => set({ image: { ...image, fit } }),
            )}
          </>)}

          <div className="canvas-bg-heading">{t('canvas.background.tint')}</div>
          {segment(
            [
              { value: 'none', label: t('canvas.background.none') },
              { value: 'dark', label: t('canvas.background.darken') },
              { value: 'light', label: t('canvas.background.lighten') },
            ],
            !tint ? 'none' : tint.color === '#ffffff' ? 'light' : 'dark',
            (v) => set({ tint: v === 'none' ? null : { color: v === 'light' ? '#ffffff' : '#0a0a0f', opacity: tint?.opacity ?? 0.3 } }),
          )}
          {tint && (
            <RangeField
              label={t('canvas.layers.opacity')}
              value={Math.round(tint.opacity * 100)}
              min={5}
              max={95}
              onChange={(percent) => set({ tint: { ...tint, opacity: percent / 100 } })}
            />
          )}
        </div>
      )}
    </PopoverButton>
  );
}
