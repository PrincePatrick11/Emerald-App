import { useEffect, useState } from 'react';

/**
 * The pictures elements draw from, loaded once per source for every builder.
 * A source that fails stays `null`; the type draws its stand-in.
 */
const cache = new Map<string, HTMLImageElement | null>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

function loadBuilderImage(src: string): Promise<HTMLImageElement | null> {
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

export function cachedBuilderImage(src: string): HTMLImageElement | null {
  return cache.get(src) ?? null;
}

/**
 * Loads the given sources and fonts and returns a number that changes
 * whenever one of them has arrived, for redrawing.
 */
export function useBuilderResources(sources: readonly string[], fonts: readonly string[]): number {
  const [version, setVersion] = useState(0);
  const sourceKey = [...sources].sort().join('\n');
  const fontKey = [...fonts].sort().join('\n');
  useEffect(() => {
    let alive = true;
    const bump = () => { if (alive) setVersion((v) => v + 1); };
    for (const src of sourceKey ? sourceKey.split('\n') : []) {
      if (!cache.has(src)) void loadBuilderImage(src).then(bump);
    }
    if (fontKey && document.fonts) {
      void Promise.all(fontKey.split('\n').map((f) => document.fonts.load(f).catch(() => []))).then(bump);
    }
    return () => { alive = false; };
  }, [sourceKey, fontKey]);
  return version;
}
