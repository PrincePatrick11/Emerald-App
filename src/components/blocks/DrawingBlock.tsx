import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasEditor, layerImageRefs, loadLayerImages, paintOnlyProfile, renderPaintPng,
  type CanvasElement, type DrawingProps, type LayerImages,
} from '../editors/canvas';
import { canvasImageSrc, imageSrc, saveImage } from '../../lib/images';
import { parseDrawing, withDrawing } from '../../lib/blocks/paint';
import { discardRenders } from '../../store/imageStore';
import { emptyPaintDoc, isPaintDocEmpty, PAINT_HEIGHT, PAINT_WIDTH, type PaintDoc } from '../../lib/paint/document';
import type { BlockViewProps } from './blockViews';

// Strokes in quick succession are saved together, once the hand rests.
const SAVE_DELAY = 300;

/** What the drawing says in its own words: the paint block's, the sigil's. */
export interface DrawingTexts {
  empty: string;
  /** Shown above the picture while editing is not allowed (a loaded sigil). */
  locked: string;
  saveFailed: string;
  loadFailed: string;
}

/**
 * A drawing, painted in the canvas editor: the paint block, and the sigil
 * drawing, which puts its concealment around it. The block keeps the
 * vector document as its data and the rendered image as a stored file
 * (`saveImage`, see `parseDrawing`); base64 never enters the content.
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
export default function DrawingBlock({ block, isEditing, onBlockChange, onPersist, locked = false, palette, startColor, startSize, texts }: Pick<BlockViewProps, 'block' | 'isEditing' | 'onBlockChange' | 'onPersist'> & {
  /** Editing not allowed: the picture, with `texts.locked` above it while editing. */
  locked?: boolean;
  palette: readonly string[];
  startColor: string;
  startSize: number;
  texts: DrawingTexts;
}) {
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

  // Every picture rendered while editing goes when editing ends, the one the
  // block shows then and the one the entry was saved with excepted
  // (`discardRenders`): a stroke at a time would leave a file behind each.
  const made = useRef(new Set<string>());
  const wasEditing = useRef(isEditing);
  useEffect(() => {
    if (wasEditing.current && !isEditing) {
      const files = new Set(made.current);
      made.current.clear();
      // A render still on its way after Done lands in the block within the delay.
      discardRenders(files, () => parseDrawing(latest.current.block).render);
    }
    wasEditing.current = isEditing;
  }, [isEditing]);

  const store = useCallback(async (doc: PaintDoc, toPng: () => string) => {
    const mine = ++seq.current;
    const empty = isPaintDocEmpty(doc);
    let name: string | null = null;
    if (!empty) {
      try {
        name = await saveImage(toPng());
        made.current.add(name);
      } catch (e) {
        console.error('[DrawingBlock] save failed:', e);
        if (mounted.current && mine === seq.current) setSaveFailed(true);
        return;
      }
    }
    if (!mounted.current || mine !== seq.current) return;
    setSaveFailed(false);
    const { block: current, isEditing: editing, onBlockChange: change, onPersist: persist } = latest.current;
    const next = withDrawing(current, name, empty ? null : doc);
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

  if (!isEditing || locked) {
    const render = parseDrawing(block).render;
    return (
      <div className="space-y-2">
        {isEditing && <p className="block-field-hint">{texts.locked}</p>}
        {render
          ? <img src={imageSrc(render)} alt="" className="block-sigil-image" />
          : <p className="block-field-hint">{texts.empty}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <DrawingEditor
        block={block}
        palette={palette}
        startColor={startColor}
        startSize={startSize}
        loadFailed={texts.loadFailed}
        onChange={handleChange}
        onClose={flush}
      />
      {saveFailed && <p className="block-field-error">{texts.saveFailed}</p>}
    </div>
  );
}

/** The one element of a sigil drawing: the drawing over the whole artboard. */
const DRAWING_ID = 'sigil-drawing';

/**
 * The adapter between block and canvas editor: a scene of one drawing over
 * the whole artboard, fixed in the paint mode, so the editor is a plain paint
 * editor here (`paintOnlyProfile`). The document the block holds (an old
 * image as its first layer), the palette, and the brush it starts with (a
 * custom block's sigil part may set it).
 *
 * Layer images are loaded as data URLs first (`canvasImageSrc`): the PNG the
 * block stores is rendered from them, and a canvas with an `emerald-img`
 * source could not be read back. If one cannot be loaded the editor is not
 * shown, since its next save would lose that image.
 */
function DrawingEditor({ block, palette, startColor, startSize, loadFailed, onChange, onClose }: {
  block: BlockViewProps['block'];
  palette: readonly string[];
  startColor: string;
  loadFailed: string;
  startSize: number;
  onChange: (doc: PaintDoc, toPng: () => string) => void;
  onClose: () => void;
}) {
  // The drawing it was opened with; afterwards the editor itself is the truth.
  const [doc, setDoc] = useState(() => parseDrawing(block).doc ?? emptyPaintDoc());
  const [images, setImages] = useState<{ urls: Map<string, string>; loaded: LayerImages } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => onClose, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const refs = layerImageRefs(doc);
    Promise.all(refs.map(async (ref) => [ref, await canvasImageSrc(ref)] as const))
      .then(async (pairs) => {
        const urls = new Map(pairs);
        const loaded = await loadLayerImages(refs, async (ref) => urls.get(ref) ?? '');
        if (!cancelled) setImages({ urls, loaded });
      })
      .catch((e: unknown) => {
        console.error('[DrawingBlock] layer image failed to load:', e);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
    // Only the images the block opened with: new ones never come in while painting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profile = useMemo(
    () => paintOnlyProfile({ resolveImage: (ref) => images?.urls.get(ref) ?? '' }),
    [images],
  );
  const elements = useMemo<CanvasElement[]>(() => [{
    id: DRAWING_ID, type: 'drawing', x: PAINT_WIDTH / 2, y: PAINT_HEIGHT / 2, width: PAINT_WIDTH, height: PAINT_HEIGHT,
    rotation: 0, opacity: 1, locked: true, hidden: false, z: 0, props: { doc } satisfies DrawingProps,
  }], [doc]);

  const handleChange = useCallback((next: CanvasElement[]) => {
    const drawing = next.find((el) => el.id === DRAWING_ID);
    if (!drawing) return;
    const nextDoc = (drawing.props as DrawingProps).doc;
    setDoc(nextDoc);
    onChange(nextDoc, () => renderPaintPng(nextDoc, images?.loaded ?? new Map()));
  }, [onChange, images]);

  if (failed) return <p className="paint-error">{loadFailed}</p>;
  if (!images) return null;
  return (
    <CanvasEditor
      {...profile}
      layout="inline"
      width={PAINT_WIDTH}
      height={PAINT_HEIGHT}
      elements={elements}
      onChange={handleChange}
      selectedIds={NO_SELECTION}
      onSelectionChange={ignore}
      editable
      paintElementId={DRAWING_ID}
      historyKey={block.id}
      paint={{ ...profile.paint, palette: [...palette], startColor, startSize }}
      background={<div className="h-full w-full canvas-paper" />}
    />
  );
}

const NO_SELECTION: string[] = [];
const ignore = () => {};
