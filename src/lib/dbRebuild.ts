/**
 * Building blocks for migrations that rebuild tables — shared by v33
 * (`normalizeSchema.ts`), v38 (`mergeCategoryTables.ts`) and v39
 * (`nullableCategory.ts`).
 *
 * Why a rebuild is needed at all and why it has to work without
 * `PRAGMA foreign_keys = OFF` is explained at the top of
 * `normalizeSchema.ts`.
 */
import type Database from './sqlite';
import { getActiveDbFile } from './vaultManager';

export async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=$1",
    [name]
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function columnNames(db: Database, table: string): Promise<Set<string>> {
  const rows = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

/**
 * `ALTER TABLE … DROP COLUMN` for each of the columns that still exist — so
 * an aborted migration simply picks up again. Without a rebuild: the
 * foreign keys of other tables *pointing at* `table` stay untouched (a DROP TABLE
 * would take their rows along via ON DELETE CASCADE). The column must not appear in any
 * index, foreign key or CHECK; SQLite rejects it otherwise.
 */
export async function dropColumnsIfPresent(db: Database, table: string, columns: readonly string[]): Promise<void> {
  const present = await columnNames(db, table);
  for (const column of columns) {
    if (present.has(column)) await db.execute(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

/** The tables that foreign keys of `table` point to. */
export async function referencedTables(db: Database, table: string): Promise<Set<string>> {
  const rows = await db.select<{ table: string }[]>(`PRAGMA foreign_key_list(${table})`);
  return new Set(rows.map((r) => r.table));
}

/**
 * A full copy of the database file before anything is touched.
 *
 * `VACUUM INTO` instead of copying the file via Rust: the app only has
 * string-based `read_file`/`write_file`, which would corrupt a binary
 * file. VACUUM INTO is a single SQL statement and writes a
 * consistent snapshot.
 *
 * The target name is deliberately fixed and carries no timestamp. If the
 * migration fails, it runs again at the next start — with a unique
 * name, every attempt would create another full copy, and since Emerald
 * stores images as base64 in the database, those are large. `VACUUM INTO`
 * refuses to overwrite an existing file, and that is exactly what serves
 * as detection here: if the snapshot already exists, it is from an earlier
 * attempt and valid, because the data has not changed since.
 *
 * Any other error aborts the migration. That is intentional: the database
 * is then still untouched and the migration unstamped. Starting an irreversible
 * rebuild without a way back would be the worse choice.
 */
export async function backupDatabaseFile(db: Database, tag: string): Promise<string> {
  // The backup sits next to the database, in the vault folder: whoever copies
  // the folder takes it along.
  const target = `${await getActiveDbFile()}.pre-${tag}.bak`;
  try {
    await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/output file already exists/i.test(msg)) throw err;
    console.info(`[db] ${tag}: Sicherung eines früheren Versuchs liegt bereits unter ${target}`);
    return target;
  }
  console.info(`[db] ${tag}: Sicherung angelegt unter ${target}`);
  return target;
}

/**
 * Copies `from` column by column into `table`. Columns that do not exist in the old
 * table are left out — the default from the new DDL then applies. That makes the
 * rebuild robust against vaults in which individual migrations never ran, and
 * this project demonstrably has some. `overrides` supplies SQL expressions per
 * target column; the source is called `o` in them.
 */
export async function copyTable(
  db: Database,
  table: string,
  from: string,
  overrides: Record<string, string> = {}
): Promise<void> {
  if (!(await tableExists(db, from))) return;

  const newCols = await columnNames(db, table);
  const oldCols = await columnNames(db, from);

  const targets: string[] = [];
  const exprs: string[] = [];
  for (const col of newCols) {
    if (col in overrides) {
      targets.push(col);
      exprs.push(overrides[col]);
    } else if (oldCols.has(col)) {
      targets.push(col);
      exprs.push(`o.${col}`);
    }
  }
  if (!targets.length) return;

  await db.execute(
    `INSERT INTO ${table} (${targets.join(', ')}) SELECT ${exprs.join(', ')} FROM ${from} o`
  );
}

/** Creates indexes that do not exist yet — for catch-up paths after an abort. */
export async function createIndexesIfMissing(db: Database, ddl: readonly string[]): Promise<void> {
  for (const sql of ddl) {
    await db.execute(sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '));
  }
}

export async function assertForeignKeysIntact(db: Database, tag: string): Promise<void> {
  const violations = await db.select<unknown[]>('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(
      `[db] ${tag}: ${violations.length} Foreign-Key-Verletzung(en) nach dem Rebuild. ` +
        `Erste: ${JSON.stringify(violations[0])}`
    );
  }
}
