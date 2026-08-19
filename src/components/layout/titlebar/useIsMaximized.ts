import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Tracks whether the window is maximised, so the title bar can swap between
 * the maximise and restore glyphs.
 *
 * Re-checking `isMaximized()` on every `onResized` rather than only after our
 * own button click is deliberate: the state also changes via Win+Arrow,
 * dragging the window to a screen edge, and double-clicking the drag region
 * (which Tauri handles natively, without telling us).
 */
export function useIsMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let alive = true;
    let frame = 0;

    const sync = () => {
      appWindow.isMaximized()
        .then((value) => { if (alive) setMaximized(value); })
        .catch(() => {/* desktop-only, ignore in browser preview */});
    };
    sync();

    // onResized fires continuously while dragging a window edge — coalesce
    // to one check per frame so a resize doesn't spam IPC calls.
    const unlisten = appWindow.onResized(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return maximized;
}
