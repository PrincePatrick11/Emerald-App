import { useEffect, useRef } from 'react';

/** How thick the rulers are, in screen pixels. */
export const RULER_SIZE = 18;

/** A guide the user pulled out of a ruler, in artboard pixels. */
export interface RulerGuide {
  id: string;
  orientation: 'vertical' | 'horizontal';
  at: number;
}

/** The step between labelled ticks: 1, 2 or 5 times a power of ten, at least `minPx` apart on screen. */
function tickStep(zoom: number, minPx = 56): number {
  const raw = minPx / zoom;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= raw) ?? 10 * power;
}

function readToken(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** One ruler: ticks and numbers in artboard pixels, following the view. */
function Ruler({ orientation, length, offset, zoom, style, onPointerDown }: {
  orientation: 'horizontal' | 'vertical';
  /** Screen pixels along the ruler. */
  length: number;
  /** Where the artboard's 0 is, in screen pixels from the ruler's start. */
  offset: number;
  zoom: number;
  style: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const horizontal = orientation === 'horizontal';
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || length <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = horizontal ? length : RULER_SIZE, h = horizontal ? RULER_SIZE : length;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = readToken(canvas, '--text-subtle', '#888');
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '9px system-ui, sans-serif';
    ctx.lineWidth = 1;
    const step = tickStep(zoom);
    const minor = step / 5;
    const first = Math.floor(-offset / zoom / minor) * minor;
    ctx.beginPath();
    for (let v = first; v * zoom + offset <= length; v += minor) {
      const p = Math.round(v * zoom + offset) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const tick = major ? RULER_SIZE : RULER_SIZE * 0.3;
      if (horizontal) { ctx.moveTo(p, RULER_SIZE); ctx.lineTo(p, RULER_SIZE - tick); } else { ctx.moveTo(RULER_SIZE, p); ctx.lineTo(RULER_SIZE - tick, p); }
      if (major) {
        const label = String(Math.round(v));
        if (horizontal) {
          ctx.fillText(label, p + 3, 9);
        } else {
          ctx.save();
          ctx.translate(9, p + 3);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.stroke();
  }, [horizontal, length, offset, zoom]);
  return (
    <canvas
      ref={ref}
      className={`canvas-ruler canvas-ruler-${orientation}`}
      style={{ ...style, ...(horizontal ? { width: length, height: RULER_SIZE } : { width: RULER_SIZE, height: length }) }}
      onPointerDown={onPointerDown}
    />
  );
}

/** Where the rulers lie on the stage, in screen pixels: right along the artboard's top and left edge, kept in view. */
export function rulerLayout(size: { width: number; height: number }, view: { zoom: number; x: number; y: number }, artboard: { width: number; height: number }) {
  const clampTo = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const top = clampTo(view.y - RULER_SIZE, 0, size.height - RULER_SIZE);
  const left = clampTo(view.x - RULER_SIZE, 0, size.width - RULER_SIZE);
  const hStart = clampTo(view.x, left + RULER_SIZE, size.width);
  const hEnd = clampTo(view.x + artboard.width * view.zoom, hStart, size.width);
  const vStart = clampTo(view.y, top + RULER_SIZE, size.height);
  const vEnd = clampTo(view.y + artboard.height * view.zoom, vStart, size.height);
  return {
    horizontal: { left: hStart, top, length: hEnd - hStart },
    vertical: { left, top: vStart, length: vEnd - vStart },
    corner: { left, top },
  };
}

/**
 * The rulers right at the artboard, along its top and left edge, in artboard
 * pixels. Pressing one and dragging onto the stage pulls out a guide: from
 * the top ruler a horizontal one, from the left a vertical one.
 */
export default function Rulers({ size, view, artboard, onPull }: {
  size: { width: number; height: number };
  view: { zoom: number; x: number; y: number };
  artboard: { width: number; height: number };
  onPull: (orientation: RulerGuide['orientation'], e: PointerEvent) => void;
}) {
  const layout = rulerLayout(size, view, artboard);
  const press = (orientation: RulerGuide['orientation']) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onPull(orientation, e.nativeEvent);
  };
  return (<>
    <Ruler
      orientation="horizontal"
      length={layout.horizontal.length}
      offset={view.x - layout.horizontal.left}
      zoom={view.zoom}
      style={{ left: layout.horizontal.left, top: layout.horizontal.top }}
      onPointerDown={press('horizontal')}
    />
    <Ruler
      orientation="vertical"
      length={layout.vertical.length}
      offset={view.y - layout.vertical.top}
      zoom={view.zoom}
      style={{ left: layout.vertical.left, top: layout.vertical.top }}
      onPointerDown={press('vertical')}
    />
    <div className="canvas-ruler-corner" style={{ left: layout.corner.left, top: layout.corner.top }} />
  </>);
}
