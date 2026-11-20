import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isMacOS, isTauri } from '../lib/platform';
import { HISTORY_BUTTON_STEPS, isHistoryButton } from '../lib/mouseButtons';
import { hasOpenModal } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';

/** Multimedia keyboards — and mouse drivers that send these keys instead of a click. */
const KEY_STEPS: Partial<Record<string, -1 | 1>> = { BrowserBack: -1, BrowserForward: 1 };

/**
 * ⌘[ and ⌘] on macOS — the browsers' back/forward, and what mouse drivers
 * there (Logi Options+, SteerMouse …) send for the thumb buttons. Matches
 * `e.key` first, for layouts where the bracket needs ⌥ (German: ⌘⌥5) — which
 * is why `altKey` is not rejected. Falls back to `e.code`, because a driver
 * sends the physical US key whatever the layout (so ⌘ plus the key in that spot steps too).
 */
function macBracketStep(e: KeyboardEvent): -1 | 1 | undefined {
  if (!e.metaKey || e.ctrlKey || e.shiftKey) return undefined;
  if (e.key === '[') return -1;
  if (e.key === ']') return 1;
  if (e.code === 'BracketLeft') return -1;
  if (e.code === 'BracketRight') return 1;
  return undefined;
}

/** Whether a key press belongs to a text field or the editor rather than to the app. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || target.isContentEditable;
}

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
 * into swipe gestures there, which never arrive as a DOM event. On Windows
 * Rust also reports the drivers' app commands (`install_app_command_hook`),
 * through the same events.
 *
 * Plus the keyboard's "Browser back/forward" keys, on every platform, and
 * ⌘[ / ⌘] on macOS. No path navigates above a modal.
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

  // The Rust side does not see the keyboard keys — so they are handled here, everywhere.
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

  // Bubble phase, unlike the keys above: a text field, the editor or the
  // canvas (⌘[ / ⌘] arrange its elements there) keeps the shortcut for itself.
  useEffect(() => {
    if (!isMacOS) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const delta = macBracketStep(e);
      if (!delta) return;
      e.preventDefault();
      if (!e.repeat) step(delta);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
