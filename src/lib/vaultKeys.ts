/**
 * Die Schlüssel-Befehle aus `keys.rs`.
 *
 * Der Vault-Schlüssel selbst kommt nie hier an: Rust hält ihn, solange der
 * Vault entsperrt ist, und alles, was ihn braucht, nennt nur die Vault-Id.
 * Hier herein reichen nur Passwort und Wiederherstellungsschlüssel — und der
 * Wiederherstellungsschlüssel kommt genau einmal heraus, beim Anlegen.
 */
import { invoke } from '@tauri-apps/api/core';

export interface VaultKeyStatus {
  /** `emerald.db` liegt schon da — ohne ist der Vault neu. */
  hasDatabase: boolean;
  encrypted: boolean;
  unlocked: boolean;
  /** Der Schlüssel liegt im Schlüsselbund des Betriebssystems. */
  remembered: boolean;
}

/** Fehlertexte aus `keys.rs`, die das Frontend unterscheidet. */
export const KEY_ERRORS = {
  wrongPassword: 'WRONG_PASSWORD',
  wrongRecoveryKey: 'WRONG_RECOVERY_KEY',
  locked: 'VAULT_LOCKED',
  passwordTooShort: 'PASSWORD_TOO_SHORT',
} as const;

/** Muss zu `MIN_PASSWORD_CHARS` in `keys.rs` passen. */
export const MIN_PASSWORD_LENGTH = 8;

export function keyErrorOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function vaultKeyStatus(vaultId: string): Promise<VaultKeyStatus> {
  return invoke('vault_key_status', { vaultId });
}

/** Legt `vault.key` an und entsperrt. Liefert den Wiederherstellungsschlüssel. */
export function createVaultKey(vaultId: string, password: string, rememberKey: boolean): Promise<string> {
  return invoke('vault_create_key', { vaultId, password, rememberKey });
}

export function unlockVault(vaultId: string, password: string, rememberKey: boolean): Promise<void> {
  return invoke('vault_unlock', { vaultId, password, rememberKey });
}

/** `true`, wenn der gemerkte Schlüssel gepasst hat. */
export function unlockRemembered(vaultId: string): Promise<boolean> {
  return invoke('vault_unlock_remembered', { vaultId });
}

export function recoverVault(vaultId: string, recoveryKey: string, newPassword: string, rememberKey: boolean): Promise<void> {
  return invoke('vault_recover', { vaultId, recoveryKey, newPassword, rememberKey });
}

export function changeVaultPassword(vaultId: string, currentPassword: string, newPassword: string): Promise<void> {
  return invoke('vault_change_password', { vaultId, currentPassword, newPassword });
}

export function setVaultRemembered(vaultId: string, rememberKey: boolean): Promise<void> {
  return invoke('vault_set_remembered', { vaultId, rememberKey });
}

export function lockVault(vaultId: string): Promise<void> {
  return invoke('vault_lock', { vaultId });
}
