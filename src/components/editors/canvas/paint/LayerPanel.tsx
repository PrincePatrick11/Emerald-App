import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Eye, EyeOff, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { MAX_LAYERS, type PaintLayer } from '../../../../lib/paint/document';
import { ToolbarBtn } from '../../shared/toolbarParts';
import type { PaintControls } from './usePaintTools';

/** A layer's name as shown: its own, or its place counted from the bottom. */
export function layerLabel(t: (key: string, opts?: Record<string, unknown>) => string, layer: PaintLayer, index: number): string {
  return layer.name || t('editor.paint.layerN', { n: index + 1 });
}

/**
 * The layers under the toolbar's layer button, the top one first as it lies
 * on the page. A click picks the layer drawn on, a double click renames it.
 * A layer that holds an older drawing's image shows the image mark.
 */
export default function LayerPanel({ api }: { api: PaintControls }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<string | null>(null);
  const { layers } = api.doc;

  return (
    <div className="paint-layers">
      {layers.map((layer, index) => ({ layer, index })).reverse().map(({ layer, index }) => {
        const active = layer.id === api.activeLayer;
        const label = layerLabel(t, layer, index);
        return (
          <div key={layer.id} className={`paint-layer${active ? ' paint-layer--active' : ''}`}>
            <ToolbarBtn
              onClick={() => api.toggleLayer(layer.id)}
              active={false}
              title={t(layer.hidden ? 'editor.paint.showLayer' : 'editor.paint.hideLayer')}
            >
              {layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
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
                aria-pressed={active}
              >
                {layer.image && <ImageIcon size={12} className="shrink-0" />}
                <span className="truncate">{label}</span>
              </button>
            )}
            <ToolbarBtn onClick={() => api.moveLayer(layer.id, 1)} active={false} disabled={index === layers.length - 1} title={t('editor.paint.layerUp')}>
              <ChevronUp size={14} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => api.moveLayer(layer.id, -1)} active={false} disabled={index === 0} title={t('editor.paint.layerDown')}>
              <ChevronDown size={14} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => api.removeLayer(layer.id)} active={false} title={t('editor.paint.removeLayer')}>
              <Trash2 size={14} />
            </ToolbarBtn>
          </div>
        );
      })}
      <button type="button" className="paint-layer-add" onClick={api.addLayer} disabled={layers.length >= MAX_LAYERS}>
        <Plus size={14} />
        <span>{t('editor.paint.addLayer')}</span>
      </button>
    </div>
  );
}
