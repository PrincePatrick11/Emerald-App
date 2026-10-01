import { create } from 'zustand';
import { unlockRemembered, vaultKeyStatus } from '../lib/vaultKeys';

/**
 * Was `VaultKeyDialog` gerade fragt.
 *
 * - `create`: ein neuer Vault bekommt sein Passwort.
 * - `unlock`: ein verschlüsselter Vault ist gesperrt.
 */
export type VaultKeyRequest = {
  kind: 'create' | 'unlock';
  vaultId: string;
  vaultName: string;
  /** Ob „Abbrechen" angeboten wird. */
  cancellable: boolean;
};

interface VaultKeyStore {
  request: VaultKeyRequest | null;
  /** Vom Dialog: der Vault ist bereit. */
  finish: () => void;
  /** Vom Dialog: der Nutzer bricht ab. */
  cancel: () => void;
}

/** Der Fehler, mit dem `ensureVaultReady` auf „Abbrechen" endet. */
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
  // Dieselbe Frage noch einmal — StrictMode startet den Boot-Effekt doppelt —
  // wartet auf die offene, statt sie abzubrechen.
  if (pending && pending.request.kind === request.kind && pending.request.vaultId === request.vaultId) {
    return pending.promise;
  }
  // Eine Frage nach einem anderen Vault überholt die ältere.
  pending?.reject(new Error(VAULT_KEY_CANCELLED));
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  pending = { request, promise, resolve, reject };
  useVaultKeyStore.setState({ request });
  return promise;
}

/**
 * Das eine Tor vor jeder Datenbank: danach ist der Vault entsperrt — oder er
 * ist ein alter, noch unverschlüsselter.
 *
 * Ein neuer Vault (noch keine `emerald.db`) bekommt hier sein Passwort, ein
 * gesperrter wird mit dem gemerkten Schlüssel entsperrt oder fragt nach dem
 * Passwort. Endet mit {@link VAULT_KEY_CANCELLED}, wenn der Nutzer abbricht.
 *
 * Start, Wechsel, Anlegen, Öffnen und der Import als neuer Vault laufen alle
 * hier durch, weil sie alle in `openActiveVault` bzw. dem Start in `AppShell`
 * münden.
 */
export async function ensureVaultReady(vault: { id: string; name: string }, cancellable = true): Promise<void> {
  const status = await vaultKeyStatus(vault.id);
  if (status.encrypted) {
    if (status.unlocked) return;
    if (status.remembered && (await unlockRemembered(vault.id).catch(() => false))) return;
    return ask({ kind: 'unlock', vaultId: vault.id, vaultName: vault.name, cancellable });
  }
  if (!status.hasDatabase) {
    return ask({ kind: 'create', vaultId: vault.id, vaultName: vault.name, cancellable });
  }
  // Ein bestehender, unverschlüsselter Vault öffnet vorerst wie bisher.
}
