import type Database from '@tauri-apps/plugin-sql';
import i18n from '../i18n';
import type { DbRow } from './row';
import { definitionById, insertDefinitionRow, nextDefinitionSortOrder } from './blockDefinitionRows';
import { convertLegacyStatusRows, STATUS_DEFINITION_ID } from './blocks/legacyStatus';

/**
 * Migration v41 — Status, Enddatum und Version der Operationen werden ein
 * Block (siehe `lib/blocks/legacyStatus.ts`).
 *
 * Betroffen ist jede Operation, die davon etwas gesetzt hatte — inaktiv, ein
 * Enddatum oder eine Version —, auch im Papierkorb. Sie bekommt die Kopie des
 * eigenen Blocks „Status" an den Anfang ihres Inhalts; die Definition wird nur
 * angelegt, wenn es eine solche Operation gibt. Die drei Spalten bleiben im
 * Schema (Backup-Wiederherstellung älterer Dateien kennt sie) und werden
 * geleert. Der Block enthält keine Links, die `links`-Tabelle bleibt, wie sie
 * ist; `updated_at` ebenso — die Migration ist keine Bearbeitung.
 *
 * Wiederaufnahme nach einem Abbruch: eine schon umgeschriebene Zeile hat
 * geleerte Spalten und fällt aus der Auswahl; eine schon angelegte
 * Definition (auch im Papierkorb) wird weiterbenutzt.
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

  // Auch Zeilen, die nur Leerraum (Tab, Zeilenumbruch) trugen — SQLs TRIM sieht
  // nur Leerzeichen, der Konverter mehr: sie bleiben ohne Block, die Spalten
  // werden trotzdem geleert.
  for (const row of converted) {
    await db.execute(
      'UPDATE operations SET content=$1, is_active=1, end_date=NULL, version=NULL WHERE id=$2',
      [typeof row.content === 'string' ? row.content : '', row.id]
    );
  }
}
