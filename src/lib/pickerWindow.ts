import { getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { isTauri } from './platform';

/**
 * The window while the vault picker is shown: one fixed, small size, then back
 * to where and how large it was.
 *
 * The picker is a view in the main window rather than a window of its own, so
 * the stores and the question about unsaved edits stay where they are. Only the
 * window's frame changes.
 */

/** Logical pixels: two columns, vaults and server, wider than tall. */
export const PICKER_WIDTH = 880;
export const PICKER_HEIGHT = 560;

/** The main window's minimum, as in `tauri.conf.json` and the three platform files. */
const MAIN_MIN_WIDTH = 720;
const MAIN_MIN_HEIGHT = 600;

interface Saved {
  size: PhysicalSize;
  position: PhysicalPosition;
  maximized: boolean;
  fullscreen: boolean;
}

let saved: Saved | null = null;
/** Enter and leave run one after the other, never interleaved. */
let queue: Promise<void> = Promise.resolve();

function serial(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step, step).catch((e: unknown) => console.warn('[picker] window', e));
  return queue;
}

/** Maximising and leaving fullscreen are animated on some systems: wait for the end. */
async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 40 && !(await check()); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Shrinks the window to the picker's size, centred where the window was. */
export function enterPickerWindow(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return serial(async () => {
    if (saved) return;
    const win = getCurrentWindow();
    const fullscreen = await win.isFullscreen();
    if (fullscreen) {
      await win.setFullscreen(false);
      await until(async () => !(await win.isFullscreen()));
    }
    const maximized = await win.isMaximized();
    if (maximized) {
      await win.unmaximize();
      await until(async () => !(await win.isMaximized()));
    }
    const size = await win.outerSize();
    const inner = await win.innerSize();
    const position = await win.outerPosition();
    saved = { size: inner, position, maximized, fullscreen };

    const scale = await win.scaleFactor();
    await win.setMinSize(new LogicalSize(PICKER_WIDTH, PICKER_HEIGHT));
    await win.setSize(new LogicalSize(PICKER_WIDTH, PICKER_HEIGHT));
    // The frame around the webview (macOS title bar strip, Windows borders)
    // keeps its size, so the centre is worked out on the outer size.
    const frameX = size.width - inner.width;
    const frameY = size.height - inner.height;
    const width = Math.round(PICKER_WIDTH * scale) + frameX;
    const height = Math.round(PICKER_HEIGHT * scale) + frameY;
    await win.setPosition(new PhysicalPosition(
      Math.round(position.x + (size.width - width) / 2),
      Math.round(position.y + (size.height - height) / 2),
    ));
    // Not resizable: no edge to drag, and Tauri's double-click on a drag
    // region (`internal_toggle_maximize`) does nothing either.
    await win.setResizable(false);
  });
}

/** Back to the size, place and state from before the picker. */
export function leavePickerWindow(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return serial(async () => {
    const before = saved;
    if (!before) return;
    saved = null;
    const win = getCurrentWindow();
    await win.setResizable(true);
    await win.setMinSize(new LogicalSize(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT));
    await win.setSize(before.size);
    await win.setPosition(before.position);
    if (before.maximized) await win.maximize();
    if (before.fullscreen) await win.setFullscreen(true);
  });
}
