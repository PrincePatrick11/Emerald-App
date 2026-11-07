import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Copy, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { MAX_LAYERS, PAINT_HEIGHT, PAINT_WIDTH, type PaintLayer } from '../../../../lib/paint/document';
import { DRAG_THRESHOLD_PX, trackPointerDrag } from '../../../../lib/pointerDrag';
import { ToolbarBtn } from '../../shared/toolbarParts';
import { DOCK_THUMB_WIDTH, DockButtons, DockOpacity, DockToggles, LayerDock } from '../LayerDock';
import { drawLayer, type LayerImages } from './render';
import type { PaintControls } from './usePaintTools';

/** A layer's name as shown: its own, or its place counted from the bottom. */
export function layerLabel(t: (key: string, opts?: Record<string, unknown>) => string, layer: PaintLayer, index: number): string {
  return layer.name || t('editor.paint.layerN', { n: index + 1 });
}

const THUMB_WIDTH = DOCK_THUMB_WIDTH;
const THUMB_HEIGHT = Math.round((THUMB_WIDTH * PAINT_HEIGHT) / PAINT_WIDTH);

/** The layer in small, drawn again when the layer changes. */
const LayerThumb = memo(function LayerThumb({ layer, images }: { layer: PaintLayer; images: LayerImages }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = THUMB_WIDTH * dpr;
    canvas.height = THUMB_HEIGHT * dpr;
    ctx.setTransform(canvas.width / PAINT_WIDTH, 0, 0, canvas.height / PAINT_HEIGHT, 0, 0);
    drawLayer(ctx, layer, images);
  }, [layer, images]);
  return <canvas ref={ref} className="paint-layer-thumb" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }} aria-hidden />;
});

/**
 * The layers, as a panel laid over the drawing's right side that stays open
 * while painting (the bar's layer button opens and closes it). The top layer
 * comes first, as it lies on the page, each with a picture of what it holds.
 * A click picks the layer drawn on, a double click on the name renames it,
 * dragging a row moves the layer to another place; the eye and the lock are
 * on the row. Below: the opacity of the layer drawn on, then adding,
 * copying, merging it into the one below and removing it.
 */
export default function LayerPanel({ api, images, onClose }: { api: PaintControls; images: LayerImages; onClose: () => void }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; to: number } | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const { layers } = api.doc;
  const activeIndex = layers.findIndex((l) => l.id === api.activeLayer);
  const active = layers[activeIndex];

  /** The document index a pointer at `clientY` points to: the row under it, counted from the bottom. */
  const indexAt = (clientY: number) => {
    let index = 0;
    layers.forEach((layer, i) => {
      const rect = rows.current.get(layer.id)?.getBoundingClientRect();
      // Rows show the top layer first: above a row's middle is above that layer.
      if (rect && clientY < rect.top + rect.height / 2) index = Math.max(index, i);
    });
    return index;
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || renaming || (e.target as HTMLElement).closest('.editor-toolbar-btn')) return;
    let to: number | null = null;
    trackPointerDrag(e.nativeEvent, {
      threshold: DRAG_THRESHOLD_PX,
      onMove: (ev) => {
        to = indexAt(ev.clientY);
        setDragging({ id, to });
      },
      onEnd: ({ started, cancelled }) => {
        setDragging(null);
        if (started && !cancelled && to !== null) api.moveLayerTo(id, to);
      },
    });
  };

  const draggedFrom = dragging ? layers.findIndex((l) => l.id === dragging.id) : -1;

  return (
    <LayerDock
      title={t('editor.paint.layers')}
      onClose={onClose}
      footer={active && (<>
        <DockOpacity value={Math.round(active.opacity * 100)} onChange={(percent) => api.setOpacity(active.id, percent / 100)} />
        <DockButtons>
          <ToolbarBtn onClick={api.addLayer} active={false} disabled={layers.length >= MAX_LAYERS} title={t('editor.paint.addLayer')}>
            <Plus size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => api.duplicateLayer(active.id)} active={false} disabled={layers.length >= MAX_LAYERS} title={t('editor.paint.duplicateLayer')}>
            <Copy size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => api.mergeDown(active.id)}
            active={false}
            disabled={!api.canMergeDown(active.id)}
            title={activeIndex > 0 && !api.canMergeDown(active.id) ? t('editor.paint.mergeDownBlocked') : t('editor.paint.mergeDown')}
          >
            <ArrowDownToLine size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => api.removeLayer(active.id)} active={false} title={t('editor.paint.removeLayer')}>
            <Trash2 size={14} />
          </ToolbarBtn>
        </DockButtons>
      </>)}
    >
      {layers.map((layer, index) => ({ layer, index })).reverse().map(({ layer, index }) => {
        const isActive = layer.id === api.activeLayer;
        const label = layerLabel(t, layer, index);
        const target = dragging && dragging.id !== layer.id && dragging.to === index;
        return (
          <div
            key={layer.id}
            ref={(el) => { if (el) rows.current.set(layer.id, el); else rows.current.delete(layer.id); }}
            className={[
              'paint-layer',
              isActive && 'paint-layer--active',
              layer.hidden && 'paint-layer--hidden',
              dragging?.id === layer.id && 'paint-layer--dragged',
              target && `paint-layer--drop-${dragging.to > draggedFrom ? 'above' : 'below'}`,
            ].filter(Boolean).join(' ')}
            onPointerDown={(e) => startDrag(e, layer.id)}
            onClick={(e) => { if (!(e.target as HTMLElement).closest('.editor-toolbar-btn')) api.activateLayer(layer.id); }}
            title={t('editor.paint.layerHint')}
            aria-pressed={isActive}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.activateLayer(layer.id); }
              if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); api.moveLayer(layer.id, 1); }
              if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); api.moveLayer(layer.id, -1); }
            }}
          >
            <LayerThumb layer={layer} images={images} />
            <div className="paint-layer-text">
              {renaming === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name}
                  placeholder={label}
                  maxLength={60}
                  className="editor-inline-input paint-layer-input"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { api.renameLayer(layer.id, e.target.value); setRenaming(null); }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="paint-layer-name" onDoubleClick={() => setRenaming(layer.id)}>
                  {layer.image && <ImageIcon size={11} className="shrink-0" />}
                  <span className="truncate">{label}</span>
                </span>
              )}
              {layer.opacity < 1 && <span className="paint-layer-opacity">{Math.round(layer.opacity * 100)}%</span>}
            </div>
            <DockToggles
              locked={layer.locked}
              hidden={layer.hidden}
              onLock={() => api.toggleLock(layer.id)}
              onHide={() => api.toggleLayer(layer.id)}
            />
          </div>
        );
      })}
    </LayerDock>
  );
}
