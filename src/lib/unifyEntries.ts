/**
 * Migration v49 — `journal_entries`, `wiki_articles` and `operations` become
 * one table `entries` with a column `type`.
 *
 * Since status, sigils, paradigm and links are blocks in the content,
 * the three tables had the same core; the rest were columns nobody
 * read any more (see `schemaV48.ts`). They are dropped here, as are `slug` (never
 * read) and `moon_phase` (follows from `created_at`, `entryMoonPhase`).
 *
 * Like the other rebuilds without a transaction (why is explained at the top of
 * `normalizeSchema.ts`), but without renaming and without a marker: each old
 * table is copied on its own and only dropped once every one of its rows is in
 * `entries`. An aborted run therefore simply resumes —
 * the copy skips what is already over there, and a table that is already gone
 * is done. No other table has a foreign key to the three
 * (`task_links` is polymorphic), so dropping takes nothing else with it.
 *
 * Beforehand it catches up on the sigils whose drawing v42 could not save
 * as a file (until v48 `getDb` tried that on every open): afterwards
 * the column in which they wait would no longer exist. If it fails again,
 * v49 aborts and tries again on the next open — better a
 * vault that opens only later than a lost drawing.
 *
 * An ID that stood in two of the old tables — a type change that earlier
 * aborted midway (`entryTypeChange` moved rows between tables) —
 * arrives only once: in the order below, the first one wins. The other
 * row was a copy of the same entry; it stays in the backup
 * `.pre-v49.bak` and is named in the log.
 */
import type Database from './sqlite';
import { ENTRIES_INDEX_DDL_V49, TABLE_DDL, ddlIfNotExists } from './schema';
import { assertForeignKeysIntact, backupDatabaseFile, createIndexesIfMissing, tableExists } from './dbRebuild';
import { convertLegacySigils } from './migrateLegacySigils';
import type { EntryType } from '../types';

/** The old tables and their columns in `entries`. A literal, because it is interpolated into SQL. */
const SOURCES: readonly { table: string; type: EntryType; categorized: boolean }[] = [
  { table: 'journal_entries', type: 'journal', categorized: false },
  { table: 'wiki_articles', type: 'wiki', categorized: true },
  { table: 'operations', type: 'operation', categorized: true },
];

async function copyInto(db: Database, { table, type, categorized }: (typeof SOURCES)[number]): Promise<void> {
  // The journal had neither a category nor an icon or cover image.
  const extra = categorized ? 'o.category_id, o.icon, o.cover_image' : 'NULL, NULL, NULL';
  await db.execute(
    `INSERT INTO entries (id, type, title, content, category_id, icon, cover_image,
                          entry_number, tags, created_at, updated_at, deleted_at)
     SELECT o.id, '${type}', o.title, o.content, ${extra},
            o.entry_number, o.tags, o.created_at, o.updated_at, o.deleted_at
       FROM ${table} o
      WHERE o.id NOT IN (SELECT id FROM entries)`
  );

  // What is still missing now was already in `entries` under a different type.
  const skipped = await db.select<{ id: string }[]>(
    `SELECT o.id FROM ${table} o JOIN entries e ON e.id = o.id WHERE e.type != '${type}'`
  );
  for (const { id } of skipped) {
    console.warn(`[db] v49: ${table}.${id} stand schon in einer anderen Tabelle — die Kopie bleibt nur in der Sicherung`);
  }
  const [missing] = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE id NOT IN (SELECT id FROM entries)`
  );
  if ((missing?.n ?? 0) > 0) {
    throw new Error(`[db] v49: ${missing.n} Zeile(n) aus ${table} fehlen in entries — ${table} bleibt stehen`);
  }
}

export async function unifyEntries(db: Database): Promise<void> {
  const remaining: (typeof SOURCES)[number][] = [];
  for (const source of SOURCES) {
    if (await tableExists(db, source.table)) remaining.push(source);
  }

  if (remaining.length > 0) {
    if (await tableExists(db, 'operations')) {
      const { failed } = await convertLegacySigils(db, { includeSigilCategory: false });
      if (failed > 0) {
        throw new Error(`[db] v49: ${failed} Sigillen-Zeichnung(en) ließen sich nicht speichern — v49 wartet, bis das gelingt`);
      }
    }
    await backupDatabaseFile(db, 'v49');
    await db.execute(ddlIfNotExists(TABLE_DDL.entries));
    for (const source of remaining) {
      await copyInto(db, source);
      // The old table's indexes go with it.
      await db.execute(`DROP TABLE ${source.table}`);
    }
  }

  await createIndexesIfMissing(db, ENTRIES_INDEX_DDL_V49);
  await assertForeignKeysIntact(db, 'v49');
}
