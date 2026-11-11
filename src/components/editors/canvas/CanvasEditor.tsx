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
import { useCanvasHistory, type CanvasScene } from './useCanvasHistory';
import { FULL_CANVAS_FEATURES, type CanvasFeatures } from './features';
import { BUILTIN_CANVAS_TYPES } from './elements';
import {
  align, arrange, clamp, copiesOf, distribute, group, moveInStack, nudge, ungroup, withGroups,
  type AlignEdge, type ArrangeMove,
} from './canvasActions';
import { byZ, type CanvasAddition, type CanvasElement, type CanvasGrid, type CanvasTypes } from './types';
import CanvasToolbar, { CanvasToolRail, CanvasZoom } from './CanvasToolbar';
import TextEditOverlay from './TextEditOverlay';
import ElementList from './ElementList';
import Rulers, { RULER_SIZE, rulerLayout, type RulerGuide } from './Rulers';
import PaintSurface from './paint/PaintSurface';
import PaintToolbar, { PAINT_TOOL_DEFS, PaintToolRail, toolEnabled } from './paint/PaintToolbar';
import LayerPanel from './paint/LayerPanel';
import { isSelectTool, usePaintBrush, usePaintControls } from './paint/usePaintTools';
import { FULL_PAINT_FEATURES, type PaintFeatures } from './paint/features';
import { emptyPaintDoc, type PaintDoc } from '../../../lib/paint/document';
import { ToolbarBtn } from '../shared/toolbarParts';
import { Check, Keyboard } from 'lucide-react';
import ShortcutOverview from './ShortcutOverview';
import ExportDialog, { type CanvasExportOptions } from './ExportDialog';
import { EMPTY_BACKGROUND, backgroundCss, hasBackground, type CanvasBackground } from './background';
import type { CanvasBackgroundImages } from './BackgroundPanel';
import { SymbolLibraryContext, type CanvasSymbolLibrary } from './symbols/library';
import ContextMenu from '../../ui/ContextMenu';
import { canvasMenuActions } from './CanvasContextMenu';

/** How close, on screen, an edge has to come to a guide to snap. */
const GUIDE_SNAP_PX = 6;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** Space around the artboard while editing. */
const EDIT_PADDING = 32;
/** More on the left while editing, where the tool column lies. */
const RAIL_PADDING = 48;
const PASTE_OFFSET = 24;
/** The id of the element shown while one is drawn, never committed. */
const DRAFT_ID = '__draft';
const ignoreNode = () => {};
const ignoreHover = () => {};

/** What the canvas editor keeps between two pastes (one per window, shared by every canvas editor). */
let clipboard: CanvasElement[] = [];
/** The guides pulled out of the rulers, per document (`historyKey`), for as long as the window is open. */
const guideMemory = new Map<string, RulerGuide[]>();
/** Rulers shown or not, the same for every canvas editor in the window. */
let rulersShown = false;

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
  /** Painted behind the artboard, filling it (DOM: an image, a gradient); `canvasBackground`, if set, takes its place. */
  background?: ReactNode;
  /**
   * The artboard's own background (fill, picture, tint), drawn behind the
   * elements and saved with the exports. With `onCanvasBackgroundChange` the
   * bar offers to change it.
   */
  canvasBackground?: CanvasBackground | null;
  onCanvasBackgroundChange?: (background: CanvasBackground) => void;
  /** The background picture's reference as a URL to show, and choosing a new one (its reference, or `null` if cancelled). */
  backgroundImages?: CanvasBackgroundImages;
  /** The place's own symbols: a pack of them in the library, and a drawing saved as one. */
  symbolLibrary?: CanvasSymbolLibrary;
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
  /**
   * Saving as a picture, offered in the toolbar when given and
   * `features.export` is on: the editor asks format, area, size and
   * background (`ExportDialog`), the place renders and saves.
   */
  onExport?: (options: CanvasExportOptions) => void;
  /** Drawn over the viewport, e.g. a hint while something is dragged in. */
  overlay?: ReactNode;
  /** Extra controls at the end of the toolbar. */
  toolbarEnd?: ReactNode;
  /**
   * The guides pulled out of the rulers, in artboard pixels, when the place
   * keeps them (with `onGuidesChange`); otherwise the editor keeps them while
   * the window is open.
   */
  guides?: RulerGuide[];
  /** Every finished change of the guides, as the whole new list. */
  onGuidesChange?: (guides: RulerGuide[]) => void;
  /** The guides cannot be moved or removed; with `onGuidesLockedChange` the bar can switch it. */
  guidesLocked?: boolean;
  onGuidesLockedChange?: (locked: boolean) => void;
  /** The place's name for an element in the element list (an item's name); otherwise the type says. */
  elementLabel?: (element: CanvasElement) => string | null | undefined;
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
  types = BUILTIN_CANVAS_TYPES, features = FULL_CANVAS_FEATURES, background, canvasBackground = null, onCanvasBackgroundChange,
  backgroundImages, symbolLibrary, grid = null, rotationSnap = null,
  historyKey = '', readAlign = 'center', createId = () => crypto.randomUUID(), onEditElement, onExport, overlay, toolbarEnd,
  elementLabel, guides: placeGuides, onGuidesChange, guidesLocked: placeLocked, onGuidesLockedChange, paint = DEFAULT_PAINT, paintElementId, layout = 'fill',
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
  /** The element being drawn with a tool of the column, shown as it will be while the pointer is down. */
  const [draft, setDraft] = useState<CanvasElement | null>(null);
  /** The overview of the keys, open or not. */
  const [keysOpen, setKeysOpen] = useState(false);
  /** The export dialog, open or not. */
  const [exportOpen, setExportOpen] = useState(false);
  /** The right-click menu: where it opened, on screen and on the artboard, and a locked element it was opened on. */
  const [menu, setMenu] = useState<{ x: number; y: number; at: { x: number; y: number }; locked: CanvasElement | null } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [paintingIdState, setPaintingId] = useState<string | null>(null);
  /** The layer panel of the paint mode, open or not; it stays so between drawings. */
  const [layersOpen, setLayersOpen] = useState(false);
  /** The element list beside the stage, open or not. */
  const [listOpen, setListOpen] = useState(false);
  const paintingId = paintElementId ?? paintingIdState;
  const [spaceDown, setSpaceDown] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [gesture, setGesture] = useState(false);
  /** The tool picked in the tool column: an addition to draw on the stage, or `null` for selecting. */
  const [addTool, setAddTool] = useState<{ type: string; key: string } | null>(null);
  const hasRail = !paintElementId && Object.values(types).some((type) => type.additions?.length);
  const [rulers, setRulers] = useState(rulersShown);
  // The guides as shown; while one is dragged they run ahead of the place's, which hears of the result.
  const [rulerGuides, setRulerGuides] = useState<RulerGuide[]>(() => placeGuides ?? guideMemory.get(historyKey) ?? []);
  useEffect(() => { if (!onGuidesChange) setRulerGuides(guideMemory.get(historyKey) ?? []); }, [historyKey, onGuidesChange]);
  useEffect(() => { if (onGuidesChange && placeGuides) setRulerGuides(placeGuides); }, [placeGuides, onGuidesChange]);
  const finishGuides = useCallback((next: RulerGuide[]) => {
    if (onGuidesChange) onGuidesChange(next);
    else guideMemory.set(historyKey, next);
  }, [onGuidesChange, historyKey]);
  const guidesRef = useRef(rulerGuides);
  guidesRef.current = rulerGuides;
  const [localLocked, setLocalLocked] = useState(false);
  const guidesLocked = onGuidesLockedChange ? !!placeLocked : localLocked;
  const toggleGuidesLocked = () => (onGuidesLockedChange ? onGuidesLockedChange(!guidesLocked) : setLocalLocked((v) => !v));
  const showRulers = rulers && editable && features.guides && !paintingId;

  // The latest props for the handlers below, which outlive a render.
  const live = useRef({
    elements, selectedIds, view, onChange, onSelectionChange, grid, types, guides: [] as RulerGuide[],
    background: canvasBackground, onBackgroundChange: onCanvasBackgroundChange,
  });
  live.current = {
    elements, selectedIds, view, onChange, onSelectionChange, grid, types, guides: showRulers ? rulerGuides : [],
    background: canvasBackground, onBackgroundChange: onCanvasBackgroundChange,
  };

  const scene = useMemo(() => ({ elements, background: canvasBackground }), [elements, canvasBackground]);
  // An undone step changes what differs: the elements, the background, or both.
  const applyScene = useCallback((next: CanvasScene) => {
    if (next.elements !== live.current.elements) live.current.onChange([...next.elements]);
    if (JSON.stringify(next.background) !== JSON.stringify(live.current.background)) {
      live.current.onBackgroundChange?.(next.background ?? EMPTY_BACKGROUND);
    }
  }, []);
  const history = useCanvasHistory(scene, applyScene, `${historyKey}:${editable}`);
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
  const selectionBounds = useMemo(() => unionBounds(selected.map(elementBounds)), [selected]);

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
    const rail = isEditing && hasRail ? RAIL_PADDING : 0;
    const zoom = clamp(Math.min((viewport.width - 2 * pad - rail) / width, (viewport.height - 2 * pad) / height), MIN_ZOOM, MAX_ZOOM);
    const x = rail + (viewport.width - rail - width * zoom) / 2;
    const y = !isEditing && readAlign === 'top' ? 0 : (viewport.height - height * zoom) / 2;
    return { zoom: zoom > 0 ? zoom : 1, x, y };
  }, [width, height, readAlign, paintElementId, hasRail]);

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
        // Touching one member takes its whole group.
        const all = withGroups(live.current.elements, hits)
          .filter((id) => live.current.elements.some((el) => el.id === id && !el.locked && !el.hidden));
        select([...new Set([...base, ...all])]);
      },
    });
  };

  const startMove = (start: PointerEvent, ids: string[], grabbed: string) => {
    const moving = live.current.elements.filter((el) => ids.includes(el.id) && !el.locked && !el.hidden);
    if (!moving.length) return;
    const starts = new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }]));
    const others = [
      ...live.current.elements.filter((el) => !ids.includes(el.id) && !el.hidden).map(elementBounds),
      // The ruler guides, as boxes without width or height: their one line is every edge.
      ...live.current.guides.map((g) => (g.orientation === 'vertical'
        ? { x: g.at, y: 0, width: 0, height: 0 } : { x: 0, y: g.at, width: 0, height: 0 })),
    ];
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

  /**
   * The box a scale handle drags, with its moving edges snapped to the ruler
   * guides and the artboard's edges and middle (in stage pixels, unrotated).
   * A box that keeps its proportions takes the edge that snapped and fits the
   * other side to it.
   */
  const snapBoxEdges = (oldBox: Box & { rotation: number }, box: Box & { rotation: number }, anchor: string) => {
    const v = live.current.view;
    const stops = (orientation: 'vertical' | 'horizontal', size: number, offset: number) =>
      [0, size / 2, size, ...live.current.guides.filter((g) => g.orientation === orientation).map((g) => g.at)].map((at) => offset + at * v.zoom);
    const near = (value: number, list: number[]) => {
      const best = list.reduce((b, s) => (Math.abs(s - value) < Math.abs(b - value) ? s : b), Infinity);
      return Math.abs(best - value) <= GUIDE_SNAP_PX ? best - value : null;
    };
    const xs = stops('vertical', width, v.x), ys = stops('horizontal', height, v.y);
    const left = anchor.includes('left'), right = anchor.includes('right');
    const top = anchor.includes('top'), bottom = anchor.includes('bottom');
    const dx = left ? near(box.x, xs) : right ? near(box.x + box.width, xs) : null;
    const dy = top ? near(box.y, ys) : bottom ? near(box.y + box.height, ys) : null;
    if (dx === null && dy === null) return box;
    let w = box.width + (dx === null ? 0 : left ? -dx : dx);
    let h = box.height + (dy === null ? 0 : top ? -dy : dy);
    const keepsRatio = left !== right && top !== bottom && Math.abs(box.width / box.height - oldBox.width / oldBox.height) < 0.01;
    if (keepsRatio) {
      const ratio = oldBox.width / oldBox.height;
      // The edge that snapped decides; the other follows the proportions.
      if (dx !== null && (dy === null || Math.abs(dx) <= Math.abs(dy))) h = w / ratio;
      else w = h * ratio;
    }
    if (w < 4 || h < 4) return box;
    return {
      ...box,
      x: left ? box.x + box.width - w : box.x,
      y: top ? box.y + box.height - h : box.y,
      width: w,
      height: h,
    };
  };

  /**
   * Moving a ruler guide, or pulling a new one out of a ruler (`id` null):
   * it follows the pointer and stays where it is let go; let go over a
   * ruler, it goes.
   */
  const startGuide = (start: PointerEvent, orientation: RulerGuide['orientation'], id: string | null) => {
    const guideId = id ?? createId();
    const at = (e: PointerEvent) => {
      const p = toArtboard(e.clientX, e.clientY);
      return Math.round(orientation === 'vertical' ? p.x : p.y);
    };
    // Back over its ruler, or out past the stage's edge on that side.
    const overRuler = (e: PointerEvent) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return true;
      const layout = rulerLayout(size, live.current.view, { width, height });
      return orientation === 'vertical'
        ? e.clientX - rect.left < layout.vertical.left + RULER_SIZE
        : e.clientY - rect.top < layout.horizontal.top + RULER_SIZE;
    };
    const put = (value: number) => setRulerGuides((list) => (list.some((g) => g.id === guideId)
      ? list.map((g) => (g.id === guideId ? { ...g, at: value } : g))
      : [...list, { id: guideId, orientation, at: value }]));
    let last = start;
    setGesture(true);
    trackPointerDrag(start, {
      onMove: (e) => { last = e; put(at(e)); },
      onEnd: ({ cancelled }) => {
        setGesture(false);
        // The list as last drawn, with the dragged guide where it was let go.
        const list = guidesRef.current;
        const next = cancelled || overRuler(last) ? list.filter((g) => g.id !== guideId) : list;
        setRulerGuides(next);
        finishGuides(next);
      },
    });
  };

  /**
   * Drawing a new element with a tool of the column: dragging gives its box
   * (Shift: a square), a click puts it there at its usual size. Then the
   * column goes back to selecting.
   */
  const startCreate = (start: PointerEvent, tool: { type: string; key: string }) => {
    const addition = live.current.types[tool.type]?.additions?.find((a) => a.key === tool.key);
    if (!addition) { setAddTool(null); return; }
    const from = toArtboard(start.clientX, start.clientY);
    const boxTo = (e: PointerEvent) => {
      const to = toArtboard(e.clientX, e.clientY);
      let dx = to.x - from.x, dy = to.y - from.y;
      if (e.shiftKey) {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * side;
        dy = Math.sign(dy || 1) * side;
      }
      return boxFromPoints(from.x, from.y, from.x + dx, from.y + dy);
    };
    let last: PointerEvent | null = null;
    trackPointerDrag(start, {
      threshold: DRAG_THRESHOLD_PX,
      onStart: () => setGesture(true),
      onMove: (e) => {
        last = e;
        const box = boxTo(e);
        setDraft({ ...made(tool.type, addition, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, box), id: DRAFT_ID, locked: true });
      },
      onEnd: ({ started, cancelled }) => {
        setGesture(false);
        setDraft(null);
        if (cancelled) return;
        setAddTool(null);
        const box = started && last ? boxTo(last) : null;
        if (box && (box.width >= 4 || box.height >= 4)) place(tool.type, addition, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, box);
        else place(tool.type, addition, from, null);
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
    // A ruler guide moves (its line takes the press).
    if (e.target.hasName('canvas-ruler-guide') && !guidesLocked) {
      const guide = rulerGuides.find((g) => g.id === e.target.id());
      if (guide) startGuide(evt, guide.orientation, guide.id);
      return;
    }
    if (addTool) {
      setEditingTextId(null);
      startCreate(evt, addTool);
      return;
    }
    const additive = evt.shiftKey || evt.metaKey || evt.ctrlKey;
    const hit = elementAt(e.target);
    const current = live.current.selectedIds;
    if (!hit || hit.locked) {
      setEditingTextId(null);
      startMarquee(evt, additive ? current : []);
      return;
    }
    if (editingTextId && editingTextId !== hit.id) setEditingTextId(null);
    // A click takes the whole group; the element list and a double click pick one member.
    const picked = withGroups(live.current.elements, [hit.id]);
    let ids = current;
    if (additive) {
      ids = current.includes(hit.id) ? current.filter((id) => !picked.includes(id)) : [...new Set([...current, ...picked])];
      select(ids);
      if (!ids.includes(hit.id)) return;
    } else if (!current.includes(hit.id)) {
      ids = picked;
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

  /** Pastes with the copies' middle at `at`, in artboard pixels. */
  const pasteAt = useCallback((at: { x: number; y: number }) => {
    const source = clipboard.filter((el) => live.current.types[el.type]);
    const box = unionBounds(source.map(elementBounds));
    if (!box) return;
    const dx = at.x - (box.x + box.width / 2), dy = at.y - (box.y + box.height / 2);
    addCopies(source.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy })), 0);
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

  const doGroup = useCallback(() => {
    commit(group(live.current.elements, editableIds(), createId()));
  }, [commit, editableIds, createId]);

  const doUngroup = useCallback(() => {
    commit(ungroup(live.current.elements, live.current.selectedIds));
  }, [commit]);

  /** Hiding or locking from the element list, in one step. */
  const patchElements = useCallback((ids: string[], patch: Partial<Pick<CanvasElement, 'hidden' | 'locked'>>) => {
    commit(live.current.elements.map((el) => (ids.includes(el.id) ? { ...el, ...patch } : el)));
  }, [commit]);

  const moveStack = useCallback((ids: string[], index: number) => {
    commit(moveInStack(live.current.elements, ids, index));
  }, [commit]);

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

  /**
   * A new element of an addition with its centre at `at`: in the box that was
   * drawn (a type that keeps its proportions takes the box's width, text its
   * width and the height it needs), or at the addition's own size.
   */
  const made = useCallback((type: string, addition: CanvasAddition, at: { x: number; y: number }, box: { width: number; height: number } | null) => {
    const kind = live.current.types[type];
    const created = addition.create(at, { width, height }, t);
    let size = { width: created.width, height: created.height };
    if (box) {
      const w = Math.max(8, box.width);
      size = kind?.fitHeight ? { width: w, height: created.height }
        : kind?.keepRatio ? { width: w, height: (w * created.height) / created.width }
          : { width: w, height: Math.max(8, box.height) };
    }
    const centre = { x: clamp(at.x, 0, width), y: clamp(at.y, 0, height) };
    return fitted({
      id: createId(), type, x: centre.x, y: centre.y, rotation: 0, opacity: 1, locked: false, hidden: false,
      z: live.current.elements.reduce((max, e) => Math.max(max, e.z), -1) + 1,
      ...created, ...size,
    });
  }, [width, height, t, createId, fitted]);

  const place = useCallback((type: string, addition: CanvasAddition, at: { x: number; y: number }, box: { width: number; height: number } | null) => {
    const kind = live.current.types[type];
    const el = made(type, addition, at, box);
    commit([...live.current.elements, el]);
    select([el.id]);
    rootRef.current?.focus({ preventScroll: true });
    // A new text is typed into at once, a new drawing painted in.
    if (kind?.textEdit) setEditingTextId(el.id);
    else if (kind?.paint) setPaintingId(el.id);
  }, [made, commit, select]);

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

  // Copy, cut and paste also come as the clipboard events of the app's Edit
  // menu: on macOS its items take ⌘C, ⌘X and ⌘V before the page sees the key
  // whenever there is text selected somewhere. `before…` enables the items.
  const clipboardRef = useRef<(kind: 'copy' | 'cut' | 'paste') => boolean>(() => false);
  clipboardRef.current = (kind) => {
    if (!editable || editingTextId) return false;
    const active = document.activeElement;
    if (!active || !rootRef.current?.contains(active) || active.closest('input, textarea, select, [contenteditable="true"]')) return false;
    if (paintingId) {
      const pc = paintControls;
      if (kind === 'paste') {
        if (!paintFeatures.select) return false;
        if (!isSelectTool(pc.tool)) pc.setTool('select');
        pc.paste();
        return true;
      }
      if (!pc.selection.length) return false;
      pc.copySelection();
      if (kind === 'cut') pc.removeSelection();
      return true;
    }
    if (kind === 'paste') { paste(); return true; }
    if (!live.current.selectedIds.length) return false;
    copy();
    if (kind === 'cut') removeSelected();
    return true;
  };
  useEffect(() => {
    const kinds = ['copy', 'cut', 'paste'] as const;
    const handlers = kinds.flatMap((kind) => {
      const before = (e: Event) => {
        const active = document.activeElement;
        if (editable && active && rootRef.current?.contains(active) && !active.closest('input, textarea, select, [contenteditable="true"]')) e.preventDefault();
      };
      const run = (e: Event) => { if (clipboardRef.current(kind)) e.preventDefault(); };
      return [[`before${kind}`, before], [kind, run]] as const;
    });
    for (const [name, handler] of handlers) document.addEventListener(name, handler);
    return () => { for (const [name, handler] of handlers) document.removeEventListener(name, handler); };
  }, [editable]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // While the keys' overview is open the keys are its (Escape closes it), even with the focus still here.
    if (!editable || editingTextId || keysOpen || exportOpen) return;
    const target = e.target as HTMLElement;
    // Keys in the editor's menus and windows, which are portals, reach here through React too.
    if (!rootRef.current?.contains(target)) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === '?' && !mod) { handled(); setKeysOpen(true); return; }
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
    // The tool column's letters: V selects, the others pick what to draw.
    if (!mod && !e.altKey && hasRail) {
      if (key === 'v') { handled(); setAddTool(null); return; }
      for (const type of Object.values(live.current.types)) {
        const addition = type.additions?.find((a) => a.shortcut === key);
        if (addition) { handled(); setAddTool({ type: type.type, key: addition.key }); return; }
      }
    }
    if (e.key === 'Escape' && addTool) { handled(); setAddTool(null); return; }
    if (mod && key === 'z' && features.history) { handled(); if (e.shiftKey) history.redo(); else history.undo(); return; }
    if (mod && key === 'y' && features.history) { handled(); history.redo(); return; }
    if (mod && key === 'a') { handled(); select(live.current.elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id)); return; }
    if (mod && key === 'd') { handled(); duplicate(); return; }
    if (mod && key === 'c') { handled(); copy(); return; }
    if (mod && key === 'x') { handled(); copy(); removeSelected(); return; }
    if (mod && key === 'v') { handled(); paste(); return; }
    if (mod && key === '0' && features.zoom) { handled(); fit(); return; }
    if (mod && key === 'g' && features.group) { handled(); if (e.shiftKey) doUngroup(); else doGroup(); return; }
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

  const keysButton = (
    <ToolbarBtn onClick={() => setKeysOpen(true)} active={keysOpen} title={t('canvas.keys.open')}><Keyboard size={14} /></ToolbarBtn>
  );

  const controller: CanvasController = {
    features, types, selected, canUndo: history.canUndo, canRedo: history.canRedo,
    undo: history.undo, redo: history.redo, tool: addTool, setTool: setAddTool, removeSelected, duplicate,
    arrange: doArrange, align: doAlign, distribute: doDistribute, update: updateSelected,
    zoom: view.zoom, zoomIn: () => zoomTo(view.zoom * 1.25), zoomOut: () => zoomTo(view.zoom / 1.25), fit,
    onExport: onExport ? () => setExportOpen(true) : undefined, rulers: showRulers, canRulers: editable && features.guides && !paintingId,
    toggleRulers: () => setRulers((v) => { rulersShown = !v; return !v; }), guidesLocked, toggleGuidesLocked,
    background: canvasBackground, setBackground: editable && !paintingId ? onCanvasBackgroundChange : undefined, backgroundImages,
    group: doGroup, ungroup: doUngroup, listOpen, toggleList: () => setListOpen((v) => !v),
  };

  return (
    <SymbolLibraryContext.Provider value={symbolLibrary ?? null}>
      <div
        ref={rootRef}
        className={`canvas-editor canvas-editor-${layout} ${editable ? 'canvas-editor-editing' : ''} ${paintingId ? 'canvas-editor-painting' : ''} ${addTool && !paintingId ? 'canvas-editor-adding' : ''}`}
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
                layersOpen={layersOpen}
                onToggleLayers={() => setLayersOpen((v) => !v)}
                end={(<>
                  {keysButton}
                  {!paintElementId && (
                    <ToolbarBtn onClick={() => setPaintingId(null)} active={false} title={t('canvas.donePainting')}>
                      <Check size={14} />
                      <span className="editor-toolbar-btn-label">{t('canvas.donePainting')}</span>
                    </ToolbarBtn>
                  )}
                </>)}
              />
            ) : (
              <CanvasToolbar controller={controller} end={<>{keysButton}{toolbarEnd}</>} />
            )}
          </div>
        )}
        <div
          ref={viewportRef}
          className="canvas-viewport"
          style={{ cursor: spaceDown ? 'grab' : addTool && !paintingId ? 'crosshair' : undefined, aspectRatio: layout === 'inline' ? `${width} / ${height}` : undefined }}
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
              {hasBackground(canvasBackground)
                ? <div className="h-full w-full" style={{ background: backgroundCss(canvasBackground, backgroundImages?.resolve ?? ((src) => src)) }} />
                : background}
            </div>
          </div>
          {size.width > 0 && size.height > 0 && (
            <Stage
              className="canvas-stage"
              width={size.width}
              height={size.height}
              onPointerDown={onStagePointerDown}
              onContextMenu={(e) => {
                // The paint mode keeps its own menu-less stage; a right click there does nothing.
                if (!editable || paintingId) return;
                e.evt.preventDefault();
                setAddTool(null);
                setEditingTextId(null);
                const at = toArtboard(e.evt.clientX, e.evt.clientY);
                const hit = elementAt(e.target);
                // Locked elements take no presses; the topmost one whose box is under the pointer can be unlocked here.
                const locked = hit ? null : byZ(live.current.elements).reverse().find((el) => {
                  if (!el.locked || el.hidden) return false;
                  const b = elementBounds(el);
                  return at.x >= b.x && at.x <= b.x + b.width && at.y >= b.y && at.y <= b.y + b.height;
                }) ?? null;
                if (hit && !live.current.selectedIds.includes(hit.id)) select(withGroups(live.current.elements, [hit.id]));
                else if (!hit) select([]);
                rootRef.current?.focus({ preventScroll: true });
                setMenu({ x: e.evt.clientX, y: e.evt.clientY, at, locked });
              }}
              onDblClick={(e) => {
                const hit = elementAt(e.target);
                if (!editable || !hit) return;
                // In a group, the first double click picks the member, the next opens it.
                const current = live.current.selectedIds;
                if (hit.group && !(current.length === 1 && current[0] === hit.id)) select([hit.id]);
                else openElement(hit);
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
                  {draft && (<>
                    <ElementNode el={draft} types={types} editable={false} editing={false} resourceVersion={resourceVersion} register={ignoreNode} onHover={ignoreHover} />
                    {/* Its frame too: a new drawing or text has little to show yet. */}
                    <Rect
                      x={draft.x} y={draft.y} width={draft.width} height={draft.height} offsetX={draft.width / 2} offsetY={draft.height / 2}
                      stroke={accent} strokeWidth={1 / view.zoom} dash={[4 / view.zoom, 3 / view.zoom]} opacity={0.6} listening={false}
                    />
                  </>)}
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
                  {/* Where a selection reaches past the artboard, a quiet outline shows its edge; fixed on one drawing, its frame is the edge. */}
                  {!paintElementId && (
                    <Rect
                      x={view.x} y={view.y} width={width * view.zoom} height={height * view.zoom}
                      stroke={accent} strokeWidth={1} opacity={0.25} listening={false}
                    />
                  )}
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
                  {showRulers && (
                    <Group x={view.x} y={view.y} scaleX={view.zoom} scaleY={view.zoom}>
                      {rulerGuides.map((g) => (
                        <Line
                          key={g.id}
                          id={g.id}
                          name="canvas-ruler-guide"
                          points={g.orientation === 'vertical' ? [g.at, -1e5, g.at, 1e5] : [-1e5, g.at, 1e5, g.at]}
                          stroke={RULER_GUIDE_COLOR}
                          strokeWidth={1 / view.zoom}
                          hitStrokeWidth={8 / view.zoom}
                          listening={!guidesLocked}
                          onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = g.orientation === 'vertical' ? 'ew-resize' : 'ns-resize'; }}
                          onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = ''; }}
                        />
                      ))}
                    </Group>
                  )}
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
                      if (Math.abs(newBox.rotation) > 0.001 || !anchor || anchor === 'rotater') return newBox;
                      if (!g?.snapSize) return features.guides ? snapBoxEdges(oldBox, newBox, anchor) : newBox;
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
          {editable && painting && paintType && <PaintToolRail api={paintControls} features={paintFeatures} />}
          {editable && painting && paintType && paintFeatures.layers && layersOpen && (
            <LayerPanel api={paintControls} images={layerImages} onClose={() => setLayersOpen(false)} />
          )}
          {editable && !paintingId && features.layers && listOpen && (
            <ElementList
              elements={elements}
              selectedIds={selectedIds}
              types={types}
              labelOf={elementLabel}
              resourceVersion={resourceVersion}
              canGroup={features.group}
              onSelect={(ids) => { rootRef.current?.focus({ preventScroll: true }); select(ids); }}
              onPatch={patchElements}
              onMove={moveStack}
              onOpacity={(opacity) => {
                const ids = editableIds();
                commit(live.current.elements.map((el) => (ids.includes(el.id) ? { ...el, opacity } : el)));
              }}
              onDuplicate={duplicate}
              onGroup={doGroup}
              onUngroup={doUngroup}
              onRemove={removeSelected}
              onClose={() => setListOpen(false)}
            />
          )}
          {showRulers && <Rulers size={size} view={view} artboard={{ width, height }} selection={selectionBounds} guides={rulerGuides} onPull={(orientation, e) => startGuide(e, orientation, null)} />}
          {editable && hasRail && !paintingId && <CanvasToolRail controller={controller} />}
          {editable && features.zoom && <CanvasZoom controller={controller} />}
          {overlay}
        </div>
        {keysOpen && editable && (
          <ShortcutOverview
            painting={!!paintingId}
            features={features}
            paintFeatures={paintFeatures}
            types={types}
            canLeavePaint={!paintElementId}
            onClose={() => { setKeysOpen(false); rootRef.current?.focus({ preventScroll: true }); }}
          />
        )}
        {exportOpen && onExport && (
          <ExportDialog
            artboard={{ width, height }}
            selection={selectionBounds}
            hasBackground={!!background || hasBackground(canvasBackground)}
            onExport={onExport}
            onClose={() => { setExportOpen(false); rootRef.current?.focus({ preventScroll: true }); }}
          />
        )}
        {menu && editable && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            actions={canvasMenuActions({
              t, features, selected, locked: menu.locked, canPaste: clipboard.some((el) => types[el.type]),
              canRulers: controller.canRulers, rulers: showRulers,
              cut: () => { copy(); removeSelected(); }, copy, pasteHere: () => pasteAt(menu.at), duplicate,
              arrange: doArrange, group: doGroup, ungroup: doUngroup, patch: patchElements, remove: removeSelected,
              selectAll: () => select(live.current.elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id)),
              fit, toggleRulers: controller.toggleRulers,
            })}
          />
        )}
      </div>
    </SymbolLibraryContext.Provider>
  );
});

export default CanvasEditor;

/** Guides in a colour of their own, apart from the selection. */
const GUIDE_COLOR = '#e8559b';
/** The guides pulled out of the rulers, apart from the snapping lines. */
const RULER_GUIDE_COLOR = '#3fb8e8';

/** What the toolbar reads and calls. */
export interface CanvasController {
  features: CanvasFeatures;
  types: CanvasTypes;
  selected: CanvasElement[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** The tool column's pick: an addition to draw, or `null` for selecting. */
  tool: { type: string; key: string } | null;
  setTool: (tool: { type: string; key: string } | null) => void;
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
  /** The rulers along the stage, with the guides pulled out of them. */
  rulers: boolean;
  canRulers: boolean;
  toggleRulers: () => void;
  guidesLocked: boolean;
  toggleGuidesLocked: () => void;
  /** The artboard's background, and changing it where the place allows. */
  background: CanvasBackground | null;
  setBackground?: (background: CanvasBackground) => void;
  backgroundImages?: CanvasBackgroundImages;
  /** The selected elements as one group, and their groups dissolved. */
  group: () => void;
  ungroup: () => void;
  /** The element list beside the stage. */
  listOpen: boolean;
  toggleList: () => void;
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
