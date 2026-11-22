import { create } from 'zustand';

/** What should open the backup: its password from back then or its recovery key. */
export type BackupSecret = { password: string } | { recoveryKey: string };

export const BACKUP_UNLOCK_CANCELLED = 'BACKUP_UNLOCK_CANCELLED';

/**
 * What is being opened: a backup (password or recovery key of its vault) or a
 * `.emerald` file (only the password it was exported with).
 */
export type SecretFor = 'backup' | 'emerald';

interface BackupSecretStore {
  /**
   * The open question. `error`: why it is being asked again. `busy`: the
   * answer is being checked right now — the dialog stays up until it is
   * clear whether it fit.
   */
  request: { error: string | null; busy: boolean; for: SecretFor } | null;
  answer: (secret: BackupSecret) => void;
  cancel: () => void;
}

let pending: { resolve: (secret: BackupSecret) => void; reject: (err: Error) => void } | null = null;
/** The number of the last question — so that an asker can only close its own, never a newer one. */
let asked = 0;

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
 * can open, or of an encrypted `.emerald` file (`secretFor`) — or, after a
 * failed attempt, asks again.
 * `error`: the text saying why the last attempt failed. Ends with
 * {@link BACKUP_UNLOCK_CANCELLED} on cancel. Whoever asks closes the
 * question with {@link endBackupSecret} once the outcome is known.
 */
export function askBackupSecret(error: string | null, secretFor: SecretFor = 'backup'): Promise<BackupSecret> {
  pending?.reject(new Error(BACKUP_UNLOCK_CANCELLED));
  asked += 1;
  return new Promise<BackupSecret>((resolve, reject) => {
    pending = { resolve, reject };
    useBackupSecretStore.setState({ request: { error, busy: false, for: secretFor } });
  });
}

/** The number of the question asked last, for `endBackupSecret`. */
export function lastBackupSecretQuestion(): number {
  return asked;
}

/**
 * Closes the question — the backup or file is open, or the error is not one
 * that warrants new input. `question` (from `lastBackupSecretQuestion` after
 * asking): only if no one has asked since — a newer asker keeps its question.
 */
export function endBackupSecret(question?: number): void {
  if (question !== undefined && question !== asked) return;
  pending = null;
  useBackupSecretStore.setState({ request: null });
}
