import { create } from 'zustand';
import { getDb } from '../lib/db';
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import type { Tag } from '../types';

function generateId() {
  return crypto.randomUUID();
}

const TAG_COLORS = [
  '#00e699', '#8347ff', '#3b82f6', '#f43f5e',
  '#f59e0b', '#06b6d4', '#f97316', '#a855f7',
];

function randomColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

interface AffectedEntry { id: string; type: 'journal' | 'wiki' | 'operation' }

interface TagState {
  tags: Tag[];

  fetchTags: () => Promise<void>;
  ensureTag: (name: string) => Promise<Tag>;
  updateTag: (id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  restoreTag: (id: string) => Promise<void>;
  permanentlyDeleteTag: (id: string) => Promise<void>;
  getByName: (name: string) => Tag | undefined;
}

export const useTagStore = create<TagState>((set, get) => ({
  tags: [],

  fetchTags: async () => {
    const db = await getDb();
    const rows = await db.select<Tag[]>(
      'SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY name ASC'
    );
    set({ tags: rows });
  },

  // Returns existing tag or creates a new one
  ensureTag: async (name) => {
    const existing = get().tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const db = await getDb();
    const tag: Tag = { id: generateId(), name: name.trim(), color: randomColor() };
    await db.execute(
      'INSERT OR IGNORE INTO tags (id, name, color) VALUES ($1, $2, $3)',
      [tag.id, tag.name, tag.color]
    );
    set((s) => ({
      tags: [...s.tags, tag].sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return tag;
  },

  updateTag: async (id, patch) => {
    const db = await getDb();
    const tag = get().tags.find((t) => t.id === id);
    if (!tag) return;
    const updated = { ...tag, ...patch };
    await db.execute('UPDATE tags SET name=$1, color=$2 WHERE id=$3', [
      updated.name,
      updated.color,
      id,
    ]);
    set((s) => ({ tags: s.tags.map((t) => (t.id === id ? updated : t)) }));
  },

  deleteTag: async (name) => {
    const db = await getDb();
    const now = new Date().toISOString();

    // Collect affected entry IDs before removing the tag
    const { entries, updateEntry } = useJournalStore.getState();
    const { articles, updateArticle } = useWikiStore.getState();
    const { operations, updateOperation } = useOperationStore.getState();
    const affected: AffectedEntry[] = [];

    for (const entry of entries) {
      if (entry.tags?.includes(name)) {
        affected.push({ id: entry.id, type: 'journal' });
        await updateEntry(entry.id, { tags: entry.tags.filter((t) => t !== name) });
      }
    }
    for (const article of articles) {
      if (article.tags?.includes(name)) {
        affected.push({ id: article.id, type: 'wiki' });
        await updateArticle(article.id, { tags: article.tags.filter((t) => t !== name) });
      }
    }
    for (const op of operations) {
      if (op.tags?.includes(name)) {
        affected.push({ id: op.id, type: 'operation' });
        await updateOperation(op.id, { tags: op.tags.filter((t) => t !== name) });
      }
    }

    // Soft-delete with snapshot of affected IDs
    await db.execute(
      'UPDATE tags SET deleted_at=$1, affected_ids=$2 WHERE name=$3',
      [now, JSON.stringify(affected), name]
    );
    set((s) => ({ tags: s.tags.filter((t) => t.name !== name) }));
  },

  restoreTag: async (id) => {
    const db = await getDb();
    const rows = await db.select<{ name: string; color: string; affected_ids: string }[]>(
      'SELECT name, color, affected_ids FROM tags WHERE id=$1',
      [id]
    );
    if (!rows[0]) return;
    const { name, color, affected_ids } = rows[0];
    let affected: AffectedEntry[] = [];
    try { affected = JSON.parse(affected_ids); } catch { affected = []; }

    // Un-delete the tag
    await db.execute('UPDATE tags SET deleted_at=NULL, affected_ids=$1 WHERE id=$2', ['[]', id]);

    // Re-add tag to affected entries
    const { entries, updateEntry } = useJournalStore.getState();
    const { articles, updateArticle } = useWikiStore.getState();
    const { operations, updateOperation } = useOperationStore.getState();
    for (const { id: eid, type } of affected) {
      if (type === 'journal') {
        const entry = entries.find((e) => e.id === eid);
        if (entry && !entry.tags?.includes(name)) {
          await updateEntry(eid, { tags: [...(entry.tags ?? []), name] });
        }
      } else if (type === 'wiki') {
        const article = articles.find((a) => a.id === eid);
        if (article && !article.tags?.includes(name)) {
          await updateArticle(eid, { tags: [...(article.tags ?? []), name] });
        }
      } else if (type === 'operation') {
        const op = operations.find((o) => o.id === eid);
        if (op && !op.tags?.includes(name)) {
          await updateOperation(eid, { tags: [...(op.tags ?? []), name] });
        }
      }
    }

    const tag: Tag = { id, name, color };
    set((s) => ({
      tags: [...s.tags, tag].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  },

  permanentlyDeleteTag: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM tags WHERE id=$1', [id]);
  },

  getByName: (name) =>
    get().tags.find((t) => t.name.toLowerCase() === name.toLowerCase()),
}));
