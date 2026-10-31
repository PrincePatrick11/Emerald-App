import type Database from './sqlite';
import { jsonArray } from './row';

/**
 * Since v53 tags are attached to entries and templates by **ID** — `entries.tags`
 * and `templates.tags` are JSON arrays of `tags.id`. Renaming only changes
 * the tag row; a tag in the trash stays in its entries as an ID
 * and is merely invisible until it comes back. Only when a tag disappears
 * entirely (permanently deleted, grace period expired) or merges into another
 * are the lists rewritten (`rewriteTagRefs`).
 *
 * DOM-free and without stores — it also runs in node (`scripts/schema-check.mjs`).
 */

/** The tables whose rows carry tags — including those in the trash. */
export const TAGGED_TABLES = ['entries', 'templates'] as const;

/** A tag ID from a foreign source (backup): only harmless characters, like `isDefinitionId`. */
export function isTagId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

/** The tag IDs of a row — duplicates once, foreign values dropped. */
export function tagIdList(raw: unknown): string[] {
  return [...new Set(jsonArray<unknown>(raw).filter(isTagId))];
}

/**
 * Rewrites the tag list of every row in `TAGGED_TABLES` whose list `fn`
 * changes — trash included, without `updated_at`: a consequence, not a change to the
 * entry. Returns the new lists by row ID so that the stores can catch up
 * in memory.
 */
export async function rewriteTagRefs(db: Database, fn: (ids: string[]) => string[]): Promise<Map<string, string[]>> {
  const changed = new Map<string, string[]>();
  for (const table of TAGGED_TABLES) {
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

/** A row from `tags`, as the database up to v52 and backups up to format 11 know it. */
export interface LegacyTagRow {
  id: string;
  name: string;
  color?: string;
  deleted_at?: string | null;
  /** JSON: `{ id, type }` per entry from which the tag was taken on deletion. */
  affected_ids?: unknown;
}

/**
 * Turns the tag *names* of a row (state up to v52) into tag IDs — the same
 * rule for migration v53 and for backups up to format 11:
 * - Regardless of case, a live tag before one in the trash (whose names
 *   until then were carried only by entries in the trash).
 * - A name without a tag (after a merge import or a backup without tags)
 *   gets a new one — `created`, so that nothing is lost.
 * - A value that is already a known ID stays: a second run changes
 *   nothing.
 * - `withAffected`: the tag in the trash returns to every row from which
 *   deletion took it (`affected_ids`) — in the new model the row keeps it until it is
 *   restored. Unless it now carries one of the same name.
 */
export function tagNameResolver(tags: readonly LegacyTagRow[], makeId: () => string) {
  const byId = new Map<string, LegacyTagRow>(tags.map((t) => [t.id, t]));
  const byName = new Map<string, LegacyTagRow>();
  // Live ones first, so that they win on an equal name.
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
