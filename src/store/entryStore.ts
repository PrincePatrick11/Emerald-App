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
  /**
   * Einträge, deren `content` noch nicht geladen ist — `null`, sobald alle da
   * sind. `fetchEntries` lädt in zwei Stufen: erst die Metadaten (die Listen
   * stehen sofort), die Inhalte im Hintergrund. Bis dahin ist `content` dieser
   * Einträge leer; wer ihn braucht, wartet mit `ensureEntryContent` bzw.
   * `whenEntryContentLoaded`.
   */
  pendingContent: ReadonlySet<string> | null;

  /**
   * Lädt alle Einträge neu. `keepLoaded`: Einträge, deren Inhalt schon geladen
   * ist, behalten ihn — nach einem Import (`reloadModules`), der nur über diesen
   * Store schrieb. Ein Vault-Wechsel oder Backup-Import lädt alles neu.
   */
  fetchEntries: (options?: { keepLoaded?: boolean }) => Promise<void>;
  /** Lädt den Inhalt eines Eintrags sofort, falls er noch aussteht. */
  ensureEntryContent: (id: string) => Promise<void>;
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

/** Die Spalten von `idx_entries_list` — die Abfrage liest nur den Index (`ENTRIES_INDEX_DDL`). */
const LIST_COLUMNS = 'id, type, title, category_id, entry_number, tags, created_at, updated_at, deleted_at';

/**
 * Die lebenden Einträge aus der Datenbank, je Typ sortiert — ohne Inhalt, die
 * erste Stufe von `fetchEntries`. Icon und Titelbild stehen nicht im Index
 * (Data-URLs): sie kommen für die wenigen Einträge, die eins tragen, über
 * `idx_entries_decorated` — dafür steht dessen Bedingung wörtlich im WHERE.
 */
async function selectLiveEntries(): Promise<EntriesByType> {
  const db = await getDb();
  const [rows, decorated] = await Promise.all([
    db.select<DbRow[]>(`SELECT ${LIST_COLUMNS} FROM entries WHERE deleted_at IS NULL`),
    db.select<DbRow[]>(
      'SELECT id, icon, cover_image FROM entries WHERE deleted_at IS NULL AND (icon IS NOT NULL OR cover_image IS NOT NULL)',
    ),
  ]);
  const decorationById = new Map(decorated.map((d) => [d.id, d]));
  for (const row of rows) {
    const d = decorationById.get(row.id);
    if (d) Object.assign(row, { icon: d.icon, cover_image: d.cover_image });
  }
  const byType = emptyEntries();
  for (const row of rows) {
    const entry = fromRow.entry(row);
    byType[entry.type].push(entry);
  }
  for (const type of ENTRY_TYPES) byType[type].sort(ORDER[type].sort);
  return byType;
}

/** Die laufende zweite Stufe von `fetchEntries`; ein neuer Ladevorgang macht eine ältere wirkungslos. */
let contentLoad: Promise<void> = Promise.resolve();
let loadGeneration = 0;
/** Einträge je Abfrage der zweiten Stufe. */
const CONTENT_CHUNK = 1000;

/** `pending` ohne die `ids` — `null`, wenn danach keiner mehr aussteht. */
export function withoutIds(pending: ReadonlySet<string>, ids: Iterable<string>): ReadonlySet<string> | null {
  const next = new Set(pending);
  for (const id of ids) next.delete(id);
  return next.size ? next : null;
}

/**
 * Trägt die Inhalte nach — nur bei Einträgen, die noch ausstehen. Ein Eintrag,
 * den `ensureEntryContent` schon geholt und der Autosave seitdem geschrieben
 * hat, behielte sonst den älteren Stand dieser Abfrage.
 */
async function loadAllContent(generation: number): Promise<void> {
  if (generation !== loadGeneration || !useEntryStore.getState().pendingContent) return;
  const db = await getDb();
  // In Stücken: ein überholter Ladevorgang (Vault-Wechsel, neu geladene
  // Seite) hört nach dem laufenden Stück auf, statt noch alle Inhalte über
  // die IPC zu schieben — und keine einzelne Antwort wird zig Megabyte groß.
  const contentById = new Map<string, string>();
  for (let after = -1; ;) {
    const rows = await db.select<{ rid: number; id: string; content: string | null }[]>(
      'SELECT rowid AS rid, id, content FROM entries WHERE deleted_at IS NULL AND rowid > $1 ORDER BY rowid LIMIT $2',
      [after, CONTENT_CHUNK],
    );
    if (generation !== loadGeneration) return;
    for (const r of rows) contentById.set(r.id, r.content ?? '');
    if (rows.length < CONTENT_CHUNK) break;
    after = rows[rows.length - 1].rid;
  }
  useEntryStore.setState((s) => {
    const pending = s.pendingContent;
    if (!pending) return {};
    return {
      entries: mapEntries(s.entries, (list) => list.map((e) => {
        const content = pending.has(e.id) ? contentById.get(e.id) : undefined;
        return content === undefined ? e : { ...e, content };
      })),
      pendingContent: null,
    };
  });
}

/** Einmal nachgefasst: ein einzelner Fehler soll nicht für die ganze Sitzung leere Inhalte hinterlassen. */
async function loadAllContentWithRetry(generation: number): Promise<void> {
  try {
    await loadAllContent(generation);
  } catch (err) {
    console.warn('[entries] loading content failed, retrying', err);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await loadAllContent(generation);
  }
}

/**
 * Erfüllt sich, sobald jeder Eintrag seinen Inhalt hat — für alles, was über
 * alle Inhalte geht. Scheitert das Nachladen, wirft es.
 *
 * `contentLoad` wird gesetzt, sobald `fetchEntries` beginnt: nach dem Warten
 * ist entweder alles da, oder ein neuerer Ladevorgang hat übernommen — dann
 * auf den. Ohne den Vergleich drehte die Schleife über einem schon erfüllten
 * Promise nur in Microtasks, und die IPC-Antwort käme nie an die Reihe.
 */
export async function whenEntryContentLoaded(): Promise<void> {
  for (let load = contentLoad; useEntryStore.getState().pendingContent; load = contentLoad) {
    await load;
    if (load === contentLoad) return;
  }
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
  pendingContent: null,

  fetchEntries: ({ keepLoaded = false } = {}) => {
    const generation = ++loadGeneration;
    const metadata = (async () => {
      set({ loading: true });
      try {
        const fresh = await selectLiveEntries();
        if (generation !== loadGeneration) return;
        const s = get();
        const loaded = new Map<string, string>();
        if (keepLoaded) {
          for (const e of allEntries(s.entries)) if (!s.pendingContent?.has(e.id)) loaded.set(e.id, e.content);
        }
        const entries = mapEntries(fresh, (list) => list.map((e) => {
          const content = loaded.get(e.id);
          return content === undefined ? e : { ...e, content };
        }));
        const pending = allEntries(entries).filter((e) => !loaded.has(e.id)).map((e) => e.id);
        set({ entries, pendingContent: pending.length ? new Set(pending) : null });
      } finally {
        set({ loading: false });
      }
    })();
    // Sofort, nicht erst nach den Metadaten — siehe `whenEntryContentLoaded`.
    contentLoad = metadata.then(() => loadAllContentWithRetry(generation));
    contentLoad.catch((err: unknown) => console.error('[entries] loading content failed', err));
    return metadata;
  },

  ensureEntryContent: async (id) => {
    if (!get().pendingContent?.has(id)) return;
    const db = await getDb();
    const rows = await db.select<{ content: string | null }[]>('SELECT content FROM entries WHERE id = $1', [id]);
    set((s) => {
      // Inzwischen kam die zweite Stufe — oder ein anderer Aufruf — zuvor.
      if (!s.pendingContent?.has(id)) return {};
      const entry = findEntry(s.entries, id);
      const content = rows[0]?.content ?? '';
      return {
        pendingContent: withoutIds(s.pendingContent, [id]),
        ...(entry && { entries: withEntry(s.entries, entry.type, (list) => list.map((e) => (e.id === id ? { ...e, content } : e))) }),
      };
    });
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
    await get().ensureEntryContent(id);
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
    if (!entry) return;
    // Ein noch nicht geladener Inhalt ist leer, nicht der gespeicherte — was
    // ihn mitschickt, kann ihn nicht gelesen haben. Der Editor montiert erst
    // mit Inhalt; das hier fängt jeden anderen Weg ab.
    if (patch.content !== undefined && get().pendingContent?.has(id)) {
      console.warn('[entries] content of', id, 'not loaded yet — left as stored');
      const { content: _dropped, ...rest } = patch;
      patch = rest;
    }
    if (!needsWrite(entry, patch, touch)) return;
    const db = await getDb();
    // Den Typ ändert nur `entryTypeChange`.
    const merged: Entry = { ...entry, ...patch, type: entry.type, updated_at: stampFor(entry.updated_at, touch) };

    // `content` nur, wenn er sich ändern soll: er ist das mit Abstand größte
    // Feld, und ein Titel- oder Tag-Wechsel muss ihn nicht neu verschlüsseln.
    const writesContent = patch.content !== undefined;
    await db.execute(
      `UPDATE entries
          SET title=$1, category_id=$2, updated_at=$3, tags=$4, cover_image=$5, icon=$6${writesContent ? ', content=$8' : ''}
        WHERE id=$7`,
      [
        merged.title,
        merged.category_id,
        merged.updated_at,
        JSON.stringify(merged.tags),
        merged.cover_image ?? null,
        merged.icon ?? null,
        id,
        ...(writesContent ? [merged.content] : []),
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
    // Nur diese Zeile, einsortiert wie beim Laden.
    const rows = await db.select<DbRow[]>('SELECT * FROM entries WHERE id = $1', [id]);
    if (!rows[0]) return;
    const entry = fromRow.entry(rows[0]);
    set((s) => ({
      entries: withEntry(s.entries, entry.type, (list) => [...list.filter((e) => e.id !== id), entry].sort(ORDER[entry.type].sort)),
      // Die volle Zeile ist da — auch, wenn die zweite Stufe noch läuft.
      pendingContent: s.pendingContent && withoutIds(s.pendingContent, [id]),
    }));
  },

  permanentlyDeleteEntry: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM entries WHERE id=$1', [id]);
  },

  getEntry: (id, type) => findEntry(get().entries, id, type),
}));
