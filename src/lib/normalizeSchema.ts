/**
 * Migration v33 — der Rebuild, der bestehende Datenbanken auf das Schema aus
 * `schema.ts` bringt.
 *
 * Warum das nicht die übliche 12-Schritt-Prozedur aus der SQLite-Doku ist:
 * `tauri-plugin-sql` fährt einen sqlx-Connection-Pool (`Pool::connect`,
 * Default 10 Verbindungen). `PRAGMA foreign_keys = OFF` und `BEGIN` treffen
 * jeweils nur *eine* Verbindung, und welche die nächste Anweisung bedient, ist
 * nicht steuerbar. Beides ist hier also nicht verlässlich verfügbar.
 *
 * Der Ablauf ist deshalb so gebaut, dass Foreign Keys durchgehend aktiv bleiben
 * dürfen:
 *
 *   1. Reste eines abgebrochenen Laufs zurückrollen
 *   2. Datei-Snapshot ziehen (VACUUM INTO)
 *   3. Altlasten reparieren, solange noch das alte Schema steht
 *   4. Alte Tabellen auf `*_old` umbenennen  — zu diesem Zeitpunkt hat noch
 *      keine Tabelle einen Foreign Key, ein RENAME kann also keine Referenz
 *      verbiegen
 *   5. Neue Tabellen unter den endgültigen Namen anlegen
 *   6. Daten Eltern-vor-Kindern kopieren
 *   7. `*_old` löschen — nichts verweist darauf, also keine FK-Verletzung
 *   8. Indizes anlegen (erst jetzt, vorher wären die Namen belegt)
 *   9. `PRAGMA foreign_key_check`
 *
 * Bricht der Lauf zwischen 4 und 7 ab, liegen `*_old`-Tabellen herum und v33
 * ist nicht gestempelt. Schritt 1 stellt beim nächsten Start den Ausgangszustand
 * wieder her und der Rebuild läuft erneut.
 *
 * Bricht er zwischen 7 und 9 ab, ist der Rebuild inhaltlich fertig, aber immer
 * noch ungestempelt. `alreadyRebuilt` erkennt das und überspringt den Teil, der
 * das alte Schema voraussetzt — ohne diese Prüfung liefe `repairLegacyDamage`
 * gegen die bereits umbenannte Spalte und der Vault ließe sich nie wieder
 * öffnen.
 */
import type Database from '@tauri-apps/plugin-sql';
import { appDataDir } from '@tauri-apps/api/path';
import { getActiveDbName } from './vaultManager';
import { TABLES, TABLE_DDL, INDEX_DDL, FALLBACK_CATEGORY } from './schema';

/** `schema_version` überlebt den Rebuild — dort steht, was gerade läuft. */
const REBUILT = TABLES.filter((t) => t !== 'schema_version');

/** Tabellen, die v33 ersatzlos entfernt. */
const DROPPED = ['creations', 'altar_intentions'] as const;

async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=$1",
    [name]
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function columnNames(db: Database, table: string): Promise<Set<string>> {
  const rows = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

/**
 * Stellt den Zustand vor einem abgebrochenen Rebuild wieder her: die halbfertige
 * neue Tabelle fliegt raus, `*_old` bekommt seinen Namen zurück.
 */
async function rollbackPartialRebuild(db: Database): Promise<void> {
  for (const table of REBUILT) {
    if (!(await tableExists(db, `${table}_old`))) continue;
    console.warn(`[db] v33: Reste eines abgebrochenen Laufs für ${table} werden zurückgerollt`);
    if (await tableExists(db, table)) {
      await db.execute(`DROP TABLE ${table}`);
    }
    await db.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
  }
}

/**
 * Vollständige Kopie der Datenbankdatei, bevor irgendetwas angefasst wird.
 *
 * `VACUUM INTO` statt eines Datei-Kopierens über Rust: Die App hat nur
 * `read_file`/`write_file` auf String-Basis, was eine Binärdatei zerstören
 * würde. VACUUM INTO ist eine einzelne SQL-Anweisung und schreibt einen
 * konsistenten Snapshot.
 *
 * Der Zielname ist bewusst fest und trägt keinen Zeitstempel. Scheitert v33,
 * läuft es beim nächsten Start erneut — mit einem eindeutigen Namen entstünde
 * bei jedem Versuch eine weitere Vollkopie, und da Emerald Bilder als base64 in
 * der Datenbank ablegt, sind die groß. `VACUUM INTO` weigert sich, eine
 * vorhandene Datei zu überschreiben, und genau das dient hier als Erkennung:
 * Liegt der Snapshot schon, ist er von einem früheren Versuch und gültig, denn
 * am Datenbestand hat sich seither nichts geändert.
 *
 * Jeder andere Fehler bricht die Migration ab. Das ist Absicht: Die Datenbank
 * ist dann noch unberührt und v33 ungestempelt. Einen irreversiblen Rebuild
 * ohne Rückfahrkarte zu starten wäre die schlechtere Wahl.
 */
async function backupDatabaseFile(db: Database): Promise<string> {
  const dbName = await getActiveDbName();
  const dir = await appDataDir();
  const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
  const target = `${dir}${sep}${dbName}.pre-v33.bak`;
  try {
    await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/output file already exists/i.test(msg)) throw err;
    console.info(`[db] v33: Sicherung eines früheren Versuchs liegt bereits unter ${target}`);
    return target;
  }
  console.info(`[db] v33: Sicherung angelegt unter ${target}`);
  return target;
}

/**
 * Bringt die alten Tabellen in einen Zustand, den das neue Schema akzeptiert.
 * Läuft noch vor dem Umbenennen, also gegen das alte Schema.
 */
async function repairLegacyDamage(db: Database): Promise<void> {
  // --- Kategorien, auf die Inhalte zeigen, die es aber nicht mehr gibt -------
  // Entstanden durch den 30-Tage-Purge und `emptyTrash`, die Kategorien hart
  // gelöscht haben, ohne ihre Inhalte anzufassen. Der neue RESTRICT-Foreign-Key
  // würde den Rebuild sonst blockieren.
  for (const [table, target] of [
    ['operations', 'operation_categories'],
    ['tasks', 'task_categories'],
  ] as const) {
    await db.execute(
      `UPDATE ${table} SET category_id = $1
        WHERE category_id IS NULL
           OR category_id NOT IN (SELECT id FROM ${target})`,
      [FALLBACK_CATEGORY[table]]
    );
  }
  await db.execute(
    `UPDATE wiki_articles SET category = $1
      WHERE category IS NULL
         OR category NOT IN (SELECT id FROM wiki_categories)`,
    [FALLBACK_CATEGORY.wiki_articles]
  );

  // Die Fallback-Kategorien müssen existieren, sonst greift der Foreign Key
  // gleich wieder daneben. Auf sehr alten Vaults kann das Seeding gefehlt haben.
  await db.execute(
    `INSERT OR IGNORE INTO operation_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('sigils', 'Sigils', '🔯', 0, 1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO operation_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('other', 'Other', '📦', 2, 1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('other', 'Other', '📄', 11, 1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO task_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('general', 'Allgemein', '📋', 0, 0)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO altar_categories (id, name, emoji, created_at)
     VALUES ('other', 'Other', '📦', $1)`,
    [new Date().toISOString()]
  );

  // --- creations nach operations überführen ---------------------------------
  // Legacy-Tabelle, Vorgänger von operations. Kein Store schreibt sie mehr, und
  // das Backup hat sie nie exportiert — ihre Zeilen gingen bei jedem Restore
  // still verloren. Statt sie zu droppen, bekommen sie hier ein Zuhause.
  if (await tableExists(db, 'creations')) {
    await db.execute(`
      INSERT OR IGNORE INTO operations (
        id, title, content, category_id, description, target_reveal_date,
        charging_technique_wiki_id, is_loaded, intention_text, letter_bank,
        implemented_letters, show_intention_in_properties,
        show_letter_bank_in_properties, show_sigil, drawing_data, thumbnail_data,
        created_at, updated_at, tags, deleted_at, entry_number
      )
      SELECT
        id, title, '', 'sigils', description, target_reveal_date,
        charging_technique_wiki_id, is_loaded, intention_text, letter_bank,
        implemented_letters, show_intention_in_properties,
        show_letter_bank_in_properties, show_sigil, drawing_data, thumbnail_data,
        created_at, updated_at, tags, deleted_at, entry_number
      FROM creations
    `);
  }

  // --- Altar-Platzierungen ohne Altar ---------------------------------------
  // Der eigentliche v4-Schaden: v4 brach nach dem ersten ALTER ab, `altar_id`
  // kam erst mit v30/v31 nach — als NULL für jede bestehende Zeile. Diese
  // Platzierungen sind seitdem unsichtbar, weil die App Platzierungen immer nur
  // pro Altar lädt. Der neue NOT-NULL-Foreign-Key erzwingt jetzt eine Klärung.
  const placementCols = await columnNames(db, 'altar_placements');
  if (!placementCols.has('altar_id')) {
    await db.execute('ALTER TABLE altar_placements ADD COLUMN altar_id TEXT');
  }

  const homeless = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM altar_placements
      WHERE altar_id IS NULL OR altar_id NOT IN (SELECT id FROM altars)`
  );
  if ((homeless[0]?.n ?? 0) > 0) {
    const existing = await db.select<{ id: string }[]>(
      'SELECT id FROM altars ORDER BY created_at ASC, title ASC LIMIT 1'
    );
    let target = existing[0]?.id;
    if (!target) {
      // Kein einziger Altar vorhanden: genau das Szenario, für das v4 den
      // Default-Altar anlegen wollte. Jetzt wird es nachgeholt — die alten
      // Platzierungen werden damit wieder sichtbar.
      target = crypto.randomUUID();
      const legacyIntention = (await tableExists(db, 'altar_intentions'))
        ? await db.select<{ text: string }[]>(
            'SELECT text FROM altar_intentions ORDER BY date DESC LIMIT 1'
          )
        : [];
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO altars (id, title, intention, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [target, 'Primary Altar', legacyIntention[0]?.text ?? '', now]
      );
      console.info('[db] v33: Default-Altar nachgeholt, den Migration v4 nie angelegt hat');
    }
    await db.execute(
      `UPDATE altar_placements SET altar_id = $1
        WHERE altar_id IS NULL OR altar_id NOT IN (SELECT id FROM altars)`,
      [target]
    );
  }

  // Platzierungen, deren Item verschwunden ist, sind nicht darstellbar.
  await db.execute(
    'DELETE FROM altar_placements WHERE item_id NOT IN (SELECT id FROM altar_items)'
  );

  // --- Waisen in den Link-Tabellen ------------------------------------------
  await db.execute(
    'DELETE FROM task_links WHERE task_id NOT IN (SELECT id FROM tasks)'
  );
  // Das neue UNIQUE(task_id, target_id, target_type) verträgt keine Dubletten.
  await db.execute(
    `DELETE FROM task_links WHERE rowid NOT IN (
       SELECT MIN(rowid) FROM task_links GROUP BY task_id, target_id, target_type
     )`
  );

  // --- Laufende Nummern nachtragen ------------------------------------------
  // Migration v9 hat `entry_number` einmalig aus der ROWID befuellt, aber kein
  // INSERT hat die Spalte je geschrieben. Sichtbar war trotzdem immer eine
  // Nummer, weil die Stores beim Lesen `ROWID as entry_number` darübergelegt
  // haben. Dieser Alias ist weg — ohne Backfill verlieren alle seit v9
  // angelegten Eintraege ihre angezeigte Nummer.
  for (const table of ['journal_entries', 'wiki_articles', 'operations'] as const) {
    await db.execute(
      `UPDATE ${table} SET entry_number = ROWID WHERE entry_number IS NULL`
    );
  }

  // --- Lose Enden -----------------------------------------------------------
  await db.execute(
    'UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id NOT IN (SELECT id FROM tasks)'
  );
  await db.execute(
    `UPDATE journal_entries
        SET linked_operation_ids = COALESCE(linked_operation_ids, '[]'),
            linked_wiki_ids      = COALESCE(linked_wiki_ids, '[]')`
  );
}

async function renameOldTables(db: Database): Promise<void> {
  for (const table of REBUILT) {
    if (await tableExists(db, table)) {
      await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_old`);
    }
  }
}

async function createNewTables(db: Database): Promise<void> {
  for (const table of REBUILT) {
    await db.execute(TABLE_DDL[table]);
  }
}

/**
 * Kopiert eine Tabelle spaltenweise. Spalten, die es in der alten Tabelle nicht
 * gibt, werden ausgelassen — dann greift der Default aus dem neuen DDL. Das
 * macht den Rebuild robust gegen Vaults, in denen einzelne Migrationen nie
 * durchgelaufen sind, und davon gibt es in diesem Projekt nachweislich welche.
 */
async function copyTable(
  db: Database,
  table: string,
  overrides: Record<string, string> = {}
): Promise<void> {
  const from = `${table}_old`;
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

async function copyData(db: Database): Promise<void> {
  // Reihenfolge folgt TABLES: Eltern vor Kindern, weil Foreign Keys aktiv sind.
  for (const table of REBUILT) {
    switch (table) {
      case 'wiki_articles':
        await copyTable(db, table, { category_id: 'o.category' });
        break;

      case 'altar_items':
        // Die alte Spalte hielt den Kategorie-*Namen*. Erst per ID versuchen —
        // falls doch schon eine ID drinsteht — dann per Name, sonst 'other'.
        await copyTable(db, table, {
          category_id: `COALESCE(
            (SELECT c.id FROM altar_categories c WHERE c.id = o.category),
            (SELECT c.id FROM altar_categories c WHERE c.name = o.category),
            'other'
          )`,
        });
        break;

      case 'journal_entries':
        await copyTable(db, table, {
          linked_operation_ids: "COALESCE(o.linked_operation_ids, '[]')",
          linked_wiki_ids: "COALESCE(o.linked_wiki_ids, '[]')",
        });
        break;

      default:
        await copyTable(db, table);
    }
  }
}

async function dropOldTables(db: Database): Promise<void> {
  for (const table of REBUILT) {
    await db.execute(`DROP TABLE IF EXISTS ${table}_old`);
  }
  for (const table of DROPPED) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }
}

async function createIndexes(db: Database): Promise<void> {
  for (const sql of INDEX_DDL) {
    // IF NOT EXISTS, damit der Nachhol-Pfad in `alreadyRebuilt` nicht an
    // bereits angelegten Indizes scheitert.
    await db.execute(sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '));
  }
}

async function assertForeignKeysIntact(db: Database): Promise<void> {
  const violations = await db.select<unknown[]>('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(
      `[db] v33: ${violations.length} Foreign-Key-Verletzung(en) nach dem Rebuild. ` +
        `Erste: ${JSON.stringify(violations[0])}`
    );
  }
}

/**
 * Sind die Tabellen schon neu gebaut? Dann wurde v33 nur nicht mehr gestempelt,
 * etwa weil der Prozess zwischen `dropOldTables` und dem Stempeln endete.
 */
async function alreadyRebuilt(db: Database): Promise<boolean> {
  for (const table of REBUILT) {
    if (await tableExists(db, `${table}_old`)) return false;
  }
  return (await columnNames(db, 'wiki_articles')).has('category_id');
}

export async function normalizeSchema(db: Database): Promise<void> {
  await rollbackPartialRebuild(db);

  if (await alreadyRebuilt(db)) {
    console.info('[db] v33: Rebuild lag bereits vor, nur Indizes und Prüfung werden nachgeholt');
    await createIndexes(db);
    await assertForeignKeysIntact(db);
    return;
  }

  await backupDatabaseFile(db);
  await repairLegacyDamage(db);
  await renameOldTables(db);
  await createNewTables(db);
  await copyData(db);
  await dropOldTables(db);
  await createIndexes(db);
  await assertForeignKeysIntact(db);
}
