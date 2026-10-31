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
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
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

/**
 * Shrink an icon (PNG, so that transparency is kept). If it is already small
 * enough in dimensions and size, it comes back unchanged — a short animated
 * GIF then stays animated.
 *
 * For icons that travel along many times: a custom block's icon sits in
 * every copy in every entry, a full-size photo would bloat every one of them.
 */
export async function shrinkImageDataUrl(dataUrl: string, maxEdge: number): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  // Small but heavy (embedded metadata, long GIF animation): that too
  // is re-encoded. The limit lies above a 64px PNG.
  if (longest <= maxEdge && dataUrl.length <= maxEdge * maxEdge * 8) return dataUrl;
  return drawScaled(img, Math.min(1, maxEdge / longest), { mime: 'image/png' });
}
