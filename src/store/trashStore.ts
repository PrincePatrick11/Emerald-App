import { create } from 'zustand';
import { getDb, sweepDanglingLinks } from '../lib/db';
import { FALLBACK_CATEGORY, reassignCategoryContent } from '../lib/schema';
import { trashWiring } from './moduleWiring';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTaskStore } from './taskStore';
import type { OperationCategory, WikiCategoryDef } from '../types';
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
        `SELECT w.id, w.title, w.deleted_at, c.name as category FROM wiki_articles w LEFT JOIN wiki_categories c ON w.category_id = c.id WHERE w.deleted_at IS NOT NULL`
      );
      const tags = await db.select<{ id: string; name: string; deleted_at: string }[]>(
        `SELECT id, name, deleted_at FROM tags WHERE deleted_at IS NOT NULL`
      );
      const operations = await db.select<{ id: string; title: string; deleted_at: string; category: string | null }[]>(
        `SELECT o.id, o.title, o.deleted_at, c.name as category FROM operations o LEFT JOIN operation_categories c ON o.category_id = c.id WHERE o.deleted_at IS NOT NULL`
      );
      const wikiCats = await db.select<(WikiCategoryDef & { deleted_at: string })[]>(
        `SELECT * FROM wiki_categories WHERE deleted_at IS NOT NULL`
      );
      const opCats = await db.select<(OperationCategory & { deleted_at: string })[]>(
        `SELECT * FROM operation_categories WHERE deleted_at IS NOT NULL`
      );
      const tasks = await db.select<{ id: string; title: string; deleted_at: string }[]>(
        `SELECT id, title, deleted_at FROM tasks WHERE deleted_at IS NOT NULL`
      );
      const taskCats = await db.select<{ id: string; name: string; emoji: string; deleted_at: string }[]>(
        `SELECT id, name, emoji, deleted_at FROM task_categories WHERE deleted_at IS NOT NULL`
      );
      const items: TrashedItem[] = [
        ...journal.map((r) => ({ ...r, type: 'journal' as const })),
        ...wiki.map((r) => ({ id: r.id, title: r.title, deleted_at: r.deleted_at, type: 'wiki' as const, category: r.category ?? undefined })),
        ...tags.map((r) => ({ id: r.id, title: r.name, deleted_at: r.deleted_at, type: 'tag' as const })),
        ...operations.map((r) => ({ ...r, type: 'operation' as const, category: r.category ?? undefined })),
        ...wikiCats.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'wiki_category' as const })),
        ...opCats.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'operation_category' as const })),
        ...tasks.map((r) => ({ ...r, type: 'task' as const })),
        ...taskCats.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'task_category' as const })),
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

    // Kategorien zuletzt, und erst nachdem ihre verbliebenen Inhalte umgehängt
    // sind. Früher wurden die Zeilen einfach gelöscht und alles, was noch auf
    // sie zeigte, behielt eine category_id ohne Gegenstueck. Seit v33 blockiert
    // ON DELETE RESTRICT das — was den Papierkorb ohne diesen Schritt mit einer
    // Fehlermeldung stehenlassen wuerde.
    const doomedByContent = {
      wiki_articles: new Set<string>(),
      operations: new Set<string>(),
      tasks: new Set<string>(),
    };
    for (const [table, content] of [
      ['wiki_categories', 'wiki_articles'],
      ['operation_categories', 'operations'],
      ['task_categories', 'tasks'],
    ] as const) {
      const doomed = await db.select<{ id: string }[]>(
        `SELECT id FROM ${table} WHERE deleted_at IS NOT NULL`
      );
      for (const { id } of doomed) {
        await reassignCategoryContent(db, content, id);
        doomedByContent[content].add(id);
      }
      await db.execute(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL`);
    }

    // Die Umhängung auch in den In-Memory-Stores nachziehen: dort geladene
    // Zeilen zeigen sonst weiter auf die geloeschte Kategorie, und der naechste
    // update* wuerde sie zurueckschreiben und am Foreign Key scheitern.
    if (doomedByContent.wiki_articles.size > 0) {
      useWikiStore.setState((s) => ({
        articles: s.articles.map((a) =>
          doomedByContent.wiki_articles.has(a.category_id)
            ? { ...a, category_id: FALLBACK_CATEGORY.wiki_articles }
            : a
        ),
      }));
    }
    if (doomedByContent.operations.size > 0) {
      useOperationStore.setState((s) => ({
        operations: s.operations.map((o) =>
          doomedByContent.operations.has(o.category_id)
            ? { ...o, category_id: FALLBACK_CATEGORY.operations }
            : o
        ),
      }));
    }
    if (doomedByContent.tasks.size > 0) {
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          doomedByContent.tasks.has(t.category_id)
            ? { ...t, category_id: FALLBACK_CATEGORY.tasks }
            : t
        ),
      }));
    }

    // Erst jetzt, wenn alle Inhalte weg sind: Verknüpfungen ins Leere räumen.
    // Vorher lief das nur über Journal- und Wiki-IDs und ließ die Links
    // gelöschter Operationen sowie alle task_links stehen.
    await sweepDanglingLinks(db);

    set({ items: [] });
  },
}));
