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

/**
 * Not synced: `schema_version`, and the block rows (`blocks`, `block_refs`),
 * which each device derives from `content` until step 3 of the block rebuild —
 * their `row_id` means nothing on another device. `sync/apply.ts` rebuilds
 * them for whatever it wrote.
 */
export const LOCAL_TABLES: readonly string[] = ['schema_version', 'blocks', 'block_refs'];

export const SYNCED_TABLES: readonly string[] = TABLES.filter((t) => !LOCAL_TABLES.includes(t));

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
/**
 * A migration: nothing is lost yet, and this device may be behind or not the first
 * to migrate. What is logged stays, and `round` decides. Does not replace a
 * snapshot already due, which has to go out as it is.
 */
export async function markMigrated(db: Database): Promise<void> {
  await db.execute("INSERT OR IGNORE INTO _sync_meta (key, value) VALUES ('needs_snapshot', 'migration')");
}

export async function wasMigrated(db: Database): Promise<boolean> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM _sync_meta WHERE key = 'needs_snapshot'");
  return rows[0]?.value === 'migration';
}

/** Tracking starts on a vault that is to be fetched: until that is done, it holds nothing to publish. */
export async function markRestoring(db: Database): Promise<void> {
  await db.batch([
    ["INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('restoring', '1')"],
    ["DELETE FROM _sync_meta WHERE key = 'needs_snapshot'"],
  ]);
}

export async function markSnapshotNeeded(db: Database): Promise<void> {
  await db.batch([
    ['DELETE FROM _sync_log'],
    ["INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('needs_snapshot', '1')"],
  ]);
}

export async function needsSnapshot(db: Database): Promise<boolean> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM _sync_meta WHERE key = 'needs_snapshot'");
  return rows.length > 0;
}

/** A restore began and has not finished: the vault holds only part of a snapshot. */
export async function isRestoring(db: Database): Promise<boolean> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM _sync_meta WHERE key = 'restoring'");
  return rows[0]?.value === '1';
}

export async function clearSnapshotNeeded(db: Database): Promise<void> {
  await db.execute("DELETE FROM _sync_meta WHERE key = 'needs_snapshot'");
}

/** This device's position on the server: `cursor` and `epoch`. */
export async function readPosition(db: Database): Promise<{ cursor: number; epoch: number }> {
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM _sync_meta WHERE key IN ('cursor', 'epoch')"
  );
  const value = (key: string) => Number(rows.find((r) => r.key === key)?.value ?? 0);
  return { cursor: value('cursor'), epoch: value('epoch') };
}

export function positionStatements(position: { cursor?: number; epoch?: number }): (readonly [string, unknown[]])[] {
  return Object.entries(position).map(
    ([key, value]) => ['INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ($1, $2)', [key, String(value)]] as const
  );
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
 *
 * `maxBytes` ends the list early, so a long time offline becomes several pushes
 * instead of one no server takes and no memory holds: `done` says whether this
 * was all. Parents go first, deletes last, since a device applying the first
 * part must find what a row points at. Tasks stay together: they can point at
 * each other, in any order.
 */
export async function collectChanges(
  db: Database,
  maxBytes = Infinity
): Promise<{ changes: SyncChange[]; lastSeq: number; done: boolean }> {
  const seqRows = await db.select<{ seq: number | null }[]>('SELECT MAX(seq) AS seq FROM _sync_log');
  const rank = (row: PendingRow) => {
    const position = SYNCED_TABLES.indexOf(row.table);
    return row.op === 'delete' ? 2 * SYNCED_TABLES.length - position : position;
  };
  const pending = (await pendingRows(db)).sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
  const changes: SyncChange[] = [];
  let bytes = 0;
  let done = true;
  for (const row of pending) {
    if (bytes >= maxBytes && row.table !== 'tasks') {
      done = false;
      break;
    }
    if (row.op === 'delete') {
      changes.push({ table: row.table, id: row.id, op: 'delete' });
      continue;
    }
    const found = await db.select<Record<string, unknown>[]>(`SELECT * FROM ${row.table} WHERE id = $1`, [row.id]);
    if (found.length) {
      if (maxBytes !== Infinity) bytes += JSON.stringify(found[0]).length;
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
  return { changes, lastSeq: seqRows[0]?.seq ?? 0, done };
}

/** The server has this part: only these rows leave the log. */
export async function acknowledgeChanges(db: Database, changes: readonly SyncChange[], lastSeq: number): Promise<void> {
  await db.execute(
    `DELETE FROM _sync_log WHERE seq <= $1 AND (tbl, pk) IN (
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each($2)
     )`,
    [lastSeq, JSON.stringify(changes.map((c) => [c.table, c.id]))]
  );
}

export async function acknowledge(db: Database, lastSeq: number): Promise<void> {
  await db.execute('DELETE FROM _sync_log WHERE seq <= $1', [lastSeq]);
}
