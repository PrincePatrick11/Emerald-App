import type Database from './sqlite';
import { fromRow, type DbRow } from './row';
import { definitionToRow, type BlockDefinition } from './blocks/definitions';

/**
 * The accesses to `block_definitions` that the store, migrations and imports
 * share. Here instead of in the store, because migrations and `lib/` modules
 * must not import a store.
 */

/** The next free slot at the end of the list — also behind definitions in the trash. */
export async function nextDefinitionSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM block_definitions');
  return rows[0]?.n ?? 0;
}

export async function insertDefinitionRow(db: Database, def: BlockDefinition): Promise<void> {
  const row = definitionToRow(def);
  await db.execute(
    `INSERT INTO block_definitions
       (id, name, icon, elements, display, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.id, row.name, row.icon, row.elements, row.display, row.sort_order,
      row.created_at, row.updated_at, row.deleted_at,
    ]
  );
}

/** One definition by ID — from the trash too, unlike the store, which holds only the active ones. */
export async function definitionById(db: Database, id: string): Promise<BlockDefinition | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM block_definitions WHERE id=$1', [id]);
  return row ? fromRow.blockDefinition(row) : undefined;
}
