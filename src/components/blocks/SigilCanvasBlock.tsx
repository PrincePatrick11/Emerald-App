import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaintEditor } from '../editors/paint';
import { imageSrc, saveImage } from '../../lib/images';
import { parseSigilDrawing, withSigilDrawing } from '../../lib/blocks/sigil';
import { emptyPaintDoc, isPaintDocEmpty, type PaintDoc } from '../../lib/paint/document';
import SigilConcealed from './SigilConcealed';
import { DEFAULT_BRUSH_SIZE, SIGIL_COLORS } from './SigilBrushControls';
import type { BlockViewProps } from './blockViews';

// Strokes in quick succession are saved together, once the hand rests.
const SAVE_DELAY = 300;

/**
 * The sigil drawing, edited with the paint editor. The block keeps the
 * vector document as its data and the rendered image as a stored file
 * (`saveImage`, see `parseSigilDrawing`); base64 never enters the content.
 * The undo list lives only in the editor while editing; rendered images
 * that were saved in between are cleaned up by "Delete unused images"
 * (Settings → Storage).
 *
 * Saving is asynchronous:
 * - It can outlast the mode switch: the editor hands over what is still
 *   waiting when it closes, and if the file name only comes back after
 *   "Done", the drawing goes directly into the entry via `onPersist`. This
 *   part therefore stays mounted across both modes (the stack keeps its tree).
 * - Two saves may run in parallel; only the result of the most recent one
 *   counts (`seq`), otherwise an older one finishing late would overwrite the newer.
 * - After teardown (other entry, cancel) nothing is written any more.
 */
export default function SigilCanvasBlock({ block, isEditing, onBlockChange, onPersist, sigil, part }: BlockViewProps) {
  const { t } = useTranslation();
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

  const store = useCallback(async (doc: PaintDoc, toPng: () => string) => {
    const mine = ++seq.current;
    const empty = isPaintDocEmpty(doc);
    let name: string | null = null;
    if (!empty) {
      try {
        name = await saveImage(toPng());
      } catch (e) {
        console.error('[SigilCanvasBlock] save failed:', e);
        if (mounted.current && mine === seq.current) setSaveFailed(true);
        return;
      }
    }
    if (!mounted.current || mine !== seq.current) return;
    setSaveFailed(false);
    const { block: current, isEditing: editing, onBlockChange: change, onPersist: persist } = latest.current;
    const next = withSigilDrawing(current, name, empty ? null : doc);
    if (editing) change(next);
    else persist?.(next);
  }, []);

  const waiting = useRef<{ doc: PaintDoc; toPng: () => string } | null>(null);
  const timer = useRef(0);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const next = waiting.current;
    waiting.current = null;
    // The PNG is rendered now, while the editor and its images are still there.
    if (next) void store(next.doc, next.toPng);
  }, [store]);
  const handleChange = useCallback((doc: PaintDoc, toPng: () => string) => {
    waiting.current = { doc, toPng };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  // Hidden when editing too; with the lock "sigil only", editing is allowed.
  if (sigil.concealed.has(block.id)) return <SigilConcealed revealDate={sigil.concealed.get(block.id) ?? null} />;
  if (!isEditing || sigil.locked.has(block.id)) {
    const render = parseSigilDrawing(block).render;
    return (
      <div className="space-y-2">
        {isEditing && <p className="block-field-hint">{t('blocks.sigil.locked')}</p>}
        {render
          ? <img src={imageSrc(render)} alt="" className="block-sigil-image" />
          : <p className="block-field-hint">{t('blocks.sigil.emptyDrawing')}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <CanvasEditor
        block={block}
        startColor={part?.brushColor ?? SIGIL_COLORS[0]}
        startSize={part?.brushSize ?? DEFAULT_BRUSH_SIZE}
        onChange={handleChange}
        onClose={flush}
      />
      {saveFailed && <p className="block-field-error">{t('blocks.sigil.saveFailed')}</p>}
    </div>
  );
}

/** `startColor`/`startSize`: what is drawn with until you switch; a custom block can specify it. */
function CanvasEditor({ block, startColor, startSize, onChange, onClose }: {
  block: BlockViewProps['block'];
  startColor: string;
  startSize: number;
  onChange: (doc: PaintDoc, toPng: () => string) => void;
  onClose: () => void;
}) {
  // The drawing it was opened with; afterwards the editor itself is the truth.
  const [initial] = useState(() => parseSigilDrawing(block).doc ?? emptyPaintDoc());
  useEffect(() => onClose, [onClose]);
  return (
    <PaintEditor
      initial={initial}
      onChange={onChange}
      palette={SIGIL_COLORS}
      startColor={startColor}
      startSize={startSize}
    />
  );
}
