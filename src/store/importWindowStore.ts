import { create } from 'zustand';

/**
 * The import window, opened by the title bar's Import or by files dragged
 * into the app window (`useImportDrop`), and mounted by `LeftSidebarRail`.
 * `dropped` hands the window the paths of a drop — the window that is open
 * already takes them as its next file. Each has a `seq` of its own, so the
 * same file dropped twice still counts twice.
 */
interface ImportWindowStore {
  open: boolean;
  dropped: { seq: number; paths: string[] } | null;
  show: () => void;
  /** Opens the window, if it is not open, with dragged-in files. */
  drop: (paths: string[]) => void;
  close: () => void;
}

let seq = 0;

export const useImportWindowStore = create<ImportWindowStore>((set) => ({
  open: false,
  dropped: null,
  show: () => set({ open: true }),
  drop: (paths) => set({ open: true, dropped: { seq: ++seq, paths } }),
  close: () => set({ open: false, dropped: null }),
}));
