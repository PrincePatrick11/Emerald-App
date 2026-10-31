/**
 * Migration v39 — makes `category_id` nullable in the four content tables and
 * removes the special status of `other`.
 *
 * Up to v38 the column was `NOT NULL DEFAULT 'other'`: every entry *had* to
 * have a category, and anyone who chose none got the catch-all. "No
 * category" existed only by accident — an entry whose category was in the
 * trash. Since v39 it is the normal state of a new entry, and the
 * column may be NULL.
 *
 * `other` itself stays, but loses its `is_builtin`: anyone who deliberately
 * put content there keeps it, and anyone who does not want the category
 * renames or deletes it like any other. Fresh vaults no longer create it at all
 * (`BUILTIN_CATEGORIES` in `schema.ts`).
 *
 * Its *name* has to come along: a built-in category is named after its
 * locale key (`categoryLabel`), its `name` column only carries the English
 * seed "Other". Without the flag, exactly that would show from now on — a German
 * vault would lose "Sonstiges". The run therefore writes the translated name
 * into the row, as v38 did for the old module builtins, and leaves it
 * alone if the name is already taken.
 *
 * A rebuild like v33 and v38 — SQLite cannot make a column nullable after
 * the fact — and thus with the same foreign key trap: `ALTER TABLE
 * tasks RENAME TO tasks_old` rewrites the reference in `task_links` to point at
 * `tasks_old`, a later `DROP TABLE tasks_old` would take all
 * links with it via CASCADE. That is why the two child tables are rebuilt too:
 * rename and drop **children first**, create and copy parents first.
 *
 * The data does not change in the process — every `category_id` is carried over
 * unchanged. A mark as in v38 is still needed, but for a
 * different reason: as soon as the new tables are filled and the cleanup
 * begins, there must be no more rolling back. If the process dies in the middle of
 * dropping the `*_old` tables — after `task_links_old` and `altar_placements_old`
 * are gone, but `tasks_old` still exists —, the next start would find a
 * `tasks_old`, drop the finished `tasks` for it, and its
 * `ON DELETE CASCADE` would take the likewise finished `task_links` with it. The same
 * for `altar_items` and the placements. The mark says "from here on only
 * clean up".
 */
import type Database from './sqlite';
import i18n, { savedAppLanguage } from '../i18n';
// INDEX_DDL_V38, not INDEX_DDL: the chain here still lacks the tables of
// later migrations (`block_definitions` arrives with v40).
import { INDEX_DDL_V38, FALLBACK_CATEGORY_ID } from './schema';
// `wiki_articles`/`operations` in their form up to v48 — since v49 they live in `entries`.
import { ddlBeforeV49 } from './schemaV48';
import { categoryKey } from './categoryMerge';
import {
  assertForeignKeysIntact,
  backupDatabaseFile,
  copyTable,
  createIndexesIfMissing,
  tableExists,
} from './dbRebuild';

/** Renaming and dropping: children before parents. */
const REBUILT_CHILDREN_FIRST = [
  'task_links',
  'altar_placements',
  'tasks',
  'altar_items',
  'operations',
  'wiki_articles',
] as const;

/** Creating and copying: parents before children. */
const REBUILT_PARENTS_FIRST = [...REBUILT_CHILDREN_FIRST].reverse();

/**
 * If this table exists, all six content tables are copied and only the
 * cleanup is missing. A real table, not a TEMP table: that would hang on
 * a connection from the pool and might be gone for the next statement
 * (the same consideration as with v38's `_category_id_map`).
 */
const REBUILT_MARK_TABLE = '_v39_content_rebuilt';

/**
 * Is `category_id` already nullable? A vault coming from before v38 has just
 * received the tables from the current `TABLE_DDL` and does not need the
 * rebuild again.
 */
async function alreadyNullable(db: Database): Promise<boolean> {
  const rows = await db.select<{ name: string; notnull: number }[]>('PRAGMA table_info(wiki_articles)');
  const column = rows.find((r) => r.name === 'category_id');
  return !!column && column.notnull === 0;
}

async function rollbackPartialRebuild(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    if (!(await tableExists(db, `${table}_old`))) continue;
    console.warn(`[db] v39: Reste eines abgebrochenen Laufs für ${table} werden zurückgerollt`);
    if (await tableExists(db, table)) await db.execute(`DROP TABLE ${table}`);
    await db.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
  }
}

async function dropOldTables(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    await db.execute(`DROP TABLE IF EXISTS ${table}_old`);
  }
}

/**
 * Removes `is_builtin` from `other` and freezes its previously translated name
 * in the row. If that name is already taken by another category, the old one
 * stays — two identically named ones would be more confusing than an English
 * "Other", and the user can rename them themselves now.
 *
 * The name is only written if the active language is the stored one.
 * `main.tsx` renders after two seconds at the latest even if the
 * locale chunk is not there yet — if the migration hit that window, it would
 * burn "Other" instead of "Sonstiges" permanently into a German vault. The flag
 * is still dropped, only the name then stays the English seed.
 */
/**
 * The stored language — or the active one where there is no `localStorage`.
 * That is the schema check, which runs the migration in Node: there
 * English is active and correct, and the check below should not fail
 * because there is no browser.
 */
function storedLanguage(): string {
  try {
    return savedAppLanguage();
  } catch {
    return i18n.language;
  }
}

async function demoteFallbackCategory(db: Database): Promise<void> {
  const rows = await db.select<{ id: string; name: string; is_builtin: number }[]>(
    'SELECT id, name, is_builtin FROM categories WHERE id = $1',
    [FALLBACK_CATEGORY_ID]
  );
  const row = rows[0];
  if (!row || !row.is_builtin) return;

  const localeReady = i18n.language === storedLanguage();
  const translated = localeReady ? i18n.t(`categories.builtin.${FALLBACK_CATEGORY_ID}`) : '';
  if (!localeReady) {
    console.warn('[db] v39: Locale noch nicht geladen — „other" behält seinen gespeicherten Namen');
  }
  const others = await db.select<{ name: string }[]>(
    'SELECT name FROM categories WHERE id != $1',
    [FALLBACK_CATEGORY_ID]
  );
  const taken = new Set(others.map((c) => categoryKey(c.name)));
  const name = translated && !taken.has(categoryKey(translated)) ? translated : row.name;

  await db.execute(
    'UPDATE categories SET is_builtin = 0, name = $1 WHERE id = $2',
    [name, FALLBACK_CATEGORY_ID]
  );
  console.info(`[db] v39: „${name}" ist jetzt eine gewöhnliche Kategorie`);
}

export async function makeCategoryOptional(db: Database): Promise<void> {
  const rebuilt = await tableExists(db, REBUILT_MARK_TABLE);

  if (rebuilt) {
    console.info('[db] v39: Rebuild lag bereits vor, nur Aufräumen und Prüfung werden nachgeholt');
  } else {
    await rollbackPartialRebuild(db);

    if (!(await alreadyNullable(db))) {
      await backupDatabaseFile(db, 'v39');

      for (const table of REBUILT_CHILDREN_FIRST) {
        await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_old`);
      }
      for (const table of REBUILT_PARENTS_FIRST) {
        await db.execute(ddlBeforeV49(table));
        // `tasks` including `parent_task_id` in one INSERT … SELECT: SQLite checks
        // foreign keys at the end of the statement, so a child may come before
        // its parent in the result (v33 and v38 copy the same way).
        await copyTable(db, table, `${table}_old`);
      }
      // From here on nothing may be rolled back (see header).
      await db.execute(`CREATE TABLE IF NOT EXISTS ${REBUILT_MARK_TABLE} (done INTEGER)`);
    }
  }

  await dropOldTables(db);
  // Outside the rebuild branch: a crash between dropping the
  // `*_old` tables and creating the indexes would otherwise leave them missing permanently,
  // while the migration stamps itself as done. v38 does it the same way.
  await createIndexesIfMissing(db, INDEX_DDL_V38);
  await db.execute(`DROP TABLE IF EXISTS ${REBUILT_MARK_TABLE}`);

  // Separate from the rebuild, so that it also applies to a vault that got the
  // tables in the new form already (upgrade from before v38).
  await demoteFallbackCategory(db);

  await assertForeignKeysIntact(db, 'v39');
}
