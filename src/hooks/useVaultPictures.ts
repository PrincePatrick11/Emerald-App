import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useImageStore } from '../store/imageStore';
import { isOnlyDrawingOrBackground } from '../lib/imageUsage';
import type { VaultImage } from '../types';

/** A picture of "Images": a stored file, with its details if it has any. */
export interface PictureItem {
  file: string;
  image: VaultImage | null;
}

/** Named pictures by name, then the unnamed ones. */
function byName(a: PictureItem, b: PictureItem): number {
  const an = a.image?.name ?? '';
  const bn = b.image?.name ?? '';
  if (!an !== !bn) return an ? -1 : 1;
  return an.localeCompare(bn) || a.file.localeCompare(b.file);
}

/**
 * Every picture of "Images", as the view and the picture picker show it: the
 * vault's stored files with their details, without those in the trash and
 * without sigil drawings and canvas backgrounds (the thing itself, not a
 * picture of its own). Reads the folder and the places of use again on mount.
 */
export function useVaultPictures(): { pictures: PictureItem[]; loaded: boolean } {
  const { images, files, trashedFiles, uses, loaded } = useImageStore(useShallow((s) => ({
    images: s.images, files: s.files, trashedFiles: s.trashedFiles, uses: s.uses, loaded: s.loaded,
  })));

  useEffect(() => {
    void useImageStore.getState().refreshFiles();
    void useImageStore.getState().refreshUses();
  }, []);

  const pictures = useMemo<PictureItem[]>(() => {
    const byFile = new Map(images.map((image) => [image.file, image]));
    const listed = new Set<string>();
    const items: PictureItem[] = [];
    for (const { name } of files) {
      listed.add(name);
      if (trashedFiles.has(name)) continue;
      const image = byFile.get(name) ?? null;
      if (!image && isOnlyDrawingOrBackground(uses.get(name))) continue;
      items.push({ file: name, image });
    }
    // Details whose file the folder did not list (yet): still shown.
    for (const image of images) if (!listed.has(image.file)) items.push({ file: image.file, image });
    return items.sort(byName);
  }, [images, files, trashedFiles, uses]);

  return { pictures, loaded };
}

/** The pictures whose name or note holds the query (case-insensitive). */
export function searchPictures(pictures: PictureItem[], search: string): PictureItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return pictures;
  return pictures.filter((item) => (item.image?.name ?? '').toLowerCase().includes(query)
    || (item.image?.note ?? '').toLowerCase().includes(query));
}
