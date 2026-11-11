import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { storeImageFromPath } from '../../../lib/storeImage';
import { useImagePickerStore } from '../../../store/imagePickerStore';
import { dropClaimedAt, dropPositionToCss } from '../../../hooks/useFileDrop';
import { reportImageError, useImageNoticeStore } from '../../../store/imageNoticeStore';
import { editorAtPoint, lineSpot, type DropSpot } from './dropSpot';
import { editorHas } from './hostContext';
import { insertImagesInOrder } from './editorCommands';

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
    if (dropClaimedAt({ x, y })) return null;
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

        if ((type === 'enter' || type === 'over') && useImagePickerStore.getState().request) return;
        if (type === 'enter' || type === 'over') {
          setFileDragOver(true);
          optionsRef.current.onSpot(spotAt(event.payload.position));
          return;
        }
        if (type === 'leave') { setFileDragOver(false); optionsRef.current.onSpot(null); return; }

        if (type === 'drop') {
          setFileDragOver(false);
          // The picture picker is open and takes the files itself.
          if (useImagePickerStore.getState().request) { optionsRef.current.onSpot(null); return; }
          optionsRef.current.onSpot(null);
          const { paths, position } = event.payload;
          // A place under the pointer takes the files itself.
          if (dropClaimedAt(dropPositionToCss(position))) return;
          const imagePaths = paths.filter((p) => /\.(png|jpe?g|gif|webp|svg)$/i.test(p));
          if (!imagePaths.length) { useImageNoticeStore.getState().show({ kind: 'format' }); return; }

          const spot = spotAt(position);
          const fallback = optionsRef.current.getFallback();
          const editor = spot?.editor ?? (fallback && editorHas(fallback, 'image') ? fallback : null);
          if (!editor) return;
          await insertImagesInOrder(editor, spot ? spot.pos : null, imagePaths, storeImageFromPath,
            (e, path) => reportImageError(e, `drop ${path}`));
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
