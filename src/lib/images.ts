/**
 * Stored images.
 *
 * The database holds a bare filename — `{sha256}.{ext}` — and nothing else. No
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
import type Database from '@tauri-apps/plugin-sql';

// Das Namensformat ist eine Eigenschaft der Spalten, nicht der Oberflaeche —
// deshalb steht es in `schema.ts`. Hier nur weitergereicht, damit die UI eine
// Anlaufstelle fuer alles Bildbezogene hat.
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
 * untouched — altar item images and imported content still carry those.
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
 * Bildverweise in HTML.
 *
 * Vier Stellen haben dieses `src`-Muster frueher jede fuer sich ausgeschrieben:
 * der Backup-Export, der `.emerald`-Export, `embedImages` fuer PDF/Markdown und
 * Migration v35. Sie unterscheiden sich nur darin, was sie mit dem Treffer tun.
 */
const SRC_ATTR_RE = /src="([^"]+)"/g;

/** Jeder `src`-Wert eines Fragments, der auf ein gespeichertes Bild zeigt. */
export function imageRefsInHtml(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(SRC_ATTR_RE)) {
    if (isStoredImage(match[1])) refs.push(match[1]);
  }
  return refs;
}

/**
 * Schreibt jedes `src` um, fuer das `replacement` einen Wert liefert. `null`
 * laesst den Treffer unangetastet — auch die Anfuehrungszeichen drumherum.
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
 * Dieselbe Quelle, aber fuer eine Zeichenflaeche.
 *
 * Der Altar-Export malt seine Bilder auf ein Canvas und liest es mit
 * `toBlob()` wieder aus. Ein Bild, das der Browser als fremd ansieht,
 * verunreinigt das Canvas und laesst das Auslesen scheitern. Ueber
 * `emerald-img` gelieferte Bilder *sind* fremd — der Handler schickt zwar eine
 * CORS-Erlaubnis mit, aber ob WebKitGTK und WKWebView die fuer ein eigenes
 * Schema ueberhaupt auswerten, laesst sich unter Windows nicht pruefen, und ein
 * Fehlschlag waere still: der Export liefert dann einfach nichts.
 *
 * Deshalb geht dieser eine Pfad nicht ueber das Schema, sondern holt die Bytes
 * als Data-URL. Die gilt immer als eigene Quelle, auf jeder Engine. Der Preis
 * ist ein IPC-Roundtrip pro Bild — nur beim Export und beim Thumbnail, nie beim
 * normalen Anzeigen.
 */
export async function canvasImageSrc(ref: string | null | undefined): Promise<string> {
  if (!ref) return '';
  // Inline-Quellen und die Presets aus `public/` sind ohnehin unbedenklich.
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
  return invoke<number>('delete_image_files', {
    filenames,
    vaultId: await getActiveVaultId(),
  });
}

/** Copies images out of the pre-0.2.1 shared pool into the active vault. */
export async function adoptLegacyImages(filenames: string[]): Promise<number> {
  return invoke<number>('adopt_legacy_images', {
    filenames,
    vaultId: await getActiveVaultId(),
  });
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
 * The pre-per-vault shared pool is not considered. `list_image_files` only
 * reports the vault's own folder, and vaults that have not been opened since
 * the migration still read from that pool.
 *
 * Takes the database rather than calling `getDb()` so this module does not
 * depend on `db.ts` — `db.ts` needs `adoptLegacyImages` from here for migration
 * v35, and a cycle between the two would be the fragile way to get it.
 */
export async function findUnusedImages(db: Database): Promise<UnusedImages> {
  const [files, used] = await Promise.all([listImageFiles(), collectUsedImageFilenames(db)]);
  const unused = files.filter((file) => !used.has(file.name));
  return {
    names: unused.map((file) => file.name),
    bytes: unused.reduce((total, file) => total + file.bytes, 0),
  };
}
