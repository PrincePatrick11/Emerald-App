import { CATEGORIZED_TABLES } from '../schema';
import type Database from '../sqlite';
import { jsonArray } from '../row';
import { TAG_REF_TABLES } from '../tagRefs';
import { clearSavedBlocks, fillMissingBlockRows, rebuildOwnerStatements, type BlockOwner } from '../blockStore';
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

export type Statement = readonly [query: string, bindValues?: readonly unknown[]];
type Row = Record<string, unknown>;

export interface ApplyOptions {
  newId: () => string;
  /** The title of the copy that keeps this device's text in a conflict. */
  conflictTitle: (title: string) => string;
  /** Run in the same transaction, like the new log position: both or neither. */
  finally?: readonly Statement[];
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
export const REFERENCE_REPAIRS: readonly Statement[] = [
  ...CATEGORIZED_TABLES.map(
    (table): Statement => [
      `UPDATE ${table} SET category_id = NULL
       WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories)`,
    ]
  ),
  ['UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id IS NOT NULL AND parent_task_id NOT IN (SELECT id FROM tasks)'],
  ['DELETE FROM task_links WHERE task_id NOT IN (SELECT id FROM tasks)'],
  ['DELETE FROM lexicon_entries WHERE language_id NOT IN (SELECT id FROM languages)'],
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
  if (!remote.length) {
    if (options.finally?.length) await db.batch(options.finally);
    return { conflicts: [] };
  }
  await assertKnownShape(db, remote);

  const pending = new Map<string, PendingRow>(
    (await pendingRows(db)).map((row) => [rowKey(row.table, row.id), row])
  );
  const rows = await loadRows(db, remote);
  const tagIdByName = new Map(
    (await db.select<{ id: string; name: string }[]>('SELECT id, name FROM tags')).map((t) => [t.name, t.id])
  );
  const taggedRows: { table: string; id: string; tags: string[] }[] = [];
  for (const table of TAG_REF_TABLES) {
    const found = await db.select<{ id: string; tags: string }[]>(`SELECT id, tags FROM ${table} WHERE tags != '[]'`);
    for (const row of found) taggedRows.push({ table, id: row.id, tags: jsonArray<string>(row.tags) });
  }

  const conflicts: ApplyResult['conflicts'] = [];
  /** Entries and templates whose `content` this writes, with that content: their block rows are rebuilt in the same batch. */
  const rewritten = new Map<string, { owner: BlockOwner; key: string; content: string }>();
  const noteContent = (table: string, id: string, content: unknown) => {
    const kind = table === 'entries' ? 'entry' : table === 'templates' ? 'template' : null;
    if (kind) rewritten.set(rowKey(table, id), { owner: { kind, id }, key: rowKey(table, id), content: typeof content === 'string' ? content : '' });
  };
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

  // Who holds which file in "Images": a file is one picture, `images.file` is unique.
  const imageIdByFile = new Map<string, string>();
  if (remote.some((change) => change.table === 'images')) {
    const held = await db.select<{ id: string; file: string }[]>('SELECT id, file FROM images');
    for (const image of held) imageIdByFile.set(image.file, image.id);
  }

  /** Both devices took the same file into "Images": this device's row gives way to the incoming one. */
  const mergeImageOfFile = (id: string, file: unknown) => {
    if (typeof file !== 'string') return;
    const other = imageIdByFile.get(file);
    imageIdByFile.set(file, id);
    if (!other || other === id) return;
    logged(['DELETE FROM images WHERE id = $1', [other]]);
    rows.delete(rowKey('images', other));
  };

  // Who holds which number. Asking the database per row would scan the table per
  // row: `entry_number` has no index, and a long time offline is thousands of rows.
  const numberOwner = new Map<string, string>();
  const highest = new Map<string, number>();
  const noteNumber = (type: unknown, number: unknown, id: string) => {
    if (number === null || number === undefined) return;
    numberOwner.set(`${type}:${number}`, id);
    highest.set(String(type), Math.max(highest.get(String(type)) ?? 0, Number(number)));
  };
  const nextNumber = (type: unknown) => {
    const next = (highest.get(String(type)) ?? 0) + 1;
    highest.set(String(type), next);
    return next;
  };
  if (remote.some((change) => change.table === 'entries')) {
    const held = await db.select<{ id: string; type: string; entry_number: number | null }[]>('SELECT id, type, entry_number FROM entries');
    for (const row of held) noteNumber(row.type, row.entry_number, row.id);
  }

  /** Two devices gave out the same number: this device's entry takes the next free one. */
  const renumberOthers = (id: string, row: Row) => {
    if (row.entry_number === null || row.entry_number === undefined) return;
    const other = numberOwner.get(`${row.type}:${row.entry_number}`);
    if (other && other !== id) {
      const next = nextNumber(row.type);
      numberOwner.set(`${row.type}:${next}`, other);
      logged(['UPDATE entries SET entry_number = $1 WHERE id = $2', [next, other]]);
    }
    noteNumber(row.type, row.entry_number, id);
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
      if (change.table === 'images') imageIdByFile.delete(String(row.file));
      if (change.table === 'entries') numberOwner.delete(`${row.type}:${row.entry_number}`);
      continue;
    }

    if (change.table === 'tags') mergeTagNamedLike(change.id, change.row.name);

    if (change.table === 'images') mergeImageOfFile(change.id, change.row.file);

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
      noteContent(change.table, change.id, change.row.content);
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
        const number = nextNumber(row.type);
        numberOwner.set(`${row.type}:${number}`, copyId);
        logged(insertStatement('entries', {
          ...row,
          id: copyId,
          title: options.conflictTitle(String(row.title ?? '')),
          entry_number: number,
        }));
        conflicts.push({ entryId: change.id, copyId });
        noteContent('entries', copyId, row.content);
        // Keeps the copy in the block-row rebuild below, which takes only owners still in `rows`.
        rows.set(rowKey('entries', copyId), { ...row, id: copyId });
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
    if (take.includes('content')) noteContent(change.table, change.id, row.content);
    if (change.table === 'tags' && take.includes('name')) tagIdByName.set(String(change.row.name), change.id);
    if (change.table === 'entries' && (take.includes('entry_number') || take.includes('type'))) {
      renumberOthers(change.id, row);
    }
  }

  // The block rows are this device's own, derived from `content` (not synced), and go
  // into the same transaction: a crash after it must not leave rows the content has moved past.
  // Only for owners still there (a later change in this batch may have deleted one).
  const now = new Date().toISOString();
  const rebuilt = [...rewritten.values()]
    .filter(({ key }) => rows.has(key))
    .map(({ owner, content }) => rebuildOwnerStatements(owner, content, now, { hasRows: true }));
  statements.push(...rebuilt.flatMap((r) => r.statements));
  statements.push(LOGGING, ...REFERENCE_REPAIRS, ...(options.finally ?? []));
  await db.batch(statements);
  rebuilt.forEach((r) => r.commit());
  return { conflicts };
}

/** Part of one table: what one frame of a snapshot carries. */
export interface SnapshotFrame {
  table: string;
  rows: Row[];
}

/**
 * A snapshot in pieces, parents first, so that neither this device nor the one
 * restoring it has to hold a whole vault in one string. Tasks stay in one frame:
 * they point at each other.
 */
export async function* snapshotFrames(db: Database, maxBytes: number): AsyncGenerator<SnapshotFrame> {
  for (const table of SYNCED_TABLES) {
    let rows: Row[] = [];
    let bytes = 0;
    let after = '';
    for (;;) {
      const page = await db.select<Row[]>(`SELECT * FROM ${table} WHERE id > $1 ORDER BY id LIMIT 200`, [after]);
      if (!page.length) break;
      after = String(page[page.length - 1].id);
      for (const row of page) {
        bytes += JSON.stringify(row).length;
        rows.push(row);
        if (bytes >= maxBytes && table !== 'tasks') {
          yield { table, rows };
          rows = [];
          bytes = 0;
        }
      }
    }
    if (rows.length) yield { table, rows };
  }
}

/** Empties the vault for a snapshot. Until `finishRestore` it only holds part of one. */
export async function beginRestore(db: Database, keep: readonly SyncChange[] = []): Promise<void> {
  const statements: Statement[] = [['PRAGMA defer_foreign_keys = ON'], APPLYING, ['DELETE FROM _sync_log']];
  for (const table of [...SYNCED_TABLES].reverse()) statements.push([`DELETE FROM ${table}`]);
  statements.push(
    LOGGING,
    ["INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('restoring', '1')"],
    // The log is gone from here on: a crash must not take these along.
    ["INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('kept', $1)", [JSON.stringify(keep)]],
  );
  await db.batch(statements);
  // The block rows went with their owners; what was remembered as saved no longer holds.
  clearSavedBlocks();
}

/**
 * Silently, since the device that made the snapshot had these rows change while
 * it read them, and its log brings the row again: a parent read before a child
 * that points at it arrived is the one case that leaves a reference open here.
 */
const FRAME_REPAIRS: Record<string, readonly Statement[]> = {
  entries: [REFERENCE_REPAIRS[0]],
  tasks: [REFERENCE_REPAIRS[1], REFERENCE_REPAIRS[2]],
  task_links: [REFERENCE_REPAIRS[3]],
  lexicon_entries: [REFERENCE_REPAIRS[4]],
};

export async function restoreFrame(db: Database, frame: SnapshotFrame): Promise<void> {
  const changes = frame.rows.map(
    (row): SyncChange => ({ table: frame.table, id: String(row.id), op: 'upsert', changed: Object.keys(row), row })
  );
  await assertKnownShape(db, changes);
  await db.batch([
    ['PRAGMA defer_foreign_keys = ON'],
    APPLYING,
    ...frame.rows.map((row) => insertStatement(frame.table, row)),
    ...(FRAME_REPAIRS[frame.table] ?? []),
    LOGGING,
  ]);
}

/**
 * `keep` is what this device had not pushed: it goes back on top as ordinary
 * local changes, so that starting over loses none of it. A kept row that no
 * longer fits (its tag name taken meanwhile) gives way rather than block the vault.
 */
export async function finishRestore(
  db: Database,
  keep: readonly SyncChange[],
  finalStatements: readonly Statement[]
): Promise<void> {
  await assertKnownShape(db, keep);
  const statements: Statement[] = [['PRAGMA defer_foreign_keys = ON']];
  for (const change of keep) {
    if (change.op === 'delete') {
      statements.push([`DELETE FROM ${change.table} WHERE id = $1`, [change.id]]);
      continue;
    }
    const [query, values] = insertStatement(change.table, change.row);
    statements.push([query.replace('INSERT INTO', 'INSERT OR IGNORE INTO'), values]);
    // A statement of its own: `OR IGNORE` on an insert does not cover its `DO UPDATE`,
    // and a name taken in the snapshot must not throw everything else away.
    if (change.changed.length) {
      const sets = change.changed.map((column, index) => `${column} = $${index + 2}`).join(', ');
      statements.push([
        `UPDATE OR IGNORE ${change.table} SET ${sets} WHERE id = $1`,
        [change.id, ...change.changed.map((column) => change.row[column])],
      ]);
    }
  }
  statements.push(...REFERENCE_REPAIRS, ["DELETE FROM _sync_meta WHERE key IN ('restoring', 'kept')"], ...finalStatements);
  await db.batch(statements);
  // Emptying the vault took the block rows along (CASCADE): every entry and template of the
  // snapshot, and what was kept on top, gets its rows anew from its content.
  await fillMissingBlockRows(db);
}

/** A snapshot all at once: for tests, and a vault small enough not to matter. */
export async function replaceWithSnapshot(
  db: Database,
  frames: readonly SnapshotFrame[],
  keep: readonly SyncChange[],
  finalStatements: readonly Statement[]
): Promise<void> {
  await beginRestore(db);
  for (const frame of frames) await restoreFrame(db, frame);
  await finishRestore(db, keep, finalStatements);
}
