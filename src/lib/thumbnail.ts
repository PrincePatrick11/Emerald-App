/**
 * Thumbnail generation for the altar cards (formerly also for the sigil
 * lists; since v41 the cards show the stored drawing itself).
 *
 * Renders at THUMBNAIL_W width and squeezes the result under
 * THUMBNAIL_MAX_BYTES: first WebP via a quality ladder, then the
 * caller's fallback format (altars: JPEG, opaque scene; PNG for
 * a transparent background, which JPEG would fill with black).
 *
 * The 512 KB limit used to be a literal copied four times (three
 * capture sites in AltarView plus the downscale loop here) — it
 * now lives exclusively in this file.
 */
export const THUMBNAIL_W = 640;
export const THUMBNAIL_MAX_BYTES = 524288;

function toDataUrl(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      },
      format,
      quality
    );
  });
}

export async function canvasToCappedThumbnail(
  canvas: HTMLCanvasElement,
  fallback: 'jpeg' | 'png'
): Promise<string | null> {
  // One call probes WebP support: if the runtime does not deliver real
  // WebP, it has silently fallen back to PNG (lossless, quality
  // ineffective) — then go straight to the fallback format with reliable
  // size control.
  const probe = await toDataUrl(canvas, 'image/webp', 0.85);
  if (probe !== null) {
    if (probe.startsWith('data:image/webp')) {
      if (probe.length <= THUMBNAIL_MAX_BYTES) return probe;
      for (const q of [0.65, 0.45]) {
        const r = await toDataUrl(canvas, 'image/webp', q);
        if (r !== null && r.length <= THUMBNAIL_MAX_BYTES) return r;
      }
    } else if (probe.length <= THUMBNAIL_MAX_BYTES) {
      return probe;
    }
  }

  if (fallback === 'jpeg') {
    for (const q of [0.85, 0.65, 0.45]) {
      const r = await toDataUrl(canvas, 'image/jpeg', q);
      if (r !== null && r.length <= THUMBNAIL_MAX_BYTES) return r;
    }
    return null;
  }

  // PNG has no quality ladder; a 640px line drawing stays far below the
  // limit anyway. If it does exceed it, there is no thumbnail.
  const png = await toDataUrl(canvas, 'image/png', 1);
  return png !== null && png.length <= THUMBNAIL_MAX_BYTES ? png : null;
}
