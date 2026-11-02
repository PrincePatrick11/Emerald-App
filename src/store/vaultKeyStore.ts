import { create } from 'zustand';
import { extendSplashDuring, resumeSplash } from '../lib/splash';
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

const rememberedUnlocks = new Map<string, Promise<boolean>>();

/**
 * One keychain read per vault at a time. StrictMode runs the boot effect twice,
 * and every concurrent read of an entry this build may not read yet would add
 * its own prompts (macOS, see `Documentation/security.md`).
 *
 * A keychain that does not respond is no reason to fail — then the password it is.
 */
function unlockRememberedOnce(vaultId: string): Promise<boolean> {
  let unlock = rememberedUnlocks.get(vaultId);
  if (!unlock) {
    unlock = extendSplashDuring(unlockRemembered(vaultId))
      .catch(() => false)
      .finally(() => rememberedUnlocks.delete(vaultId));
    rememberedUnlocks.set(vaultId, unlock);
  }
  return unlock;
}

/**
 * Asks, then puts the loading screen back up for what follows: the dialog took
 * it away, and the vault's data is yet to load. On "Cancel" nothing loads.
 */
async function askThenResumeSplash(request: VaultKeyRequest): Promise<void> {
  await ask(request);
  resumeSplash();
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
 *
 * After a question the loading screen is up again: the caller ends it with
 * `hideSplash()` once the vault has loaded.
 */
export async function ensureVaultReady(
  vault: { id: string; name: string },
  { askPassword = false }: { askPassword?: boolean } = {},
): Promise<void> {
  const status = await vaultKeyStatus(vault.id);
  if (status.encrypted) {
    if (status.unlocked) return;
    // `askPassword`: explicitly locked, so do not silently unlock again right away.
    if (!askPassword && (await unlockRememberedOnce(vault.id))) return;
    return askThenResumeSplash({ kind: 'unlock', vaultId: vault.id, vaultName: vault.name });
  }
  return askThenResumeSplash({ kind: status.hasDatabase ? 'encrypt' : 'create', vaultId: vault.id, vaultName: vault.name });
}
