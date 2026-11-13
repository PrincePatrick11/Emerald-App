import type Database from './sqlite';
import { jsonArray } from './row';

/**
 * Tags are attached to entries, templates and pictures by **ID** — `entries.tags`,
 * `templates.tags` and `images.tags` are JSON arrays of `tags.id`. Renaming only changes
 * the tag row; a tag in the trash stays in its entries as an ID
 * and is merely invisible until it comes back. Only when a tag disappears
 * entirely (permanently deleted, grace period expired) or merges into another
 * are the lists rewritten (`rewriteTagRefs`).
 *
 * DOM-free and without stores — it also runs in node (`scripts/schema-check.mjs`).
 */

/** The tables whose rows carry tags — including those in the trash. */
export const TAG_REF_TABLES = ['entries', 'templates', 'images'] as const;

/** A tag ID from a foreign source (backup): only harmless characters, like `isDefinitionId`. */
export function isTagId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

/** The tag IDs of a row — duplicates once, foreign values dropped. */
export function tagIdList(raw: unknown): string[] {
  return [...new Set(jsonArray<unknown>(raw).filter(isTagId))];
}

/**
 * Rewrites the tag list of every row in `TAG_REF_TABLES` whose list `fn`
 * changes — trash included, without `updated_at`: a consequence, not a change to the
 * entry. Returns the new lists by row ID so that the stores can catch up
 * in memory.
 */
export async function rewriteTagRefs(db: Database, fn: (ids: string[]) => string[]): Promise<Map<string, string[]>> {
  const changed = new Map<string, string[]>();
  for (const table of TAG_REF_TABLES) {
    const rows = await db.select<{ id: string; tags: string }[]>(`SELECT id, tags FROM ${table} WHERE tags != '[]'`);
    const updates: [string, unknown[]][] = [];
    for (const row of rows) {
      const before = jsonArray<string>(row.tags);
      const after = [...new Set(fn(before))];
      if (after.length === before.length && after.every((id, i) => id === before[i])) continue;
      updates.push([`UPDATE ${table} SET tags=$1 WHERE id=$2`, [JSON.stringify(after), row.id]]);
      changed.set(row.id, after);
    }
    // One transaction per table: a tag on hundreds of entries would otherwise be
    // hundreds of commits.
    await db.batch(updates);
  }
  return changed;
}

/** Removes the IDs from every list — for tags that are about to no longer exist. */
export function stripTagIds(db: Database, ids: Iterable<string>): Promise<Map<string, string[]>> {
  const gone = new Set(ids);
  if (!gone.size) return Promise.resolve(new Map());
  return rewriteTagRefs(db, (list) => list.filter((id) => !gone.has(id)));
}

/** Replaces `from` with `to` in every list — one tag merges into another. */
export function replaceTagId(db: Database, from: string, to: string): Promise<Map<string, string[]>> {
  return rewriteTagRefs(db, (list) => list.map((id) => (id === from ? to : id)));
}

/** Does a name count as the same tag? Regardless of case and whitespace at the edges. */
export function tagNameKey(name: string): string {
  return name.trim().toLowerCase();
}
