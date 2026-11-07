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

/** A span along a ruler, in artboard pixels. */
interface Span { from: number; to: number }

/** One ruler: ticks and numbers in artboard pixels, following the view, with the selection's span and the guides marked. */
function Ruler({ orientation, length, offset, zoom, selection, guides, style, onPointerDown }: {
  orientation: 'horizontal' | 'vertical';
  /** Screen pixels along the ruler. */
  length: number;
  /** Where the artboard's 0 is, in screen pixels from the ruler's start. */
  offset: number;
  zoom: number;
  selection: Span | null;
  /** Where guides of this ruler's direction cross it. */
  guides: number[];
  style: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const horizontal = orientation === 'horizontal';
  const guideKey = guides.join(',');
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
    const accent = readToken(canvas, '--accent', '#00c47f');
    const at = (v: number) => v * zoom + offset;
    // Draws along the ruler as if it lay horizontally: `p` along it, `d` from its outer side.
    const line = (p: number, d0: number, d1: number) => {
      if (horizontal) { ctx.moveTo(p, d0); ctx.lineTo(p, d1); } else { ctx.moveTo(d0, p); ctx.lineTo(d1, p); }
    };

    if (selection) {
      const a = Math.round(at(selection.from)), b = Math.round(at(selection.to));
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = accent;
      if (horizontal) ctx.fillRect(a, 0, b - a, h); else ctx.fillRect(0, a, w, b - a);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      line(a + 0.5, 0, RULER_SIZE);
      line(b - 0.5, 0, RULER_SIZE);
      ctx.stroke();
    }

    const step = tickStep(zoom);
    // Tenths when they stay apart on screen, else fifths.
    const minor = step * zoom >= 80 ? step / 10 : step / 5;
    const first = Math.floor(-offset / zoom / minor) * minor;
    const onStep = (v: number, s: number) => Math.abs(v / s - Math.round(v / s)) < 1e-6;
    ctx.strokeStyle = readToken(canvas, '--text-subtle', '#888');
    ctx.fillStyle = readToken(canvas, '--text-muted', '#999');
    ctx.font = '500 9px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = first; at(v) <= length; v += minor) {
      const p = Math.round(at(v)) + 0.5;
      const major = onStep(v, step);
      const half = !major && minor < step / 5 && onStep(v, step / 2);
      const tick = major ? RULER_SIZE * 0.55 : half ? RULER_SIZE * 0.35 : RULER_SIZE * 0.2;
      line(p, RULER_SIZE - tick, RULER_SIZE);
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
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The guides, as small notches on the stage's side.
    if (guides.length) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      for (const g of guides) {
        const p = Math.round(at(g)) + 0.5;
        if (horizontal) { ctx.moveTo(p - 4, RULER_SIZE); ctx.lineTo(p + 4, RULER_SIZE); ctx.lineTo(p, RULER_SIZE - 5); } else { ctx.moveTo(RULER_SIZE, p - 4); ctx.lineTo(RULER_SIZE, p + 4); ctx.lineTo(RULER_SIZE - 5, p); }
        ctx.closePath();
      }
      ctx.fill();
    }

    // The edge toward the stage.
    ctx.strokeStyle = readToken(canvas, '--edge-strong', '#666');
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); } else { ctx.moveTo(w - 0.5, 0); ctx.lineTo(w - 0.5, h); }
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the guides by their positions
  }, [horizontal, length, offset, zoom, selection?.from, selection?.to, guideKey]);
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
 * the top ruler a horizontal one, from the left a vertical one. The span of
 * the selection and where the guides lie are marked on them.
 */
export default function Rulers({ size, view, artboard, selection, guides, onPull }: {
  size: { width: number; height: number };
  view: { zoom: number; x: number; y: number };
  artboard: { width: number; height: number };
  /** The box around what is selected, marked on both rulers. */
  selection: { x: number; y: number; width: number; height: number } | null;
  guides: readonly RulerGuide[];
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
      selection={selection && { from: selection.x, to: selection.x + selection.width }}
      guides={guides.filter((g) => g.orientation === 'vertical').map((g) => g.at)}
      style={{ left: layout.horizontal.left, top: layout.horizontal.top }}
      onPointerDown={press('horizontal')}
    />
    <Ruler
      orientation="vertical"
      length={layout.vertical.length}
      offset={view.y - layout.vertical.top}
      zoom={view.zoom}
      selection={selection && { from: selection.y, to: selection.y + selection.height }}
      guides={guides.filter((g) => g.orientation === 'horizontal').map((g) => g.at)}
      style={{ left: layout.vertical.left, top: layout.vertical.top }}
      onPointerDown={press('vertical')}
    />
    <div className="canvas-ruler-corner" style={{ left: layout.corner.left, top: layout.corner.top }} />
  </>);
}
