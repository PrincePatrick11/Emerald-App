import { create } from 'zustand';
import { ImageTooLargeError } from '../lib/imageLimits';

/** Warum ein Bild nicht eingefügt wurde — für die Wege ohne eigene Meldezeile
 *  (Einfügen aus der Zwischenablage, Drop aus dem Datei-Explorer, Werkzeugleiste). */
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

/** Meldet ein zu großes Bild; jeder andere Fehler bleibt ein Konsolen-Eintrag. */
export function reportImageError(err: unknown, context: string): void {
  if (err instanceof ImageTooLargeError) {
    useImageNoticeStore.getState().show({ kind: 'tooLarge', maxBytes: err.maxBytes });
    return;
  }
  console.error(`[images] ${context}:`, err);
}
