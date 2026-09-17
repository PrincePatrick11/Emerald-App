import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { copyImageFile, readImageFile, saveImage } from '../../lib/images';
import { hasImageLimits, prepareImageDataUrl } from '../../lib/imageLimits';
import { reportImageError, useImageNoticeStore } from '../../store/imageNoticeStore';

/**
 * Bilder per Drag & Drop aus dem Datei-Explorer, über Tauris natives
 * Drag-Drop-Event. Das Event gilt dem ganzen Fenster, nicht einem Element —
 * es darf also nur EIN Zuhörer pro Eintrag hängen, sonst landet das Bild in
 * jedem Textblock. `getTarget` wählt den Editor, der es bekommt.
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
              // Ohne Grenzen direkt kopieren; mit ihnen erst einlesen, verkleinern und prüfen.
              const src = hasImageLimits()
                ? await saveImage(await prepareImageDataUrl(await readImageFile(path)))
                : await copyImageFile(path);
              editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
            } catch (e) {
              reportImageError(e, `drop ${path}`);
            }
          }
        }
      })
      // Die Registrierung ist asynchron: endet der Effekt vorher, wird der
      // Zuhörer gleich wieder abgemeldet statt liegenzubleiben.
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
