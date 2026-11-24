import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import { RangeField } from '../../editors/canvas/elements/controlParts';
import { ICON_MAX_EDGE } from '../../../lib/icons';
import { trackPointerDrag } from '../../../lib/pointerDrag';

/** The stage the picture moves on, and the icon frame in its middle (px). */
const STAGE = 280;
const FRAME = 200;
/** Zoom in percent: 100 fills the frame with the picture's shorter edge. */
const MIN_ZOOM = 100;
const MAX_ZOOM = 800;
/** How far the arrow keys move the picture (px on screen); with Shift four times as far. */
const KEY_STEP = 8;
/** How far + and - zoom (percent points). */
const KEY_ZOOM_STEP = 20;
/** How strongly the wheel zooms per unit of `deltaY`: a mouse notch (100) is about ×1.16. */
const WHEEL_ZOOM_RATE = 0.0015;

interface Size { w: number; h: number }
/** The picture's centre relative to the frame's centre, in px on screen. */
interface Offset { x: number; y: number }

/** Not rounded: small trackpad steps have to add up. */
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The on-screen scale of the picture at `zoom`: at 100 % its shorter edge is the frame. */
function scaleOf(size: Size, zoom: number): number {
  return (FRAME / Math.min(size.w, size.h)) * (zoom / 100);
}

/** Keeps the frame covered: the picture may not be moved so far that an empty edge shows. */
function clampOffset(size: Size, zoom: number, offset: Offset): Offset {
  const scale = scaleOf(size, zoom);
  const maxX = Math.max(0, (size.w * scale - FRAME) / 2);
  const maxY = Math.max(0, (size.h * scale - FRAME) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, offset.x)), y: Math.min(maxY, Math.max(-maxY, offset.y)) };
}

/**
 * The square under the frame, drawn as a PNG of at most `ICON_MAX_EDGE` —
 * never larger than the cut-out has pixels, so a small picture is not blown up.
 * PNG keeps transparency; an animated GIF becomes a still.
 */
function cropToDataUrl(img: HTMLImageElement, size: Size, zoom: number, offset: Offset): string {
  const scale = scaleOf(size, zoom);
  const side = FRAME / scale;
  // The picture's centre, minus the way from there to the frame's corner — in picture pixels.
  const sx = size.w / 2 - (offset.x + FRAME / 2) / scale;
  const sy = size.h / 2 - (offset.y + FRAME / 2) / scale;
  const edge = Math.max(1, Math.min(ICON_MAX_EDGE, Math.round(side)));
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, edge, edge);
  return canvas.toDataURL('image/png');
}

/**
 * Cutting a chosen picture to an icon, before it is taken: the picture behind
 * a square frame shaped like the icon, the rest dimmed. Drag (or the arrow
 * keys) moves it, the slider and the scroll wheel zoom — the wheel towards the
 * pointer. The picture always covers the frame. "Apply" hands the square on
 * as a small PNG data URL, which the icon field stores like any other picture;
 * Cancel leaves the icon as it was.
 *
 * The callers key it by `src`: another picture starts from scratch.
 */
export default function IconCropDialog({ src, onApply, onCancel, onUnreadable }: {
  /** The chosen picture, as a data URL. */
  src: string;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
  /** The picture cannot be decoded; the dialog is gone already (through `onCancel`). */
  onUnreadable?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  // Handlers read the view from here, never from state: zoomTo and moveTo
  // write it ahead of the next render, so several events in a row build on each other.
  const view = useRef({ size, zoom, offset });
  view.current = { size, zoom, offset };

  // The keys belong to the picture from the start — otherwise Enter would still
  // press the button behind the dialog that opened the file picker.
  useEffect(() => stageRef.current?.focus(), []);

  /** Zoom to `next`, keeping the picture point under `at` (relative to the frame's centre) in place. */
  const zoomTo = useCallback((next: number, at: Offset = { x: 0, y: 0 }) => {
    const { size: s, zoom: z, offset: o } = view.current;
    if (!s) return;
    const target = clampZoom(next);
    const ratio = target / z;
    const nextOffset = clampOffset(s, target, { x: at.x - (at.x - o.x) * ratio, y: at.y - (at.y - o.y) * ratio });
    view.current = { size: s, zoom: target, offset: nextOffset };
    setZoom(target);
    setOffset(nextOffset);
  }, []);

  /** Move the picture's centre to `next` (relative to the frame's centre), kept covering the frame. */
  const moveTo = useCallback((next: Offset) => {
    const { size: s, zoom: z } = view.current;
    if (!s) return;
    const clamped = clampOffset(s, z, next);
    view.current = { ...view.current, offset: clamped };
    setOffset(clamped);
  }, []);

  // Not React's `onWheel`: that listener is passive, and the wheel must not also scroll what lies behind.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const at = { x: e.clientX - r.left - STAGE / 2, y: e.clientY - r.top - STAGE / 2 };
      zoomTo(view.current.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), at);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { size: s, offset: o } = view.current;
    if (e.button !== 0 || !s) return;
    e.preventDefault();
    e.currentTarget.focus();
    const start = { x: e.clientX - o.x, y: e.clientY - o.y };
    trackPointerDrag(e.nativeEvent, { onMove: (move) => moveTo({ x: move.clientX - start.x, y: move.clientY - start.y }) });
  };

  const apply = () => {
    const img = imgRef.current;
    const { size: s, zoom: z, offset: o } = view.current;
    if (!img || !s) return;
    try {
      onApply(cropToDataUrl(img, s, z, o));
    } catch (err) {
      console.error('[IconCropDialog] cropping failed:', err);
      onCancel();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { size: s, zoom: z, offset: o } = view.current;
    if (!s) return;
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const moves: Record<string, Offset> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    if (moves[e.key]) {
      moveTo({ x: o.x + moves[e.key].x, y: o.y + moves[e.key].y });
    } else if (e.key === '+' || e.key === '=') {
      zoomTo(z + KEY_ZOOM_STEP);
    } else if (e.key === '-') {
      zoomTo(z - KEY_ZOOM_STEP);
    } else if (e.key === 'Enter') {
      apply();
    } else {
      return;
    }
    e.preventDefault();
  };

  const scale = size ? scaleOf(size, zoom) : 1;
  const zoomLabel = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <Modal
      title={t('properties.cropIcon')}
      onClose={onCancel}
      widthClassName="w-[328px]"
      bodyClassName="modal-body space-y-3"
      footer={(
        <>
          <Button tone="neutral" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={apply} disabled={!size}>{t('properties.cropApply')}</Button>
        </>
      )}
    >
      <div
        ref={stageRef}
        tabIndex={0}
        aria-label={t('properties.cropArea')}
        aria-describedby="icon-crop-hint"
        className="icon-crop-stage"
        style={{ width: STAGE, height: STAGE }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => { onCancel(); onUnreadable?.(); }}
          style={size ? {
            width: size.w * scale,
            height: size.h * scale,
            left: STAGE / 2 + offset.x - (size.w * scale) / 2,
            top: STAGE / 2 + offset.y - (size.h * scale) / 2,
          } : { visibility: 'hidden' }}
        />
        <div className="icon-crop-frame" style={{ width: FRAME, height: FRAME }} />
      </div>
      <RangeField
        label={t('properties.cropZoom')}
        value={Math.round(zoom)}
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        onChange={(next) => zoomTo(next)}
        format={(value) => `${zoomLabel.format(value / 100)}×`}
      />
      <p id="icon-crop-hint" className="text-xs text-subtle">{t('properties.cropHint')}</p>
    </Modal>
  );
}
