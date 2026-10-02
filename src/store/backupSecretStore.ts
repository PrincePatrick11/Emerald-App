import { create } from 'zustand';

/** Was das Backup öffnen soll: sein Passwort von damals oder sein Wiederherstellungsschlüssel. */
export type BackupSecret = { password: string } | { recoveryKey: string };

export const BACKUP_UNLOCK_CANCELLED = 'BACKUP_UNLOCK_CANCELLED';

interface BackupSecretStore {
  /**
   * Die offene Frage. `error`: warum noch einmal gefragt wird. `busy`: die
   * Antwort wird gerade geprüft — der Dialog bleibt stehen, bis feststeht,
   * ob sie gepasst hat.
   */
  request: { error: string | null; busy: boolean } | null;
  answer: (secret: BackupSecret) => void;
  cancel: () => void;
}

let pending: { resolve: (secret: BackupSecret) => void; reject: (err: Error) => void } | null = null;

export const useBackupSecretStore = create<BackupSecretStore>((set) => ({
  request: null,
  answer: (secret) => {
    const p = pending;
    pending = null;
    set((s) => ({ request: s.request && { ...s.request, busy: true } }));
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
 * offenen Vaults öffnen kann — oder, nach einem Fehlversuch, noch einmal.
 * `error`: der Text, warum der letzte Versuch nicht ging. Endet mit
 * {@link BACKUP_UNLOCK_CANCELLED} beim Abbrechen. Wer fragt, schließt die
 * Frage mit {@link endBackupSecret}, sobald feststeht, wie es ausgeht.
 */
export function askBackupSecret(error: string | null): Promise<BackupSecret> {
  pending?.reject(new Error(BACKUP_UNLOCK_CANCELLED));
  return new Promise<BackupSecret>((resolve, reject) => {
    pending = { resolve, reject };
    useBackupSecretStore.setState({ request: { error, busy: false } });
  });
}

/** Schließt die Frage — das Backup ist offen, oder der Fehler ist keiner, der eine neue Eingabe lohnt. */
export function endBackupSecret(): void {
  pending = null;
  useBackupSecretStore.setState({ request: null });
}
