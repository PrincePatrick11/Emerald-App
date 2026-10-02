import { create } from 'zustand';

/** Was das Backup öffnen soll: sein Passwort von damals oder sein Wiederherstellungsschlüssel. */
export type BackupSecret = { password: string } | { recoveryKey: string };

export const BACKUP_UNLOCK_CANCELLED = 'BACKUP_UNLOCK_CANCELLED';

interface BackupSecretStore {
  /** Die offene Frage; `error` sagt, warum noch einmal gefragt wird. */
  request: { error: string | null } | null;
  answer: (secret: BackupSecret) => void;
  cancel: () => void;
}

let pending: { resolve: (secret: BackupSecret) => void; reject: (err: Error) => void } | null = null;

export const useBackupSecretStore = create<BackupSecretStore>((set) => ({
  request: null,
  answer: (secret) => {
    const p = pending;
    pending = null;
    set({ request: null });
    p?.resolve(secret);
  },
  cancel: () => {
    const p = pending;
    pending = null;
    set({ request: null });
    p?.reject(new Error(BACKUP_UNLOCK_CANCELLED));
  },
}));

/**
 * Fragt nach dem Geheimnis eines verschlüsselten Backups, das keiner der
 * offenen Vaults öffnen kann. `error`: der Text, warum der letzte Versuch
 * nicht ging. Endet mit {@link BACKUP_UNLOCK_CANCELLED} beim Abbrechen.
 */
export function askBackupSecret(error: string | null): Promise<BackupSecret> {
  pending?.reject(new Error(BACKUP_UNLOCK_CANCELLED));
  return new Promise<BackupSecret>((resolve, reject) => {
    pending = { resolve, reject };
    useBackupSecretStore.setState({ request: { error } });
  });
}
