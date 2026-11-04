import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser, PenTool, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import Button from '../ui/Button';
import { imageSrc, readImageAsBase64, saveImage } from '../../lib/images';
import { sigilImage, withSigilImage } from '../../lib/blocks/sigil';
import SigilDrawingCanvas, { SIGIL_COLORS, type DrawMode } from './SigilDrawingCanvas';
import SigilConcealed from './SigilConcealed';
import { DEFAULT_BRUSH_SIZE, SigilBrushSize, SigilColorSwatches } from './SigilBrushControls';
import type { BlockViewProps } from './blockViews';

/**
 * The sigil drawing. It is stored as an image file (`saveImage`),
 * the block holds only its file name; base64 never enters the content. The
 * undo list lives only in memory while editing;
 * intermediate states that arise as files in the process are cleaned up by "Delete
 * unused images" (Settings → Storage).
 *
 * Saving is asynchronous:
 * - It can outlast the mode switch: if the file name only comes back after
 *   "Done", it goes directly into the entry via `onPersist`. This
 *   part therefore stays mounted across both modes (the stack keeps its tree).
 * - Two quick strokes save in parallel; only the result of the most recent one
 *   counts (`seq`), otherwise an older one finishing late would overwrite the newer.
 * - After teardown (other entry, cancel) nothing is written any more.
 */
export default function SigilCanvasBlock({ block, isEditing, onBlockChange, onPersist, sigil, part }: BlockViewProps) {
  const { t } = useTranslation();
  const filename = sigilImage(block);
  const [saveFailed, setSaveFailed] = useState(false);

  const latest = useRef({ block, isEditing, onBlockChange, onPersist });
  latest.current = { block, isEditing, onBlockChange, onPersist };
  // Set in the effect, not only in cleanup: React (StrictMode) mounts twice in
  // development mode, and a `false` set only in cleanup would stick.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const seq = useRef(0);

  const store = useCallback(async (dataUrl: string | null) => {
    const mine = ++seq.current;
    let name: string | null = null;
    if (dataUrl) {
      try {
        name = await saveImage(dataUrl);
      } catch (e) {
        console.error('[SigilCanvasBlock] save failed:', e);
        if (mounted.current && mine === seq.current) setSaveFailed(true);
        return;
      }
    }
    if (!mounted.current || mine !== seq.current) return;
    setSaveFailed(false);
    const { block: current, isEditing: editing, onBlockChange: change, onPersist: persist } = latest.current;
    const next = withSigilImage(current, name);
    if (editing) change(next);
    else persist?.(next);
  }, []);

  // Hidden when editing too; with the lock "sigil only", editing is allowed.
  if (sigil.concealed.has(block.id)) return <SigilConcealed revealDate={sigil.concealed.get(block.id) ?? null} />;
  if (!isEditing || sigil.locked.has(block.id)) {
    return (
      <div className="space-y-2">
        {isEditing && <p className="block-field-hint">{t('blocks.sigil.locked')}</p>}
        {filename
          ? <img src={imageSrc(filename)} alt="" className="block-sigil-image" />
          : <p className="block-field-hint">{t('blocks.sigil.emptyDrawing')}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <CanvasEditor
        filename={filename}
        startColor={part?.brushColor ?? SIGIL_COLORS[0]}
        startSize={part?.brushSize ?? DEFAULT_BRUSH_SIZE}
        onDrawn={(dataUrl) => void store(dataUrl)}
      />
      {saveFailed && <p className="block-field-error">{t('blocks.sigil.saveFailed')}</p>}
    </div>
  );
}

interface History {
  steps: (string | null)[];
  index: number;
}

/** `startColor`/`startSize`: what is drawn with until you switch; a custom block can specify it. */
function CanvasEditor({ filename, startColor, startSize, onDrawn }: {
  filename: string | null;
  startColor: string;
  startSize: number;
  onDrawn: (dataUrl: string | null) => void;
}) {
  const { t } = useTranslation();
  // The drawing it was opened with; afterwards the canvas itself is the truth.
  const [openedWith] = useState(filename);
  const [initial, setInitial] = useState<string | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>(openedWith ? 'loading' : 'ready');
  const [mode, setMode] = useState<DrawMode>('draw');
  const [color, setColor] = useState(startColor);
  const [size, setSize] = useState(startSize);
  const [clearVersion, setClearVersion] = useState(0);
  const [history, setHistory] = useState<History>({ steps: [null], index: 0 });

  // Load the saved drawing as a data URL (see SigilDrawingCanvas).
  // If that fails, the canvas stays locked: the first stroke would
  // otherwise save an empty canvas over the real drawing.
  useEffect(() => {
    if (!openedWith) return;
    let cancelled = false;
    readImageAsBase64(openedWith)
      .then((dataUrl) => {
        if (cancelled) return;
        setInitial(dataUrl);
        setHistory({ steps: [null, dataUrl], index: 1 });
        setLoad('ready');
      })
      .catch((e: unknown) => {
        console.error('[SigilCanvasBlock] load failed:', e);
        if (!cancelled) setLoad('failed');
      });
    return () => { cancelled = true; };
  }, [openedWith]);

  const handleChange = useCallback((dataUrl: string | null) => {
    setHistory(({ steps, index }) => {
      const trimmed = steps.slice(0, index + 1);
      if (trimmed[trimmed.length - 1] === dataUrl) return { steps: trimmed, index: trimmed.length - 1 };
      return { steps: [...trimmed, dataUrl], index: trimmed.length };
    });
    onDrawn(dataUrl);
  }, [onDrawn]);

  const step = (to: number) => {
    if (to < 0 || to >= history.steps.length) return;
    setHistory((h) => ({ ...h, index: to }));
    setInitial(history.steps[to]);
    onDrawn(history.steps[to]);
  };

  if (load === 'failed') return <p className="block-field-error">{t('blocks.sigil.loadFailed')}</p>;

  return (
    <div className="space-y-3">
      <SigilDrawingCanvas
        initialData={initial}
        mode={mode}
        brushColor={color}
        brushSize={size}
        clearVersion={clearVersion}
        editable={load === 'ready'}
        onChange={handleChange}
      />
      <div className="flex flex-wrap items-center gap-3">
        {/* The toggle from the former sigil view, with a parchment bridge
            (.sigil-tool-*); deliberately not a Button: two states of one tool. */}
        <div className="sigil-tool-toggle flex items-center gap-1 rounded-lg border border-edge bg-well-strong p-1">
          {(['draw', 'erase'] as const).map((m) => {
            const Icon = m === 'draw' ? PenTool : Eraser;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`sigil-tool-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  mode === m ? 'bg-well-active text-primary' : 'text-muted hover:text-secondary'
                }`}
              >
                <Icon size={12} />
                {t(`creation.tools.${m}`)}
              </button>
            );
          })}
        </div>
        <SigilBrushSize value={size} onChange={setSize} />
        <Button tone="neutral" small disabled={history.index <= 0} onClick={() => step(history.index - 1)}>
          <Undo2 size={12} />
          <span>{t('creation.undo')}</span>
        </Button>
        <Button tone="neutral" small disabled={history.index >= history.steps.length - 1} onClick={() => step(history.index + 1)}>
          <Redo2 size={12} />
          <span>{t('creation.redo')}</span>
        </Button>
        <Button tone="neutral" small onClick={() => setClearVersion((v) => v + 1)}>
          <RotateCcw size={12} />
          <span>{t('creation.clear')}</span>
        </Button>
      </div>
      <SigilColorSwatches value={color} onChange={setColor} />
    </div>
  );
}
