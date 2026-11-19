import { create } from 'zustand';
import type { OpenedVaultFile } from '../lib/dbBackup';
import { closeArchive } from '../lib/emerald/file';

/**
 * The two dialogs of a whole vault, mounted by `LeftSidebarRail`:
 *
 * - a `.vault.emerald` — content or raw backup — that the title bar's Import
 *   opened, on its way to `VaultImportModal`, which offers replace, merge or
 *   a new vault for it and closes the file when it is done with it;
 * - the database export (`VaultExportModal`), from the title bar's Export —
 *   until the export menu takes it over.
 */
interface VaultImportStore {
  pending: OpenedVaultFile | null;
  offer: (file: OpenedVaultFile) => void;
  /** The pending file, handed over once. */
  take: () => OpenedVaultFile | null;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
}

export const useVaultImportStore = create<VaultImportStore>((set, get) => ({
  pending: null,
  offer: (file) => {
    // One not taken yet gives way to the newer one.
    const before = get().pending;
    if (before) closeArchive(before.ticket);
    set({ pending: file });
  },
  take: () => {
    const { pending } = get();
    if (pending) set({ pending: null });
    return pending;
  },
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),
}));
