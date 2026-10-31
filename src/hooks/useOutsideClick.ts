import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface UseOutsideClickOptions {
  /** All "inside" areas; a mousedown outside all of them triggers onDismiss.
   *  Multiple refs when the popover hangs off a portal and is no longer a descendant of the trigger. */
  refs: RefObject<HTMLElement | null>[];
  /**
   * Escape closes as well. `'capture'` registers the keydown in the
   * capture phase and stops propagation — needed when a surrounding
   * `Modal` has its own Escape handler in the bubble phase on the document
   * and would otherwise win (it registered first on mount).
   */
  escape?: boolean | 'capture';
  /**
   * Intercept mousedown in the capture phase. Needed where Tauri's `drag.js`
   * calls `stopImmediatePropagation()` on `data-tauri-drag-region` elements
   * and the click never reaches the bubble phase.
   */
  capture?: boolean;
  /** Delay registration to skip the opening mousedown itself (ContextMenu). */
  delay?: number;
}

/**
 * Dismiss pattern for menus and popovers: mousedown outside (and optionally
 * Escape) calls `onDismiss`. Listeners are attached only while `active` is true.
 *
 * `onDismiss` and `refs` run through a ref and may be inline values —
 * they do not re-register the listeners.
 */
export function useOutsideClick(
  active: boolean,
  onDismiss: () => void,
  opts: UseOutsideClickOptions,
): void {
  const { escape = false, capture = false, delay } = opts;
  const stateRef = useRef({ refs: opts.refs, onDismiss });
  // Deliberate ref latching during render (the same pattern as useEntryEditor):
  // the handlers stay current without changing inline closures re-registering
  // the listeners. At worst, a discarded render latches a closure that the
  // commit overwrites right afterwards.
  stateRef.current = { refs: opts.refs, onDismiss };

  useEffect(() => {
    if (!active) return;
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (stateRef.current.refs.some((r) => r.current?.contains(target))) return;
      stateRef.current.onDismiss();
    };
    const escCapture = escape === 'capture';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (escCapture) e.stopPropagation();
      stateRef.current.onDismiss();
    };
    let tid: number | undefined;
    if (delay !== undefined) {
      tid = window.setTimeout(() => document.addEventListener('mousedown', onMouse, capture), delay);
    } else {
      document.addEventListener('mousedown', onMouse, capture);
    }
    if (escape) document.addEventListener('keydown', onKey, escCapture);
    return () => {
      if (tid !== undefined) clearTimeout(tid);
      document.removeEventListener('mousedown', onMouse, capture);
      if (escape) document.removeEventListener('keydown', onKey, escCapture);
    };
  }, [active, escape, capture, delay]);
}
