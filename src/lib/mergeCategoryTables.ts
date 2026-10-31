/**
 * Migration v38 — merges `wiki_categories`, `operation_categories`,
 * `task_categories` and `altar_categories` into the one table `categories`
 * and repoints the four content tables to it.
 *
 * Like v33 a rebuild without `PRAGMA foreign_keys = OFF` (why is explained in the header
 * of `normalizeSchema.ts`), but with a trap that v33 did not have: since
 * v33 there are foreign keys, and `ALTER TABLE altar_items RENAME TO
 * altar_items_old` rewrites the reference in `altar_placements` to point at
 * `altar_items_old`. If `altar_items_old` were dropped afterwards, the
 * CASCADE would take all placements with it. The same goes for `tasks` ← `task_links`.
 * That is why the two child tables are rebuilt as well: rename **children first**
 * (then `altar_placements_old` points at `altar_items_old`, and
 * both disappear together), copy parents first, drop children first.
 *
 *   1. Roll back leftovers of an aborted run
 *   2. Take a file snapshot (VACUUM INTO)
 *   3. Read the four old tables and merge them (`mergeCategoryRows`)
 *   4. Create and fill `categories`, store the ID mapping in `_category_id_map`
 *      — a real table, not a TEMP table: that would be tied to a
 *      pool connection and might be gone for the next statement
 *   5. Rename children first to `*_old`
 *   6. Create new tables (`ddlBeforeV49`), copy parents first; the
 *      `category_id` runs through the mapping in the process
 *   7. Drop `*_old` children first, then the four old category tables
 *      and the mapping
 *   8. Create indexes, `PRAGMA foreign_key_check`
 *
 * How to tell how far an aborted run got: after step 6
 * the run writes a mark into `_category_id_map` — if it is there, all
 * six tables are copied and only the cleanup (7–8) is missing. Without the mark
 * the run was midway: step 1 restores the initial state. The
 * mark is necessary because rolling back after step 6 costs data — a
 * `DROP TABLE tasks` on the finished table deletes, via CASCADE, all rows
 * from the likewise finished `task_links`. If the map is already gone (abort
 * at the very end), the foreign key of `wiki_articles` reveals the state.
 */
import type Database from './sqlite';
import i18n from '../i18n';
// INDEX_DDL_V38, not INDEX_DDL: the chain here still lacks the tables of later migrations.
import { TABLE_DDL, INDEX_DDL_V38, FALLBACK_CATEGORY_ID, insertCategoryRows } from './schema';
// `wiki_articles`/`operations` in their form up to v48 — since v49 they live in `entries`.
import { ddlBeforeV49 } from './schemaV48';
import { mergeCategoryRows, type CategorySource } from './categoryMerge';
import { legacyDisplayName, type LegacyCategoryTable } from './categories';
import {
  assertForeignKeysIntact,
  backupDatabaseFile,
  copyTable,
  createIndexesIfMissing,
  referencedTables,
  tableExists,
} from './dbRebuild';

const LEGACY_TABLES: readonly LegacyCategoryTable[] = [
  'wiki_categories',
  'operation_categories',
  'task_categories',
  'altar_categories',
];

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

const ID_MAP_TABLE = '_category_id_map';
/** Row in the map that records "all six content tables are copied". */
const CONTENT_REBUILT_MARK = { src: '_state', oldId: 'content_rebuilt' };

interface LegacyRow {
  id: string;
  name: string;
  emoji: string;
  is_builtin?: number | null;
  deleted_at?: string | null;
}

/** Are the contents fully rebuilt? First the mark, otherwise the foreign key (map already dropped). */
async function contentRebuilt(db: Database): Promise<boolean> {
  if (await tableExists(db, ID_MAP_TABLE)) {
    const rows = await db.select<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM ${ID_MAP_TABLE} WHERE src = $1 AND old_id = $2`,
      [CONTENT_REBUILT_MARK.src, CONTENT_REBUILT_MARK.oldId]
    );
    return (rows[0]?.n ?? 0) > 0;
  }
  return (await referencedTables(db, 'wiki_articles')).has('categories');
}

async function rollbackPartialRebuild(db: Database): Promise<void> {
  let rolledBack = false;
  for (const table of REBUILT_CHILDREN_FIRST) {
    if (!(await tableExists(db, `${table}_old`))) continue;
    console.warn(`[db] v38: rolling back remains of an aborted run for ${table}`);
    if (await tableExists(db, table)) {
      await db.execute(`DROP TABLE ${table}`);
    }
    await db.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
    rolledBack = true;
  }
  // A half-filled `categories` from before the renaming: cheap to rebuild,
  // so get rid of it — the contents still point at the old tables.
  if (rolledBack || !(await referencedTables(db, 'wiki_articles')).has('categories')) {
    await db.execute('DROP TABLE IF EXISTS categories');
    await db.execute(`DROP TABLE IF EXISTS ${ID_MAP_TABLE}`);
  }
}

async function buildCategories(db: Database): Promise<void> {
  const sources: CategorySource[] = [];
  for (const table of LEGACY_TABLES) {
    if (!(await tableExists(db, table))) continue;
    const rows = await db.select<LegacyRow[]>(
      `SELECT * FROM ${table} ORDER BY sort_order ASC, name ASC`
    );
    sources.push({
      table,
      rows: rows.map((r) => ({
        id: r.id,
        name: legacyDisplayName(i18n, table, r),
        emoji: r.emoji,
        deleted_at: r.deleted_at ?? null,
      })),
    });
  }

  const merged = mergeCategoryRows(sources, {
    builtinName: (id) => i18n.t(`categories.builtin.${id}`),
    log: (msg) => console.info(`[db] v38: ${msg}`),
  });

  await db.execute(TABLE_DDL.categories);
  await insertCategoryRows(db, merged.rows);

  await db.execute(
    `CREATE TABLE ${ID_MAP_TABLE} (src TEXT NOT NULL, old_id TEXT NOT NULL, new_id TEXT NOT NULL, PRIMARY KEY (src, old_id))`
  );
  for (const [key, newId] of merged.idMap) {
    const sep = key.indexOf(':');
    await db.execute(
      `INSERT INTO ${ID_MAP_TABLE} (src, old_id, new_id) VALUES ($1, $2, $3)`,
      [key.slice(0, sep), key.slice(sep + 1), newId]
    );
  }
}

async function renameOldTables(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_old`);
  }
}

/** `category_id` through the mapping, unknown values to the catch-all. */
function mappedCategory(src: LegacyCategoryTable): string {
  return `COALESCE(
    (SELECT m.new_id FROM ${ID_MAP_TABLE} m WHERE m.src = '${src}' AND m.old_id = o.category_id),
    '${FALLBACK_CATEGORY_ID}'
  )`;
}

async function rebuildContentTables(db: Database): Promise<void> {
  const overrides: Partial<Record<(typeof REBUILT_PARENTS_FIRST)[number], Record<string, string>>> = {
    wiki_articles: { category_id: mappedCategory('wiki_categories') },
    operations: { category_id: mappedCategory('operation_categories') },
    altar_items: { category_id: mappedCategory('altar_categories') },
    tasks: { category_id: mappedCategory('task_categories') },
  };
  for (const table of REBUILT_PARENTS_FIRST) {
    await db.execute(ddlBeforeV49(table));
    // `tasks` including `parent_task_id` in one INSERT … SELECT: SQLite checks
    // foreign keys at the end of the statement, so a child may come before
    // its parent in the result (v33 copies the same way).
    await copyTable(db, table, `${table}_old`, overrides[table]);
  }
  // From here on nothing may be rolled back (see header).
  await db.execute(
    `INSERT INTO ${ID_MAP_TABLE} (src, old_id, new_id) VALUES ($1, $2, '1')`,
    [CONTENT_REBUILT_MARK.src, CONTENT_REBUILT_MARK.oldId]
  );
}

async function dropOldTables(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    await db.execute(`DROP TABLE IF EXISTS ${table}_old`);
  }
  for (const table of LEGACY_TABLES) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }
  await db.execute(`DROP TABLE IF EXISTS ${ID_MAP_TABLE}`);
}

export async function mergeCategoryTables(db: Database): Promise<void> {
  if (await contentRebuilt(db)) {
    console.info('[db] v38: rebuild already done, catching up on cleanup and verification only');
    await dropOldTables(db);
    await createIndexesIfMissing(db, INDEX_DDL_V38);
    await assertForeignKeysIntact(db, 'v38');
    return;
  }

  await rollbackPartialRebuild(db);
  await backupDatabaseFile(db, 'v38');
  await buildCategories(db);
  await renameOldTables(db);
  await rebuildContentTables(db);
  await dropOldTables(db);
  await createIndexesIfMissing(db, INDEX_DDL_V38);
  await assertForeignKeysIntact(db, 'v38');
}
