import { create } from 'zustand';
import { unlockRemembered, vaultKeyStatus } from '../lib/vaultKeys';

/**
 * Was `VaultKeyDialog` gerade fragt.
 *
 * - `create`: ein neuer Vault bekommt sein Passwort.
 * - `encrypt`: ein Vault aus der Zeit vor der Verschlüsselung wird verschlüsselt.
 * - `unlock`: ein verschlüsselter Vault ist gesperrt.
 */
export type VaultKeyRequest = {
  kind: 'create' | 'encrypt' | 'unlock';
  vaultId: string;
  vaultName: string;
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
 * Das eine Tor vor jeder Datenbank: danach ist der Vault verschlüsselt und
 * entsperrt.
 *
 * Ein neuer Vault (noch keine `emerald.db`) bekommt hier sein Passwort, ein
 * alter, unverschlüsselter wird verschlüsselt — Pflicht, Rust öffnet keinen
 * Vault ohne `vault.key` —, und ein gesperrter wird mit dem gemerkten
 * Schlüssel entsperrt oder fragt nach dem Passwort. Endet mit
 * {@link VAULT_KEY_CANCELLED}, wenn der Nutzer abbricht; ein fehlender
 * Vault-Ordner scheitert schon an der Statusabfrage.
 *
 * Start, Wechsel, Anlegen, Öffnen und der Import als neuer Vault laufen alle
 * hier durch, weil sie alle in `openActiveVault` bzw. dem Start in `AppShell`
 * münden. Rust sichert dasselbe ab: ohne Schlüssel öffnet `db_load` nichts.
 */
export async function ensureVaultReady(
  vault: { id: string; name: string },
  { askPassword = false }: { askPassword?: boolean } = {},
): Promise<void> {
  const status = await vaultKeyStatus(vault.id);
  if (status.encrypted) {
    if (status.unlocked) return;
    // Ein Schlüsselbund, der nicht antwortet, ist kein Grund zum Scheitern —
    // dann eben das Passwort. `askPassword`: ausdrücklich gesperrt, also nicht
    // gleich wieder still entsperren.
    if (!askPassword && (await unlockRemembered(vault.id).catch(() => false))) return;
    return ask({ kind: 'unlock', vaultId: vault.id, vaultName: vault.name });
  }
  return ask({ kind: status.hasDatabase ? 'encrypt' : 'create', vaultId: vault.id, vaultName: vault.name });
}
