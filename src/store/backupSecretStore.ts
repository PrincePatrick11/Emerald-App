import { create } from 'zustand';

/** What should open the backup: its password from back then or its recovery key. */
export type BackupSecret = { password: string } | { recoveryKey: string };

export const BACKUP_UNLOCK_CANCELLED = 'BACKUP_UNLOCK_CANCELLED';

interface BackupSecretStore {
  /**
   * The open question. `error`: why it is being asked again. `busy`: the
   * answer is being checked right now — the dialog stays up until it is
   * clear whether it fit.
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
 * Asks for the secret of an encrypted backup that none of the open vaults
 * can open — or, after a failed attempt, asks again.
 * `error`: the text saying why the last attempt failed. Ends with
 * {@link BACKUP_UNLOCK_CANCELLED} on cancel. Whoever asks closes the
 * question with {@link endBackupSecret} once the outcome is known.
 */
export function askBackupSecret(error: string | null): Promise<BackupSecret> {
  pending?.reject(new Error(BACKUP_UNLOCK_CANCELLED));
  return new Promise<BackupSecret>((resolve, reject) => {
    pending = { resolve, reject };
    useBackupSecretStore.setState({ request: { error, busy: false } });
  });
}

/** Closes the question — the backup is open, or the error is not one that warrants new input. */
export function endBackupSecret(): void {
  pending = null;
  useBackupSecretStore.setState({ request: null });
}
