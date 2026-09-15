/**
 * Ein Backup-Import, der den Vault nie halb geändert zurücklässt.
 *
 * `doReplace` und `doMerge` schreiben über viele einzelne Anweisungen. Eine
 * Transaktion darum geht nicht: `tauri-plugin-sql` verteilt jede Anweisung auf
 * eine beliebige Verbindung seines Pools (siehe `normalizeSchema.ts`). Brach der
 * Import mittendrin ab — eine kaputte Datei, ein Absturz —, war beim Ersetzen
 * der alte Inhalt gelöscht und der neue unvollständig, beim Zusammenführen ein
 * Teil der Datei im Vault und der Rest nicht.
 *
 * Deshalb läuft der Import gegen eine Arbeitskopie:
 *
 *   1. Reste eines abgebrochenen Laufs wegräumen
 *   2. `VACUUM INTO` — die Kopie neben der Datenbank, gleiches Schema
 *   3. Import in die Kopie; der Vault bleibt unberührt
 *   4. Austausch in einem einzigen `execute`: ATTACH, BEGIN, alle Tabellen
 *      leeren und aus der Kopie füllen, COMMIT. Ein `execute` bleibt auf *einer*
 *      Verbindung (sqlx führt die Anweisungen eines Strings nacheinander aus),
 *      also ist das eine echte SQLite-Transaktion — auch gegen einen Absturz.
 *   5. Kopie löschen
 *
 * Scheitert 3, ist nur die Kopie verloren. Ein Absturz in 3 lässt sie liegen;
 * Schritt 1 des nächsten Imports räumt sie weg. Bilder schreibt der Import
 * direkt in den Vault — nach einem Abbruch liegen sie unbenutzt dort, bis die
 * Aufräum-Aktion sie findet.
 */
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { resetDbCache } from './db';
import { TABLES } from './schema';
import { getActiveImportStagingFile, getActiveVaultId, sqliteConnectionString } from './vaultManager';

/** Name, unter dem die Kopie im Austausch angehängt wird. */
const STAGING_SCHEMA = 'import_staging';

/** `schema_version` bleibt: Kopie und Vault stehen ohnehin auf demselben Stand. */
const SWAPPED = TABLES.filter((t) => t !== 'schema_version');

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function discardStaging(vaultId: string): Promise<void> {
  await invoke('discard_import_staging', { vaultId });
}

/**
 * Leert den Vault und füllt ihn aus der Kopie — in einer Transaktion.
 * Spalten explizit statt `SELECT *`: die Reihenfolge ist durch `VACUUM INTO`
 * zwar dieselbe, aber das soll nicht still vorausgesetzt sein.
 */
async function swapIn(db: Database, stagingFile: string): Promise<void> {
  const statements = [`ATTACH DATABASE ${sqlString(stagingFile)} AS ${STAGING_SCHEMA}`, 'BEGIN IMMEDIATE'];
  // Fremdschlüssel erst beim COMMIT prüfen — zwischendurch ist der Vault leer.
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
    // Bricht der String nach BEGIN ab, hängt die Verbindung mit offener
    // Transaktion und angehängter Kopie im Pool: jeder weitere Schreibzugriff
    // liefe in „database is locked". Schließen rollt zurück und löst die Kopie.
    await resetDbCache();
    throw err;
  }
}

/**
 * Führt `fill` gegen eine Kopie des aktiven Vaults aus und tauscht sie danach
 * atomar ein. `db` ist die Verbindung des aktiven Vaults.
 */
export async function importViaStaging(db: Database, fill: (staging: Database) => Promise<void>): Promise<void> {
  const vaultId = await getActiveVaultId();
  const stagingFile = await getActiveImportStagingFile();

  await discardStaging(vaultId);
  await db.execute(`VACUUM INTO ${sqlString(stagingFile)}`);

  try {
    const staging = await Database.load(sqliteConnectionString(stagingFile));
    try {
      await fill(staging);
    } finally {
      // Mit Namen: ohne schließt das Plugin *alle* Pools, auch den des Vaults.
      // Ein Fehler beim Schließen soll den des Imports nicht überdecken.
      await staging.close(staging.path).catch((err: unknown) => console.warn('[backup] Arbeitskopie nicht geschlossen:', err));
    }
    await swapIn(db, stagingFile);
  } finally {
    // Nach Erfolg nur noch Platz auf der Platte — ein Fehler hier darf den
    // Import nicht nachträglich scheitern lassen. Schritt 1 holt es nach.
    await discardStaging(vaultId).catch((err: unknown) => console.warn('[backup] Arbeitskopie bleibt liegen:', err));
  }
}
