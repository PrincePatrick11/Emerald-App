import { create } from 'zustand';
import { getDb, sweepDanglingLinks } from '../lib/db';
import { reassignCategoryContent } from '../lib/schema';
import { trashWiring } from './moduleWiring';
import { reassignCategoriesInMemory } from './categoryStore';
import { definitionLabel } from '../lib/blocks/blockAttrs';
import { isImageIcon } from '../lib/helpers';
import i18n from '../i18n';
import type { TrashedItem } from '../types';

interface TrashState {
  items: TrashedItem[];
  loading: boolean;

  fetchTrashed: () => Promise<void>;
  restore: (item: TrashedItem) => Promise<void>;
  permanentlyDelete: (item: TrashedItem) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

export const useTrashStore = create<TrashState>((set) => ({
  items: [],
  loading: false,

  fetchTrashed: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      const journal = await db.select<{ id: string; title: string; deleted_at: string }[]>(
        `SELECT id, title, deleted_at FROM journal_entries WHERE deleted_at IS NOT NULL`
      );
      const wiki = await db.select<{ id: string; title: string; deleted_at: string; category: string | null }[]>(
        `SELECT w.id, w.title, w.deleted_at, c.name as category FROM wiki_articles w LEFT JOIN categories c ON w.category_id = c.id WHERE w.deleted_at IS NOT NULL`
      );
      const tags = await db.select<{ id: string; name: string; deleted_at: string }[]>(
        `SELECT id, name, deleted_at FROM tags WHERE deleted_at IS NOT NULL`
      );
      const operations = await db.select<{ id: string; title: string; deleted_at: string; category: string | null }[]>(
        `SELECT o.id, o.title, o.deleted_at, c.name as category FROM operations o LEFT JOIN categories c ON o.category_id = c.id WHERE o.deleted_at IS NOT NULL`
      );
      const categories = await db.select<{ id: string; name: string; emoji: string; deleted_at: string }[]>(
        `SELECT id, name, emoji, deleted_at FROM categories WHERE deleted_at IS NOT NULL`
      );
      const tasks = await db.select<{ id: string; title: string; deleted_at: string }[]>(
        `SELECT id, title, deleted_at FROM tasks WHERE deleted_at IS NOT NULL`
      );
      const blockDefinitions = await db.select<{ id: string; name: string; icon: string; deleted_at: string }[]>(
        `SELECT id, name, icon, deleted_at FROM block_definitions WHERE deleted_at IS NOT NULL`
      );
      const items: TrashedItem[] = [
        ...journal.map((r) => ({ ...r, type: 'journal' as const })),
        ...wiki.map((r) => ({ id: r.id, title: r.title, deleted_at: r.deleted_at, type: 'wiki' as const, category: r.category ?? undefined })),
        ...tags.map((r) => ({ id: r.id, title: r.name, deleted_at: r.deleted_at, type: 'tag' as const })),
        ...operations.map((r) => ({ ...r, type: 'operation' as const, category: r.category ?? undefined })),
        ...categories.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'category' as const })),
        ...tasks.map((r) => ({ ...r, type: 'task' as const })),
        ...blockDefinitions.map((r) => ({
          // Ein Bild-Icon ist eine Data-URL — als Text vor dem Namen stünde
          // Base64. Das Block-Symbol der Zeile genügt dann.
          id: r.id,
          title: isImageIcon(r.icon) ? definitionLabel(i18n.t, r) : `${r.icon} ${definitionLabel(i18n.t, r)}`,
          deleted_at: r.deleted_at,
          type: 'blockDefinition' as const,
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
    set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
  },

  emptyTrash: async () => {
    const db = await getDb();
    await db.execute(`DELETE FROM journal_entries WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM wiki_articles WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM tags WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM operations WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)`);
    await db.execute(`DELETE FROM tasks WHERE deleted_at IS NOT NULL`);
    // Kopien in Einträgen kommen ohne ihre Definition aus — nichts nachzuziehen.
    await db.execute(`DELETE FROM block_definitions WHERE deleted_at IS NOT NULL`);

    // Kategorien zuletzt, und erst nachdem ihre verbliebenen Inhalte umgehängt
    // sind. Früher wurden die Zeilen einfach gelöscht und alles, was noch auf
    // sie zeigte, behielt eine category_id ohne Gegenstueck. Seit v33 blockiert
    // ON DELETE RESTRICT das — was den Papierkorb ohne diesen Schritt mit einer
    // Fehlermeldung stehenlassen wuerde.
    const doomed = new Set(
      (await db.select<{ id: string }[]>(`SELECT id FROM categories WHERE deleted_at IS NOT NULL`))
        .map((r) => r.id)
    );
    for (const id of doomed) {
      await reassignCategoryContent(db, id);
    }
    await db.execute(`DELETE FROM categories WHERE deleted_at IS NOT NULL`);

    // Die Umhängung auch in den In-Memory-Stores nachziehen: dort geladene
    // Zeilen zeigen sonst weiter auf die geloeschte Kategorie, und der naechste
    // update* wuerde sie zurueckschreiben und am Foreign Key scheitern.
    if (doomed.size > 0) reassignCategoriesInMemory(doomed);

    // Erst jetzt, wenn alle Inhalte weg sind: Verknüpfungen ins Leere räumen.
    // Vorher lief das nur über Journal- und Wiki-IDs und ließ die Links
    // gelöschter Operationen sowie alle task_links stehen.
    await sweepDanglingLinks(db);

    set({ items: [] });
  },
}));
