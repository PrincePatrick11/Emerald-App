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
 * Die Sigillen-Zeichnung. Gespeichert wird sie als Bilddatei (`saveImage`),
 * im Block steht nur ihr Dateiname — Base64 kommt nie in den Inhalt. Die
 * Rückgängig-Liste lebt nur im Speicher, solange bearbeitet wird;
 * Zwischenstände, die dabei als Datei entstehen, räumt „Unbenutzte Bilder
 * löschen" auf (Einstellungen → Speicher).
 *
 * Das Speichern ist asynchron:
 * - Es kann den Moduswechsel überdauern — kommt der Dateiname erst nach
 *   „Fertig" zurück, geht er über `onPersist` direkt in den Eintrag. Dieser
 *   Teil bleibt dafür über beide Modi montiert (der Stapel behält seinen Baum).
 * - Zwei schnelle Striche speichern parallel; nur das Ergebnis des jüngsten
 *   zählt (`seq`), sonst überschriebe ein spät fertiges älteres den neueren.
 * - Nach dem Abbau (anderer Eintrag, Abbrechen) wird nichts mehr geschrieben.
 */
export default function SigilCanvasBlock({ block, isEditing, onBlockChange, onPersist, sigil, part }: BlockViewProps) {
  const { t } = useTranslation();
  const filename = sigilImage(block);
  const [saveFailed, setSaveFailed] = useState(false);

  const latest = useRef({ block, isEditing, onBlockChange, onPersist });
  latest.current = { block, isEditing, onBlockChange, onPersist };
  // Im Effekt gesetzt, nicht nur im Aufräumen: React (StrictMode) montiert im
  // Entwicklungsmodus doppelt, und ein nur im Cleanup gesetztes `false` bliebe stehen.
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

  // Verborgen auch beim Bearbeiten — bei Sperre „nur Sigille" ist Bearbeiten erlaubt.
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

/** `startColor`/`startSize`: womit gezeichnet wird, bis man umstellt — ein eigener Block kann es vorgeben. */
function CanvasEditor({ filename, startColor, startSize, onDrawn }: {
  filename: string | null;
  startColor: string;
  startSize: number;
  onDrawn: (dataUrl: string | null) => void;
}) {
  const { t } = useTranslation();
  // Die Zeichnung, mit der geöffnet wurde — danach ist die Fläche selbst die Wahrheit.
  const [openedWith] = useState(filename);
  const [initial, setInitial] = useState<string | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>(openedWith ? 'loading' : 'ready');
  const [mode, setMode] = useState<DrawMode>('draw');
  const [color, setColor] = useState(startColor);
  const [size, setSize] = useState(startSize);
  const [clearVersion, setClearVersion] = useState(0);
  const [history, setHistory] = useState<History>({ steps: [null], index: 0 });

  // Die gespeicherte Zeichnung als Data-URL laden (siehe SigilDrawingCanvas).
  // Scheitert das, bleibt die Fläche gesperrt: der erste Strich speicherte
  // sonst eine leere Fläche über die echte Zeichnung.
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
        {/* Der Umschalter aus der früheren Sigillen-Ansicht, mit Parchment-Brücke
            (.sigil-tool-*) — bewusst kein Button: zwei Zustände eines Werkzeugs. */}
        <div className="sigil-tool-toggle flex items-center gap-1 rounded-lg border border-stone-700/40 bg-stone-800/70 p-1">
          {(['draw', 'erase'] as const).map((m) => {
            const Icon = m === 'draw' ? PenTool : Eraser;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`sigil-tool-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  mode === m ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
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
