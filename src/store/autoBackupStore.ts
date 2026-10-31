import { create } from 'zustand';

/** Mirrors `AutoBackupStatus` in `src-tauri/src/auto_backup.rs`. */
export interface AutoBackupStatus {
  /** The folder chosen by the user; `null` while the vault's `backup/` folder applies. */
  customDir: string | null;
  dir: string;
  /** The chosen folder is currently unreachable. */
  missing: boolean;
  /** Day of this vault's most recent automatic backup, `YYYY-MM-DD`. */
  newest: string | null;
  today: string;
}

/** Kept as a code and translated only on render — so the message follows a language change. */
export type AutoBackupError = 'dirMissing' | 'failed';

interface AutoBackupState {
  /** The vault that `status` and `error` belong to. */
  vaultId: string | null;
  status: AutoBackupStatus | null;
  running: boolean;
  /** "Back up now" was clicked and is still waiting for its run (`backUpNow`). */
  requested: boolean;
  error: AutoBackupError | null;
  /** The dot on the gear has done its job; a new error after a success shows it again. */
  errorSeen: boolean;
}

/**
 * What the automatic backup did last. Written only by
 * `lib/autoBackup.ts`; read by the section in the settings and by the
 * gear in the bar. A store of its own, so the bar can know it without
 * pulling `dbBackup` into the main chunk.
 */
export const useAutoBackupStore = create<AutoBackupState>(() => ({
  vaultId: null,
  status: null,
  running: false,
  requested: false,
  error: null,
  errorSeen: false,
}));
