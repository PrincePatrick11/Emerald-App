/**
 * Bausteine für Migrationen, die Tabellen neu bauen — geteilt von v33
 * (`normalizeSchema.ts`) und v38 (`mergeCategoryTables.ts`).
 *
 * Warum es überhaupt einen Rebuild braucht und warum er ohne
 * `PRAGMA foreign_keys = OFF` auskommen muss, steht im Kopf von
 * `normalizeSchema.ts`.
 */
import type Database from '@tauri-apps/plugin-sql';
import { getActiveDbFile } from './vaultManager';

export async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=$1",
    [name]
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function columnNames(db: Database, table: string): Promise<Set<string>> {
  const rows = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

/** Die Tabellen, auf die Foreign Keys von `table` zeigen. */
export async function referencedTables(db: Database, table: string): Promise<Set<string>> {
  const rows = await db.select<{ table: string }[]>(`PRAGMA foreign_key_list(${table})`);
  return new Set(rows.map((r) => r.table));
}

/**
 * Vollständige Kopie der Datenbankdatei, bevor irgendetwas angefasst wird.
 *
 * `VACUUM INTO` statt eines Datei-Kopierens über Rust: Die App hat nur
 * `read_file`/`write_file` auf String-Basis, was eine Binärdatei zerstören
 * würde. VACUUM INTO ist eine einzelne SQL-Anweisung und schreibt einen
 * konsistenten Snapshot.
 *
 * Der Zielname ist bewusst fest und trägt keinen Zeitstempel. Scheitert die
 * Migration, läuft sie beim nächsten Start erneut — mit einem eindeutigen
 * Namen entstünde bei jedem Versuch eine weitere Vollkopie, und da Emerald
 * Bilder als base64 in der Datenbank ablegt, sind die groß. `VACUUM INTO`
 * weigert sich, eine vorhandene Datei zu überschreiben, und genau das dient
 * hier als Erkennung: Liegt der Snapshot schon, ist er von einem früheren
 * Versuch und gültig, denn am Datenbestand hat sich seither nichts geändert.
 *
 * Jeder andere Fehler bricht die Migration ab. Das ist Absicht: Die Datenbank
 * ist dann noch unberührt und die Migration ungestempelt. Einen irreversiblen
 * Rebuild ohne Rückfahrkarte zu starten wäre die schlechtere Wahl.
 */
export async function backupDatabaseFile(db: Database, tag: string): Promise<string> {
  // Die Sicherung liegt neben der Datenbank, im Vault-Ordner: wer den Ordner
  // kopiert, nimmt sie mit.
  const target = `${await getActiveDbFile()}.pre-${tag}.bak`;
  try {
    await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/output file already exists/i.test(msg)) throw err;
    console.info(`[db] ${tag}: Sicherung eines früheren Versuchs liegt bereits unter ${target}`);
    return target;
  }
  console.info(`[db] ${tag}: Sicherung angelegt unter ${target}`);
  return target;
}

/**
 * Kopiert `from` spaltenweise nach `table`. Spalten, die es in der alten
 * Tabelle nicht gibt, werden ausgelassen — dann greift der Default aus dem
 * neuen DDL. Das macht den Rebuild robust gegen Vaults, in denen einzelne
 * Migrationen nie durchgelaufen sind, und davon gibt es in diesem Projekt
 * nachweislich welche. `overrides` liefert SQL-Ausdrücke je Zielspalte; die
 * Quelle heißt darin `o`.
 */
export async function copyTable(
  db: Database,
  table: string,
  from: string,
  overrides: Record<string, string> = {}
): Promise<void> {
  if (!(await tableExists(db, from))) return;

  const newCols = await columnNames(db, table);
  const oldCols = await columnNames(db, from);

  const targets: string[] = [];
  const exprs: string[] = [];
  for (const col of newCols) {
    if (col in overrides) {
      targets.push(col);
      exprs.push(overrides[col]);
    } else if (oldCols.has(col)) {
      targets.push(col);
      exprs.push(`o.${col}`);
    }
  }
  if (!targets.length) return;

  await db.execute(
    `INSERT INTO ${table} (${targets.join(', ')}) SELECT ${exprs.join(', ')} FROM ${from} o`
  );
}

/** Legt Indizes an, die es noch nicht gibt — für Nachhol-Pfade nach einem Abbruch. */
export async function createIndexesIfMissing(db: Database, ddl: readonly string[]): Promise<void> {
  for (const sql of ddl) {
    await db.execute(sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '));
  }
}

export async function assertForeignKeysIntact(db: Database, tag: string): Promise<void> {
  const violations = await db.select<unknown[]>('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(
      `[db] ${tag}: ${violations.length} Foreign-Key-Verletzung(en) nach dem Rebuild. ` +
        `Erste: ${JSON.stringify(violations[0])}`
    );
  }
}
