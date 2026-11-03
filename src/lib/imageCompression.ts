// ── Image compression for exports ───────────────────────────────────────────
//
// Exports embed images as base64 data URLs, so a few photos straight from a
// phone can make a PDF / HTML / Emerald file tens of megabytes large. These
// helpers downscale and re-encode embedded images on a canvas before they're
// written. The original images in the vault are never touched.

export type ImageCompression = 'none' | 'balanced' | 'strong';

const PRESETS: Record<Exclude<ImageCompression, 'none'>, { maxSide: number; quality: number }> = {
  balanced: { maxSide: 1600, quality: 0.8 },
  strong:   { maxSide: 1000, quality: 0.6 },
};

// SVG is already small and resolution independent; GIFs may be animated and
// would lose their animation on a canvas.
const SKIP_RE = /^data:image\/(svg\+xml|gif)[;,]/i;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Returns a compressed version of `dataUrl`, or the original when compression
 * is off, the image can't be decoded, or the result wouldn't be smaller.
 * Encodes as WebP (keeps transparency); where the webview has no WebP encoder, opaque
 * images become JPEG and transparent ones a downscaled PNG.
 */
export async function compressDataUrl(dataUrl: string, level: ImageCompression): Promise<string> {
  if (level === 'none' || !dataUrl.startsWith('data:image/') || SKIP_RE.test(dataUrl)) return dataUrl;
  const { maxSide, quality } = PRESETS[level];

  try {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return dataUrl;
    const scale = Math.min(1, maxSide / Math.max(w, h));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let out = canvas.toDataURL('image/webp', quality);
    if (!out.startsWith('data:image/webp')) {
      // No WebP encoder (WKWebView on macOS, some WebKitGTK builds on Linux).
      // JPEG for opaque images; images
      // with transparency stay PNG and only benefit from the downscale.
      out = hasTransparency(ctx, canvas.width, canvas.height)
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', quality);
    }
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

const DATA_SRC_RE = /src="(data:image\/[^"]+)"/g;

/** Compresses every data-URL `<img src>` in `html`. Identical images are only encoded once. */
export async function compressImagesInHtml(html: string, level: ImageCompression): Promise<string> {
  if (level === 'none') return html;
  const sources = new Set<string>();
  for (const m of html.matchAll(DATA_SRC_RE)) sources.add(m[1]);
  if (!sources.size) return html;

  const replacements = new Map<string, string>();
  await Promise.all([...sources].map(async (src) => {
    replacements.set(src, await compressDataUrl(src, level));
  }));
  return html.replace(DATA_SRC_RE, (whole, src: string) => {
    const next = replacements.get(src);
    return next && next !== src ? `src="${next}"` : whole;
  });
}
