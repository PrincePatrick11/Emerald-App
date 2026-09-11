import { create } from 'zustand';
import { getDb } from '../lib/db';
import { fromRow, jsonArray, type DbRow } from '../lib/row';
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTaskStore } from './taskStore';
import { useRoutineStore } from './routineStore';
import { generateId, nowIso } from '../lib/helpers';
import { serialKey, serialized } from '../lib/serialize';
import type { Tag } from '../types';

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

/** Benennt `from` in einer Tag-Liste um; trug sie beide Schreibweisen, bleibt der Name einmal. */
const renameInList = (tags: string[], from: string, to: string) =>
  [...new Set(tags.map((t) => (t === from ? to : t)))];

type TaggedType = 'journal' | 'wiki' | 'operation' | 'task' | 'routine';

interface AffectedEntry { id: string; type: TaggedType }

interface TaggedRef extends AffectedEntry { tags: string[] }

/**
 * Alles, was Tag-*Namen* trägt — Einträge speichern Namen, keine ids. Wer einen
 * Tag umbenennt, löscht oder wiederherstellt, muss darum jede dieser Listen
 * anfassen. Routinen (Altar-Bibliothek) haben derzeit keinen Tag-Editor in der
 * Oberfläche, können aber Tags aus älteren Daten tragen.
 */
function taggedItems(): TaggedRef[] {
  return [
    ...useJournalStore.getState().entries.map((e) => ({ id: e.id, type: 'journal' as const, tags: e.tags ?? [] })),
    ...useWikiStore.getState().articles.map((a) => ({ id: a.id, type: 'wiki' as const, tags: a.tags ?? [] })),
    ...useOperationStore.getState().operations.map((o) => ({ id: o.id, type: 'operation' as const, tags: o.tags ?? [] })),
    ...useTaskStore.getState().tasks.map((t) => ({ id: t.id, type: 'task' as const, tags: t.tags ?? [] })),
    ...useRoutineStore.getState().routines.map((r) => ({ id: r.id, type: 'routine' as const, tags: r.tags ?? [] })),
  ];
}

function setItemTags(type: TaggedType, id: string, tags: string[]): Promise<void> {
  switch (type) {
    case 'journal': return useJournalStore.getState().updateEntry(id, { tags });
    case 'wiki': return useWikiStore.getState().updateArticle(id, { tags });
    case 'operation': return useOperationStore.getState().updateOperation(id, { tags });
    case 'task': return useTaskStore.getState().updateTask(id, { tags });
    case 'routine': return useRoutineStore.getState().updateRoutine(id, { tags });
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * `name` ist in der Tabelle UNIQUE — auch für Tags im Papierkorb. Wer den
 * Namen jetzt bewusst neu vergibt, räumt den gelöschten Namensvetter weg;
 * sonst schlüge das INSERT/UPDATE fehl (bzw. ensureTag verwarf es still).
 * Ohne Rücksicht auf Groß-/Kleinschreibung, wie jeder Namensvergleich hier —
 * sonst stünden nach dem Wiederherstellen „foo" und „Foo" nebeneinander.
 */
async function purgeTrashedNamesake(name: string) {
  const db = await getDb();
  const trashed = await db.select<{ id: string; name: string }[]>(
    'SELECT id, name FROM tags WHERE deleted_at IS NOT NULL'
  );
  for (const row of trashed) {
    if (sameName(row.name, name)) await db.execute('DELETE FROM tags WHERE id=$1', [row.id]);
  }
}

/** Die Tabellen, deren Zeilen in den Papierkorb gehen und Tag-Namen tragen. */
const TRASHABLE_TAGGED_TABLES = ['journal_entries', 'wiki_articles', 'operations', 'tasks'] as const;

/**
 * Einträge im Papierkorb stehen in keinem Store. Ihr Tag-Name wird darum
 * direkt in der Tabelle umgeschrieben — sonst kämen sie beim Wiederherstellen
 * mit einem Namen zurück, den es nicht mehr gibt. `updated_at` bleibt, wie bei
 * jedem Umbenennen, das der Eintrag nicht selbst veranlasst hat.
 */
async function renameInTrashedRows(from: string, to: string) {
  const db = await getDb();
  for (const table of TRASHABLE_TAGGED_TABLES) {
    // LIKE grenzt nur grob vor (auch ohne Beachtung der Schreibweise); ob der
    // Name wirklich drinsteht, entscheidet der Vergleich danach.
    const rows = await db.select<{ id: string; tags: string }[]>(
      `SELECT id, tags FROM ${table} WHERE deleted_at IS NOT NULL AND tags LIKE $1`,
      [`%${JSON.stringify(from)}%`]
    );
    for (const row of rows) {
      const tags = jsonArray<string>(row.tags);
      if (!tags.includes(from)) continue;
      await db.execute(`UPDATE ${table} SET tags=$1 WHERE id=$2`, [JSON.stringify(renameInList(tags, from, to)), row.id]);
    }
  }
}

/** Neue Tags laufen hintereinander: ein doppelt ausgelöstes Anlegen desselben
 *  Namens fände sonst zweimal keinen Treffer und scheiterte am UNIQUE. */
const NEW_TAG_KEY = serialKey('tag', 'new');

interface TagState {
  tags: Tag[];

  fetchTags: () => Promise<void>;
  ensureTag: (name: string) => Promise<Tag>;
  /** Wie ensureTag, wirft aber TAG_NAME_TAKEN statt den bestehenden Tag zu
   *  liefern. Ohne `color` bekommt der Tag eine zufällige aus TAG_COLORS. */
  createTag: (name: string, color?: string) => Promise<Tag>;
  /** Ein neuer Name zieht in alle Einträge mit; vergebene Namen werfen TAG_NAME_TAKEN. */
  updateTag: (id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  restoreTag: (id: string) => Promise<void>;
  permanentlyDeleteTag: (id: string) => Promise<void>;
  getByName: (name: string) => Tag | undefined;
}

export const useTagStore = create<TagState>((set, get) => {
  /** Liefert den bestehenden Tag gleichen Namens oder legt ihn an. */
  const ensure = (name: string, color?: string): Promise<Tag> => serialized(NEW_TAG_KEY, async () => {
    const trimmed = name.trim();
    const existing = get().tags.find((t) => sameName(t.name, trimmed));
    if (existing) return existing;
    const tag: Tag = { id: generateId(), name: trimmed, color: color ?? randomTagColor() };
    await purgeTrashedNamesake(tag.name);
    const db = await getDb();
    await db.execute('INSERT INTO tags (id, name, color) VALUES ($1, $2, $3)', [tag.id, tag.name, tag.color]);
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
        const renamed = name !== tag.name;
        if (renamed) await purgeTrashedNamesake(name);

        const updated = { ...tag, ...patch, name };
        const db = await getDb();
        await db.execute('UPDATE tags SET name=$1, color=$2 WHERE id=$3', [updated.name, updated.color, id]);
        set((s) => ({
          tags: s.tags.map((t) => (t.id === id ? updated : t)).sort(byName),
        }));

        if (!renamed) return;
        for (const item of taggedItems()) {
          if (!item.tags.includes(tag.name)) continue;
          await setItemTags(item.type, item.id, renameInList(item.tags, tag.name, name));
        }
        await renameInTrashedRows(tag.name, name);
      });
    },

    deleteTag: async (name) => {
      const db = await getDb();
      const now = nowIso();

      // Collect affected entry IDs before removing the tag. Anders als beim
      // Umbenennen bleiben Einträge im Papierkorb bewusst unberührt: restoreTag
      // findet sie so unverändert vor und muss nichts zurückschreiben.
      const affected: AffectedEntry[] = [];
      for (const item of taggedItems()) {
        if (!item.tags.includes(name)) continue;
        affected.push({ id: item.id, type: item.type });
        await setItemTags(item.type, item.id, item.tags.filter((t) => t !== name));
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
      const { name: trashedName, color, affected_ids } = rows[0];
      const affected = jsonArray<AffectedEntry>(affected_ids);

      // Gibt es inzwischen einen lebenden Tag gleichen Namens (neu angelegt,
      // nur anders geschrieben), wird zusammengeführt statt verdoppelt: die
      // Einträge bekommen dessen Namen, die gelöschte Zeile verschwindet.
      const namesake = get().tags.find((t) => t.id !== id && sameName(t.name, trashedName));
      const name = namesake?.name ?? trashedName;
      if (namesake) await db.execute('DELETE FROM tags WHERE id=$1', [id]);
      else await db.execute('UPDATE tags SET deleted_at=NULL, affected_ids=$1 WHERE id=$2', ['[]', id]);

      // Re-add tag to affected entries
      const current = taggedItems();
      for (const { id: eid, type } of affected) {
        const item = current.find((i) => i.id === eid && i.type === type);
        if (item && !item.tags.includes(name)) {
          await setItemTags(type, eid, [...item.tags, name]);
        }
      }

      if (namesake) return;
      const tag: Tag = { id, name, color };
      set((s) => ({
        tags: [...s.tags, tag].sort(byName),
      }));
    },

    permanentlyDeleteTag: async (id) => {
      const db = await getDb();
      await db.execute('DELETE FROM tags WHERE id=$1', [id]);
    },

    getByName: (name) => get().tags.find((t) => sameName(t.name, name)),
  };
});
