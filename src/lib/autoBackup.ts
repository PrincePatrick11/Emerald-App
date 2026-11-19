import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { keyErrorOf } from './vaultKeys';
import { useVaultStore } from '../store/vaultStore';
import {
  useAutoBackupStore,
  type AutoBackupSettings, type VaultBackupStatus,
} from '../store/autoBackupStore';

/**
 * The automatic backup, as the start page sets and shows it.
 *
 * The schedule and the backups themselves are Rust's (`auto_backup.rs`,
 * `raw_backup.rs`): every chosen vault, as a raw backup, as long as the app
 * runs — whichever vault is open, also locked ones. Here the setting is read
 * and written, and the status follows the event Rust sends after each run.
 * No path is ever passed from here: the folder comes from the dialog Rust
 * opens itself.
 */

/** Emitted by `auto_backup.rs` whenever a run starts or ends. */
const CHANGED_EVENT = 'auto-backup-changed';

function vaultIds(): string[] {
  return useVaultStore.getState().vaults.map((v) => v.id);
}

function setSettings(settings: AutoBackupSettings): void {
  useAutoBackupStore.setState({ settings });
}

/** Re-reads where each vault's backups go, its newest and its last run. */
export async function refreshAutoBackupStatus(): Promise<void> {
  const list = await invoke<VaultBackupStatus[]>('auto_backup_status', { vaultIds: vaultIds() });
  const before = useAutoBackupStore.getState();
  const statuses = Object.fromEntries(list.map((s) => [s.vaultId, s]));
  // A new failure shows the dot again; the same one on the hourly repeat does not.
  const newError = list.some((s) => s.error && before.statuses[s.vaultId]?.error !== s.error);
  useAutoBackupStore.setState({ statuses, ...(newError && { errorSeen: false }) });
}

/** Re-reads the setting and the status. */
export async function refreshAutoBackup(): Promise<void> {
  setSettings(await invoke<AutoBackupSettings>('auto_backup_settings'));
  await refreshAutoBackupStatus();
}

/** The saves in their order: each builds on what the one before left. */
let saving: Promise<unknown> = Promise.resolve();

/**
 * Changes vaults, interval, weekday or retention; the folder has its own
 * calls. The change shows at once and the saves run one after the other, so
 * two quick clicks keep both. `change` gets the setting as it is by then.
 */
export function saveAutoBackupSettings(
  change: (current: AutoBackupSettings) => Partial<Pick<AutoBackupSettings, 'vaults' | 'interval' | 'weekday' | 'keep'>>,
): Promise<void> {
  const run = saving.catch(() => {}).then(async () => {
    const current = useAutoBackupStore.getState().settings ?? await invoke<AutoBackupSettings>('auto_backup_settings');
    const next = { ...current, ...change(current) };
    setSettings(next);
    try {
      setSettings(await invoke<AutoBackupSettings>('set_auto_backup_settings', {
        vaults: next.vaults,
        interval: next.interval,
        weekday: next.weekday,
        keep: next.keep,
      }));
    } catch (err) {
      // Not saved: show what the file holds.
      await refreshAutoBackup().catch(() => {});
      throw err;
    }
  });
  saving = run;
  return run;
}

/** Takes a vault out of the backup — when it leaves the list. */
export async function dropFromAutoBackup(vaultId: string): Promise<void> {
  await saveAutoBackupSettings((current) => ({ vaults: current.vaults.filter((id) => id !== vaultId) }));
}

/** Opens the folder dialog (in Rust) and remembers the choice. `false` on cancel. */
export async function pickAutoBackupDir(): Promise<boolean> {
  const picked = await invoke<string | null>('pick_auto_backup_dir');
  if (picked === null) return false;
  await refreshAutoBackup();
  return true;
}

/** Back to each vault's own `backups/` folder. */
export async function resetAutoBackupDir(): Promise<void> {
  await invoke('reset_auto_backup_dir');
  await refreshAutoBackup();
}

/**
 * "Back up now": today's backup of one vault, due or not. Rust waits out a
 * run of it that is going on; the error lands in the status like any run's.
 */
export async function backUpNow(vaultId: string): Promise<void> {
  if (useAutoBackupStore.getState().requested.includes(vaultId)) return;
  useAutoBackupStore.setState((s) => ({ requested: [...s.requested, vaultId] }));
  try {
    await invoke('back_up_vault_now', { vaultId });
  } catch (err) {
    console.error('[auto-backup] backing up now failed', keyErrorOf(err));
  } finally {
    useAutoBackupStore.setState((s) => ({ requested: s.requested.filter((id) => id !== vaultId) }));
    await refreshAutoBackupStatus().catch(() => {});
  }
}

/** The dot on the start page button has done its job. */
export function markAutoBackupErrorSeen(): void {
  useAutoBackupStore.setState({ errorSeen: true });
}

/**
 * Follows the automatic backup for the duration of the session: its status
 * after every run Rust reports, and after every change of the vault list.
 * The return value stops it.
 */
export function startAutoBackup(): () => void {
  let stopped = false;
  const refresh = () => {
    if (!stopped) refreshAutoBackup().catch((e: unknown) => console.error('[auto-backup] status failed', e));
  };
  const unlisten = listen(CHANGED_EVENT, () => {
    if (!stopped) refreshAutoBackupStatus().catch((e: unknown) => console.error('[auto-backup] status failed', e));
  });
  const unsubscribe = useVaultStore.subscribe((state, prev) => {
    if (state.vaults !== prev.vaults) refresh();
  });
  refresh();
  return () => {
    stopped = true;
    unsubscribe();
    void unlisten.then((stop) => stop());
  };
}
