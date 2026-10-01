import type Database from '@tauri-apps/plugin-sql';
import { jsonArray } from './row';

/**
 * Tags hängen seit v53 per **ID** an Einträgen und Vorlagen — `entries.tags`
 * und `templates.tags` sind JSON-Arrays von `tags.id`. Umbenennen ändert nur
 * die Tag-Zeile; ein Tag im Papierkorb bleibt als ID in seinen Einträgen
 * stehen und ist bloß unsichtbar, bis er zurückkommt. Nur wenn ein Tag ganz
 * verschwindet (endgültig gelöscht, Frist abgelaufen) oder in einem anderen
 * aufgeht, werden die Listen umgeschrieben (`rewriteTagRefs`).
 *
 * DOM-frei und ohne Stores — es läuft auch in node (`scripts/schema-check.mjs`).
 */

/** Die Tabellen, deren Zeilen Tags tragen — auch die im Papierkorb. */
export const TAGGED_TABLES = ['entries', 'templates'] as const;

/** Eine Tag-ID aus fremder Quelle (Sicherung): nur harmlose Zeichen, wie `isDefinitionId`. */
export function isTagId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

/** Die Tag-IDs einer Zeile — doppelte einmal, Fremdes fällt weg. */
export function tagIdList(raw: unknown): string[] {
  return [...new Set(jsonArray<unknown>(raw).filter(isTagId))];
}

/**
 * Schreibt die Tag-Liste jeder Zeile in `TAGGED_TABLES` um, deren Liste `fn`
 * ändert — samt Papierkorb, ohne `updated_at`: eine Folge, keine Änderung am
 * Eintrag. Liefert die neuen Listen nach Zeilen-ID, damit die Stores im
 * Speicher nachziehen können.
 */
export async function rewriteTagRefs(db: Database, fn: (ids: string[]) => string[]): Promise<Map<string, string[]>> {
  const changed = new Map<string, string[]>();
  for (const table of TAGGED_TABLES) {
    const rows = await db.select<{ id: string; tags: string }[]>(`SELECT id, tags FROM ${table} WHERE tags != '[]'`);
    for (const row of rows) {
      const before = jsonArray<string>(row.tags);
      const after = [...new Set(fn(before))];
      if (after.length === before.length && after.every((id, i) => id === before[i])) continue;
      await db.execute(`UPDATE ${table} SET tags=$1 WHERE id=$2`, [JSON.stringify(after), row.id]);
      changed.set(row.id, after);
    }
  }
  return changed;
}

/** Nimmt die IDs aus jeder Liste — für Tags, die es gleich nicht mehr gibt. */
export function stripTagIds(db: Database, ids: Iterable<string>): Promise<Map<string, string[]>> {
  const gone = new Set(ids);
  if (!gone.size) return Promise.resolve(new Map());
  return rewriteTagRefs(db, (list) => list.filter((id) => !gone.has(id)));
}

/** Ersetzt `from` durch `to` in jeder Liste — ein Tag geht in einem anderen auf. */
export function replaceTagId(db: Database, from: string, to: string): Promise<Map<string, string[]>> {
  return rewriteTagRefs(db, (list) => list.map((id) => (id === from ? to : id)));
}

/** Gilt ein Name als derselbe Tag? Ohne Rücksicht auf Groß-/Kleinschreibung und Leerraum am Rand. */
export function tagNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Eine Zeile aus `tags`, wie die Datenbank bis v52 und Sicherungen bis Format 11 sie kennen. */
export interface LegacyTagRow {
  id: string;
  name: string;
  color?: string;
  deleted_at?: string | null;
  /** JSON: `{ id, type }` je Eintrag, dem der Tag beim Löschen genommen wurde. */
  affected_ids?: unknown;
}

/**
 * Macht aus den Tag-*Namen* einer Zeile (Stand bis v52) Tag-IDs — dieselbe
 * Regel für Migration v53 und für Sicherungen bis Format 11:
 * - Ohne Rücksicht auf Groß-/Kleinschreibung, ein lebender Tag vor einem im
 *   Papierkorb (dessen Namen trugen bis dahin nur Einträge im Papierkorb).
 * - Ein Name ohne Tag (nach einem Merge-Import oder einer Sicherung ohne Tags)
 *   bekommt einen neuen — `created`, damit nichts verloren geht.
 * - Ein Wert, der schon eine bekannte ID ist, bleibt: ein zweiter Lauf ändert
 *   nichts.
 * - `withAffected`: der Tag im Papierkorb kommt zurück in jede Zeile, der ihn
 *   das Löschen nahm (`affected_ids`) — im neuen Modell behält sie ihn, bis er
 *   wiederhergestellt ist. Außer sie trägt inzwischen einen gleichnamigen.
 */
export function tagNameResolver(tags: readonly LegacyTagRow[], makeId: () => string) {
  const byId = new Map<string, LegacyTagRow>(tags.map((t) => [t.id, t]));
  const byName = new Map<string, LegacyTagRow>();
  // Lebende zuerst, damit sie bei gleichem Namen gewinnen.
  for (const tag of [...tags].sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at))) {
    const key = tagNameKey(tag.name);
    if (!byName.has(key)) byName.set(key, tag);
  }
  const affected = new Map<string, LegacyTagRow[]>();
  for (const tag of tags) {
    if (!tag.deleted_at) continue;
    for (const ref of jsonArray<{ id?: unknown }>(tag.affected_ids)) {
      if (typeof ref?.id !== 'string') continue;
      affected.set(ref.id, [...(affected.get(ref.id) ?? []), tag]);
    }
  }
  const created: LegacyTagRow[] = [];

  function idFor(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    if (byId.has(value)) return value;
    const hit = byName.get(tagNameKey(value));
    if (hit) return hit.id;
    const tag: LegacyTagRow = { id: makeId(), name: value.trim(), deleted_at: null };
    created.push(tag);
    byId.set(tag.id, tag);
    byName.set(tagNameKey(tag.name), tag);
    return tag.id;
  }

  return {
    created,
    idsFor(raw: unknown): string[] {
      const ids = jsonArray<unknown>(raw).map(idFor).filter((id): id is string => !!id);
      return [...new Set(ids)];
    },
    withAffected(rowId: string, ids: string[]): string[] {
      const out = [...ids];
      for (const tag of affected.get(rowId) ?? []) {
        const sameName = out.some((id) => tagNameKey(byId.get(id)?.name ?? '') === tagNameKey(tag.name));
        if (!sameName) out.push(tag.id);
      }
      return out;
    },
  };
}
