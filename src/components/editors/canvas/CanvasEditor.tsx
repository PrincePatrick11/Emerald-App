import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import Konva from 'konva';
import { Group, Layer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import { DRAG_THRESHOLD_PX, trackPointerDrag } from '../../../lib/pointerDrag';
import { drawElement, resourcesOf } from './draw';
import { cachedCanvasImage, useCanvasResources } from './imageCache';
import { boxFromPoints, boxesIntersect, elementBounds, unionBounds, type Box } from './geometry';
import { snapToGuides, snapToStep, type Guide } from './snapping';
import { useCanvasHistory } from './useCanvasHistory';
import { FULL_CANVAS_FEATURES, type CanvasFeatures } from './features';
import { BUILTIN_CANVAS_TYPES } from './elements';
import {
  align, arrange, clamp, copiesOf, distribute, nudge, type AlignEdge, type ArrangeMove,
} from './canvasActions';
import { byZ, type CanvasAddition, type CanvasElement, type CanvasGrid, type CanvasTypes } from './types';
import CanvasToolbar, { CanvasZoom } from './CanvasToolbar';
import TextEditOverlay from './TextEditOverlay';
import PaintSurface from './paint/PaintSurface';
import PaintToolbar, { PAINT_TOOL_DEFS, toolEnabled } from './paint/PaintToolbar';
import { isSelectTool, usePaintBrush, usePaintControls } from './paint/usePaintTools';
import { FULL_PAINT_FEATURES, type PaintFeatures } from './paint/features';
import { emptyPaintDoc, type PaintDoc } from '../../../lib/paint/document';
import { ToolbarBtn } from '../shared/toolbarParts';
import { Check } from 'lucide-react';

/** How close, on screen, an edge has to come to a guide to snap. */
const GUIDE_SNAP_PX = 6;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** Space around the artboard while editing. */
const EDIT_PADDING = 32;
const PASTE_OFFSET = 24;

/** What the canvas editor keeps between two pastes (one per window, shared by every canvas editor). */
let clipboard: CanvasElement[] = [];

export interface CanvasEditorHandle {
  /** A point of the window in artboard pixels, or `null` when it is outside the stage. */
  clientToArtboard: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** The middle of what is visible of the artboard, for placing new elements. */
  visibleCentre: () => { x: number; y: number };
}

export interface CanvasEditorProps {
  /** The artboard, in its own pixels. */
  width: number;
  height: number;
  elements: CanvasElement[];
  /** Every change made in the canvas editor, as the whole new list. */
  onChange: (elements: CanvasElement[]) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  editable: boolean;
  /** The element types, by name; default the built-in image, shape and text. */
  types?: CanvasTypes;
  features?: CanvasFeatures;
  /** Painted behind the artboard, filling it (DOM: an image, a gradient). */
  background?: ReactNode;
  grid?: CanvasGrid | null;
  /** Rotation snaps to multiples of this, in degrees; `null`: near the right angles, and 15° with Shift. */
  rotationSnap?: number | null;
  /** When it changes, undo starts over (another document). */
  historyKey?: string;
  /** Where the artboard sits while reading: in the middle, or at the top. */
  readAlign?: 'center' | 'top';
  /** New ids for added and copied elements. */
  createId?: () => string;
  /** Opening an element whose type has no typing in place (double-click or Enter), e.g. in an editor of its own. */
  onEditElement?: (element: CanvasElement) => void;
  /** Saving as an image, offered in the toolbar when given and `features.export` is on. */
  onExport?: () => void;
  /** Drawn over the viewport, e.g. a hint while something is dragged in. */
  overlay?: ReactNode;
  /** Extra controls at the end of the toolbar. */
  toolbarEnd?: ReactNode;
  /** The paint tools of the paint mode: which there are, the palette, the brush to start with. */
  paint?: CanvasPaintOptions;
  /**
   * An element the editor is fixed in the paint mode of: it starts there and
   * stays, with nothing else to select or add. To the user it is a paint editor.
   */
  paintElementId?: string;
  /**
   * `fill`: the editor fills its positioned parent. `inline`: it sits in the
   * flow, as wide as its parent, the stage as high as the artboard's shape asks.
   */
  layout?: 'fill' | 'inline';
}

export interface CanvasPaintOptions {
  features?: PaintFeatures;
  palette: readonly string[];
  startColor: string;
  startSize: number;
}

/** No drawing open: the paint hooks still need a document. */
const NO_DOC: PaintDoc = emptyPaintDoc();
const DEFAULT_PAINT: CanvasPaintOptions = { palette: ['#000000', '#ffffff'], startColor: '#000000', startSize: 6 };

interface View {
  zoom: number;
  x: number;
  y: number;
}

function readToken(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * Where a box's centre goes when its height changes from `before` to `after`,
 * keeping its top edge in place (along its own rotation).
 */
function keepTop(el: Pick<CanvasElement, 'x' | 'y' | 'rotation'>, before: number, after: number): { x: number; y: number } {
  const shift = (after - before) / 2;
  const rad = (el.rotation * Math.PI) / 180;
  return { x: el.x - Math.sin(rad) * shift, y: el.y + Math.cos(rad) * shift };
}

/**
 * The canvas editor: elements on an artboard, selected with handles to move, scale
 * and rotate them, several at once, with guides and a grid, zoom and pan,
 * undo, keys and a toolbar. What the elements are and how they draw comes
 * from the type registry (`types`); the elements belong to the embedding place
 * (`elements`/`onChange`). The canvas editor keeps only the view and what a gesture
 * moves before it is committed. See Documentation/architecture/editors.md.
 */
const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(function CanvasEditor({
  width, height, elements, onChange, selectedIds, onSelectionChange, editable,
  types = BUILTIN_CANVAS_TYPES, features = FULL_CANVAS_FEATURES, background, grid = null, rotationSnap = null,
  historyKey = '', readAlign = 'center', createId = () => crypto.randomUUID(), onEditElement, onExport, overlay, toolbarEnd,
  paint = DEFAULT_PAINT, paintElementId, layout = 'fill',
}, ref) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const elementsLayerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Shape>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  /** While true, the view follows the viewport's size; zooming or panning ends it. */
  const fittedRef = useRef(true);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [paintingIdState, setPaintingId] = useState<string | null>(null);
  const paintingId = paintElementId ?? paintingIdState;
  const [spaceDown, setSpaceDown] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [gesture, setGesture] = useState(false);

  // The latest props for the handlers below, which outlive a render.
  const live = useRef({ elements, selectedIds, view, onChange, onSelectionChange, grid, types });
  live.current = { elements, selectedIds, view, onChange, onSelectionChange, grid, types };

  const history = useCanvasHistory(elements, onChange, `${historyKey}:${editable}`);
  const brush = usePaintBrush(paint.startColor, paint.startSize);
  const commit = useCallback((next: CanvasElement[]) => {
    history.markLocal();
    live.current.onChange(next);
  }, [history]);

  const { sources, fonts } = useMemo(() => resourcesOf(elements, types), [elements, types]);
  const resourceVersion = useCanvasResources(sources, fonts);
  const sorted = useMemo(() => byZ(elements), [elements]);
  const byId = useMemo(() => new Map(elements.map((el) => [el.id, el])), [elements]);
  const selected = useMemo(() => selectedIds.map((id) => byId.get(id)).filter((el): el is CanvasElement => !!el), [selectedIds, byId]);

  /** The element with its height fitted to its type, the top edge kept. */
  const fitted = useCallback((el: CanvasElement, heightBefore = el.height): CanvasElement => {
    const fit = live.current.types[el.type]?.fitHeight;
    if (!fit) return el;
    const h = fit(el);
    return { ...el, height: h, ...keepTop(el, heightBefore, h) };
  }, []);

  // ── View ──────────────────────────────────────────────────────────────

  const fitView = useCallback((viewport: { width: number; height: number }, isEditing: boolean): View => {
    const pad = isEditing && !paintElementId ? EDIT_PADDING : 0;
    const zoom = clamp(Math.min((viewport.width - 2 * pad) / width, (viewport.height - 2 * pad) / height), MIN_ZOOM, MAX_ZOOM);
    const x = (viewport.width - width * zoom) / 2;
    const y = !isEditing && readAlign === 'top' ? 0 : (viewport.height - height * zoom) / 2;
    return { zoom: zoom > 0 ? zoom : 1, x, y };
  }, [width, height, readAlign, paintElementId]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reading always fits; editing fits until the view is zoomed or panned.
  useLayoutEffect(() => {
    if (!size.width || !size.height) return;
    if (!editable) fittedRef.current = true;
    if (fittedRef.current) setView(fitView(size, editable));
  }, [size, editable, fitView]);

  const zoomTo = useCallback((zoom: number, anchor?: { x: number; y: number }) => {
    fittedRef.current = false;
    setView((current) => {
      const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      const point = anchor ?? { x: size.width / 2, y: size.height / 2 };
      const ax = (point.x - current.x) / current.zoom;
      const ay = (point.y - current.y) / current.zoom;
      return { zoom: next, x: point.x - ax * next, y: point.y - ay * next };
    });
  }, [size]);

  const fit = useCallback(() => {
    fittedRef.current = true;
    setView(fitView(size, editable));
  }, [fitView, size, editable]);

  const toArtboard = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const v = live.current.view;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }, []);

  const visibleCentre = useCallback(() => {
    const v = live.current.view;
    return {
      x: clamp((size.width / 2 - v.x) / v.zoom, width * 0.1, width * 0.9),
      y: clamp((size.height / 2 - v.y) / v.zoom, height * 0.1, height * 0.9),
    };
  }, [size, width, height]);

  useImperativeHandle(ref, () => ({
    clientToArtboard: (clientX, clientY) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      return toArtboard(clientX, clientY);
    },
    visibleCentre,
  }), [toArtboard, visibleCentre]);

  // Wheel: pinch or ⌘/Ctrl zooms at the pointer, otherwise it pans.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !editable || !features.zoom) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
        zoomTo(live.current.view.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else if (layout === 'inline' && fittedRef.current) {
        // In the flow of a page the wheel scrolls the page until the view is zoomed.
        return;
      } else {
        fittedRef.current = false;
        e.preventDefault();
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editable, features.zoom, zoomTo, layout]);

  // ── Selection and transformer ─────────────────────────────────────────

  const select = useCallback((ids: string[]) => {
    const current = live.current.selectedIds;
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
    live.current.onSelectionChange(ids);
  }, []);

  // Selected elements that disappeared (deleted, hidden) leave the selection.
  useEffect(() => {
    const valid = selectedIds.filter((id) => {
      const el = byId.get(id);
      return el && !el.hidden;
    });
    if (valid.length !== selectedIds.length) select(valid);
  }, [selectedIds, byId, select]);

  const handleable = useMemo(
    () => (editable && !paintingId ? selected.filter((el) => !el.locked && !el.hidden && el.id !== editingTextId) : []),
    [editable, selected, editingTextId, paintingId],
  );

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    tr.nodes(handleable.map((el) => nodes.current.get(el.id)).filter((n): n is Konva.Shape => !!n));
    tr.getLayer()?.batchDraw();
  }, [handleable, elements, view]);

  const handleKinds = handleable.map((el) => types[el.type]?.handles ?? 'all');
  const keepRatio = handleable.some((el) => types[el.type]?.keepRatio);
  const anchors = handleKinds.length === 1 && handleKinds[0] === 'corners-and-sides'
    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
    : handleKinds.some((kind) => kind !== 'all')
      ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
      : undefined;
  const rotationSnaps = rotationSnap && rotationSnap > 0
    ? Array.from({ length: Math.floor(360 / rotationSnap) }, (_, i) => i * rotationSnap)
    : [0, 90, 180, 270];

  // ── Committing changes ────────────────────────────────────────────────

  /** The elements with the given ones replaced. */
  const patched = useCallback((changes: Map<string, CanvasElement>) =>
    live.current.elements.map((el) => changes.get(el.id) ?? el), []);

  const commitTransform = useCallback(() => {
    const tr = transformerRef.current;
    const sides = (tr?.getActiveAnchor() ?? '').startsWith('middle');
    const changes = new Map<string, CanvasElement>();
    for (const el of live.current.elements) {
      const node = nodes.current.get(el.id);
      if (!node || !tr?.nodes().includes(node)) continue;
      const sx = Math.abs(node.scaleX());
      const sy = Math.abs(node.scaleY());
      const rotation = ((node.rotation() % 360) + 360) % 360;
      let next: CanvasElement = {
        ...el, x: node.x(), y: node.y(), rotation: Math.round(rotation * 10) / 10,
        width: Math.max(1, node.width() * sx), height: Math.max(1, node.height() * sy),
      };
      const scaled = live.current.types[el.type]?.scaled;
      if (scaled && !sides && (sx !== 1 || sy !== 1)) next = { ...next, ...scaled(el, sx, sy) };
      next = fitted(next, next.height);
      node.scale({ x: 1, y: 1 });
      changes.set(el.id, next);
    }
    if (changes.size) commit(patched(changes));
  }, [commit, patched, fitted]);

  /** A type with a fitted height, resized by its side handles, rewraps live instead of stretching. */
  const onTransform = useCallback(() => {
    const tr = transformerRef.current;
    if (!tr || tr.nodes().length !== 1 || !(tr.getActiveAnchor() ?? '').startsWith('middle')) return;
    const node = tr.nodes()[0] as Konva.Shape;
    const el = live.current.elements.find((e) => e.id === node.id());
    const fit = el && live.current.types[el.type]?.fitHeight;
    if (!el || !fit) return;
    const w = Math.max(8, node.width() * node.scaleX());
    const before = node.height();
    const h = fit({ ...el, width: w });
    node.setAttrs({ width: w, scaleX: 1, offsetX: w / 2, height: h, offsetY: h / 2 });
    node.position(keepTop({ x: node.x(), y: node.y(), rotation: node.rotation() }, before, h));
  }, []);

  // ── Pointer gestures ──────────────────────────────────────────────────

  const elementAt = (target: Konva.Node): CanvasElement | null => {
    let node: Konva.Node | null = target;
    while (node && !node.hasName('canvas-element')) node = node.getParent();
    if (!node) return null;
    return live.current.elements.find((el) => el.id === node!.id()) ?? null;
  };

  const startPan = (start: PointerEvent) => {
    const from = live.current.view;
    setGesture(true);
    trackPointerDrag(start, {
      onMove: (e) => {
        fittedRef.current = false;
        setView({ ...from, x: from.x + e.clientX - start.clientX, y: from.y + e.clientY - start.clientY });
      },
      onEnd: () => setGesture(false),
    });
  };

  const startMarquee = (start: PointerEvent, base: string[]) => {
    const box = (e: PointerEvent) => {
      const a = toArtboard(start.clientX, start.clientY);
      const b = toArtboard(e.clientX, e.clientY);
      return boxFromPoints(a.x, a.y, b.x, b.y);
    };
    let last: PointerEvent | null = null;
    trackPointerDrag(start, {
      threshold: DRAG_THRESHOLD_PX,
      onStart: () => setGesture(true),
      onMove: (e) => { last = e; setMarquee(box(e)); },
      onEnd: ({ started }) => {
        setGesture(false);
        setMarquee(null);
        if (!started || !last) {
          select(base);
          return;
        }
        const area = box(last);
        const hits = live.current.elements
          .filter((el) => !el.locked && !el.hidden && boxesIntersect(elementBounds(el), area))
          .map((el) => el.id);
        select([...new Set([...base, ...hits])]);
      },
    });
  };

  const startMove = (start: PointerEvent, ids: string[], grabbed: string) => {
    const moving = live.current.elements.filter((el) => ids.includes(el.id) && !el.locked && !el.hidden);
    if (!moving.length) return;
    const starts = new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }]));
    const others = live.current.elements.filter((el) => !ids.includes(el.id) && !el.hidden).map(elementBounds);
    const union = unionBounds(moving.map(elementBounds))!;
    trackPointerDrag(start, {
      threshold: DRAG_THRESHOLD_PX,
      onStart: () => setGesture(true),
      onMove: (e) => {
        const v = live.current.view;
        let dx = (e.clientX - start.clientX) / v.zoom;
        let dy = (e.clientY - start.clientY) / v.zoom;
        let lines: Guide[] = [];
        const g = live.current.grid;
        if (!e.altKey && g?.snapPosition) {
          const from = starts.get(grabbed) ?? starts.values().next().value!;
          dx += snapToStep(from.x + dx, width / g.columns) - (from.x + dx);
          dy += snapToStep(from.y + dy, height / g.rows) - (from.y + dy);
        } else if (!e.altKey && features.guides) {
          const snap = snapToGuides({ ...union, x: union.x + dx, y: union.y + dy }, others, { width, height }, GUIDE_SNAP_PX / v.zoom);
          dx += snap.dx;
          dy += snap.dy;
          lines = snap.guides;
        }
        // Every centre stays on the artboard.
        for (const from of starts.values()) {
          dx = clamp(dx, -from.x, width - from.x);
          dy = clamp(dy, -from.y, height - from.y);
        }
        for (const [id, from] of starts) nodes.current.get(id)?.position({ x: from.x + dx, y: from.y + dy });
        transformerRef.current?.forceUpdate();
        elementsLayerRef.current?.batchDraw();
        transformerRef.current?.getLayer()?.batchDraw();
        setGuides(lines);
      },
      onEnd: ({ started, cancelled }) => {
        setGesture(false);
        setGuides([]);
        if (!started) return;
        const changes = new Map<string, CanvasElement>();
        for (const el of moving) {
          const node = nodes.current.get(el.id);
          if (!node) continue;
          if (cancelled) node.position(starts.get(el.id)!);
          else changes.set(el.id, { ...el, x: node.x(), y: node.y() });
        }
        if (changes.size) commit(patched(changes));
        else elementsLayerRef.current?.batchDraw();
      },
    });
  };

  const onStagePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt;
    // While reading, a click only selects (the place may show what is selected).
    if (!editable) {
      if (evt.button !== 0) return;
      const hit = elementAt(e.target);
      select(hit && !hit.locked ? [hit.id] : []);
      return;
    }
    rootRef.current?.focus({ preventScroll: true });
    // The drawing surface takes the presses on the drawing; one beside it ends the paint mode.
    if (paintingId) {
      if (!paintElementId) setPaintingId(null);
      return;
    }
    if (evt.button !== 0) return;
    // The transformer's own handles.
    if (e.target.getParent() instanceof Konva.Transformer) return;
    const additive = evt.shiftKey || evt.metaKey || evt.ctrlKey;
    const hit = elementAt(e.target);
    const current = live.current.selectedIds;
    if (!hit || hit.locked) {
      setEditingTextId(null);
      startMarquee(evt, additive ? current : []);
      return;
    }
    if (editingTextId && editingTextId !== hit.id) setEditingTextId(null);
    let ids = current;
    if (additive) {
      ids = current.includes(hit.id) ? current.filter((id) => id !== hit.id) : [...current, hit.id];
      select(ids);
      if (!ids.includes(hit.id)) return;
    } else if (!current.includes(hit.id)) {
      ids = [hit.id];
      select(ids);
    }
    startMove(evt, ids, hit.id);
  };

  // ── Commands ──────────────────────────────────────────────────────────

  const editableIds = useCallback(
    () => live.current.selectedIds.filter((id) => {
      const el = live.current.elements.find((e) => e.id === id);
      return el && !el.locked;
    }),
    [],
  );

  const removeSelected = useCallback(() => {
    const ids = editableIds();
    if (!ids.length) return;
    commit(live.current.elements.filter((el) => !ids.includes(el.id)));
    select([]);
  }, [commit, editableIds, select]);

  const addCopies = useCallback((source: CanvasElement[], offset: number) => {
    if (!source.length) return;
    const copies = copiesOf(source, live.current.elements, offset, createId);
    commit([...live.current.elements, ...copies]);
    select(copies.map((el) => el.id));
  }, [commit, createId, select]);

  const duplicate = useCallback(() => {
    addCopies(live.current.elements.filter((el) => live.current.selectedIds.includes(el.id)), PASTE_OFFSET);
  }, [addCopies]);

  const copy = useCallback(() => {
    clipboard = live.current.elements.filter((el) => live.current.selectedIds.includes(el.id));
  }, []);

  const paste = useCallback(() => {
    // Only what this canvas editor can draw.
    addCopies(clipboard.filter((el) => live.current.types[el.type]), PASTE_OFFSET);
    clipboard = clipboard.map((el) => ({ ...el, x: el.x + PASTE_OFFSET, y: el.y + PASTE_OFFSET }));
  }, [addCopies]);

  const doArrange = useCallback((move: ArrangeMove) => {
    commit(arrange(live.current.elements, editableIds(), move));
  }, [commit, editableIds]);

  const doAlign = useCallback((edge: AlignEdge) => {
    commit(align(live.current.elements, editableIds(), edge, { width, height }));
  }, [commit, editableIds, width, height]);

  const doDistribute = useCallback((axis: 'horizontal' | 'vertical') => {
    commit(distribute(live.current.elements, editableIds(), axis));
  }, [commit, editableIds]);

  const updateSelected = useCallback((type: string, patch: (el: CanvasElement) => Partial<CanvasElement> | null) => {
    const ids = editableIds();
    const changes = new Map<string, CanvasElement>();
    for (const el of live.current.elements) {
      if (!ids.includes(el.id) || el.type !== type) continue;
      const p = patch(el);
      if (p) changes.set(el.id, fitted({ ...el, ...p }, el.height));
    }
    if (changes.size) commit(patched(changes));
  }, [commit, editableIds, patched, fitted]);

  const add = useCallback((type: string, addition: CanvasAddition) => {
    // Something already sits there: a step down and to the right, so the new one shows.
    let centre = visibleCentre();
    while (live.current.elements.some((e) => Math.abs(e.x - centre.x) < 1 && Math.abs(e.y - centre.y) < 1)) {
      centre = { x: centre.x + PASTE_OFFSET, y: centre.y + PASTE_OFFSET };
    }
    const made = addition.create(centre, { width, height }, t);
    const el: CanvasElement = {
      id: createId(), type, x: centre.x, y: centre.y, rotation: 0, opacity: 1, locked: false, hidden: false,
      z: live.current.elements.reduce((max, e) => Math.max(max, e.z), -1) + 1,
      ...made,
    };
    commit([...live.current.elements, el]);
    select([el.id]);
    // A new text is typed into at once, a new drawing painted in.
    if (live.current.types[type]?.textEdit) setEditingTextId(el.id);
    else if (live.current.types[type]?.paint) setPaintingId(el.id);
  }, [visibleCentre, width, height, t, createId, commit, select]);

  const openElement = useCallback((el: CanvasElement) => {
    if (el.locked) return;
    const type = live.current.types[el.type];
    if (type?.textEdit) setEditingTextId(el.id);
    else if (type?.paint) setPaintingId(el.id);
    else onEditElement?.(el);
  }, [onEditElement]);

  const finishTextEdit = useCallback((id: string, text: string) => {
    setEditingTextId(null);
    const el = live.current.elements.find((e) => e.id === id);
    const edit = el && live.current.types[el.type]?.textEdit;
    if (!el || !edit) return;
    if (!text.trim()) {
      commit(live.current.elements.filter((e) => e.id !== id));
      select([]);
      return;
    }
    if (text === edit.get(el)) return;
    commit(patched(new Map([[id, fitted({ ...el, props: edit.set(el, text) }, el.height)]])));
  }, [commit, patched, fitted, select]);

  // ── Keys ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    const blur = () => setSpaceDown(false);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editable || editingTextId) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    // The paint mode's keys: undo, the tools' letters, `[` and `]` for the size, Escape to leave.
    if (paintingId) {
      const pc = paintControls;
      const selecting = pc.selection.length > 0;
      if (e.code === 'Space' && !mod && features.zoom) { setSpaceDown(true); handled(); return; }
      if (mod && key === 'z') { handled(); if (e.shiftKey) history.redo(); else history.undo(); return; }
      if (mod && key === 'y') { handled(); history.redo(); return; }
      if (mod && key === '0' && features.zoom) { handled(); fit(); return; }
      if (mod && key === 'a' && paintFeatures.select) { handled(); if (!isSelectTool(pc.tool)) pc.setTool('select'); pc.selectAll(); return; }
      if (mod && key === 'd' && selecting) { handled(); pc.duplicateSelection(); return; }
      if (mod && key === 'c' && selecting) { handled(); pc.copySelection(); return; }
      if (mod && key === 'x' && selecting) { handled(); pc.copySelection(); pc.removeSelection(); return; }
      if (mod && key === 'v' && paintFeatures.select) { handled(); if (!isSelectTool(pc.tool)) pc.setTool('select'); pc.paste(); return; }
      if (e.key === 'Escape') {
        if (selecting) { handled(); pc.select([]); return; }
        if (!paintElementId) { handled(); setPaintingId(null); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selecting) { handled(); pc.removeSelection(); return; }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const arrow = arrows[e.key];
      if (arrow && selecting) {
        handled();
        const step = e.shiftKey ? 10 : 1;
        pc.transform({ dx: arrow[0] * step, dy: arrow[1] * step, scale: 1, angle: 0, cx: 0, cy: 0 });
        return;
      }
      if (mod || e.altKey) return;
      if (key === '[') { handled(); brush.setSize(brush.size - (brush.size > 10 ? 2 : 1)); return; }
      if (key === ']') { handled(); brush.setSize(brush.size + (brush.size >= 10 ? 2 : 1)); return; }
      const def = PAINT_TOOL_DEFS.find((d) => d.key === key && toolEnabled(d.tool, paintFeatures));
      if (def) { handled(); brush.setTool(def.tool); }
      return;
    }
    if (e.code === 'Space' && !mod) { setSpaceDown(true); handled(); return; }
    if (mod && key === 'z' && features.history) { handled(); if (e.shiftKey) history.redo(); else history.undo(); return; }
    if (mod && key === 'y' && features.history) { handled(); history.redo(); return; }
    if (mod && key === 'a') { handled(); select(live.current.elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id)); return; }
    if (mod && key === 'd') { handled(); duplicate(); return; }
    if (mod && key === 'c') { handled(); copy(); return; }
    if (mod && key === 'x') { handled(); copy(); removeSelected(); return; }
    if (mod && key === 'v') { handled(); paste(); return; }
    if (mod && key === '0' && features.zoom) { handled(); fit(); return; }
    if (mod && (e.key === ']' || e.key === '[') && features.arrange) {
      handled();
      doArrange(e.key === ']' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward'));
      return;
    }
    if (e.key === 'Escape') { if (live.current.selectedIds.length) { handled(); select([]); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { handled(); removeSelected(); return; }
    if (e.key === 'Enter' && selected.length === 1) { handled(); openElement(selected[0]); return; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[e.key];
    if (arrow && live.current.selectedIds.length) {
      handled();
      const g = live.current.grid;
      const stepX = g?.snapPosition ? width / g.columns : e.shiftKey ? 10 : 1;
      const stepY = g?.snapPosition ? height / g.rows : e.shiftKey ? 10 : 1;
      commit(nudge(live.current.elements, editableIds(), arrow[0] * stepX, arrow[1] * stepY, { width, height }));
    }
  };

  // ── Drawing ───────────────────────────────────────────────────────────

  // Moving types (a flame) redraw the layer every frame while one is on the stage.
  const animated = elements.some((el) => !el.hidden && types[el.type]?.animated?.(el));
  useEffect(() => {
    const layer = elementsLayerRef.current;
    if (!animated || !layer) return;
    const anim = new Konva.Animation(() => {}, layer);
    anim.start();
    return () => { anim.stop(); };
  }, [animated]);

  const accent = readToken(rootRef.current, '--accent', '#3fa37a');
  const handleFill = readToken(rootRef.current, '--panel-bg', '#ffffff');

  const gridShape = grid && grid.visible && grid.columns > 0 && grid.rows > 0 ? (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        const raw = ctx._context;
        raw.save();
        raw.globalAlpha = grid.opacity;
        raw.strokeStyle = grid.color;
        raw.lineWidth = 1 / view.zoom;
        raw.beginPath();
        for (let i = 1; i < grid.columns; i++) { const x = (i / grid.columns) * width; raw.moveTo(x, 0); raw.lineTo(x, height); }
        for (let i = 1; i < grid.rows; i++) { const y = (i / grid.rows) * height; raw.moveTo(0, y); raw.lineTo(width, y); }
        raw.stroke();
        raw.restore();
      }}
    />
  ) : null;

  const register = useCallback((id: string, node: Konva.Shape | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const painting = paintingId ? byId.get(paintingId) : undefined;
  const paintType = painting ? types[painting.type]?.paint : undefined;
  const paintFeatures = paint.features ?? FULL_PAINT_FEATURES;
  const commitDoc = useCallback((doc: PaintDoc) => {
    const el = live.current.elements.find((e) => e.id === paintingId);
    const type = el && live.current.types[el.type]?.paint;
    if (!el || !type) return;
    commit(patched(new Map([[el.id, { ...el, props: type.set(el, doc) }]])));
  }, [paintingId, commit, patched]);
  const paintControls = usePaintControls(painting && paintType ? paintType.get(painting) : NO_DOC, brush, commitDoc, history);
  // The paint mode ends when its element goes (removed, undone) or hides.
  useEffect(() => {
    if (paintingIdState && (!painting || painting.hidden || !editable)) setPaintingId(null);
  }, [paintingIdState, painting, editable]);
  const layerImages = useMemo(() => {
    const map = new Map<string, HTMLImageElement>();
    if (!painting || !paintType) return map;
    for (const layer of paintType.get(painting).layers) {
      if (!layer.image) continue;
      const image = cachedCanvasImage(paintType.resolveImage(layer.image));
      if (image) map.set(layer.image, image);
    }
    return map;
    // `resourceVersion`: a layer image that arrived.
  }, [painting, paintType, resourceVersion]);

  const editingText = editingTextId ? byId.get(editingTextId) : undefined;
  const editingType = editingText ? types[editingText.type]?.textEdit : undefined;
  // Outlines: while reading the selection (there are no handles), while editing what the pointer is over.
  const outlined = editable
    ? (hoveredId && !selectedIds.includes(hoveredId) && !gesture ? [byId.get(hoveredId)].filter((el): el is CanvasElement => !!el && !el.hidden) : [])
    : selected.filter((el) => !el.hidden);

  const controller: CanvasController = {
    features, types, selected, canUndo: history.canUndo, canRedo: history.canRedo,
    undo: history.undo, redo: history.redo, add, removeSelected, duplicate,
    arrange: doArrange, align: doAlign, distribute: doDistribute, update: updateSelected,
    zoom: view.zoom, zoomIn: () => zoomTo(view.zoom * 1.25), zoomOut: () => zoomTo(view.zoom / 1.25), fit,
    onExport,
  };

  return (
    <div
      ref={rootRef}
      className={`canvas-editor canvas-editor-${layout} ${editable ? 'canvas-editor-editing' : ''} ${paintingId ? 'canvas-editor-painting' : ''}`}
      tabIndex={editable ? -1 : undefined}
      onKeyDown={onKeyDown}
    >
      {editable && (
        <div className="canvas-toolbar-strip">
          {painting && paintType ? (
            <PaintToolbar
              api={paintControls}
              features={paintFeatures}
              palette={paint.palette}
              end={!paintElementId && (
                <ToolbarBtn onClick={() => setPaintingId(null)} active={false} title={t('canvas.donePainting')}>
                  <Check size={14} />
                  <span className="editor-toolbar-btn-label">{t('canvas.donePainting')}</span>
                </ToolbarBtn>
              )}
            />
          ) : (
            <CanvasToolbar controller={controller} end={toolbarEnd} />
          )}
        </div>
      )}
      <div
        ref={viewportRef}
        className="canvas-viewport"
        style={{ cursor: spaceDown ? 'grab' : undefined, aspectRatio: layout === 'inline' ? `${width} / ${height}` : undefined }}
        onContextMenu={(e) => { if (editable) e.preventDefault(); }}
        onPointerDownCapture={(e) => {
          // The middle button or Space pans, over the elements and the paint surface alike.
          if (!editable || !features.zoom || !(e.button === 1 || (e.button === 0 && spaceDown))) return;
          e.preventDefault();
          e.stopPropagation();
          rootRef.current?.focus({ preventScroll: true });
          startPan(e.nativeEvent);
        }}
      >
        <div
          className="canvas-artboard"
          style={{ left: view.x, top: view.y, width: width * view.zoom, height: height * view.zoom }}
        >
          <div className="canvas-artboard-inner" style={{ width, height, transform: `scale(${view.zoom})` }}>
            {background}
          </div>
        </div>
        {size.width > 0 && size.height > 0 && (
          <Stage
            className="canvas-stage"
            width={size.width}
            height={size.height}
            onPointerDown={onStagePointerDown}
            onDblClick={(e) => {
              const hit = elementAt(e.target);
              if (editable && hit) openElement(hit);
            }}
          >
            <Layer ref={elementsLayerRef}>
              <Group x={view.x} y={view.y} scaleX={view.zoom} scaleY={view.zoom} clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
                {gridShape}
                {sorted.map((el) => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    types={types}
                    editable={editable}
                    editing={el.id === editingTextId || el.id === paintingId}
                    resourceVersion={resourceVersion}
                    register={register}
                    onHover={setHoveredId}
                  />
                ))}
              </Group>
            </Layer>
            <Layer listening={false}>
              <Group x={view.x} y={view.y} scaleX={view.zoom} scaleY={view.zoom}>
                {outlined.map((el) => (
                  <Rect
                    key={el.id}
                    x={el.x} y={el.y} width={el.width} height={el.height} offsetX={el.width / 2} offsetY={el.height / 2}
                    rotation={el.rotation} stroke={accent} strokeWidth={1.5 / view.zoom} cornerRadius={4 / view.zoom}
                    opacity={editable ? 0.6 : 0.9}
                  />
                ))}
              </Group>
            </Layer>
            {editable && (
              <Layer>
                {/* Where a selection reaches past the artboard, a quiet outline shows its edge. */}
                <Rect
                  x={view.x} y={view.y} width={width * view.zoom} height={height * view.zoom}
                  stroke={accent} strokeWidth={1} opacity={0.25} listening={false}
                />
                <Group x={view.x} y={view.y} scaleX={view.zoom} scaleY={view.zoom} listening={false}>
                  {guides.map((g, i) => (
                    <Line
                      key={i}
                      points={g.orientation === 'vertical' ? [g.at, -height, g.at, height * 2] : [-width, g.at, width * 2, g.at]}
                      stroke={GUIDE_COLOR}
                      strokeWidth={1 / view.zoom}
                      dash={[4 / view.zoom, 4 / view.zoom]}
                    />
                  ))}
                  {marquee && (
                    <Rect
                      x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height}
                      fill={accent} opacity={0.12} stroke={accent} strokeWidth={1 / view.zoom}
                    />
                  )}
                </Group>
                <Transformer
                  ref={transformerRef}
                  keepRatio={keepRatio}
                  enabledAnchors={anchors}
                  rotationSnaps={rotationSnaps}
                  rotationSnapTolerance={rotationSnap ? rotationSnap / 2 : 4}
                  flipEnabled={false}
                  ignoreStroke
                  borderStroke={accent}
                  borderStrokeWidth={1.5}
                  anchorStroke={accent}
                  anchorFill={handleFill}
                  anchorSize={9}
                  anchorCornerRadius={2}
                  rotateAnchorOffset={22}
                  padding={1}
                  onTransformStart={() => setGesture(true)}
                  onTransform={onTransform}
                  onTransformEnd={() => { setGesture(false); commitTransform(); }}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 4 || newBox.height < 4) return oldBox;
                    const g = live.current.grid;
                    const tr = transformerRef.current;
                    const anchor = tr?.getActiveAnchor() ?? '';
                    if (!g?.snapSize || Math.abs(newBox.rotation) > 0.001 || !anchor || anchor === 'rotater') return newBox;
                    // Sizes on whole cells, the opposite edge staying where it is.
                    const zoom = live.current.view.zoom;
                    const cellW = (width / g.columns) * zoom;
                    const cellH = (height / g.rows) * zoom;
                    const w = Math.max(cellW, snapToStep(newBox.width, cellW));
                    const h = Math.max(cellH, snapToStep(newBox.height, cellH));
                    return {
                      ...newBox,
                      x: anchor.includes('left') ? newBox.x + newBox.width - w : newBox.x,
                      y: anchor.includes('top') ? newBox.y + newBox.height - h : newBox.y,
                      width: w,
                      height: h,
                    };
                  }}
                />
              </Layer>
            )}
          </Stage>
        )}
        {editingText && editingType && (
          <TextEditOverlay
            key={editingText.id}
            element={editingText}
            initial={editingType.get(editingText)}
            style={editingType.style(editingText)}
            view={view}
            onDone={(text) => finishTextEdit(editingText.id, text)}
          />
        )}
        {editable && painting && paintType && (
          <PaintSurface
            box={{
              left: view.x + (painting.x - painting.width / 2) * view.zoom,
              top: view.y + (painting.y - painting.height / 2) * view.zoom,
              width: painting.width * view.zoom,
              height: painting.height * view.zoom,
              rotation: painting.rotation,
            }}
            api={paintControls}
            images={layerImages}
            editable={layerImages.size >= paintControls.doc.layers.filter((l) => l.image).length}
          />
        )}
        {editable && features.zoom && <CanvasZoom controller={controller} />}
        {overlay}
      </div>
    </div>
  );
});

export default CanvasEditor;

/** Guides in a colour of their own, apart from the selection. */
const GUIDE_COLOR = '#e8559b';

/** What the toolbar reads and calls. */
export interface CanvasController {
  features: CanvasFeatures;
  types: CanvasTypes;
  selected: CanvasElement[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  add: (type: string, addition: CanvasAddition) => void;
  removeSelected: () => void;
  duplicate: () => void;
  arrange: (move: ArrangeMove) => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: 'horizontal' | 'vertical') => void;
  /** Changes every selected, unlocked element of `type`; `null` from the callback leaves one alone. */
  update: (type: string, patch: (el: CanvasElement) => Partial<CanvasElement> | null) => void;
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  onExport?: () => void;
}

const ElementNode = memo(function ElementNode({ el, types, editable, editing, resourceVersion, register, onHover }: {
  el: CanvasElement;
  types: CanvasTypes;
  editable: boolean;
  editing: boolean;
  /** Changes when a picture or font arrives: the node draws again. */
  resourceVersion: number;
  register: (id: string, node: Konva.Shape | null) => void;
  onHover: (id: string | null) => void;
}) {
  void resourceVersion;
  const ref = useCallback((node: Konva.Shape | null) => register(el.id, node), [register, el.id]);
  const animated = !!types[el.type]?.animated?.(el);
  return (
    <Shape
      ref={ref}
      id={el.id}
      name="canvas-element"
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      offsetX={el.width / 2}
      offsetY={el.height / 2}
      rotation={el.rotation}
      opacity={el.opacity}
      visible={!el.hidden && !editing}
      listening={!el.locked && !el.hidden}
      perfectDrawEnabled={false}
      // Only for the hit area: Konva fills it with the node's own colour key,
      // and a node without a fill has none. The scene draws itself below.
      fill="#000000"
      sceneFunc={(ctx, shape) => {
        const raw = ctx._context;
        raw.globalAlpha = shape.getAbsoluteOpacity();
        // The node's size, not the element's: while a handle is dragged they differ.
        drawElement(raw, { ...el, width: shape.width(), height: shape.height() }, types, {
          image: cachedCanvasImage,
          time: animated ? performance.now() : null,
        });
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(0, 0, shape.width(), shape.height());
        ctx.closePath();
        ctx.fillStrokeShape(shape);
      }}
      onMouseEnter={(e) => {
        e.target.getStage()!.container().style.cursor = editable ? 'move' : 'pointer';
        if (editable) onHover(el.id);
      }}
      onMouseLeave={(e) => {
        e.target.getStage()!.container().style.cursor = '';
        onHover(null);
      }}
    />
  );
});
