import { create } from 'zustand';
import type { ExportTarget } from '../lib/exportData';

export type ExportFormat = 'pdf' | 'html' | 'markdown' | 'emerald';

type ExportRequestInput = {
  /** Preselected format, e.g. when opened from "Export as PDF…" in the menu bar. */
  format?: ExportFormat;
} & (
  /** One entry, optionally with the entries it links to. */
  | { kind: 'entry'; target: ExportTarget }
  /** Many entries, picked by module and period. */
  | { kind: 'bulk' }
);

type ExportRequest = ExportRequestInput & {
  /** Increments per request, so a menu click while the modal is open resets it to the new request. */
  seq: number;
};

interface ExportState {
  request: ExportRequest | null;
  /** True while an export is being written; new requests are ignored meanwhile. */
  busy: boolean;
  /** Opens the export modal for `target`. */
  openExport: (target: ExportTarget, format?: ExportFormat) => void;
  /** Opens the export modal for a bulk export. */
  openBulkExport: (format?: ExportFormat) => void;
  setBusy: (busy: boolean) => void;
  close: () => void;
}

export const useExportStore = create<ExportState>((set, get) => {
  // A menu click during a running export would otherwise remount the modal
  // and let the finishing export close the new one.
  const open = (request: ExportRequestInput) => {
    if (get().busy) return;
    set({ request: { ...request, seq: (get().request?.seq ?? 0) + 1 } });
  };
  return {
    request: null,
    busy: false,
    openExport: (target, format) => open({ kind: 'entry', target, format }),
    openBulkExport: (format) => open({ kind: 'bulk', format }),
    setBusy: (busy) => set({ busy }),
    close: () => set({ request: null, busy: false }),
  };
});
