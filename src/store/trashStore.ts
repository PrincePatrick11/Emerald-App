import { create } from 'zustand';
import { getDb, sweepDanglingTaskLinks } from '../lib/db';
import { purgeCategory } from '../lib/schema';
import { trashWiring } from './moduleWiring';
import { selectTrashedTaskRoots } from './taskStore';
import { reassignCategoriesInMemory } from './categoryStore';
import { definitionLabel, templateLabel } from '../lib/blocks/blockAttrs';
import { iconTitle } from '../lib/helpers';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import type { EntryType, TrashedItem } from '../types';

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
      // Journal, Wiki und Operationen in einer Abfrage — die Kategorie haben nur die beiden letzten.
      const entries = await db.select<{ id: string; type: EntryType; title: string; deleted_at: string; category: string | null }[]>(
        `SELECT e.id, e.type, e.title, e.deleted_at, c.name as category
           FROM entries e LEFT JOIN categories c ON e.category_id = c.id
          WHERE e.deleted_at IS NOT NULL`
      );
      const tags = await db.select<{ id: string; name: string; deleted_at: string }[]>(
        `SELECT id, name, deleted_at FROM tags WHERE deleted_at IS NOT NULL`
      );
      const categories = await db.select<{ id: string; name: string; emoji: string; deleted_at: string }[]>(
        `SELECT id, name, emoji, deleted_at FROM categories WHERE deleted_at IS NOT NULL`
      );
      // Eine Aufgabe samt der Unteraufgaben, die mit ihr gingen, ist ein Eintrag.
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
      const altars = await db.select<{ id: string; title: string; deleted_at: string }[]>(
        `SELECT id, title, deleted_at FROM altars WHERE deleted_at IS NOT NULL`
      );
      const altarItems = await db.select<{ id: string; name: string; emoji: string; deleted_at: string }[]>(
        `SELECT id, name, emoji, deleted_at FROM altar_items WHERE deleted_at IS NOT NULL`
      );
      const items: TrashedItem[] = [
        // Ohne eigenen Titel „Unbenannt…", wie überall (`displayTitle`).
        ...entries.map((r) => ({
          id: r.id,
          title: displayTitle(i18n.t, r.type, r.title),
          deleted_at: r.deleted_at,
          type: r.type,
          category: r.category ?? undefined,
        })),
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
        ...altars.map((r) => ({ ...r, title: displayTitle(i18n.t, 'altar', r.title), type: 'altar' as const })),
        ...altarItems.map((r) => ({
          id: r.id,
          title: iconTitle(r.emoji, r.name),
          deleted_at: r.deleted_at,
          type: 'altarItem' as const,
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
    // Eine Aufgabe nimmt Unteraufgaben mit, die für sich im Papierkorb lagen.
    if (item.type === 'task') await get().fetchTrashed();
    else set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
  },

  emptyTrash: async () => {
    const db = await getDb();
    await db.execute(`DELETE FROM entries WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM tags WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)`);
    await db.execute(`DELETE FROM tasks WHERE deleted_at IS NOT NULL`);
    // Kopien in Einträgen kommen ohne ihre Definition aus — nichts nachzuziehen.
    await db.execute(`DELETE FROM block_definitions WHERE deleted_at IS NOT NULL`);
    // Ebenso Vorlagen: Einträge tragen nur ihre Herkunft.
    await db.execute(`DELETE FROM templates WHERE deleted_at IS NOT NULL`);
    // Die Vokabeln nimmt ON DELETE CASCADE mit — sie haben kein eigenes `deleted_at`.
    await db.execute(`DELETE FROM languages WHERE deleted_at IS NOT NULL`);
    // Die Platzierungen ebenso; die Verknüpfungen auf den Altar fegt `sweepDanglingTaskLinks` unten.
    await db.execute(`DELETE FROM altars WHERE deleted_at IS NOT NULL`);
    // Ebenso die eines Elements.
    await db.execute(`DELETE FROM altar_items WHERE deleted_at IS NOT NULL`);

    // Kategorien zuletzt, und erst nachdem ihre verbliebenen Inhalte umgehängt
    // sind. Früher wurden die Zeilen einfach gelöscht und alles, was noch auf
    // sie zeigte, behielt eine category_id ohne Gegenstueck. Seit v33 blockiert
    // ON DELETE RESTRICT das — was den Papierkorb ohne diesen Schritt mit einer
    // Fehlermeldung stehenlassen wuerde.
    const doomed = new Set(
      (await db.select<{ id: string }[]>(`SELECT id FROM categories WHERE deleted_at IS NOT NULL`))
        .map((r) => r.id)
    );
    for (const id of doomed) await purgeCategory(db, id);

    // Die Umhängung auch in den In-Memory-Stores nachziehen: dort geladene
    // Zeilen zeigen sonst weiter auf die geloeschte Kategorie, und der naechste
    // update* wuerde sie zurueckschreiben und am Foreign Key scheitern.
    if (doomed.size > 0) reassignCategoriesInMemory(doomed);

    // Erst jetzt, wenn alle Inhalte weg sind: Verknüpfungen ins Leere räumen.
    // Vorher lief das nur über Journal- und Wiki-IDs und ließ die Links
    // gelöschter Operationen sowie alle task_links stehen.
    await sweepDanglingTaskLinks(db);

    set({ items: [] });
  },
}));
