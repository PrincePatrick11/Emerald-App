import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CANVAS_SWATCHES, CanvasEditor, canvasToDataUrl, fullProfile, parseCanvasBackground, renderCanvasImage, renderCanvasSvg,
  type CanvasBackground, type CanvasEditorHandle, type CanvasElement, type CanvasExportOptions,
  type CanvasPaintOptions, type CanvasTypes, type RulerGuide,
} from '../editors/canvas';
import { drawingDoc, sceneRenderOptions, scenePicture } from './canvasScene';
import {
  CANVAS_BLOCK_TYPE, canvasElementFile, parseCanvasBlock, storedCanvasElement, storedImageElement, withCanvasScene, withCanvasStripTag, type CanvasParts, type CanvasScene, type StoredCanvasElement,
} from '../../lib/blocks/canvas';
import { imageSrc, saveImage } from '../../lib/images';
import { generateId } from '../../lib/helpers';
import { acceptedImagePaths } from '../../lib/storeImage';
import { getImageDragItem, setImageDragItem, subscribeImageDrag, type ImageDragItem } from '../../lib/imageDragState';
import { useFileDrop } from '../../hooks/useFileDrop';
import { useImportWindowStore } from '../../store/importWindowStore';
import { useOwnSymbols } from '../../hooks/useOwnSymbols';
import { pickPictures, useImagePickerStore } from '../../store/imagePickerStore';
import { discardRenders } from '../../store/imageStore';
import { savePictureAs, textDataUrl } from '../../lib/pictureExport';
import { exportErrorMessage } from '../../lib/export';
import { reportImageError } from '../../store/imageNoticeStore';
import { useTagStore } from '../../store/tagStore';
import ImageStrip from '../images/ImageStrip';
import AddImagesModal from '../images/AddImagesModal';
import { resolveBlockType } from '../../lib/blocks/blockTypes';
import { SAVE_PICTURE_ACTION } from '../../lib/blocks/kinds/canvas';
import { blockTypeTextKey } from '../../lib/blocks/toolkit';
import { BLOCK_BACKGROUND_IMAGES, storeBlockPicture, useBlockAction, useBlockStorage } from './toolkit';
import type { BlockViewProps } from './blockViews';

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

/** A stored element as the canvas editor shows it: a picture's file as a URL, a drawing's document read. */
function toElement(stored: StoredCanvasElement): CanvasElement {
  if (stored.type === 'drawing') return { ...stored, props: { ...stored.props, doc: drawingDoc(stored.props.doc) } };
  if (stored.type !== 'image') return stored;
  const file = canvasElementFile(stored);
  return { ...stored, ...(file ? { ref: file } : {}), props: { emoji: '', ...stored.props, src: file ? imageSrc(file) : null } };
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

/** The scene as a stored picture, for the export and the card; `null` if it is empty or could not be stored. */
async function renderScene(scene: CanvasScene, types: CanvasTypes): Promise<string | null> {
  const data = await scenePicture(scene, types);
  return data ? saveImage(data) : null;
}

/** JPEG export quality: visually the same as 0.95, a good quarter smaller. */
const JPEG_EXPORT_QUALITY = 0.9;

/** The scene as the export dialog asked: format, area, width, background; a JPEG on white. */
async function exportedScene(scene: CanvasScene, types: CanvasTypes, options: CanvasExportOptions): Promise<string | null> {
  const background = options.background ? parseCanvasBackground(scene.background) : null;
  const render = { ...sceneRenderOptions(scene, types, background, options.width), region: options.region ?? undefined };
  if (options.format === 'svg') return textDataUrl(await renderCanvasSvg(render), 'image/svg+xml');
  const canvas = await renderCanvasImage(render);
  if (!canvas) return null;
  if (options.format === 'png') return canvasToDataUrl(canvas, 'image/png');
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return canvasToDataUrl(flat, 'image/jpeg', JPEG_EXPORT_QUALITY);
}

/**
 * The canvas block (`core.canvas`) and the altar (`core.altar`): pictures
 * from "Images", shapes, text, symbols and drawings on an artboard, in the
 * canvas editor. Pictures come in by the tool column's button (the picture
 * picker); with the part `images` on — an altar's default — "Images" stands
 * below in edit mode to drag from (or click, for the middle), and
 * files from the disk dropped on it go into "Images" and onto the canvas.
 * The strip starts on the type's storage tag (the altar's "Altar Library",
 * `BlockTypeDef.storage`). Read mode shows the scene itself, not the
 * rendered picture. "Save as picture" is the type's action, in the block's
 * menu and the properties panel; it opens the canvas editor's export dialog.
 *
 * Saving: every change goes into the block at once; the rendered picture
 * for the export is made on "Done" if the scene changed, and goes into the
 * entry by `onPersist` (the block stays mounted across both modes); the
 * picture it replaces is removed unless something else still shows it.
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
  const editable = isEditing;

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

  // The rendered picture, made once editing ends with "Done": a render per
  // change would leave a file behind each time. The scene editing started
  // from tells Done (changed) from Cancel (back as it was, or remounted).
  const startScene = useRef<string | null>(null);
  useEffect(() => {
    if (isEditing) {
      startScene.current = JSON.stringify(parseCanvasBlock(latest.current.block).scene);
      return;
    }
    const from = startScene.current;
    startScene.current = null;
    if (from === null) return;
    const { block: current, onPersist: persist } = latest.current;
    const now = parseCanvasBlock(current);
    // Unchanged needs no new picture — unless it has none yet (an altar converted from before).
    if (!persist || (JSON.stringify(now.scene) === from && now.render)) return;
    void renderScene(now.scene, profile.types)
      .then(async (render) => {
        const { block: latestBlock, isEditing: editing, onPersist: save } = latest.current;
        // Editing again, or the scene changed meanwhile: that edit renders anew.
        if (!mounted.current || editing || !save) return;
        const { scene: shown, render: before } = parseCanvasBlock(latestBlock);
        if (JSON.stringify(shown) !== JSON.stringify(now.scene) || render === before) return;
        save(withCanvasScene(latestBlock, shown, render));
        // The picture it replaces, once the entry is saved, unless something still shows it.
        if (before) discardRenders([before], () => parseCanvasBlock(latest.current.block).render);
      })
      .catch((e: unknown) => console.error('[CanvasBlock] render failed:', e));
    // Only the switch between the modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  /** A new scene into the block now; the render follows on Done. */
  const commit = useCallback((patch: Partial<CanvasScene>) => {
    const { block: current, onBlockChange: change } = latest.current;
    const now = parseCanvasBlock(current);
    const next = withCanvasScene(current, { ...now.scene, ...patch }, now.render);
    // Seen at once by the next change, before the stack has rendered it (several pictures in a row).
    latest.current = { ...latest.current, block: next };
    change(next);
  }, []);

  const handleChange = useCallback((next: CanvasElement[]) => commit({ elements: next.map(storedCanvasElement) }), [commit]);
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
    const element = storedImageElement(file, { id, x: at.x, y: at.y, width, height, z });
    commit({ elements: [...now.scene.elements, element] });
    setSelectedIds([id]);
  }, [commit]);

  // The strip's tag, saved with the block ('' for all; a tag gone since
  // counts as none; none chosen yet: the type's storage tag). Pictures added here carry it.
  const storage = useBlockStorage(block);
  const storageTag = storage?.tagId ?? '';
  const ensureStorageTag = storage?.ensure;
  const stripTag = parsed.stripTag ?? storageTag;
  const tagLive = useTagStore((s) => s.tags.some((x) => x.id === stripTag));
  const activeTag = parts.images && tagLive ? stripTag : '';
  const setStripTag = useCallback((tag: string) => {
    const { block: current, onBlockChange: change } = latest.current;
    const next = withCanvasStripTag(current, tag);
    latest.current = { ...latest.current, block: next };
    change(next);
  }, []);
  // The tag of pictures added here: the strip's. The type's storage tag
  // that this vault does not have yet is made with the first of them.
  const tagForNew = useCallback(async (): Promise<string> => {
    if (activeTag) return activeTag;
    if (!parts.images || !ensureStorageTag || stripTag !== storageTag) return '';
    const tag = await ensureStorageTag();
    setStripTag(tag);
    return tag;
  }, [activeTag, parts.images, stripTag, storageTag, ensureStorageTag, setStripTag]);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);

  // The editor's export dialog: the scene as a file where the user chooses, named after the block's type.
  const exportPicture = useCallback((options: CanvasExportOptions) => {
    const { block: current } = latest.current;
    const labelKey = resolveBlockType(current)?.labelKey ?? blockTypeTextKey(CANVAS_BLOCK_TYPE, 'label');
    void exportedScene(parseCanvasBlock(current).scene, profile.types, options)
      .then((dataUrl) => {
        if (!dataUrl) throw new Error('rendering the picture failed');
        return savePictureAs(dataUrl, options.format, t(labelKey));
      })
      .catch((e: unknown) => exportErrorMessage(e, 'canvas'));
  }, [profile.types, t]);
  // "Save as picture" from the block's menu or the properties panel: the export dialog.
  useBlockAction(block.id, SAVE_PICTURE_ACTION, () => editorRef.current?.openExport());

  // The tool column's button: pictures from "Images" or the disk (the picture
  // picker, which gives the ones from the disk the strip's tag), in the
  // middle of what is visible, side by side.
  const insertImages = useCallback(async () => {
    const files = await pickPictures({ multiple: true, tags: activeTag ? [activeTag] : [] });
    const centre = editorRef.current?.visibleCentre();
    if (!files?.length || !centre) return;
    let offset = 0;
    for (const file of files) {
      await place(file, { x: centre.x + offset, y: centre.y + offset });
      offset += 32;
    }
  }, [place, activeTag]);

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
      // Every canvas of the page listens: the channel empties only once all
      // of them have looked, so the one under the pointer still gets the picture.
      window.setTimeout(() => setImageDragItem(null), 0);
      const point = item ? pointOnArtboard(e.clientX, e.clientY) : null;
      if (item && point) void place(item.file, point);
    };
    // A touch that turns into a scroll of the strip ends here: the drag is off.
    const onCancel = () => window.setTimeout(() => setImageDragItem(null), 0);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }, [editable, dragItem, pointOnArtboard, place]);

  // Files from the disk let go over the canvas: into "Images", under their
  // file name (with the strip's tag), and onto the canvas where they were
  // let go, side by side. The text editors around leave them alone
  // (`data-file-drop`). While the strip's add dialog is open, they go there; while the import window is open, they are its.
  const pickerOpen = useImagePickerStore((s) => !!s.request);
  const importOpen = useImportWindowStore((s) => s.open);
  const { dragOver } = useFileDrop(editable && !pickerOpen && !importOpen, (paths, point) => {
    if (adding) {
      setDropped((list) => [...list, ...paths]);
      return;
    }
    const over = document.elementFromPoint(point.x, point.y);
    if (!over || !rootRef.current?.contains(over)) return;
    const at = pointOnArtboard(point.x, point.y) ?? editorRef.current?.visibleCentre();
    if (!at) return;
    const images = acceptedImagePaths(paths);
    void (async () => {
      const tag = images.length ? await tagForNew() : '';
      let offset = 0;
      for (const path of images) {
        try {
          const file = await storeBlockPicture(path, tag ? [tag] : []);
          await place(file, { x: at.x + offset, y: at.y + offset });
          offset += 32;
        } catch (e) {
          reportImageError(e, `canvas drop ${path}`);
        }
      }
    })();
  });

  if (!isEditing && !elements.length && !background) return <p className="block-field-hint">{t('blocks.canvas.empty')}</p>;

  return (
    <div ref={rootRef} className="canvas-block" data-file-drop={editable ? '' : undefined}>
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
          backgroundImages={BLOCK_BACKGROUND_IMAGES}
          symbolLibrary={symbolLibrary}
          onInsertImage={editable ? () => void insertImages() : undefined}
          onExport={exportPicture}
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
        <ImageStrip
          tag={activeTag}
          onTagChange={setStripTag}
          onAdd={() => void tagForNew().then((tag) => setAdding(tag ? [tag] : []))}
          onPick={(item) => {
            const centre = editorRef.current?.visibleCentre();
            if (centre) void place(item.file, centre);
          }}
        />
      )}
      {adding && (
        <AddImagesModal
          dropped={dropped}
          dragOver={dragOver}
          initialTags={adding}
          onClose={() => { setAdding(null); setDropped([]); }}
        />
      )}
    </div>
  );
}

const NO_SELECTION: string[] = [];
