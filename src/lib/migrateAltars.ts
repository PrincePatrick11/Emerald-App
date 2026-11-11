import type Database from './sqlite';
import type { Statement } from './sync/apply';
import { saveImage } from './images';
import { backupDatabaseFile } from './dbRebuild';
import { ALTAR_CATEGORY_ID } from './schema';
import { ALTAR_TABLE_DDL } from './schemaV48';
import {
  contentWithAltarsAsOperations, convertAltars, definitionElementsWithAltarsAsOperations,
  type ConvertedAltars, type Row,
} from './altarConversion';

/**
 * Migration v62 — the altars become operations of the "Altars" category,
 * their library items pictures of "Images" (`altarConversion.ts`).
 *
 * A copy of the database is made first (`.pre-v62.bak`). Everything is
 * written in one transaction: the operations and pictures, every link to an
 * altar turned into one to its operation (chips in entries and templates,
 * altar fields in contents and custom blocks, task links), and the altar
 * tables emptied; v63 drops them (`dropAltarTables`).
 * A picture that cannot be stored is left out with a warning rather than
 * keeping the vault from opening; the copy still holds it.
 *
 * Repeatable: with no altar and no item left there is nothing to do.
 */
export async function altarsToOperations(db: Database): Promise<void> {
  await convertAltarsInPlace(db, () => backupDatabaseFile(db, 'v62'));
}

/**
 * Migration v63: the altar tables go. Rows an older device synced into them
 * since v62 are converted first (with a copy of the file before, as v62).
 */
export async function dropAltarTables(db: Database): Promise<void> {
  await convertAltarsInPlace(db, () => backupDatabaseFile(db, 'v63'));
  await removeAltarTables(db);
  // A synced vault logged v62 emptying the tables. Every device converts its
  // own altars the same way, and none knows these tables any more: the
  // entries would only be refused (`SYNC_UNKNOWN_SHAPE`).
  const [log] = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='_sync_log'");
  if (log?.n) await db.execute("DELETE FROM _sync_log WHERE tbl IN ('altars', 'altar_items', 'altar_placements')");
}

/** Drops the altar tables, children first: the placements point at both others. */
export async function removeAltarTables(db: Database): Promise<void> {
  for (const table of ['altar_placements', 'altar_items', 'altars']) await db.execute(`DROP TABLE IF EXISTS ${table}`);
}

/** The altar tables, for an import that brings altars into its staging copy (`dropAltarTables` takes them out again). */
export async function createAltarTables(db: Database): Promise<void> {
  for (const ddl of Object.values(ALTAR_TABLE_DDL)) await db.execute(ddl.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
}

/**
 * The same for altars an import has just written into its working copy (a
 * backup from before, `dbBackup.ts`): converted where they landed, before anything sees them.
 */
export async function convertAltarsInPlace(
  db: Database,
  before?: () => Promise<unknown>,
  { replace = false }: { replace?: boolean } = {},
): Promise<void> {
  const tables = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('altars', 'altar_items', 'altar_placements')",
  );
  if (tables.length < 3) return;
  const altars = await db.select<Row[]>('SELECT * FROM altars');
  const items = await db.select<Row[]>('SELECT * FROM altar_items');
  if (!altars.length && !items.length) return;
  const placements = await db.select<Row[]>('SELECT * FROM altar_placements');

  await before?.();
  const converted = await convertAltars({ altars, items, placements }, async (dataUrl) => {
    try {
      return await saveImage(dataUrl);
    } catch (e) {
      console.warn('[db] v62: a picture of an altar item could not be stored and is left out:', e);
      return null;
    }
  });
  await db.batch(await altarStatements(db, converted, replace));
}

/**
 * The writes that put converted altars into the vault and point every link
 * at them. An operation already there stays, unless `replace` (a replace
 * import, whose file's version wins).
 */
export async function altarStatements(db: Database, converted: ConvertedAltars, replace = false): Promise<Statement[]> {
  const statements = await altarInserts(db, converted, replace);
  for (const table of ['entries', 'templates'] as const) {
    const rows = await db.select<{ id: string; content: string }[]>(
      `SELECT id, content FROM ${table} WHERE content LIKE '%altar%'`,
    );
    for (const row of rows) {
      const content = contentWithAltarsAsOperations(row.content);
      if (content !== row.content) statements.push([`UPDATE ${table} SET content=$1 WHERE id=$2`, [content, row.id]]);
    }
  }
  const definitions = await db.select<{ id: string; elements: string }[]>(
    "SELECT id, elements FROM block_definitions WHERE elements LIKE '%altar%'",
  );
  for (const row of definitions) {
    const elements = definitionElementsWithAltarsAsOperations(row.elements);
    if (elements !== row.elements) statements.push(['UPDATE block_definitions SET elements=$1 WHERE id=$2', [elements, row.id]]);
  }
  // Same ID, other type; a link the task already has to the operation stays alone.
  statements.push([
    `UPDATE OR IGNORE task_links SET target_type='operation' WHERE target_type='altar'`,
  ]);
  statements.push(["DELETE FROM task_links WHERE target_type='altar'"]);

  statements.push(['DELETE FROM altar_placements'], ['DELETE FROM altar_items'], ['DELETE FROM altars']);
  return statements;
}

/** Only the converted rows: the operations, numbered on from the last, and the pictures. */
export async function altarInserts(db: Database, converted: ConvertedAltars, replace = false): Promise<Statement[]> {
  const statements: Statement[] = [];
  const [next] = await db.select<{ n: number }[]>(
    "SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM entries WHERE type = 'operation'",
  );
  let number = next?.n ?? 1;
  for (const op of converted.operations) {
    statements.push([
      `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO entries (id, type, title, content, category_id, entry_number, icon, cover_image, tags, created_at, updated_at, deleted_at)
       VALUES ($1, 'operation', $2, $3, $4, $5, $6, NULL, '[]', $7, $8, $9)`,
      [op.id, op.title, op.content, ALTAR_CATEGORY_ID, number++, op.icon, op.created_at, op.updated_at, op.deleted_at],
    ]);
  }
  for (const image of converted.images) {
    // A file already in "Images" keeps its details.
    statements.push([
      `INSERT OR IGNORE INTO images (id, file, name, note, tags, detached, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, '[]', '[]', $5, $6, $7)`,
      [image.id, image.file, image.name, image.note, image.created_at, image.updated_at, image.deleted_at],
    ]);
  }
  return statements;
}
