/**
 * Migration v53 — entries and templates carry tag IDs instead of tag names, and
 * `tags.affected_ids` is dropped (`tagRefs.ts`).
 *
 * Up to v52 a tag was attached by name: renaming rewrote every row, deleting
 * took the name out of the entries and remembered in `affected_ids` whom to
 * give it back to on restoring. Now an entry keeps the ID, even
 * while the tag is in the trash — the memory list is read here one last
 * time and written back into the rows.
 *
 * Repeatable without a transaction: first all new lists are computed,
 * then the tags for orphaned names are created, then the rows are written,
 * finally the column is dropped. If it aborts in between, the new tags are already
 * there and a written list carries known IDs — a second run leaves
 * both in place.
 */
import type Database from './sqlite';
import { backupDatabaseFile, columnNames, dropColumnsIfPresent } from './dbRebuild';
import { generateId } from './helpers';
import { TAGGED_TABLES, tagNameResolver, type LegacyTagRow } from './tagRefs';

export async function tagsById(db: Database): Promise<void> {
  if (!(await columnNames(db, 'tags')).has('affected_ids')) return;
  await backupDatabaseFile(db, 'v53');

  const tags = await db.select<LegacyTagRow[]>('SELECT id, name, color, deleted_at, affected_ids FROM tags');
  const resolver = tagNameResolver(tags, generateId);

  const updates: { table: string; id: string; tags: string }[] = [];
  for (const table of TAGGED_TABLES) {
    const rows = await db.select<{ id: string; tags: string }[]>(`SELECT id, tags FROM ${table}`);
    for (const row of rows) {
      const next = JSON.stringify(resolver.withAffected(row.id, resolver.idsFor(row.tags)));
      if (next !== row.tags) updates.push({ table, id: row.id, tags: next });
    }
  }

  for (const tag of resolver.created) {
    console.info(`[db] v53: "${tag.name}" was in entries but in no tag list — created as a tag`);
    await db.execute('INSERT OR IGNORE INTO tags (id, name) VALUES ($1, $2)', [tag.id, tag.name]);
  }
  for (const update of updates) {
    await db.execute(`UPDATE ${update.table} SET tags=$1 WHERE id=$2`, [update.tags, update.id]);
  }
  await dropColumnsIfPresent(db, 'tags', ['affected_ids']);
}
