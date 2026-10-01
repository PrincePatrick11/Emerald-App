/**
 * Migration v53 — Einträge und Vorlagen tragen Tag-IDs statt Tag-Namen, und
 * `tags.affected_ids` fällt weg (`tagRefs.ts`).
 *
 * Bis v52 hing ein Tag am Namen: Umbenennen schrieb jede Zeile um, Löschen
 * nahm den Namen aus den Einträgen und merkte sich in `affected_ids`, wem es
 * ihn beim Wiederherstellen zurückgibt. Jetzt behält ein Eintrag die ID, auch
 * solange der Tag im Papierkorb liegt — die Merkliste wird hier ein letztes
 * Mal gelesen und in die Zeilen zurückgeschrieben.
 *
 * Wiederholbar ohne Transaktion: zuerst werden alle neuen Listen berechnet,
 * dann die Tags für verwaiste Namen angelegt, dann die Zeilen geschrieben,
 * zuletzt fällt die Spalte. Bricht es dazwischen ab, sind die neuen Tags schon
 * da und eine geschriebene Liste trägt bekannte IDs — ein zweiter Lauf lässt
 * beides stehen.
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
    console.info(`[db] v53: „${tag.name}" stand in Einträgen, aber in keiner Tag-Liste — als Tag angelegt`);
    await db.execute('INSERT OR IGNORE INTO tags (id, name) VALUES ($1, $2)', [tag.id, tag.name]);
  }
  for (const update of updates) {
    await db.execute(`UPDATE ${update.table} SET tags=$1 WHERE id=$2`, [update.tags, update.id]);
  }
  await dropColumnsIfPresent(db, 'tags', ['affected_ids']);
}
