import { create } from 'zustand';
import { getDb, nextEntryNumber } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { ENTRY_NUMBER_KEY, serialKey, serialized } from '../lib/serialize';
import { fromRow, type DbRow } from '../lib/row';
import type { Entry } from '../types';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import { startOfNewEntry, useTemplateNoticeStore } from './templateStore';
import { kindOfEntry } from './dashboardStore';
import { contentOf, loadBlocks, planContentWrite, type BlockOwner } from '../lib/blockStore';

/**
 * All entries — one store over the single table `entries`, in one list.
 * An entry has no type: which module shows it follows from the dashboards'
 * filters (`useDashboardEntries`, `lib/dashboards.ts`).
 *
 * The list is in creation order, newest first; every view sorts for itself.
 * An entry changed in place keeps its slot, so a selector over one entry
 * (`getEntry`) re-renders only when exactly that entry changes.
 */
interface EntryState {
  entries: Entry[];
  loading: boolean;
  /**
   * Entries whose `content` is not loaded yet — `null` once all are
   * there. `fetchEntries` loads in two stages: first the metadata (the lists
   * appear immediately), the contents in the background. Until then the `content` of these
   * entries is empty; whoever needs it waits with `ensureEntryContent`.
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
  /**
   * A new entry in `categoryId`, starting with that category's start template
   * or the vault's default (`resolveStartTemplate`) — unless `blank`.
   */
  createEntry: (opts?: { categoryId?: string | null; blank?: boolean; createdAt?: string }) => Promise<Entry>;
  duplicateEntry: (id: string) => Promise<Entry | undefined>;
  updateEntry: (id: string, patch: Partial<Entry>, options?: WriteOptions) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  restoreEntry: (id: string) => Promise<void>;
  permanentlyDeleteEntry: (id: string) => Promise<void>;
  getEntry: (id: string) => Entry | undefined;
}

const byCreatedDesc = (a: Entry, b: Entry) => b.created_at.localeCompare(a.created_at);

/** The columns of `idx_entries_list` — the query reads only the index (`ENTRIES_INDEX_DDL`). */
const LIST_COLUMNS = 'id, title, category_id, entry_number, tags, created_at, updated_at, deleted_at';

/**
 * The live entries from the database — without content, the first stage of
 * `fetchEntries`. Icon and cover image are not in the index (data URLs): for
 * the few entries that carry one, they come via `idx_entries_decorated` —
 * which is why its condition appears verbatim in the WHERE.
 */
async function selectLiveEntries(): Promise<Entry[]> {
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
  return rows.map((row) => fromRow.entry(row)).sort(byCreatedDesc);
}

/** The running second stage of `fetchEntries`; a new load makes an older one ineffective. */
let loadGeneration = 0;
/** Entries per query of the second stage. */
const CONTENT_CHUNK = 1000;

/** `pending` without the `ids` — `null` if none is left pending afterwards. */
function withoutIds(pending: ReadonlySet<string>, ids: Iterable<string>): ReadonlySet<string> | null {
  const next = new Set(pending);
  for (const id of ids) next.delete(id);
  return next.size ? next : null;
}

/**
 * Fills in the contents afterwards — only for entries that are still pending. An entry
 * that `ensureEntryContent` has already fetched and the autosave has written to
 * since would otherwise be left with the older state from this query.
 *
 * The content comes from the block rows (`blocks`), entry by entry in
 * order; `content` is what they give (`contentOf`).
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
    // `idx_entries_list` and sort all remaining rows by rowid for every
    // chunk — this way it walks along the rowid.
    const rows = await db.select<{ rid: number; id: string }[]>(
      'SELECT rowid AS rid, id FROM entries WHERE +deleted_at IS NULL AND rowid > $1 ORDER BY rowid LIMIT $2',
      [after, CONTENT_CHUNK],
    );
    if (generation !== loadGeneration) return;
    const blocks = await loadBlocks(db, 'entry', rows.map((r) => r.id));
    if (generation !== loadGeneration) return;
    for (const [id, list] of blocks) contentById.set(id, contentOf(list));
    if (rows.length < CONTENT_CHUNK) break;
    after = rows[rows.length - 1].rid;
  }
  useEntryStore.setState((s) => {
    const pending = s.pendingContent;
    if (!pending) return {};
    return {
      entries: s.entries.map((e) => {
        const content = pending.has(e.id) ? contentById.get(e.id) : undefined;
        return content === undefined ? e : { ...e, content };
      }),
      pendingContent: null,
    };
  });
}

/** The content of one entry, from its block rows. */
async function selectContent(id: string): Promise<string> {
  const db = await getDb();
  return contentOf((await loadBlocks(db, 'entry', [id])).get(id) ?? []);
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
 * The entry `id`. Returns the object from the store itself: a selector over
 * it re-renders only when exactly this entry changes.
 */
export function findEntry(entries: readonly Entry[], id: string): Entry | undefined {
  return entries.find((e) => e.id === id);
}

/** Replaces the entry `id` in place — the others keep their objects. */
function withEntry(entries: Entry[], id: string, map: (entry: Entry) => Entry): Entry[] {
  return entries.map((e) => (e.id === id ? map(e) : e));
}

export const useEntryStore = create<EntryState>((set, get) => ({
  entries: [],
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
          for (const e of s.entries) if (!s.pendingContent?.has(e.id)) loaded.set(e.id, e.content);
        }
        const entries = fresh.map((e) => {
          const content = loaded.get(e.id);
          return content === undefined ? e : { ...e, content };
        });
        const pending = entries.filter((e) => !loaded.has(e.id)).map((e) => e.id);
        set({ entries, pendingContent: pending.length ? new Set(pending) : null });
      } finally {
        set({ loading: false });
      }
    })();
    metadata.then(() => loadAllContentWithRetry(generation)).catch((err: unknown) => console.error('[entries] loading content failed', err));
    return metadata;
  },

  ensureEntryContent: async (id) => {
    if (!get().pendingContent?.has(id)) return;
    const content = await selectContent(id);
    set((s) => {
      // In the meantime the second stage — or another call — got there first.
      if (!s.pendingContent?.has(id)) return {};
      return {
        pendingContent: withoutIds(s.pendingContent, [id]),
        entries: withEntry(s.entries, id, (e) => ({ ...e, content })),
      };
    });
  },

  // Serialized: the number is read and then written, and two quick creations
  // must not both take the same one (`idx_entries_number` is unique).
  createEntry: ({ categoryId = null, blank = false, createdAt } = {}) => serialized(ENTRY_NUMBER_KEY, async () => {
    const db = await getDb();
    const now = nowIso();
    // The "Sigils" category thus begins with calculator, drawing and charge
    // (template `core-sigil`), as long as it stays its start template. Read
    // from the row: this store does not import the category store.
    const [category] = categoryId && !blank
      ? await db.select<{ template_id: string | null }[]>('SELECT template_id FROM categories WHERE id=$1', [categoryId])
      : [];
    const start = startOfNewEntry(category?.template_id ?? null, blank);
    const id = generateId();
    const blocks = await planContentWrite(db, { kind: 'entry', id }, start.content, now);
    const entry: Entry = {
      id,
      entry_number: await nextEntryNumber(db),
      title: start.title,
      content: blocks.content,
      category_id: categoryId,
      created_at: createdAt ?? now,
      updated_at: now,
      tags: start.tags,
      deleted_at: null,
    };
    // The row first: its blocks point at it.
    await db.batch([
      [
        `INSERT INTO entries (id, title, category_id, created_at, updated_at, tags, entry_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [entry.id, entry.title, categoryId, entry.created_at, entry.updated_at,
          JSON.stringify(entry.tags), entry.entry_number],
      ],
      ...blocks.statements,
    ]);
    blocks.commit();
    set((s) => ({ entries: [entry, ...s.entries] }));
    if (start.templateId) useTemplateNoticeStore.getState().show({ entryId: entry.id, templateId: start.templateId });
    return entry;
  }),

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
    const copy = await get().createEntry({ categoryId: src.category_id, blank: true });
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateEntry(copy.id, { ...fields, title: displayTitle(i18n.t, kindOfEntry(src), src.title) + i18n.t('common.copySuffix') });
    return get().getEntry(copy.id) ?? copy;
  },

  // serialized: see lib/serialize.ts. One key per entry.
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
    const merged: Entry = { ...entry, ...patch, updated_at: stampFor(entry.updated_at, touch) };

    // The blocks only if they are meant to change: as rows, only those that
    // changed (`planBlockWrite`), in the same transaction as the entry's row;
    // `content` in memory becomes what they give.
    const owner: BlockOwner = { kind: 'entry', id };
    const blocks = patch.content !== undefined
      ? await planContentWrite(db, owner, patch.content, merged.updated_at)
      : null;
    if (blocks) merged.content = blocks.content;
    await db.batch([
      [
        `UPDATE entries
            SET title=$1, category_id=$2, updated_at=$3, tags=$4, cover_image=$5, icon=$6
          WHERE id=$7`,
        [
          merged.title,
          merged.category_id,
          merged.updated_at,
          JSON.stringify(merged.tags),
          merged.cover_image ?? null,
          merged.icon ?? null,
          id,
        ],
      ],
      ...(blocks?.statements ?? []),
    ]);
    blocks?.commit();
    set((s) => ({ entries: withEntry(s.entries, id, () => merged) }));
  }),

  deleteEntry: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE entries SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  },

  restoreEntry: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE entries SET deleted_at=NULL WHERE id=$1', [id]);
    // Only this row, sorted in as on load.
    const rows = await db.select<DbRow[]>(`SELECT ${LIST_COLUMNS}, icon, cover_image FROM entries WHERE id = $1`, [id]);
    if (!rows[0]) return;
    const entry = { ...fromRow.entry(rows[0]), content: await selectContent(id) };
    set((s) => ({
      entries: [...s.entries.filter((e) => e.id !== id), entry].sort(byCreatedDesc),
      // The full row is here — even if the second stage is still running.
      pendingContent: s.pendingContent && withoutIds(s.pendingContent, [id]),
    }));
  },

  permanentlyDeleteEntry: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM entries WHERE id=$1', [id]);
  },

  getEntry: (id) => findEntry(get().entries, id),
}));
