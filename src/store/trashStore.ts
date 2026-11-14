import { create } from 'zustand';
import { getDb, sweepDanglingTaskLinks } from '../lib/db';
import { removeUnusedFiles, useImageStore } from './imageStore';
import { purgeCategory } from '../lib/schema';
import { trashWiring } from './moduleWiring';
import { useTagStore } from './tagStore';
import { useSettingsStore } from './settingsStore';
import { selectTrashedTaskRoots } from './taskStore';
import { reassignCategoriesInMemory } from './categoryStore';
import { definitionLabel, templateLabel } from '../lib/blocks/blockAttrs';
import { iconTitle } from '../lib/helpers';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import type { TrashedItem } from '../types';
import { kindOfEntry } from './dashboardStore';
import { jsonArray } from '../lib/row';

interface TrashState {
  items: TrashedItem[];
  loading: boolean;

  fetchTrashed: () => Promise<void>;
  restore: (item: TrashedItem) => Promise<void>;
  permanentlyDelete: (item: TrashedItem) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

export const useTrashStore = create<TrashState>((set, get) => ({
  items: [],
  loading: false,

  fetchTrashed: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      // All entries in one query; the group they show under follows from their category (`kindOfEntry`).
      const entries = await db.select<{ id: string; category_id: string | null; tags: string; title: string; deleted_at: string; category: string | null }[]>(
        `SELECT e.id, e.category_id, e.tags, e.title, e.deleted_at, c.name as category
           FROM entries e LEFT JOIN categories c ON e.category_id = c.id
          WHERE e.deleted_at IS NOT NULL`
      );
      const tags = await db.select<{ id: string; name: string; deleted_at: string }[]>(
        `SELECT id, name, deleted_at FROM tags WHERE deleted_at IS NOT NULL`
      );
      const categories = await db.select<{ id: string; name: string; emoji: string; deleted_at: string }[]>(
        `SELECT id, name, emoji, deleted_at FROM categories WHERE deleted_at IS NOT NULL`
      );
      // A task together with the subtasks that went with it counts as one entry.
      const tasks = await selectTrashedTaskRoots(db);
      const blockDefinitions = await db.select<{ id: string; name: string; icon: string; deleted_at: string }[]>(
        `SELECT id, name, icon, deleted_at FROM block_definitions WHERE deleted_at IS NOT NULL`
      );
      const templates = await db.select<{ id: string; name: string; icon: string; deleted_at: string }[]>(
        `SELECT id, name, icon, deleted_at FROM templates WHERE deleted_at IS NOT NULL`
      );
      const languages = await db.select<{ id: string; name: string; icon: string; deleted_at: string }[]>(
        `SELECT id, name, icon, deleted_at FROM languages WHERE deleted_at IS NOT NULL`
      );
      const images = await db.select<{ id: string; name: string; file: string; deleted_at: string }[]>(
        `SELECT id, name, file, deleted_at FROM images WHERE deleted_at IS NOT NULL`
      );
      const items: TrashedItem[] = [
        // Without a title of its own, "Unnamed…", as everywhere (`displayTitle`).
        ...entries.map((r) => {
          const kind = kindOfEntry({ category_id: r.category_id, tags: jsonArray(r.tags) });
          return {
            id: r.id,
            title: displayTitle(i18n.t, kind, r.title),
            deleted_at: r.deleted_at,
            type: kind,
            category: r.category ?? undefined,
          };
        }),
        ...tags.map((r) => ({ id: r.id, title: r.name, deleted_at: r.deleted_at, type: 'tag' as const })),
        ...categories.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'category' as const })),
        ...tasks.map((r) => ({ ...r, title: displayTitle(i18n.t, 'task', r.title), type: 'task' as const })),
        ...blockDefinitions.map((r) => ({
          id: r.id,
          title: iconTitle(r.icon, definitionLabel(i18n.t, r)),
          deleted_at: r.deleted_at,
          type: 'blockDefinition' as const,
        })),
        ...templates.map((r) => ({
          id: r.id,
          title: iconTitle(r.icon, templateLabel(i18n.t, r)),
          deleted_at: r.deleted_at,
          type: 'template' as const,
        })),
        ...languages.map((r) => ({
          id: r.id,
          title: iconTitle(r.icon, r.name),
          deleted_at: r.deleted_at,
          type: 'language' as const,
        })),
        ...images.map((r) => ({
          id: r.id,
          title: r.name || i18n.t('images.unnamed'),
          deleted_at: r.deleted_at,
          type: 'image' as const,
        })),
      ].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
      set({ items });
    } finally {
      set({ loading: false });
    }
  },

  restore: async (item) => {
    await trashWiring[item.type].restore(item.id);
    set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
  },

  permanentlyDelete: async (item) => {
    await trashWiring[item.type].permanentlyDelete(item.id);
    // A task takes along subtasks that were in the trash on their own.
    if (item.type === 'task') await get().fetchTrashed();
    else set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
  },

  emptyTrash: async () => {
    const db = await getDb();
    await db.execute(`DELETE FROM entries WHERE deleted_at IS NOT NULL`);
    // Tags hang on entries by ID — first from every list, then the rows.
    await useTagStore.getState().purgeTrashedTags();
    await db.execute(`DELETE FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)`);
    await db.execute(`DELETE FROM tasks WHERE deleted_at IS NOT NULL`);
    // Copies in entries manage without their definition — nothing to follow up.
    await db.execute(`DELETE FROM block_definitions WHERE deleted_at IS NOT NULL`);
    // Likewise templates.
    await db.execute(`DELETE FROM templates WHERE deleted_at IS NOT NULL`);
    // A default template that went with them points nowhere — the setting follows, as on a single deletion.
    const settings = useSettingsStore.getState();
    const defaultId = settings.settings.templates.defaultTemplateId;
    if (defaultId && !(await db.select<{ id: string }[]>('SELECT id FROM templates WHERE id=$1', [defaultId])).length) {
      settings.update('templates', { defaultTemplateId: null });
    }
    // ON DELETE CASCADE takes the vocabulary along — it has no `deleted_at` of its own.
    await db.execute(`DELETE FROM languages WHERE deleted_at IS NOT NULL`);
    // The details, then their files where nothing else uses them.
    const imageFiles = (await db.select<{ file: string }[]>(`SELECT file FROM images WHERE deleted_at IS NOT NULL`)).map((r) => r.file);
    await db.execute(`DELETE FROM images WHERE deleted_at IS NOT NULL`);
    await removeUnusedFiles(db, imageFiles);
    await useImageStore.getState().refreshFiles();

    // Categories last, and only after their remaining contents have been
    // reassigned. Previously the rows were simply deleted and everything that still
    // pointed at them kept a category_id without a counterpart. Since v33,
    // ON DELETE RESTRICT blocks that — which, without this step, would leave the trash stuck
    // with an error message.
    const doomed = new Set(
      (await db.select<{ id: string }[]>(`SELECT id FROM categories WHERE deleted_at IS NOT NULL`))
        .map((r) => r.id)
    );
    for (const id of doomed) await purgeCategory(db, id);

    // Carry the reassignment over to the in-memory stores too: rows loaded there
    // would otherwise keep pointing at the deleted category, and the next
    // update* would write it back and fail on the foreign key.
    if (doomed.size > 0) reassignCategoriesInMemory(doomed);

    // Only now, when all contents are gone: clear links pointing into the void.
    // Previously this ran only over journal and wiki IDs and left the links
    // of deleted operations as well as all task_links in place.
    await sweepDanglingTaskLinks(db);

    set({ items: [] });
  },
}));
