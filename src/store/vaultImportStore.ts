import { create } from 'zustand';
import type { OpenedVaultFile } from '../lib/dbBackup';
import { closeArchive } from '../lib/emerald/file';

/**
 * A `.vault.emerald` — content or raw backup — that the title bar's Import
 * opened, on its way to `VaultImportModal` (mounted by `LeftSidebarRail`),
 * which offers replace, merge or a new vault for it and closes the file when
 * it is done with it. The database export is in the export menu.
 */
interface VaultImportStore {
  pending: OpenedVaultFile | null;
  offer: (file: OpenedVaultFile) => void;
  /** The pending file, handed over once. */
  take: () => OpenedVaultFile | null;
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
}));
