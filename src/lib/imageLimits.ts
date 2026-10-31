import { useSettingsStore } from '../store/settingsStore';
import { scaleToMaxEdge } from './shrinkImage';
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

async function scaleDown(dataUrl: string, maxEdge: number): Promise<string> {
  const mime = mimeOf(dataUrl);
  if (NOT_SCALED.has(mime)) return dataUrl;
  // The format stays: a JPEG photo as PNG would get bigger instead of smaller.
  // WebKit cannot write WebP and returns PNG then — that is an image too.
  return scaleToMaxEdge(dataUrl, maxEdge, { mime, quality: LOSSY.has(mime) ? LOSSY_QUALITY : undefined });
}

/**
 * Brings a pasted image within the vault's limits: first downscale to the largest
 * edge length, then check the file size. `capBytes` is a fixed cap
 * from the caller (altar images); the smaller limit applies.
 *
 * @throws ImageTooLargeError if it is still too large afterwards — with the limit that applied.
 */
export async function prepareImageDataUrl(dataUrl: string, options: { capBytes?: number } = {}): Promise<string> {
  const limits = useSettingsStore.getState().settings.images;
  const scaled = limits.maxEdge === null ? dataUrl : await scaleDown(dataUrl, limits.maxEdge);
  const candidates = [limits.maxSizeMb === null ? null : limits.maxSizeMb * MIB, options.capBytes ?? null]
    .filter((bytes): bytes is number => bytes !== null);
  if (candidates.length) {
    const maxBytes = Math.min(...candidates);
    if (dataUrlBytes(scaled) > maxBytes) throw new ImageTooLargeError(maxBytes);
  }
  return scaled;
}

/**
 * A chosen file as an icon (entry, template, block, altar): only the
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
