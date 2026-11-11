import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isWindows } from '../lib/platform';
import { useSettingsStore } from '../store/settingsStore';

/**
 * A position of Tauri's drag-drop event in the page's CSS pixels. The event
 * calls it physical, but only WebView2 delivers device pixels — and its
 * `devicePixelRatio` includes the page zoom. WKWebView and WebKitGTK deliver
 * the view's points, unzoomed, so there the UI scale (`setZoom`) divides
 * (wry: `wkwebview/drag_drop.rs`, `webkitgtk/drag_drop.rs`).
 */
export function dropPositionToCss(position: { x: number; y: number }): { x: number; y: number } {
  const factor = isWindows ? window.devicePixelRatio : useSettingsStore.getState().settings.appearance.uiScale / 100;
  return { x: position.x / factor, y: position.y / factor };
}

/**
 * Whether a place under the pointer takes dropped files itself (it carries
 * `data-file-drop`, a canvas, say): then a text editor around it leaves them alone.
 */
export function dropClaimedAt(point: { x: number; y: number }): boolean {
  return !!document.elementFromPoint(point.x, point.y)?.closest('[data-file-drop]');
}

/**
 * Files dragged in from the disk anywhere over the window, while `enabled`:
 * `dragOver` while they hover, `onDrop` with their paths and where they were let go (CSS pixels) on release. Tauri's
 * own event, since the WebView has no HTML5 drag and drop.
 */
export function useFileDrop(enabled: boolean, onDrop: (paths: string[], point: { x: number; y: number }) => void): { dragOver: boolean } {
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
          onDropRef.current(event.payload.paths, dropPositionToCss(event.payload.position));
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
