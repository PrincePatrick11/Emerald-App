import { getDb } from '../lib/db';
import { generateId } from '../lib/helpers';
import { collectImageUses, isRemovableUse, withoutImage, type ImageUse } from '../lib/imageUsage';
import type { VaultImage } from '../types';
import { useImageStore } from './imageStore';
import { useEntryStore } from './entryStore';
import { useTemplateStore } from './templateStore';
import type { UndoAction } from './undoStore';

/** A text a picture was taken out of: its content before and after, kept in `images.detached`. */
interface Detached {
  kind: 'entry' | 'template';
  id: string;
  before: string;
  after: string;
}

/** The places a picture is shown in now, read from the database — entries and templates whose texts or image fields hold it. */
export async function placesShowing(file: string): Promise<ImageUse[]> {
  return ((await collectImageUses(await getDb())).get(file) ?? []).filter(isRemovableUse);
}

async function writeContent(kind: Detached['kind'], id: string, content: string): Promise<void> {
  if (kind === 'entry') await useEntryStore.getState().updateEntry(id, { content });
  else await useTemplateStore.getState().updateTemplate(id, { content });
}

/**
 * A picture out of "Images" into the trash — and, where it is still shown in
 * texts or image fields of entries and templates, out of those too. Sigil
 * drawings, canvas backgrounds and block defaults keep it. What it was taken
 * out of is kept with the picture, so that restoring it — by Undo or from
 * the trash — puts it back (`restorePicture`). A file without details gets
 * them first, so that the trash holds it like any other picture.
 */
export async function deletePicture(
  file: string,
  image: VaultImage | null,
  description: string,
  pushUndo: (action: UndoAction) => void,
): Promise<void> {
  const store = useImageStore.getState();
  const db = await getDb();
  const detached: Detached[] = [];
  for (const use of await placesShowing(file)) {
    const kind = use.kind as Detached['kind'];
    const [row] = await db.select<{ content: string | null }[]>(
      `SELECT content FROM ${kind === 'entry' ? 'entries' : 'templates'} WHERE id=$1`, [use.id],
    );
    const before = row?.content ?? '';
    const after = withoutImage(before, file);
    if (after === before) continue;
    await writeContent(kind, use.id, after);
    detached.push({ kind, id: use.id, before, after });
  }

  const row = image ?? await store.saveDetails(file);
  if (!row) return;
  await store.deleteImage(row.id);
  await db.execute('UPDATE images SET detached=$1 WHERE id=$2', [JSON.stringify(detached), row.id]);
  await store.refreshUses();
  pushUndo({ id: generateId(), description, undo: async () => { await restorePicture(row.id); } });
}

/**
 * A picture back from the trash, and back into the texts it was taken out
 * of — each one only if it has not changed since; one that has keeps its
 * current content (an edit there is not overwritten). Returns how many could
 * not take the picture back.
 */
export async function restorePicture(id: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select<{ detached: string | null }[]>('SELECT detached FROM images WHERE id=$1', [id]);
  let missed = 0;
  let detached: Detached[] = [];
  try {
    detached = JSON.parse(row?.detached ?? '[]') as Detached[];
  } catch {
    detached = [];
  }
  for (const place of Array.isArray(detached) ? detached : []) {
    if ((place.kind !== 'entry' && place.kind !== 'template') || typeof place.id !== 'string') continue;
    const [current] = await db.select<{ content: string | null }[]>(
      `SELECT content FROM ${place.kind === 'entry' ? 'entries' : 'templates'} WHERE id=$1`, [place.id],
    );
    if (!current || current.content !== place.after) { missed++; continue; }
    await writeContent(place.kind, place.id, place.before);
  }
  await db.execute("UPDATE images SET detached='[]' WHERE id=$1", [id]);
  await useImageStore.getState().restoreImage(id);
  await useImageStore.getState().refreshUses();
  return missed;
}
