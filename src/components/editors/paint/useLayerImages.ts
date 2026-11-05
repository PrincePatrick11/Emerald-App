import { useEffect, useState } from 'react';
import { canvasImageSrc } from '../../../lib/images';
import type { PaintDoc } from '../../../lib/paint/document';
import type { LayerImages } from './render';

/**
 * The layer images of a document, loaded for drawing. They come as data
 * URLs (`canvasImageSrc`): an image over the `emerald-img` scheme could taint
 * the canvas, and the PNG export would then fail. Only images the document
 * names are loaded; one that undo brings back is still in the map.
 *
 * `failed` names an image that could not be loaded: the editor stays locked
 * then, since its next save would show the drawing without it.
 */
export function useLayerImages(doc: PaintDoc): { images: LayerImages; pending: boolean; failed: boolean } {
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map());
  const [failed, setFailed] = useState(false);
  const wanted = doc.layers.map((l) => l.image).filter((src): src is string => !!src);
  const missing = wanted.filter((src) => !images.has(src));
  const key = [...new Set(missing)].join('|');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(key.split('|').map(async (src) => {
      const img = new Image();
      img.src = await canvasImageSrc(src);
      await img.decode();
      return [src, img] as const;
    }))
      .then((loaded) => {
        if (!cancelled) setImages((prev) => new Map([...prev, ...loaded]));
      })
      .catch((e: unknown) => {
        console.error('[PaintEditor] layer image failed to load:', e);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [key]);

  return { images, pending: missing.length > 0 && !failed, failed };
}
