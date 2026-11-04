import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { copyImageFile, readImageFile, saveImage } from '../../../lib/images';
import { hasImageLimits, ImageTooLargeError, needsPreparing, prepareImageDataUrl } from '../../../lib/imageLimits';
import { isWindows } from '../../../lib/platform';
import { useSettingsStore } from '../../../store/settingsStore';
import { reportImageError, useImageNoticeStore } from '../../../store/imageNoticeStore';
import { editorAtPoint, lineSpot, type DropSpot } from './dropSpot';
import { editorHas } from './hostContext';

/** The read limit of the Rust command along with its number (see `images.rs`). */
const TOO_LARGE_TO_READ = /image file too large: (\d+)/;

/**
 * The stored name of a dropped file: read in and prepared (limits, photo as
 * JPEG) when that could change it, else copied as it is. A file too large to
 * read in is copied too as long as the vault sets no limits — only a photo
 * conversion was asked for then, and it would not be stored at all otherwise.
 * With limits, the read limit becomes the usual notice.
 */
async function storeDroppedImage(path: string): Promise<string> {
  if (!needsPreparing(path)) return copyImageFile(path);
  let dataUrl: string;
  try {
    dataUrl = await readImageFile(path);
  } catch (err) {
    const limit = TOO_LARGE_TO_READ.exec(String(err));
    if (!limit) throw err;
    if (!hasImageLimits()) return copyImageFile(path);
    throw new ImageTooLargeError(Number(limit[1]));
  }
  return saveImage(await prepareImageDataUrl(dataUrl));
}

/**
 * A position of Tauri's drag-drop event in the page's CSS pixels. The event
 * calls it physical, but only WebView2 delivers device pixels — and its
 * `devicePixelRatio` includes the page zoom. WKWebView and WebKitGTK deliver
 * the view's points, unzoomed, so there the UI scale (`setZoom`) divides
 * (wry: `wkwebview/drag_drop.rs`, `webkitgtk/drag_drop.rs`).
 */
function dropPositionToCss(position: { x: number; y: number }): { x: number; y: number } {
  const factor = isWindows ? window.devicePixelRatio : useSettingsStore.getState().settings.appearance.uiScale / 100;
  return { x: position.x / factor, y: position.y / factor };
}

interface FileDropOptions {
  enabled: boolean;
  /** The host's editors, in order. */
  getEditors: () => Editor[];
  /** The area that counts as a target, also between the editors. */
  getContainer: () => HTMLElement | null;
  /** Where a drop outside every editor goes, at its cursor; `null` for nowhere. */
  getFallback: () => Editor | null;
  /** Where the dragged files would land, for the indicator. */
  onSpot: (spot: DropSpot | null) => void;
}

/**
 * Images via drag & drop from the file explorer, through Tauri's native
 * drag-drop event. The event applies to the whole window, not to an element,
 * so only ONE listener may hang per host, otherwise the image lands in
 * every editor. The images land between the blocks under the pointer, in the
 * order of the files; dropped beside all editors, at the cursor of `getFallback`.
 */
export function useEditorFileDrop({ enabled, getEditors, getContainer, getFallback, onSpot }: FileDropOptions) {
  const optionsRef = useRef({ getEditors, getContainer, getFallback, onSpot });
  optionsRef.current = { getEditors, getContainer, getFallback, onSpot };

  /** The spot at a position of the event (see `dropPositionToCss`). */
  const spotAt = (position: { x: number; y: number }): DropSpot | null => {
    const { getEditors, getContainer } = optionsRef.current;
    const { x, y } = dropPositionToCss(position);
    const target = editorAtPoint(getEditors().filter((ed) => editorHas(ed, 'image')), getContainer(), x, y);
    return target ? lineSpot(target.editor, target.y) : null;
  };

  const [fileDragOver, setFileDragOver] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const { type } = event.payload;

        if (type === 'enter' || type === 'over') {
          setFileDragOver(true);
          optionsRef.current.onSpot(spotAt(event.payload.position));
          return;
        }
        if (type === 'leave') { setFileDragOver(false); optionsRef.current.onSpot(null); return; }

        if (type === 'drop') {
          setFileDragOver(false);
          optionsRef.current.onSpot(null);
          const { paths, position } = event.payload;
          const imagePaths = paths.filter((p) => /\.(png|jpe?g|gif|webp|svg)$/i.test(p));
          if (!imagePaths.length) { useImageNoticeStore.getState().show({ kind: 'format' }); return; }

          const spot = spotAt(position);
          const fallback = optionsRef.current.getFallback();
          const editor = spot?.editor ?? (fallback && editorHas(fallback, 'image') ? fallback : null);
          if (!editor) return;
          // Each image after the previous one. Preparing a photo takes a moment
          // and typing goes on meanwhile, so the spot follows every change of
          // the document, and moves past each image inserted there.
          let at = spot ? spot.pos : null;
          const follow = ({ transaction }: { transaction: { mapping: { map: (pos: number, assoc?: number) => number } } }) => {
            if (at !== null) at = transaction.mapping.map(at, 1);
          };
          editor.on('transaction', follow);
          try {
            for (const path of imagePaths) {
              try {
                const src = await storeDroppedImage(path);
                if (editor.isDestroyed) return;
                const node = { type: 'image', attrs: { src } };
                if (at === null) editor.chain().focus().insertContent(node).run();
                else editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), node).run();
              } catch (e) {
                reportImageError(e, `drop ${path}`);
              }
            }
          } finally {
            editor.off('transaction', follow);
          }
        }
      })
      // Registration is asynchronous: if the effect ends first, the
      // listener is unregistered right away instead of being left behind.
      .then((fn) => { if (disposed) fn(); else unlisten = fn; })
      .catch((e) => console.error('[DnD] setup failed:', e));

    return () => {
      disposed = true;
      unlisten?.();
      setFileDragOver(false);
      optionsRef.current.onSpot(null);
    };
  }, [enabled]);

  return { fileDragOver };
}
