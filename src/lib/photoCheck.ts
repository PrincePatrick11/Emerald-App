/**
 * Telling a photo from a screenshot or graphic, on any pixel source: the page's
 * canvas (`shrinkImage.ts`) or the worker's `OffscreenCanvas` (`photoWorker.ts`).
 * No DOM here, so both can use it.
 */

/** Pixels of a region, drawn to `dw`×`dh`; `null` when no canvas is available. */
export interface PixelSource {
  width: number;
  height: number;
  read: (sx: number, sy: number, sw: number, sh: number, dw: number, dh: number, smooth: boolean) => Uint8ClampedArray | null;
}

/** The copy the transparency check runs on: its longest edge. */
const ALPHA_EDGE = 256;
/** Edge of the 1:1 patches the flatness is measured on, and where they sit. */
const PATCH = 256;
const PATCH_SPOTS = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]] as const;
/**
 * Share of neighbouring pixels that are exactly the same, below which an image
 * counts as a photo. Measured: an app screenshot 0.92, a phone photo 0.22.
 * Camera noise keeps neighbours apart; screenshots and graphics are flat areas.
 */
const PHOTO_MAX_FLATNESS = 0.5;

/**
 * Is this a photo: nothing transparent, and hardly two neighbouring pixels
 * the same? Screenshots and graphics consist of flat areas, and JPEG would smear
 * their edges and text; anything transparent would lose it. A photo with a
 * large plain background may count as a graphic and stay as it is — the safe
 * side of the mistake.
 */
export function isPhoto({ width: W, height: H, read }: PixelSource): boolean {
  // Transparency anywhere, on a small copy drawn without smoothing.
  const scale = Math.min(1, ALPHA_EDGE / Math.max(W, H));
  const alpha = read(0, 0, W, H, Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale)), false);
  if (!alpha) return false;
  for (let i = 3; i < alpha.length; i += 4) if (alpha[i] < 255) return false;

  // Flatness on a few patches at full resolution, where the noise is.
  const w = Math.min(PATCH, W);
  const h = Math.min(PATCH, H);
  let same = 0;
  let total = 0;
  for (const [fx, fy] of PATCH_SPOTS) {
    const sx = Math.max(0, Math.min(W - w, Math.round(fx * W - w / 2)));
    const sy = Math.max(0, Math.min(H - h, Math.round(fy * H - h / 2)));
    const d = read(sx, sy, w, h, w, h, false);
    if (!d) return false;
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const i = (y * w + x) * 4;
        total++;
        if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2]) same++;
      }
    }
  }
  return total > 0 && same / total < PHOTO_MAX_FLATNESS;
}
