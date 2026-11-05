import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import Konva from 'konva';
import { Group, Layer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import { drawElement, textHeight, fontString } from './draw';
import { cachedBuilderImage, useBuilderImages } from './imageCache';
import { boxFromPoints, boxesIntersect, elementBounds, unionBounds, type Box } from './geometry';
import { snapToGuides, snapToStep, type Guide } from './snapping';
import { useBuilderHistory } from './useBuilderHistory';
import { FULL_BUILDER_FEATURES, type BuilderFeatures } from './features';
import {
  align, arrange, clamp, copiesOf, distribute, nudge, type AlignEdge, type ArrangeMove,
} from './builderActions';
import {
  byZ, type BuilderElement, type BuilderGrid, type BuilderShapeElement, type BuilderShapeType, type BuilderTextElement,
} from './types';
import BuilderToolbar from './BuilderToolbar';
import TextEditOverlay from './TextEditOverlay';

/** Past this much travel, a press on an element becomes a move. */
const DRAG_THRESHOLD_PX = 3;
/** How close, on screen, an edge has to come to a guide to snap. */
const GUIDE_SNAP_PX = 6;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** Space around the artboard while editing. */
const EDIT_PADDING = 32;
const PASTE_OFFSET = 24;

/** What the builder keeps between two pastes (one per window, shared by every builder). */
let clipboard: BuilderElement[] = [];

export interface BuilderEditorHandle {
  /** A point of the window in artboard pixels, or `null` when it is outside the stage. */
  clientToArtboard: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** The middle of what is visible of the artboard, for placing new elements. */
  visibleCentre: () => { x: number; y: number };
}

export interface BuilderEditorProps {
  /** The artboard, in its own pixels. */
  width: number;
  height: number;
  elements: BuilderElement[];
  /** Every change made in the builder, as the whole new list. */
  onChange: (elements: BuilderElement[]) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  editable: boolean;
  features?: BuilderFeatures;
  /** Painted behind the artboard, filling it (DOM: an image, a gradient). */
  background?: ReactNode;
  grid?: BuilderGrid | null;
  /** Rotation snaps to multiples of this, in degrees; `null`: only Shift snaps (15°). */
  rotationSnap?: number | null;
  /** When it changes, undo starts over (another document, or editing begins). */
  historyKey?: string;
  /** Where the artboard sits while reading: in the middle, or at the top. */
  readAlign?: 'center' | 'top';
  /** New ids for added and copied elements. */
  createId?: () => string;
  /** Saving as an image, offered in the toolbar when given and `features.export` is on. */
  onExport?: () => void;
  /** Drawn over the viewport, e.g. a hint while something is dragged in. */
  overlay?: ReactNode;
  /** Extra controls at the end of the toolbar. */
  toolbarEnd?: ReactNode;
}

interface View {
  zoom: number;
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; ids: string[]; grabbed: string; starts: Map<string, { x: number; y: number }>; moved: boolean; others: Box[]; union: Box }
  | { kind: 'marquee'; pointerId: number; startX: number; startY: number; base: string[] }
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; view: View };

function readToken(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * The builder: elements on an artboard (images, shapes, text), selected with
 * handles to move, scale and rotate them, several at once, with guides and a
 * grid, zoom and pan, undo, keys and a toolbar from `features`. The elements
 * belong to the embedding place (`elements`/`onChange`); the builder keeps
 * only the view and what a gesture moves before it is committed.
 * See Documentation/architecture/editors.md.
 */
const BuilderEditor = forwardRef<BuilderEditorHandle, BuilderEditorProps>(function BuilderEditor({
  width, height, elements, onChange, selectedIds, onSelectionChange, editable,
  features = FULL_BUILDER_FEATURES, background, grid = null, rotationSnap = null, historyKey = '',
  readAlign = 'center', createId = () => crypto.randomUUID(), onExport, overlay, toolbarEnd,
}, ref) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
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
  const [spaceDown, setSpaceDown] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);

  // The latest props for the handlers below, which outlive a render.
  const live = useRef({ elements, selectedIds, view, onChange, onSelectionChange, grid, editable });
  live.current = { elements, selectedIds, view, onChange, onSelectionChange, grid, editable };

  const history = useBuilderHistory(elements, onChange, `${historyKey}:${editable}`);
  const commit = useCallback((next: BuilderElement[]) => {
    history.markLocal();
    live.current.onChange(next);
  }, [history]);

  const imageVersion = useBuilderImages(elements.map((el) => (el.kind === 'image' ? el.src : null)));
  const sorted = useMemo(() => byZ(elements), [elements]);
  const byId = useMemo(() => new Map(elements.map((el) => [el.id, el])), [elements]);
  const selected = useMemo(() => selectedIds.map((id) => byId.get(id)).filter((el): el is BuilderElement => !!el), [selectedIds, byId]);

  // ── View ──────────────────────────────────────────────────────────────

  const fitView = useCallback((viewport: { width: number; height: number }, isEditing: boolean): View => {
    const pad = isEditing ? EDIT_PADDING : 0;
    const zoom = clamp(Math.min((viewport.width - 2 * pad) / width, (viewport.height - 2 * pad) / height), MIN_ZOOM, MAX_ZOOM);
    const x = (viewport.width - width * zoom) / 2;
    const y = !isEditing && readAlign === 'top' ? 0 : (viewport.height - height * zoom) / 2;
    return { zoom: zoom > 0 ? zoom : 1, x, y };
  }, [width, height, readAlign]);

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
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
        zoomTo(live.current.view.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        fittedRef.current = false;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editable, features.zoom, zoomTo]);

  // ── Selection and transformer ─────────────────────────────────────────

  const select = useCallback((ids: string[]) => {
    const current = live.current.selectedIds;
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
    live.current.onSelectionChange(ids);
  }, []);

  // Selected elements that disappeared (deleted, hidden, locked) leave the selection.
  useEffect(() => {
    const valid = selectedIds.filter((id) => {
      const el = byId.get(id);
      return el && !el.hidden;
    });
    if (valid.length !== selectedIds.length) select(valid);
  }, [selectedIds, byId, select]);

  const handleable = useMemo(
    () => (editable ? selected.filter((el) => !el.locked && !el.hidden && el.id !== editingTextId) : []),
    [editable, selected, editingTextId],
  );

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    tr.nodes(handleable.map((el) => nodes.current.get(el.id)).filter((n): n is Konva.Shape => !!n));
    tr.getLayer()?.batchDraw();
  }, [handleable, elements, view]);

  const singleText = handleable.length === 1 && handleable[0].kind === 'text';
  const keepRatio = handleable.some((el) => el.kind !== 'shape');
  const anchors = singleText
    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
    : keepRatio
      ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
      : undefined;
  const rotationSnaps = rotationSnap && rotationSnap > 0
    ? Array.from({ length: Math.floor(360 / rotationSnap) }, (_, i) => i * rotationSnap)
    : [0, 90, 180, 270];

  // ── Committing gestures ───────────────────────────────────────────────

  /** The elements with the given ones replaced. */
  const patched = useCallback((changes: Map<string, Partial<BuilderElement>>) =>
    live.current.elements.map((el) => {
      const patch = changes.get(el.id);
      return patch ? ({ ...el, ...patch } as BuilderElement) : el;
    }), []);

  const commitTransform = useCallback(() => {
    const changes = new Map<string, Partial<BuilderElement>>();
    for (const el of live.current.elements) {
      const node = nodes.current.get(el.id);
      if (!node || !transformerRef.current?.nodes().includes(node)) continue;
      const sx = Math.abs(node.scaleX());
      const sy = Math.abs(node.scaleY());
      const rotation = ((node.rotation() % 360) + 360) % 360;
      const patch: Partial<BuilderElement> = {
        x: node.x(), y: node.y(), rotation: Math.round(rotation * 10) / 10,
        width: Math.max(1, node.width() * sx), height: Math.max(1, node.height() * sy),
      };
      if (el.kind === 'text') {
        const fontSize = Math.max(4, Math.round(el.fontSize * sy * 10) / 10);
        const next = { ...el, ...patch, fontSize } as BuilderTextElement;
        const h = textHeight(next);
        Object.assign(patch, { fontSize, height: h, ...keepTop(next, (patch.height as number), h) });
      }
      node.scale({ x: 1, y: 1 });
      changes.set(el.id, patch);
    }
    if (changes.size) commit(patched(changes));
  }, [commit, patched]);

  /** Text resized by its side handles wraps anew instead of stretching. */
  const onTransform = useCallback(() => {
    const tr = transformerRef.current;
    if (!tr || tr.nodes().length !== 1) return;
    const node = tr.nodes()[0] as Konva.Shape;
    const el = live.current.elements.find((e) => e.id === node.id());
    const anchor = tr.getActiveAnchor() ?? '';
    if (el?.kind !== 'text' || !anchor.startsWith('middle')) return;
    const w = Math.max(el.fontSize, node.width() * node.scaleX());
    const before = node.height();
    const h = textHeight({ ...el, width: w });
    node.setAttrs({ width: w, scaleX: 1, offsetX: w / 2, height: h, offsetY: h / 2 });
    const shift = keepTop({ ...el, x: node.x(), y: node.y(), rotation: node.rotation() }, before, h);
    node.position(shift);
  }, []);

  // ── Pointer gestures ──────────────────────────────────────────────────

  const elementAt = (target: Konva.Node): BuilderElement | null => {
    let node: Konva.Node | null = target;
    while (node && !node.hasName('builder-element')) node = node.getParent();
    if (!node) return null;
    return live.current.elements.find((el) => el.id === node!.id()) ?? null;
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
    if (evt.button === 1 || (evt.button === 0 && spaceDown && features.zoom)) {
      evt.preventDefault();
      gestureRef.current = { kind: 'pan', pointerId: evt.pointerId, startX: evt.clientX, startY: evt.clientY, view: live.current.view };
      return;
    }
    if (evt.button !== 0) return;
    // The transformer's own handles.
    if (e.target.getParent() instanceof Konva.Transformer) return;
    const additive = evt.shiftKey || evt.metaKey || evt.ctrlKey;
    const hit = elementAt(e.target);
    const current = live.current.selectedIds;
    if (hit && !hit.locked) {
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
      const moving = live.current.elements.filter((el) => ids.includes(el.id) && !el.locked && !el.hidden);
      gestureRef.current = {
        kind: 'move', pointerId: evt.pointerId, startX: evt.clientX, startY: evt.clientY,
        ids: moving.map((el) => el.id), grabbed: hit.id,
        starts: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])),
        moved: false,
        others: live.current.elements.filter((el) => !ids.includes(el.id) && !el.hidden).map(elementBounds),
        union: unionBounds(moving.map(elementBounds)) ?? { x: hit.x, y: hit.y, width: 0, height: 0 },
      };
      return;
    }
    setEditingTextId(null);
    gestureRef.current = { kind: 'marquee', pointerId: evt.pointerId, startX: evt.clientX, startY: evt.clientY, base: additive ? current : [] };
  };

  useEffect(() => {
    const onMove = (evt: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || evt.pointerId !== g.pointerId) return;
      const v = live.current.view;
      if (g.kind === 'pan') {
        fittedRef.current = false;
        setView({ ...g.view, x: g.view.x + evt.clientX - g.startX, y: g.view.y + evt.clientY - g.startY });
        return;
      }
      if (g.kind === 'marquee') {
        if (Math.hypot(evt.clientX - g.startX, evt.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
        const a = toArtboard(g.startX, g.startY);
        const b = toArtboard(evt.clientX, evt.clientY);
        setMarquee(boxFromPoints(a.x, a.y, b.x, b.y));
        return;
      }
      if (!g.moved && Math.hypot(evt.clientX - g.startX, evt.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      let dx = (evt.clientX - g.startX) / v.zoom;
      let dy = (evt.clientY - g.startY) / v.zoom;
      const moved = { ...g.union, x: g.union.x + dx, y: g.union.y + dy };
      let lines: Guide[] = [];
      const gridNow = live.current.grid;
      if (!evt.altKey && gridNow?.snapPosition) {
        const start = g.starts.get(g.grabbed)!;
        const cx = start.x + dx;
        const cy = start.y + dy;
        dx += snapToStep(cx, width / gridNow.columns) - cx;
        dy += snapToStep(cy, height / gridNow.rows) - cy;
      } else if (!evt.altKey && features.guides) {
        const snap = snapToGuides(moved, g.others, { width, height }, GUIDE_SNAP_PX / v.zoom);
        dx += snap.dx;
        dy += snap.dy;
        lines = snap.guides;
      }
      // Every centre stays on the artboard.
      for (const start of g.starts.values()) {
        dx = clamp(dx, -start.x, width - start.x);
        dy = clamp(dy, -start.y, height - start.y);
      }
      for (const [id, start] of g.starts) nodes.current.get(id)?.position({ x: start.x + dx, y: start.y + dy });
      transformerRef.current?.forceUpdate();
      elementsLayerRef.current?.batchDraw();
      transformerRef.current?.getLayer()?.batchDraw();
      setGuides(lines);
    };

    const onUp = (evt: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || evt.pointerId !== g.pointerId) return;
      gestureRef.current = null;
      if (g.kind === 'marquee') {
        setMarquee(null);
        if (Math.hypot(evt.clientX - g.startX, evt.clientY - g.startY) < DRAG_THRESHOLD_PX) {
          select(g.base);
          return;
        }
        const a = toArtboard(g.startX, g.startY);
        const b = toArtboard(evt.clientX, evt.clientY);
        const box = boxFromPoints(a.x, a.y, b.x, b.y);
        const hits = live.current.elements
          .filter((el) => !el.locked && !el.hidden && boxesIntersect(elementBounds(el), box))
          .map((el) => el.id);
        select([...new Set([...g.base, ...hits])]);
        return;
      }
      if (g.kind !== 'move' || !g.moved) return;
      setGuides([]);
      const changes = new Map<string, Partial<BuilderElement>>();
      for (const id of g.ids) {
        const node = nodes.current.get(id);
        if (node) changes.set(id, { x: node.x(), y: node.y() });
      }
      commit(patched(changes));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [toArtboard, select, commit, patched, width, height, features.guides]);

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

  const addCopies = useCallback((source: BuilderElement[], offset: number) => {
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
    addCopies(clipboard, PASTE_OFFSET);
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

  const updateSelected = useCallback((patch: (el: BuilderElement) => Partial<BuilderElement> | null) => {
    const ids = editableIds();
    const changes = new Map<string, Partial<BuilderElement>>();
    for (const el of live.current.elements) {
      if (!ids.includes(el.id)) continue;
      const p = patch(el);
      if (!p) continue;
      // Text keeps its height matched to its lines.
      if (el.kind === 'text') {
        const next = { ...el, ...p } as BuilderTextElement;
        const h = textHeight(next);
        Object.assign(p, { height: h, ...keepTop(next, el.height, h) });
      }
      changes.set(el.id, p);
    }
    if (changes.size) commit(patched(changes));
  }, [commit, editableIds, patched]);

  const topZ = () => live.current.elements.reduce((max, el) => Math.max(max, el.z), -1) + 1;

  const addShape = useCallback((shape: BuilderShapeType) => {
    const centre = visibleCentre();
    const side = Math.round(Math.min(width, height) * 0.22);
    const el: BuilderShapeElement = {
      id: createId(), kind: 'shape', shape, x: centre.x, y: centre.y,
      width: shape === 'rect' ? Math.round(side * 1.4) : side, height: side,
      rotation: 0, opacity: 1, locked: false, hidden: false, z: topZ(),
      fill: DEFAULT_FILL, stroke: null, strokeWidth: Math.max(2, Math.round(side / 40)), cornerRadius: 0,
    };
    commit([...live.current.elements, el]);
    select([el.id]);
  }, [visibleCentre, width, height, createId, commit, select]);

  const addText = useCallback(() => {
    const centre = visibleCentre();
    const fontSize = Math.max(12, Math.round(height / 14));
    const base = {
      id: createId(), kind: 'text' as const, text: t('builder.newText'), font: 'serif' as const, fontSize,
      color: DEFAULT_TEXT_COLOR, align: 'center' as const, bold: false, italic: false,
      x: centre.x, y: centre.y, width: Math.round(width * 0.4), height: 0,
      rotation: 0, opacity: 1, locked: false, hidden: false, z: topZ(),
    };
    const el: BuilderTextElement = { ...base, height: textHeight(base) };
    commit([...live.current.elements, el]);
    select([el.id]);
    setEditingTextId(el.id);
  }, [visibleCentre, height, width, createId, t, commit, select]);

  const finishTextEdit = useCallback((id: string, text: string | null) => {
    setEditingTextId(null);
    const el = live.current.elements.find((e) => e.id === id);
    if (!el || el.kind !== 'text' || text === null) return;
    if (!text.trim()) {
      commit(live.current.elements.filter((e) => e.id !== id));
      select([]);
      return;
    }
    if (text === el.text) return;
    const next = { ...el, text };
    const h = textHeight(next);
    commit(patched(new Map([[id, { text, height: h, ...keepTop(next, el.height, h) }]])));
  }, [commit, patched, select]);

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
    if (e.key === 'Enter' && selected.length === 1 && selected[0].kind === 'text' && !selected[0].locked) {
      handled();
      setEditingTextId(selected[0].id);
      return;
    }
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

  // Flames flicker: the layer redraws every frame while one is on the stage.
  const hasFlame = elements.some((el) => el.kind === 'image' && el.flame && !el.hidden);
  useEffect(() => {
    const layer = elementsLayerRef.current;
    if (!hasFlame || !layer) return;
    const anim = new Konva.Animation(() => {}, layer);
    anim.start();
    return () => { anim.stop(); };
  }, [hasFlame]);

  // Text is drawn once its font has arrived.
  const fontKey = [...new Set(elements.filter((el) => el.kind === 'text').map((el) => fontString({ ...(el as BuilderTextElement), fontSize: 16 })))].join('|');
  useEffect(() => {
    if (!fontKey || !document.fonts) return;
    let alive = true;
    void Promise.all(fontKey.split('|').map((f) => document.fonts.load(f).catch(() => []))).then(() => {
      if (alive) elementsLayerRef.current?.batchDraw();
    });
    return () => { alive = false; };
  }, [fontKey]);

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

  const editingText = editingTextId ? byId.get(editingTextId) : undefined;
  // Outlines: while reading the selection (there are no handles), while editing what the pointer is over.
  const outlined = editable
    ? (hoveredId && !selectedIds.includes(hoveredId) && !gestureRef.current ? [byId.get(hoveredId)].filter((el): el is BuilderElement => !!el && !el.hidden) : [])
    : selected.filter((el) => !el.hidden);

  const controller: BuilderController = {
    features, selected, canUndo: history.canUndo, canRedo: history.canRedo,
    undo: history.undo, redo: history.redo, addShape, addText, removeSelected, duplicate,
    arrange: doArrange, align: doAlign, distribute: doDistribute, update: updateSelected,
    zoom: view.zoom, zoomIn: () => zoomTo(view.zoom * 1.25), zoomOut: () => zoomTo(view.zoom / 1.25), fit,
    onExport,
  };

  return (
    <div
      ref={rootRef}
      className={`builder-editor ${editable ? 'builder-editor-editing' : ''}`}
      tabIndex={editable ? -1 : undefined}
      onKeyDown={onKeyDown}
    >
      {editable && (
        <div className="builder-toolbar-strip">
          <BuilderToolbar controller={controller} end={toolbarEnd} />
        </div>
      )}
      <div
        ref={viewportRef}
        className="builder-viewport"
        style={{ cursor: spaceDown ? 'grab' : undefined }}
        onContextMenu={(e) => { if (editable) e.preventDefault(); }}
      >
        <div
          className="builder-artboard"
          style={{ left: view.x, top: view.y, width: width * view.zoom, height: height * view.zoom }}
        >
          <div className="builder-artboard-inner" style={{ width, height, transform: `scale(${view.zoom})` }}>
            {background}
          </div>
        </div>
        {size.width > 0 && size.height > 0 && (
          <Stage
            ref={stageRef}
            className="builder-stage"
            width={size.width}
            height={size.height}
            onPointerDown={onStagePointerDown}
            onDblClick={(e) => {
              const hit = elementAt(e.target);
              if (editable && hit?.kind === 'text' && !hit.locked) setEditingTextId(hit.id);
            }}
          >
            <Layer ref={elementsLayerRef}>
              <Group x={view.x} y={view.y} scaleX={view.zoom} scaleY={view.zoom} clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
                {gridShape}
                {sorted.map((el) => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    editable={editable}
                    editing={el.id === editingTextId}
                    imageVersion={imageVersion}
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
                  onTransform={onTransform}
                  onTransformEnd={commitTransform}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 4 || newBox.height < 4) return oldBox;
                    const g = live.current.grid;
                    const tr = transformerRef.current;
                    if (!g?.snapSize || !tr || Math.abs(newBox.rotation) > 0.001 || !tr.getActiveAnchor() || tr.getActiveAnchor() === 'rotater') return newBox;
                    // Sizes on whole cells, the opposite edge staying where it is.
                    const zoom = live.current.view.zoom;
                    const cellW = (width / g.columns) * zoom;
                    const cellH = (height / g.rows) * zoom;
                    const anchor = tr.getActiveAnchor() ?? '';
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
        {editingText?.kind === 'text' && (
          <TextEditOverlay
            key={editingText.id}
            element={editingText}
            view={view}
            onDone={(text) => finishTextEdit(editingText.id, text)}
          />
        )}
        {overlay}
      </div>
    </div>
  );
});

export default BuilderEditor;

export const DEFAULT_FILL = '#d4af37';
export const DEFAULT_TEXT_COLOR = '#f4ecd8';
/** Guides in a colour of their own, apart from the selection. */
const GUIDE_COLOR = '#e8559b';

/**
 * Where a text box's centre goes when its height changes from `before` to
 * `after`, keeping its top edge in place (along its own rotation).
 */
function keepTop(el: Pick<BuilderElement, 'x' | 'y' | 'rotation'>, before: number, after: number): { x: number; y: number } {
  const shift = (after - before) / 2;
  const rad = (el.rotation * Math.PI) / 180;
  return { x: el.x - Math.sin(rad) * shift, y: el.y + Math.cos(rad) * shift };
}

/** What the toolbar reads and calls. */
export interface BuilderController {
  features: BuilderFeatures;
  selected: BuilderElement[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  addShape: (shape: BuilderShapeType) => void;
  addText: () => void;
  removeSelected: () => void;
  duplicate: () => void;
  arrange: (move: ArrangeMove) => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: 'horizontal' | 'vertical') => void;
  /** Changes every selected, unlocked element; `null` from the callback leaves one alone. */
  update: (patch: (el: BuilderElement) => Partial<BuilderElement> | null) => void;
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  onExport?: () => void;
}

const ElementNode = memo(function ElementNode({ el, editable, editing, imageVersion, register, onHover }: {
  el: BuilderElement;
  editable: boolean;
  editing: boolean;
  imageVersion: number;
  register: (id: string, node: Konva.Shape | null) => void;
  onHover: (id: string | null) => void;
}) {
  void imageVersion;
  const ref = useCallback((node: Konva.Shape | null) => register(el.id, node), [register, el.id]);
  return (
    <Shape
      ref={ref}
      id={el.id}
      name="builder-element"
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
        const live = { ...el, width: shape.width(), height: shape.height() } as BuilderElement;
        drawElement(raw, live, {
          image: el.kind === 'image' ? cachedBuilderImage(el.src) : null,
          time: el.kind === 'image' && el.flame ? performance.now() : null,
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
