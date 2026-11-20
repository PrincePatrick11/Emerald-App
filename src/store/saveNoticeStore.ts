import { create } from 'zustand';

/**
 * The one notice for a change that could not be written to the database. The
 * store that failed has already put its state back; this only tells the user.
 * Imports nothing, so any store may report through it. Shown by `SaveNoticeToast`.
 */
interface SaveNoticeState {
  /** Counts up with every report, so a repeated failure restarts the toast. */
  notice: { id: number } | null;
  show: () => void;
  dismiss: () => void;
}

let counter = 0;

export const useSaveNoticeStore = create<SaveNoticeState>((set) => ({
  notice: null,
  show: () => set({ notice: { id: ++counter } }),
  dismiss: () => set({ notice: null }),
}));

/** A write failed: log it and tell the user that the change did not stick. */
export function reportSaveError(err: unknown, context: string): void {
  console.error(`[${context}] saving failed:`, err);
  useSaveNoticeStore.getState().show();
}
