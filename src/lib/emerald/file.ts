import { invoke } from '@tauri-apps/api/core';
import i18n from '../../i18n';
import { getActiveVaultId } from '../vaultManager';
import { keyErrorOf, KEY_ERRORS } from '../vaultKeys';
import {
  askBackupSecret, BACKUP_UNLOCK_CANCELLED, endBackupSecret, lastBackupSecretQuestion, type BackupSecret,
} from '../../store/backupSecretStore';
import type { EmeraldKind } from './manifest';

/**
 * The `.emerald` file on disk — `src-tauri/src/emerald_file.rs` behind four
 * commands: write, open (header and manifest), store the pictures, close.
 * What goes into the manifest and what becomes of it is the business of
 * `lib/emeraldFormat.ts` (entries and templates) and `lib/dbBackup.ts` (a
 * vault's content).
 */

/**
 * How the file is protected: not at all, with an own password (at least 8
 * characters), or with the key of the vault exported from — the file then
 * opens with that vault's password or recovery key, and without asking while
 * the vault is unlocked.
 */
export type EmeraldProtection =
  | { type: 'none' }
  | { type: 'password'; password: string }
  | { type: 'vaultKey' };

/** A picture for the archive: the vault's file by `name`, or compressed as `dataUrl`. */
export interface ArchiveImage {
  name: string;
  dataUrl?: string;
}

/** Writes a file at `path`, without a dialog. The pictures are read from the active vault by Rust. */
export async function writeArchive(
  path: string,
  kind: EmeraldKind,
  manifest: string,
  images: readonly ArchiveImage[],
  icons: readonly string[],
  protection: EmeraldProtection,
): Promise<void> {
  await invoke('write_emerald_file', {
    vaultId: await getActiveVaultId(),
    path,
    kind,
    manifest,
    images,
    icons,
    protection,
  });
}

/** Error codes of `emerald_file.rs`. */
export const EMERALD_ERRORS = {
  locked: 'EMERALD_LOCKED',
  vaultLocked: 'EMERALD_VAULT_LOCKED',
  oldFormat: 'EMERALD_OLD_FORMAT',
  tooLarge: 'EMERALD_TOO_LARGE',
  unreadable: 'EMERALD_UNREADABLE',
  newer: 'EMERALD_NEWER',
} as const;

/** Thrown with a text for the person importing — nothing was changed. */
export class EmeraldNotice extends Error {}

/** The text for an error of reading a file, or `null` for one that has none. */
export function noticeFor(err: unknown): string | null {
  const code = keyErrorOf(err);
  switch (code) {
    case EMERALD_ERRORS.oldFormat: return i18n.t('emeraldImport.oldVersion');
    case EMERALD_ERRORS.tooLarge: return i18n.t('emeraldImport.tooLarge');
    case EMERALD_ERRORS.unreadable: return i18n.t('emeraldImport.unsupported');
    case EMERALD_ERRORS.newer: return i18n.t('emeraldImport.newVersion');
    default: return code.includes('access denied') ? i18n.t('emeraldImport.outside') : null;
  }
}

/**
 * An opened file: its kind and manifest; the pictures wait in it under
 * `ticket`. `raw` is a raw backup of a vault (`raw_backup.rs`) — its content
 * is in its database (`dbBackup.ts`), its settings come as `settings`.
 */
export interface OpenedArchive {
  ticket: string;
  kind: EmeraldKind | 'raw';
  manifest: string;
  /** Whether opening it took a key: a file sealed with a password or a vault key, or a raw backup. */
  protected: boolean;
  /** A raw backup's `settings.json`, unchecked. */
  settings?: string;
}

/**
 * Opens the file at `path`, asking for its secret while one is needed and
 * the last one did not fit: an own password, or — for a file under a vault
 * key no open vault has — that vault's password or recovery key. `null`: the
 * question was cancelled. Errors with a text of their own come as
 * {@link EmeraldNotice}.
 */
export async function openArchiveAsking(path: string): Promise<OpenedArchive | null> {
  let secret: BackupSecret | null = null;
  // Which question: a file's own password, or a vault's password or recovery key.
  let asking: 'emerald' | 'backup' = 'emerald';
  // The question this opening asked, if any — closed at the end, unless another asker took over since.
  let question: number | null = null;
  try {
    for (;;) {
      let error: string | null;
      try {
        return await invoke<OpenedArchive>('read_emerald_file', { path, ...(secret ?? {}) });
      } catch (err) {
        const code = keyErrorOf(err);
        if (code === EMERALD_ERRORS.locked) [error, asking] = [null, 'emerald'];
        else if (code === EMERALD_ERRORS.vaultLocked) [error, asking] = [null, 'backup'];
        // Asked again with the same question; the text says whose password did not fit.
        else if (code === KEY_ERRORS.wrongPassword) error = i18n.t(asking === 'backup' ? 'vaultKey.wrongPassword' : 'emeraldKey.wrongPassword');
        else if (code === KEY_ERRORS.wrongRecoveryKey) error = i18n.t('vaultKey.wrongRecoveryKey');
        else {
          const notice = noticeFor(err);
          throw notice ? new EmeraldNotice(notice) : err;
        }
      }
      try {
        const answer = askBackupSecret(error, asking);
        question = lastBackupSecretQuestion();
        secret = await answer;
      } catch (cancelled) {
        if (keyErrorOf(cancelled) === BACKUP_UNLOCK_CANCELLED) return null;
        throw cancelled;
      }
    }
  } finally {
    // Opened, discarded or failed — the question is settled.
    if (question !== null) endBackupSecret(question);
  }
}

/** Per picture and icon of the file, the name the vault stored it under — keyed by its name in the file. */
export interface StoredArchiveFiles {
  images: Map<string, string>;
  icons: Map<string, string>;
}

/** Stores the pictures and icons of an opened file in the active vault. */
export async function storeArchiveFiles(ticket: string): Promise<StoredArchiveFiles> {
  const stored = await invoke<{ images: Record<string, string>; icons: Record<string, string> }>(
    'store_emerald_files', { ticket, vaultId: await getActiveVaultId() },
  );
  return { images: new Map(Object.entries(stored.images)), icons: new Map(Object.entries(stored.icons)) };
}

/** Forgets an opened file. */
export function closeArchive(ticket: string): void {
  invoke('close_emerald_file', { ticket }).catch(() => { /* gone already */ });
}

/**
 * A path from the save dialog with the file's ending: the GTK dialog on Linux
 * does not add the filter's extension to a name typed without it, and Rust
 * writes only `.emerald` files.
 */
export function withEmeraldEnding(path: string, ending: '.emerald' | '.vault.emerald' = '.emerald'): string {
  return /\.emerald$/i.test(path) ? path : `${path}${ending}`;
}
