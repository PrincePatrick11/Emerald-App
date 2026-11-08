import { getDb } from '../lib/db';
import { generateId } from '../lib/helpers';
import { isRemovableUse, withoutImage } from '../lib/imageUsage';
import type { VaultImage } from '../types';
import { useImageStore } from './imageStore';
import { useEntryStore } from './entryStore';
import { useTemplateStore } from './templateStore';
import type { UndoAction } from './undoStore';

/**
 * A picture out of "Images" into the trash — and, if it is still shown in
 * texts or image fields of entries and templates, out of those first. Sigil
 * drawings, altar backgrounds and block defaults keep it. One Undo puts the
 * picture and every text back. A file without details gets them first, so
 * that the trash holds it like any other picture.
 */
export async function deletePicture(
  file: string,
  image: VaultImage | null,
  description: string,
  pushUndo: (action: UndoAction) => void,
): Promise<void> {
  const store = useImageStore.getState();
  const db = await getDb();
  const removable = (store.uses.get(file) ?? []).filter(isRemovableUse);
  const before: { kind: 'entry' | 'template'; id: string; content: string }[] = [];

  for (const use of removable) {
    const table = use.kind === 'entry' ? 'entries' : 'templates';
    const [row] = await db.select<{ content: string | null }[]>(`SELECT content FROM ${table} WHERE id=$1`, [use.id]);
    const content = row?.content ?? '';
    const next = withoutImage(content, file);
    if (next === content) continue;
    before.push({ kind: use.kind as 'entry' | 'template', id: use.id, content });
    if (use.kind === 'entry') await useEntryStore.getState().updateEntry(use.id, { content: next });
    else await useTemplateStore.getState().updateTemplate(use.id, { content: next });
  }

  const row = image ?? await store.saveDetails(file);
  if (row) await store.deleteImage(row.id);
  await store.refreshUses();

  pushUndo({
    id: generateId(),
    description,
    undo: async () => {
      for (const { kind, id, content } of before) {
        if (kind === 'entry') await useEntryStore.getState().updateEntry(id, { content });
        else await useTemplateStore.getState().updateTemplate(id, { content });
      }
      if (row) await useImageStore.getState().restoreImage(row.id);
      await useImageStore.getState().refreshUses();
    },
  });
}
