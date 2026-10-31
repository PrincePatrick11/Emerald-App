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
 * The entries of journal, wiki and operations — one store over the single
 * table `entries` (since v49; previously three nearly identical stores).
 *
 * The entries sit in a separate array per type: a module subscribes to
 * `s.entries.wiki` and does not re-render when a journal entry
 * changes — and a selector always returns the same array as long as nothing
 * changes for its type (zustand 5 requires stable snapshots).
 */
export type EntriesByType = Record<EntryType, Entry[]>;

interface EntryState {
  entries: EntriesByType;
  loading: boolean;
  /**
   * Entries whose `content` is not loaded yet — `null` once all are
   * there. `fetchEntries` loads in two stages: first the metadata (the lists
   * appear immediately), the contents in the background. Until then the `content` of these
   * entries is empty; whoever needs it waits with `ensureEntryContent` or
   * `whenEntryContentLoaded`.
   */
  pendingContent: ReadonlySet<string> | null;

  /**
   * Reloads all entries. `keepLoaded`: entries whose content is already loaded
   * keep it — after an import (`reloadModules`) that wrote only through this
   * store. A vault switch or backup import reloads everything.
   */
  fetchEntries: (options?: { keepLoaded?: boolean }) => Promise<void>;
  /** Loads an entry's content immediately, if it is still pending. */
  ensureEntryContent: (id: string) => Promise<void>;
  /** With the default of the combination (templates) — unless `blank`. The journal has no category. */
  createEntry: (type: EntryType, opts?: { categoryId?: string | null; blank?: boolean; createdAt?: string }) => Promise<Entry>;
  duplicateEntry: (id: string) => Promise<Entry | undefined>;
  updateEntry: (id: string, patch: Partial<Entry>, options?: WriteOptions) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  restoreEntry: (id: string) => Promise<void>;
  permanentlyDeleteEntry: (id: string) => Promise<void>;
  /** With `type`, only an entry of that type (`findEntry`). */
  getEntry: (id: string, type?: EntryType) => Entry | undefined;
}

export const ENTRY_TYPES: readonly EntryType[] = ['journal', 'wiki', 'operation'];

/**
 * The order of the lists, as the three stores had it: the journal
 * by creation, the wiki by title, operations by last change. New
 * entries go to the front in the journal and operations, to the end in the
 * wiki — until the next load, as before.
 */
const ORDER: Record<EntryType, { sort: (a: Entry, b: Entry) => number; newAtEnd: boolean }> = {
  journal: { sort: (a, b) => b.created_at.localeCompare(a.created_at), newAtEnd: false },
  wiki: { sort: (a, b) => a.title.localeCompare(b.title), newAtEnd: true },
  operation: { sort: (a, b) => b.updated_at.localeCompare(a.updated_at), newAtEnd: false },
};

const emptyEntries = (): EntriesByType => ({ journal: [], wiki: [], operation: [] });

/** The columns of `idx_entries_list` — the query reads only the index (`ENTRIES_INDEX_DDL`). */
const LIST_COLUMNS = 'id, type, title, category_id, entry_number, tags, created_at, updated_at, deleted_at';

/**
 * The live entries from the database, sorted per type — without content, the
 * first stage of `fetchEntries`. Icon and cover image are not in the index
 * (data URLs): for the few entries that carry one, they come via
 * `idx_entries_decorated` — which is why its condition appears verbatim in the WHERE.
 */
async function selectLiveEntries(): Promise<EntriesByType> {
  const db = await getDb();
  // Two connections, so not the same state: a write exactly in
  // between can attach an older icon to newer list columns — display
  // only, and the next load fixes it.
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

/** The running second stage of `fetchEntries`; a new load makes an older one ineffective. */
let contentLoad: Promise<void> = Promise.resolve();
let loadGeneration = 0;
/** Entries per query of the second stage. */
const CONTENT_CHUNK = 1000;

/** `pending` without the `ids` — `null` if none is left pending afterwards. */
export function withoutIds(pending: ReadonlySet<string>, ids: Iterable<string>): ReadonlySet<string> | null {
  const next = new Set(pending);
  for (const id of ids) next.delete(id);
  return next.size ? next : null;
}

/**
 * Fills in the contents afterwards — only for entries that are still pending. An entry
 * that `ensureEntryContent` has already fetched and the autosave has written to
 * since would otherwise be left with the older state from this query.
 */
async function loadAllContent(generation: number): Promise<void> {
  if (generation !== loadGeneration || !useEntryStore.getState().pendingContent) return;
  const db = await getDb();
  // In chunks: a superseded load (vault switch, reloaded
  // page) stops after the current chunk instead of pushing all contents over
  // the IPC — and no single response grows to tens of megabytes.
  const contentById = new Map<string, string>();
  for (let after = -1; ;) {
    // `+deleted_at`: no index for this term. Otherwise SQLite would take
    // `idx_entries_list` and sort the content of all remaining rows
    // by rowid for every chunk — this way it walks along the rowid.
    const rows = await db.select<{ rid: number; id: string; content: string | null }[]>(
      'SELECT rowid AS rid, id, content FROM entries WHERE +deleted_at IS NULL AND rowid > $1 ORDER BY rowid LIMIT $2',
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

/** Retried once: a single error should not leave empty contents for the whole session. */
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
 * Resolves as soon as every entry has its content — for everything that spans
 * all contents. Throws if the reload fails.
 *
 * `contentLoad` is set as soon as `fetchEntries` begins: after waiting,
 * either everything is there, or a newer load has taken over — then wait
 * for that one. Without the comparison the loop would spin over an already fulfilled
 * promise in microtasks only, and the IPC response would never get its turn.
 */
export async function whenEntryContentLoaded(): Promise<void> {
  for (let load = contentLoad; useEntryStore.getState().pendingContent; load = contentLoad) {
    await load;
    if (load === contentLoad) return;
  }
}

/** All entries in one list — journal, wiki, operations. */
export function allEntries(entries: EntriesByType): Entry[] {
  return [...entries.journal, ...entries.wiki, ...entries.operation];
}

/**
 * The entry `id` — with `type` only if it has that type. Returns the
 * object from the store itself: a selector over it re-renders only when
 * exactly this entry changes.
 */
export function findEntry(entries: EntriesByType, id: string, type?: EntryType): Entry | undefined {
  for (const t of type ? [type] : ENTRY_TYPES) {
    const entry = entries[t].find((e) => e.id === id);
    if (entry) return entry;
  }
  return undefined;
}

/** Applies `map` to the list of each type. */
export function mapEntries(entries: EntriesByType, map: (list: Entry[], type: EntryType) => Entry[]): EntriesByType {
  return { journal: map(entries.journal, 'journal'), wiki: map(entries.wiki, 'wiki'), operation: map(entries.operation, 'operation') };
}

/**
 * Inserts an entry into the list of its type — at the front or back as when
 * creating. For `entryTypeChange`, which moves an entry into another module.
 */
export function withAddedEntry(entries: EntriesByType, entry: Entry): EntriesByType {
  return withEntry(entries, entry.type, (list) => (ORDER[entry.type].newAtEnd ? [...list, entry] : [entry, ...list]));
}

/**
 * Inserts an entry into the list of its type, sorted in as on load —
 * for one that returns to its old place (`revertEntryType`).
 */
export function withSortedEntry(entries: EntriesByType, entry: Entry): EntriesByType {
  return withEntry(entries, entry.type, (list) => [...list.filter((e) => e.id !== entry.id), entry].sort(ORDER[entry.type].sort));
}

/** Replaces or removes an entry in its type — the other arrays stay the same. */
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
    // Immediately, not only after the metadata — see `whenEntryContentLoaded`.
    contentLoad = metadata.then(() => loadAllContentWithRetry(generation));
    contentLoad.catch((err: unknown) => console.error('[entries] loading content failed', err));
    return metadata;
  },

  ensureEntryContent: async (id) => {
    if (!get().pendingContent?.has(id)) return;
    const db = await getDb();
    const rows = await db.select<{ content: string | null }[]>('SELECT content FROM entries WHERE id = $1', [id]);
    set((s) => {
      // In the meantime the second stage — or another call — got there first.
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
    // The "Sigils" category thus begins with calculator, drawing and charge
    // (template `core-sigil`) — provided the vault applies defaults by itself.
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
   * Copies all content fields of the source entry; identity, number and
   * timestamps stay with the new one — and with the creation date the moon phase
   * that follows from it. The callers used to enumerate the field list
   * themselves — a new field would then silently be missing in individual places.
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

  // serialized: see lib/serialize.ts. One key per entry, not per
  // type — a type change runs under the same one (`entryTypeChange`).
  updateEntry: (id, patch, { touch } = {}) => serialized(serialKey('entry', id), async () => {
    const entry = get().getEntry(id);
    if (!entry) return;
    // Content that is not loaded yet is empty, not the saved one — whatever
    // sends it along cannot have read it. The editor only mounts
    // with content; this catches every other path.
    if (patch.content !== undefined && get().pendingContent?.has(id)) {
      console.warn('[entries] content of', id, 'not loaded yet — left as stored');
      const { content: _dropped, ...rest } = patch;
      patch = rest;
    }
    if (!needsWrite(entry, patch, touch)) return;
    const db = await getDb();
    // Only `entryTypeChange` changes the type.
    const merged: Entry = { ...entry, ...patch, type: entry.type, updated_at: stampFor(entry.updated_at, touch) };

    // `content` only if it is meant to change: it is by far the largest
    // field, and a title or tag change need not re-encrypt it.
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
    // Only this row, sorted in as on load.
    const rows = await db.select<DbRow[]>('SELECT * FROM entries WHERE id = $1', [id]);
    if (!rows[0]) return;
    const entry = fromRow.entry(rows[0]);
    set((s) => ({
      entries: withEntry(s.entries, entry.type, (list) => [...list.filter((e) => e.id !== id), entry].sort(ORDER[entry.type].sort)),
      // The full row is here — even if the second stage is still running.
      pendingContent: s.pendingContent && withoutIds(s.pendingContent, [id]),
    }));
  },

  permanentlyDeleteEntry: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM entries WHERE id=$1', [id]);
  },

  getEntry: (id, type) => findEntry(get().entries, id, type),
}));
