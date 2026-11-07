import { isPhoto } from './photoCheck';
import { readFileAsDataUrl } from './helpers';

/**
 * Draw an image as a data URL at no more than `maxEdge` pixels edge length.
 * If it already fits, it comes back unchanged.
 *
 * `mime` determines the output format: by default that of the image (a
 * JPEG photo as PNG would get larger instead of smaller), `quality` applies only to the
 * lossy formats. The one canvas for both callers —
 * `shrinkImageDataUrl` for icons and `prepareImageDataUrl` for a vault's
 * limits (`lib/imageLimits.ts`).
 */
export async function scaleToMaxEdge(
  dataUrl: string,
  maxEdge: number,
  options: { mime?: string; quality?: number } = {},
): Promise<string> {
  const img = await decodeImage(dataUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= maxEdge) return dataUrl;
  return drawScaled(img, maxEdge / longest, options);
}

function drawScaled(img: HTMLImageElement, scale: number, options: { mime?: string; quality?: number }): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(options.mime, options.quality);
}

/** The page-side photo check (`photoCheck.ts`), for when no worker is available. */
export function looksLikePhoto(img: HTMLImageElement): boolean {
  return isPhoto({
    width: img.naturalWidth,
    height: img.naturalHeight,
    read: (sx, sy, sw, sh, dw, dh, smooth) => {
      const canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = smooth;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      return ctx.getImageData(0, 0, dw, dh).data;
    },
  });
}

/** A data URL as a decoded image, for callers that look at it more than once. */
export async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/**
 * The image drawn at `scale` (1 = full size) and encoded as `mime`, e.g. a photo
 * PNG as JPEG. Encoded through `toBlob`, which does not wait for the encoder on
 * the page's thread the way `toDataURL` does: a phone photo takes over half a
 * second to encode.
 */
export async function encodeScaled(img: HTMLImageElement, scale: number, mime: string, quality?: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error('Image could not be encoded');
  return readFileAsDataUrl(blob);
}

/**
 * Shrink an icon (PNG, so that transparency is kept). If it is already small
 * enough in dimensions and size, it comes back unchanged — a short animated
 * GIF then stays animated.
 *
 * For icons that travel along many times: a custom block's icon sits in
 * every copy in every entry, a full-size photo would bloat every one of them.
 */
export async function shrinkImageDataUrl(dataUrl: string, maxEdge: number): Promise<string> {
  const img = await decodeImage(dataUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  // Small but heavy (embedded metadata, long GIF animation): that too
  // is re-encoded. The limit lies above a 64px PNG.
  if (longest <= maxEdge && dataUrl.length <= maxEdge * maxEdge * 8) return dataUrl;
  return drawScaled(img, Math.min(1, maxEdge / longest), { mime: 'image/png' });
}
