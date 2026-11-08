import { create } from 'zustand';
import { getDb } from '../lib/db';
import { fromRow, type DbRow } from '../lib/row';
import { generateId, nowIso } from '../lib/helpers';
import { listImageFiles, type StoredImage } from '../lib/images';
import { storedImageName } from '../lib/schema';
import { serialKey, serialized } from '../lib/serialize';
import type { VaultImage } from '../types';

/** What a row lets one change; the file stays what it is. */
export type ImagePatch = Partial<Pick<VaultImage, 'name' | 'tags' | 'note'>>;

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
   * Details for a file the vault stores: a new row, the live one changed, or
   * the one in the trash back and changed. A row also keeps the file from the
   * cleanup, so every picture added through "Images" gets one, named or not.
   */
  saveDetails: (file: string, patch?: ImagePatch) => Promise<VaultImage | null>;
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

  saveDetails: async (file, patch = {}) => {
    if (!storedImageName(file)) return null;
    const existing = async () => get().images.find((image) => image.file === file);
    let live = await existing();
    if (!live) {
      const db = await getDb();
      const [row] = await db.select<DbRow[]>('SELECT id FROM images WHERE file=$1', [file]);
      // In the trash: back first, then changed like a live one.
      if (row) await get().restoreImage(String(row.id));
      live = await existing();
    }
    if (live) {
      if (Object.keys(patch).length) await get().updateImage(live.id, patch);
      return get().images.find((image) => image.id === live!.id) ?? null;
    }
    const db = await getDb();
    const at = nowIso();
    const image: VaultImage = {
      id: generateId(),
      file,
      name: patch.name ?? '',
      tags: patch.tags ?? [],
      note: patch.note ?? '',
      created_at: at,
      updated_at: at,
    };
    await db.execute(
      'INSERT INTO images (id, file, name, note, tags, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [image.id, image.file, image.name, image.note, JSON.stringify(image.tags), at, at],
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
      'UPDATE images SET name=$1, note=$2, tags=$3, updated_at=$4 WHERE id=$5',
      [updated.name, updated.note, JSON.stringify(updated.tags), updated.updated_at, id],
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
