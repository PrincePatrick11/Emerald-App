import { create } from 'zustand';
import {
  type Vault,
  loadVaultsFile,
  setActiveVaultId,
  addVault as addVaultToFile,
  updateVaultName,
  removeVault as removeVaultFromFile,
} from '../lib/vaultManager';
import { resetDbCache, getDb } from '../lib/db';

interface VaultStore {
  vaults: Vault[];
  activeVaultId: string;
  loaded: boolean;

  loadVaults: () => Promise<void>;
  switchVault: (id: string) => Promise<void>;
  addVault: (vault: Vault) => Promise<void>;
  renameVault: (id: string, name: string) => Promise<void>;
  removeVault: (id: string) => Promise<void>;
}

async function reloadAllStores(): Promise<void> {
  // Dynamic imports to avoid circular deps — each store is loaded lazily
  const [
    { useJournalStore },
    { useWikiStore },
    { useOperationStore },
    { useTagStore },
    { useRoutineStore },
    { useAltarStore },
  ] = await Promise.all([
    import('./journalStore'),
    import('./wikiStore'),
    import('./operationStore'),
    import('./tagStore'),
    import('./routineStore'),
    import('./altarStore'),
  ]);

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
    if (id === get().activeVaultId) return;

    // Persist new active vault
    await setActiveVaultId(id);
    set({ activeVaultId: id });

    // Drop cached DB connection so next getDb() loads the new vault
    resetDbCache();

    // Initialize schema for the new vault (runMigrations is idempotent)
    await getDb();

    // Navigate to home first to avoid stale open-entry state
    const { useUIStore } = await import('./uiStore');
    useUIStore.getState().setActiveView({ type: 'home' });

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

  removeVault: async (id: string) => {
    const { vaults, activeVaultId } = get();
    if (id === activeVaultId || vaults.length <= 1) return;
    await removeVaultFromFile(id);
    set((s) => ({ vaults: s.vaults.filter((v) => v.id !== id) }));
  },
}));
