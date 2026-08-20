/**
 * Emeralds Schema an einer Stelle.
 *
 * Zwei Verbraucher teilen sich dieses DDL, und das ist der Sinn der Datei:
 *
 *   1. Der Baseline-Pfad in `db.ts` — frische Vaults führen es direkt aus.
 *   2. Migration v33 `normalize_schema` — bestehende Vaults bauen ihre Tabellen
 *      damit neu.
 *
 * Weil beide dieselben Strings benutzen, können sie nicht auseinanderlaufen.
 * Ohne diese Kopplung produziert ein Baseline-Squash erfahrungsgemäß nach ein
 * paar Releases zwei verschiedene Schemata, und niemand merkt es.
 *
 * Wer eine Spalte ändern will, ändert sie hier — und schreibt zusätzlich eine
 * neue Migration ab v34, die dasselbe für bestehende Datenbanken tut.
 */
import type Database from '@tauri-apps/plugin-sql';

/**
 * Muss der höchsten Version in MIGRATIONS entsprechen. `db.ts` prüft das beim
 * Start, damit ein neuer Migrationsschritt nicht vergessen werden kann.
 */
export const BASELINE_VERSION = 34;

/**
 * Tabellen in Abhängigkeitsreihenfolge: Eltern vor Kindern.
 *
 * Diese Reihenfolge ist nicht kosmetisch. Foreign Keys sind in dieser App
 * dauerhaft aktiv — sqlx setzt `foreign_keys = ON` als Default-Pragma auf jeder
 * Pool-Verbindung — und ein INSERT prüft sofort, ob die Elternzeile existiert.
 * Wer hier umsortiert, bricht Migration v33 und den Backup-Import.
 *
 * `schema_version` steht bewusst vorne und wird von v33 nie neu gebaut: dort
 * steht der Migrationsstand, den der Rebuild gerade abarbeitet.
 */
export const TABLES = [
  'schema_version',
  'tags',
  'links',
  'routines',
  'wiki_categories',
  'operation_categories',
  'task_categories',
  'altar_categories',
  'altars',
  'journal_entries',
  'wiki_articles',
  'operations',
  'altar_items',
  'tasks',
  'altar_placements',
  'task_links',
] as const;

export type TableName = (typeof TABLES)[number];

/** Tabellen mit Soft-Delete. Ihre `deleted_at`-Spalte ist indiziert. */
export const SOFT_DELETE_TABLES = [
  'journal_entries',
  'wiki_articles',
  'tags',
  'operations',
  'wiki_categories',
  'operation_categories',
  'tasks',
  'task_categories',
] as const;

export const TABLE_DDL: Record<TableName, string> = {
  schema_version: `
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,

  tags: `
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#8347ff',
      affected_ids TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT
    )`,

  // source_id/target_id sind polymorph — sie zeigen je nach *_type auf
  // journal_entries, wiki_articles oder operations. Ein Foreign Key ist hier
  // nicht deklarierbar; checkIntegrity() prüft die Beziehung stattdessen.
  links: `
    CREATE TABLE links (
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    )`,

  routines: `
    CREATE TABLE routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📋',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      operation_ids TEXT NOT NULL DEFAULT '[]',
      wiki_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

  wiki_categories: `
    CREATE TABLE wiki_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📄',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    )`,

  operation_categories: `
    CREATE TABLE operation_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '⚡',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    )`,

  task_categories: `
    CREATE TABLE task_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📋',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    )`,

  altar_categories: `
    CREATE TABLE altar_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '✨',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,

  altars: `
    CREATE TABLE altars (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Altar',
      intention TEXT NOT NULL DEFAULT '',
      background_preset TEXT NOT NULL DEFAULT 'midnight',
      background_image_data TEXT,
      background_overlay REAL NOT NULL DEFAULT 0.2,
      background_overlay_color TEXT NOT NULL DEFAULT 'dark',
      grid_enabled INTEGER NOT NULL DEFAULT 0,
      grid_size REAL NOT NULL DEFAULT 32,
      grid_opacity REAL NOT NULL DEFAULT 0.06,
      grid_color TEXT NOT NULL DEFAULT '#dce8e2',
      snap_to_grid INTEGER NOT NULL DEFAULT 0,
      rotation_snap_enabled INTEGER NOT NULL DEFAULT 0,
      rotation_snap_angle REAL NOT NULL DEFAULT 15,
      snap_scale_to_grid INTEGER NOT NULL DEFAULT 0,
      resolution TEXT NOT NULL DEFAULT '1920x1080',
      thumbnail_data TEXT,
      icon_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

  // paradigm_id, bannung_type_wiki_id, meditation_type_wiki_id und die beiden
  // linked_*_ids-Arrays verweisen auf Wiki-Artikel bzw. Operationen, sind aber
  // optional und teils JSON — kein Foreign Key möglich, siehe checkIntegrity().
  journal_entries: `
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Entry',
      content TEXT NOT NULL DEFAULT '',
      entry_number INTEGER,
      moon_phase TEXT,
      mood TEXT,
      paradigm_id TEXT,
      linked_operation_ids TEXT NOT NULL DEFAULT '[]',
      linked_wiki_ids TEXT NOT NULL DEFAULT '[]',
      is_bannung INTEGER NOT NULL DEFAULT 0,
      bannung_type_wiki_id TEXT,
      is_meditation INTEGER NOT NULL DEFAULT 0,
      meditation_duration INTEGER,
      meditation_type_wiki_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  wiki_articles: `
    CREATE TABLE wiki_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Article',
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT 'other' REFERENCES wiki_categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      cover_image TEXT,
      icon TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  operations: `
    CREATE TABLE operations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Operation',
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL REFERENCES operation_categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT,
      cover_image TEXT,
      version TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      end_date TEXT,
      target_reveal_date TEXT,
      charging_technique_wiki_id TEXT,
      is_loaded INTEGER NOT NULL DEFAULT 0,
      intention_text TEXT NOT NULL DEFAULT '',
      letter_bank TEXT NOT NULL DEFAULT '[]',
      implemented_letters TEXT NOT NULL DEFAULT '[]',
      show_intention_in_properties INTEGER NOT NULL DEFAULT 1,
      show_letter_bank_in_properties INTEGER NOT NULL DEFAULT 1,
      show_sigil INTEGER NOT NULL DEFAULT 1,
      drawing_data TEXT,
      thumbnail_data TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // category_id hielt bis v33 den Kategorie-*Namen* statt der ID — die einzige
  // namensbasierte Referenz im ganzen Schema. Deshalb musste v23 ein Rename
  // über zwei Tabellen kaskadieren.
  altar_items: `
    CREATE TABLE altar_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '✨',
      category_id TEXT NOT NULL DEFAULT 'other' REFERENCES altar_categories(id) ON DELETE RESTRICT,
      note TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_at TEXT NOT NULL
    )`,

  tasks: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Task',
      description TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL REFERENCES task_categories(id) ON DELETE RESTRICT,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  altar_placements: `
    CREATE TABLE altar_placements (
      id TEXT PRIMARY KEY,
      altar_id TEXT NOT NULL REFERENCES altars(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES altar_items(id) ON DELETE CASCADE,
      x REAL NOT NULL DEFAULT 50,
      y REAL NOT NULL DEFAULT 50,
      z_index INTEGER NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 8,
      height REAL NOT NULL DEFAULT 8,
      rotation REAL NOT NULL DEFAULT 0,
      opacity REAL NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    )`,

  // target_id ist polymorph wie bei `links` — kein Foreign Key möglich.
  task_links: `
    CREATE TABLE task_links (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      UNIQUE (task_id, target_id, target_type)
    )`,
};

/**
 * Indizes auf jeder Foreign-Key-Spalte, auf beiden Seiten der Link-Tabellen und
 * auf jeder `deleted_at`-Spalte. Letztere, weil `runPeriodicCleanup` bei jedem
 * Öffnen eines Vaults einen Bereichsscan über alle Soft-Delete-Tabellen fährt.
 */
export const INDEX_DDL: string[] = [
  'CREATE INDEX idx_links_source ON links(source_id)',
  'CREATE INDEX idx_links_target ON links(target_id)',
  'CREATE INDEX idx_task_links_task ON task_links(task_id)',
  'CREATE INDEX idx_task_links_target ON task_links(target_id)',
  'CREATE INDEX idx_wiki_articles_category ON wiki_articles(category_id)',
  'CREATE INDEX idx_operations_category ON operations(category_id)',
  'CREATE INDEX idx_tasks_category ON tasks(category_id)',
  'CREATE INDEX idx_tasks_parent ON tasks(parent_task_id)',
  'CREATE INDEX idx_altar_items_category ON altar_items(category_id)',
  'CREATE INDEX idx_altar_placements_altar ON altar_placements(altar_id)',
  'CREATE INDEX idx_altar_placements_item ON altar_placements(item_id)',
  ...SOFT_DELETE_TABLES.map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
];

/**
 * Eingebaute Kategorien, wie sie die Migrationskette v7/v12/v17/v22 erzeugt.
 * Der Baseline-Pfad muss dasselbe Ergebnis liefern, sonst sehen frische Vaults
 * anders aus als migrierte.
 *
 * Die `sort_order` der Altar-Kategorien folgt dem, was v28 rückwirkend vergibt:
 * alphabetisch nach Name, weil alle acht denselben `created_at` bekommen.
 */
export const BUILTIN_OPERATION_CATEGORIES: [string, string, string, number][] = [
  ['sigils', 'Sigils', '🔯', 0],
  ['servitors', 'Servitors', '👁️', 1],
  // Ziel für Operationen, deren eigene Kategorie gelöscht wird. Ohne diese
  // Kategorie wäre `sigils` der einzige eingebaute Kandidat gewesen — und eine
  // Operation ist nicht dadurch ein Sigill, dass ihre Kategorie verschwindet.
  ['other', 'Other', '📦', 2],
];

export const BUILTIN_WIKI_CATEGORIES: [string, string, string, number][] = [
  ['paradigm', 'Paradigma', '🌀', 0],
  ['bannung', 'Bannung', '🚫', 1],
  ['meditation', 'Meditation', '🧘', 2],
  ['sigil_charging', 'Sigil Charging', '⚡', 3],
  ['ritual', 'Ritual', '🕯️', 4],
  ['deity', 'Deity', '✨', 5],
  ['herb', 'Herb', '🌿', 6],
  ['symbol', 'Symbol', '🔮', 7],
  ['tool', 'Tool', '⚗️', 8],
  ['concept', 'Concept', '📖', 9],
  ['spell', 'Spell', '🌙', 10],
  ['other', 'Other', '📄', 11],
];

export const BUILTIN_ALTAR_CATEGORIES: [string, string, string, number][] = [
  ['candle', 'Candle', '🕯️', 0],
  ['crystal', 'Crystal', '🔮', 1],
  ['deity', 'Deity', '✨', 2],
  ['herb', 'Herb', '🌿', 3],
  ['other', 'Other', '📦', 4],
  ['symbol', 'Symbol', '🌙', 5],
  ['table', 'Table', '🪵', 6],
  ['tool', 'Tool', '🔔', 7],
];

/**
 * Die Default-Task-Kategorie. Migration v17 legt sie mit `is_builtin = 0` an —
 * das sieht nach einem Versehen aus, ist aber der Stand jeder bestehenden
 * Datenbank, und der Baseline-Pfad muss ihn reproduzieren. Wer das ändern will,
 * braucht eine Migration ab v34 für beide Seiten.
 */
export const DEFAULT_TASK_CATEGORY: [string, string, string, number, number] = [
  'general',
  'Allgemein',
  '📋',
  0,
  0,
];

/**
 * Kategorie-IDs, auf die verwaiste Inhalte umgehängt werden, wenn ihre eigene
 * Kategorie verschwindet. Sie sind eingebaut und können nicht gelöscht werden.
 */
export const FALLBACK_CATEGORY = {
  wiki_articles: 'other',
  operations: 'other',
  tasks: 'general',
  altar_items: 'other',
} as const;

/**
 * Dasselbe DDL, aber verträglich mit einer bereits vorhandenen Tabelle.
 * Der Kettenpfad braucht das für `schema_version`, die dort schon existieren
 * kann — ohne diesen Umweg stünde das CREATE ein zweites Mal im Code, und genau
 * daran ist die Trennung von Baseline und Kette sonst gescheitert.
 */
export function ddlIfNotExists(ddl: string): string {
  return ddl.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ');
}

/** Legt Tabellen und Indizes an. Reihenfolge folgt TABLES. */
export async function createSchema(db: Database): Promise<void> {
  for (const table of TABLES) {
    await db.execute(TABLE_DDL[table]);
  }
  for (const sql of INDEX_DDL) {
    await db.execute(sql);
  }
}

/** Legt die eingebauten Kategorien an. Nur für frische Vaults. */
export async function seedBuiltins(db: Database): Promise<void> {
  for (const [id, name, emoji, sortOrder] of BUILTIN_OPERATION_CATEGORIES) {
    await db.execute(
      'INSERT INTO operation_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,1)',
      [id, name, emoji, sortOrder]
    );
  }
  for (const [id, name, emoji, sortOrder] of BUILTIN_WIKI_CATEGORIES) {
    await db.execute(
      'INSERT INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,1)',
      [id, name, emoji, sortOrder]
    );
  }
  const now = new Date().toISOString();
  for (const [id, name, emoji, sortOrder] of BUILTIN_ALTAR_CATEGORIES) {
    await db.execute(
      'INSERT INTO altar_categories (id, name, emoji, sort_order, created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, name, emoji, sortOrder, now]
    );
  }
  await db.execute(
    'INSERT INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)',
    DEFAULT_TASK_CATEGORY
  );
}

/**
 * Haengt alle Inhalte einer Kategorie auf die Default-Kategorie um und meldet,
 * wie viele es waren. **Vor** jedem endgültigen Löschen einer Kategorie
 * aufzurufen.
 *
 * Vorher hat das niemand getan: `runPeriodicCleanup` und `emptyTrash` haben
 * Kategoriezeilen hart gelöscht und die Inhalte unangetastet gelassen, die
 * damit auf eine `category_id` zeigten, zu der es keine Zeile mehr gab. Seit
 * v33 verhindert ON DELETE RESTRICT das — der Loeschversuch schlaegt fehl,
 * statt still Muell zu hinterlassen. Dieser Helfer ist die Gegenseite davon:
 * Er sorgt dafuer, dass das Löschen erlaubt ist, ohne dass ein Inhalt
 * verschwindet.
 *
 * Table name interpolated into SQL — die Schlüssel von FALLBACK_CATEGORY sind
 * literal, andere Werte sind nicht zugelassen.
 */
export async function reassignCategoryContent(
  db: Database,
  table: keyof typeof FALLBACK_CATEGORY,
  categoryId: string
): Promise<number> {
  const fallback = FALLBACK_CATEGORY[table];
  // Die Default-Kategorie selbst ist eingebaut und wird nie gelöscht.
  if (categoryId === fallback) return 0;
  const result = await db.execute(
    `UPDATE ${table} SET category_id = $1 WHERE category_id = $2`,
    [fallback, categoryId]
  );
  return result.rowsAffected ?? 0;
}

/** Eine verwaiste Referenz: Zeile `id` in `table` zeigt auf ein Ziel, das fehlt. */
export interface Orphan {
  table: string;
  column: string;
  id: string;
  missingTarget: string;
}

/**
 * Prüft die Beziehungen, für die kein Foreign Key deklarierbar ist: die
 * polymorphen Link-Tabellen und die losen ID-Spalten. Foreign Keys decken den
 * Rest ab, das prüft `PRAGMA foreign_key_check`.
 *
 * Nur für Verifikation und Diagnose gedacht, nicht für den Produktionspfad —
 * die Abfragen scannen mehrere Tabellen vollständig.
 */
export async function checkIntegrity(db: Database): Promise<Orphan[]> {
  const orphans: Orphan[] = [];

  // Polymorphe Ziele: das *_type-Feld entscheidet, welche Tabelle gemeint ist.
  const contentTables: Record<string, string> = {
    journal: 'journal_entries',
    wiki: 'wiki_articles',
    operation: 'operations',
  };

  for (const [type, target] of Object.entries(contentTables)) {
    for (const [table, column, typeColumn] of [
      ['links', 'source_id', 'source_type'],
      ['links', 'target_id', 'target_type'],
      ['task_links', 'target_id', 'target_type'],
    ] as const) {
      const rows = await db.select<{ id: string }[]>(
        `SELECT ${column} AS id FROM ${table}
          WHERE ${typeColumn} = $1
            AND ${column} NOT IN (SELECT id FROM ${target})`,
        [type]
      );
      for (const r of rows) {
        orphans.push({ table, column, id: r.id, missingTarget: target });
      }
    }
  }

  // Lose ID-Spalten ohne Foreign Key: optional, deshalb nur prüfen wenn gesetzt.
  for (const [table, column, target] of [
    ['journal_entries', 'paradigm_id', 'wiki_articles'],
    ['journal_entries', 'bannung_type_wiki_id', 'wiki_articles'],
    ['journal_entries', 'meditation_type_wiki_id', 'wiki_articles'],
    ['operations', 'charging_technique_wiki_id', 'wiki_articles'],
  ] as const) {
    const rows = await db.select<{ id: string }[]>(
      `SELECT id FROM ${table}
        WHERE ${column} IS NOT NULL
          AND ${column} NOT IN (SELECT id FROM ${target})`
    );
    for (const r of rows) {
      orphans.push({ table, column, id: r.id, missingTarget: target });
    }
  }

  // JSON-Arrays von IDs. In SQL nicht sinnvoll prüfbar, also hier auspacken.
  const idsOf = async (target: string): Promise<Set<string>> => {
    const rows = await db.select<{ id: string }[]>(`SELECT id FROM ${target}`);
    return new Set(rows.map((r) => r.id));
  };
  const targetIds: Record<string, Set<string>> = {
    operations: await idsOf('operations'),
    wiki_articles: await idsOf('wiki_articles'),
  };

  for (const [table, column, target] of [
    ['journal_entries', 'linked_operation_ids', 'operations'],
    ['journal_entries', 'linked_wiki_ids', 'wiki_articles'],
    ['routines', 'operation_ids', 'operations'],
    ['routines', 'wiki_ids', 'wiki_articles'],
  ] as const) {
    const rows = await db.select<{ id: string; value: string | null }[]>(
      `SELECT id, ${column} AS value FROM ${table}`
    );
    for (const r of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.value ?? '[]');
      } catch {
        orphans.push({ table, column, id: r.id, missingTarget: '(kein gültiges JSON)' });
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const ref of parsed) {
        if (!targetIds[target].has(String(ref))) {
          orphans.push({ table, column, id: r.id, missingTarget: `${target}.${String(ref)}` });
        }
      }
    }
  }

  return orphans;
}
