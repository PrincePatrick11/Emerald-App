import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  applyTransform, IDENTITY, inPolygon, isBoxShape, isShapeTool, PAINT_HEIGHT, PAINT_WIDTH, paintId, strokeBounds,
  symmetricCopies, thinPoints, transformStroke, translateLayer, unionRects,
  type PaintLayer, type PaintRect, type PaintStroke, type PaintTool, type PaintTransform,
} from '../../../../lib/paint/document';
import { drawLayer, drawStroke, strokePath, type LayerImages } from './render';
import { fillArea } from './fillArea';
import { isDrawTool, isSelectTool, type EditorTool, type PaintControls } from './usePaintTools';

/**
 * The drawing surface of the paint mode, laid over the drawing element being
 * painted: its box on screen (`box`, turned with the element), with the
 * canvas at the pixels of that box (times the device's pixel ratio) and the
 * document scaled onto it, so strokes stay sharp at every zoom.
 *
 * Every layer keeps a canvas of its own: a new stroke is drawn onto its
 * layer's canvas alone, and the layers are stacked onto the visible canvas
 * with their opacity. What a gesture changes (the stroke being drawn, the
 * selected strokes being moved, scaled or turned, the moved layer) lives
 * outside React (a ref, one redraw per frame) and becomes part of the
 * document when the pointer lifts, as one step.
 *
 * The tools besides drawing: selecting strokes of the layer drawn on with a
 * rectangle or a lasso (what lies inside: a freehand stroke reaching out is cut there), or by clicking one (Shift adds), with a frame whose
 * corners scale and whose knob turns; moving the whole layer; taking a
 * colour from the drawing (the picker, or Alt with the pen or the bucket);
 * and the bucket, which fills the area around a spot as a vector
 * (`fillArea`). In symmetry every stroke shows and gets its copies; the
 * axes or rays show as guides while a drawing tool is picked.
 *
 * Input: pointer events with pen pressure where the device reports it, and
 * the coalesced events in between, so a fast stroke keeps its curve. Only
 * one pointer works at a time; once a pen has been used, touches are taken
 * for the resting hand and ignored. `touch-action: none` keeps a finger from
 * scrolling the page while drawing.
 */

interface CachedLayer {
  layer: PaintLayer;
  canvas: HTMLCanvasElement;
  width: number;
  imageDrawn: boolean;
}

type Gesture =
  | { kind: 'draw'; pointerId: number; layerId: string; stroke: PaintStroke; anchor: [number, number] }
  | { kind: 'transform'; pointerId: number; mode: 'move' | 'scale' | 'rotate' | 'layer'; layerId: string; start: [number, number]; pivot: [number, number]; corner: [number, number]; t: PaintTransform; moved: boolean }
  | { kind: 'pick'; pointerId: number; lasso: boolean; points: number[]; base: string[]; moved: boolean }
  | { kind: 'color'; pointerId: number };

/** How close, on screen, a press has to come to a handle or a stroke to take it. */
const HANDLE_PX = 9;
/** The turning knob's distance above the frame, on screen. */
const KNOB_PX = 22;

/** Shift: a line in steps of 15°, an ellipse or rectangle with equal sides. */
function constrain(tool: PaintTool, x0: number, y0: number, x: number, y: number): [number, number] {
  const dx = x - x0, dy = y - y0;
  if (tool === 'line') {
    const step = Math.PI / 12;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = Math.hypot(dx, dy);
    return [x0 + Math.cos(angle) * length, y0 + Math.sin(angle) * length];
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + Math.sign(dx || 1) * side, y0 + Math.sign(dy || 1) * side];
}

function corners(r: PaintRect): [number, number][] {
  return [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
}

function hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Where the surface lies in its positioned parent, in CSS pixels, and how it is turned (degrees). */
export interface SurfaceBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
}

export default function PaintSurface({ box, api, images, editable }: {
  box: SurfaceBox;
  api: PaintControls;
  images: LayerImages;
  editable: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const hitRef = useRef<CanvasRenderingContext2D | null>(null);
  const cache = useRef(new Map<string, CachedLayer>());
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const penSeen = useRef(false);
  const [altDown, setAltDown] = useState(false);
  // What the overlay shows of a gesture: the frame's transform, the rectangle or lasso.
  const [liveT, setLiveT] = useState<PaintTransform | null>(null);
  const [pickPath, setPickPath] = useState<{ lasso: boolean; points: number[] } | null>(null);
  // Backing size of the canvas in device pixels.
  const [backing, setBacking] = useState({ width: PAINT_WIDTH, height: PAINT_HEIGHT });

  const { doc } = api;
  // The latest props for the pointer handlers and the frame callback.
  const props = useRef({ box, api, images, editable });
  props.current = { box, api, images, editable };

  // Bounded: a huge zoom must not ask for a canvas the browser refuses.
  useLayoutEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.min(4096, Math.round(box.width * dpr)));
    const height = Math.max(1, Math.min(4096, Math.round(box.height * dpr)));
    setBacking((b) => (b.width === width && b.height === height ? b : { width, height }));
  }, [box.width, box.height]);

  /** The layer's own canvas, brought up to date: one new stroke is added, anything else redrawn. */
  const layerCanvas = useCallback((layer: PaintLayer): HTMLCanvasElement => {
    const { images: imgs } = props.current;
    const imageDrawn = !!layer.image && imgs.has(layer.image);
    const cached = cache.current.get(layer.id);
    const sameBase = cached && cached.width === backing.width && cached.layer.image === layer.image
      && cached.layer.imageRect === layer.imageRect && cached.imageDrawn === imageDrawn;
    if (cached && sameBase && cached.layer === layer) return cached.canvas;
    const canvas = cached?.canvas ?? document.createElement('canvas');
    if (canvas.width !== backing.width || canvas.height !== backing.height) {
      canvas.width = backing.width;
      canvas.height = backing.height;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(backing.width / PAINT_WIDTH, 0, 0, backing.height / PAINT_HEIGHT, 0, 0);
    const prev = cached?.layer.strokes;
    const appended = sameBase && prev && layer.strokes.length === prev.length + 1
      && (prev.length === 0 || layer.strokes[prev.length - 1] === prev[prev.length - 1]);
    if (appended) drawStroke(ctx, layer.strokes[layer.strokes.length - 1]);
    else drawLayer(ctx, layer, imgs);
    cache.current.set(layer.id, { layer, canvas, width: backing.width, imageDrawn });
    return canvas;
  }, [backing]);

  /** The scratch canvas at the visible canvas's size, cleared, drawing in document units. */
  const scratch = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
    const s = scratchRef.current ?? (scratchRef.current = document.createElement('canvas'));
    if (s.width !== canvas.width || s.height !== canvas.height) {
      s.width = canvas.width;
      s.height = canvas.height;
    }
    const sctx = s.getContext('2d')!;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, s.width, s.height);
    sctx.setTransform(canvas.width / PAINT_WIDTH, 0, 0, canvas.height / PAINT_HEIGHT, 0, 0);
    return sctx;
  };

  /** Stacks the visible layers, with what a gesture changes on its layer. */
  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { api: { doc: d, selection } } = props.current;
    const g = gesture.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of d.layers) {
      if (layer.hidden) continue;
      ctx.globalAlpha = layer.opacity;
      if (g?.kind === 'draw' && g.layerId === layer.id) {
        // The stroke on a copy of its layer: an eraser stroke must cut only there.
        const sctx = scratch(canvas);
        sctx.save();
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.drawImage(layerCanvas(layer), 0, 0);
        sctx.restore();
        drawStroke(sctx, g.stroke, true);
        for (const copy of symmetricCopies(g.stroke, props.current.api.symmetry)) drawStroke(sctx, copy, true);
        ctx.drawImage(sctx.canvas, 0, 0);
      } else if (g?.kind === 'transform' && g.layerId === layer.id && g.moved) {
        const ids = new Set(selection);
        const moved = g.mode === 'layer'
          ? translateLayer(layer, g.t.dx, g.t.dy)
          : { ...layer, strokes: layer.strokes.map((s) => (ids.has(s.id) ? transformStroke(s, g.t) : s)) };
        const sctx = scratch(canvas);
        drawLayer(sctx, moved, props.current.images);
        ctx.drawImage(sctx.canvas, 0, 0);
      } else {
        ctx.drawImage(layerCanvas(layer), 0, 0);
      }
    }
    ctx.globalAlpha = 1;
  }, [layerCanvas]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Layers that are gone leave the cache; everything is stacked anew.
  useLayoutEffect(() => {
    const ids = new Set(doc.layers.map((l) => l.id));
    for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id);
    paint();
  }, [doc, images, backing, paint]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Alt turns a drawing tool into the picker while it is held.
  useEffect(() => {
    const key = (e: KeyboardEvent) => setAltDown(e.altKey);
    const blur = () => setAltDown(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /** A pointer in the surface's own, unturned coordinates (CSS pixels from its top-left corner). */
  const toLocal = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = shellRef.current!.getBoundingClientRect();
    const { width, height, rotation } = props.current.box;
    // The bounding box of a turned element shares its centre.
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const rad = (-rotation * Math.PI) / 180;
    return [dx * Math.cos(rad) - dy * Math.sin(rad) + width / 2, dx * Math.sin(rad) + dy * Math.cos(rad) + height / 2];
  };

  const toDoc = (e: { clientX: number; clientY: number }): [number, number] => {
    const [x, y] = toLocal(e);
    const { width, height } = props.current.box;
    return [(x / width) * PAINT_WIDTH, (y / height) * PAINT_HEIGHT];
  };

  /** Document units per screen pixel. */
  const unit = () => PAINT_WIDTH / props.current.box.width;

  /** The grid's cell, in document units (square: as many across as `cells`). */
  const gridStep = () => PAINT_WIDTH / props.current.api.grid.cells;
  const snapStep = (n: number) => Math.round(n / gridStep()) * gridStep();
  /** A point on the nearest grid crossing while snapping is on. */
  const snapPoint = (x: number, y: number): [number, number] =>
    (props.current.api.grid.snap ? [snapStep(x), snapStep(y)] : [x, y]);

  // ── The selection's frame ──────────────────────────────────────────────

  const activeLayer = doc.layers.find((l) => l.id === api.activeLayer);
  const bounds = useMemo(() => {
    if (!activeLayer || !api.selection.length) return null;
    const ids = new Set(api.selection);
    return unionRects(activeLayer.strokes.filter((s) => ids.has(s.id)).map(strokeBounds));
  }, [activeLayer, api.selection]);

  /** The frame's corners and turning knob in document units, with a transform applied. */
  const frameOf = (r: PaintRect, t: PaintTransform | null) => {
    const pts = corners(r).map(([x, y]) => (t ? applyTransform(t, x, y) : [x, y] as [number, number]));
    const top: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const centre: [number, number] = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
    const len = Math.hypot(top[0] - centre[0], top[1] - centre[1]) || 1;
    const away = KNOB_PX * unit();
    const knob: [number, number] = [top[0] + ((top[0] - centre[0]) / len) * away, top[1] + ((top[1] - centre[1]) / len) * away];
    return { corners: pts, top, knob, centre };
  };

  // ── Picking ────────────────────────────────────────────────────────────

  /** The topmost stroke of the active layer under a point (not an eraser). */
  const strokeAt = (x: number, y: number): PaintStroke | null => {
    const layer = props.current.api.doc.layers.find((l) => l.id === props.current.api.activeLayer);
    if (!layer) return null;
    const ctx = hitRef.current ?? (hitRef.current = document.createElement('canvas').getContext('2d')!);
    const tolerance = HANDLE_PX * 0.7 * unit();
    for (let i = layer.strokes.length - 1; i >= 0; i--) {
      const s = layer.strokes[i];
      if (s.tool === 'eraser') continue;
      const path = strokePath(s);
      const solid = !isShapeTool(s.tool) || s.filled;
      ctx.lineWidth = (isShapeTool(s.tool) && !s.filled ? s.size : 0) + tolerance * 2;
      if ((solid && ctx.isPointInPath(path, x, y, s.tool === 'fill' ? 'evenodd' : 'nonzero')) || ctx.isPointInStroke(path, x, y)) return s;
    }
    return null;
  };

  /** Is a point inside the rectangle (from its first to its last point) or the lasso? */
  const areaTest = (lasso: boolean, points: number[]): ((x: number, y: number) => boolean) | null => {
    if (lasso) return points.length < 6 ? null : (x, y) => inPolygon(x, y, points);
    const [x0, y0] = points, x1 = points[points.length - 2], y1 = points[points.length - 1];
    const [l, r, t, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    return (x, y) => x >= l && x <= r && y >= t && y <= b;
  };

  /** Takes the drawing's colour under the pointer as the brush's. */
  const pickColor = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [lx, ly] = toLocal(e);
    const x = Math.floor((lx / props.current.box.width) * canvas.width);
    const y = Math.floor((ly / props.current.box.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    try {
      const [r, g, b, a] = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      // Nothing drawn there: the brush keeps its colour.
      if (a < 16) return;
      props.current.api.setColor(`#${hex(r)}${hex(g)}${hex(b)}`);
    } catch {
      // A canvas that drew a foreign image cannot be read; the colour stays.
    }
  };

  // ── Pointer ────────────────────────────────────────────────────────────

  /** Alt picks a colour with the pen or the bucket; with a shape it draws from the middle. */
  const altPicks = (tool: EditorTool) => tool === 'pen' || tool === 'fill';
  const effectiveTool = (alt: boolean) => {
    const { tool } = props.current.api;
    return alt && altPicks(tool) ? 'picker' : tool;
  };

  /** The brush's outline under the pointer, at the brush's size on screen. */
  const placeCursor = (e: React.PointerEvent, show: boolean) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const tool = effectiveTool(e.altKey);
    if (!show || e.pointerType === 'touch' || !isDrawTool(tool) || tool === 'fill') {
      cursor.style.opacity = '0';
      return;
    }
    const [x, y] = toLocal(e);
    const diameter = Math.max(4, props.current.api.size / unit());
    cursor.style.opacity = '1';
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate(${x - diameter / 2}px, ${y - diameter / 2}px)`;
  };

  const startTransform = (e: React.PointerEvent, mode: 'move' | 'scale' | 'rotate' | 'layer', start: [number, number], pivot: [number, number], corner: [number, number]) => {
    gesture.current = {
      kind: 'transform', pointerId: e.pointerId, mode, layerId: props.current.api.activeLayer,
      start, pivot, corner, t: { ...IDENTITY, cx: pivot[0], cy: pivot[1] }, moved: false,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = props.current;
    if (!p.editable || gesture.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') penSeen.current = true;
    else if (e.pointerType === 'touch' && penSeen.current) return;
    const tool = effectiveTool(e.altKey);
    const layer = p.api.doc.layers.find((l) => l.id === p.api.activeLayer);
    if (tool !== 'picker' && (!layer || layer.hidden || layer.locked)) return;
    e.preventDefault();
    // Throws for pointer IDs without a real OS pointer session (synthetic
    // events); the gestures work without the capture too.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* see above */
    }
    const [x, y] = toDoc(e);
    const [gx, gy] = snapPoint(x, y);

    if (tool === 'picker') {
      gesture.current = { kind: 'color', pointerId: e.pointerId };
      pickColor(e);
      return;
    }
    if (tool === 'move') {
      startTransform(e, 'layer', [x, y], [x, y], [x, y]);
      return;
    }
    if (isSelectTool(tool)) {
      const reach = HANDLE_PX * unit();
      if (bounds && !e.shiftKey) {
        const f = frameOf(bounds, null);
        if (Math.hypot(x - f.knob[0], y - f.knob[1]) <= reach) {
          startTransform(e, 'rotate', [x, y], f.centre, f.knob);
          return;
        }
        const hit = f.corners.findIndex(([cx, cy]) => Math.hypot(x - cx, y - cy) <= reach);
        if (hit >= 0) {
          startTransform(e, 'scale', [x, y], f.corners[(hit + 2) % 4], f.corners[hit]);
          return;
        }
        if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) {
          startTransform(e, 'move', [x, y], [x, y], [x, y]);
          return;
        }
      }
      const stroke = strokeAt(x, y);
      if (stroke) {
        const current = p.api.selection;
        if (e.shiftKey) {
          p.api.select(current.includes(stroke.id) ? current.filter((id) => id !== stroke.id) : [...current, stroke.id]);
          return;
        }
        if (!current.includes(stroke.id)) {
          p.api.select([stroke.id]);
          // The press goes on as a move of the stroke just picked.
          props.current = { ...p, api: { ...p.api, selection: [stroke.id] } };
        }
        startTransform(e, 'move', [x, y], [x, y], [x, y]);
        return;
      }
      gesture.current = { kind: 'pick', pointerId: e.pointerId, lasso: tool === 'lasso', points: [x, y], base: e.shiftKey ? p.api.selection : [], moved: false };
      return;
    }
    if (!isDrawTool(tool)) return;
    const base = {
      color: p.api.color, size: p.api.size, rotation: 0, filled: isBoxShape(tool) && p.api.filled, sides: p.api.sides, rings: [] as number[][],
    };
    if (tool === 'fill') {
      const rings = fillArea(p.api.doc, p.images, x, y);
      if (rings) p.api.addStroke({ ...base, id: paintId(), tool, points: [x, y, 1], pressure: false, rings });
      return;
    }
    const pen = e.pointerType === 'pen';
    const pressure = pen ? e.pressure || 0.5 : 0.5;
    gesture.current = {
      kind: 'draw',
      pointerId: e.pointerId,
      layerId: p.api.activeLayer,
      anchor: isShapeTool(tool) ? [gx, gy] : [x, y],
      stroke: {
        ...base,
        id: paintId(),
        tool,
        points: isShapeTool(tool) ? [gx, gy, pressure, gx, gy, pressure] : [x, y, pressure],
        pressure: pen,
      },
    };
    schedule();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    placeCursor(e, props.current.editable);
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === 'color') {
      pickColor(e);
      return;
    }
    let [x, y] = toDoc(e);
    if (g.kind === 'pick') {
      if (g.lasso) g.points.push(x, y);
      else g.points = [g.points[0], g.points[1], x, y];
      g.moved = g.moved || Math.hypot(x - g.points[0], y - g.points[1]) > 3 * unit();
      setPickPath({ lasso: g.lasso, points: [...g.points] });
      return;
    }
    if (g.kind === 'transform') {
      const [sx, sy] = g.start;
      if (g.mode === 'move' || g.mode === 'layer') {
        let dx = x - sx, dy = y - sy;
        // Shift: along one axis.
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        // On the grid: moved by whole cells.
        if (props.current.api.grid.snap) [dx, dy] = [snapStep(dx), snapStep(dy)];
        g.t = { ...g.t, dx, dy };
      } else if (g.mode === 'scale') {
        const [px, py] = g.pivot, [cx, cy] = g.corner;
        const vx = cx - px, vy = cy - py;
        const scale = Math.max(0.02, ((x - px) * vx + (y - py) * vy) / (vx * vx + vy * vy || 1));
        g.t = { ...g.t, scale };
      } else {
        const [px, py] = g.pivot;
        let angle = Math.atan2(y - py, x - px) - Math.atan2(sy - py, sx - px);
        if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
        g.t = { ...g.t, angle };
      }
      g.moved = g.moved || Math.hypot(x - sx, y - sy) > 2 * unit();
      if (g.moved) {
        if (g.mode !== 'layer') setLiveT(g.t);
        schedule();
      }
      return;
    }
    const { stroke } = g;
    const pts = stroke.points;
    if (isShapeTool(stroke.tool)) {
      const [ax, ay] = g.anchor;
      if (e.shiftKey) [x, y] = constrain(stroke.tool, ax, ay, x, y);
      else [x, y] = snapPoint(x, y);
      // Alt: from the middle out, the start mirrored through it.
      [pts[0], pts[1]] = e.altKey ? [2 * ax - x, 2 * ay - y] : [ax, ay];
      pts[3] = x;
      pts[4] = y;
    } else {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const [ex, ey] = toDoc(ev);
        const dx = ex - pts[pts.length - 3], dy = ey - pts[pts.length - 2];
        if (dx * dx + dy * dy < 0.04) continue;
        pts.push(ex, ey, stroke.pressure ? ev.pressure || 0.5 : 0.5);
      }
    }
    schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, keep: boolean) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const { api: a } = props.current;
    if (g.kind === 'color') return;
    if (g.kind === 'pick') {
      setPickPath(null);
      if (!keep) return;
      const test = g.moved ? areaTest(g.lasso, g.points) : null;
      if (test) a.selectArea(test, g.base);
      else a.select(g.base);
      return;
    }
    if (g.kind === 'transform') {
      setLiveT(null);
      // The canvas keeps showing the last frame until the document has the change.
      if (keep && g.moved) a.transform(g.t, g.mode === 'layer');
      else schedule();
      return;
    }
    const { stroke } = g;
    const [x0, y0, , x1, y1] = stroke.points;
    // A shape needs an extent; a click with the pen leaves a dot.
    const empty = isShapeTool(stroke.tool) && Math.hypot(x1 - x0, y1 - y0) < 1;
    if (!keep || empty) {
      schedule();
      return;
    }
    a.addStroke(isShapeTool(stroke.tool) ? stroke : { ...stroke, points: thinPoints(stroke.points) });
  };

  // Escape drops what a gesture was doing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !gesture.current) return;
      gesture.current = null;
      setLiveT(null);
      setPickPath(null);
      schedule();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [schedule]);

  // ── Overlay ────────────────────────────────────────────────────────────

  /** A point of the document on the surface, in CSS pixels. */
  const px = ([x, y]: readonly [number, number] | number[]) => [(x / PAINT_WIDTH) * box.width, (y / PAINT_HEIGHT) * box.height];
  const pointsAttr = (pts: readonly (readonly [number, number] | number[])[]) => pts.map((p) => px(p).join(',')).join(' ');
  const selFrame = bounds && isSelectTool(api.tool) ? frameOf(bounds, liveT) : null;
  const pickPoints: [number, number][] = [];
  if (pickPath?.lasso) for (let i = 0; i + 1 < pickPath.points.length; i += 2) pickPoints.push([pickPath.points[i], pickPath.points[i + 1]]);
  else if (pickPath) {
    const [x0, y0, x1 = x0, y1 = y0] = pickPath.points;
    pickPoints.push([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
  }
  const tool = altDown && (api.tool === 'pen' || api.tool === 'fill') ? 'picker' : api.tool;
  // The symmetry's axes or rays, from the middle of the page, while drawing.
  const guides: [number, number][][] = [];
  // The grid's lines as one path, the middle lines apart (stronger).
  let gridPath = '';
  let middlePath = '';
  if (api.grid.visible) {
    const step = PAINT_WIDTH / api.grid.cells;
    const sx = box.width / PAINT_WIDTH, sy = box.height / PAINT_HEIGHT;
    for (let x = step; x < PAINT_WIDTH - 0.5; x += step) gridPath += `M${x * sx} 0V${box.height}`;
    for (let y = step; y < PAINT_HEIGHT - 0.5; y += step) gridPath += `M0 ${y * sy}H${box.width}`;
    middlePath = `M${box.width / 2} 0V${box.height}M0 ${box.height / 2}H${box.width}`;
  }
  if (isDrawTool(api.tool) && api.symmetry.kind !== 'off') {
    const cx = PAINT_WIDTH / 2, cy = PAINT_HEIGHT / 2;
    if (api.symmetry.kind === 'radial') {
      const reach = Math.hypot(cx, cy);
      for (let i = 0; i < api.symmetry.rays; i++) {
        const a = -Math.PI / 2 + (i / api.symmetry.rays) * Math.PI * 2;
        guides.push([[cx, cy], [cx + Math.cos(a) * reach, cy + Math.sin(a) * reach]]);
      }
    } else {
      guides.push([[cx, 0], [cx, PAINT_HEIGHT]]);
      if (api.symmetry.kind === 'quad') guides.push([[0, cy], [PAINT_WIDTH, cy]]);
    }
  }
  const cursor = !editable ? undefined
    : tool === 'picker' ? 'crosshair'
      : api.layerLocked ? 'not-allowed'
        : tool === 'move' ? 'move'
          : isSelectTool(tool) ? 'default'
            : tool === 'fill' ? 'cell'
            : undefined;

  return (
    <div
      ref={shellRef}
      className="paint-surface"
      style={{
        left: box.left, top: box.top, width: box.width, height: box.height,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
      }}
    >
      <canvas
        ref={canvasRef}
        width={backing.width}
        height={backing.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
        onPointerLeave={(e) => placeCursor(e, false)}
        className={`paint-canvas${editable ? ' paint-canvas--editable' : ''}`}
        style={{ cursor }}
      />
      {(selFrame || pickPath || guides.length > 0 || gridPath) && (
        <svg className="paint-overlay" width={box.width} height={box.height} aria-hidden>
          {gridPath && <path className="paint-grid" d={gridPath} />}
          {middlePath && <path className="paint-grid paint-grid--middle" d={middlePath} />}
          {guides.map((line, i) => <polyline key={i} className="paint-guide" points={pointsAttr(line)} />)}
          {selFrame && (<>
            <polygon className="paint-frame" points={pointsAttr(selFrame.corners)} />
            <polyline className="paint-frame" points={pointsAttr([selFrame.top, selFrame.knob])} />
            {selFrame.corners.map((c, i) => {
              const [x, y] = px(c);
              return <rect key={i} className="paint-handle" x={x - 4.5} y={y - 4.5} width={9} height={9} rx={2} />;
            })}
            <circle className="paint-handle" cx={px(selFrame.knob)[0]} cy={px(selFrame.knob)[1]} r={5} />
          </>)}
          {pickPath && <polygon className="paint-pick" points={pointsAttr(pickPoints)} />}
        </svg>
      )}
      {editable && <div ref={cursorRef} className={`paint-cursor${api.tool === 'eraser' ? ' paint-cursor--eraser' : ''}`} aria-hidden />}
    </div>
  );
}
