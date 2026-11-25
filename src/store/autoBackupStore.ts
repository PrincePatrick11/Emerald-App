import { create } from 'zustand';
import type { Weekday } from '../lib/formatDate';

/** How often the automatic backup runs — whole days only, the file name carries the date. */
export const BACKUP_INTERVAL_OPTIONS = ['daily', 'weekly', 'monthly'] as const;
export type BackupInterval = (typeof BACKUP_INTERVAL_OPTIONS)[number];
/** How many automatic backups of each vault are kept; `null` = all. The
 *  numbers are checked once more by `KEEP_CHOICES` in `auto_backup.rs` —
 *  change both together. */
export const BACKUP_KEEP_OPTIONS = [3, 5, 10, 30, null] as const;
export type BackupKeep = (typeof BACKUP_KEEP_OPTIONS)[number];

/** Mirrors `AutoBackupSettings` in `src-tauri/src/auto_backup.rs`. */
export interface AutoBackupSettings {
  /** The vaults that are backed up. */
  vaults: string[];
  interval: BackupInterval;
  /** Applies to `weekly` only. */
  weekday: Weekday;
  keep: BackupKeep;
  /** The folder chosen by the user; `null` while each vault's own `backups/` applies. */
  customDir: string | null;
  /** The chosen folder is currently unreachable. */
  dirMissing: boolean;
}

/** What the last run of a vault came to — kept as a code and translated on render. */
export type AutoBackupError = 'dirMissing' | 'vaultMissing' | 'interrupted' | 'keyMissing' | 'failed';

/** Mirrors `VaultBackupStatus` in `auto_backup.rs`. */
export interface VaultBackupStatus {
  vaultId: string;
  /** Where its backups go. */
  dir: string;
  /** Day of its most recent automatic backup, `YYYY-MM-DD`. */
  newest: string | null;
  running: boolean;
  error: AutoBackupError | null;
}

interface AutoBackupState {
  settings: AutoBackupSettings | null;
  /** By vault ID, for every vault of the list. */
  statuses: Record<string, VaultBackupStatus>;
  /** The vaults whose "Back up now" is still under way. */
  requested: string[];
  /** The dot on the start page button has done its job; a new error shows it again. */
  errorSeen: boolean;
}

/**
 * What the automatic backup is set to and what it did last. Written only by
 * `lib/autoBackup.ts`; read by the start page and the button that leads
 * there. A store of its own, so the rail can know it without loading more.
 */
export const useAutoBackupStore = create<AutoBackupState>(() => ({
  settings: null,
  statuses: {},
  requested: [],
  errorSeen: false,
}));

/** Whether a chosen vault's last run failed. */
export function autoBackupFailed(state: AutoBackupState): boolean {
  const chosen = new Set(state.settings?.vaults ?? []);
  return Object.values(state.statuses).some((s) => chosen.has(s.vaultId) && s.error !== null);
}
