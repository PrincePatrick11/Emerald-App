/**
 * Migration v38 — legt `wiki_categories`, `operation_categories`,
 * `task_categories` und `altar_categories` zur einen Tabelle `categories`
 * zusammen und hängt die vier Inhaltstabellen darauf um.
 *
 * Wie v33 ein Rebuild ohne `PRAGMA foreign_keys = OFF` (warum, steht im Kopf
 * von `normalizeSchema.ts`), aber mit einer Falle, die v33 nicht hatte: Seit
 * v33 gibt es Foreign Keys, und `ALTER TABLE altar_items RENAME TO
 * altar_items_old` schreibt den Verweis in `altar_placements` auf
 * `altar_items_old` um. Würde `altar_items_old` danach gelöscht, nähme das
 * CASCADE alle Platzierungen mit. Dasselbe gilt für `tasks` ← `task_links`.
 * Deshalb werden die beiden Kind-Tabellen mit umgebaut: **Kinder zuerst**
 * umbenennen (dann zeigt `altar_placements_old` auf `altar_items_old`, und
 * beide verschwinden zusammen), Eltern zuerst kopieren, Kinder zuerst löschen.
 *
 *   1. Reste eines abgebrochenen Laufs zurückrollen
 *   2. Datei-Snapshot ziehen (VACUUM INTO)
 *   3. Die vier alten Tabellen lesen und zusammenlegen (`mergeCategoryRows`)
 *   4. `categories` anlegen und füllen, ID-Zuordnung in `_category_id_map`
 *      ablegen — eine echte Tabelle, keine TEMP-Tabelle: die wäre an eine
 *      Pool-Verbindung gebunden und für die nächste Anweisung womöglich weg
 *   5. Kinder zuerst auf `*_old` umbenennen
 *   6. Neue Tabellen aus `schema.ts` anlegen, Eltern zuerst kopieren; die
 *      `category_id` läuft dabei durch die Zuordnung
 *   7. Kinder zuerst `*_old` löschen, dann die vier alten Kategorie-Tabellen
 *      und die Zuordnung
 *   8. Indizes anlegen, `PRAGMA foreign_key_check`
 *
 * Woran man erkennt, wie weit ein abgebrochener Lauf kam: Nach Schritt 6
 * schreibt der Lauf eine Marke in `_category_id_map` — liegt sie vor, sind
 * alle sechs Tabellen kopiert und nur das Aufräumen (7–8) fehlt. Ohne Marke
 * war der Lauf mittendrin: Schritt 1 stellt den Ausgangszustand her. Die
 * Marke ist nötig, weil ein Zurückrollen nach Schritt 6 Daten kostet — ein
 * `DROP TABLE tasks` auf der fertigen Tabelle löscht per CASCADE alle Zeilen
 * aus dem ebenfalls fertigen `task_links`. Ist die Map schon weg (Abbruch
 * ganz am Ende), verrät der Foreign Key von `wiki_articles` den Stand.
 */
import type Database from '@tauri-apps/plugin-sql';
import i18n from '../i18n';
// INDEX_DDL_V38, nicht INDEX_DDL: in der Kette fehlen hier noch die Tabellen späterer Migrationen.
import { TABLE_DDL, INDEX_DDL_V38, FALLBACK_CATEGORY_ID, insertCategoryRows } from './schema';
import { mergeCategoryRows, type CategorySource } from './categoryMerge';
import { legacyDisplayName, type LegacyCategoryTable } from './categories';
import {
  assertForeignKeysIntact,
  backupDatabaseFile,
  copyTable,
  createIndexesIfMissing,
  referencedTables,
  tableExists,
} from './dbRebuild';

const LEGACY_TABLES: readonly LegacyCategoryTable[] = [
  'wiki_categories',
  'operation_categories',
  'task_categories',
  'altar_categories',
];

/** Umbenennen und Löschen: Kinder vor Eltern. */
const REBUILT_CHILDREN_FIRST = [
  'task_links',
  'altar_placements',
  'tasks',
  'altar_items',
  'operations',
  'wiki_articles',
] as const;

/** Anlegen und Kopieren: Eltern vor Kindern. */
const REBUILT_PARENTS_FIRST = [...REBUILT_CHILDREN_FIRST].reverse();

const ID_MAP_TABLE = '_category_id_map';
/** Zeile in der Map, die „alle sechs Inhaltstabellen sind kopiert" festhält. */
const CONTENT_REBUILT_MARK = { src: '_state', oldId: 'content_rebuilt' };

interface LegacyRow {
  id: string;
  name: string;
  emoji: string;
  is_builtin?: number | null;
  deleted_at?: string | null;
}

/** Sind die Inhalte fertig umgebaut? Erst die Marke, sonst der Foreign Key (Map schon gelöscht). */
async function contentRebuilt(db: Database): Promise<boolean> {
  if (await tableExists(db, ID_MAP_TABLE)) {
    const rows = await db.select<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM ${ID_MAP_TABLE} WHERE src = $1 AND old_id = $2`,
      [CONTENT_REBUILT_MARK.src, CONTENT_REBUILT_MARK.oldId]
    );
    return (rows[0]?.n ?? 0) > 0;
  }
  return (await referencedTables(db, 'wiki_articles')).has('categories');
}

async function rollbackPartialRebuild(db: Database): Promise<void> {
  let rolledBack = false;
  for (const table of REBUILT_CHILDREN_FIRST) {
    if (!(await tableExists(db, `${table}_old`))) continue;
    console.warn(`[db] v38: Reste eines abgebrochenen Laufs für ${table} werden zurückgerollt`);
    if (await tableExists(db, table)) {
      await db.execute(`DROP TABLE ${table}`);
    }
    await db.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
    rolledBack = true;
  }
  // Eine halb gefüllte `categories` von vor dem Umbenennen: billig neu zu
  // bauen, also weg damit — die Inhalte zeigen noch auf die alten Tabellen.
  if (rolledBack || !(await referencedTables(db, 'wiki_articles')).has('categories')) {
    await db.execute('DROP TABLE IF EXISTS categories');
    await db.execute(`DROP TABLE IF EXISTS ${ID_MAP_TABLE}`);
  }
}

async function buildCategories(db: Database): Promise<void> {
  const sources: CategorySource[] = [];
  for (const table of LEGACY_TABLES) {
    if (!(await tableExists(db, table))) continue;
    const rows = await db.select<LegacyRow[]>(
      `SELECT * FROM ${table} ORDER BY sort_order ASC, name ASC`
    );
    sources.push({
      table,
      rows: rows.map((r) => ({
        id: r.id,
        name: legacyDisplayName(i18n, table, r),
        emoji: r.emoji,
        deleted_at: r.deleted_at ?? null,
      })),
    });
  }

  const merged = mergeCategoryRows(sources, {
    builtinName: (id) => i18n.t(`categories.builtin.${id}`),
    log: (msg) => console.info(`[db] v38: ${msg}`),
  });

  await db.execute(TABLE_DDL.categories);
  await insertCategoryRows(db, merged.rows);

  await db.execute(
    `CREATE TABLE ${ID_MAP_TABLE} (src TEXT NOT NULL, old_id TEXT NOT NULL, new_id TEXT NOT NULL, PRIMARY KEY (src, old_id))`
  );
  for (const [key, newId] of merged.idMap) {
    const sep = key.indexOf(':');
    await db.execute(
      `INSERT INTO ${ID_MAP_TABLE} (src, old_id, new_id) VALUES ($1, $2, $3)`,
      [key.slice(0, sep), key.slice(sep + 1), newId]
    );
  }
}

async function renameOldTables(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_old`);
  }
}

/** `category_id` durch die Zuordnung, Unbekanntes aufs Sammelbecken. */
function mappedCategory(src: LegacyCategoryTable): string {
  return `COALESCE(
    (SELECT m.new_id FROM ${ID_MAP_TABLE} m WHERE m.src = '${src}' AND m.old_id = o.category_id),
    '${FALLBACK_CATEGORY_ID}'
  )`;
}

async function rebuildContentTables(db: Database): Promise<void> {
  const overrides: Partial<Record<(typeof REBUILT_PARENTS_FIRST)[number], Record<string, string>>> = {
    wiki_articles: { category_id: mappedCategory('wiki_categories') },
    operations: { category_id: mappedCategory('operation_categories') },
    altar_items: { category_id: mappedCategory('altar_categories') },
    tasks: { category_id: mappedCategory('task_categories') },
  };
  for (const table of REBUILT_PARENTS_FIRST) {
    await db.execute(TABLE_DDL[table]);
    // `tasks` samt `parent_task_id` in einem INSERT … SELECT: SQLite prüft
    // Foreign Keys am Ende der Anweisung, ein Kind darf im Ergebnis also vor
    // seinem Elternteil stehen (v33 kopiert genauso).
    await copyTable(db, table, `${table}_old`, overrides[table]);
  }
  // Ab hier darf nichts mehr zurückgerollt werden (siehe Kopf).
  await db.execute(
    `INSERT INTO ${ID_MAP_TABLE} (src, old_id, new_id) VALUES ($1, $2, '1')`,
    [CONTENT_REBUILT_MARK.src, CONTENT_REBUILT_MARK.oldId]
  );
}

async function dropOldTables(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    await db.execute(`DROP TABLE IF EXISTS ${table}_old`);
  }
  for (const table of LEGACY_TABLES) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }
  await db.execute(`DROP TABLE IF EXISTS ${ID_MAP_TABLE}`);
}

export async function mergeCategoryTables(db: Database): Promise<void> {
  if (await contentRebuilt(db)) {
    console.info('[db] v38: Rebuild lag bereits vor, nur Aufräumen und Prüfung werden nachgeholt');
    await dropOldTables(db);
    await createIndexesIfMissing(db, INDEX_DDL_V38);
    await assertForeignKeysIntact(db, 'v38');
    return;
  }

  await rollbackPartialRebuild(db);
  await backupDatabaseFile(db, 'v38');
  await buildCategories(db);
  await renameOldTables(db);
  await rebuildContentTables(db);
  await dropOldTables(db);
  await createIndexesIfMissing(db, INDEX_DDL_V38);
  await assertForeignKeysIntact(db, 'v38');
}
