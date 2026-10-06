import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
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
import { clearEntrySummaryCache } from '../lib/blocks/entrySummary';
import { drainSerialized } from '../lib/serialize';
import { reloadAllStores } from './moduleWiring';
import { useUIStore } from './uiStore';
import { detachDrafts, restoreDrafts } from './draftStore';
import { clearAltarEdits } from './altarEdit';
import { detachVaultPrefs, forgetVaultPrefs, loadVaultPrefs } from './vaultPrefs';
import { useUndoStore } from './undoStore';
import { useSettingsStore } from './settingsStore';
import { captureLegacySettings } from '../lib/vaultSettings';
import { resolveOpenEdits } from '../lib/openEdits';
import { changeVaultPassword, keyErrorOf, lockVault, type CreatedKey } from '../lib/vaultKeys';
import { ensureVaultReady, VAULT_KEY_CANCELLED } from './vaultKeyStore';

interface VaultStore {
  vaults: Vault[];
  activeVaultId: string;
  loaded: boolean;

  loadVaults: () => Promise<void>;
  /**
   * `false`, wenn nicht gewechselt wurde, weil eine laufende Bearbeitung
   * weitergehen soll (`resolveOpenEdits`). `editsResolved`: der Aufrufer hat
   * das schon geklärt — der Import, der seine Frage vor allem anderen stellt.
   */
  switchVault: (id: string, options?: { editsResolved?: boolean }) => Promise<boolean>;
  addVault: (vault: Vault) => Promise<void>;
  updateVault: (id: string, patch: VaultPatch) => Promise<void>;
  relocateVault: (id: string, path: string) => Promise<void>;
  /** Resolves to whether the vault's folder is gone — `false` when it stayed
   *  because something else still lies in it (see `delete_vault_files`). */
  removeVault: (id: string, deleteFiles?: boolean) => Promise<boolean>;
  /**
   * Gesperrt und noch nicht wieder entsperrt — `AppShell` zeigt dann nur den
   * Rahmen, damit hinter der Passwortfrage kein Inhalt stehen bleibt.
   */
  locked: boolean;
  /**
   * Neues Passwort, neuer Vault-Schlüssel (`reencrypt.rs`). Danach ist alles
   * neu geladen — die Bilder heißen anders. `null`, wenn eine laufende
   * Bearbeitung weitergehen soll.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<(CreatedKey & { reopenFailed?: true }) | null>;
  /** Sperrt den offenen Vault und fragt sofort nach dem Passwort — auch wenn er gemerkt ist. */
  lockActive: () => Promise<void>;
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

/** The open vault's record, if there is one. */
export function activeVault(state: Pick<VaultStore, 'vaults' | 'activeVaultId'>): Vault | undefined {
  return state.vaults.find((v) => v.id === state.activeVaultId);
}

/**
 * Opens the active vault's database and refills every store.
 *
 * The caller has already made it the active one; where to go when it cannot be
 * opened is the caller's decision — switching goes back, deleting cannot.
 */
async function openActiveVault({ askPassword = false }: { askPassword?: boolean } = {}): Promise<void> {
  // Eingereihte Store-Writes des alten Vaults zu Ende bringen, bevor die
  // Verbindung darunter geschlossen wird.
  await drainSerialized();
  // Drop cached connections so getDb() loads the vault that is active now.
  await resetDbCache();
  // Entsperren oder — bei einem neuen Vault — das Passwort festlegen. Wer
  // hier abbricht, landet im Fehlerzweig des Aufrufers.
  const active = activeVault(useVaultStore.getState());
  if (active) await ensureVaultReady(active, { askPassword });
  // Vor getDb(): die Migrationen beim Öffnen brauchen schon die Sprache des
  // neuen Vaults (siehe `loadForVault`). Ein fehlender Vault-Ordner scheitert
  // bereits hier.
  await useSettingsStore.getState().loadForVault(useVaultStore.getState().activeVaultId);
  // runMigrations is idempotent, so this is also what initialises a fresh vault.
  await getDb();
  // Tabs und History zeigen per Eintrags-ID in den alten Vault — alles zu,
  // nicht nur der aktive Tab auf Home.
  useUIStore.getState().closeAllTabs();
  clearAltarEdits();
  loadVaultPrefs(useVaultStore.getState().activeVaultId);
  // Die Entwürfe des neuen Vaults; die des alten gehen nur aus dem Speicher.
  await restoreDrafts(useVaultStore.getState().activeVaultId);
  // Undo entries reference rows of the old vault by id — drop them
  useUndoStore.getState().dismiss();
  // Die globale Suche haelt den Klartext jedes Eintrags unter dessen id fest.
  // Die ids des eben geschlossenen Vaults werden nie wieder erfragt, also
  // waere ihr Text ein Leck, das mit jedem Wechsel weiterwaechst.
  clearSearchTextCache();
  clearEntrySummaryCache();
  await reloadAllStores();
}

/**
 * Kein Vault ist offen: das Vault-Fenster übernimmt, Einstellungen und
 * Listen gelten wieder als Standard. `vaults.json` behält den aktiven Vault —
 * der nächste Start fragt wieder nach ihm.
 */
async function closeToSetup(): Promise<void> {
  useVaultStore.setState({ activeVaultId: '' });
  await useSettingsStore.getState().clear();
  detachVaultPrefs();
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaults: [],
  // Leer, nicht 'default': bis `loadVaults()` durch ist — und waehrend des
  // Erststarts ueberhaupt — gibt es keinen aktiven Vault, und das darf sich
  // nicht als eine Id tarnen, die die Registry vielleicht gar nicht kennt.
  activeVaultId: '',
  loaded: false,
  locked: false,

  loadVaults: async () => {
    const data = await loadVaultsFile();
    captureLegacySettings(data.vaults.map((v) => v.id));
    set({ vaults: data.vaults, activeVaultId: data.activeVaultId, loaded: true });
  },

  switchVault: async (id, { editsResolved = false } = {}) => {
    const previous = get().activeVaultId;
    if (id === previous) return true;
    // Der Wechsel schließt jeden Tab — erst klären, was mit laufenden Bearbeitungen geschieht.
    if (!editsResolved && !(await resolveOpenEdits())) return false;

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
      // Die Einstellungen des gescheiterten Vaults können schon gegriffen
      // haben. Lassen sich die alten nicht zurückholen, schreibt der Store
      // nirgendwohin mehr — sonst landete die nächste Änderung im falschen Vault.
      const restored = hasActiveVault(get()) && await useSettingsStore.getState().loadForVault(previous).then(
        () => true,
        (e) => { console.error('[vault] could not restore settings', e); return false; },
      );
      if (!restored) await useSettingsStore.getState().clear();
      // Auch die Entwürfe wieder dem alten Vault zuordnen — sonst schriebe
      // die nächste Änderung in den Ordner des gescheiterten.
      if (hasActiveVault(get())) {
        await restoreDrafts(previous);
        loadVaultPrefs(previous);
      } else {
        detachVaultPrefs();
      }
      // Entsperrt und dann doch nicht geöffnet (etwa eine scheiternde
      // Migration): der Schlüssel bleibt nicht im Speicher liegen.
      void lockVault(id).catch((e) => console.warn('[vault] lock failed', e));
      throw err;
    }
    // Der verlassene Vault wird gesperrt: sein Schlüssel bleibt nicht im
    // Speicher, solange ein anderer offen ist.
    if (previous) void lockVault(previous).catch((e) => console.warn('[vault] lock failed', e));
    return true;
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
    // Vor dem Entfernen: ein aufgeschobenes Mitschreiben legte sonst eine
    // `drafts.json` in den Ordner, der gerade verschwinden soll.
    if (wasActive) await detachDrafts();

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
    forgetVaultPrefs(id);
    // Der für das automatische Backup gewählte Ordner gehört zur Installation
    // (`auto_backup.rs`) und bliebe sonst für immer stehen. Erst jetzt: scheitert
    // das Entfernen, behält der Vault seinen Ordner. Direkt und nicht über
    // `resetAutoBackupDir` — dessen Status-Abfrage gälte einem Vault, den es nicht mehr gibt.
    void invoke('reset_auto_backup_dir', { vaultId: id })
      .catch((e: unknown) => console.warn('[vault] forget backup folder failed', e));
    // Ein entfernter Vault ist auch gesperrt — mit den Dateien hat Rust den
    // Schlüssel schon vergessen, ohne sie bliebe er sonst im Speicher.
    void lockVault(id).catch((e) => console.warn('[vault] lock failed', e));

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
      // Wie im Fehlerfall oben: ohne Vault gelten wieder die Standards.
      await useSettingsStore.getState().clear();
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
    // Anders, wenn der Nutzer selbst das Entsperren des Nachfolgers abbricht:
    // dann ist kein Vault offen, und die Einrichtung ist die ehrliche Antwort.
    try {
      await openActiveVault();
    } catch (err) {
      if (keyErrorOf(err) !== VAULT_KEY_CANCELLED) throw err;
      await closeToSetup();
    }
    return dirRemoved;
  },

  changePassword: async (currentPassword, newPassword) => {
    const id = get().activeVaultId;
    // Wie ein Wechsel: offene Bearbeitungen klären, Entwürfe wegschreiben —
    // die Neuverschlüsselung schreibt sie unter neuem Schlüssel neu.
    if (!(await resolveOpenEdits())) return null;
    await drainSerialized();
    await detachDrafts();
    let result: CreatedKey;
    try {
      result = await withDbClosed(() => changeVaultPassword(id, currentPassword, newPassword));
    } catch (err) {
      // Ein Fehler kommt nur vor dem Commit (danach liefert Rust den neuen
      // Schlüssel in jedem Fall): der Vault ist, wie er war, und öffnet beim
      // nächsten `getDb()` mit dem alten Schlüssel.
      await restoreDrafts(id);
      throw err;
    }
    // Der neue Wiederherstellungsschlüssel geht in jedem Fall zurück — auch
    // wenn das Neuladen scheitert: der Vault steht ab jetzt unter ihm.
    try {
      await openActiveVault();
      return result;
    } catch (err) {
      console.error('[vault] reopen after password change failed', err);
      if (keyErrorOf(err) === VAULT_KEY_CANCELLED) await closeToSetup();
      return { ...result, reopenFailed: true };
    }
  },

  lockActive: async () => {
    if (!(await resolveOpenEdits())) return;
    await drainSerialized();
    await detachDrafts();
    const id = get().activeVaultId;
    set({ locked: true });
    try {
      await withDbClosed(() => lockVault(id));
      await openActiveVault({ askPassword: true });
    } catch (err) {
      // Nicht entsperrt — abgebrochen oder gescheitert: kein Vault ist offen,
      // das Vault-Fenster übernimmt. Nie zurück zum alten Inhalt ohne Datenbank.
      if (keyErrorOf(err) !== VAULT_KEY_CANCELLED) console.error('[vault] lock failed', err);
      await closeToSetup();
    } finally {
      set({ locked: false });
    }
  },
}));
