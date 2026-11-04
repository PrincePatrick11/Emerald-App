/**
 * The photo step of `prepareImageDataUrl` in a thread of its own: decoding a
 * phone photo, checking it and encoding it again as JPEG are heavy, and in
 * WebKit decoding (`createImageBitmap` included) and encoding hold up the page's
 * thread. Here they block only this worker. The data URL is decoded here too.
 *
 * In: the PNG as a data URL, the vault's largest edge (or `null`) and the JPEG
 * quality. Out: `{ jpeg }`, the photo as JPEG — scaled down too if it was
 * larger than the edge —, `{ jpeg: null }` when it is no photo,
 * `{ unsupported }` when this engine's worker lacks what the work needs (the
 * page then does it), or `{ error }` when the image itself failed (it is then
 * kept as it is: decoding it again on the page would fail as well, slowly).
 */
import { isPhoto, type PixelSource } from './photoCheck';

interface PhotoRequest {
  id: number;
  dataUrl: string;
  maxEdge: number | null;
  quality: number;
}

/** The bytes behind a base64 data URL; `fromBase64` where the engine has it. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const base64 = dataUrl.slice(comma + 1);
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (fromBase64) return new Blob([fromBase64(base64)], { type: mime });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** What this engine's worker cannot do; the page takes over. */
class Unsupported extends Error {}

function source(bitmap: ImageBitmap): PixelSource {
  return {
    width: bitmap.width,
    height: bitmap.height,
    read: (sx, sy, sw, sh, dw, dh, smooth) => {
      const canvas = new OffscreenCanvas(dw, dh);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Unsupported('no 2D context in the worker');
      ctx.imageSmoothingEnabled = smooth;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
      return ctx.getImageData(0, 0, dw, dh).data;
    },
  };
}

// The program's types are the page's (DOM); a worker posts without a target origin.
const scope = self as unknown as { postMessage: (message: unknown) => void };

self.onmessage = async (event: MessageEvent<PhotoRequest>) => {
  const { id, dataUrl, maxEdge, quality } = event.data;
  try {
    if (typeof createImageBitmap !== 'function' || !('convertToBlob' in OffscreenCanvas.prototype)) {
      throw new Unsupported('no createImageBitmap or convertToBlob in the worker');
    }
    const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
    if (!isPhoto(source(bitmap))) {
      bitmap.close();
      scope.postMessage({ id, jpeg: null });
      return;
    }
    const scale = maxEdge === null ? 1 : Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Unsupported('no 2D context in the worker');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    scope.postMessage({ id, jpeg, scaled: scale < 1 });
  } catch (error) {
    scope.postMessage(error instanceof Unsupported ? { id, unsupported: true } : { id, error: String(error) });
  }
};
