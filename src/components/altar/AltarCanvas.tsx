import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';
import { useAltarStore } from '../../store/altarStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import {
  ALTAR_IMAGE_PRESETS,
  DEFAULT_ALTAR_RESOLUTION,
  DEFAULT_BACKGROUND_OVERLAY,
  getAltarBackgroundStyle,
  getGradientColor,
  isGradientPreset,
  resolveResolutionPixels,
} from '../../lib/altarConstants';
import type { AltarImagePresetName } from '../../lib/altarConstants';
import { generateId, hexToRgb } from '../../lib/helpers';
import type { AltarItem, AltarPlacement, AltarRecord } from '../../types';
import { AltarItemVisual } from './AltarItemVisual';
import { canvasImageSrc, imageSrc } from '../../lib/images';
import { THUMBNAIL_W, canvasToCappedThumbnail } from '../../lib/thumbnail';
import {
  BuilderEditor, canvasToDataUrl, renderBuilderImage, type BuilderEditorHandle, type BuilderElement, type BuilderGrid,
} from '../editors/builder';
import { elementToPlacement, placementToElement } from './altarBuilder';

// ---------------------------------------------------------------------------
// Altar picture renderer — draws directly to a Canvas 2D context from store
// data, for thumbnails and file export, with the builder's own drawing for
// the elements (`renderBuilderImage`), so the picture matches the stage.
// ---------------------------------------------------------------------------

const PRESET_GRAD: Record<string, { cx: number; cy: number; stops: [string, number][] }> = {
  midnight: { cx: 0.5, cy: 0.30, stops: [['#1a1a2e', 0], ['#0d0d15', 0.6], ['#0a0a0f', 1]] },
  ember:    { cx: 0.5, cy: 0.24, stops: [['#4a2917', 0], ['#25140f', 0.42], ['#120d10', 1]] },
  forest:   { cx: 0.5, cy: 0.22, stops: [['#183126', 0], ['#0d1a16', 0.48], ['#09110f', 1]] },
  moon:     { cx: 0.5, cy: 0.18, stops: [['#2b253d', 0], ['#171222', 0.44], ['#0b0a12', 1]] },
};

function _radialGrad(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  cx: number, cy: number,
  stops: [string, number][],
) {
  const r = Math.sqrt(w * w + h * h);
  const g = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, r);
  for (const [color, pos] of stops) g.addColorStop(pos, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Everything drawn here ends up in `exportCurrentAltarImage` and is read back
 * with `toBlob()`. That only works as long as no foreign source is on the
 * canvas, which is why the sources come from `canvasImageSrc()`, which returns
 * stored images as data URLs instead of via `emerald-img`.
 *
 * So no `crossOrigin`: there would be nothing left for it to apply to, and
 * same-origin only fetches the image a second time into the cache.
 */
function _loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function _drawCover(ctx: CanvasRenderingContext2D, src: string, w: number, h: number) {
  const img = await _loadImg(src);
  const ia = img.naturalWidth / img.naturalHeight;
  const ca = w / h;
  let sx, sy, sw, sh;
  if (ia > ca) { sh = img.naturalHeight; sw = sh * ca; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else          { sw = img.naturalWidth;  sh = sw / ca; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

/** Background, overlay and the visible grid, in output pixels. */
async function _drawBackground(ctx: CanvasRenderingContext2D, altar: AltarRecord, backgroundSrc: string | null, outW: number, outH: number) {
  // 1. Background
  const preset = altar.background_preset;
  try {
    if (backgroundSrc) {
      await _drawCover(ctx, backgroundSrc, outW, outH);
    } else if (ALTAR_IMAGE_PRESETS.includes(preset as AltarImagePresetName)) {
      await _drawCover(ctx, `/backgrounds/${preset}.webp`, outW, outH);
    } else if (isGradientPreset(preset)) {
      const hex = getGradientColor(preset);
      if (!hex) throw new Error('invalid gradient color');
      const { r, g, b } = hexToRgb(hex);
      _radialGrad(ctx, outW, outH, 0.5, 0.25, [
        [hex, 0],
        [`rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`, 0.5],
        ['#0a0a0f', 1],
      ]);
    } else {
      const cfg = PRESET_GRAD[preset] ?? PRESET_GRAD.midnight;
      _radialGrad(ctx, outW, outH, cfg.cx, cfg.cy, cfg.stops);
    }
  } catch {
    const cfg = PRESET_GRAD.midnight;
    _radialGrad(ctx, outW, outH, cfg.cx, cfg.cy, cfg.stops);
  }

  // 2. Overlay
  const overlay = altar.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY;
  if (overlay > 0) {
    const topA = Math.round(overlay * 60) / 100;
    const isLight = altar.background_overlay_color === 'light';
    const rgb = isLight ? '255,255,255' : '10,10,15';
    const og = ctx.createLinearGradient(0, 0, 0, outH);
    og.addColorStop(0, `rgba(${rgb},${topA})`);
    og.addColorStop(1, `rgba(${rgb},${overlay})`);
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, outW, outH);
  }

  // 3. Grid
  const grid = altarGrid(altar);
  if (grid?.visible) {
    const { r, g, b } = hexToRgb(grid.color);
    ctx.save();
    ctx.strokeStyle = `rgba(${r},${g},${b},${grid.opacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < grid.columns; i++) { const x = (i / grid.columns) * outW; ctx.moveTo(x, 0); ctx.lineTo(x, outH); }
    for (let i = 1; i < grid.rows; i++) { const y = (i / grid.rows) * outH; ctx.moveTo(0, y); ctx.lineTo(outW, y); }
    ctx.stroke();
    ctx.restore();
  }
}

async function _renderAltar(
  altar: AltarRecord,
  backgroundSrc: string | null,
  placements: AltarPlacement[],
  outW: number,
): Promise<HTMLCanvasElement | null> {
  const { w: refW, h: refH } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
  const imageData = new Map(placements.map((p) => [p.id, p.image_data]));
  return renderBuilderImage({
    width: refW,
    height: refH,
    // No on-screen sources: the images come from `resolveImage`, readable by `toBlob`.
    elements: placements.map((p) => placementToElement(p, refW, refH, () => null)),
    outWidth: outW,
    drawBackground: (ctx, w, h) => _drawBackground(ctx, altar, backgroundSrc, w, h),
    resolveImage: async (el) => {
      const src = await canvasImageSrc(imageData.get(el.id));
      return src ? _loadImg(src) : null;
    },
  });
}

/** The active altar with its background as `canvasImageSrc` gives it. */
async function activeAltarForRender(): Promise<{ altar: AltarRecord; backgroundSrc: string | null; placements: AltarPlacement[] } | null> {
  const { placements, activeAltarId, altars } = useAltarStore.getState();
  const altar = altars.find((a) => a.id === activeAltarId) ?? null;
  if (!altar) return null;
  const backgroundSrc = (await canvasImageSrc(altar.background_image_data)) || null;
  return { altar, backgroundSrc, placements };
}

/** Renders the active altar at full native resolution for file export. */
export async function exportCurrentAltarImage(format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<string | null> {
  try {
    const active = await activeAltarForRender();
    if (!active) return null;
    const { w: nativeW } = resolveResolutionPixels(active.altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
    const canvas = await _renderAltar(active.altar, active.backgroundSrc, active.placements, nativeW);
    if (!canvas) return null;
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = format === 'png' ? undefined : format === 'webp' ? 0.92 : 0.97;
    return canvasToDataUrl(canvas, mime, quality);
  } catch (err) {
    console.error('[exportCurrentAltarImage]', err);
    return null;
  }
}

/** Reads the active altar from the store and renders its thumbnail.
 *  Safe to call from anywhere — uses an off-screen canvas independent of the DOM. */
export async function captureCurrentAltar(): Promise<string | null> {
  try {
    // Reads the store before its first await: the caller may switch to another altar right after.
    const active = await activeAltarForRender();
    if (!active) return null;
    const canvas = await _renderAltar(active.altar, active.backgroundSrc, active.placements, THUMBNAIL_W);
    if (!canvas) return null;
    // WebP ladder with JPEG fallback and 512 KB cap from lib/thumbnail.ts.
    return canvasToCappedThumbnail(canvas, 'jpeg');
  } catch (err) {
    console.error('[captureCurrentAltar]', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The altar on screen: the builder editor (`editors/builder`), fed from the store.
// ---------------------------------------------------------------------------

/** The altar's grid in the builder's terms; `null` when nothing uses it. */
function altarGrid(altar: AltarRecord): BuilderGrid | null {
  const size = altar.grid_size ?? 0;
  if (size <= 0 || !(altar.grid_enabled || altar.snap_to_grid || altar.snap_scale_to_grid)) return null;
  const { w, h } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
  return {
    columns: Math.max(1, Math.round(w / size)),
    rows: Math.max(1, Math.round(h / size)),
    visible: altar.grid_enabled,
    color: altar.grid_color,
    opacity: altar.grid_opacity,
    snapPosition: altar.snap_to_grid,
    snapSize: altar.snap_scale_to_grid,
  };
}

const elementImageSrc = (imageData: string | undefined) => imageSrc(imageData) || null;

export function AltarCanvas({ altar, backgroundSrc, editable, readAlign, onExport }: {
  altar: AltarRecord;
  backgroundSrc: string | null;
  editable: boolean;
  /** Where the altar sits while reading: at the top of the view, or (fullscreen) in the middle. */
  readAlign: 'top' | 'center';
  /** Saving the altar as an image, from the builder's toolbar. */
  onExport?: () => void;
}) {
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementIds = useAltarStore((s) => s.selectedPlacementIds);
  const { placeItem, applyPlacements, selectPlacements } = useAltarStore(
    useShallow((s) => ({ placeItem: s.placeItem, applyPlacements: s.applyPlacements, selectPlacements: s.selectPlacements })),
  );
  const builderRef = useRef<BuilderEditorHandle>(null);

  const { w: refW, h: refH } = useMemo(
    () => resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION),
    [altar.resolution],
  );
  const grid = useMemo(() => altarGrid(altar), [altar]);

  const elements = useMemo(
    () => placements.map((p) => placementToElement(p, refW, refH, elementImageSrc)),
    [placements, refW, refH],
  );

  const handleChange = useCallback((next: BuilderElement[]) => {
    const previous = new Map(useAltarStore.getState().placements.map((p) => [p.id, p]));
    void applyPlacements(next.map((el) => elementToPlacement(el, refW, refH, previous.get(el.id)))).catch(console.error);
  }, [applyPlacements, refW, refH]);

  // Items dragged in from the library strip: a pointer drag on a channel,
  // since the WebView has no HTML5 drag and drop.
  const [dragItem, setDragItem] = useState<AltarItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => subscribeAltarDrag(setDragItem), []);

  useEffect(() => {
    if (!editable || !dragItem) {
      setGhostPos(null);
      return;
    }
    const onMove = (e: PointerEvent) => setGhostPos({ x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const item = getAltarDragItem();
      setAltarDragItem(null);
      if (!item) return;
      const point = builderRef.current?.clientToArtboard(e.clientX, e.clientY);
      if (!point || point.x < 0 || point.y < 0 || point.x > refW || point.y > refH) return;
      let x = (point.x / refW) * 100;
      let y = (point.y / refH) * 100;
      if (grid?.snapPosition) {
        x = Math.round(x / (100 / grid.columns)) * (100 / grid.columns);
        y = Math.round(y / (100 / grid.rows)) * (100 / grid.rows);
      }
      void placeItem(item, Math.max(3, Math.min(97, x)), Math.max(3, Math.min(97, y))).catch(console.error);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [editable, dragItem, placeItem, refW, refH, grid]);

  return (
    <BuilderEditor
      ref={builderRef}
      width={refW}
      height={refH}
      elements={elements}
      onChange={handleChange}
      selectedIds={selectedPlacementIds}
      onSelectionChange={selectPlacements}
      editable={editable}
      grid={grid}
      rotationSnap={altar.rotation_snap_enabled ? altar.rotation_snap_angle : null}
      historyKey={altar.id}
      readAlign={readAlign}
      createId={generateId}
      onExport={onExport}
      background={<div className="h-full w-full" style={{ background: getAltarBackgroundStyle(altar, backgroundSrc) }} />}
      overlay={editable && dragItem ? (
        <>
          <div className="builder-drop-hint" />
          {ghostPos && createPortal(
            <div
              className="fixed pointer-events-none z-50 flex flex-col items-center gap-0.5 opacity-75"
              style={{ left: ghostPos.x, top: ghostPos.y, transform: 'translate(-50%, -50%)' }}
            >
              <AltarItemVisual item={dragItem} size={32} />
              <span className="text-xs text-muted whitespace-nowrap">{dragItem.name}</span>
            </div>,
            document.body,
          )}
        </>
      ) : null}
    />
  );
}
