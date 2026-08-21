import { create } from 'zustand';
import {
  type Vault,
  loadVaultsFile,
  setActiveVaultId,
  addVault as addVaultToFile,
  updateVaultName,
  relocateVault as relocateVaultInFile,
  removeVault as removeVaultFromFile,
} from '../lib/vaultManager';
import { resetDbCache, getDb } from '../lib/db';
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTagStore } from './tagStore';
import { useRoutineStore } from './routineStore';
import { useAltarStore } from './altarStore';
import { useUIStore } from './uiStore';
import { useTaskStore } from './taskStore';
import { useUndoStore } from './undoStore';

interface VaultStore {
  vaults: Vault[];
  activeVaultId: string;
  loaded: boolean;

  loadVaults: () => Promise<void>;
  switchVault: (id: string) => Promise<void>;
  addVault: (vault: Vault) => Promise<void>;
  renameVault: (id: string, name: string) => Promise<void>;
  relocateVault: (id: string, path: string) => Promise<void>;
  removeVault: (id: string, deleteFiles?: boolean) => Promise<void>;
}

async function reloadAllStores(): Promise<void> {
  await useTagStore.getState().fetchTags();
  await Promise.all([
    useWikiStore.getState().fetchCategories(),
    useOperationStore.getState().fetchAll(),
  ]);
  await Promise.all([
    useJournalStore.getState().fetchEntries(),
    useWikiStore.getState().fetchArticles(),
    useRoutineStore.getState().fetchRoutines(),
    useAltarStore.getState().fetchAltars(),
    useTaskStore.getState().fetchAll(),
  ]);
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaults: [],
  activeVaultId: 'default',
  loaded: false,

  loadVaults: async () => {
    const data = await loadVaultsFile();
    set({ vaults: data.vaults, activeVaultId: data.activeVaultId, loaded: true });
  },

  switchVault: async (id: string) => {
    const previous = get().activeVaultId;
    if (id === previous) return;

    // Persist new active vault
    await setActiveVaultId(id);
    set({ activeVaultId: id });

    // Drop cached DB connection so next getDb() loads the new vault
    await resetDbCache();

    // Initialize schema for the new vault (runMigrations is idempotent).
    // A vault whose folder is gone fails here — and must not stay the active
    // one, or the next start comes up on a vault that cannot be opened.
    try {
      await getDb();
    } catch (err) {
      await setActiveVaultId(previous);
      set({ activeVaultId: previous });
      await resetDbCache();
      throw err;
    }

    // Navigate to home first to avoid stale open-entry state
    useUIStore.getState().setActiveView({ type: 'home' });

    // Undo entries reference rows of the old vault by id — drop them
    useUndoStore.getState().clear();

    // Reload all data stores from the new DB
    await reloadAllStores();
  },

  addVault: async (vault: Vault) => {
    await addVaultToFile(vault);
    set((s) => ({ vaults: [...s.vaults, vault] }));
  },

  renameVault: async (id: string, name: string) => {
    await updateVaultName(id, name);
    set((s) => ({
      vaults: s.vaults.map((v) => (v.id === id ? { ...v, name } : v)),
    }));
  },

  relocateVault: async (id: string, path: string) => {
    await relocateVaultInFile(id, path);
    set((s) => ({ vaults: s.vaults.map((v) => (v.id === id ? { ...v, path } : v)) }));
  },

  removeVault: async (id: string, deleteFiles = false) => {
    const { vaults, activeVaultId } = get();
    if (id === activeVaultId || vaults.length <= 1) return;
    await removeVaultFromFile(id, deleteFiles);
    set((s) => ({ vaults: s.vaults.filter((v) => v.id !== id) }));
  },
}));
