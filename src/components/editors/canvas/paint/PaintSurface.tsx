import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  isShapeTool, PAINT_HEIGHT, PAINT_WIDTH, paintId, thinPoints, type PaintDoc, type PaintLayer, type PaintStroke, type PaintTool,
} from '../../../../lib/paint/document';
import { drawLayer, drawStroke, type LayerImages } from './render';

/**
 * The drawing surface of the paint mode, laid over the drawing element being
 * painted: its box on screen (`box`, turned with the element), with the
 * canvas at the pixels of that box (times the device's pixel ratio) and the
 * document scaled onto it, so strokes stay sharp at every zoom.
 *
 * Every layer keeps a canvas of its own: a new stroke is drawn onto its
 * layer's canvas alone, and the layers are stacked onto the visible canvas.
 * The stroke being drawn lives outside React (a ref, one redraw per frame),
 * so a long stroke with many points does not re-render anything; it becomes
 * part of the document when the pointer lifts.
 *
 * Input: pointer events with pen pressure where the device reports it, and
 * the coalesced events in between, so a fast stroke keeps its curve. Only
 * one pointer draws at a time; once a pen has been used, touches are taken
 * for the resting hand and ignored. `touch-action: none` keeps a finger from
 * scrolling the page while drawing.
 */

interface CachedLayer {
  layer: PaintLayer;
  canvas: HTMLCanvasElement;
  width: number;
  imageDrawn: boolean;
}

interface LiveStroke {
  pointerId: number;
  layerId: string;
  stroke: PaintStroke;
}

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

/** Where the surface lies in its positioned parent, in CSS pixels, and how it is turned (degrees). */
export interface SurfaceBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
}

export default function PaintSurface({ box, doc, activeLayer, tool, color, size, images, editable, onStroke }: {
  box: SurfaceBox;
  doc: PaintDoc;
  activeLayer: string;
  tool: PaintTool;
  color: string;
  size: number;
  images: LayerImages;
  editable: boolean;
  onStroke: (stroke: PaintStroke) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const cache = useRef(new Map<string, CachedLayer>());
  const live = useRef<LiveStroke | null>(null);
  const frame = useRef(0);
  const penSeen = useRef(false);
  // Backing size of the canvas in device pixels.
  const [backing, setBacking] = useState({ width: PAINT_WIDTH, height: PAINT_HEIGHT });

  // The latest props for the pointer handlers and the frame callback.
  const props = useRef({ box, doc, activeLayer, tool, color, size, images, editable, onStroke });
  props.current = { box, doc, activeLayer, tool, color, size, images, editable, onStroke };

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
    const sameBase = cached && cached.width === backing.width && cached.layer.image === layer.image && cached.imageDrawn === imageDrawn;
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

  /** Stacks the visible layers, with the stroke being drawn on its layer. */
  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { doc: d } = props.current;
    const drawing = live.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of d.layers) {
      if (layer.hidden) continue;
      const source = layerCanvas(layer);
      if (drawing?.layerId !== layer.id) {
        ctx.drawImage(source, 0, 0);
        continue;
      }
      // The stroke on a copy of its layer: an eraser stroke must cut only there.
      const scratch = scratchRef.current ?? (scratchRef.current = document.createElement('canvas'));
      if (scratch.width !== canvas.width || scratch.height !== canvas.height) {
        scratch.width = canvas.width;
        scratch.height = canvas.height;
      }
      const sctx = scratch.getContext('2d')!;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.drawImage(source, 0, 0);
      sctx.setTransform(canvas.width / PAINT_WIDTH, 0, 0, canvas.height / PAINT_HEIGHT, 0, 0);
      drawStroke(sctx, drawing.stroke, true);
      ctx.drawImage(scratch, 0, 0);
    }
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

  /** The brush's outline under the pointer, at the brush's size on screen. */
  const placeCursor = (e: React.PointerEvent, show: boolean) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    if (!show || e.pointerType === 'touch') {
      cursor.style.opacity = '0';
      return;
    }
    const [x, y] = toLocal(e);
    const diameter = Math.max(4, (props.current.size * props.current.box.width) / PAINT_WIDTH);
    cursor.style.opacity = '1';
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate(${x - diameter / 2}px, ${y - diameter / 2}px)`;
  };

  const layerHidden = () => {
    const { doc: d, activeLayer: id } = props.current;
    return d.layers.find((l) => l.id === id)?.hidden ?? true;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = props.current;
    if (!p.editable || live.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') penSeen.current = true;
    else if (e.pointerType === 'touch' && penSeen.current) return;
    if (layerHidden()) return;
    e.preventDefault();
    // Throws for pointer IDs without a real OS pointer session (synthetic
    // events); drawing works without the capture too.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* see above */
    }
    const [x, y] = toDoc(e);
    const pen = e.pointerType === 'pen';
    const pressure = pen ? e.pressure || 0.5 : 0.5;
    live.current = {
      pointerId: e.pointerId,
      layerId: p.activeLayer,
      stroke: {
        id: paintId(),
        tool: p.tool,
        color: p.color,
        size: p.size,
        points: isShapeTool(p.tool) ? [x, y, pressure, x, y, pressure] : [x, y, pressure],
        pressure: pen,
      },
    };
    schedule();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    placeCursor(e, props.current.editable);
    const drawing = live.current;
    if (!drawing || drawing.pointerId !== e.pointerId) return;
    const { stroke } = drawing;
    const pts = stroke.points;
    if (isShapeTool(stroke.tool)) {
      let [x, y] = toDoc(e);
      if (e.shiftKey) [x, y] = constrain(stroke.tool, pts[0], pts[1], x, y);
      pts[3] = x;
      pts[4] = y;
    } else {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const [x, y] = toDoc(ev);
        const dx = x - pts[pts.length - 3], dy = y - pts[pts.length - 2];
        if (dx * dx + dy * dy < 0.04) continue;
        pts.push(x, y, stroke.pressure ? ev.pressure || 0.5 : 0.5);
      }
    }
    schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, keep: boolean) => {
    const drawing = live.current;
    if (!drawing || drawing.pointerId !== e.pointerId) return;
    live.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const { stroke } = drawing;
    const [x0, y0, , x1, y1] = stroke.points;
    // A shape needs an extent; a click with the pen leaves a dot.
    const empty = isShapeTool(stroke.tool) && Math.hypot(x1 - x0, y1 - y0) < 1;
    if (!keep || empty) {
      schedule();
      return;
    }
    // The canvas keeps showing the last frame until the document has the stroke.
    props.current.onStroke(isShapeTool(stroke.tool) ? stroke : { ...stroke, points: thinPoints(stroke.points) });
  };

  // Escape drops the stroke being drawn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !live.current) return;
      live.current = null;
      schedule();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [schedule]);

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
      />
      {editable && <div ref={cursorRef} className={`paint-cursor${tool === 'eraser' ? ' paint-cursor--eraser' : ''}`} aria-hidden />}
    </div>
  );
}
