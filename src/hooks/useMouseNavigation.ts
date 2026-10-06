import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isMacOS, isTauri } from '../lib/platform';
import { hasOpenModal } from '../components/ui/Modal';
import { isAltarFullscreen, useUIStore } from '../store/uiStore';

/** `MouseEvent.button` der Daumentasten: 3 ist zurück, 4 ist vor. */
const MOUSE_STEPS: Partial<Record<number, -1 | 1>> = { 3: -1, 4: 1 };
/** Multimedia-Tastaturen — und Maustreiber, die statt eines Klicks diese Tasten senden. */
const KEY_STEPS: Partial<Record<string, -1 | 1>> = { BrowserBack: -1, BrowserForward: 1 };

/** Ein Schritt im Verlauf des aktiven Tabs — der gemeinsame Ausgang aller Wege. */
function step(delta: -1 | 1): void {
  // Über einem Modal ist die Seite dahinter nicht zu sehen: ein Schritt dort
  // fiele erst auf, wenn es schließt.
  if (hasOpenModal()) return;
  // Wie die Pfeile der Titelleiste, die es im Vollfenster des Altars nicht gibt.
  if (isAltarFullscreen(useUIStore.getState())) return;
  const { navigateBack, navigateForward } = useUIStore.getState();
  if (delta < 0) navigateBack();
  else navigateForward();
}

/**
 * Zurück und Vor über die Daumentasten der Maus — dasselbe wie die Pfeile in
 * der Titelleiste. Unter Windows liefert der WebView sie als Mausereignisse,
 * unter Linux fängt wry sie ab und setzt `mousedown`/`mouseup` selbst in die
 * Seite — nur diese beiden, weshalb der Schritt an `mouseup` hängt und nicht
 * an `auxclick` oder `pointerup`. macOS meldet sie aus Rust
 * (`install_mouse_nav_monitor`): Treiber wie Logi Options+ machen dort
 * Wischgesten aus den Tasten, die als DOM-Ereignis nie ankommen.
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

  // Die Tasten der Tastatur sieht der Monitor in Rust nicht — also überall hier.
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
    // wry setzt die Mausereignisse auch unter macOS in die Seite: neben dem
    // Monitor zählte jeder Druck doppelt.
    if (isMacOS) return;
    // Kein Griff der App soll mit einer Daumentaste beginnen — ein Zug, ein
    // Strich auf der Sigille. Nur anhalten, nicht `preventDefault`: das nähme
    // dem Druck die Mausereignisse, an denen der Schritt hängt.
    const onPointerDown = (e: PointerEvent) => {
      if (MOUSE_STEPS[e.button]) e.stopPropagation();
    };
    // Auch der Druck selbst wird geschluckt: er setzte sonst den Fokus um, und
    // der WebView ginge beim Loslassen in seinem eigenen Verlauf zurück.
    const onMouseDown = (e: MouseEvent) => {
      if (MOUSE_STEPS[e.button]) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      const delta = MOUSE_STEPS[e.button];
      if (!delta) return;
      e.preventDefault();
      step(delta);
    };
    // Capture: kein Bereich der App soll die Tasten für sich behalten können.
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
