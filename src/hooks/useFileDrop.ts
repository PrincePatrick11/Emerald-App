import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** The image formats a drop from the disk is taken for; anything else is left out. */
export const DROPPED_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * Files dragged in from the disk anywhere over the window, while `enabled`:
 * `dragOver` while they hover, `onDrop` with their paths on release. Tauri's
 * own event, since the WebView has no HTML5 drag and drop.
 */
export function useFileDrop(enabled: boolean, onDrop: (paths: string[]) => void): { dragOver: boolean } {
  const [dragOver, setDragOver] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') setDragOver(true);
        else if (type === 'leave') setDragOver(false);
        else if (type === 'drop') {
          setDragOver(false);
          onDropRef.current(event.payload.paths);
        }
      })
      // Registration is asynchronous: if the effect ends first, the listener
      // is unregistered right away instead of being left behind.
      .then((fn) => { if (disposed) fn(); else unlisten = fn; })
      .catch((e) => console.error('[DnD] setup failed:', e));
    return () => {
      disposed = true;
      unlisten?.();
      setDragOver(false);
    };
  }, [enabled]);

  return { dragOver };
}
