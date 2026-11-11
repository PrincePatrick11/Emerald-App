import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CANVAS_SWATCHES, CanvasEditor, canvasToDataUrl, fullProfile, parseCanvasBackground, renderCanvasImage,
  type CanvasBackground, type CanvasBackgroundImages, type CanvasEditorHandle, type CanvasElement, type CanvasPaintOptions,
  type CanvasTypes, type RulerGuide,
} from '../editors/canvas';
import {
  canvasElementFile, parseCanvasBlock, withCanvasScene, type CanvasParts, type CanvasScene, type StoredCanvasElement,
} from '../../lib/blocks/canvas';
import { canvasImageSrc, imageSrc, saveImage } from '../../lib/images';
import { altarBackgroundUrl } from '../../lib/altarBackground';
import { generateId } from '../../lib/helpers';
import { storedImageName } from '../../lib/schema';
import { fileBaseName, storeImageFromPath } from '../../lib/storeImage';
import { getImageDragItem, setImageDragItem, subscribeImageDrag, type ImageDragItem } from '../../lib/imageDragState';
import { DROPPED_IMAGE_RE, useFileDrop } from '../../hooks/useFileDrop';
import { useOwnSymbols } from '../../hooks/useOwnSymbols';
import { pickPictures, useImagePickerStore } from '../../store/imagePickerStore';
import { useImageStore } from '../../store/imageStore';
import { reportImageError, useImageNoticeStore } from '../../store/imageNoticeStore';
import ImageStrip from '../images/ImageStrip';
import type { BlockViewProps } from './blockViews';

// Changes in quick succession are saved together, once the hand rests.
const SAVE_DELAY = 400;
/** The width of the rendered picture the export and the card show. */
const RENDER_WIDTH = 1200;

/** The background picture: one of the app's own as it is, a stored one through `imageSrc`; chosen from "Images". */
const BACKGROUND_IMAGES: CanvasBackgroundImages = {
  resolve: altarBackgroundUrl,
  pick: async () => (await pickPictures({ multiple: false }))?.[0] ?? null,
};

/**
 * What the block offers in the canvas editor: everything, less the parts
 * switched off — their elements still draw and move, only nothing new of
 * them is added. Pictures come from the strip, not the tool column.
 */
function profileFor(parts: CanvasParts) {
  const profile = fullProfile();
  const types: CanvasTypes = { ...profile.types };
  const off = (type: string, on: boolean) => { if (!on && types[type]) types[type] = { ...types[type], additions: undefined }; };
  off('shape', parts.shapes);
  off('text', parts.text);
  off('symbol', parts.symbols);
  off('drawing', parts.drawing);
  return { ...profile, types };
}

/** A stored element as the canvas editor shows it: a picture's file as a URL. */
function toElement(stored: StoredCanvasElement): CanvasElement {
  if (stored.type !== 'image') return stored;
  const file = canvasElementFile(stored);
  return { ...stored, ...(file ? { ref: file } : {}), props: { emoji: '', ...stored.props, src: file ? imageSrc(file) : null } };
}

/** An element of the canvas editor as stored: a picture keeps its file, not the URL. */
function toStored(el: CanvasElement): StoredCanvasElement {
  const stored = { ...el, props: { ...(el.props as Record<string, unknown>) } } as StoredCanvasElement;
  if (el.type === 'image') stored.props.src = storedImageName(el.ref) ?? null;
  return stored;
}

/** A picture's natural proportions, or a square if it does not load. */
async function ratioOf(file: string): Promise<number> {
  const img = new Image();
  img.src = imageSrc(file);
  try {
    await img.decode();
    return img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
  } catch {
    return 1;
  }
}

/** A picture loaded for a canvas that is read back: as a data URL, never through `emerald-img`. */
async function loadReadable(src: string): Promise<HTMLImageElement | null> {
  const readable = await canvasImageSrc(src);
  if (!readable) return null;
  const img = new Image();
  img.src = readable;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** The scene as a stored picture, for the export and the card; `null` if it is empty or could not be stored. */
async function renderScene(scene: CanvasScene, types: CanvasTypes, background: CanvasBackground | null): Promise<string | null> {
  if (!scene.elements.length && !background) return null;
  const canvas = await renderCanvasImage({
    types,
    width: scene.width,
    height: scene.height,
    // Pictures by their file: `loadReadable` reads them as data URLs.
    elements: scene.elements.map((el) => ({ ...el, props: { emoji: '', ...el.props } })),
    outWidth: RENDER_WIDTH,
    background,
    loadImage: loadReadable,
  });
  const data = canvas ? await canvasToDataUrl(canvas, 'image/png') : null;
  return data ? saveImage(data) : null;
}

/**
 * The canvas block (`core.canvas`): pictures from "Images", shapes, text,
 * symbols and drawings on an artboard, in the canvas editor. In edit mode
 * "Images" stands beside it to drag from (or click, for the middle), and
 * files from the disk dropped on it go into "Images" and onto the canvas.
 * Read mode shows the scene itself, not the rendered picture.
 *
 * Saving: every change goes into the block at once; the rendered picture
 * follows once the hand rests, and only the latest render counts (`seq`).
 * The block stays mounted across both modes (the stack keeps its tree), so
 * a render that finishes after "Done" goes into the entry by `onPersist`.
 */
export default function CanvasBlock({ block, isEditing, onBlockChange, onPersist }: BlockViewProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseCanvasBlock(block), [block]);
  const { scene, parts } = parsed;
  const profile = useMemo(() => profileFor(parts), [parts]);
  const paint = useMemo<CanvasPaintOptions>(
    () => ({ ...profile.paint, palette: CANVAS_SWATCHES, startColor: CANVAS_SWATCHES[0], startSize: 8 }),
    [profile],
  );
  const symbolLibrary = useOwnSymbols();
  const editorRef = useRef<CanvasEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const editable = isEditing && !parsed.broken;

  const elements = useMemo(() => scene.elements.map(toElement), [scene.elements]);
  const background = useMemo(() => parseCanvasBackground(scene.background), [scene.background]);
  const guides = useMemo<RulerGuide[]>(() => scene.guides, [scene.guides]);

  const latest = useRef({ block, onBlockChange, onPersist, isEditing });
  latest.current = { block, onBlockChange, onPersist, isEditing };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The rendered picture, once the hand rests; a later change makes an earlier render moot.
  const seq = useRef(0);
  const timer = useRef(0);
  const scheduleRender = useCallback(() => {
    window.clearTimeout(timer.current);
    const mine = ++seq.current;
    timer.current = window.setTimeout(() => {
      const { scene: rendered } = parseCanvasBlock(latest.current.block);
      void renderScene(rendered, profile.types, parseCanvasBackground(rendered.background))
        .then((render) => {
          if (!mounted.current || mine !== seq.current) return;
          const { block: current, isEditing: editing, onBlockChange: change, onPersist: persist } = latest.current;
          // Only for the scene it shows: after Cancel the block holds another.
          const { scene } = parseCanvasBlock(current);
          if (JSON.stringify(scene) !== JSON.stringify(rendered)) return;
          // Done before the render was there: it goes straight into the entry.
          const next = withCanvasScene(current, scene, render);
          if (editing) change(next);
          else persist?.(next);
        })
        .catch((e: unknown) => console.error('[CanvasBlock] render failed:', e));
    }, SAVE_DELAY);
  }, [profile.types]);

  /** A new scene into the block now; the old render stays until the new one is there. */
  const commit = useCallback((patch: Partial<CanvasScene>) => {
    const { block: current, onBlockChange: change } = latest.current;
    const now = parseCanvasBlock(current);
    if (now.broken) return;
    change(withCanvasScene(current, { ...now.scene, ...patch }, now.render));
    scheduleRender();
  }, [scheduleRender]);

  const handleChange = useCallback((next: CanvasElement[]) => commit({ elements: next.map(toStored) }), [commit]);
  const onCanvasBackgroundChange = useCallback((next: CanvasBackground) => commit({ background: next }), [commit]);
  const onGuidesChange = useCallback((next: RulerGuide[]) => commit({ guides: next }), [commit]);
  const onGuidesLockedChange = useCallback((locked: boolean) => commit({ guidesLocked: locked }), [commit]);

  /** A picture of "Images" onto the canvas, centred on `at` (artboard pixels), and selected. */
  const place = useCallback(async (file: string, at: { x: number; y: number }) => {
    const ratio = await ratioOf(file);
    const now = parseCanvasBlock(latest.current.block);
    const side = Math.min(now.scene.width, now.scene.height) / 3;
    const width = ratio >= 1 ? side : side * ratio;
    const height = ratio >= 1 ? side / ratio : side;
    const id = generateId();
    const z = Math.max(0, ...now.scene.elements.map((el) => el.z + 1));
    const element: StoredCanvasElement = {
      id, type: 'image', x: at.x, y: at.y, width, height, rotation: 0, opacity: 1, locked: false, hidden: false, z,
      ref: file, props: { src: file, emoji: '' },
    };
    commit({ elements: [...now.scene.elements, element] });
    setSelectedIds([id]);
  }, [commit]);

  const pointOnArtboard = useCallback((clientX: number, clientY: number) => {
    const point = editorRef.current?.clientToArtboard(clientX, clientY);
    if (!point || point.x < 0 || point.y < 0 || point.x > scene.width || point.y > scene.height) return null;
    return point;
  }, [scene.width, scene.height]);

  // Pictures dragged out of the strip: a pointer drag on a channel, since the
  // WebView has no HTML5 drag and drop.
  const [dragItem, setDragItem] = useState<ImageDragItem | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => subscribeImageDrag(setDragItem), []);
  useEffect(() => {
    if (!editable || !dragItem) { setGhost(null); return; }
    const onMove = (e: PointerEvent) => setGhost({ x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const item = getImageDragItem();
      setImageDragItem(null);
      const point = item ? pointOnArtboard(e.clientX, e.clientY) : null;
      if (item && point) void place(item.file, point);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [editable, dragItem, pointOnArtboard, place]);

  // Files from the disk let go over the canvas: into "Images", under their
  // file name, and onto the canvas where they were let go, side by side.
  // The text editors around leave them alone (`data-file-drop`).
  const pickerOpen = useImagePickerStore((s) => !!s.request);
  useFileDrop(editable && !pickerOpen, (paths, point) => {
    const over = document.elementFromPoint(point.x, point.y);
    if (!over || !rootRef.current?.contains(over)) return;
    const at = pointOnArtboard(point.x, point.y) ?? editorRef.current?.visibleCentre();
    if (!at) return;
    const images = paths.filter((p) => DROPPED_IMAGE_RE.test(p));
    if (images.length < paths.length) useImageNoticeStore.getState().show({ kind: 'format' });
    void (async () => {
      let offset = 0;
      for (const path of images) {
        try {
          const file = await storeImageFromPath(path);
          await useImageStore.getState().saveDetails(file, { name: fileBaseName(path) });
          await place(file, { x: at.x + offset, y: at.y + offset });
          offset += 32;
        } catch (e) {
          reportImageError(e, `canvas drop ${path}`);
        }
      }
    })();
  });

  if (parsed.broken) return <p className="block-field-error">{t('blocks.canvas.broken')}</p>;
  if (!isEditing && !elements.length && !background) return <p className="block-field-hint">{t('blocks.canvas.empty')}</p>;

  return (
    <div ref={rootRef} className={editable && parts.images ? 'canvas-block canvas-block--strip' : 'canvas-block'} data-file-drop={editable ? '' : undefined}>
      <div className="canvas-block-stage">
        <CanvasEditor
          ref={editorRef}
          types={profile.types}
          features={profile.features}
          paint={paint}
          layout="inline"
          width={scene.width}
          height={scene.height}
          elements={elements}
          onChange={handleChange}
          selectedIds={editable ? selectedIds : NO_SELECTION}
          onSelectionChange={setSelectedIds}
          editable={editable}
          historyKey={block.id}
          readAlign="top"
          createId={generateId}
          guides={guides}
          onGuidesChange={onGuidesChange}
          guidesLocked={scene.guidesLocked}
          onGuidesLockedChange={onGuidesLockedChange}
          canvasBackground={background}
          onCanvasBackgroundChange={onCanvasBackgroundChange}
          backgroundImages={BACKGROUND_IMAGES}
          symbolLibrary={symbolLibrary}
          background={background ? undefined : <div className="h-full w-full canvas-paper" />}
          overlay={editable && dragItem ? (
            <>
              <div className="canvas-drop-hint" />
              {ghost && createPortal(
                <img
                  src={imageSrc(dragItem.file)}
                  alt=""
                  className="fixed pointer-events-none z-50 w-12 h-12 object-contain opacity-75"
                  style={{ left: ghost.x, top: ghost.y, transform: 'translate(-50%, -50%)' }}
                />,
                document.body,
              )}
            </>
          ) : null}
        />
      </div>
      {editable && parts.images && (
        <div className="canvas-block-side">
          <ImageStrip onPick={(item) => {
            const centre = editorRef.current?.visibleCentre();
            if (centre) void place(item.file, centre);
          }} />
        </div>
      )}
    </div>
  );
}

const NO_SELECTION: string[] = [];
