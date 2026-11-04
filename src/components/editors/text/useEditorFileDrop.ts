import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { copyImageFile, readImageFile, saveImage } from '../../../lib/images';
import { hasImageLimits, ImageTooLargeError, prepareImageDataUrl } from '../../../lib/imageLimits';
import { reportImageError, useImageNoticeStore } from '../../../store/imageNoticeStore';

/** The read limit of the Rust command along with its number (see `images.rs`). */
const TOO_LARGE_TO_READ = /image file too large: (\d+)/;

/** Reads the file in; the size limit of the Rust command becomes the usual notice. */
async function readDroppedImage(path: string): Promise<string> {
  try {
    return await readImageFile(path);
  } catch (err) {
    const limit = TOO_LARGE_TO_READ.exec(String(err));
    if (limit) throw new ImageTooLargeError(Number(limit[1]));
    throw err;
  }
}

/**
 * Images via drag & drop from the file explorer, through Tauri's native
 * drag-drop event. The event applies to the whole window, not to an element,
 * so only ONE listener may hang per entry, otherwise the image lands in
 * every text block. `getTarget` picks the editor that receives it.
 */
export function useEditorFileDrop(enabled: boolean, getTarget: () => Editor | null) {
  const getTargetRef = useRef(getTarget);
  getTargetRef.current = getTarget;

  const [fileDragOver, setFileDragOver] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const { type } = event.payload;

        if (type === 'enter' || type === 'over') { setFileDragOver(true); return; }
        if (type === 'leave') { setFileDragOver(false); return; }

        if (type === 'drop') {
          setFileDragOver(false);
          const { paths } = event.payload;
          const imagePaths = paths.filter((p) => /\.(png|jpe?g|gif|webp|svg)$/i.test(p));
          if (!imagePaths.length) { useImageNoticeStore.getState().show({ kind: 'format' }); return; }

          const editor = getTargetRef.current();
          if (!editor) return;

          for (const path of imagePaths) {
            try {
              // Without limits copy directly; with them first read in, shrink and check.
              const src = hasImageLimits()
                ? await saveImage(await prepareImageDataUrl(await readDroppedImage(path)))
                : await copyImageFile(path);
              editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
            } catch (e) {
              reportImageError(e, `drop ${path}`);
            }
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
    };
  }, [enabled]);

  return { fileDragOver };
}
