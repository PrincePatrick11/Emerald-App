import { create } from 'zustand';
import type { ExportTarget } from '../lib/exportData';

export type ExportFormat = 'pdf' | 'html' | 'markdown' | 'emerald';

interface ExportRequest {
  /**
   * The entry open when the modal was asked for. The modal starts on it, and
   * on a bulk export when there is none (`null`); the user can switch between.
   */
  target: ExportTarget | null;
  /** Preselected format, e.g. when opened from "Export as PDF…" in the menu bar. */
  format?: ExportFormat;
  /** Increments per request, so a menu click while the modal is open resets it to the new request. */
  seq: number;
}

interface ExportState {
  request: ExportRequest | null;
  /** True while an export is being written; new requests are ignored meanwhile. */
  busy: boolean;
  /** Opens the export modal, on `target` or — without one — on a bulk export. */
  openExport: (target: ExportTarget | null, format?: ExportFormat) => void;
  setBusy: (busy: boolean) => void;
  close: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  request: null,
  busy: false,
  openExport: (target, format) => {
    // A menu click during a running export would otherwise remount the modal
    // and let the finishing export close the new one.
    if (get().busy) return;
    set({ request: { target, format, seq: (get().request?.seq ?? 0) + 1 } });
  },
  setBusy: (busy) => set({ busy }),
  close: () => set({ request: null, busy: false }),
}));
