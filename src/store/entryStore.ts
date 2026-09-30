import { create } from 'zustand';
import { getDb, nextEntryNumber } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, type DbRow } from '../lib/row';
import type { Entry, EntryType } from '../types';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import { startOfNewEntry, useTemplateNoticeStore } from './templateStore';

/**
 * Die Einträge von Journal, Wiki und Operationen — ein Store über der einen
 * Tabelle `entries` (seit v49; vorher drei fast gleiche Stores).
 *
 * Die Einträge liegen je Typ in einem eigenen Array: ein Modul abonniert
 * `s.entries.wiki` und zeichnet nicht neu, wenn sich ein Journal-Eintrag
 * ändert — und ein Selektor liefert immer dasselbe Array, solange sich an
 * seinem Typ nichts ändert (zustand 5 verlangt stabile Snapshots).
 */
export type EntriesByType = Record<EntryType, Entry[]>;

interface EntryState {
  entries: EntriesByType;
  loading: boolean;

  fetchEntries: () => Promise<void>;
  /** Mit dem Standard der Kombination (Vorlagen) — außer `blank`. Das Journal hat keine Kategorie. */
  createEntry: (type: EntryType, opts?: { categoryId?: string | null; blank?: boolean; createdAt?: string }) => Promise<Entry>;
  duplicateEntry: (id: string) => Promise<Entry | undefined>;
  updateEntry: (id: string, patch: Partial<Entry>, options?: WriteOptions) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  restoreEntry: (id: string) => Promise<void>;
  permanentlyDeleteEntry: (id: string) => Promise<void>;
  /** Mit `type` nur ein Eintrag dieses Typs (`findEntry`). */
  getEntry: (id: string, type?: EntryType) => Entry | undefined;
}

export const ENTRY_TYPES: readonly EntryType[] = ['journal', 'wiki', 'operation'];

/**
 * Die Reihenfolge der Listen, wie sie die drei Stores hatten: das Journal
 * nach Anlage, das Wiki nach Titel, Operationen nach letzter Änderung. Neue
 * Einträge kommen im Journal und bei den Operationen nach vorn, im Wiki ans
 * Ende — bis zum nächsten Laden, wie bisher.
 */
const ORDER: Record<EntryType, { sort: (a: Entry, b: Entry) => number; newAtEnd: boolean }> = {
  journal: { sort: (a, b) => b.created_at.localeCompare(a.created_at), newAtEnd: false },
  wiki: { sort: (a, b) => a.title.localeCompare(b.title), newAtEnd: true },
  operation: { sort: (a, b) => b.updated_at.localeCompare(a.updated_at), newAtEnd: false },
};

const emptyEntries = (): EntriesByType => ({ journal: [], wiki: [], operation: [] });

/** Die lebenden Einträge aus der Datenbank, je Typ sortiert. */
async function selectLiveEntries(): Promise<EntriesByType> {
  const db = await getDb();
  const rows = await db.select<DbRow[]>('SELECT * FROM entries WHERE deleted_at IS NULL');
  const byType = emptyEntries();
  for (const row of rows) {
    const entry = fromRow.entry(row);
    byType[entry.type].push(entry);
  }
  for (const type of ENTRY_TYPES) byType[type].sort(ORDER[type].sort);
  return byType;
}

/** Alle Einträge in einer Liste — Journal, Wiki, Operationen. */
export function allEntries(entries: EntriesByType): Entry[] {
  return [...entries.journal, ...entries.wiki, ...entries.operation];
}

/**
 * Der Eintrag `id` — mit `type` nur, wenn er diesen Typ hat. Liefert das
 * Objekt aus dem Store selbst: ein Selektor darüber zeichnet nur neu, wenn
 * sich genau dieser Eintrag ändert.
 */
export function findEntry(entries: EntriesByType, id: string, type?: EntryType): Entry | undefined {
  for (const t of type ? [type] : ENTRY_TYPES) {
    const entry = entries[t].find((e) => e.id === id);
    if (entry) return entry;
  }
  return undefined;
}

/** Wendet `map` auf die Liste jedes Typs an. */
export function mapEntries(entries: EntriesByType, map: (list: Entry[], type: EntryType) => Entry[]): EntriesByType {
  return { journal: map(entries.journal, 'journal'), wiki: map(entries.wiki, 'wiki'), operation: map(entries.operation, 'operation') };
}

/**
 * Fügt einen Eintrag in die Liste seines Typs ein — vorn oder hinten wie beim
 * Anlegen. Für `entryTypeChange`, das einen Eintrag in ein anderes Modul zieht.
 */
export function withAddedEntry(entries: EntriesByType, entry: Entry): EntriesByType {
  return withEntry(entries, entry.type, (list) => (ORDER[entry.type].newAtEnd ? [...list, entry] : [entry, ...list]));
}

/** Ersetzt oder entfernt einen Eintrag in seinem Typ — die anderen Arrays bleiben dieselben. */
function withEntry(entries: EntriesByType, type: EntryType, map: (list: Entry[]) => Entry[]): EntriesByType {
  return { ...entries, [type]: map(entries[type]) };
}

export const useEntryStore = create<EntryState>((set, get) => ({
  entries: emptyEntries(),
  loading: false,

  fetchEntries: async () => {
    set({ loading: true });
    try {
      set({ entries: await selectLiveEntries() });
    } finally {
      set({ loading: false });
    }
  },

  createEntry: async (type, { categoryId = null, blank = false, createdAt } = {}) => {
    const db = await getDb();
    const now = nowIso();
    const category = type === 'journal' ? null : categoryId;
    // Die Kategorie „Sigillen" beginnt so mit Rechner, Zeichnung und Ladung
    // (Vorlage `core-sigil`) — sofern der Vault Standards von selbst einsetzt.
    const start = startOfNewEntry(type, category, blank);
    const entry: Entry = {
      id: generateId(),
      type,
      entry_number: await nextEntryNumber(db, type),
      title: start.title,
      content: start.content,
      category_id: category,
      created_at: createdAt ?? now,
      updated_at: now,
      tags: start.tags,
      deleted_at: null,
    };
    await db.execute(
      `INSERT INTO entries (id, type, title, content, category_id, created_at, updated_at, tags, entry_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [entry.id, type, entry.title, entry.content, category, entry.created_at, entry.updated_at,
        JSON.stringify(entry.tags), entry.entry_number]
    );
    set((s) => ({ entries: withAddedEntry(s.entries, entry) }));
    if (start.templateId) useTemplateNoticeStore.getState().show({ entryId: entry.id, templateId: start.templateId });
    return entry;
  },

  /**
   * Kopiert alle Inhaltsfelder des Quelleintrags; Identität, Nummer und
   * Zeitstempel bleiben beim neuen — und mit dem Anlagedatum die Mondphase,
   * die daraus folgt. Die Aufrufer haben die Feldliste früher jeweils selbst
   * aufgezählt — ein neues Feld fehlte dann still an einzelnen Stellen.
   */
  duplicateEntry: async (id) => {
    const src = get().getEntry(id);
    if (!src) return undefined;
    const copy = await get().createEntry(src.type, { categoryId: src.category_id, blank: true });
    const {
      id: _id,
      type: _type,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateEntry(copy.id, { ...fields, title: displayTitle(i18n.t, src.type, src.title) + i18n.t('common.copySuffix') });
    return get().getEntry(copy.id) ?? copy;
  },

  // serialized: siehe lib/serialize.ts. Ein Schlüssel je Eintrag, nicht je
  // Typ — ein Typwechsel läuft unter demselben (`entryTypeChange`).
  updateEntry: (id, patch, { touch } = {}) => serialized(serialKey('entry', id), async () => {
    const entry = get().getEntry(id);
    if (!entry || !needsWrite(entry, patch, touch)) return;
    const db = await getDb();
    // Den Typ ändert nur `entryTypeChange`.
    const merged: Entry = { ...entry, ...patch, type: entry.type, updated_at: stampFor(entry.updated_at, touch) };

    await db.execute(
      `UPDATE entries
          SET title=$1, content=$2, category_id=$3, updated_at=$4, tags=$5, cover_image=$6, icon=$7
        WHERE id=$8`,
      [
        merged.title,
        merged.content,
        merged.category_id,
        merged.updated_at,
        JSON.stringify(merged.tags),
        merged.cover_image ?? null,
        merged.icon ?? null,
        id,
      ]
    );
    set((s) => ({
      entries: withEntry(s.entries, entry.type, (list) => list.map((e) => (e.id === id ? merged : e))),
    }));
  }),

  deleteEntry: async (id) => {
    const entry = get().getEntry(id);
    const db = await getDb();
    await db.execute('UPDATE entries SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    if (entry) set((s) => ({ entries: withEntry(s.entries, entry.type, (list) => list.filter((e) => e.id !== id)) }));
  },

  restoreEntry: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE entries SET deleted_at=NULL WHERE id=$1', [id]);
    // Neu laden, damit der Eintrag an seiner Stelle in der Liste auftaucht.
    set({ entries: await selectLiveEntries() });
  },

  permanentlyDeleteEntry: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM entries WHERE id=$1', [id]);
  },

  getEntry: (id, type) => findEntry(get().entries, id, type),
}));
