import { create } from 'zustand';
import { getDb } from '../lib/db';
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useTagStore } from './tagStore';
import { useOperationStore } from './operationStore';
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
      const wiki = await db.select<{ id: string; title: string; deleted_at: string; category: string }[]>(
        `SELECT id, title, deleted_at, category FROM wiki_articles WHERE deleted_at IS NOT NULL`
      );
      const tags = await db.select<{ id: string; name: string; deleted_at: string }[]>(
        `SELECT id, name, deleted_at FROM tags WHERE deleted_at IS NOT NULL`
      );
      const operations = await db.select<{ id: string; title: string; deleted_at: string; category: string | null }[]>(
        `SELECT o.id, o.title, o.deleted_at, c.name as category FROM operations o LEFT JOIN operation_categories c ON o.category_id = c.id WHERE o.deleted_at IS NOT NULL`
      );
      const creations = await db.select<{ id: string; title: string; deleted_at: string; tool_type: string }[]>(
        `SELECT id, title, deleted_at, tool_type FROM creations WHERE deleted_at IS NOT NULL`
      );
      const wikiCats = await db.select<(WikiCategoryDef & { deleted_at: string })[]>(
        `SELECT * FROM wiki_categories WHERE deleted_at IS NOT NULL`
      );
      const opCats = await db.select<(OperationCategory & { deleted_at: string })[]>(
        `SELECT * FROM operation_categories WHERE deleted_at IS NOT NULL`
      );
      const items: TrashedItem[] = [
        ...journal.map((r) => ({ ...r, type: 'journal' as const })),
        ...wiki.map((r) => ({ ...r, type: 'wiki' as const, category: r.category })),
        ...tags.map((r) => ({ id: r.id, title: r.name, deleted_at: r.deleted_at, type: 'tag' as const })),
        ...operations.map((r) => ({ ...r, type: 'operation' as const, category: r.category ?? undefined })),
        ...creations.map((r) => ({ ...r, type: 'creation' as const, category: r.tool_type })),
        ...wikiCats.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'wiki_category' as const })),
        ...opCats.map((r) => ({ id: r.id, title: `${r.emoji} ${r.name}`, deleted_at: r.deleted_at, type: 'operation_category' as const })),
      ].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
      set({ items });
    } finally {
      set({ loading: false });
    }
  },

  restore: async (item) => {
    if (item.type === 'journal') {
      await useJournalStore.getState().restoreEntry(item.id);
    } else if (item.type === 'wiki') {
      await useWikiStore.getState().restoreArticle(item.id);
    } else if (item.type === 'operation') {
      await useOperationStore.getState().restoreOperation(item.id);
    } else if (item.type === 'creation') {
      const db = await getDb();
      await db.execute('UPDATE creations SET deleted_at=NULL WHERE id=$1', [item.id]);
    } else if (item.type === 'wiki_category') {
      await useWikiStore.getState().restoreWikiCategory(item.id);
    } else if (item.type === 'operation_category') {
      await useOperationStore.getState().restoreCategory(item.id);
    } else if (item.type === 'tag') {
      await useTagStore.getState().restoreTag(item.id);
    } else {
      console.error('Unknown trash item type in restore():', item.type);
    }
    set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
  },

  permanentlyDelete: async (item) => {
    if (item.type === 'journal') {
      await useJournalStore.getState().permanentlyDeleteEntry(item.id);
    } else if (item.type === 'wiki') {
      await useWikiStore.getState().permanentlyDeleteArticle(item.id);
    } else if (item.type === 'operation') {
      await useOperationStore.getState().permanentlyDeleteOperation(item.id);
    } else if (item.type === 'creation') {
      const db = await getDb();
      await db.execute('DELETE FROM creations WHERE id=$1', [item.id]);
    } else if (item.type === 'wiki_category') {
      await useWikiStore.getState().permanentlyDeleteWikiCategory(item.id);
    } else if (item.type === 'operation_category') {
      await useOperationStore.getState().permanentlyDeleteCategory(item.id);
    } else {
      await useTagStore.getState().permanentlyDeleteTag(item.id);
    }
    set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
  },

  emptyTrash: async () => {
    const db = await getDb();
    const journalIds = await db.select<{ id: string }[]>(
      `SELECT id FROM journal_entries WHERE deleted_at IS NOT NULL`
    );
    const wikiIds = await db.select<{ id: string }[]>(
      `SELECT id FROM wiki_articles WHERE deleted_at IS NOT NULL`
    );
    for (const { id } of [...journalIds, ...wikiIds]) {
      await db.execute('DELETE FROM links WHERE source_id=$1 OR target_id=$1', [id]);
    }
    await db.execute(`DELETE FROM journal_entries WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM wiki_articles WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM tags WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM operations WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM creations WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM wiki_categories WHERE deleted_at IS NOT NULL`);
    await db.execute(`DELETE FROM operation_categories WHERE deleted_at IS NOT NULL`);
    set({ items: [] });
  },
}));
