/**
 * The photo step of `prepareImageDataUrl` in a thread of its own: decoding a
 * phone photo takes about two seconds, encoding it again over half a second,
 * and in WebKit both hold up the window (`createImageBitmap` included) when
 * run on the page. Here they block only this worker.
 *
 * In: the PNG as a data URL, the vault's largest edge (or `null`) and the JPEG
 * quality. The data URL is decoded here too: for a phone photo `atob` alone
 * takes seconds in WebKit. Out: `{ jpeg }`, the photo as JPEG — scaled down too if it was
 * larger than the edge — or `{ jpeg: null }` when it is no photo.
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

function source(bitmap: ImageBitmap): PixelSource {
  return {
    width: bitmap.width,
    height: bitmap.height,
    read: (sx, sy, sw, sh, dw, dh, smooth) => {
      const canvas = new OffscreenCanvas(dw, dh);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
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
    const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
    if (!isPhoto(source(bitmap))) {
      bitmap.close();
      scope.postMessage({ id, jpeg: null });
      return;
    }
    const scale = maxEdge === null ? 1 : Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    scope.postMessage({ id, jpeg, scaled: scale < 1 });
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
