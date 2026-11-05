import { useEffect, useState } from 'react';

/**
 * The pictures of image elements, loaded once per source for every builder.
 * A source that fails stays `null`, and the element shows its emoji.
 */
const cache = new Map<string, HTMLImageElement | null>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

export function loadBuilderImage(src: string): Promise<HTMLImageElement | null> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!);
  let promise = pending.get(src);
  if (!promise) {
    promise = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    }).then((img) => {
      cache.set(src, img);
      pending.delete(src);
      return img;
    });
    pending.set(src, promise);
  }
  return promise;
}

export function cachedBuilderImage(src: string | null): HTMLImageElement | null {
  return src ? cache.get(src) ?? null : null;
}

/**
 * Loads the given sources and returns a number that changes whenever one of
 * them has arrived, for redrawing.
 */
export function useBuilderImages(srcs: readonly (string | null)[]): number {
  const [version, setVersion] = useState(0);
  const key = [...new Set(srcs.filter((s): s is string => !!s))].sort().join('\n');
  useEffect(() => {
    let alive = true;
    for (const src of key ? key.split('\n') : []) {
      if (cache.has(src)) continue;
      void loadBuilderImage(src).then(() => { if (alive) setVersion((v) => v + 1); });
    }
    return () => { alive = false; };
  }, [key]);
  return version;
}
