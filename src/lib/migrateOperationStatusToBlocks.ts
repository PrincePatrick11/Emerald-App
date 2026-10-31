import type Database from './sqlite';
import i18n from '../i18n';
import type { DbRow } from './row';
import { definitionById, insertDefinitionRow, nextDefinitionSortOrder } from './blockDefinitionRows';
import { convertLegacyStatusRows, STATUS_DEFINITION_ID } from './blocks/legacyStatus';

/**
 * Migration v41 — the status, end date and version of operations become a
 * block (see `lib/blocks/legacyStatus.ts`).
 *
 * Affected is every operation that had any of these set — inactive, an
 * end date or a version —, including those in the trash. It gets a copy of the
 * custom block "Status" at the start of its content; the definition is only
 * created if there is such an operation. The three columns stay in the
 * schema (restoring backups of older files knows them) and are
 * emptied. `updated_at` stays — the migration is not an edit.
 *
 * Resuming after an abort: a row that has already been rewritten has
 * emptied columns and drops out of the selection; an already created
 * definition (also in the trash) is reused.
 */
export async function migrateOperationStatusToBlocks(db: Database): Promise<void> {
  const rows = await db.select<DbRow[]>(
    `SELECT id, content, is_active, end_date, version FROM operations
      WHERE is_active = 0
         OR (end_date IS NOT NULL AND TRIM(end_date) != '')
         OR (version IS NOT NULL AND TRIM(version) != '')`
  );
  if (rows.length === 0) return;

  const existing = await definitionById(db, STATUS_DEFINITION_ID);
  const { rows: converted, definition } = convertLegacyStatusRows(rows, i18n.t, new Date().toISOString(), existing);
  if (definition && !existing) {
    await insertDefinitionRow(db, { ...definition, sort_order: await nextDefinitionSortOrder(db) });
  }

  // Also rows that carried only whitespace (tab, line break) — SQL's TRIM sees
  // only spaces, the converter more: they stay without a block, the columns
  // are emptied anyway.
  for (const row of converted) {
    await db.execute(
      'UPDATE operations SET content=$1, is_active=1, end_date=NULL, version=NULL WHERE id=$2',
      [typeof row.content === 'string' ? row.content : '', row.id]
    );
  }
}
