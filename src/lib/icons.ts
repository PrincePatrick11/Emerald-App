/**
 * Uploaded icons — of entries, templates, custom blocks and languages.
 *
 * An icon is an emoji (text in the row) or a picture. A picture is stored as a
 * small file in the vault's own `icons/` folder, sealed and named after a hash
 * of its bytes like the pictures in `images/` (`src-tauri/src/images.rs`),
 * and the row holds only that name (`ICON_FIELDS` in `schema.ts`). Icons are
 * not pictures of "Images": they live in a folder of their own, which
 * "Images" never lists.
 *
 * Display goes through the `emerald-img` scheme like the pictures, under the
 * path `/{vaultId}/icons/{name}`.
 */
import { invoke } from '@tauri-apps/api/core';
import { getActiveVaultId, getActiveVaultIdSync } from './vaultManager';
import { isImageIcon } from './helpers';
import { collectUsedIconFilenames, storedImageName } from './schema';
import { shrinkImageDataUrl } from './shrinkImage';
import type Database from './sqlite';
import { schemeUrl, type StoredImage, type UnusedImages } from './images';

/**
 * Edge length of an icon file. Icons appear at most 24px large; 128px stays
 * sharp on every high-resolution screen. A custom block's copies all point at
 * the same file, so the size is paid once.
 */
const ICON_MAX_EDGE = 128;

/** Whether an icon value is a stored icon file (and not an emoji). The same rule as `isImageIcon` in `helpers.ts`. */
export const isIconFile = isImageIcon;

/** The longest an emoji (with its modifiers) gets; anything longer from a file is no icon. */
const MAX_EMOJI_LENGTH = 32;

/** The URL to show a stored icon from; `''` for anything else (an emoji). */
export function iconSrc(icon: string | null | undefined): string {
  if (!icon || !isIconFile(icon)) return '';
  return schemeUrl(`${getActiveVaultIdSync()}/icons/${icon}`);
}

/** Whether a value from a file is a picture as a data URL, which a backup import stores as an icon file. */
export function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/** An icon value from a file that is neither a picture nor a stored name: kept if it can be an emoji. */
export function plausibleEmoji(value: string): string {
  return value.length > MAX_EMOJI_LENGTH ? '' : value;
}

/**
 * A picture as an icon: brought down to `ICON_MAX_EDGE` and stored in the
 * active vault's `icons/`. Returns the file name for the row.
 */
export async function saveIcon(dataUrl: string): Promise<string> {
  const small = await shrinkImageDataUrl(dataUrl, ICON_MAX_EDGE);
  return storeIconDataUrl(small);
}

/** Stores a data URL as it is — for a backup's icons, which are small already. */
export async function storeIconDataUrl(dataUrl: string): Promise<string> {
  return invoke<string>('save_icon', { dataUrl, vaultId: await getActiveVaultId() });
}

/**
 * Reads a stored icon back as a data URL — for the backup and the PDF,
 * which the scheme does not reach.
 */
export async function readIconAsBase64(icon: string): Promise<string> {
  const filename = storedImageName(icon);
  if (!filename) throw new Error(`not a stored icon: ${icon}`);
  return invoke<string>('read_icon_as_base64', { filename, vaultId: await getActiveVaultId() });
}

/** An icon as something a document outside the app can show: a data URL for a file, the emoji as it is. */
export async function portableIcon(icon: string | null | undefined): Promise<string> {
  if (!icon) return '';
  if (!isIconFile(icon)) return icon;
  try {
    return await readIconAsBase64(icon);
  } catch {
    return '';
  }
}

/** Every icon file in the active vault's `icons/`. */
async function listIconFiles(): Promise<StoredImage[]> {
  return invoke<StoredImage[]>('list_icon_files', { vaultId: await getActiveVaultId() });
}

/** Deletes the named icons from the active vault. Returns bytes freed. */
export async function deleteIconFiles(filenames: string[]): Promise<number> {
  return invoke<number>('delete_icon_files', { filenames, vaultId: await getActiveVaultId() });
}

/** Which icon files nothing points at any more — the counterpart of `findUnusedImages`. */
export async function findUnusedIcons(db: Database): Promise<UnusedImages> {
  const [files, used] = await Promise.all([listIconFiles(), collectUsedIconFilenames(db)]);
  const unused = files.filter((file) => !used.has(file.name));
  return {
    names: unused.map((file) => file.name),
    bytes: unused.reduce((total, file) => total + file.bytes, 0),
    sizes: new Map(unused.map((file) => [file.name, file.bytes])),
  };
}

/** The names of the icon files the active vault has — empty where the folder cannot be read. */
export async function iconFileNames(): Promise<Set<string>> {
  return new Set(await listIconFiles().then((files) => files.map((f) => f.name), () => []));
}
