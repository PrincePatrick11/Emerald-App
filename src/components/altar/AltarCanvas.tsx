import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { MoveDiagonal2, RotateCw } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import {
  ALTAR_IMAGE_PRESETS,
  BASE_RESOLUTION_WIDTH,
  DEFAULT_ALTAR_RESOLUTION,
  DEFAULT_BACKGROUND_OVERLAY,
  DEFAULT_GRID_COLOR,
  DEFAULT_GRID_OPACITY,
  getGradientColor,
  isGradientPreset,
  resolveResolutionPixels,
} from '../../lib/altarConstants';
import type { AltarImagePresetName } from '../../lib/altarConstants';
import { hexToRgb } from '../../lib/helpers';
import type { AltarItem, AltarPlacement, AltarRecord } from '../../types';
import { AltarItemVisual } from './AltarItemVisual';
import { getCachedBackgroundPreview } from './useAltarBackgroundPreview';

const BASE_SIZE = 40;

// ---------------------------------------------------------------------------
// Altar thumbnail renderer — draws directly to a Canvas 2D context from
// store data instead of relying on DOM capture (no external library needed).
// ---------------------------------------------------------------------------

const THUMBNAIL_W = 640;

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

async function _renderAltar(
  altar: AltarRecord,
  backgroundSrc: string | null,
  placements: AltarPlacement[],
  nativeW: number,
  nativeH: number,
  outW: number,
): Promise<HTMLCanvasElement | null> {
  const outH = Math.round(outW * nativeH / nativeW);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 1. Background
  const preset = altar.background_preset;
  try {
    if (backgroundSrc?.startsWith('data:image/')) {
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
  if (altar.grid_enabled && (altar.grid_size ?? 0) > 0) {
    const gridSize = altar.grid_size!;
    const { w: refW, h: refH } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
    const numCols = Math.max(1, Math.round(refW / gridSize));
    const numRows = Math.max(1, Math.round(refH / gridSize));
    const { r, g, b } = hexToRgb(altar.grid_color ?? DEFAULT_GRID_COLOR);
    const opacity = altar.grid_opacity ?? DEFAULT_GRID_OPACITY;
    ctx.save();
    ctx.strokeStyle = `rgba(${r},${g},${b},${opacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < numCols; i++) { const x = (i / numCols) * outW; ctx.moveTo(x, 0); ctx.lineTo(x, outH); }
    for (let i = 1; i < numRows; i++) { const y = (i / numRows) * outH; ctx.moveTo(0, y); ctx.lineTo(outW, y); }
    ctx.stroke();
    ctx.restore();
  }

  // 4. Placements — same size formula as PlacedItem in AltarCanvas
  const canvasScale = nativeW / BASE_RESOLUTION_WIDTH;
  const scaledBase = BASE_SIZE * canvasScale;
  const scaleX = outW / nativeW;
  const scaleY = outH / nativeH;

  for (const p of [...placements].sort((a, b) => a.z_index - b.z_index)) {
    if (p.hidden) continue;
    const drawW = Math.round(scaledBase * (p.width  / 8) * scaleX);
    const drawH = Math.round(scaledBase * (p.height / 8) * scaleY);
    const cx = (p.x / 100) * outW;
    const cy = (p.y / 100) * outH;
    const rot = ((p.rotation ?? 0) * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx, cy);
    if (rot !== 0) ctx.rotate(rot);
    ctx.globalAlpha = p.opacity ?? 1;

    if (p.image_data?.startsWith('data:image/')) {
      try {
        const img = await _loadImg(p.image_data);
        const ia = img.naturalWidth / img.naturalHeight;
        const da = drawW / drawH;
        const [rw, rh] = ia > da ? [drawW, drawW / ia] : [drawH * ia, drawH];
        ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);
      } catch {
        _drawEmoji(ctx, p.emoji, drawW);
      }
    } else {
      _drawEmoji(ctx, p.emoji, drawW);
    }

    ctx.restore();
  }

  return canvas;
}


async function renderAltarThumbnail(
  altar: AltarRecord,
  backgroundSrc: string | null,
  placements: AltarPlacement[],
  nativeW: number,
  nativeH: number,
): Promise<string | null> {
  const canvas = await _renderAltar(altar, backgroundSrc, placements, nativeW, nativeH, THUMBNAIL_W);
  if (!canvas) return null;

  const toDataUrl = (format: string, quality: number): Promise<string | null> =>
    new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      }, format, quality);
    });

  // Probe WebP support with one call — if the result isn't actually WebP, the
  // runtime fell back to PNG (lossless, unaffected by quality) and we skip
  // straight to JPEG which has reliable quality control.
  const probe = await toDataUrl('image/webp', 0.85);
  if (probe !== null) {
    if (probe.startsWith('data:image/webp')) {
      if (probe.length <= 524288) return probe;
      for (const q of [0.65, 0.45]) {
        const r = await toDataUrl('image/webp', q);
        if (r !== null && r.length <= 524288) return r;
      }
    } else if (probe.length <= 524288) {
      return probe;
    }
  }

  for (const q of [0.85, 0.65, 0.45]) {
    const r = await toDataUrl('image/jpeg', q);
    if (r !== null && r.length <= 524288) return r;
  }
  return null;
}

/** Renders the active altar at full native resolution for file export. Returns JPEG at high quality. */
export async function exportCurrentAltarImage(): Promise<string | null> {
  try {
    const { placements, activeAltarId, altars } = useAltarStore.getState();
    const altar = altars.find((a) => a.id === activeAltarId) ?? null;
    if (!altar) return null;
    const { w: nativeW, h: nativeH } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
    const backgroundSrc = getCachedBackgroundPreview(altar.background_image_data);
    const canvas = await _renderAltar(altar, backgroundSrc, placements, nativeW, nativeH, nativeW);
    if (!canvas) return null;
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.97);
    });
  } catch (err) {
    console.error('[exportCurrentAltarImage]', err);
    return null;
  }
}

/** Reads the active altar from the store and renders its thumbnail.
 *  Safe to call from anywhere — uses an off-screen canvas independent of the DOM. */
export async function captureCurrentAltar(): Promise<string | null> {
  try {
    const { placements, activeAltarId, altars } = useAltarStore.getState();
    const altar = altars.find((a) => a.id === activeAltarId) ?? null;
    if (!altar) return null;
    const { w: nativeW, h: nativeH } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
    const backgroundSrc = getCachedBackgroundPreview(altar.background_image_data);
    return renderAltarThumbnail(altar, backgroundSrc, placements, nativeW, nativeH);
  } catch (err) {
    console.error('[captureCurrentAltar]', err);
    return null;
  }
}

function _drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, size: number) {
  // fontSize matches AltarItemVisual: Math.round(size * 0.8)
  ctx.font = `${Math.round(size * 0.8)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);
}

export function AltarCanvas({
  altar,
  backgroundSrc,
  editable,
  showGrid,
  gridSize,
  gridOpacity,
  gridColor,
  snapToGrid,
  rotationSnapEnabled,
  rotationSnapAngle,
  snapScaleToGrid,
  resolution,
  nativeW,
  nativeH,
  cssScale,
  getBackgroundStyle,
}: {
  altar: AltarRecord | null;
  backgroundSrc: string | null;
  editable: boolean;
  showGrid: boolean;
  gridSize: number;
  gridOpacity: number;
  gridColor: string;
  snapToGrid: boolean;
  rotationSnapEnabled: boolean;
  rotationSnapAngle: number;
  snapScaleToGrid: boolean;
  resolution: string;
  nativeW: number;
  nativeH: number;
  cssScale: number;
  getBackgroundStyle: (altar: AltarRecord | null, imageSrc: string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementId = useAltarStore((s) => s.selectedPlacementId);
  const { placeItem, movePlacement, savePlacementPosition, updatePlacement, selectPlacement } = useAltarStore(
    useShallow((s) => ({
      placeItem: s.placeItem,
      movePlacement: s.movePlacement,
      savePlacementPosition: s.savePlacementPosition,
      updatePlacement: s.updatePlacement,
      selectPlacement: s.selectPlacement,
    })),
  );
  const gridRgb = hexToRgb(gridColor);

  // Reference resolution: stable across window resizes so grid/snap stay consistent.
  const { w: refW, h: refH } = useMemo(
    () => resolveResolutionPixels(resolution ?? DEFAULT_ALTAR_RESOLUTION),
    [resolution],
  );
  const gridNumCols  = Math.max(1, Math.round(refW / gridSize));
  const gridNumRows  = Math.max(1, Math.round(refH / gridSize));
  const gridCellW    = refW / gridNumCols;
  const gridCellH    = refH / gridNumRows;
  const gridScaledBase = BASE_SIZE * (refW / BASE_RESOLUTION_WIDTH);

  const gridPath = useMemo(() => {
    if (!showGrid || gridSize <= 0) return '';
    const parts: string[] = [];
    for (let i = 1; i < gridNumCols; i++) parts.push(`M${(i / gridNumCols) * nativeW},0V${nativeH}`);
    for (let i = 1; i < gridNumRows; i++) parts.push(`M0,${(i / gridNumRows) * nativeH}H${nativeW}`);
    return parts.join(' ');
  }, [showGrid, gridNumCols, gridNumRows, nativeW, nativeH]);

  const canvasScale = nativeW / BASE_RESOLUTION_WIDTH;
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const [sidebarDragItem, setSidebarDragItem] = useState<AltarItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const sortedPlacements = useMemo(
    () => [...placements].sort((a, b) => a.z_index - b.z_index),
    [placements],
  );
  // Stable callbacks that accept `id` as a parameter so they can be passed
  // down once to PlacedItem rather than recreated per-item inside the map.
  // PlacedItem calls e.g. onStartDrag() — we give it the bound version below
  // via useMemo so memo() can bail out when nothing changed.
  const handleStartDragById = useCallback((id: string) => { draggingRef.current = id; }, []);
  const handleSelectById = useCallback((id: string) => { selectPlacement(id); }, [selectPlacement]);
  const handleResizeById = useCallback(
    (id: string, width: number, height: number) => {
      if (snapScaleToGrid && gridSize > 0) {
        // Determine N (cells to span) from width, apply same N to height → snaps as a box.
        const displayW = gridScaledBase * (width / 8);
        const N = Math.max(2, Math.round(displayW / gridCellW / 2) * 2);
        const clampedW = Math.max(2, Math.min(500, Math.round((N * gridCellW / gridScaledBase) * 8 * 100) / 100));
        const clampedH = Math.max(2, Math.min(500, Math.round((N * gridCellH / gridScaledBase) * 8 * 100) / 100));
        updatePlacement(id, { width: clampedW, height: clampedH });
      } else {
        updatePlacement(id, { width, height });
      }
    },
    [updatePlacement, snapScaleToGrid, gridCellW, gridCellH, gridScaledBase],
  );
  const handleRotateById = useCallback(
    (id: string, rotation: number) => updatePlacement(id, { rotation }),
    [updatePlacement],
  );

  const coordsToPercent = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;
    if (snapToGrid) {
      const stepX = 100 / gridNumCols;
      const stepY = 100 / gridNumRows;
      const snappedX = stepX > 0 ? Math.round(rawX / stepX) * stepX : rawX;
      const snappedY = stepY > 0 ? Math.round(rawY / stepY) * stepY : rawY;
      return { x: Math.max(3, Math.min(97, snappedX)), y: Math.max(3, Math.min(97, snappedY)) };
    }
    return { x: Math.max(3, Math.min(97, rawX)), y: Math.max(3, Math.min(97, rawY)) };
  }, [snapToGrid, gridNumCols, gridNumRows]);

  useEffect(() => subscribeAltarDrag(setSidebarDragItem), []);

  useEffect(() => {
    if (!editable || !sidebarDragItem) {
      setGhostPos(null);
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      setGhostPos({ x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const item = getAltarDragItem();
      setAltarDragItem(null);
      if (!item) return;
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const { x, y } = coordsToPercent(e.clientX, e.clientY);
        placeItem(item, x, y);
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [editable, sidebarDragItem, placeItem]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!editable) return;
    if (!draggingRef.current) return;
    const { x, y } = coordsToPercent(e.clientX, e.clientY);
    movePlacement(draggingRef.current, x, y);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!editable) return;
    if (!draggingRef.current) return;
    const { x, y } = coordsToPercent(e.clientX, e.clientY);
    savePlacementPosition(draggingRef.current, x, y);
    draggingRef.current = null;
  };

  return (
    <div
      ref={canvasRef}
      className="w-full h-full relative overflow-hidden select-none"
      style={{ background: getBackgroundStyle(altar, backgroundSrc) }}
      onMouseDown={() => selectPlacement(null)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {showGrid && gridPath && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d={gridPath}
            stroke={`rgba(${gridRgb.r},${gridRgb.g},${gridRgb.b},${gridOpacity})`}
            strokeWidth="1"
            fill="none"
          />
        </svg>
      )}

      {editable && sidebarDragItem && (
        <div className="absolute inset-2 border border-dashed border-stone-600/40 rounded-lg pointer-events-none z-10" />
      )}

      {sortedPlacements.map((p) => (
        <PlacedItem
          key={p.id}
          placement={p}
          editable={editable}
          selected={selectedPlacementId === p.id}
          rotationSnapEnabled={rotationSnapEnabled}
          rotationSnapAngle={rotationSnapAngle}
          canvasScale={canvasScale}
          cssScale={cssScale}
          onStartDrag={handleStartDragById}
          onSelect={handleSelectById}
          onResize={handleResizeById}
          onRotate={handleRotateById}
        />
      ))}

      {editable && sidebarDragItem && ghostPos && createPortal(
        <div
          className="fixed pointer-events-none z-50 flex flex-col items-center gap-0.5 opacity-75"
          style={{ left: ghostPos.x, top: ghostPos.y, transform: 'translate(-50%, -50%)' }}
        >
          <AltarItemVisual item={sidebarDragItem} size={32} />
          <span className="text-xs text-stone-400 whitespace-nowrap">{sidebarDragItem.name}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}

interface PlacedItemProps {
  placement: AltarPlacement;
  editable: boolean;
  selected: boolean;
  rotationSnapEnabled: boolean;
  rotationSnapAngle: number;
  canvasScale: number;
  cssScale: number;
  // Callbacks accept `id` so a single stable reference can be shared
  // across all PlacedItem instances, letting React.memo bail out correctly.
  onStartDrag: (id: string) => void;
  onSelect: (id: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  onRotate: (id: string, rotation: number) => void;
}

const PlacedItem = memo(function PlacedItem({ placement, editable, selected, rotationSnapEnabled, rotationSnapAngle, canvasScale, cssScale, onStartDrag, onSelect, onResize, onRotate }: PlacedItemProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = placement.width ?? 8;
  const height = placement.height ?? 8;
  const scaledBase = BASE_SIZE * canvasScale;
  const displayWidth = Math.round(scaledBase * (width / 8));
  const displayHeight = Math.round(scaledBase * (height / 8));
  // Buttons must be a fixed screen-pixel size regardless of canvas resolution.
  // cssScale is the CSS transform factor applied to the canvas container, so
  // dividing by it converts screen pixels → native canvas pixels.
  const safeScale = cssScale > 0 ? cssScale : 1;
  const btnSize = Math.round(26 / safeScale);
  const iconSize = Math.round(14 / safeScale);
  const rotateTopOffset = -Math.round(38 / safeScale);
  const resizeEdgeOffset = -Math.round(10 / safeScale);
  const tooltipTopOffset = -Math.round(75 / safeScale);

  const handleWheel = (e: React.WheelEvent) => {
    if (!editable || placement.locked) return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.4 : -0.4;
    const nextWidth = Math.round(Math.max(2, Math.min(500, width + delta)) * 100) / 100;
    const nextHeight = Math.round(Math.max(2, Math.min(500, height + delta)) * 100) / 100;
    onResize(placement.id, nextWidth, nextHeight);
  };

  const startRotate = (event: React.MouseEvent) => {
    if (!editable || placement.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(placement.id);
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const onMove = (moveEvent: MouseEvent) => {
      const angle = (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180) / Math.PI + 90;
      let normalized = Math.round((((angle % 360) + 360) % 360) * 10) / 10;
      if (rotationSnapEnabled && rotationSnapAngle > 0) {
        normalized = Math.round(normalized / rotationSnapAngle) * rotationSnapAngle;
      } else if (moveEvent.shiftKey) {
        normalized = Math.round(normalized / 15) * 15;
      }
      onRotate(placement.id, normalized);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setIsRotating(false);
    };

    setIsRotating(true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const startResize = (event: React.MouseEvent) => {
    if (!editable || placement.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(placement.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = width;
    const startHeight = height;
    const startSize = (startWidth + startHeight) / 2;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX + (moveEvent.clientY - startY)) / 2;
      const nextSize = Math.max(2, Math.min(500, startSize + (delta * 8) / scaledBase));
      const normalized = Math.round(nextSize * 100) / 100;
      onResize(placement.id, normalized, normalized);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={rootRef}
      className={`absolute flex items-center justify-center ${editable && !placement.locked ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      style={{
        left: `${placement.x}%`,
        top: `${placement.y}%`,
        transform: `translate(-50%, -50%) rotate(${placement.rotation ?? 0}deg)`,
        width: displayWidth,
        height: displayHeight,
        zIndex: placement.z_index,
        display: placement.hidden ? 'none' : undefined,
        pointerEvents: placement.locked ? 'none' : undefined,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (placement.locked) return;
        onSelect(placement.id);
        if (!editable) return;
        e.preventDefault();
        onStartDrag(placement.id);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={handleWheel}
    >
      <div style={{ opacity: placement.opacity ?? 1 }}>
        <AltarItemVisual item={placement} size={Math.max(displayWidth, displayHeight)} candleAnimate={placement.category === 'candle'} />
      </div>
      {(selected || (editable && hovered)) && <span className="absolute inset-0 rounded border border-jade-500/50 pointer-events-none" />}
      {editable && isRotating && (
        <span style={{ top: tooltipTopOffset, fontSize: Math.round(14 / safeScale), padding: `${Math.round(4 / safeScale)}px ${Math.round(10 / safeScale)}px` }} className="absolute left-1/2 -translate-x-1/2 rounded bg-stone-950 border border-jade-500/60 font-semibold text-jade-200 shadow-lg pointer-events-none whitespace-nowrap">
          {Math.round((placement.rotation ?? 0) * 10) / 10}°
        </span>
      )}
      {editable && selected && !placement.locked && (
        <button
          onMouseDown={startRotate}
          style={{ width: btnSize, height: btnSize, top: rotateTopOffset, left: '50%', transform: 'translateX(-50%)' }}
          className="absolute bg-stone-800 border border-stone-600 rounded-full text-stone-300 hover:text-jade-300 hover:border-jade-600 transition-colors z-10 flex items-center justify-center"
          title={t('altar.rotate')}
        >
          <RotateCw size={iconSize} />
        </button>
      )}
      {editable && selected && !placement.locked && (
        <button
          onMouseDown={startResize}
          style={{ width: btnSize, height: btnSize, bottom: resizeEdgeOffset, right: resizeEdgeOffset }}
          className="absolute bg-stone-800 border border-stone-600 rounded-full text-stone-300 hover:text-jade-300 hover:border-jade-600 transition-colors z-10 flex items-center justify-center"
          title={t('altar.scale')}
        >
          <MoveDiagonal2 size={iconSize} />
        </button>
      )}
    </div>
  );
});

