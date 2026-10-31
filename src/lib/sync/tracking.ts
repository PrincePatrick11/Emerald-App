import { TABLES } from '../schema';
import type Database from '../sqlite';

/**
 * Change capture for a vault connected to a sync server: triggers note which
 * row changed and which columns, in `_sync_log`. None of the app's SQL has to
 * know, and a vault that is not connected carries neither the tables nor the
 * triggers. See `Documentation/architecture/sync.md`.
 *
 * The log holds names only. Values are read when pushing, so an entry saved
 * a hundred times between two pushes costs one upload and no log growth.
 *
 * DOM-free and without stores: it also runs in node (`scripts/sync-check.mjs`).
 */

export const SYNCED_TABLES: readonly string[] = TABLES.filter((t) => t !== 'schema_version');

/** One row's change as it travels to the other devices. */
export type SyncChange =
  | {
      table: string;
      id: string;
      op: 'upsert';
      /** The columns that changed; what a device that has the row takes. */
      changed: string[];
      /** The whole row; what a device that no longer has it restores it from. */
      row: Record<string, unknown>;
    }
  | { table: string; id: string; op: 'delete' };

/** What is waiting to be pushed for one row, its log entries folded into one. */
export interface PendingRow {
  table: string;
  id: string;
  op: 'upsert' | 'delete';
  /** The changed columns; `null` means all of them. */
  columns: string[] | null;
  /** Created since the last push: if it is gone again, no device needs to hear of it. */
  born: boolean;
  seq: number;
}

interface LogRow {
  seq: number;
  tbl: string;
  pk: string;
  op: 'I' | 'U' | 'D';
  cols: string | null;
}

export function rowKey(table: string, id: string): string {
  return `${table}\u0000${id}`;
}

export async function columnsOf(db: Database, table: string): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

export async function isTracked(db: Database): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_sync_log'"
  );
  return rows.length > 0;
}

function triggerNames(table: string): string[] {
  return ['i', 'u', 'd'].map((kind) => `_sync_${table}_${kind}`);
}

function triggerDdl(table: string, columns: readonly string[]): string[] {
  const [insert, update, remove] = triggerNames(table);
  const guard = '(SELECT applying FROM _sync_ctx) = 0';
  const differs = columns.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  const changed = columns.map((c) => `SELECT '${c}' AS k WHERE OLD.${c} IS NOT NEW.${c}`).join(' UNION ALL ');
  return [
    `CREATE TRIGGER ${insert} AFTER INSERT ON ${table} WHEN ${guard} BEGIN
       INSERT INTO _sync_log (tbl, pk, op) VALUES ('${table}', NEW.id, 'I');
     END`,
    `CREATE TRIGGER ${update} AFTER UPDATE ON ${table} WHEN ${guard} AND (${differs}) BEGIN
       INSERT INTO _sync_log (tbl, pk, op, cols)
       VALUES ('${table}', OLD.id, 'U', (SELECT json_group_array(k) FROM (${changed})));
     END`,
    `CREATE TRIGGER ${remove} AFTER DELETE ON ${table} WHEN ${guard} BEGIN
       INSERT INTO _sync_log (tbl, pk, op) VALUES ('${table}', OLD.id, 'D');
     END`,
  ];
}

/**
 * Drops the triggers. A migration needs that: `DROP COLUMN` fails while a
 * trigger names the column, and a table rebuild would drag them along.
 */
export async function dropTriggers(db: Database): Promise<void> {
  await db.batch(SYNCED_TABLES.flatMap(triggerNames).map((name) => [`DROP TRIGGER IF EXISTS ${name}`] as const));
}

/** Builds the triggers from the columns the tables have now. */
export async function installTriggers(db: Database): Promise<void> {
  await dropTriggers(db);
  const ddl: string[] = [];
  for (const table of SYNCED_TABLES) ddl.push(...triggerDdl(table, await columnsOf(db, table)));
  await db.batch(ddl.map((statement) => [statement] as const));
}

/**
 * Starts tracking a vault. What it holds so far is in no log, so it has to
 * reach the server as a snapshot first.
 */
export async function startTracking(db: Database): Promise<void> {
  await db.batch([
    [`CREATE TABLE IF NOT EXISTS _sync_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        tbl TEXT NOT NULL,
        pk TEXT NOT NULL,
        op TEXT NOT NULL,
        cols TEXT
      )`],
    ['CREATE TABLE IF NOT EXISTS _sync_ctx (applying INTEGER NOT NULL)'],
    ['CREATE TABLE IF NOT EXISTS _sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'],
    ['INSERT INTO _sync_ctx (applying) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM _sync_ctx)'],
  ]);
  await installTriggers(db);
  await markSnapshotNeeded(db);
}

export async function stopTracking(db: Database): Promise<void> {
  await dropTriggers(db);
  await db.batch([
    ['DROP TABLE IF EXISTS _sync_log'],
    ['DROP TABLE IF EXISTS _sync_ctx'],
    ['DROP TABLE IF EXISTS _sync_meta'],
  ]);
}

/**
 * The vault changed in a way a log cannot carry (a backup import, a migration):
 * the other devices start over from a snapshot, and what is logged so far is
 * part of it.
 */
export async function markSnapshotNeeded(db: Database): Promise<void> {
  await db.batch([
    ['DELETE FROM _sync_log'],
    ["INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('needs_snapshot', '1')"],
  ]);
}

export async function needsSnapshot(db: Database): Promise<boolean> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM _sync_meta WHERE key = 'needs_snapshot'");
  return rows[0]?.value === '1';
}

export async function clearSnapshotNeeded(db: Database): Promise<void> {
  await db.execute("DELETE FROM _sync_meta WHERE key = 'needs_snapshot'");
}

/** Folds the log into one entry per row, in the order of each row's last change. */
export async function pendingRows(db: Database): Promise<PendingRow[]> {
  const log = await db.select<LogRow[]>('SELECT seq, tbl, pk, op, cols FROM _sync_log ORDER BY seq');
  const rows = new Map<string, PendingRow>();
  for (const entry of log) {
    const key = rowKey(entry.tbl, entry.pk);
    const seen = rows.get(key);
    if (entry.op === 'D') {
      // Created and deleted between two pushes: nobody needs to hear of it.
      if (seen?.born) rows.delete(key);
      else rows.set(key, { table: entry.tbl, id: entry.pk, op: 'delete', columns: null, born: false, seq: entry.seq });
      continue;
    }
    if (entry.op === 'I') {
      // After a delete this is the row coming back (Undo), not a new one.
      rows.set(key, { table: entry.tbl, id: entry.pk, op: 'upsert', columns: null, born: !seen, seq: entry.seq });
      continue;
    }
    const added = JSON.parse(entry.cols ?? '[]') as string[];
    const columns = seen ? (seen.columns ? [...new Set([...seen.columns, ...added])] : null) : added;
    rows.set(key, { table: entry.tbl, id: entry.pk, op: 'upsert', columns, born: seen?.born ?? false, seq: entry.seq });
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * What to push, and the log position `acknowledge` takes once the server has
 * it. A row changed while this runs is logged after that position and goes
 * out again with the next push.
 */
export async function collectChanges(db: Database): Promise<{ changes: SyncChange[]; lastSeq: number }> {
  const seqRows = await db.select<{ seq: number | null }[]>('SELECT MAX(seq) AS seq FROM _sync_log');
  const pending = await pendingRows(db);
  const changes: SyncChange[] = [];
  for (const row of pending) {
    if (row.op === 'delete') {
      changes.push({ table: row.table, id: row.id, op: 'delete' });
      continue;
    }
    const found = await db.select<Record<string, unknown>[]>(`SELECT * FROM ${row.table} WHERE id = $1`, [row.id]);
    if (found.length) {
      changes.push({
        table: row.table,
        id: row.id,
        op: 'upsert',
        changed: row.columns ?? Object.keys(found[0]),
        row: found[0],
      });
    } else if (!row.born) {
      // Gone through a foreign key action while a remote change was applied.
      changes.push({ table: row.table, id: row.id, op: 'delete' });
    }
  }
  return { changes, lastSeq: seqRows[0]?.seq ?? 0 };
}

export async function acknowledge(db: Database, lastSeq: number): Promise<void> {
  await db.execute('DELETE FROM _sync_log WHERE seq <= $1', [lastSeq]);
}
