import { create } from 'zustand';
import { getDb } from '../lib/db';
import { fromRow, type DbRow } from '../lib/row';
import { generateId, isAcceptedImageFile, nowIso, readFileAsDataUrl } from '../lib/helpers';
import { listImageFiles, saveImage, type StoredImage } from '../lib/images';
import { prepareImageDataUrl } from '../lib/imageLimits';
import { storedImageName } from '../lib/schema';
import { serialKey, serialized } from '../lib/serialize';
import type { VaultImage } from '../types';

/** What a row lets one change; the file stays what it is. */
export type ImagePatch = Partial<Pick<VaultImage, 'name' | 'emoji' | 'category_id' | 'tags' | 'note'>>;

/** A new row takes the file's name without its extension, so a picture is never nameless. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

const byName = (a: VaultImage, b: VaultImage) =>
  (a.name || a.file).localeCompare(b.name || b.file) || a.created_at.localeCompare(b.created_at);

interface ImageState {
  /** The images taken into "Images", live ones only, by name. */
  images: VaultImage[];
  /** Every stored file of the vault, from the folder — also those without a row. */
  files: StoredImage[];
  loaded: boolean;
  fetchImages: () => Promise<void>;
  /** The folder again, after something else stored or removed files. */
  refreshFiles: () => Promise<void>;
  /**
   * Files from the disk into "Images", each prepared (limits, photo as JPEG)
   * and stored first, in their order. A file of another format is skipped and
   * reported in `skipped`; one that fails is reported in `failed` and does not
   * stop the others.
   */
  addFiles: (files: File[], patch?: ImagePatch) => Promise<{ added: VaultImage[]; skipped: number; failed: unknown[] }>;
  /** A file the vault already stores, taken into "Images" (or back, from the trash). */
  adoptFile: (file: string, patch?: ImagePatch) => Promise<VaultImage | null>;
  updateImage: (id: string, patch: ImagePatch) => Promise<void>;
  /** Into the trash; the file stays until the cleanup finds it unused. */
  deleteImage: (id: string) => Promise<void>;
  restoreImage: (id: string) => Promise<void>;
  /** The row for good — the file is left to the cleanup in Settings → Storage. */
  permanentlyDeleteImage: (id: string) => Promise<void>;
}

export const useImageStore = create<ImageState>((set, get) => ({
  images: [],
  files: [],
  loaded: false,

  fetchImages: async () => {
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT * FROM images WHERE deleted_at IS NULL');
    set({ images: rows.map(fromRow.image).sort(byName), loaded: true });
    await get().refreshFiles();
  },

  refreshFiles: async () => {
    try {
      set({ files: await listImageFiles() });
    } catch (e) {
      // Without the folder the rows still show; nothing to lose.
      console.error('[images] listing the folder failed:', e);
    }
  },

  addFiles: async (files, patch = {}) => {
    const added: VaultImage[] = [];
    const failed: unknown[] = [];
    const accepted = files.filter(isAcceptedImageFile);
    for (const file of accepted) {
      try {
        const stored = await saveImage(await prepareImageDataUrl(await readFileAsDataUrl(file)));
        const image = await get().adoptFile(stored, { name: nameFromFile(file.name), ...patch });
        if (image) added.push(image);
      } catch (e) {
        failed.push(e);
      }
    }
    if (added.length) await get().refreshFiles();
    return { added, skipped: files.length - accepted.length, failed };
  },

  adoptFile: async (file, patch = {}) => {
    if (!storedImageName(file)) return null;
    const live = get().images.find((image) => image.file === file);
    if (live) return live;
    const db = await getDb();
    const [row] = await db.select<DbRow[]>('SELECT * FROM images WHERE file=$1', [file]);
    if (row) {
      // In the trash: back, as it was.
      await get().restoreImage(String(row.id));
      return get().images.find((image) => image.file === file) ?? null;
    }
    const at = nowIso();
    const image: VaultImage = {
      id: generateId(),
      file,
      name: patch.name ?? '',
      emoji: patch.emoji ?? '🖼️',
      category_id: patch.category_id ?? null,
      tags: patch.tags ?? [],
      note: patch.note ?? '',
      created_at: at,
      updated_at: at,
    };
    await db.execute(
      'INSERT INTO images (id, file, name, emoji, note, category_id, tags, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [image.id, image.file, image.name, image.emoji, image.note, image.category_id, JSON.stringify(image.tags), at, at],
    );
    set((s) => ({ images: [...s.images, image].sort(byName) }));
    return image;
  },

  // serialized: see lib/serialize.ts.
  updateImage: (id, patch) => serialized(serialKey('image', id), async () => {
    const image = get().images.find((i) => i.id === id);
    if (!image) return;
    const updated: VaultImage = { ...image, ...patch, updated_at: nowIso() };
    const db = await getDb();
    await db.execute(
      'UPDATE images SET name=$1, emoji=$2, note=$3, category_id=$4, tags=$5, updated_at=$6 WHERE id=$7',
      [updated.name, updated.emoji, updated.note, updated.category_id, JSON.stringify(updated.tags), updated.updated_at, id],
    );
    set((s) => ({ images: s.images.map((i) => (i.id === id ? updated : i)).sort(byName) }));
  }),

  deleteImage: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE images SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ images: s.images.filter((i) => i.id !== id) }));
  },

  restoreImage: async (id) => {
    // Already back (undo and trash one after the other).
    if (get().images.some((i) => i.id === id)) return;
    const db = await getDb();
    await db.execute('UPDATE images SET deleted_at=NULL WHERE id=$1', [id]);
    const [row] = await db.select<DbRow[]>('SELECT * FROM images WHERE id=$1', [id]);
    if (!row) return;
    const image = fromRow.image(row);
    set((s) => ({ images: [...s.images.filter((i) => i.id !== id), image].sort(byName) }));
  },

  permanentlyDeleteImage: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM images WHERE id=$1', [id]);
    set((s) => ({ images: s.images.filter((i) => i.id !== id) }));
  },
}));
