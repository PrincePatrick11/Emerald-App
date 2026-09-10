import { useCallback, useEffect, useRef } from 'react';

export type DrawMode = 'draw' | 'erase';

export const SIGIL_COLORS = ['#f8fafc', '#00e699', '#f59e0b', '#ef4444', '#60a5fa', '#a78bfa', '#111827'];

/**
 * Die Zeichenfläche der Sigille (1200×800, transparenter Grund) — aus der
 * früheren Sigillen-Ansicht übernommen. Sie meldet nach jedem Strich den
 * Stand als Data-URL; wohin er geht, entscheidet der Block. `initialData`
 * muss eine Data-URL sein: ein Bild über `emerald-img:` machte die Fläche
 * „tainted", und `toDataURL` schlüge danach fehl.
 */
export default function SigilDrawingCanvas({
  initialData,
  mode,
  brushColor,
  brushSize,
  clearVersion,
  editable,
  onChange,
}: {
  initialData: string | null;
  mode: DrawMode;
  brushColor: string;
  brushSize: number;
  clearVersion: number;
  editable: boolean;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastLoadedRef = useRef<string | null | undefined>(undefined);
  const lastClearVersionRef = useRef(clearVersion);

  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }, []);

  const loadImage = useCallback((dataUrl: string | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const img = new window.Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  }, []);

  useEffect(() => {
    if (lastLoadedRef.current === initialData) return;
    lastLoadedRef.current = initialData;
    loadImage(initialData);
  }, [initialData, loadImage]);

  useEffect(() => {
    if (lastClearVersionRef.current === clearVersion) return;
    lastClearVersionRef.current = clearVersion;
    clearCanvas();
    lastLoadedRef.current = null;
    onChange(null);
  }, [clearVersion, clearCanvas, onChange]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const stroke = (ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const point = getPoint(event);
    isDrawingRef.current = true;
    lastPointRef.current = point;
    // Wirft NotFoundError für Pointer-IDs ohne echte OS-Pointer-Session
    // (synthetische Events, exotische Eingabegeräte). Zeichnen geht auch ohne.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* siehe oben */
    }
    stroke(ctx, point, point);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || !isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const point = getPoint(event);
    stroke(ctx, lastPointRef.current ?? point, point);
    lastPointRef.current = point;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (isDrawingRef.current) {
      const dataUrl = canvas.toDataURL('image/png');
      lastLoadedRef.current = dataUrl;
      onChange(dataUrl);
    }
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  return (
    <div className="sigil-canvas-shell relative overflow-hidden rounded-xl border border-stone-700/50 bg-stone-950/80">
      <canvas
        ref={canvasRef}
        width={1200}
        height={800}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={`sigil-canvas relative block aspect-[3/2] w-full touch-none bg-transparent ${editable ? 'cursor-crosshair' : 'cursor-default'}`}
      />
    </div>
  );
}
