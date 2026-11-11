import { useSettingsStore } from '../store/settingsStore';
import { decodeImage, encodeScaled, looksLikePhoto, scaleToMaxEdge } from './shrinkImage';
import { isAcceptedImageFile, readFileAsDataUrl } from './helpers';

/** An image that is still over the vault's file size limit even after downscaling. */
export class ImageTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`image larger than ${maxBytes} bytes`);
    this.name = 'ImageTooLargeError';
  }
}

/** Formats that would lose something when downscaled: GIF its animation, SVG its vectors. */
const NOT_SCALED = new Set(['image/gif', 'image/svg+xml']);
/** Output formats that take their quality as a number. */
const LOSSY = new Set(['image/jpeg', 'image/webp']);
const LOSSY_QUALITY = 0.92;

function mimeOf(dataUrl: string): string {
  return dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
}

/** The bytes behind a base64 data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const MIB = 1024 * 1024;

/** "5 MB" — the limits are whole MB steps, and so is a cap like 64 MB.
 *  Not `formatBytes`: that would drop to KB for small limits, and
 *  "512 KB" next to nothing but MB steps would read like a different setting. */
export function imageSizeLabel(bytes: number, megabytesUnit: string): string {
  return `${Math.round((bytes / MIB) * 10) / 10} ${megabytesUnit}`;
}

/** Below this a PNG is left as it is: an icon or a small graphic gains next to nothing. */
const PHOTO_MIN_BYTES = 512 * 1024;

/**
 * Is this image a candidate for JPEG: a PNG of some size, with "Optimise
 * photos" on. Photos copied to the clipboard arrive as PNG, lossless and four
 * to five times the size of a JPEG nobody can tell apart from it. Whether it
 * really is a photo, `isPhoto` decides. A JPEG is not encoded again, GIF and
 * SVG never change.
 */
function photoCandidate(dataUrl: string): boolean {
  return useSettingsStore.getState().settings.images.optimizePhotos
    && mimeOf(dataUrl) === 'image/png' && dataUrlBytes(dataUrl) >= PHOTO_MIN_BYTES;
}

/** A photo as JPEG, and whether it was scaled down on the way. */
interface PhotoJpeg {
  jpeg: string;
  scaled: boolean;
}

/**
 * What the photo step came to: the JPEG, no photo, or `unsupported` (no worker
 * that can do it here) and `failed` (the image itself would not decode or encode).
 */
type PhotoResult = PhotoJpeg | 'none' | 'unsupported' | 'failed';

/* ---------------- The photo worker ---------------- */

type WorkerReply =
  | { id: number; jpeg: Blob | null; scaled?: boolean }
  | { id: number; unsupported: true }
  | { id: number; error: string };

let worker: Worker | null | undefined;
let nextRequest = 0;
const pending = new Map<number, (reply: WorkerReply) => void>();

/** The one worker, started on first use; `null` where a WebView has no worker with `OffscreenCanvas`. */
function photoWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
      ? new Worker(new URL('./photoWorker.ts', import.meta.url), { type: 'module' })
      : null;
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      pending.get(event.data.id)?.(event.data);
      pending.delete(event.data.id);
    };
    // A worker that cannot start (or dies) leaves the open requests to the
    // page, and is not used again.
    worker.onerror = () => {
      for (const [id, reply] of pending) reply({ id, unsupported: true });
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

async function photoInWorker(dataUrl: string, maxEdge: number | null): Promise<PhotoResult> {
  const w = photoWorker();
  if (!w) return 'unsupported';
  const id = nextRequest++;
  const reply = await new Promise<WorkerReply>((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, dataUrl, maxEdge, quality: LOSSY_QUALITY });
  });
  if ('unsupported' in reply) return 'unsupported';
  if ('error' in reply) return 'failed';
  return reply.jpeg ? { jpeg: await readFileAsDataUrl(reply.jpeg), scaled: !!reply.scaled } : 'none';
}

/** The same on the page, where no worker can: decoded once for check and conversion. */
async function photoOnPage(dataUrl: string, maxEdge: number | null): Promise<PhotoResult> {
  try {
    const img = await decodeImage(dataUrl);
    if (!looksLikePhoto(img)) return 'none';
    const scale = maxEdge === null ? 1 : Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    return { jpeg: await encodeScaled(img, scale, 'image/jpeg', LOSSY_QUALITY), scaled: scale < 1 };
  } catch {
    return 'failed';
  }
}

/* ---------------- Preparing an image ---------------- */

async function scaleDown(dataUrl: string, maxEdge: number): Promise<string> {
  const mime = mimeOf(dataUrl);
  if (NOT_SCALED.has(mime)) return dataUrl;
  // The format stays: a JPEG photo as PNG would get bigger instead of smaller.
  // WebKit cannot write WebP and returns PNG then — that is an image too.
  return scaleToMaxEdge(dataUrl, maxEdge, { mime, quality: LOSSY.has(mime) ? LOSSY_QUALITY : undefined });
}

/**
 * Downscaled to `maxEdge` and, for a photo, as JPEG — in the worker where there
 * is one (decoding and encoding a phone photo would otherwise hold up the
 * window), else on the page, each in one pass so a photo is compressed only
 * once. A JPEG is kept if it is smaller or was scaled down too.
 */
async function scaledAndConverted(dataUrl: string, maxEdge: number | null): Promise<string> {
  let photo: PhotoResult = 'none';
  if (photoCandidate(dataUrl)) {
    photo = await photoInWorker(dataUrl, maxEdge);
    if (photo === 'unsupported') photo = await photoOnPage(dataUrl, maxEdge);
  }
  if (typeof photo === 'object' && (photo.scaled || dataUrlBytes(photo.jpeg) < dataUrlBytes(dataUrl))) return photo.jpeg;
  return maxEdge === null ? dataUrl : scaleDown(dataUrl, maxEdge);
}

/**
 * The one step every image goes through before it is stored (editor, image
 * fields, covers and icons, canvases, `.emerald` imports): a photo PNG becomes
 * a JPEG, then everything is brought within the vault's limits — downscaled to
 * the largest edge length, then the file size checked. Downscaling and the
 * change of format happen in one pass, so a photo is compressed only once.
 * `capBytes` is a fixed cap from the caller (old altar backgrounds on import); the smaller limit
 * applies. Backups and sigil drawings do not come through here.
 *
 * @throws ImageTooLargeError if it is still too large afterwards — with the limit that applied.
 */
export async function prepareImageDataUrl(dataUrl: string, options: { capBytes?: number } = {}): Promise<string> {
  const limits = useSettingsStore.getState().settings.images;
  const scaled = await scaledAndConverted(dataUrl, limits.maxEdge);
  const candidates = [limits.maxSizeMb === null ? null : limits.maxSizeMb * MIB, options.capBytes ?? null]
    .filter((bytes): bytes is number => bytes !== null);
  if (candidates.length) {
    const maxBytes = Math.min(...candidates);
    if (dataUrlBytes(scaled) > maxBytes) throw new ImageTooLargeError(maxBytes);
  }
  return scaled;
}

/**
 * A chosen file as an icon (entry, template, block): only the
 * accepted image formats and no SVG — icons sit inline in the row —,
 * downscaled like any image. `null` for a rejected file; the
 * error message is left to the caller.
 *
 * @throws like `prepareImageDataUrl`, or if reading fails.
 */
export async function readIconFile(file: File): Promise<string | null> {
  if (!isAcceptedImageFile(file) || file.type === 'image/svg+xml') return null;
  return prepareImageDataUrl(await readFileAsDataUrl(file));
}

/** Whether the vault's limits can change anything about an image at all. */
export function hasImageLimits(): boolean {
  const limits = useSettingsStore.getState().settings.images;
  return limits.maxEdge !== null || limits.maxSizeMb !== null;
}

/**
 * Whether a file at `path` has to be read in and go through
 * `prepareImageDataUrl`, or may be copied as it is: with limits always, and a
 * PNG also when photos are optimised.
 */
export function needsPreparing(path: string): boolean {
  return hasImageLimits() || (useSettingsStore.getState().settings.images.optimizePhotos && /\.png$/i.test(path));
}
