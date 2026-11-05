import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine, Copy, Eye, EyeOff, GripVertical, ImageIcon, Lock, LockOpen, Plus, Trash2,
} from 'lucide-react';
import { MAX_LAYERS, type PaintLayer } from '../../../../lib/paint/document';
import { DRAG_THRESHOLD_PX, trackPointerDrag } from '../../../../lib/pointerDrag';
import { ToolbarBtn } from '../../shared/toolbarParts';
import type { PaintControls } from './usePaintTools';

/** A layer's name as shown: its own, or its place counted from the bottom. */
export function layerLabel(t: (key: string, opts?: Record<string, unknown>) => string, layer: PaintLayer, index: number): string {
  return layer.name || t('editor.paint.layerN', { n: index + 1 });
}

/**
 * The layers under the toolbar's layer button, the top one first as it lies
 * on the page. A click picks the layer drawn on, a double click renames it,
 * the grip drags it to another place (or moves it with the arrow keys). A
 * layer that holds an older drawing's image shows the image mark. Below the
 * list: the opacity of the layer drawn on, copying it, merging it into the
 * one below, removing it, and adding a new one.
 */
export default function LayerPanel({ api }: { api: PaintControls }) {
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
    if (e.button !== 0) return;
    e.preventDefault();
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

  return (
    <div className="paint-layers">
      {layers.map((layer, index) => ({ layer, index })).reverse().map(({ layer, index }) => {
        const isActive = layer.id === api.activeLayer;
        const label = layerLabel(t, layer, index);
        const target = dragging && dragging.id !== layer.id && dragging.to === index;
        return (
          <div
            key={layer.id}
            ref={(el) => { if (el) rows.current.set(layer.id, el); else rows.current.delete(layer.id); }}
            className={`paint-layer${isActive ? ' paint-layer--active' : ''}${dragging?.id === layer.id ? ' paint-layer--dragged' : ''}${target ? ` paint-layer--drop-${dragging.to > layers.findIndex((l) => l.id === dragging.id) ? 'above' : 'below'}` : ''}`}
          >
            <button
              type="button"
              className="paint-layer-grip"
              title={t('editor.paint.dragLayer')}
              aria-label={t('editor.paint.dragLayer')}
              onPointerDown={(e) => startDrag(e, layer.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); api.moveLayer(layer.id, 1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); api.moveLayer(layer.id, -1); }
              }}
            >
              <GripVertical size={12} />
            </button>
            <ToolbarBtn
              onClick={() => api.toggleLayer(layer.id)}
              active={false}
              title={t(layer.hidden ? 'editor.paint.showLayer' : 'editor.paint.hideLayer')}
            >
              {layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => api.toggleLock(layer.id)}
              active={layer.locked}
              title={t(layer.locked ? 'editor.paint.unlockLayer' : 'editor.paint.lockLayer')}
            >
              {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </ToolbarBtn>
            {renaming === layer.id ? (
              <input
                autoFocus
                defaultValue={layer.name}
                placeholder={label}
                maxLength={60}
                className="editor-inline-input paint-layer-name"
                onBlur={(e) => { api.renameLayer(layer.id, e.target.value); setRenaming(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); }
                }}
              />
            ) : (
              <button
                type="button"
                className={`paint-layer-name${layer.hidden ? ' paint-layer-name--hidden' : ''}`}
                onClick={() => api.activateLayer(layer.id)}
                onDoubleClick={() => setRenaming(layer.id)}
                title={t('editor.paint.renameHint')}
                aria-pressed={isActive}
              >
                {layer.image && <ImageIcon size={12} className="shrink-0" />}
                <span className="truncate">{label}</span>
                {layer.opacity < 1 && <span className="paint-layer-opacity">{Math.round(layer.opacity * 100)}%</span>}
              </button>
            )}
          </div>
        );
      })}
      {active && (
        <div className="paint-layer-actions">
          <label className="paint-layer-opacity-field" title={t('editor.paint.layerOpacity')}>
            <span>{t('editor.paint.layerOpacity')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(active.opacity * 100)}
              onChange={(e) => api.setOpacity(active.id, Number(e.target.value) / 100)}
              className="accent-accent"
              aria-label={t('editor.paint.layerOpacity')}
            />
            <span className="paint-size-value">{Math.round(active.opacity * 100)}</span>
          </label>
          <div className="paint-layer-buttons">
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
          </div>
        </div>
      )}
      <button type="button" className="paint-layer-add" onClick={api.addLayer} disabled={layers.length >= MAX_LAYERS}>
        <Plus size={14} />
        <span>{t('editor.paint.addLayer')}</span>
      </button>
    </div>
  );
}
