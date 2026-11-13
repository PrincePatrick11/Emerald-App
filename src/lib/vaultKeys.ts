/**
 * The key commands from `keys.rs`.
 *
 * The vault key itself never arrives here: Rust holds it as long as the
 * vault is unlocked, and everything that needs it names only the vault ID.
 * Only the password and the recovery key come in here. A
 * recovery key comes out exactly once — when it is created:
 * on creating, changing the password and after "Forgot password".
 *
 * `rememberKey`: whether the key should be stored in the operating system's
 * keychain. `undefined` means "not touched" — then the keychain stays
 * as it is. The commands each answer whether it is stored there afterwards.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface VaultKeyStatus {
  /** `emerald.db` is already there — without it the vault is new. */
  hasDatabase: boolean;
  encrypted: boolean;
  unlocked: boolean;
}

/** Error texts from `keys.rs` that the frontend distinguishes. */
export const KEY_ERRORS = {
  wrongPassword: 'WRONG_PASSWORD',
  wrongRecoveryKey: 'WRONG_RECOVERY_KEY',
  passwordTooShort: 'PASSWORD_TOO_SHORT',
  /** An encrypted backup that none of the open vaults can open. */
  backupLocked: 'BACKUP_LOCKED',
  /** Not enough space for the copy; followed by `:<needed>:<free>` in bytes. */
  notEnoughSpace: 'NOT_ENOUGH_SPACE',
} as const;

/** How far a re-encryption has got (`reencrypt.rs`, `Progress`). */
export interface ReencryptProgress {
  vaultId: string;
  phase: 'database' | 'images' | 'checking';
  done: number;
  total: number;
}

/** Progress of the re-encryption of `vaultId`: password change, "Forgot password". */
export function onReencryptProgress(vaultId: string, handler: (p: ReencryptProgress) => void): Promise<UnlistenFn> {
  // The same name as `PROGRESS_EVENT` in `reencrypt.rs`.
  return listen<ReencryptProgress>('vault-reencrypt-progress', (e) => {
    if (e.payload.vaultId === vaultId) handler(e.payload);
  });
}

/** For `NOT_ENOUGH_SPACE`: how much is needed and how much is free, in bytes. */
export function spaceShortfall(err: unknown): { needed: number; free: number } | null {
  const [code, needed, free] = keyErrorOf(err).split(':');
  if (code !== KEY_ERRORS.notEnoughSpace) return null;
  return { needed: Number(needed), free: Number(free) };
}

/** What comes out when a key is created. */
export interface CreatedKey {
  recoveryKey: string;
  /** Is the new key stored in the keychain? */
  remembered: boolean;
}

/** Must match `MIN_PASSWORD_CHARS` in `keys.rs`. */
export const MIN_PASSWORD_LENGTH = 8;

export function keyErrorOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function vaultKeyStatus(vaultId: string): Promise<VaultKeyStatus> {
  return invoke('vault_key_status', { vaultId });
}

/** Whether there is a keychain in which a key can be remembered. */
export function keychainAvailable(): Promise<boolean> {
  return invoke('keychain_available');
}

/** Creates `vault.key` for a new vault and unlocks it. */
export function createVaultKey(
  vaultId: string,
  password: string,
  rememberKey: boolean | undefined,
): Promise<CreatedKey> {
  return invoke('vault_create_key', { vaultId, password, rememberKey });
}


export function unlockVault(vaultId: string, password: string, rememberKey: boolean | undefined): Promise<boolean> {
  return invoke('vault_unlock', { vaultId, password, rememberKey });
}

/** `true` if the remembered key fitted. */
export function unlockRemembered(vaultId: string): Promise<boolean> {
  return invoke('vault_unlock_remembered', { vaultId });
}

/**
 * "Forgot password": opens with the recovery key and puts
 * the vault under a new key as with a password change — with a
 * new recovery key; the one used is spent afterwards.
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
 * New password — and with it a new vault key and a new
 * recovery key (`reencrypt.rs`). The connections to the vault
 * must be closed; image names change, so reload everything afterwards.
 */
export function changeVaultPassword(
  vaultId: string,
  currentPassword: string,
  newPassword: string,
): Promise<CreatedKey> {
  return invoke('vault_change_password', { vaultId, currentPassword, newPassword });
}

/** Whether this vault's key is stored in the keychain. */
export function isVaultRemembered(vaultId: string): Promise<boolean> {
  return invoke('vault_is_remembered', { vaultId });
}

/** "Remember on this device" on or off. Answers whether the key is stored there afterwards. */
export function setVaultRemembered(vaultId: string, rememberKey: boolean): Promise<boolean> {
  return invoke('vault_set_remembered', { vaultId, rememberKey });
}
