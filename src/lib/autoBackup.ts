import { invoke } from '@tauri-apps/api/core';
import { dbEpoch } from './db';
import { drainSerialized } from './serialize';
import { editorSavesSuspended } from './editorLock';
import { localIsoDay } from './helpers';
import { keyErrorOf, vaultKeyStatus } from './vaultKeys';
import type { BackupSettings } from './vaultSettings';
import { useSettingsStore } from '../store/settingsStore';
import { hasActiveVault, useVaultStore } from '../store/vaultStore';
import { editLockEpoch, useUIStore } from '../store/uiStore';
import { useAutoBackupStore, type AutoBackupError, type AutoBackupStatus } from '../store/autoBackupStore';

/**
 * The automatic backup: when one is due, and the run itself.
 *
 * There is no background service — the check happens while the app is open
 * and the vault is unlocked: shortly after a vault is opened, after every
 * change of the setting or the folder, then hourly — and once more
 * when an attempt hit a running run, an import or a
 * move to another module. Where it is written and under which name is decided
 * solely by `auto_backup.rs`; no path is ever passed
 * over from here.
 */

/** Delay after opening the vault and after the last change of the setting or the folder: the
 *  start belongs to loading, and anyone clicking through buttons only triggers one run.
 *  Also the delay after which a `'busy'` is retried. */
const SETTLE_MS = 5_000;
/** For sessions that stay open across a change of day. */
const RECHECK_MS = 60 * 60 * 1000;

/** Expected from `auto_backup.rs` when the chosen folder is missing. */
const DIR_MISSING = 'AUTO_BACKUP_DIR_MISSING';
/** Thrown by `getDb()` while the database is deliberately closed (`withDbClosed`). */
const DB_CLOSED = 'DB_CLOSED';

/**
 * Whether a backup is pending. `newest` and `today` are local days (`YYYY-MM-DD`),
 * both from the same clock in Rust. Due means: since the last scheduled date there
 * is none yet — so a missed date is made up at the next open,
 * and with no backup at all one is due immediately.
 */
export function isBackupDue(settings: Pick<BackupSettings, 'interval' | 'weekday'>, newest: string | null, today: string): boolean {
  if (!newest) return true;
  if (settings.interval === 'daily') return newest < today;
  // The first of this month.
  if (settings.interval === 'monthly') return newest < `${today.slice(0, 8)}01`;
  // The most recent chosen weekday, today included.
  const [y, m, d] = today.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  day.setDate(day.getDate() - ((day.getDay() - settings.weekday + 7) % 7));
  return newest < localIsoDay(day);
}

// `errorSeen` only means something while `error` is set — so only this file
// writes the two, and never `error` without `errorSeen`.

function setError(vaultId: string, error: AutoBackupError): void {
  useAutoBackupStore.setState((s) => {
    // The state of another vault does not belong next to this error.
    if (s.vaultId !== vaultId) return { vaultId, status: null, error, errorSeen: false };
    // The same error on the hourly repeat does not bring the dot back.
    return { error, errorSeen: s.error === error ? s.errorSeen : false };
  });
}

function clearError(vaultId: string): void {
  if (useAutoBackupStore.getState().vaultId === vaultId) useAutoBackupStore.setState({ error: null, errorSeen: false });
}

/** The dot on the gear has done its job. */
export function markAutoBackupErrorSeen(): void {
  useAutoBackupStore.setState({ errorSeen: true });
}

/**
 * Re-reads the target folder and the newest backup of the vault into the store.
 * If another vault is open by now, the store stays as it is — otherwise
 * the end of a run would overwrite the successor's state.
 */
export async function refreshAutoBackupStatus(vaultId: string): Promise<AutoBackupStatus> {
  const status = await invoke<AutoBackupStatus>('auto_backup_status', { vaultId });
  if (useVaultStore.getState().activeVaultId !== vaultId) return status;
  useAutoBackupStore.setState((s) => {
    if (s.vaultId !== vaultId) return { vaultId, status, error: null, errorSeen: false };
    // The folder is back or another one was chosen: the message about it is obsolete.
    return !status.missing && s.error === 'dirMissing' ? { status, error: null, errorSeen: false } : { status };
  });
  return status;
}

/** Opens the folder dialog (in Rust) and remembers the choice. `false` on cancel. */
export async function pickAutoBackupDir(vaultId: string): Promise<boolean> {
  const picked = await invoke<string | null>('pick_auto_backup_dir', { vaultId });
  if (picked === null) return false;
  await refreshAutoBackupStatus(vaultId);
  return true;
}

/** Back to the vault's `backup/` folder. */
export async function resetAutoBackupDir(vaultId: string): Promise<void> {
  await invoke('reset_auto_backup_dir', { vaultId });
  await refreshAutoBackupStatus(vaultId);
}

/**
 * Writes a backup of the open vault if one is due — with `force`
 * otherwise too ("Back up now"). Silently does nothing while no vault is open
 * and unlocked.
 *
 * `'done'`: finished for now — written, not due, not responsible or
 * failed (the error is then in the store). `'busy'`: it did not work right now —
 * a run is in progress, an import holds the database, a move to another module is writing,
 * or it was closed or replaced during the run — and a new attempt is worthwhile.
 */
export async function runAutoBackup({ force = false }: { force?: boolean } = {}): Promise<'done' | 'busy'> {
  const vaultState = useVaultStore.getState();
  const vaultId = vaultState.activeVaultId;
  if (!hasActiveVault(vaultState) || vaultState.locked) return 'done';
  // The settings of another vault must never back up this one (like `trashRetentionFor`).
  const settingsState = useSettingsStore.getState();
  if (settingsState.vaultId !== vaultId) return 'done';
  const { backup } = settingsState.settings;
  if (!force && !backup.auto) return 'done';
  // `editorSavesSuspended`: an import is running (see `editorLock.ts`).
  if (useAutoBackupStore.getState().running || editorSavesSuspended()) return 'busy';
  // A move to another module or a cancel that rolls one back writes across
  // several tables and only queues that after its own awaits — `drainSerialized`
  // below would not see it yet. The edit lock covers the whole stretch
  // (it holds every cancel, the simple one too).
  if (useUIStore.getState().editLocked) return 'busy';

  // Counts every closing or replacing of the database (`dbEpoch`): a password change
  // or import that begins *and* ends in the middle of the run would otherwise look like quiet at the end —
  // and the backup would contain only what was read before the swap.
  const epoch = dbEpoch();
  const lockEpoch = editLockEpoch();
  /** The vault is still the same, and what was read is all of a piece. */
  const stillCurrent = () => {
    const now = useVaultStore.getState();
    const sameVault = now.activeVaultId === vaultId && !now.locked;
    const sameDb = !editorSavesSuspended() && dbEpoch() === epoch;
    // The counter is the real test: it also catches a lock that began and ended
    // in the middle of the run — the state would then be half rewritten.
    const noEditLock = !useUIStore.getState().editLocked && editLockEpoch() === lockEpoch;
    return sameVault && sameDb && noEditLock;
  };

  useAutoBackupStore.setState({ running: true });
  try {
    if (!(await vaultKeyStatus(vaultId)).unlocked) return 'done';
    const status = await refreshAutoBackupStatus(vaultId);
    if (status.missing) {
      setError(vaultId, 'dirMissing');
      return 'done';
    }
    if (!force && !isBackupDue(backup, status.newest, status.today)) return 'done';

    await drainSerialized();
    // Dynamic: `dbBackup` should stay out of the main chunk (see LeftSidebarRail).
    const { buildBackup, FULL_BACKUP_OPTIONS } = await import('./dbBackup');
    const content = JSON.stringify(await buildBackup(FULL_BACKUP_OPTIONS));
    if (!stillCurrent()) return 'busy';

    await invoke('write_auto_backup', { vaultId, content, keep: backup.keep });
    clearError(vaultId);
    await refreshAutoBackupStatus(vaultId);
    return 'done';
  } catch (err) {
    // Vault locked or switched, in the middle of an import, password or
    // move to another module: not an error, the next attempt reads a quiet state again.
    if (!stillCurrent() || keyErrorOf(err).includes(DB_CLOSED)) return 'busy';
    console.error('[auto-backup] failed', err);
    setError(vaultId, keyErrorOf(err).includes(DIR_MISSING) ? 'dirMissing' : 'failed');
    return 'done';
  } finally {
    useAutoBackupStore.setState({ running: false });
  }
}

/** How long "Back up now" waits for an import, a move or running run:
 *  30 attempts one second apart. */
const NOW_RETRY_MS = 1_000;
const NOW_ATTEMPTS = 30;

/**
 * "Back up now": writes today's backup, even if none is due.
 * If the click hits an import, a move to another module or a running
 * run, it waits that out instead of fizzling — and reports an error if
 * it still did not work after half a minute.
 */
export async function backUpNow(): Promise<void> {
  // In the store and not in the button: the job survives a closed
  // settings window, and a second click does not start a second one.
  if (useAutoBackupStore.getState().requested) return;
  const vaultId = useVaultStore.getState().activeVaultId;
  // Another vault by now: the job was for the old one — neither back it up nor report an error to it.
  const sameVault = () => useVaultStore.getState().activeVaultId === vaultId;
  useAutoBackupStore.setState({ requested: true });
  try {
    for (let attempt = 0; attempt < NOW_ATTEMPTS; attempt++) {
      if (!sameVault()) return;
      if ((await runAutoBackup({ force: true })) === 'done') return;
      await new Promise((resolve) => setTimeout(resolve, NOW_RETRY_MS));
    }
    if (sameVault()) setError(vaultId, 'failed');
  } finally {
    useAutoBackupStore.setState({ requested: false });
  }
}

/** The trigger of the running session, while `startAutoBackup` is active. */
let scheduleCheck: (() => void) | null = null;

/**
 * Checks in a few seconds whether a backup is due — for triggers from
 * outside (a new folder) that may hit a running run.
 * Without a running session (`startAutoBackup`) nothing happens.
 */
export function requestAutoBackupCheck(): void {
  scheduleCheck?.();
}

/**
 * Starts the check for the duration of the session; the return value stops it.
 * The trigger is the settings store: it reports every opened vault
 * (`loadForVault`) and every change of the backup setting; a new folder
 * comes in via `requestAutoBackupCheck`.
 */
export function startAutoBackup(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    // A run that only returns after stopping no longer sets a timer.
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(check, SETTLE_MS);
  };
  // A trigger that hits a running run, an import or a
  // move to another module would otherwise be lost — until the next full hour.
  const check = () => void runAutoBackup().then((outcome) => { if (outcome === 'busy') schedule(); });
  const unsubscribe = useSettingsStore.subscribe((state, prev) => {
    if (state.vaultId !== prev.vaultId || state.settings.backup !== prev.settings.backup) schedule();
  });
  const interval = setInterval(check, RECHECK_MS);
  scheduleCheck = schedule;
  schedule();
  return () => {
    stopped = true;
    // Only our own: a later start may have replaced it already.
    if (scheduleCheck === schedule) scheduleCheck = null;
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
  };
}
