import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';
import { useAltarStore } from '../../store/altarStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import { ALTAR_BACKGROUND_MAX_BYTES, DEFAULT_ALTAR_RESOLUTION, resolveResolutionPixels } from '../../lib/altarConstants';
import { altarBackgroundUrl, altarCanvasBackground, isAppBackground } from '../../lib/altarBackground';
import { ACCEPTED_IMAGE_MIME, generateId, hexToRgb, isAcceptedImageFile, readFileAsDataUrl } from '../../lib/helpers';
import { prepareImageDataUrl } from '../../lib/imageLimits';
import type { AltarItem, AltarPlacement, AltarRecord } from '../../types';
import { AltarItemVisual } from './AltarItemVisual';
import { canvasImageSrc, imageSrc, saveImage } from '../../lib/images';
import { THUMBNAIL_W, canvasToCappedThumbnail } from '../../lib/thumbnail';
import {
  CANVAS_SWATCHES, CanvasEditor, canvasToDataUrl, fullProfile, renderCanvasImage, renderCanvasSvg, type CanvasEditorHandle,
  type CanvasBackground, type CanvasBackgroundImages, type CanvasExportOptions,
  type CanvasElement, type CanvasGrid, type CanvasPaintOptions, type RulerGuide,
} from '../editors/canvas';

/**
 * What the altar offers in the canvas editor: everything — library images,
 * shapes, text and drawings, groups among them. Drawings on an altar carry no
 * layer images.
 */
const ALTAR_PROFILE = fullProfile();
const ALTAR_PAINT: CanvasPaintOptions = {
  ...ALTAR_PROFILE.paint,
  palette: CANVAS_SWATCHES,
  startColor: CANVAS_SWATCHES[0],
  startSize: 8,
};
import { elementToPlacement, placementToElement } from './altarScene';

// ---------------------------------------------------------------------------
// Altar picture renderer — draws directly to a Canvas 2D context from store
// data, for thumbnails and file export, with the canvas editor's own drawing for
// the elements (`renderCanvasImage`), so the picture matches the stage.
// ---------------------------------------------------------------------------

/** The visible grid, in output pixels; the background and the elements come from the canvas editor's renderer. */
function _drawGrid(ctx: CanvasRenderingContext2D, altar: AltarRecord, outW: number, outH: number) {
  const grid = altarGrid(altar);
  if (!grid?.visible) return;
  const { r, g, b } = hexToRgb(grid.color);
  ctx.save();
  ctx.strokeStyle = `rgba(${r},${g},${b},${grid.opacity})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < grid.columns; i++) { const x = (i / grid.columns) * outW; ctx.moveTo(x, 0); ctx.lineTo(x, outH); }
  for (let i = 1; i < grid.rows; i++) { const y = (i / grid.rows) * outH; ctx.moveTo(0, y); ctx.lineTo(outW, y); }
  ctx.stroke();
  ctx.restore();
}

/**
 * Loads a picture for drawing onto a canvas that is read back with `toBlob()`.
 * That only works as long as no foreign source is on it, which is why stored
 * images are read as data URLs (`canvasImageSrc`) instead of via `emerald-img`.
 */
async function _loadReadable(src: string): Promise<HTMLImageElement | null> {
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

/** What the altar renderers take: the elements with readable pictures, the background, the size. */
async function _altarRenderOptions(
  altar: AltarRecord,
  placements: AltarPlacement[],
  outW: number,
  options: Pick<CanvasExportOptions, 'region' | 'background'> = { region: null, background: true },
) {
  const { w: refW, h: refH } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
  // The items' pictures as data URLs, not the on-screen `emerald-img` ones, so `toBlob` can read the canvas.
  const sources = new Map(await Promise.all(placements.map(async (p) => [p.id, (await canvasImageSrc(p.image_data)) || null] as const)));
  return {
    types: ALTAR_PROFILE.types,
    width: refW,
    height: refH,
    elements: placements.map((p) => placementToElement(p, refW, refH, () => sources.get(p.id) ?? null)),
    outWidth: outW,
    region: options.region ?? undefined,
    background: options.background ? altarCanvasBackground(altar) : null,
    loadImage: _loadReadable,
    drawBackground: options.background
      ? (ctx: CanvasRenderingContext2D, w: number, h: number) => _drawGrid(ctx, altar, w, h)
      : undefined,
  };
}

async function _renderAltar(altar: AltarRecord, placements: AltarPlacement[], outW: number): Promise<HTMLCanvasElement | null> {
  return renderCanvasImage(await _altarRenderOptions(altar, placements, outW));
}

/** The active altar and its placements. */
async function activeAltarForRender(): Promise<{ altar: AltarRecord; placements: AltarPlacement[] } | null> {
  const { placements, activeAltarId, altars } = useAltarStore.getState();
  const altar = altars.find((a) => a.id === activeAltarId) ?? null;
  if (!altar) return null;
  return { altar, placements };
}

/** Renders the active altar at full native resolution for file export. */
export async function exportCurrentAltarImage(format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<string | null> {
  try {
    const active = await activeAltarForRender();
    if (!active) return null;
    const { w: nativeW } = resolveResolutionPixels(active.altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
    const canvas = await _renderAltar(active.altar, active.placements, nativeW);
    if (!canvas) return null;
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = format === 'png' ? undefined : format === 'webp' ? 0.92 : 0.97;
    return canvasToDataUrl(canvas, mime, quality);
  } catch (err) {
    console.error('[exportCurrentAltarImage]', err);
    return null;
  }
}

/** UTF-8 text as a base64 data URL of the given type. */
function textDataUrl(text: string, mime: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * The active altar as the canvas editor's export dialog asks for it: PNG,
 * JPEG (on white where nothing is drawn) or SVG, all of it or a region, at a
 * width, with its background or without. A data URL, or `null`.
 */
export async function exportAltarPicture(options: CanvasExportOptions): Promise<string | null> {
  const active = await activeAltarForRender();
  if (!active) return null;
  const render = await _altarRenderOptions(active.altar, active.placements, options.width, options);
  if (options.format === 'svg') return textDataUrl(await renderCanvasSvg(render), 'image/svg+xml');
  const canvas = await renderCanvasImage(render);
  if (!canvas) return null;
  if (options.format === 'jpeg') {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return canvasToDataUrl(flat, 'image/jpeg', 0.95);
  }
  return canvasToDataUrl(canvas, 'image/png');
}

/** Reads the active altar from the store and renders its thumbnail.
 *  Safe to call from anywhere — uses an off-screen canvas independent of the DOM. */
export async function captureCurrentAltar(): Promise<string | null> {
  try {
    // Reads the store before its first await: the caller may switch to another altar right after.
    const active = await activeAltarForRender();
    if (!active) return null;
    const canvas = await _renderAltar(active.altar, active.placements, THUMBNAIL_W);
    if (!canvas) return null;
    // WebP ladder with JPEG fallback and 512 KB cap from lib/thumbnail.ts.
    return canvasToCappedThumbnail(canvas, 'jpeg');
  } catch (err) {
    console.error('[captureCurrentAltar]', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The altar on screen: the canvas editor (`editors/canvas`), fed from the store.
// ---------------------------------------------------------------------------

/** The altar's grid in the canvas editor's terms; `null` when nothing uses it. */
function altarGrid(altar: AltarRecord): CanvasGrid | null {
  const size = altar.grid_size ?? 0;
  if (size <= 0 || !(altar.grid_enabled || altar.snap_to_grid || altar.snap_scale_to_grid)) return null;
  const { w, h } = resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION);
  return {
    columns: Math.max(1, Math.round(w / size)),
    rows: Math.max(1, Math.round(h / size)),
    visible: altar.grid_enabled,
    color: altar.grid_color,
    opacity: altar.grid_opacity,
    snapPosition: altar.snap_to_grid,
    snapSize: altar.snap_scale_to_grid,
  };
}

const elementImageSrc = (imageData: string | undefined) => imageSrc(imageData) || null;

/**
 * Lets the user choose a background picture and stores it in the vault, as
 * the sidebar's background upload did; its file name, or `null` if nothing
 * was chosen or it could not be stored.
 */
function pickBackgroundImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_IMAGE_MIME;
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file || !isAcceptedImageFile(file)) { resolve(null); return; }
      readFileAsDataUrl(file)
        .then((data) => prepareImageDataUrl(data, { capBytes: ALTAR_BACKGROUND_MAX_BYTES }))
        .then((data) => saveImage(data))
        .then(resolve, (error) => { console.error(error); resolve(null); });
    });
    input.click();
  });
}

const BACKGROUND_IMAGES: CanvasBackgroundImages = { resolve: altarBackgroundUrl, pick: pickBackgroundImage };

export function AltarCanvas({ altar, editable, readAlign, onExport }: {
  altar: AltarRecord;
  editable: boolean;
  /** Where the altar sits while reading: at the top of the view, or (fullscreen) in the middle. */
  readAlign: 'top' | 'center';
  /** Saving the altar as a picture, from the canvas editor's export dialog. */
  onExport?: (options: CanvasExportOptions) => void;
}) {
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementIds = useAltarStore((s) => s.selectedPlacementIds);
  const { placeItem, applyPlacements, selectPlacements, updateAltarGuides, updateAltar } = useAltarStore(
    useShallow((s) => ({
      updateAltar: s.updateAltar,
      placeItem: s.placeItem, applyPlacements: s.applyPlacements, selectPlacements: s.selectPlacements, updateAltarGuides: s.updateAltarGuides,
    })),
  );
  const editorRef = useRef<CanvasEditorHandle>(null);

  const { w: refW, h: refH } = useMemo(
    () => resolveResolutionPixels(altar.resolution ?? DEFAULT_ALTAR_RESOLUTION),
    [altar.resolution],
  );
  const grid = useMemo(() => altarGrid(altar), [altar]);

  const elements = useMemo(
    () => placements.map((p) => placementToElement(p, refW, refH, elementImageSrc)),
    [placements, refW, refH],
  );
  // Guides are stored in percent of the altar, so they keep their place when the resolution changes.
  const guides = useMemo(
    () => altar.guides.map((g) => ({ ...g, at: (g.at / 100) * (g.orientation === 'vertical' ? refW : refH) })),
    [altar.guides, refW, refH],
  );
  const onGuidesChange = useCallback((next: RulerGuide[]) => {
    const stored = next.map((g) => ({ ...g, at: (g.at / (g.orientation === 'vertical' ? refW : refH)) * 100 }));
    void updateAltarGuides(altar.id, { guides: stored }).catch(console.error);
  }, [updateAltarGuides, altar.id, refW, refH]);
  const onGuidesLockedChange = useCallback((locked: boolean) => {
    void updateAltarGuides(altar.id, { guides_locked: locked }).catch(console.error);
  }, [updateAltarGuides, altar.id]);

  const canvasBackground = useMemo(() => altarCanvasBackground(altar), [altar]);
  // The picture of the vault lives in the column the image cleanup looks at; one of the app's own needs none.
  const onCanvasBackgroundChange = useCallback((background: CanvasBackground) => {
    const src = background.image?.src;
    void updateAltar(altar.id, {
      canvas_background: background,
      background_image_data: src && !isAppBackground(src) ? src : null,
    }).catch(console.error);
  }, [updateAltar, altar.id]);

  /** Library items by their name in the element list. */
  const elementLabel = useCallback(
    (el: CanvasElement) => (el.type === 'image' ? placements.find((p) => p.id === el.id)?.name : null),
    [placements],
  );

  const handleChange = useCallback((next: CanvasElement[]) => {
    const previous = new Map(useAltarStore.getState().placements.map((p) => [p.id, p]));
    void applyPlacements(next.map((el) => elementToPlacement(el, refW, refH, previous.get(el.id)))).catch(console.error);
  }, [applyPlacements, refW, refH]);

  // Items dragged in from the library strip: a pointer drag on a channel,
  // since the WebView has no HTML5 drag and drop.
  const [dragItem, setDragItem] = useState<AltarItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => subscribeAltarDrag(setDragItem), []);

  useEffect(() => {
    if (!editable || !dragItem) {
      setGhostPos(null);
      return;
    }
    const onMove = (e: PointerEvent) => setGhostPos({ x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const item = getAltarDragItem();
      setAltarDragItem(null);
      if (!item) return;
      const point = editorRef.current?.clientToArtboard(e.clientX, e.clientY);
      if (!point || point.x < 0 || point.y < 0 || point.x > refW || point.y > refH) return;
      let x = (point.x / refW) * 100;
      let y = (point.y / refH) * 100;
      if (grid?.snapPosition) {
        x = Math.round(x / (100 / grid.columns)) * (100 / grid.columns);
        y = Math.round(y / (100 / grid.rows)) * (100 / grid.rows);
      }
      void placeItem(item, Math.max(3, Math.min(97, x)), Math.max(3, Math.min(97, y))).catch(console.error);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [editable, dragItem, placeItem, refW, refH, grid]);

  return (
    <CanvasEditor
      ref={editorRef}
      types={ALTAR_PROFILE.types}
      features={ALTAR_PROFILE.features}
      paint={ALTAR_PAINT}
      width={refW}
      height={refH}
      elements={elements}
      onChange={handleChange}
      selectedIds={selectedPlacementIds}
      onSelectionChange={selectPlacements}
      editable={editable}
      grid={grid}
      rotationSnap={altar.rotation_snap_enabled ? altar.rotation_snap_angle : null}
      historyKey={altar.id}
      readAlign={readAlign}
      createId={generateId}
      onExport={onExport}
      elementLabel={elementLabel}
      guides={guides}
      onGuidesChange={onGuidesChange}
      guidesLocked={altar.guides_locked}
      onGuidesLockedChange={onGuidesLockedChange}
      canvasBackground={canvasBackground}
      onCanvasBackgroundChange={onCanvasBackgroundChange}
      backgroundImages={BACKGROUND_IMAGES}
      overlay={editable && dragItem ? (
        <>
          <div className="canvas-drop-hint" />
          {ghostPos && createPortal(
            <div
              className="fixed pointer-events-none z-50 flex flex-col items-center gap-0.5 opacity-75"
              style={{ left: ghostPos.x, top: ghostPos.y, transform: 'translate(-50%, -50%)' }}
            >
              <AltarItemVisual item={dragItem} size={32} />
              <span className="text-xs text-muted whitespace-nowrap">{dragItem.name}</span>
            </div>,
            document.body,
          )}
        </>
      ) : null}
    />
  );
}
