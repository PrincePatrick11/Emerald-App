import { create } from 'zustand';
import {
  type Vault,
  loadVaultsFile,
  setActiveVaultId,
  addVault as addVaultToFile,
  updateVault as updateVaultInFile,
  applyVaultPatch,
  type VaultPatch,
  relocateVault as relocateVaultInFile,
  removeVault as removeVaultFromFile,
} from '../lib/vaultManager';
import { resetDbCache, getDb, withDbClosed } from '../lib/db';
import { clearSearchTextCache } from '../lib/searchText';
import { reloadAllStores } from './moduleWiring';
import { useUIStore } from './uiStore';
import { useUndoStore } from './undoStore';

interface VaultStore {
  vaults: Vault[];
  activeVaultId: string;
  loaded: boolean;

  loadVaults: () => Promise<void>;
  switchVault: (id: string) => Promise<void>;
  addVault: (vault: Vault) => Promise<void>;
  updateVault: (id: string, patch: VaultPatch) => Promise<void>;
  relocateVault: (id: string, path: string) => Promise<void>;
  /** Resolves to whether the vault's folder is gone — `false` when it stayed
   *  because something else still lies in it (see `delete_vault_files`). */
  removeVault: (id: string, deleteFiles?: boolean) => Promise<boolean>;
}

/**
 * Whether a vault is open.
 *
 * Membership, not list length: `switchVault` rolls `activeVaultId` back to `''`
 * when a vault cannot be opened, and then the list is not empty but nothing is
 * active either. Both mean "no database" and both belong in vault setup.
 */
export function hasActiveVault(state: Pick<VaultStore, 'vaults' | 'activeVaultId'>): boolean {
  return state.vaults.some((v) => v.id === state.activeVaultId);
}

/**
 * Opens the active vault's database and refills every store.
 *
 * The caller has already made it the active one; where to go when it cannot be
 * opened is the caller's decision — switching goes back, deleting cannot.
 */
async function openActiveVault(): Promise<void> {
  // Drop cached connections so getDb() loads the vault that is active now.
  await resetDbCache();
  // runMigrations is idempotent, so this is also what initialises a fresh vault.
  await getDb();
  // Tabs und History zeigen per Eintrags-ID in den alten Vault — alles zu,
  // nicht nur der aktive Tab auf Home.
  useUIStore.getState().closeAllTabs();
  // Undo entries reference rows of the old vault by id — drop them
  useUndoStore.getState().clear();
  // Die globale Suche haelt den Klartext jedes Eintrags unter dessen id fest.
  // Die ids des eben geschlossenen Vaults werden nie wieder erfragt, also
  // waere ihr Text ein Leck, das mit jedem Wechsel weiterwaechst.
  clearSearchTextCache();
  await reloadAllStores();
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaults: [],
  // Leer, nicht 'default': bis `loadVaults()` durch ist — und waehrend des
  // Erststarts ueberhaupt — gibt es keinen aktiven Vault, und das darf sich
  // nicht als eine Id tarnen, die die Registry vielleicht gar nicht kennt.
  activeVaultId: '',
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

    // A vault whose folder is gone fails here — and must not stay the active
    // one, or the next start comes up on a vault that cannot be opened.
    try {
      await openActiveVault();
    } catch (err) {
      await setActiveVaultId(previous);
      set({ activeVaultId: previous });
      await resetDbCache();
      throw err;
    }
  },

  addVault: async (vault: Vault) => {
    await addVaultToFile(vault);
    set((s) => ({ vaults: [...s.vaults, vault] }));
  },

  updateVault: async (id: string, patch: VaultPatch) => {
    await updateVaultInFile(id, patch);
    set((s) => ({
      vaults: s.vaults.map((v) => (v.id === id ? applyVaultPatch(v, patch) : v)),
    }));
  },

  relocateVault: async (id: string, path: string) => {
    await relocateVaultInFile(id, path);
    set((s) => ({ vaults: s.vaults.map((v) => (v.id === id ? { ...v, path } : v)) }));
  },

  removeVault: async (id: string, deleteFiles = false) => {
    if (!get().vaults.some((v) => v.id === id)) return true;
    const wasActive = id === get().activeVaultId;

    // Der Aktivwechsel gehoert in denselben Schreibvorgang wie das Entfernen:
    // dazwischen stuende in `vaults.json` sonst ein aktiver Vault, der nicht
    // mehr in seiner eigenen Liste ist — der Zustand, den
    // `getActiveVaultPath()` mit NO_ACTIVE_VAULT beantwortet. Der Nachfolger
    // steht noch nicht fest, also erst einmal an niemanden.
    let dirRemoved = true;
    const removeFromFile = async () => {
      dirRemoved = await removeVaultFromFile(id, deleteFiles, wasActive ? '' : undefined);
    };

    // Die Datei muss entsperrt sein — und es bleiben, bis sie weg ist. Sonst
    // oeffnet ein entprellter Speicher-Timer aus einem Editor genau die Datei
    // wieder, die gerade verschwinden soll. Nur der aktive Vault hat ueberhaupt
    // eine offene Verbindung; bei jedem anderen waere das Schliessen bloss eine
    // abgebrochene Abfrage im laufenden Betrieb.
    if (deleteFiles && wasActive) await withDbClosed(removeFromFile);
    else await removeFromFile();

    // Position und Restliste beide frisch: zwischen dem Eintritt und hier
    // liegen mehrere awaits, in denen ein `addVault` die Liste verlaengert
    // haben kann. Eine vorher gemerkte Position zeigte danach auf den falschen
    // Nachbarn.
    const list = get().vaults;
    const index = list.findIndex((v) => v.id === id);
    const remaining = list.filter((v) => v.id !== id);
    if (!wasActive) {
      set({ vaults: remaining });
      return dirRemoved;
    }

    // Der Nachbar rueckt nach — dieselbe Erwartung wie beim Schliessen eines
    // Tabs. Ohne Nachbarn faellt die App in die Vault-Einrichtung.
    const successor = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    if (!successor) {
      set({ vaults: remaining, activeVaultId: '' });
      return dirRemoved;
    }

    await setActiveVaultId(successor.id);
    // Ein einziges `set`: gaebe es dazwischen einen Render, in dem
    // `activeVaultId` ins Leere zeigt, raeumte `AppShell` den Shell-Inhalt ab —
    // samt des Modals, in dem gerade geloescht wird.
    set({ vaults: remaining, activeVaultId: successor.id });
    // Scheitert das Oeffnen, bleibt der Nachfolger trotzdem der aktive: er steht
    // in der Liste, das Vault-Modal bleibt stehen und zeigt den Fehler, und von
    // dort aus laesst er sich neu verorten oder ein anderer waehlen. Auf ''
    // zurueckzufallen hiesse, den Nutzer wortlos in die Einrichtung zu werfen.
    await openActiveVault();
    return dirRemoved;
  },
}));
