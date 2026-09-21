import { create } from 'zustand';
import { ImageTooLargeError } from '../lib/imageLimits';

/** Warum ein Bild nicht eingefügt wurde — für die Wege ohne eigene Meldezeile:
 *  Einfügen aus der Zwischenablage, Drop aus dem Datei-Explorer, Werkzeugleiste
 *  und Bildfeld. Wer eine Zeile hat (Titelbild, Altar), meldet dort. */
export type ImageNotice = { kind: 'format' } | { kind: 'tooLarge'; maxBytes: number };

interface ImageNoticeState {
  notice: ImageNotice | null;
  show: (notice: ImageNotice) => void;
  dismiss: () => void;
}

export const useImageNoticeStore = create<ImageNoticeState>((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  dismiss: () => set({ notice: null }),
}));

/**
 * Meldet ein zu großes Bild und liefert `true`; jeder andere Fehler bleibt ein
 * Konsolen-Eintrag (`false`), damit der Aufrufer ihn selbst anzeigen kann.
 */
export function reportImageError(err: unknown, context: string): boolean {
  if (err instanceof ImageTooLargeError) {
    useImageNoticeStore.getState().show({ kind: 'tooLarge', maxBytes: err.maxBytes });
    return true;
  }
  console.error(`[images] ${context}:`, err);
  return false;
}
