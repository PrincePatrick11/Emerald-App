import { create } from 'zustand';
import { unlockRemembered, vaultKeyStatus } from '../lib/vaultKeys';

/**
 * What `VaultKeyDialog` is currently asking.
 *
 * - `create`: a new vault gets its password.
 * - `encrypt`: a vault from before encryption was introduced gets encrypted.
 * - `unlock`: an encrypted vault is locked.
 */
export type VaultKeyRequest = {
  kind: 'create' | 'encrypt' | 'unlock';
  vaultId: string;
  vaultName: string;
};

interface VaultKeyStore {
  request: VaultKeyRequest | null;
  /** From the dialog: the vault is ready. */
  finish: () => void;
  /** From the dialog: the user cancels. */
  cancel: () => void;
}

/** The error with which `ensureVaultReady` ends on "Cancel". */
export const VAULT_KEY_CANCELLED = 'VAULT_KEY_CANCELLED';

let pending: {
  request: VaultKeyRequest;
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
} | null = null;

export const useVaultKeyStore = create<VaultKeyStore>((set) => ({
  request: null,
  finish: () => {
    const p = pending;
    pending = null;
    set({ request: null });
    p?.resolve();
  },
  cancel: () => {
    const p = pending;
    pending = null;
    set({ request: null });
    p?.reject(new Error(VAULT_KEY_CANCELLED));
  },
}));

function ask(request: VaultKeyRequest): Promise<void> {
  // The same question again — StrictMode runs the boot effect twice —
  // waits for the open one instead of cancelling it.
  if (pending && pending.request.kind === request.kind && pending.request.vaultId === request.vaultId) {
    return pending.promise;
  }
  // A question about another vault overtakes the older one.
  pending?.reject(new Error(VAULT_KEY_CANCELLED));
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  pending = { request, promise, resolve, reject };
  useVaultKeyStore.setState({ request });
  return promise;
}

/**
 * The one gate in front of every database: afterwards the vault is encrypted and
 * unlocked.
 *
 * A new vault (no `emerald.db` yet) gets its password here, an
 * old, unencrypted one is encrypted — mandatory, Rust opens no
 * vault without `vault.key` —, and a locked one is unlocked with the remembered
 * key or asks for the password. Ends with
 * {@link VAULT_KEY_CANCELLED} if the user cancels; a missing
 * vault folder already fails at the status query.
 *
 * Startup, switching, creating, opening and import as a new vault all pass
 * through here, because they all end up in `openActiveVault` or the startup in `AppShell`.
 * Rust enforces the same: without a key, `db_load` opens nothing.
 */
export async function ensureVaultReady(
  vault: { id: string; name: string },
  { askPassword = false }: { askPassword?: boolean } = {},
): Promise<void> {
  const status = await vaultKeyStatus(vault.id);
  if (status.encrypted) {
    if (status.unlocked) return;
    // A keychain that does not respond is no reason to fail —
    // then the password it is. `askPassword`: explicitly locked, so do not
    // silently unlock again right away.
    if (!askPassword && (await unlockRemembered(vault.id).catch(() => false))) return;
    return ask({ kind: 'unlock', vaultId: vault.id, vaultName: vault.name });
  }
  return ask({ kind: status.hasDatabase ? 'encrypt' : 'create', vaultId: vault.id, vaultName: vault.name });
}
