import { create } from 'zustand';
import { ImageTooLargeError } from '../lib/imageLimits';

/** Why an image was not inserted — for the paths without their own message line:
 *  pasting from the clipboard, dropping from the file explorer, the toolbar
 *  and the image field. Whoever has a line (cover image, altar) reports there. */
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
 * Reports an oversized image and returns `true`; any other error stays a
 * console entry (`false`), so the caller can display it itself.
 */
export function reportImageError(err: unknown, context: string): boolean {
  if (err instanceof ImageTooLargeError) {
    useImageNoticeStore.getState().show({ kind: 'tooLarge', maxBytes: err.maxBytes });
    return true;
  }
  console.error(`[images] ${context}:`, err);
  return false;
}
