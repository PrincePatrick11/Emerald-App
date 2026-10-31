/**
 * A backup import that never leaves the vault half-changed.
 *
 * `doReplace` and `doMerge` write through many individual statements. A
 * transaction around them does not work: the SQL layer (`db.rs`) distributes each
 * statement to an arbitrary connection of its pool (see `normalizeSchema.ts`),
 * and `db.batch` only takes a finished list — the import builds its
 * statements from queries in between. If the
 * import aborted midway — a broken file, a crash —, then on replace
 * the old content was deleted and the new one incomplete, and on merge
 * part of the file was in the vault and the rest was not.
 *
 * That is why the import runs against a working copy:
 *
 *   1. Clear away leftovers of an aborted run
 *   2. `VACUUM INTO` — the copy next to the database, same schema
 *   3. Import into the copy; the vault stays untouched
 *   4. Swap in a single `execute`: ATTACH, BEGIN, empty all tables
 *      and fill them from the copy, COMMIT. One `execute` stays on *one*
 *      connection (sqlx runs the statements of a string one after another),
 *      so this is a real SQLite transaction — even against a crash.
 *   5. Delete the copy
 *
 * If 3 fails, only the copy is lost. A crash in 3 leaves it lying around;
 * step 1 of the next import clears it away. The import writes images
 * directly into the vault — after an abort they sit there unused until the
 * cleanup action finds them.
 */
import Database from './sqlite';
import { invoke } from '@tauri-apps/api/core';
import { resetDbCache, markDbReplaced } from './db';
import { TABLES } from './schema';
import { getActiveImportStagingFile, getActiveVaultId } from './vaultManager';

/** Name under which the copy is attached during the swap. */
const STAGING_SCHEMA = 'import_staging';

/** `schema_version` stays: copy and vault are at the same version anyway. */
const SWAPPED = TABLES.filter((t) => t !== 'schema_version');

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function discardStaging(vaultId: string): Promise<void> {
  await invoke('discard_import_staging', { vaultId });
}

/**
 * Empties the vault and fills it from the copy — in one transaction.
 * Columns are explicit instead of `SELECT *`: the order is the same thanks to
 * `VACUUM INTO`, but that should not be silently assumed.
 */
async function swapIn(db: Database, stagingFile: string): Promise<void> {
  const statements = [`ATTACH DATABASE ${sqlString(stagingFile)} AS ${STAGING_SCHEMA}`, 'BEGIN IMMEDIATE'];
  // Check foreign keys only at COMMIT — in between, the vault is empty.
  statements.push('PRAGMA defer_foreign_keys = ON');
  for (const table of [...SWAPPED].reverse()) statements.push(`DELETE FROM main.${table}`);
  for (const table of SWAPPED) {
    const columns = (await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`)).map((c) => c.name).join(', ');
    statements.push(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM ${STAGING_SCHEMA}.${table}`);
  }
  statements.push('COMMIT', `DETACH DATABASE ${STAGING_SCHEMA}`);

  try {
    await db.execute(statements.join(';\n'));
  } catch (err) {
    // If the string aborts after BEGIN, the connection stays in the pool with an open
    // transaction and the copy attached: every further write access
    // would run into "database is locked". Closing rolls back and detaches the copy.
    await resetDbCache();
    throw err;
  }
}

/**
 * Runs `fill` against a copy of the active vault and then swaps it in
 * atomically. `db` is the connection of the active vault.
 */
export async function importViaStaging(db: Database, fill: (staging: Database) => Promise<void>): Promise<void> {
  const vaultId = await getActiveVaultId();
  const stagingFile = await getActiveImportStagingFile();

  await discardStaging(vaultId);
  await db.execute(`VACUUM INTO ${sqlString(stagingFile)}`);

  try {
    const staging = await Database.load(vaultId, 'importStaging');
    try {
      await fill(staging);
    } finally {
      // An error while closing should not mask the import's own error.
      await staging.close().catch((err: unknown) => console.warn('[backup] Arbeitskopie nicht geschlossen:', err));
    }
    await swapIn(db, stagingFile);
    // Anyone currently reading across several queries now has a mixed state (`dbEpoch`).
    markDbReplaced();
  } finally {
    // After success it is just space on the disk — an error here must not
    // make the import fail retroactively. Step 1 catches up on it.
    await discardStaging(vaultId).catch((err: unknown) => console.warn('[backup] Arbeitskopie bleibt liegen:', err));
  }
}
