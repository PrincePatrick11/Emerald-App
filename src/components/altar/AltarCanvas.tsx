import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoveDiagonal2, RotateCw } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import type { AltarItem, AltarPlacement, AltarRecord } from '../../types';
import { AltarItemVisual } from './AltarItemVisual';

const BASE_SIZE = 40;

export function AltarCanvas({
  altar,
  backgroundSrc,
  placements,
  editable,
  showGrid,
  gridSize,
  gridOpacity,
  gridColor,
  snapToGrid,
  getBackgroundStyle,
}: {
  altar: AltarRecord | null;
  backgroundSrc: string | null;
  placements: AltarPlacement[];
  editable: boolean;
  showGrid: boolean;
  gridSize: number;
  gridOpacity: number;
  gridColor: string;
  snapToGrid: boolean;
  getBackgroundStyle: (altar: AltarRecord | null, imageSrc: string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const { placeItem, movePlacement, savePlacementPosition, updatePlacement, selectPlacement, selectedPlacementId } = useAltarStore();
  const gridRgb = hexToRgb(gridColor);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const [sidebarDragItem, setSidebarDragItem] = useState<AltarItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const coordsToPercent = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    let x = Math.max(3, Math.min(97, ((clientX - rect.left) / rect.width) * 100));
    let y = Math.max(3, Math.min(97, ((clientY - rect.top) / rect.height) * 100));
    if (snapToGrid) {
      const stepX = (gridSize / rect.width) * 100;
      const stepY = (gridSize / rect.height) * 100;
      if (stepX > 0) x = Math.round(x / stepX) * stepX;
      if (stepY > 0) y = Math.round(y / stepY) * stepY;
      x = Math.max(3, Math.min(97, x));
      y = Math.max(3, Math.min(97, y));
    }
    return { x, y };
  };

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
      className="flex-1 relative overflow-hidden select-none"
      style={{ background: getBackgroundStyle(altar, backgroundSrc) }}
      onMouseDown={() => selectPlacement(null)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-stone-700/50 to-transparent pointer-events-none" />
      <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-stone-800/30 to-transparent pointer-events-none" />
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

      {placements.length === 0 && !sidebarDragItem && (
        <p className="absolute inset-0 flex items-center justify-center text-stone-800 text-sm pointer-events-none">
          {t('altar.dropHint')}
        </p>
      )}

      {[...placements].sort((a, b) => a.z_index - b.z_index).map((p) => (
        <PlacedItem
          key={p.id}
          placement={p}
          editable={editable}
          selected={selectedPlacementId === p.id}
          onStartDrag={() => { draggingRef.current = p.id; }}
          onSelect={() => selectPlacement(p.id)}
          onResize={(width, height) => updatePlacement(p.id, { width, height })}
          onRotate={(rotation) => updatePlacement(p.id, { rotation })}
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

function PlacedItem({ placement, editable, selected, onStartDrag, onSelect, onResize, onRotate }: {
  placement: AltarPlacement;
  editable: boolean;
  selected: boolean;
  onStartDrag: () => void;
  onSelect: () => void;
  onResize: (width: number, height: number) => void;
  onRotate: (rotation: number) => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = placement.width ?? 8;
  const height = placement.height ?? 8;
  const displayWidth = Math.round(BASE_SIZE * (width / 8));
  const displayHeight = Math.round(BASE_SIZE * (height / 8));

  const handleWheel = (e: React.WheelEvent) => {
    if (!editable || placement.locked) return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.4 : -0.4;
    const nextWidth = Math.round(Math.max(2, Math.min(500, width + delta)) * 100) / 100;
    const nextHeight = Math.round(Math.max(2, Math.min(500, height + delta)) * 100) / 100;
    onResize(nextWidth, nextHeight);
  };

  const startRotate = (event: React.MouseEvent) => {
    if (!editable || placement.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const onMove = (moveEvent: MouseEvent) => {
      const angle = (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180) / Math.PI + 90;
      let normalized = Math.round((((angle % 360) + 360) % 360) * 10) / 10;
      if (moveEvent.shiftKey) {
        normalized = Math.round(normalized / 15) * 15;
      }
      onRotate(normalized);
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
    onSelect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = width;
    const startHeight = height;
    const startSize = (startWidth + startHeight) / 2;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX + (moveEvent.clientY - startY)) / 2;
      const nextSize = Math.max(2, Math.min(500, startSize + (delta * 8) / BASE_SIZE));
      const normalized = Math.round(nextSize * 100) / 100;
      onResize(normalized, normalized);
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
        onSelect();
        if (!editable) return;
        e.preventDefault();
        onStartDrag();
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
        <span className="absolute -top-16 left-1/2 -translate-x-1/2 rounded bg-stone-950 border border-jade-500/60 px-2 py-0.5 text-[11px] font-semibold text-jade-200 shadow-lg pointer-events-none">
          {Math.round((placement.rotation ?? 0) * 10) / 10}°
        </span>
      )}
      {editable && selected && !placement.locked && (
        <button
          onMouseDown={startRotate}
          className="absolute -top-8 left-1/2 -translate-x-1/2 w-4 h-4 bg-stone-800 border border-stone-600 rounded-full text-stone-300 hover:text-jade-300 hover:border-jade-600 transition-colors z-10 flex items-center justify-center"
          title={t('altar.rotate')}
        >
          <RotateCw size={9} />
        </button>
      )}
      {editable && selected && !placement.locked && (
        <button
          onMouseDown={startResize}
          className="absolute -bottom-2 -right-2 w-4 h-4 bg-stone-800 border border-stone-600 rounded-full text-stone-300 hover:text-jade-300 hover:border-jade-600 transition-colors z-10 flex items-center justify-center"
          title={t('altar.scale')}
        >
          <MoveDiagonal2 size={9} />
        </button>
      )}
    </div>
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
}
