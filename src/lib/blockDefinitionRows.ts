import type Database from '@tauri-apps/plugin-sql';
import { fromRow, type DbRow } from './row';
import { definitionToRow, type BlockDefinition } from './blocks/definitions';

/**
 * Die Zugriffe auf `block_definitions`, die Store, Migrationen und Importe
 * teilen. Hier statt im Store, weil Migrationen und `lib/`-Module keinen Store
 * importieren dürfen.
 */

/** Der nächste freie Platz am Ende der Liste — auch hinter Definitionen im Papierkorb. */
export async function nextDefinitionSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM block_definitions');
  return rows[0]?.n ?? 0;
}

export async function insertDefinitionRow(db: Database, def: BlockDefinition): Promise<void> {
  const row = definitionToRow(def);
  await db.execute(
    `INSERT INTO block_definitions
       (id, name, icon, description, elements, display, revision, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.id, row.name, row.icon, row.description, row.elements, row.display, row.revision, row.sort_order,
      row.created_at, row.updated_at, row.deleted_at,
    ]
  );
}

/** Eine Definition nach ID — auch aus dem Papierkorb, anders als der Store, der nur die aktiven hält. */
export async function definitionById(db: Database, id: string): Promise<BlockDefinition | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM block_definitions WHERE id=$1', [id]);
  return row ? fromRow.blockDefinition(row) : undefined;
}
