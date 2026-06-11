import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { MoveDiagonal2, RotateCw } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import { BASE_RESOLUTION_WIDTH } from '../../lib/altarConstants';
import { hexToRgb } from '../../lib/helpers';
import type { AltarItem, AltarPlacement, AltarRecord } from '../../types';
import { AltarItemVisual } from './AltarItemVisual';

const BASE_SIZE = 40;

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
        const scaledBase = BASE_SIZE * canvasScale;
        const displaySize = scaledBase * (width / 8);
        const snapUnit = gridSize * 2;
        const snapped = Math.max(snapUnit, Math.round(displaySize / snapUnit) * snapUnit);
        const snappedUnit = (snapped / scaledBase) * 8;
        const clamped = Math.max(2, Math.min(500, Math.round(snappedUnit * 100) / 100));
        updatePlacement(id, { width: clamped, height: clamped });
      } else {
        updatePlacement(id, { width, height });
      }
    },
    [updatePlacement, snapScaleToGrid, gridSize, canvasScale],
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
      // Use native (unscaled) dimensions for correct grid snap steps
      const stepX = (gridSize / nativeW) * 100;
      const stepY = (gridSize / nativeH) * 100;
      const snappedX = stepX > 0 ? Math.round(rawX / stepX) * stepX : rawX;
      const snappedY = stepY > 0 ? Math.round(rawY / stepY) * stepY : rawY;
      return { x: Math.max(3, Math.min(97, snappedX)), y: Math.max(3, Math.min(97, snappedY)) };
    }
    return { x: Math.max(3, Math.min(97, rawX)), y: Math.max(3, Math.min(97, rawY)) };
  }, [snapToGrid, gridSize, nativeW, nativeH]);

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
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(${gridRgb.r},${gridRgb.g},${gridRgb.b},${gridOpacity}) 1px, transparent 1px), linear-gradient(to bottom, rgba(${gridRgb.r},${gridRgb.g},${gridRgb.b},${gridOpacity}) 1px, transparent 1px)`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
          }}
        />
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

      {editable && sidebarDragItem && ghostPos && (
        <div
          className="fixed pointer-events-none z-50 flex flex-col items-center gap-0.5 opacity-75"
          style={{ left: ghostPos.x, top: ghostPos.y, transform: 'translate(-50%, -50%)' }}
        >
          <AltarItemVisual item={sidebarDragItem} size={32} />
          <span className="text-xs text-stone-400 whitespace-nowrap">{sidebarDragItem.name}</span>
        </div>
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

