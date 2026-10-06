import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isMacOS, isTauri } from '../lib/platform';
import { hasOpenModal } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';

/** `MouseEvent.button` der Daumentasten: 3 ist zurück, 4 ist vor. */
const MOUSE_STEPS: Record<number, -1 | 1> = { 3: -1, 4: 1 };
/** Multimedia-Tastaturen — und Maustreiber, die statt eines Klicks diese Tasten senden. */
const KEY_STEPS: Record<string, -1 | 1> = { BrowserBack: -1, BrowserForward: 1 };

/**
 * Über einem Modal ist die Seite dahinter nicht zu sehen: ein Schritt dort
 * fiele erst auf, wenn es schließt.
 */
function step(delta: -1 | 1): void {
  if (hasOpenModal()) return;
  const { navigateBack, navigateForward } = useUIStore.getState();
  if (delta < 0) navigateBack();
  else navigateForward();
}

/**
 * Zurück und Vor über die Daumentasten der Maus — dasselbe wie die Pfeile in
 * der Titelleiste. macOS meldet sie aus Rust (`install_mouse_nav_monitor`),
 * weil WKWebView sie der Seite nicht zuverlässig gibt; unter Windows und Linux
 * kommen sie als gewöhnliche Mausereignisse an.
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

  useEffect(() => {
    // Sonst zählte jeder Druck doppelt, sobald WKWebView das Ereignis doch liefert.
    if (isMacOS) return;
    // Auch der Druck selbst wird geschluckt: er setzte sonst den Fokus um, und
    // der WebView ginge beim Loslassen in seinem eigenen Verlauf zurück.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button in MOUSE_STEPS) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      const delta = MOUSE_STEPS[e.button];
      if (!delta) return;
      e.preventDefault();
      step(delta);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const delta = KEY_STEPS[e.key];
      if (!delta) return;
      e.preventDefault();
      if (!e.repeat) step(delta);
    };
    // Capture: kein Bereich der App soll die Tasten für sich behalten können.
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}
