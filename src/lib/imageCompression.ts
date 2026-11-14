import { decodeImage } from './shrinkImage';

/**
 * Smaller pictures for a file that leaves the vault (`.emerald`): downscaled
 * and re-encoded on a canvas. The pictures in the vault are never touched.
 * The levels are those of the export menu of 0.1.3.7.
 */
export type ImageCompression = 'balanced' | 'strong';

const PRESETS: Record<ImageCompression, { maxSide: number; quality: number }> = {
  balanced: { maxSide: 1600, quality: 0.8 },
  strong: { maxSide: 1000, quality: 0.6 },
};

// SVG is small and resolution independent already; a GIF may be animated and
// would lose its animation on a canvas.
const SKIP_RE = /^data:image\/(svg\+xml|gif)[;,]/i;

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * `dataUrl` compressed — or unchanged when it cannot be decoded or the result
 * would not be smaller. WebP keeps transparency; where the webview has no
 * WebP encoder (WKWebView, some WebKitGTK builds), an opaque picture becomes
 * JPEG and a transparent one a downscaled PNG.
 */
export async function compressDataUrl(dataUrl: string, level: ImageCompression): Promise<string> {
  if (!dataUrl.startsWith('data:image/') || SKIP_RE.test(dataUrl)) return dataUrl;
  const { maxSide, quality } = PRESETS[level];
  try {
    const img = await decodeImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return dataUrl;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL('image/webp', quality);
    if (!out.startsWith('data:image/webp')) {
      out = hasTransparency(ctx, canvas.width, canvas.height)
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', quality);
    }
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}
