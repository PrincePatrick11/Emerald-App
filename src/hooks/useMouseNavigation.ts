import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isMacOS, isTauri } from '../lib/platform';
import { HISTORY_BUTTON_STEPS, isHistoryButton } from '../lib/mouseButtons';
import { hasOpenModal } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';

/** Multimedia keyboards — and mouse drivers that send these keys instead of a click. */
const KEY_STEPS: Partial<Record<string, -1 | 1>> = { BrowserBack: -1, BrowserForward: 1 };

/** One step in the active tab's history — the common exit of all paths. */
function step(delta: -1 | 1): void {
  // Above a modal the page behind it is not visible: a step there
  // would only be noticed once it closes.
  if (hasOpenModal()) return;
  const { navigateBack, navigateForward } = useUIStore.getState();
  if (delta < 0) navigateBack();
  else navigateForward();
}

/**
 * Back and forward via the mouse's thumb buttons — the same as the arrows in
 * the title bar. On Windows the WebView delivers them as mouse events,
 * on Linux wry intercepts them and injects `mousedown`/`mouseup` into the
 * page itself — only those two, which is why the step hangs on `mouseup` and
 * not on `auxclick` or `pointerup`. macOS reports them from Rust
 * (`install_mouse_nav_monitor`): drivers like Logi Options+ turn the buttons
 * into swipe gestures there, which never arrive as a DOM event.
 *
 * Plus the keyboard's "Browser back/forward" keys, on every platform. No
 * path navigates above a modal.
 */
export function useMouseNavigation(): void {
  useEffect(() => {
    if (!isTauri) return;
    const unlistenBack = listen('navigate-back', () => step(-1));
    const unlistenFwd = listen('navigate-forward', () => step(1));
    return () => {
      void unlistenBack.then((stop) => stop());
      void unlistenFwd.then((stop) => stop());
    };
  }, []);

  // The monitor in Rust does not see the keyboard keys — so they are handled here, everywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const delta = KEY_STEPS[e.key];
      if (!delta) return;
      e.preventDefault();
      if (!e.repeat) step(delta);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    // wry injects the mouse events into the page on macOS too: alongside the
    // monitor every press would count twice.
    if (isMacOS) return;
    // No grip in the app should begin with a thumb button — a drag, a
    // stroke on the sigil. Only stop it, no `preventDefault`: that would take
    // the mouse events away from the press, which the step depends on.
    const onPointerDown = (e: PointerEvent) => {
      if (isHistoryButton(e)) e.stopPropagation();
    };
    // The press is cancelled so that it does not move the focus; the release,
    // so that the WebView does not go back in its own history.
    const onMouseDown = (e: MouseEvent) => {
      if (isHistoryButton(e)) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      const delta = HISTORY_BUTTON_STEPS[e.button];
      if (!delta) return;
      e.preventDefault();
      step(delta);
    };
    // Capture: no area of the app should be able to keep the buttons for itself.
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    };
  }, []);
}
