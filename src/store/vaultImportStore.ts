import { create } from 'zustand';
import type { OpenedVaultFile } from '../lib/dbBackup';
import { closeArchive } from '../lib/emerald/file';

/**
 * A `.vault.emerald` the menu's import opened, on its way to Settings →
 * Backup: there the import offers replace, merge or a new vault for it. The
 * settings window opens when one arrives (`LeftSidebarRail`), the page takes
 * it (`BackupPage`) and closes the file when it is done with it.
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
