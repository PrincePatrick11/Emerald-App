import type Database from './sqlite';
import { jsonArray } from './row';
import { isTagId } from './helpers';

/**
 * Tags are attached to entries, templates and pictures by **ID**, through the
 * link tables `entry_tags`, `template_tags` and `image_tags` — one row per tag,
 * in the order the tags were given (`rowid`). Renaming only changes the tag
 * row; a tag in the trash stays linked and is merely invisible until it comes
 * back. A tag deleted for good takes its links with it (ON DELETE CASCADE);
 * one merging into another hands them over (`replaceTagId`).
 *
 * DOM-free and without stores — it also runs in node (`scripts/schema-check.mjs`).
 */

/** What carries tags, and where its links are. Literals: they are interpolated into SQL. */
export const TAG_LINKS = {
  entry: { table: 'entry_tags', owner: 'entry_id' },
  template: { table: 'template_tags', owner: 'template_id' },
  image: { table: 'image_tags', owner: 'image_id' },
} as const;

export type TagOwner = keyof typeof TAG_LINKS;

/** Ids bound per query, below SQLite's variable limit. */
export const SQL_PARAM_CHUNK = 500;


/** The tag IDs of a list from a foreign source (a backup row) — duplicates once, foreign values dropped. */
export function tagIdList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : jsonArray<unknown>(raw);
  return [...new Set(list.filter(isTagId))];
}

/**
 * The tags of every owner of a kind, in their order — or of the owners in
 * `ids` only. Owners without tags are missing from the map.
 */
export async function readTagLinks(db: Database, owner: TagOwner, ids?: readonly string[]): Promise<Map<string, string[]>> {
  const { table, owner: column } = TAG_LINKS[owner];
  const byOwner = new Map<string, string[]>();
  const add = (rows: { owner: string; tag: string }[]) => {
    for (const { owner: id, tag } of rows) {
      const list = byOwner.get(id);
      if (list) list.push(tag);
      else byOwner.set(id, [tag]);
    }
  };
  if (!ids) {
    add(await db.select<{ owner: string; tag: string }[]>(`SELECT ${column} AS owner, tag_id AS tag FROM ${table} ORDER BY rowid`));
    return byOwner;
  }
  // Bound as parameters, in chunks below SQLite's variable limit.
  for (let i = 0; i < ids.length; i += SQL_PARAM_CHUNK) {
    const chunk = ids.slice(i, i + SQL_PARAM_CHUNK);
    const marks = chunk.map((_, n) => `$${n + 1}`).join(', ');
    add(await db.select<{ owner: string; tag: string }[]>(
      `SELECT ${column} AS owner, tag_id AS tag FROM ${table} WHERE ${column} IN (${marks}) ORDER BY rowid`,
      chunk,
    ));
  }
  return byOwner;
}

/** The tags of one owner, in their order. */
export async function readTags(db: Database, owner: TagOwner, id: string): Promise<string[]> {
  return (await readTagLinks(db, owner, [id])).get(id) ?? [];
}

/**
 * The statements that make `ids` the tags of an owner, in that order — for a
 * `batch` together with the owner's own write. An ID without a row in `tags`
 * is skipped (`INSERT … SELECT`), so a stale ID in memory cannot fail the
 * write on the foreign key.
 */
export function tagStatements(owner: TagOwner, id: string, ids: readonly string[]): [string, unknown[]][] {
  const { table, owner: column } = TAG_LINKS[owner];
  return [[`DELETE FROM ${table} WHERE ${column}=$1`, [id]], ...tagInsertStatements(owner, id, ids)];
}

/** Only the inserts of `tagStatements` — for an owner that has no links yet (a backup import). */
export function tagInsertStatements(owner: TagOwner, id: string, ids: readonly string[]): [string, unknown[]][] {
  const { table, owner: column } = TAG_LINKS[owner];
  return [...new Set(ids)].map((tag) => [
    `INSERT OR IGNORE INTO ${table} (${column}, tag_id) SELECT $1, id FROM tags WHERE id=$2`, [id, tag],
  ]);
}

/**
 * Hands every link of tag `from` over to `to` — one tag merges into another.
 * An owner that already carries `to` keeps its place for it; `from`'s rows go
 * once the tag row is deleted (CASCADE), or here at once.
 */
export async function replaceTagId(db: Database, from: string, to: string): Promise<void> {
  const statements: [string, unknown[]][] = [];
  for (const { table } of Object.values(TAG_LINKS)) {
    statements.push([`UPDATE OR IGNORE ${table} SET tag_id=$1 WHERE tag_id=$2`, [to, from]]);
    statements.push([`DELETE FROM ${table} WHERE tag_id=$1`, [from]]);
  }
  await db.batch(statements);
}

/** Removes every link of the tags — a trashed tag revived as a new one starts without the old owners. */
export async function unlinkTags(db: Database, ids: Iterable<string>): Promise<void> {
  const statements: [string, unknown[]][] = [];
  for (const id of ids) {
    for (const { table } of Object.values(TAG_LINKS)) statements.push([`DELETE FROM ${table} WHERE tag_id=$1`, [id]]);
  }
  if (statements.length) await db.batch(statements);
}

/** Does a name count as the same tag? Regardless of case and whitespace at the edges. */
export function tagNameKey(name: string): string {
  return name.trim().toLowerCase();
}
