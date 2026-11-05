import { useCallback, useMemo, useState } from 'react';
import {
  clamp, emptyLayer, emptyPaintDoc, MAX_LAYERS, moveLayer as moveLayerIn, PAINT_SIZE_MAX, PAINT_SIZE_MIN,
  updateLayer, withStroke, type PaintDoc, type PaintStroke, type PaintTool,
} from '../../../../lib/paint/document';

/**
 * What the paint bar, the layer panel and the drawing surface work with
 * while a drawing is painted: its document, the layer drawn on, the brush,
 * and the changes. Every change of the document goes through `commit`, which
 * is the canvas editor's: one step in its one undo history, whether it is a
 * stroke, a layer change or a moved element.
 */
export interface PaintControls {
  doc: PaintDoc;
  activeLayer: string;
  tool: PaintTool;
  color: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  setTool: (tool: PaintTool) => void;
  setColor: (color: string) => void;
  setSize: (size: number) => void;
  undo: () => void;
  redo: () => void;
  addStroke: (stroke: PaintStroke) => void;
  activateLayer: (id: string) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, by: 1 | -1) => void;
  toggleLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  clear: () => void;
}

/** The brush and the layer drawn on; they outlive the drawing painted (the next one starts with them). */
export function usePaintBrush(startColor: string, startSize: number) {
  const [tool, setTool] = useState<PaintTool>('pen');
  const [color, setColor] = useState(startColor);
  const [size, setSizeRaw] = useState(startSize);
  const [wantedLayer, setWantedLayer] = useState<string | null>(null);
  const setSize = useCallback((next: number) => setSizeRaw(Math.round(clamp(next, PAINT_SIZE_MIN, PAINT_SIZE_MAX))), []);
  return { tool, setTool, color, setColor, size, setSize, wantedLayer, setWantedLayer };
}

/** The layer drawn on: the wanted one if the document has it, else the topmost. */
function activeIn(doc: PaintDoc, wanted: string | null): string {
  return wanted && doc.layers.some((l) => l.id === wanted) ? wanted : doc.layers[doc.layers.length - 1].id;
}

/** The controls for one document, from the brush and the canvas editor's commit and history. */
export function usePaintControls(
  doc: PaintDoc,
  brush: ReturnType<typeof usePaintBrush>,
  commit: (doc: PaintDoc) => void,
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean },
): PaintControls {
  const active = activeIn(doc, brush.wantedLayer);
  const { setWantedLayer } = brush;
  const actions = useMemo(() => ({
    addStroke: (stroke: PaintStroke) => commit(withStroke(doc, active, stroke)),
    activateLayer: (id: string) => setWantedLayer(id),
    addLayer: () => {
      if (doc.layers.length >= MAX_LAYERS) return;
      // Above the layer drawn on, and drawn on from now.
      const layer = emptyLayer();
      const at = doc.layers.findIndex((l) => l.id === active) + 1;
      setWantedLayer(layer.id);
      commit({ layers: [...doc.layers.slice(0, at), layer, ...doc.layers.slice(at)] });
    },
    removeLayer: (id: string) => {
      // The last layer is emptied rather than removed: a document always has one.
      if (doc.layers.length <= 1) commit(emptyPaintDoc());
      else commit({ layers: doc.layers.filter((l) => l.id !== id) });
    },
    moveLayer: (id: string, by: 1 | -1) => commit(moveLayerIn(doc, id, by)),
    toggleLayer: (id: string) => commit(updateLayer(doc, id, (l) => ({ ...l, hidden: !l.hidden }))),
    renameLayer: (id: string, name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (doc.layers.find((l) => l.id === id)?.name === trimmed) return;
      commit(updateLayer(doc, id, (l) => ({ ...l, name: trimmed })));
    },
    clear: () => commit(emptyPaintDoc()),
  }), [doc, active, commit, setWantedLayer]);

  return {
    doc,
    activeLayer: active,
    tool: brush.tool,
    color: brush.color,
    size: brush.size,
    setTool: brush.setTool,
    setColor: brush.setColor,
    setSize: brush.setSize,
    ...history,
    ...actions,
  };
}
