import { CATEGORIZED_TABLES } from '../schema';
import type Database from '../sqlite';
import { jsonArray } from '../row';
import { TAGGED_TABLES } from '../tagRefs';
import { columnsOf, pendingRows, rowKey, SYNCED_TABLES, type PendingRow, type SyncChange } from './tracking';

/**
 * Applies changes from the server on top of what this device has not pushed
 * yet. The server only keeps the order: a device behind it pulls, resolves
 * here, and pushes the result as ordinary changes, so every device ends up
 * with the same rows. The rules are in `Documentation/architecture/sync.md`.
 *
 * Everything runs in one `db.batch`, since a transaction holds only there. The
 * caller keeps writers away between the reads here and that batch.
 */

type Statement = readonly [query: string, bindValues?: readonly unknown[]];
type Row = Record<string, unknown>;

export interface ApplyOptions {
  newId: () => string;
  /** The title of the copy that keeps this device's text in a conflict. */
  conflictTitle: (title: string) => string;
}

export interface ApplyResult {
  /** The copies made to keep this device's text, next to the entries they belong to. */
  conflicts: { entryId: string; copyId: string }[];
}

const APPLYING: Statement = ['UPDATE _sync_ctx SET applying = 1'];
const LOGGING: Statement = ['UPDATE _sync_ctx SET applying = 0'];

/**
 * Run last, and logged: a reference a merge left dangling (a task moved into
 * a category another device deleted) would otherwise fail the commit, and every
 * retry with it. An optional reference is cleared, a row that cannot exist
 * without its parent goes.
 */
const REFERENCE_REPAIRS: readonly Statement[] = [
  ...CATEGORIZED_TABLES.map(
    (table): Statement => [
      `UPDATE ${table} SET category_id = NULL
       WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories)`,
    ]
  ),
  ['UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id IS NOT NULL AND parent_task_id NOT IN (SELECT id FROM tasks)'],
  ['DELETE FROM task_links WHERE task_id NOT IN (SELECT id FROM tasks)'],
  ['DELETE FROM lexicon_entries WHERE language_id NOT IN (SELECT id FROM languages)'],
  ['DELETE FROM altar_placements WHERE altar_id NOT IN (SELECT id FROM altars) OR item_id NOT IN (SELECT id FROM altar_items)'],
];

function insertStatement(table: string, row: Row): Statement {
  const columns = Object.keys(row);
  const places = columns.map((_, i) => `$${i + 1}`).join(', ');
  return [`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${places})`, columns.map((c) => row[c])];
}

/** Table and column names come from decrypted data and end up in SQL. */
async function assertKnownShape(db: Database, changes: readonly SyncChange[]): Promise<void> {
  const known = new Map<string, Set<string>>();
  for (const table of SYNCED_TABLES) known.set(table, new Set(await columnsOf(db, table)));
  for (const change of changes) {
    const columns = known.get(change.table);
    if (!columns) throw new Error(`SYNC_UNKNOWN_SHAPE: table ${change.table}`);
    if (change.op === 'delete') continue;
    for (const name of [...change.changed, ...Object.keys(change.row)]) {
      if (!columns.has(name)) throw new Error(`SYNC_UNKNOWN_SHAPE: ${change.table}.${name}`);
    }
  }
}

async function loadRows(db: Database, changes: readonly SyncChange[]): Promise<Map<string, Row>> {
  const rows = new Map<string, Row>();
  const ids = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!ids.has(change.table)) ids.set(change.table, new Set());
    ids.get(change.table)!.add(change.id);
  }
  for (const [table, set] of ids) {
    const list = [...set];
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const found = await db.select<Row[]>(
        `SELECT * FROM ${table} WHERE id IN (${chunk.map((_, n) => `$${n + 1}`).join(', ')})`,
        chunk
      );
      for (const row of found) rows.set(rowKey(table, String(row.id)), row);
    }
  }
  return rows;
}

export async function applyRemoteChanges(
  db: Database,
  remote: readonly SyncChange[],
  options: ApplyOptions
): Promise<ApplyResult> {
  if (!remote.length) return { conflicts: [] };
  await assertKnownShape(db, remote);

  const pending = new Map<string, PendingRow>(
    (await pendingRows(db)).map((row) => [rowKey(row.table, row.id), row])
  );
  const rows = await loadRows(db, remote);
  const tagIdByName = new Map(
    (await db.select<{ id: string; name: string }[]>('SELECT id, name FROM tags')).map((t) => [t.name, t.id])
  );
  const taggedRows: { table: string; id: string; tags: string[] }[] = [];
  for (const table of TAGGED_TABLES) {
    const found = await db.select<{ id: string; tags: string }[]>(`SELECT id, tags FROM ${table} WHERE tags != '[]'`);
    for (const row of found) taggedRows.push({ table, id: row.id, tags: jsonArray<string>(row.tags) });
  }

  const conflicts: ApplyResult['conflicts'] = [];
  const statements: Statement[] = [['PRAGMA defer_foreign_keys = ON'], APPLYING];
  /** Statements that are this device's own decisions, so they go out as changes. */
  const logged = (...own: Statement[]) => statements.push(LOGGING, ...own, APPLYING);
  const forgetPending = (table: string, id: string) =>
    statements.push(['DELETE FROM _sync_log WHERE tbl = $1 AND pk = $2', [table, id]]);

  /** Another row holds the name: this device's tag merges into the incoming one. */
  const mergeTagNamedLike = (id: string, name: unknown) => {
    const other = typeof name === 'string' ? tagIdByName.get(name) : undefined;
    if (!other || other === id) return;
    const rewrites: Statement[] = [];
    for (const row of taggedRows) {
      if (!row.tags.includes(other)) continue;
      row.tags = [...new Set(row.tags.map((tag) => (tag === other ? id : tag)))];
      rewrites.push([`UPDATE ${row.table} SET tags = $1 WHERE id = $2`, [JSON.stringify(row.tags), row.id]]);
    }
    logged(...rewrites, ['DELETE FROM tags WHERE id = $1', [other]]);
    rows.delete(rowKey('tags', other));
    tagIdByName.delete(name as string);
  };

  /** Two devices gave out the same number: this device's entry takes the next free one. */
  const renumberOthers = (id: string, row: Row) => {
    if (row.entry_number === null || row.entry_number === undefined) return;
    logged([
      `UPDATE entries SET entry_number = (SELECT MAX(entry_number) + 1 FROM entries WHERE type = $1)
       WHERE type = $1 AND entry_number = $2 AND id <> $3`,
      [row.type, row.entry_number, id],
    ]);
  };

  for (const change of remote) {
    const key = rowKey(change.table, change.id);
    const row = rows.get(key);
    const local = pending.get(key);

    if (change.op === 'delete') {
      // Edited here, deleted there: the edit keeps the row. It goes out whole,
      // so a device that has deleted it restores it.
      if (local?.op === 'upsert' && row) {
        forgetPending(change.table, change.id);
        statements.push(['INSERT INTO _sync_log (tbl, pk, op) VALUES ($1, $2, $3)', [change.table, change.id, 'I']]);
        continue;
      }
      if (local) forgetPending(change.table, change.id);
      if (!row) continue;
      statements.push([`DELETE FROM ${change.table} WHERE id = $1`, [change.id]]);
      rows.delete(key);
      if (change.table === 'tags') tagIdByName.delete(String(row.name));
      continue;
    }

    if (change.table === 'tags') mergeTagNamedLike(change.id, change.row.name);

    if (!row) {
      // Deleted here, edited there: the edit brings the row back.
      if (local) forgetPending(change.table, change.id);
      if (change.table === 'task_links') {
        const { task_id, target_id, target_type } = change.row;
        logged([
          'DELETE FROM task_links WHERE task_id = $1 AND target_id = $2 AND target_type = $3 AND id <> $4',
          [task_id, target_id, target_type, change.id],
        ]);
      }
      statements.push(insertStatement(change.table, change.row));
      rows.set(key, { ...change.row });
      if (change.table === 'tags') tagIdByName.set(String(change.row.name), change.id);
      if (change.table === 'entries') renumberOthers(change.id, change.row);
      continue;
    }

    const localColumns =
      local?.op === 'upsert' ? new Set(local.columns ?? Object.keys(row)) : new Set<string>();
    const take: string[] = [];
    for (const column of change.changed) {
      const same = row[column] === change.row[column];
      if (!localColumns.has(column) || same) {
        if (!same) take.push(column);
        continue;
      }
      // Both sides wrote this column. Text must not get lost, so the entry takes
      // the incoming version and a new entry keeps this device's. Anywhere else
      // this device's value stands and goes out with its next push.
      if (change.table === 'entries' && column === 'content') {
        const copyId = options.newId();
        logged(
          insertStatement('entries', { ...row, id: copyId, title: options.conflictTitle(String(row.title ?? '')) }),
          [
            'UPDATE entries SET entry_number = (SELECT MAX(entry_number) + 1 FROM entries WHERE type = $1) WHERE id = $2',
            [row.type, copyId],
          ]
        );
        conflicts.push({ entryId: change.id, copyId });
        take.push(column);
      }
    }
    if (!take.length) continue;
    const sets = take.map((column, i) => `${column} = $${i + 1}`).join(', ');
    statements.push([
      `UPDATE ${change.table} SET ${sets} WHERE id = $${take.length + 1}`,
      [...take.map((column) => change.row[column]), change.id],
    ]);
    for (const column of take) row[column] = change.row[column];
    if (change.table === 'tags' && take.includes('name')) tagIdByName.set(String(change.row.name), change.id);
    if (change.table === 'entries' && (take.includes('entry_number') || take.includes('type'))) {
      renumberOthers(change.id, row);
    }
  }

  statements.push(LOGGING, ...REFERENCE_REPAIRS);
  await db.batch(statements);
  return { conflicts };
}
