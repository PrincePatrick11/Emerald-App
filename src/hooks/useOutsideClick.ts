import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface UseOutsideClickOptions {
  /** Alle „Innen"-Bereiche; ein mousedown außerhalb von allen löst onDismiss aus.
   *  Mehrere Refs, wenn das Popover per Portal hängt und kein Nachfahre des Triggers mehr ist. */
  refs: RefObject<HTMLElement | null>[];
  /**
   * Escape schließt ebenfalls. `'capture'` registriert den keydown in der
   * Capture-Phase und stoppt die Propagation — nötig, wenn ein umgebendes
   * `Modal` seinen eigenen Escape-Handler in der Bubble-Phase am Dokument hat
   * und sonst gewinnt (es hat sich beim Mount zuerst registriert).
   */
  escape?: boolean | 'capture';
  /**
   * mousedown in der Capture-Phase abfangen. Nötig, wo Tauris `drag.js` auf
   * `data-tauri-drag-region`-Elementen `stopImmediatePropagation()` ruft und
   * der Klick die Bubble-Phase nie erreicht.
   */
  capture?: boolean;
  /** Registrierung verzögern, um das öffnende mousedown selbst zu überspringen (ContextMenu). */
  delay?: number;
}

/**
 * Dismiss-Muster für Menüs und Popover: mousedown außerhalb (und optional
 * Escape) ruft `onDismiss`. Listener hängen nur, solange `active` wahr ist.
 *
 * `onDismiss` und `refs` laufen über einen Ref und dürfen Inline-Werte sein —
 * sie re-registrieren die Listener nicht.
 */
export function useOutsideClick(
  active: boolean,
  onDismiss: () => void,
  opts: UseOutsideClickOptions,
): void {
  const { escape = false, capture = false, delay } = opts;
  const stateRef = useRef({ refs: opts.refs, onDismiss });
  // Bewusstes Ref-Latching im Render (dasselbe Muster wie useEntryEditor):
  // die Handler bleiben aktuell, ohne dass wechselnde Inline-Closures die
  // Listener re-registrieren. Ein verworfener Render latcht schlimmstenfalls
  // eine Closure, die der Commit gleich darauf überschreibt.
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
