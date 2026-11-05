import { useEffect, useState } from 'react';
import type { PaintDoc } from '../../../lib/paint/document';
import { layerImageRefs, loadLayerImages, type ImageLoader, type LayerImages } from './render';

/**
 * The layer images of a document, loaded for drawing. Only images the
 * document names are loaded; one that undo brings back is still in the map.
 *
 * `failed` names an image that could not be loaded: the editor stays locked
 * then, since its next save would show the drawing without it.
 */
export function useLayerImages(doc: PaintDoc, load: ImageLoader): { images: LayerImages; pending: boolean; failed: boolean } {
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map());
  const [failed, setFailed] = useState(false);
  const missing = layerImageRefs(doc).filter((ref) => !images.has(ref));
  const key = [...new Set(missing)].join('|');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadLayerImages(key.split('|'), load)
      .then((loaded) => {
        if (!cancelled) setImages((prev) => new Map([...prev, ...loaded]));
      })
      .catch((e: unknown) => {
        console.error('[PaintEditor] layer image failed to load:', e);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [key, load]);

  return { images, pending: missing.length > 0 && !failed, failed };
}
