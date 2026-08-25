import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { getMoonPhase } from '../lib/moonPhase';
import { syncLinks } from '../lib/links';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, toInt, type DbRow } from '../lib/row';
import type { JournalEntry } from '../types';

interface JournalState {
  entries: JournalEntry[];
  loading: boolean;

  fetchEntries: () => Promise<void>;
  createEntry: () => Promise<JournalEntry>;
  duplicateEntry: (id: string) => Promise<JournalEntry | undefined>;
  updateEntry: (id: string, patch: Partial<JournalEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  restoreEntry: (id: string) => Promise<void>;
  permanentlyDeleteEntry: (id: string) => Promise<void>;
  getEntry: (id: string) => JournalEntry | undefined;
}

/**
 * Die Liste der sichtbaren Eintraege. Fetch und Restore haben diese Abfrage
 * früher jeweils mit eigener Mapping-Logik dupliziert — mit unterschiedlichem
 * Verhalten bei kaputtem JSON.
 */
async function selectAllEntries(db: Database): Promise<JournalEntry[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM journal_entries WHERE deleted_at IS NULL ORDER BY created_at DESC'
  );
  return rows.map(fromRow.journalEntry);
}

export const useJournalStore = create<JournalState>((set, get) => ({
  entries: [],
  loading: false,

  fetchEntries: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      set({ entries: await selectAllEntries(db) });
    } finally {
      set({ loading: false });
    }
  },

  createEntry: async () => {
    const db = await getDb();
    const now = nowIso();
    const moonPhase = getMoonPhase();
    const entryNumber = await nextEntryNumber(db, 'journal_entries');
    const entry: JournalEntry = {
      entry_number: entryNumber,
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
      `INSERT INTO journal_entries (id, title, content, created_at, updated_at, tags, moon_phase, mood, entry_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.title,
        entry.content,
        entry.created_at,
        entry.updated_at,
        JSON.stringify(entry.tags),
        entry.moon_phase,
        entry.mood,
        entryNumber,
      ]
    );
    set((s) => ({ entries: [entry, ...s.entries] }));
    return entry;
  },

  /**
   * Kopiert alle Inhaltsfelder des Quelleintrags; nur Identität und Zeitstempel
   * bleiben beim neuen Eintrag. Die Aufrufer haben die Feldliste früher jeweils
   * selbst aufgezählt — ein neues Feld fehlte dann still an einzelnen Stellen
   * (so ist `mood` beim Duplizieren verloren gegangen).
   */
  duplicateEntry: async (id) => {
    const src = get().entries.find((e) => e.id === id);
    if (!src) return undefined;
    const copy = await get().createEntry();
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateEntry(copy.id, { ...fields, title: src.title + ' (Copy)' });
    return get().entries.find((e) => e.id === copy.id) ?? copy;
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
        toInt(merged.is_bannung),
        merged.bannung_type_wiki_id ?? null,
        toInt(merged.is_meditation),
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
    // Neu laden, damit der Eintrag wieder in der Liste auftaucht
    set({ entries: await selectAllEntries(db) });
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
