/**
 * Die Schlüssel-Befehle aus `keys.rs`.
 *
 * Der Vault-Schlüssel selbst kommt nie hier an: Rust hält ihn, solange der
 * Vault entsperrt ist, und alles, was ihn braucht, nennt nur die Vault-Id.
 * Hier herein reichen nur Passwort und Wiederherstellungsschlüssel. Ein
 * Wiederherstellungsschlüssel kommt genau einmal heraus — wenn er entsteht:
 * beim Anlegen, Verschlüsseln, Passwortwechsel und nach „Passwort vergessen".
 *
 * `rememberKey`: ob der Schlüssel im Schlüsselbund des Betriebssystems liegen
 * soll. `undefined` heißt „nicht angefasst" — dann bleibt der Schlüsselbund,
 * wie er ist. Die Befehle antworten jeweils, ob er danach dort liegt.
 */
import { invoke } from '@tauri-apps/api/core';

export interface VaultKeyStatus {
  /** `emerald.db` liegt schon da — ohne ist der Vault neu. */
  hasDatabase: boolean;
  encrypted: boolean;
  unlocked: boolean;
}

/** Fehlertexte aus `keys.rs`, die das Frontend unterscheidet. */
export const KEY_ERRORS = {
  wrongPassword: 'WRONG_PASSWORD',
  wrongRecoveryKey: 'WRONG_RECOVERY_KEY',
  passwordTooShort: 'PASSWORD_TOO_SHORT',
  /** Ein verschlüsseltes Backup, das keiner der offenen Vaults öffnet. */
  backupLocked: 'BACKUP_LOCKED',
} as const;

/** Was beim Anlegen eines Schlüssels herauskommt. */
export interface CreatedKey {
  recoveryKey: string;
  /** Liegt der neue Schlüssel im Schlüsselbund? */
  remembered: boolean;
}

/** Muss zu `MIN_PASSWORD_CHARS` in `keys.rs` passen. */
export const MIN_PASSWORD_LENGTH = 8;

export function keyErrorOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function vaultKeyStatus(vaultId: string): Promise<VaultKeyStatus> {
  return invoke('vault_key_status', { vaultId });
}

/** Ob es einen Schlüsselbund gibt, in dem sich ein Schlüssel merken lässt. */
export function keychainAvailable(): Promise<boolean> {
  return invoke('keychain_available');
}

/** Legt `vault.key` für einen neuen Vault an und entsperrt ihn. */
export function createVaultKey(
  vaultId: string,
  password: string,
  rememberKey: boolean | undefined,
): Promise<CreatedKey> {
  return invoke('vault_create_key', { vaultId, password, rememberKey });
}

/**
 * Verschlüsselt einen bestehenden Klartext-Vault (`reencrypt.rs`) und
 * entsperrt ihn. Die Verbindungen zu ihm müssen zu sein.
 */
export function encryptExistingVault(
  vaultId: string,
  password: string,
  rememberKey: boolean | undefined,
): Promise<CreatedKey> {
  return invoke('vault_encrypt_existing', { vaultId, password, rememberKey });
}

export function unlockVault(vaultId: string, password: string, rememberKey: boolean | undefined): Promise<boolean> {
  return invoke('vault_unlock', { vaultId, password, rememberKey });
}

/** `true`, wenn der gemerkte Schlüssel gepasst hat. */
export function unlockRemembered(vaultId: string): Promise<boolean> {
  return invoke('vault_unlock_remembered', { vaultId });
}

/**
 * „Passwort vergessen": öffnet mit dem Wiederherstellungsschlüssel und setzt
 * den Vault wie beim Passwortwechsel unter einen neuen Schlüssel — mit einem
 * neuen Wiederherstellungsschlüssel; der benutzte ist danach verbraucht.
 */
export function recoverVault(
  vaultId: string,
  recoveryKey: string,
  newPassword: string,
  rememberKey: boolean | undefined,
): Promise<CreatedKey> {
  return invoke('vault_recover', { vaultId, recoveryKey, newPassword, rememberKey });
}

export function lockVault(vaultId: string): Promise<void> {
  return invoke('vault_lock', { vaultId });
}

/**
 * Neues Passwort — und damit ein neuer Vault-Schlüssel und ein neuer
 * Wiederherstellungsschlüssel (`reencrypt.rs`). Die Verbindungen zum Vault
 * müssen zu sein; Bildnamen ändern sich, also danach alles neu laden.
 */
export function changeVaultPassword(
  vaultId: string,
  currentPassword: string,
  newPassword: string,
): Promise<CreatedKey> {
  return invoke('vault_change_password', { vaultId, currentPassword, newPassword });
}

/** Ob der Schlüssel dieses Vaults im Schlüsselbund liegt. */
export function isVaultRemembered(vaultId: string): Promise<boolean> {
  return invoke('vault_is_remembered', { vaultId });
}

/** „Auf diesem Gerät merken" an oder aus. Antwortet, ob er danach dort liegt. */
export function setVaultRemembered(vaultId: string, rememberKey: boolean): Promise<boolean> {
  return invoke('vault_set_remembered', { vaultId, rememberKey });
}
