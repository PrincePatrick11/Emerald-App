/**
 * Stored images.
 *
 * The database holds a bare filename — `{hash}.{ext}`, the hash of the bytes
 * (keyed in an encrypted vault) — and nothing else. No
 * directory, no drive letter, which is what lets a vault folder be copied to
 * another machine and still render.
 *
 * Display goes through the `emerald-img` URI scheme (see
 * `src-tauri/src/images.rs`), so an `<img>` gets the bytes straight from disk.
 * Nothing is base64-encoded across the IPC bridge and nothing is cached as a
 * data-URL in the JavaScript heap. This module is the only place in the
 * frontend that builds such a URL, in the same spirit as `platform.ts`; the
 * other two places that know the scheme by name are the handler in
 * `src-tauri/src/images.rs` and the `img-src` directive in `tauri.conf.json`.
 */
import { invoke } from '@tauri-apps/api/core';
import { getActiveVaultId, getActiveVaultIdSync } from './vaultManager';
import { isWindows } from './platform';
import { collectUsedImageFilenames, storedImageName } from './schema';
import type Database from './sqlite';

// The name format is a property of the columns, not of the UI —
// which is why it lives in `schema.ts`. Only passed on here, so that the UI has a
// single point of contact for everything image-related.
export { storedImageName };

export function isStoredImage(ref: string | null | undefined): boolean {
  return storedImageName(ref) !== null;
}

/**
 * The URL to render a stored image from.
 *
 * Windows serves custom schemes through `http://{scheme}.localhost`, the other
 * platforms through the scheme itself; the path is `/{vaultId}/{filename}`
 * either way. Inline sources (`data:`, `blob:`, remote URLs) pass through
 * untouched — imported content may still carry those.
 */
export function imageSrc(ref: string | null | undefined): string {
  if (!ref) return '';
  if (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('http')) return ref;

  const name = storedImageName(ref);
  if (!name) return '';

  const path = `${getActiveVaultIdSync()}/${name}`;
  return isWindows
    ? `http://emerald-img.localhost/${path}`
    : `emerald-img://localhost/${path}`;
}

/**
 * Image references in HTML.
 *
 * Four places used to each spell out this `src` pattern on their own:
 * the backup export, the `.emerald` export, `embedImages` for PDF/Markdown and
 * migration v35. They differ only in what they do with the match.
 */
const SRC_ATTR_RE = /src="([^"]+)"/g;

/** Every `src` value of a fragment that points at a stored image. */
export function imageRefsInHtml(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(SRC_ATTR_RE)) {
    if (isStoredImage(match[1])) refs.push(match[1]);
  }
  return refs;
}

/**
 * Rewrites every `src` for which `replacement` returns a value. `null`
 * leaves the match untouched — including the quotation marks around it.
 */
export function rewriteImageRefs(
  html: string,
  replacement: (ref: string) => string | null,
): string {
  return html.replace(SRC_ATTR_RE, (whole, ref: string) => {
    const next = replacement(ref);
    return next === null ? whole : `src="${next}"`;
  });
}

/** Stores a data-URL in the active vault. Returns the filename. */
export async function saveImage(dataUrl: string): Promise<string> {
  return invoke<string>('save_image', { dataUrl, vaultId: await getActiveVaultId() });
}

/** Reads an image file on disk as a data-URL without storing it — for the
 *  drop path when the vault limits image size (see `imageLimits.ts`). */
export function readImageFile(source: string): Promise<string> {
  return invoke<string>('read_image_file', { source });
}

/** Copies a file on disk into the active vault. Returns the filename. */
export async function copyImageFile(source: string): Promise<string> {
  return invoke<string>('copy_image_file', { source, vaultId: await getActiveVaultId() });
}

/**
 * Reads a stored image back as a data-URL.
 *
 * Only for the two callers that cannot use the URI scheme: the PDF export
 * renders in a `file://` webview the scheme does not reach, and the backup
 * writer has to embed the bytes in JSON.
 */
export async function readImageAsBase64(ref: string): Promise<string> {
  const filename = storedImageName(ref);
  if (!filename) throw new Error(`not a stored image: ${ref}`);
  return invoke<string>('read_image_as_base64', {
    filename,
    vaultId: await getActiveVaultId(),
  });
}

/**
 * The same source, but for a canvas.
 *
 * The canvas and sigil blocks paint their images onto a canvas and read it back with
 * `toBlob()`. An image the browser considers foreign
 * taints the canvas and makes the read-back fail. Images served over
 * `emerald-img` *are* foreign — the handler does send a
 * CORS permission along, but whether WebKitGTK and WKWebView evaluate it
 * for a custom scheme at all cannot be checked on Windows, and a
 * failure would be silent: the export would simply produce nothing.
 *
 * That is why this one path does not go through the scheme but fetches the bytes
 * as a data URL. That always counts as a same-origin source, on every engine. The price
 * is one IPC round trip per image — only when rendering a canvas, never during
 * normal display.
 */
export async function canvasImageSrc(ref: string | null | undefined): Promise<string> {
  if (!ref) return '';
  // Inline sources and the presets from `public/` are harmless anyway.
  if (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('/')) return ref;
  const name = storedImageName(ref);
  if (!name) return '';
  return readImageAsBase64(name);
}

export interface StoredImage {
  name: string;
  bytes: number;
}

/** Every image file in the active vault's own folder. */
export async function listImageFiles(): Promise<StoredImage[]> {
  return invoke<StoredImage[]>('list_image_files', { vaultId: await getActiveVaultId() });
}

/** Deletes the named images from the active vault. Returns bytes freed. */
export async function deleteImageFiles(filenames: string[]): Promise<number> {
  const vaultId = await getActiveVaultId();
  const freed = await invoke<number>('delete_image_files', { filenames, vaultId });
  // Unused here need not stop the server from keeping them for a while, so a failure is no reason to report one.
  void invoke('sync_images_delete', { vaultId, names: filenames }).catch(() => {});
  return freed;
}


export interface UnusedImages {
  names: string[];
  bytes: number;
}

/**
 * Which images in the active vault nothing points at any more.
 *
 * Scans whole tables, so this is an on-demand maintenance action rather than
 * anything on the open path. It is also deliberately not automatic: an image
 * that only exists in an editor buffer nobody has saved yet would count as
 * unused, and deleting it would be a surprise.
 *
 * Takes the database rather than calling `getDb()`, so this module does not
 * depend on `db.ts`.
 */
export async function findUnusedImages(db: Database): Promise<UnusedImages> {
  const [files, used] = await Promise.all([listImageFiles(), collectUsedImageFilenames(db)]);
  const unused = files.filter((file) => !used.has(file.name));
  return {
    names: unused.map((file) => file.name),
    bytes: unused.reduce((total, file) => total + file.bytes, 0),
  };
}
