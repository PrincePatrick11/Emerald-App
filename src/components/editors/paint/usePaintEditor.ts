import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  clamp, emptyLayer, emptyPaintDoc, MAX_LAYERS, moveLayer as moveLayerIn, PAINT_SIZE_MAX, PAINT_SIZE_MIN,
  updateLayer, withStroke, type PaintDoc, type PaintStroke, type PaintTool,
} from '../../../lib/paint/document';

/**
 * The state of one paint editor: the document with its undo history, the
 * layer drawn on, and the brush. Every change of the document is one undo
 * step — a stroke, and also a layer added, hidden, renamed or moved, since
 * each of them changes what is saved.
 */

const HISTORY_LIMIT = 200;

interface History {
  past: PaintDoc[];
  doc: PaintDoc;
  future: PaintDoc[];
  active: string;
}

type Action =
  | { type: 'commit'; doc: PaintDoc; active?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'activate'; id: string };

/** The layer drawn on: the wanted one if it is still there, else the topmost. */
function keepActive(doc: PaintDoc, wanted: string): string {
  return doc.layers.some((l) => l.id === wanted) ? wanted : doc.layers[doc.layers.length - 1].id;
}

function reduce(h: History, action: Action): History {
  switch (action.type) {
    case 'commit':
      if (action.doc === h.doc) return h;
      return {
        past: [...h.past, h.doc].slice(-HISTORY_LIMIT),
        doc: action.doc,
        future: [],
        active: keepActive(action.doc, action.active ?? h.active),
      };
    case 'undo': {
      const doc = h.past[h.past.length - 1];
      if (!doc) return h;
      return { past: h.past.slice(0, -1), doc, future: [h.doc, ...h.future], active: keepActive(doc, h.active) };
    }
    case 'redo': {
      const [doc, ...future] = h.future;
      if (!doc) return h;
      return { past: [...h.past, h.doc], doc, future, active: keepActive(doc, h.active) };
    }
    case 'activate':
      return { ...h, active: keepActive(h.doc, action.id) };
  }
}

export interface PaintEditorApi {
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

/**
 * `initial` is read once. `onChange` hears every change of the document
 * (strokes, undo, redo, layers), not the one it started with.
 */
export function usePaintEditor({ initial, startColor, startSize, onChange }: {
  initial: PaintDoc;
  startColor: string;
  startSize: number;
  onChange: (doc: PaintDoc) => void;
}): PaintEditorApi {
  const [h, dispatch] = useReducer(reduce, initial, (doc): History => ({
    past: [], doc, future: [], active: doc.layers[doc.layers.length - 1].id,
  }));
  const [tool, setTool] = useState<PaintTool>('pen');
  const [color, setColor] = useState(startColor);
  const [size, setSizeRaw] = useState(startSize);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const reported = useRef(h.doc);
  useEffect(() => {
    if (reported.current === h.doc) return;
    reported.current = h.doc;
    onChangeRef.current(h.doc);
  }, [h.doc]);

  // The reducer state for the callbacks below, so they keep their identity.
  const current = useRef(h);
  current.current = h;
  const commit = useCallback((doc: PaintDoc, active?: string) => dispatch({ type: 'commit', doc, active }), []);

  const setSize = useCallback((next: number) => setSizeRaw(Math.round(clamp(next, PAINT_SIZE_MIN, PAINT_SIZE_MAX))), []);

  const actions = useMemo(() => ({
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    addStroke: (stroke: PaintStroke) => {
      const { doc, active } = current.current;
      commit(withStroke(doc, active, stroke));
    },
    activateLayer: (id: string) => dispatch({ type: 'activate', id }),
    addLayer: () => {
      const { doc, active } = current.current;
      if (doc.layers.length >= MAX_LAYERS) return;
      // Above the layer drawn on, and drawn on from now.
      const layer = emptyLayer();
      const at = doc.layers.findIndex((l) => l.id === active) + 1;
      commit({ layers: [...doc.layers.slice(0, at), layer, ...doc.layers.slice(at)] }, layer.id);
    },
    removeLayer: (id: string) => {
      const { doc } = current.current;
      // The last layer is emptied rather than removed: a document always has one.
      if (doc.layers.length <= 1) commit(emptyPaintDoc());
      else commit({ layers: doc.layers.filter((l) => l.id !== id) });
    },
    moveLayer: (id: string, by: 1 | -1) => commit(moveLayerIn(current.current.doc, id, by)),
    toggleLayer: (id: string) => commit(updateLayer(current.current.doc, id, (l) => ({ ...l, hidden: !l.hidden }))),
    renameLayer: (id: string, name: string) => {
      const { doc } = current.current;
      const trimmed = name.trim().slice(0, 60);
      if (doc.layers.find((l) => l.id === id)?.name === trimmed) return;
      commit(updateLayer(doc, id, (l) => ({ ...l, name: trimmed })));
    },
    clear: () => commit(emptyPaintDoc()),
  }), [commit]);

  return {
    doc: h.doc,
    activeLayer: h.active,
    tool,
    color,
    size,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    setTool,
    setColor,
    setSize,
    ...actions,
  };
}
