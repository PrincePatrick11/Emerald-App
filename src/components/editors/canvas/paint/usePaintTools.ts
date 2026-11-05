import { useCallback, useMemo, useState } from 'react';
import {
  canMergeDown, clamp, copyLayer, emptyLayer, emptyPaintDoc, IDENTITY, MAX_LAYERS, mergeDown, moveLayer as moveLayerIn, splitStroke, strokeSamples,
  MAX_SIDES, MIN_SIDES, moveLayerTo, PAINT_SIZE_MAX, PAINT_SIZE_MIN, paintId, symmetricCopies, transformStroke,
  translateLayer, updateLayer, type PaintDoc, type PaintStroke, type PaintTool, type PaintTransform, type Symmetry,
} from '../../../../lib/paint/document';

/**
 * The tools of the paint mode: the ones that draw a stroke (`PaintTool`, part
 * of the document) and the ones that work on what is drawn: selecting
 * strokes with a rectangle or a lasso, moving the whole layer, and taking a
 * colour from the drawing.
 */
export type EditorTool = PaintTool | 'select' | 'lasso' | 'move' | 'picker';

export type { Symmetry };

/** A grid over the drawing in the paint mode: shown or not, shapes and moves snapping to it or not, and how many cells across. */
export interface PaintGrid {
  visible: boolean;
  snap: boolean;
  cells: number;
}

export const MIN_GRID_CELLS = 4;
export const MAX_GRID_CELLS = 48;

export function isDrawTool(tool: EditorTool): tool is PaintTool {
  return tool !== 'select' && tool !== 'lasso' && tool !== 'move' && tool !== 'picker';
}

export function isSelectTool(tool: EditorTool): boolean {
  return tool === 'select' || tool === 'lasso';
}

/** How far a copy or a pasted stroke lies from its original, in document units. */
const COPY_OFFSET = 20;

/** Strokes copied in a paint mode, for the next paste (one per window). */
let strokeClipboard: PaintStroke[] = [];

/**
 * What the paint bar, the layer panel and the drawing surface work with
 * while a drawing is painted: its document, the layer drawn on, the brush,
 * the selected strokes, and the changes. Every change of the document goes
 * through `commit`, which is the canvas editor's: one step in its one undo
 * history, whether it is a stroke, a layer change or a moved element.
 */
export interface PaintControls {
  doc: PaintDoc;
  activeLayer: string;
  /** Is the layer drawn on locked (nothing is drawn, selected or moved on it)? */
  layerLocked: boolean;
  tool: EditorTool;
  color: string;
  size: number;
  /** Selected strokes of the active layer, by ID. */
  selection: string[];
  /** New box shapes are filled instead of outlined. */
  filled: boolean;
  /** Corners of a new polygon, points of a new star. */
  sides: number;
  /** Every new stroke gets its symmetric copies. */
  symmetry: Symmetry;
  grid: PaintGrid;
  canUndo: boolean;
  canRedo: boolean;
  setTool: (tool: EditorTool) => void;
  setColor: (color: string) => void;
  setSize: (size: number) => void;
  setFilled: (filled: boolean) => void;
  setSides: (sides: number) => void;
  setSymmetry: (symmetry: Symmetry) => void;
  setGrid: (grid: PaintGrid) => void;
  undo: () => void;
  redo: () => void;
  addStroke: (stroke: PaintStroke) => void;
  select: (ids: string[]) => void;
  /**
   * Selects what lies inside an area (a rectangle or a lasso), added to
   * `base`: a stroke wholly inside, and of a freehand stroke reaching out of
   * it the part inside, cut off from the rest (one step of its own).
   */
  selectArea: (isInside: (x: number, y: number) => boolean, base: string[]) => void;
  selectAll: () => void;
  /** The selected strokes, or with `layer` the whole active layer, moved, scaled and turned. */
  transform: (t: PaintTransform, layer?: boolean) => void;
  removeSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  activateLayer: (id: string) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, by: 1 | -1) => void;
  moveLayerTo: (id: string, index: number) => void;
  toggleLayer: (id: string) => void;
  toggleLock: (id: string) => void;
  setOpacity: (id: string, opacity: number) => void;
  duplicateLayer: (id: string) => void;
  canMergeDown: (id: string) => boolean;
  mergeDown: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  clear: () => void;
}

/** The brush, the layer drawn on and the selection; they outlive the drawing painted (the next one starts with them). */
export function usePaintBrush(startColor: string, startSize: number) {
  const [tool, setToolRaw] = useState<EditorTool>('pen');
  const [color, setColor] = useState(startColor);
  const [size, setSizeRaw] = useState(startSize);
  const [wantedLayer, setWantedLayer] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [filled, setFilled] = useState(false);
  const [sides, setSidesRaw] = useState(5);
  const [symmetry, setSymmetry] = useState<Symmetry>({ kind: 'off' });
  const [grid, setGridRaw] = useState<PaintGrid>({ visible: false, snap: false, cells: 12 });
  const setGrid = useCallback((next: PaintGrid) => setGridRaw({
    ...next, cells: Math.round(clamp(next.cells, MIN_GRID_CELLS, MAX_GRID_CELLS)),
  }), []);
  const setSides = useCallback((next: number) => setSidesRaw(Math.round(clamp(next, MIN_SIDES, MAX_SIDES))), []);
  const setSize = useCallback((next: number) => setSizeRaw(Math.round(clamp(next, PAINT_SIZE_MIN, PAINT_SIZE_MAX))), []);
  // A drawing tool lets the selection go; a selection tool keeps it.
  const setTool = useCallback((next: EditorTool) => {
    setToolRaw(next);
    if (!isSelectTool(next)) setSelection([]);
  }, []);
  return {
    tool, setTool, color, setColor, size, setSize, wantedLayer, setWantedLayer, selection, setSelection,
    filled, setFilled, sides, setSides, symmetry, setSymmetry, grid, setGrid,
  };
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
  const layer = doc.layers.find((l) => l.id === active)!;
  const { setWantedLayer, setSelection } = brush;
  // Only strokes that are still there, on the layer drawn on, and not erasers (they show nothing to hold).
  const selection = useMemo(() => {
    if (!brush.selection.length) return brush.selection;
    const ids = new Set(layer.strokes.filter((s) => s.tool !== 'eraser').map((s) => s.id));
    const kept = brush.selection.filter((id) => ids.has(id));
    return kept.length === brush.selection.length ? brush.selection : kept;
  }, [brush.selection, layer]);

  const actions = useMemo(() => {
    const onLayer = (change: (strokes: PaintStroke[]) => PaintStroke[]) =>
      commit(updateLayer(doc, active, (l) => ({ ...l, strokes: change(l.strokes) })));
    const addCopies = (source: PaintStroke[]) => {
      if (!source.length || layer.locked) return;
      const shift: PaintTransform = { ...IDENTITY, dx: COPY_OFFSET, dy: COPY_OFFSET };
      const copies = source.map((s) => ({ ...transformStroke(s, shift), id: paintId() }));
      onLayer((strokes) => [...strokes, ...copies]);
      setSelection(copies.map((s) => s.id));
    };
    return {
      // With its symmetric copies, in one step.
      addStroke: (stroke: PaintStroke) => {
        const copies = symmetricCopies(stroke, brush.symmetry).map((s) => ({ ...s, id: paintId() }));
        onLayer((strokes) => [...strokes, stroke, ...copies]);
      },
      select: (ids: string[]) => setSelection(ids),
      selectArea: (isInside: (x: number, y: number) => boolean, base: string[]) => {
        const picked: string[] = [];
        let cut = false;
        const strokes = layer.strokes.flatMap((s) => {
          if (s.tool === 'eraser') return [s];
          if (strokeSamples(s).every(([x, y]) => isInside(x, y))) {
            picked.push(s.id);
            return [s];
          }
          // A selected stroke stays whole: it is already chosen as it is.
          const split = layer.locked || base.includes(s.id) ? null : splitStroke(s, isInside);
          if (!split) return [s];
          cut = true;
          picked.push(...split.inside.map((piece) => piece.id));
          return split.pieces;
        });
        if (cut) commit(updateLayer(doc, active, (l) => ({ ...l, strokes })));
        setSelection([...new Set([...base, ...picked])]);
      },
      selectAll: () => setSelection(layer.strokes.filter((s) => s.tool !== 'eraser').map((s) => s.id)),
      transform: (t: PaintTransform, whole = false) => {
        if (layer.locked) return;
        if (whole) {
          commit(updateLayer(doc, active, (l) => translateLayer(l, t.dx, t.dy)));
          return;
        }
        const ids = new Set(selection);
        if (ids.size) onLayer((strokes) => strokes.map((s) => (ids.has(s.id) ? transformStroke(s, t) : s)));
      },
      removeSelection: () => {
        const ids = new Set(selection);
        if (!ids.size || layer.locked) return;
        onLayer((strokes) => strokes.filter((s) => !ids.has(s.id)));
        setSelection([]);
      },
      duplicateSelection: () => addCopies(layer.strokes.filter((s) => selection.includes(s.id))),
      copySelection: () => { strokeClipboard = layer.strokes.filter((s) => selection.includes(s.id)); },
      paste: () => {
        addCopies(strokeClipboard);
        // The next paste lies one step further.
        strokeClipboard = strokeClipboard.map((s) => transformStroke(s, { ...IDENTITY, dx: COPY_OFFSET, dy: COPY_OFFSET }));
      },
      activateLayer: (id: string) => {
        setWantedLayer(id);
        if (id !== active) setSelection([]);
      },
      addLayer: () => {
        if (doc.layers.length >= MAX_LAYERS) return;
        // Above the layer drawn on, and drawn on from now.
        const added = emptyLayer();
        const at = doc.layers.findIndex((l) => l.id === active) + 1;
        setWantedLayer(added.id);
        commit({ layers: [...doc.layers.slice(0, at), added, ...doc.layers.slice(at)] });
      },
      removeLayer: (id: string) => {
        // The last layer is emptied rather than removed: a document always has one.
        if (doc.layers.length <= 1) commit(emptyPaintDoc());
        else commit({ layers: doc.layers.filter((l) => l.id !== id) });
      },
      moveLayer: (id: string, by: 1 | -1) => commit(moveLayerIn(doc, id, by)),
      moveLayerTo: (id: string, index: number) => {
        if (doc.layers.findIndex((l) => l.id === id) !== index) commit(moveLayerTo(doc, id, index));
      },
      toggleLayer: (id: string) => commit(updateLayer(doc, id, (l) => ({ ...l, hidden: !l.hidden }))),
      toggleLock: (id: string) => commit(updateLayer(doc, id, (l) => ({ ...l, locked: !l.locked }))),
      setOpacity: (id: string, opacity: number) => {
        const next = Math.round(clamp(opacity, 0, 1) * 100) / 100;
        if (doc.layers.find((l) => l.id === id)?.opacity !== next) commit(updateLayer(doc, id, (l) => ({ ...l, opacity: next })));
      },
      duplicateLayer: (id: string) => {
        const i = doc.layers.findIndex((l) => l.id === id);
        if (i < 0 || doc.layers.length >= MAX_LAYERS) return;
        const copy = copyLayer(doc.layers[i]);
        setWantedLayer(copy.id);
        commit({ layers: [...doc.layers.slice(0, i + 1), copy, ...doc.layers.slice(i + 1)] });
      },
      canMergeDown: (id: string) => canMergeDown(doc, id),
      mergeDown: (id: string) => {
        const i = doc.layers.findIndex((l) => l.id === id);
        if (!canMergeDown(doc, id)) return;
        setWantedLayer(doc.layers[i - 1].id);
        commit(mergeDown(doc, id));
      },
      renameLayer: (id: string, name: string) => {
        const trimmed = name.trim().slice(0, 60);
        if (doc.layers.find((l) => l.id === id)?.name === trimmed) return;
        commit(updateLayer(doc, id, (l) => ({ ...l, name: trimmed })));
      },
      clear: () => commit(emptyPaintDoc()),
    };
  }, [doc, active, layer, selection, commit, setWantedLayer, setSelection, brush.symmetry]);

  return {
    doc,
    activeLayer: active,
    layerLocked: layer.locked,
    tool: brush.tool,
    color: brush.color,
    size: brush.size,
    selection,
    setTool: brush.setTool,
    setColor: brush.setColor,
    setSize: brush.setSize,
    filled: brush.filled,
    sides: brush.sides,
    symmetry: brush.symmetry,
    setFilled: brush.setFilled,
    setSides: brush.setSides,
    setSymmetry: brush.setSymmetry,
    grid: brush.grid,
    setGrid: brush.setGrid,
    ...history,
    ...actions,
  };
}
