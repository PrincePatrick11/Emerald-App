import { create } from 'zustand';
import { getDb } from '../lib/db';
import { getMoonPhase } from '../lib/moonPhase';
import { syncLinks } from '../lib/links';
import { generateId, nowIso, safeParseArray } from '../lib/helpers';
import type { JournalEntry } from '../types';

interface JournalState {
  entries: JournalEntry[];
  loading: boolean;

  fetchEntries: () => Promise<void>;
  createEntry: () => Promise<JournalEntry>;
  updateEntry: (id: string, patch: Partial<JournalEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  restoreEntry: (id: string) => Promise<void>;
  permanentlyDeleteEntry: (id: string) => Promise<void>;
  getEntry: (id: string) => JournalEntry | undefined;
}

export const useJournalStore = create<JournalState>((set, get) => ({
  entries: [],
  loading: false,

  fetchEntries: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      const rows = await db.select<JournalEntry[]>(
        'SELECT *, ROWID as entry_number FROM journal_entries WHERE deleted_at IS NULL ORDER BY created_at DESC'
      );
      const entries = rows.map((r) => ({
        ...r,
        tags: safeParseArray<string>(r.tags),
        linked_operation_ids: safeParseArray<string>(r.linked_operation_ids),
        linked_wiki_ids: safeParseArray<string>(r.linked_wiki_ids),
        is_bannung: (r.is_bannung as unknown as number) !== 0,
        bannung_type_wiki_id: r.bannung_type_wiki_id ?? null,
        is_meditation: (r.is_meditation as unknown as number) !== 0,
        meditation_duration: r.meditation_duration ?? null,
        meditation_type_wiki_id: r.meditation_type_wiki_id ?? null,
      }));
      set({ entries });
    } finally {
      set({ loading: false });
    }
  },

  createEntry: async () => {
    const db = await getDb();
    const now = nowIso();
    const moonPhase = getMoonPhase();
    const entry: JournalEntry = {
      id: generateId(),
      title: 'Untitled Entry',
      content: '',
      created_at: now,
      updated_at: now,
      tags: [],
      moon_phase: moonPhase,
      mood: null,
      paradigm_id: null,
      linked_operation_ids: [],
      linked_wiki_ids: [],
      is_bannung: false,
      bannung_type_wiki_id: null,
      is_meditation: false,
      meditation_duration: null,
      meditation_type_wiki_id: null,
      deleted_at: null,
    };
    await db.execute(
      `INSERT INTO journal_entries (id, title, content, created_at, updated_at, tags, moon_phase, mood)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.title,
        entry.content,
        entry.created_at,
        entry.updated_at,
        JSON.stringify(entry.tags),
        entry.moon_phase,
        entry.mood,
      ]
    );
    set((s) => ({ entries: [entry, ...s.entries] }));
    return entry;
  },

  updateEntry: async (id, patch) => {
    const db = await getDb();
    const now = nowIso();
    const updated = { ...patch, updated_at: now };
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;
    const merged = { ...entry, ...updated };

    await db.execute(
      `UPDATE journal_entries
       SET title=$1, content=$2, updated_at=$3, tags=$4, moon_phase=$5, mood=$6, paradigm_id=$7, linked_operation_ids=$8, linked_wiki_ids=$9,
           is_bannung=$10, bannung_type_wiki_id=$11, is_meditation=$12, meditation_duration=$13, meditation_type_wiki_id=$14
       WHERE id=$15`,
      [
        merged.title,
        merged.content,
        merged.updated_at,
        JSON.stringify(merged.tags),
        merged.moon_phase,
        merged.mood,
        merged.paradigm_id ?? null,
        JSON.stringify(merged.linked_operation_ids ?? []),
        JSON.stringify(merged.linked_wiki_ids ?? []),
        merged.is_bannung ? 1 : 0,
        merged.bannung_type_wiki_id ?? null,
        merged.is_meditation ? 1 : 0,
        merged.meditation_duration ?? null,
        merged.meditation_type_wiki_id ?? null,
        id,
      ]
    );
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? merged : e)),
    }));
    syncLinks(id, 'journal', merged.content).catch(console.error);
  },

  deleteEntry: async (id) => {
    const db = await getDb();
    try {
      const now = nowIso();
      await db.execute(
        'UPDATE journal_entries SET deleted_at=$1 WHERE id=$2',
        [now, id]
      );
      await db.execute(
        'DELETE FROM links WHERE source_id=$1 OR target_id=$1',
        [id]
      );
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    } catch (e) {
      console.error('[deleteEntry] failed:', e);
      throw e;
    }
  },

  restoreEntry: async (id) => {
    const db = await getDb();
    await db.execute(
      'UPDATE journal_entries SET deleted_at=NULL WHERE id=$1',
      [id]
    );
    // Re-fetch so the entry appears in the list again
    const rows = await db.select<JournalEntry[]>(
      'SELECT *, ROWID as entry_number FROM journal_entries WHERE deleted_at IS NULL ORDER BY created_at DESC'
    );
    const entries = rows.map((r) => ({
      ...r,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags,
      linked_operation_ids: typeof r.linked_operation_ids === 'string' ? JSON.parse(r.linked_operation_ids) : (r.linked_operation_ids ?? []),
      linked_wiki_ids: typeof r.linked_wiki_ids === 'string' ? JSON.parse(r.linked_wiki_ids) : (r.linked_wiki_ids ?? []),
      is_bannung: (r.is_bannung as unknown as number) !== 0,
      bannung_type_wiki_id: r.bannung_type_wiki_id ?? null,
      is_meditation: (r.is_meditation as unknown as number) !== 0,
      meditation_duration: r.meditation_duration ?? null,
      meditation_type_wiki_id: r.meditation_type_wiki_id ?? null,
    }));
    set({ entries });
  },

  permanentlyDeleteEntry: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM journal_entries WHERE id=$1', [id]);
    await db.execute(
      'DELETE FROM links WHERE source_id=$1 OR target_id=$1',
      [id]
    );
  },

  getEntry: (id) => get().entries.find((e) => e.id === id),
}));
