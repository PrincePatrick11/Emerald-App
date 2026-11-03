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
import { backupBeforeReplacing, keepPendingForNewPassword, prepareOpenedVault, syncNow } from '../lib/sync/engine';

interface VaultStore {
  vaults: Vault[];
  activeVaultId: string;
  loaded: boolean;

  loadVaults: () => Promise<void>;
  /**
   * `false` if no switch happened because a running edit
   * should continue (`resolveOpenEdits`). `editsResolved`: the caller has
   * already settled that — the import, which asks its question before anything else.
   */
  switchVault: (id: string, options?: { editsResolved?: boolean }) => Promise<boolean>;
  addVault: (vault: Vault) => Promise<void>;
  updateVault: (id: string, patch: VaultPatch) => Promise<void>;
  relocateVault: (id: string, path: string) => Promise<void>;
  /** Resolves to whether the vault's folder is gone — `false` when it stayed
   *  because something else still lies in it (see `delete_vault_files`). */
  removeVault: (id: string, deleteFiles?: boolean) => Promise<boolean>;
  /**
   * Locked and not yet unlocked again — `AppShell` then shows only the
   * frame, so that no content remains behind the password prompt.
   */
  locked: boolean;
  /**
   * New password, new vault key (`reencrypt.rs`). Afterwards everything is
   * reloaded — the images are named differently. `null` if a running
   * edit should continue.
   */
  /** The password changed on another device: this copy starts over under it. */
  adoptServerPassword: (password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<(CreatedKey & { reopenFailed?: true }) | null>;
  /** Locks the open vault and asks for the password right away — even if it is remembered. */
  lockActive: () => Promise<void>;
}

/**
 * Whether a vault is open.
 *
 * Membership, not list length: `switchVault` rolls `activeVaultId` back to `''`
 * when a vault cannot be opened, and then the list is not empty but nothing is
 * active either. Both mean "no database" and both belong in the vault picker.
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
  // Finish queued store writes of the old vault before the
  // connection beneath them is closed.
  await drainSerialized();
  // Drop cached connections so getDb() loads the vault that is active now.
  await resetDbCache();
  // Unlock or — for a new vault — set the password. Anyone who
  // cancels here ends up in the caller's error branch.
  const active = activeVault(useVaultStore.getState());
  if (active) await ensureVaultReady(active, { askPassword });
  // Before getDb(): the migrations on opening already need the new vault's
  // language (see `loadForVault`). A missing vault folder already fails
  // here.
  await useSettingsStore.getState().loadForVault(useVaultStore.getState().activeVaultId);
  // runMigrations is idempotent, so this is also what initialises a fresh vault.
  await getDb();
  // Tabs and history point into the old vault by entry ID — close everything,
  // not just the active tab to Home.
  useUIStore.getState().closeAllTabs();
  clearAltarEdits();
  loadVaultPrefs(useVaultStore.getState().activeVaultId);
  // The drafts of the new vault; those of the old one only leave memory.
  await restoreDrafts(useVaultStore.getState().activeVaultId);
  // Undo entries reference rows of the old vault by id — drop them
  useUndoStore.getState().dismiss();
  // The global search holds the plain text of every entry under its id.
  // The ids of the vault just closed are never asked for again, so
  // their text would be a leak that grows with every switch.
  clearSearchTextCache();
  clearEntrySummaryCache();
  await prepareOpenedVault(useVaultStore.getState().activeVaultId);
  await reloadAllStores();
}

/**
 * No vault is open: the vault picker takes over, settings and
 * lists revert to the defaults. `vaults.json` keeps the active vault —
 * the next start asks for it again.
 */
export async function closeToSetup(): Promise<void> {
  useVaultStore.setState({ activeVaultId: '' });
  await useSettingsStore.getState().clear();
  detachVaultPrefs();
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaults: [],
  // Empty, not 'default': until `loadVaults()` is done — and during the
  // first start altogether — there is no active vault, and that must not
  // disguise itself as an id the registry may not know at all.
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
    // The switch closes every tab — first settle what happens to running edits.
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
      // The settings of the failed vault may have already taken hold.
      // If the old ones cannot be restored, the store writes
      // nowhere any more — otherwise the next change would land in the wrong vault.
      const restored = hasActiveVault(get()) && await useSettingsStore.getState().loadForVault(previous).then(
        () => true,
        (e) => { console.error('[vault] could not restore settings', e); return false; },
      );
      if (!restored) await useSettingsStore.getState().clear();
      // Reassign the drafts to the old vault as well — otherwise
      // the next change would write into the failed vault's folder.
      if (hasActiveVault(get())) {
        await restoreDrafts(previous);
        loadVaultPrefs(previous);
      } else {
        detachVaultPrefs();
      }
      // Unlocked and then not opened after all (e.g. a failing
      // migration): the key does not stay in memory.
      void lockVault(id).catch((e) => console.warn('[vault] lock failed', e));
      throw err;
    }
    // The vault being left is locked: its key does not stay in
    // memory while another one is open.
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
    // Before removing: a deferred draft write would otherwise place a
    // `drafts.json` in the folder that is about to disappear.
    if (wasActive) await detachDrafts();

    // The change of active vault belongs in the same write as the removal:
    // in between, `vaults.json` would otherwise hold an active vault that is no
    // longer in its own list — the state that
    // `getActiveVaultPath()` answers with NO_ACTIVE_VAULT. The successor
    // is not decided yet, so for now to nobody.
    let dirRemoved = true;
    const removeFromFile = async () => {
      dirRemoved = await removeVaultFromFile(id, deleteFiles, wasActive ? '' : undefined);
    };

    // The file must be unlocked — and stay so until it is gone. Otherwise
    // a debounced save timer from an editor reopens exactly the file
    // that is about to disappear. Only the active vault has an open
    // connection at all; for any other, closing would merely be an
    // aborted query in the middle of operation.
    if (deleteFiles && wasActive) await withDbClosed(removeFromFile);
    else await removeFromFile();
    forgetVaultPrefs(id);
    // The folder chosen for the automatic backup belongs to the installation
    // (`auto_backup.rs`) and would otherwise linger forever. Only now: if
    // the removal fails, the vault keeps its folder. Directly and not via
    // `resetAutoBackupDir` — its status query would concern a vault that no longer exists.
    void invoke('reset_auto_backup_dir', { vaultId: id })
      .catch((e: unknown) => console.warn('[vault] forget backup folder failed', e));
    // A removed vault is locked too — with the files Rust has already forgotten
    // the key; without them it would otherwise stay in memory.
    void lockVault(id).catch((e) => console.warn('[vault] lock failed', e));

    // Position and remaining list both fresh: between entry and here
    // there are several awaits in which an `addVault` may have lengthened the list.
    // A position remembered beforehand would afterwards point at the wrong
    // neighbour.
    const list = get().vaults;
    const index = list.findIndex((v) => v.id === id);
    const remaining = list.filter((v) => v.id !== id);
    if (!wasActive) {
      set({ vaults: remaining });
      return dirRemoved;
    }

    // The neighbour moves up — the same expectation as when closing a
    // tab. Without a neighbour the app falls into the vault picker.
    const successor = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    if (!successor) {
      set({ vaults: remaining, activeVaultId: '' });
      // As in the error case above: without a vault the defaults apply again.
      await useSettingsStore.getState().clear();
      return dirRemoved;
    }

    await setActiveVaultId(successor.id);
    // A single `set`: if there were a render in between in which
    // `activeVaultId` points into the void, `AppShell` would clear the shell content —
    // including the modal in which the deletion is currently happening.
    set({ vaults: remaining, activeVaultId: successor.id });
    // If opening fails, the successor still remains the active one: it is in
    // the list, the vault picker stays up and shows the error, and from
    // there it can be relocated or another chosen. Falling back to ''
    // would mean throwing the user into the setup without a word.
    // Different if the user themself cancels unlocking the successor:
    // then no vault is open, and the setup is the honest answer.
    try {
      await openActiveVault();
    } catch (err) {
      if (keyErrorOf(err) !== VAULT_KEY_CANCELLED) throw err;
      await closeToSetup();
    }
    return dirRemoved;
  },

  adoptServerPassword: async (password) => {
    const id = get().activeVaultId;
    if (!(await resolveOpenEdits())) return;
    await drainSerialized();
    await keepPendingForNewPassword();
    await backupBeforeReplacing(id);
    await detachDrafts();
    try {
      await withDbClosed(() => invoke('sync_adopt_new_password', { vaultId: id, password }));
    } catch (err) {
      // A wrong password changed nothing: the vault opens with its old key.
      await restoreDrafts(id);
      throw err;
    }
    await openActiveVault();
  },

  changePassword: async (currentPassword, newPassword) => {
    const id = get().activeVaultId;
    // Like a switch: settle open edits, write drafts out —
    // the re-encryption rewrites them under the new key.
    if (!(await resolveOpenEdits())) return null;
    // What other devices did since the last round would be lost in the snapshot
    // that follows. Offline it stays a risk, not a reason to refuse.
    await syncNow();
    await drainSerialized();
    await detachDrafts();
    let result: CreatedKey;
    try {
      result = await withDbClosed(() => changeVaultPassword(id, currentPassword, newPassword));
    } catch (err) {
      // An error only occurs before the commit (afterwards Rust returns the new
      // key in any case): the vault is as it was, and opens on the
      // next `getDb()` with the old key.
      await restoreDrafts(id);
      throw err;
    }
    // The new recovery key is returned in any case — even
    // if the reload fails: the vault is under it from now on.
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
      // Not unlocked — cancelled or failed: no vault is open,
      // the vault picker takes over. Never back to the old content without a database.
      if (keyErrorOf(err) !== VAULT_KEY_CANCELLED) console.error('[vault] lock failed', err);
      await closeToSetup();
    } finally {
      set({ locked: false });
    }
  },
}));
