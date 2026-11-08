import { copyImageFile, readImageFile, saveImage } from './images';
import { hasImageLimits, ImageTooLargeError, needsPreparing, prepareImageDataUrl } from './imageLimits';
import { readFileAsDataUrl } from './helpers';

/** The read limit of the Rust command along with its number (see `images.rs`). */
const TOO_LARGE_TO_READ = /image file too large: (\d+)/;

/**
 * The stored name of a file dropped from the disk: read in and prepared
 * (limits, photo as JPEG) when that could change it, else copied as it is.
 * A file too large to read in is copied too as long as the vault sets no
 * limits — only a photo conversion was asked for then, and it would not be
 * stored at all otherwise. With limits, the read limit becomes the usual notice.
 */
export async function storeImageFromPath(path: string): Promise<string> {
  if (!needsPreparing(path)) return copyImageFile(path);
  let dataUrl: string;
  try {
    dataUrl = await readImageFile(path);
  } catch (err) {
    const limit = TOO_LARGE_TO_READ.exec(String(err));
    if (!limit) throw err;
    if (!hasImageLimits()) return copyImageFile(path);
    throw new ImageTooLargeError(Number(limit[1]));
  }
  return saveImage(await prepareImageDataUrl(dataUrl));
}

/** The stored name of a chosen or pasted file, prepared (limits, photo as JPEG) first. */
export async function storeImageFile(file: Blob): Promise<string> {
  return saveImage(await prepareImageDataUrl(await readFileAsDataUrl(file)));
}
