import { useMemo } from 'react';
import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { registerTagLookup } from '../lib/templateTags';
import { AS_A_CONSEQUENCE } from '../lib/stamp';
import { getDb } from '../lib/db';
import { fromRow, type DbRow } from '../lib/row';
import { replaceTagId, stripTagIds, tagNameKey } from '../lib/tagRefs';
import { useEntryStore, findEntry } from './entryStore';
import { useTemplateStore } from './templateStore';
import { useImageStore } from './imageStore';
import { generateId, nowIso } from '../lib/helpers';
import { serialKey, serialized } from '../lib/serialize';
import type { Tag } from '../types';

/** The palette of tag colours — colour choice in TagsView and random colour of new tags. */
export const TAG_COLORS = [
  '#00e699', '#8347ff', '#3b82f6', '#f43f5e',
  '#f59e0b', '#06b6d4', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#84cc16', '#78716c',
];

/** Error message from createTag/updateTag when the name is already taken. */
export const TAG_NAME_TAKEN = 'TAG_NAME_TAKEN';

/** The colour of a new tag, whether created in the editor or in TagsView. */
export function randomTagColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name);

export type TaggedType = 'entry' | 'template';

const sameName = (a: string, b: string) => tagNameKey(a) === tagNameKey(b);

/**
 * Rewrites tag lists in the database (`rewriteTagRefs`) and updates the
 * stores that hold the rows in memory. An entry that is currently
 * open receives the new list through its store.
 */
async function rewriteRefs(rewrite: (db: Database) => Promise<Map<string, string[]>>): Promise<void> {
  const changed = await rewrite(await getDb());
  if (!changed.size) return;
  useEntryStore.setState((s) => ({
    entries: s.entries.map((e) => (changed.has(e.id) ? { ...e, tags: changed.get(e.id)! } : e)),
  }));
  useTemplateStore.setState((s) => ({
    templates: s.templates.map((t) => (changed.has(t.id) ? { ...t, tags: changed.get(t.id)! } : t)),
  }));
  useImageStore.setState((s) => ({
    images: s.images.map((i) => (changed.has(i.id) ? { ...i, tags: changed.get(i.id)! } : i)),
  }));
}

/** The tags in the trash with this name (case-insensitive). */
async function trashedNamesakes(name: string): Promise<{ id: string; name: string; color: string }[]> {
  const db = await getDb();
  const trashed = await db.select<{ id: string; name: string; color: string }[]>(
    'SELECT id, name, color FROM tags WHERE deleted_at IS NOT NULL'
  );
  return trashed.filter((row) => sameName(row.name, name));
}

/**
 * A name belongs to one tag — the same rule as for categories. Whoever
 * assigns a name (typing, import) that a tag in the trash carries brings
 * that one back, with colour and spelling, instead of creating a second one.
 * The entries that still carry it lose it in the process: whoever assigns the
 * name now means this one entry, not those of back then.
 */
async function reviveTrashedNamesake(name: string): Promise<Tag | null> {
  const [hit] = await trashedNamesakes(name);
  if (!hit) return null;
  await rewriteRefs((db) => stripTagIds(db, [hit.id]));
  const db = await getDb();
  await db.execute('UPDATE tags SET deleted_at=NULL WHERE id=$1', [hit.id]);
  return { id: hit.id, name: hit.name, color: hit.color };
}

/** Deletes tags permanently — first from every list, then the rows. */
async function purgeTags(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await rewriteRefs((db) => stripTagIds(db, ids));
  const db = await getDb();
  for (const id of ids) await db.execute('DELETE FROM tags WHERE id=$1', [id]);
}

/** New tags run one after another: a doubly triggered creation of the same
 *  name would otherwise find no match twice and fail on the UNIQUE. */
const NEW_TAG_KEY = serialKey('tag', 'new');

interface TagState {
  /** The live tags. An ID that is missing here (trash) is displayed nowhere. */
  tags: Tag[];

  fetchTags: () => Promise<void>;
  /** `id` only for a tag with a fixed ID ("Altar Library"), used when the name is new. */
  ensureTag: (name: string, id?: string) => Promise<Tag>;
  /** Like ensureTag, but throws TAG_NAME_TAKEN instead of returning the
   *  existing tag. Without `color` the tag gets a random one from TAG_COLORS. */
  createTag: (name: string, color?: string) => Promise<Tag>;
  /** Names already taken throw TAG_NAME_TAKEN. Entries carry the ID — it does not change. */
  updateTag: (id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) => Promise<void>;
  /** Into the trash — the entries keep the ID, the tag is merely invisible. */
  deleteTag: (id: string) => Promise<void>;
  restoreTag: (id: string) => Promise<void>;
  permanentlyDeleteTag: (id: string) => Promise<void>;
  /** Empty the trash: all tags in it permanently. */
  purgeTrashedTags: () => Promise<void>;
  /**
   * An entry is back from the trash: IDs of tags that no longer exist at all
   * are dropped. Those of a tag in the trash stay — it may
   * come back.
   */
  dropUnknownTagIds: (type: TaggedType, id: string) => Promise<void>;
  getByName: (name: string) => Tag | undefined;
}

export const useTagStore = create<TagState>((set, get) => {
  /** Returns the existing tag of the same name or creates it. */
  const ensure = (name: string, { color, fixedId }: { color?: string; fixedId?: string } = {}): Promise<Tag> => serialized(NEW_TAG_KEY, async () => {
    const trimmed = name.trim();
    const existing = get().tags.find((t) => sameName(t.name, trimmed));
    if (existing) return existing;
    const db = await getDb();
    const revived = await reviveTrashedNamesake(trimmed);
    let tag: Tag;
    if (revived) {
      // An explicitly chosen colour (tags view) also applies to the restored one.
      tag = color ? { ...revived, color } : revived;
      if (color) await db.execute('UPDATE tags SET color=$1 WHERE id=$2', [color, tag.id]);
    } else {
      // The fixed ID only while no row holds it (renamed, in the trash).
      const taken = fixedId ? (await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM tags WHERE id=$1', [fixedId]))[0]?.n : 0;
      tag = { id: fixedId && !taken ? fixedId : generateId(), name: trimmed, color: color ?? randomTagColor() };
      await db.execute('INSERT INTO tags (id, name, color) VALUES ($1, $2, $3)', [tag.id, tag.name, tag.color]);
    }
    set((s) => ({
      tags: [...s.tags, tag].sort(byName),
    }));
    return tag;
  });

  const nameTakenByOther = (name: string, id?: string) =>
    get().tags.some((t) => t.id !== id && sameName(t.name, name));

  return {
    tags: [],

    fetchTags: async () => {
      const db = await getDb();
      const rows = await db.select<DbRow[]>(
        'SELECT * FROM tags WHERE deleted_at IS NULL'
      );
      // Sorted like every later change — SQL's ORDER BY compares binary
      // ("Zebra" before "apple").
      set({ tags: rows.map(fromRow.tag).sort(byName) });
    },

    ensureTag: (name, id) => ensure(name, { fixedId: id }),

    createTag: async (name, color) => {
      // The check before the chain, not inside it: there it would throw through
      // `serialized`, which logs every rejection as an error. A duplicate call
      // that still slips through here gets the fresh tag in `ensure`.
      if (nameTakenByOther(name.trim())) throw new Error(TAG_NAME_TAKEN);
      return ensure(name, { color });
    },

    updateTag: async (id, patch) => {
      // As in createTag: the check before the chain, so that an expected
      // rejection does not end up in the log as an error.
      if (patch.name !== undefined && nameTakenByOther(patch.name.trim(), id)) throw new Error(TAG_NAME_TAKEN);
      // serialized: see lib/serialize.ts.
      return serialized(serialKey('tag', id), async () => {
        const tag = get().tags.find((t) => t.id === id);
        if (!tag) return;
        const name = patch.name?.trim() || tag.name;
        // Renaming to the name of a tag in the trash reassigns it:
        // the deleted one goes entirely (`name` is UNIQUE, even in the trash), and
        // its entries do not get the name back through this one.
        if (name !== tag.name) {
          await purgeTags((await trashedNamesakes(name)).map((row) => row.id).filter((other) => other !== id));
        }
        const updated = { ...tag, ...patch, name };
        const db = await getDb();
        await db.execute('UPDATE tags SET name=$1, color=$2 WHERE id=$3', [updated.name, updated.color, id]);
        set((s) => ({
          tags: s.tags.map((t) => (t.id === id ? updated : t)).sort(byName),
        }));
      });
    },

    deleteTag: async (id) => {
      const db = await getDb();
      await db.execute('UPDATE tags SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
      set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }));
    },

    restoreTag: async (id) => {
      const db = await getDb();
      const rows = await db.select<{ name: string; color: string; deleted_at: string | null }[]>(
        'SELECT name, color, deleted_at FROM tags WHERE id=$1',
        [id]
      );
      // Already back — retrieved via its name (`reviveTrashedNamesake`)
      // while the undo was still pending.
      if (!rows[0] || !rows[0].deleted_at || get().tags.some((t) => t.id === id)) return;
      const { name, color } = rows[0];

      // If a live tag of the same name has appeared in the meantime (newly created,
      // just spelled differently), they are merged instead of duplicated: the
      // entries get its ID, the deleted row disappears.
      const namesake = get().tags.find((t) => sameName(t.name, name));
      if (namesake) {
        await rewriteRefs((database) => replaceTagId(database, id, namesake.id));
        await db.execute('DELETE FROM tags WHERE id=$1', [id]);
        return;
      }
      await db.execute('UPDATE tags SET deleted_at=NULL WHERE id=$1', [id]);
      set((s) => ({ tags: [...s.tags, { id, name, color }].sort(byName) }));
    },

    permanentlyDeleteTag: (id) => purgeTags([id]),

    purgeTrashedTags: async () => {
      const db = await getDb();
      const rows = await db.select<{ id: string }[]>('SELECT id FROM tags WHERE deleted_at IS NOT NULL');
      await purgeTags(rows.map((r) => r.id));
    },

    dropUnknownTagIds: async (type, id) => {
      const item = type === 'template'
        ? useTemplateStore.getState().templates.find((t) => t.id === id)
        : findEntry(useEntryStore.getState().entries, id);
      if (!item?.tags.length) return;
      const db = await getDb();
      const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM tags')).map((r) => r.id));
      const kept = item.tags.filter((tagId) => known.has(tagId));
      if (kept.length === item.tags.length) return;
      // A consequence, not a change to the entry: "Last modified" stays.
      if (type === 'template') await useTemplateStore.getState().updateTemplate(id, { tags: kept }, AS_A_CONSEQUENCE);
      else await useEntryStore.getState().updateEntry(id, { tags: kept }, AS_A_CONSEQUENCE);
    },

    getByName: (name) => get().tags.find((t) => sameName(t.name, name)),
  };
});

/** The live tags by ID — for everything that displays IDs. */
export function useTagMap(): Map<string, Tag> {
  const tags = useTagStore((s) => s.tags);
  return useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
}

/** The names of the live tags of a list — what exports write out. */
export function liveTagNames(ids: readonly string[] | undefined): string[] {
  const byId = new Map(useTagStore.getState().tags.map((t) => [t.id, t]));
  return visibleTags(ids, byId).map((tag) => tag.name);
}

/** The tags of a list that are visible — without those in the trash and unknown ones. */
export function visibleTags(ids: readonly string[] | undefined, byId: ReadonlyMap<string, Tag>): Tag[] {
  return (ids ?? []).map((id) => byId.get(id)).filter((tag): tag is Tag => !!tag);
}

// Templates check their tags through the store without importing it (see lib/templateTags).
registerTagLookup((id) => useTagStore.getState().tags.some((t) => t.id === id));
