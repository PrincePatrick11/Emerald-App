import { useMemo } from 'react';
import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { registerTagLookup } from '../lib/templateTags';
import { AS_A_CONSEQUENCE } from '../lib/stamp';
import { getDb } from '../lib/db';
import { fromRow, type DbRow } from '../lib/row';
import { replaceTagId, stripTagIds, tagNameKey } from '../lib/tagRefs';
import { useEntryStore, findEntry, mapEntries } from './entryStore';
import { useTemplateStore } from './templateStore';
import { generateId, nowIso } from '../lib/helpers';
import { serialKey, serialized } from '../lib/serialize';
import type { EntryType, Tag } from '../types';

/** Die Palette der Tag-Farben — Farbwahl in TagsView und Zufallsfarbe neuer Tags. */
export const TAG_COLORS = [
  '#00e699', '#8347ff', '#3b82f6', '#f43f5e',
  '#f59e0b', '#06b6d4', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#84cc16', '#78716c',
];

/** Fehlermeldung von createTag/updateTag, wenn der Name schon vergeben ist. */
export const TAG_NAME_TAKEN = 'TAG_NAME_TAKEN';

/** Die Farbe eines neuen Tags, ob im Editor oder in TagsView angelegt. */
export function randomTagColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name);

export type TaggedType = EntryType | 'template';

const sameName = (a: string, b: string) => tagNameKey(a) === tagNameKey(b);

/**
 * Schreibt Tag-Listen in der Datenbank um (`rewriteTagRefs`) und zieht die
 * Stores nach, die die Zeilen im Speicher halten. Ein Eintrag, der gerade
 * offen ist, bekommt die neue Liste über seinen Store mit.
 */
async function rewriteRefs(rewrite: (db: Database) => Promise<Map<string, string[]>>): Promise<void> {
  const changed = await rewrite(await getDb());
  if (!changed.size) return;
  useEntryStore.setState((s) => ({
    entries: mapEntries(s.entries, (list) => list.map((e) => (changed.has(e.id) ? { ...e, tags: changed.get(e.id)! } : e))),
  }));
  useTemplateStore.setState((s) => ({
    templates: s.templates.map((t) => (changed.has(t.id) ? { ...t, tags: changed.get(t.id)! } : t)),
  }));
}

/** Die Tags im Papierkorb mit diesem Namen (Groß-/Kleinschreibung egal). */
async function trashedNamesakes(name: string): Promise<{ id: string; name: string; color: string }[]> {
  const db = await getDb();
  const trashed = await db.select<{ id: string; name: string; color: string }[]>(
    'SELECT id, name, color FROM tags WHERE deleted_at IS NOT NULL'
  );
  return trashed.filter((row) => sameName(row.name, name));
}

/**
 * Ein Name gehört einem Tag — dieselbe Regel wie bei Kategorien. Wer einen
 * Namen vergibt (eintippen, Import), den ein Tag im Papierkorb trägt, holt
 * diesen zurück, mit Farbe und Schreibweise, statt einen zweiten zu schaffen.
 * Die Einträge, die ihn noch tragen, verlieren ihn dabei: wer den Namen jetzt
 * vergibt, meint den einen Eintrag, nicht die von damals.
 */
async function reviveTrashedNamesake(name: string): Promise<Tag | null> {
  const [hit] = await trashedNamesakes(name);
  if (!hit) return null;
  await rewriteRefs((db) => stripTagIds(db, [hit.id]));
  const db = await getDb();
  await db.execute('UPDATE tags SET deleted_at=NULL WHERE id=$1', [hit.id]);
  return { id: hit.id, name: hit.name, color: hit.color };
}

/** Löscht Tags endgültig — erst aus jeder Liste, dann die Zeilen. */
async function purgeTags(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await rewriteRefs((db) => stripTagIds(db, ids));
  const db = await getDb();
  for (const id of ids) await db.execute('DELETE FROM tags WHERE id=$1', [id]);
}

/** Neue Tags laufen hintereinander: ein doppelt ausgelöstes Anlegen desselben
 *  Namens fände sonst zweimal keinen Treffer und scheiterte am UNIQUE. */
const NEW_TAG_KEY = serialKey('tag', 'new');

interface TagState {
  /** Die lebenden Tags. Eine ID, die hier fehlt (Papierkorb), wird nirgends angezeigt. */
  tags: Tag[];

  fetchTags: () => Promise<void>;
  ensureTag: (name: string) => Promise<Tag>;
  /** Wie ensureTag, wirft aber TAG_NAME_TAKEN statt den bestehenden Tag zu
   *  liefern. Ohne `color` bekommt der Tag eine zufällige aus TAG_COLORS. */
  createTag: (name: string, color?: string) => Promise<Tag>;
  /** Vergebene Namen werfen TAG_NAME_TAKEN. Einträge tragen die ID — sie ändern sich nicht. */
  updateTag: (id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) => Promise<void>;
  /** In den Papierkorb — die Einträge behalten die ID, der Tag ist nur unsichtbar. */
  deleteTag: (id: string) => Promise<void>;
  restoreTag: (id: string) => Promise<void>;
  permanentlyDeleteTag: (id: string) => Promise<void>;
  /** Papierkorb leeren: alle Tags darin endgültig. */
  purgeTrashedTags: () => Promise<void>;
  /**
   * Ein Eintrag ist aus dem Papierkorb zurück: IDs von Tags, die es gar nicht
   * mehr gibt, fallen weg. Die eines Tags im Papierkorb bleiben — er kann
   * zurückkommen.
   */
  dropUnknownTagIds: (type: TaggedType, id: string) => Promise<void>;
  getByName: (name: string) => Tag | undefined;
}

export const useTagStore = create<TagState>((set, get) => {
  /** Liefert den bestehenden Tag gleichen Namens oder legt ihn an. */
  const ensure = (name: string, color?: string): Promise<Tag> => serialized(NEW_TAG_KEY, async () => {
    const trimmed = name.trim();
    const existing = get().tags.find((t) => sameName(t.name, trimmed));
    if (existing) return existing;
    const db = await getDb();
    const revived = await reviveTrashedNamesake(trimmed);
    let tag: Tag;
    if (revived) {
      // Eine ausdrücklich gewählte Farbe (Tags-Ansicht) gilt auch für den zurückgeholten.
      tag = color ? { ...revived, color } : revived;
      if (color) await db.execute('UPDATE tags SET color=$1 WHERE id=$2', [color, tag.id]);
    } else {
      tag = { id: generateId(), name: trimmed, color: color ?? randomTagColor() };
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
      // Sortiert wie jede spätere Änderung — SQLs ORDER BY vergleicht binär
      // („Zebra" vor „apple").
      set({ tags: rows.map(fromRow.tag).sort(byName) });
    },

    ensureTag: (name) => ensure(name),

    createTag: async (name, color) => {
      // Die Prüfung vor der Kette, nicht darin: dort würfe sie durch
      // `serialized`, das jede Ablehnung als Fehler loggt. Ein doppelter Aufruf,
      // der hier noch durchrutscht, bekommt in `ensure` den frischen Tag.
      if (nameTakenByOther(name.trim())) throw new Error(TAG_NAME_TAKEN);
      return ensure(name, color);
    },

    updateTag: async (id, patch) => {
      // Wie in createTag: die Prüfung vor der Kette, damit eine erwartbare
      // Ablehnung nicht als Fehler im Log landet.
      if (patch.name !== undefined && nameTakenByOther(patch.name.trim(), id)) throw new Error(TAG_NAME_TAKEN);
      // serialized: siehe lib/serialize.ts.
      return serialized(serialKey('tag', id), async () => {
        const tag = get().tags.find((t) => t.id === id);
        if (!tag) return;
        const name = patch.name?.trim() || tag.name;
        // Umbenennen auf den Namen eines Tags im Papierkorb vergibt ihn neu:
        // der gelöschte geht ganz (`name` ist UNIQUE, auch im Papierkorb), und
        // seine Einträge bekommen den Namen nicht über diesen hier zurück.
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
      // Schon wieder da — über seinen Namen zurückgeholt (`reviveTrashedNamesake`),
      // während das Rückgängig noch stand.
      if (!rows[0] || !rows[0].deleted_at || get().tags.some((t) => t.id === id)) return;
      const { name, color } = rows[0];

      // Gibt es inzwischen einen lebenden Tag gleichen Namens (neu angelegt,
      // nur anders geschrieben), wird zusammengeführt statt verdoppelt: die
      // Einträge bekommen dessen ID, die gelöschte Zeile verschwindet.
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
        : findEntry(useEntryStore.getState().entries, id, type);
      if (!item?.tags.length) return;
      const db = await getDb();
      const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM tags')).map((r) => r.id));
      const kept = item.tags.filter((tagId) => known.has(tagId));
      if (kept.length === item.tags.length) return;
      // Eine Folge, keine Änderung am Eintrag: „Zuletzt geändert" bleibt.
      if (type === 'template') await useTemplateStore.getState().updateTemplate(id, { tags: kept }, AS_A_CONSEQUENCE);
      else await useEntryStore.getState().updateEntry(id, { tags: kept }, AS_A_CONSEQUENCE);
    },

    getByName: (name) => get().tags.find((t) => sameName(t.name, name)),
  };
});

/** Die lebenden Tags nach ID — für alles, was IDs anzeigt. */
export function useTagMap(): Map<string, Tag> {
  const tags = useTagStore((s) => s.tags);
  return useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
}

/** Die Namen der lebenden Tags einer Liste — was Exporte hinausschreiben. */
export function liveTagNames(ids: readonly string[] | undefined): string[] {
  const byId = new Map(useTagStore.getState().tags.map((t) => [t.id, t]));
  return visibleTags(ids, byId).map((tag) => tag.name);
}

/** Die Tags einer Liste, die zu sehen sind — ohne die im Papierkorb und unbekannte. */
export function visibleTags(ids: readonly string[] | undefined, byId: ReadonlyMap<string, Tag>): Tag[] {
  return (ids ?? []).map((id) => byId.get(id)).filter((tag): tag is Tag => !!tag);
}

// Vorlagen prüfen ihre Tags über den Store, ohne ihn zu importieren (siehe lib/templateTags).
registerTagLookup((id) => useTagStore.getState().tags.some((t) => t.id === id));
