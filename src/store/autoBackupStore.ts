import { create } from 'zustand';

/** Mirrors `AutoBackupStatus` in `src-tauri/src/auto_backup.rs`. */
export interface AutoBackupStatus {
  /** Der selbst gewählte Ordner; `null`, solange der `backup/`-Ordner des Vaults gilt. */
  customDir: string | null;
  dir: string;
  /** Der gewählte Ordner ist gerade nicht erreichbar. */
  missing: boolean;
  /** Tag des jüngsten automatischen Backups dieses Vaults, `YYYY-MM-DD`. */
  newest: string | null;
  today: string;
}

/** Als Code gehalten und erst beim Rendern übersetzt — so folgt die Meldung einem Sprachwechsel. */
export type AutoBackupError = 'dirMissing' | 'failed';

interface AutoBackupState {
  /** Der Vault, zu dem `status` und `error` gehören. */
  vaultId: string | null;
  status: AutoBackupStatus | null;
  running: boolean;
  /** „Jetzt sichern" wurde geklickt und wartet noch auf seinen Lauf (`backUpNow`). */
  requested: boolean;
  error: AutoBackupError | null;
  /** Der Punkt am Zahnrad hat seine Aufgabe erfüllt; ein neuer Fehler nach einem Erfolg zeigt ihn wieder. */
  errorSeen: boolean;
}

/**
 * Was das automatische Backup zuletzt getan hat. Geschrieben wird nur von
 * `lib/autoBackup.ts`; gelesen vom Abschnitt in den Einstellungen und vom
 * Zahnrad der Leiste. Eigener Store, damit die Leiste ihn kennen kann, ohne
 * `dbBackup` in den Haupt-Chunk zu ziehen.
 */
export const useAutoBackupStore = create<AutoBackupState>(() => ({
  vaultId: null,
  status: null,
  running: false,
  requested: false,
  error: null,
  errorSeen: false,
}));
