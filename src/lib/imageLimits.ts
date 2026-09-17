import { useSettingsStore } from '../store/settingsStore';
import type { ImageSettings } from './vaultSettings';

/** Ein Bild, das auch nach dem Verkleinern über der Dateigröße des Vaults liegt. */
export class ImageTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`image larger than ${maxBytes} bytes`);
    this.name = 'ImageTooLargeError';
  }
}

/** Formate, die beim Verkleinern etwas verlören: GIF die Animation, SVG die Vektoren. */
const NOT_SCALED = new Set(['image/gif', 'image/svg+xml']);
/** Ausgabeformate, die ihre Qualität als Zahl nehmen. */
const LOSSY = new Set(['image/jpeg', 'image/webp']);
const LOSSY_QUALITY = 0.92;

function mimeOf(dataUrl: string): string {
  return dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
}

/** Die Bytes hinter einer base64-Data-URL, ohne sie zu dekodieren. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function maxBytesOf(limits: ImageSettings): number | null {
  return limits.maxSizeMb === null ? null : limits.maxSizeMb * 1024 * 1024;
}

async function scaleDown(dataUrl: string, maxEdge: number): Promise<string> {
  const mime = mimeOf(dataUrl);
  if (NOT_SCALED.has(mime)) return dataUrl;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  // Klein genug: unverändert zurück, statt es verlustbehaftet neu zu kodieren.
  if (longest <= maxEdge) return dataUrl;

  const scale = maxEdge / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Das Format bleibt: ein JPEG-Foto als PNG würde größer statt kleiner.
  // WebKit kann kein WebP schreiben und liefert dann PNG — auch das ist ein Bild.
  return canvas.toDataURL(mime, LOSSY.has(mime) ? LOSSY_QUALITY : undefined);
}

/**
 * Bringt ein eingefügtes Bild auf die Grenzen des Vaults: erst auf die größte
 * Kantenlänge verkleinern, dann die Dateigröße prüfen.
 *
 * @throws ImageTooLargeError, wenn es danach noch zu groß ist.
 */
export async function prepareImageDataUrl(
  dataUrl: string,
  limits: ImageSettings = useSettingsStore.getState().settings.images,
): Promise<string> {
  const scaled = limits.maxEdge === null ? dataUrl : await scaleDown(dataUrl, limits.maxEdge);
  const maxBytes = maxBytesOf(limits);
  if (maxBytes !== null && dataUrlBytes(scaled) > maxBytes) throw new ImageTooLargeError(maxBytes);
  return scaled;
}

/** Ob die Grenzen des Vaults überhaupt etwas an einem Bild ändern können. */
export function hasImageLimits(limits: ImageSettings = useSettingsStore.getState().settings.images): boolean {
  return limits.maxEdge !== null || limits.maxSizeMb !== null;
}
