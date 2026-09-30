import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, type DbRow } from '../lib/row';
import type { JournalEntry } from '../types';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import { startOfNewEntry, useTemplateNoticeStore } from './templateStore';

interface JournalState {
  entries: JournalEntry[];
  loading: boolean;

  fetchEntries: () => Promise<void>;
  /** Mit dem Journal-Standard (Vorlagen) — außer `blank`. */
  createEntry: (opts?: { blank?: boolean; createdAt?: string }) => Promise<JournalEntry>;
  duplicateEntry: (id: string) => Promise<JournalEntry | undefined>;
  updateEntry: (id: string, patch: Partial<JournalEntry>, options?: WriteOptions) => Promise<void>;
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

  createEntry: async ({ blank = false, createdAt } = {}) => {
    const db = await getDb();
    const now = nowIso();
    const entryNumber = await nextEntryNumber(db, 'journal_entries');
    const start = startOfNewEntry('journal', null, blank);
    const entry: JournalEntry = {
      entry_number: entryNumber,
      id: generateId(),
      title: start.title,
      content: start.content,
      created_at: createdAt ?? now,
      updated_at: now,
      tags: start.tags,
      deleted_at: null,
    };
    await db.execute(
      `INSERT INTO journal_entries (id, title, content, created_at, updated_at, tags, entry_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.id,
        entry.title,
        entry.content,
        entry.created_at,
        entry.updated_at,
        JSON.stringify(entry.tags),
        entryNumber,
      ]
    );
    set((s) => ({ entries: [entry, ...s.entries] }));
    if (start.templateId) useTemplateNoticeStore.getState().show({ entryId: entry.id, templateId: start.templateId });
    return entry;
  },

  /**
   * Kopiert alle Inhaltsfelder des Quelleintrags; Identität und Zeitstempel
   * bleiben beim neuen Eintrag — und mit dem Anlagedatum die Mondphase, die
   * daraus folgt. Die Aufrufer haben die Feldliste früher jeweils
   * selbst aufgezählt — ein neues Feld fehlte dann still an einzelnen Stellen
   * (so ist ein Feld beim Duplizieren verloren gegangen).
   */
  duplicateEntry: async (id) => {
    const src = get().entries.find((e) => e.id === id);
    if (!src) return undefined;
    const copy = await get().createEntry({ blank: true });
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateEntry(copy.id, { ...fields, title: displayTitle(i18n.t, 'journal', src.title) + i18n.t('common.copySuffix') });
    return get().entries.find((e) => e.id === copy.id) ?? copy;
  },

  // serialized: siehe lib/serialize.ts.
  updateEntry: (id, patch, { touch } = {}) => serialized(serialKey('journal', id), async () => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry || !needsWrite(entry, patch, touch)) return;
    const db = await getDb();
    const merged = { ...entry, ...patch, updated_at: stampFor(entry.updated_at, touch) };

    await db.execute(
      `UPDATE journal_entries
       SET title=$1, content=$2, updated_at=$3, tags=$4
       WHERE id=$5`,
      [
        merged.title,
        merged.content,
        merged.updated_at,
        JSON.stringify(merged.tags),
        id,
      ]
    );
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? merged : e)),
    }));
  }),

  deleteEntry: async (id) => {
    const db = await getDb();
    try {
      const now = nowIso();
      await db.execute(
        'UPDATE journal_entries SET deleted_at=$1 WHERE id=$2',
        [now, id]
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
  },

  getEntry: (id) => get().entries.find((e) => e.id === id),
}));
