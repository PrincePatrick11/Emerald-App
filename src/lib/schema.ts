/**
 * Emeralds Schema an einer Stelle.
 *
 * Der Baseline-Pfad in `db.ts` führt es für frische Vaults direkt aus; die
 * Rebuild-Migrationen v33 (`normalizeSchema.ts`, gegen die eingefrorene Kopie
 * in `schemaV37.ts`) und v38 (`mergeCategoryTables.ts`, gegen dieses DDL)
 * bringen bestehende Vaults auf denselben Stand. `scripts/schema-check.mjs`
 * beweist, dass beide Wege beim identischen Schema landen — ohne diese Prüfung
 * produziert ein Baseline-Squash erfahrungsgemäß nach ein paar Releases zwei
 * verschiedene Schemata, und niemand merkt es.
 *
 * Wer eine Spalte ändern will, ändert sie hier — und schreibt zusätzlich eine
 * neue Migration, die dasselbe für bestehende Datenbanken tut. Baut die
 * Migration eine Tabelle neu, die v33 oder v38 ebenfalls anfassen, bekommen
 * die ihren alten Stand eingefroren (siehe `schemaV37.ts`).
 */
import type Database from '@tauri-apps/plugin-sql';

/**
 * Muss der höchsten Version in MIGRATIONS entsprechen. `db.ts` prüft das beim
 * Start, damit ein neuer Migrationsschritt nicht vergessen werden kann.
 */
export const BASELINE_VERSION = 39;

/**
 * Tabellen in Abhängigkeitsreihenfolge: Eltern vor Kindern.
 *
 * Diese Reihenfolge ist nicht kosmetisch. Foreign Keys sind in dieser App
 * dauerhaft aktiv — sqlx setzt `foreign_keys = ON` als Default-Pragma auf jeder
 * Pool-Verbindung — und ein INSERT prüft sofort, ob die Elternzeile existiert.
 * Wer hier umsortiert, bricht die Rebuild-Migrationen und den Backup-Import.
 *
 * `schema_version` steht bewusst vorne und wird von keinem Rebuild neu gebaut:
 * dort steht der Migrationsstand, den der Rebuild gerade abarbeitet.
 */
export const TABLES = [
  'schema_version',
  'tags',
  'links',
  'routines',
  'categories',
  'block_definitions',
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

/**
 * Die Tabellen mit Soft-Delete bis v38 — ihre `deleted_at`-Spalte indiziert
 * `INDEX_DDL_V38`. Eine spätere Tabelle gehört NICHT hierher: v38 legt diese
 * Indizes mitten in der Kette an, wo es sie noch nicht gibt. Sie bringt ihren
 * Index selbst mit (siehe `BLOCK_DEFINITIONS_INDEX_DDL`).
 */
export const SOFT_DELETE_TABLES_V38 = [
  'journal_entries',
  'wiki_articles',
  'tags',
  'operations',
  'categories',
  'tasks',
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

  // source_id/target_id sind polymorph — Quellen sind journal_entries,
  // wiki_articles oder operations (die Module mit Editor); Ziele zusätzlich
  // tasks und altars. Ein Foreign Key ist hier nicht deklarierbar;
  // checkIntegrity() prüft die Beziehung stattdessen.
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

  // Eine Liste für Wiki, Operationen, Aufgaben und Altar-Elemente (seit v38;
  // vorher vier gleich gebaute Tabellen je Modul). Eingebaut sind nur `other`
  // — das Sammelbecken, auf das Inhalte gelöschter Kategorien umgehängt
  // werden — und `sigils`, an der der Sigil-Editor für Operationen hängt.
  // Alles andere legt der Nutzer an; Eindeutigkeit der Namen prüft der Store
  // (categoryKey), nicht die Datenbank — ein UNIQUE-Index würde das
  // Wiederherstellen aus dem Papierkorb blockieren, sobald eine aktive
  // gleichnamige Kategorie existiert.
  categories: `
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📁',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    )`,

  // Die eigenen Blöcke der Blöcke-Ansicht (seit v39). Eine Definition ist die
  // Vorlage für Kopien: ein eingefügter Block trägt Elemente und Anzeigeregeln
  // selbst im `content` und merkt sich nur Herkunft und Revision
  // (`data-block-origin`/`-rev`). Deshalb kein Fremdschlüssel und kein
  // Aufräumen beim Löschen — die Kopien kommen ohne ihre Definition aus.
  // `elements`/`display` sind JSON (lib/blocks/definitions.ts); `revision`
  // steigt mit jeder Änderung, die Kopien betrifft. Der Icon-Default ist
  // `DEFAULT_DEFINITION_ICON` — hier als Literal, damit das Schema nichts aus
  // der Blocklogik importiert.
  block_definitions: `
    CREATE TABLE block_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🧩',
      description TEXT NOT NULL DEFAULT '',
      elements TEXT NOT NULL DEFAULT '[]',
      display TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
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
      category_id TEXT NOT NULL DEFAULT 'other' REFERENCES categories(id) ON DELETE RESTRICT,
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
      category_id TEXT NOT NULL DEFAULT 'other' REFERENCES categories(id) ON DELETE RESTRICT,
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
      category_id TEXT NOT NULL DEFAULT 'other' REFERENCES categories(id) ON DELETE RESTRICT,
      note TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_at TEXT NOT NULL
    )`,

  tasks: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Task',
      description TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT 'other' REFERENCES categories(id) ON DELETE RESTRICT,
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
export const INDEX_DDL_V38: readonly string[] = [
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
  ...SOFT_DELETE_TABLES_V38.map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
];

/**
 * Der Index von `block_definitions` (v39), getrennt von `INDEX_DDL_V38`: v38
 * (`mergeCategoryTables`) legt seine Liste mitten in der Kette an, wo es die
 * Tabelle noch nicht gibt. v39 legt ihn an, frische Vaults über `INDEX_DDL`.
 */
export const BLOCK_DEFINITIONS_INDEX_DDL = 'CREATE INDEX idx_block_definitions_deleted ON block_definitions(deleted_at)';

/** Alle Indizes des aktuellen Schemas — was ein frischer Vault bekommt. */
export const INDEX_DDL: readonly string[] = [...INDEX_DDL_V38, BLOCK_DEFINITIONS_INDEX_DDL];

/**
 * Das Sammelbecken: Inhalte einer gelöschten Kategorie landen hier. Eingebaut
 * und nicht löschbar.
 */
export const FALLBACK_CATEGORY_ID = 'other';

/**
 * Die eine Kategorie mit Verhalten: Eine Operation darin ist ein Sigill und
 * öffnet den Sigil-Editor. Für Artikel, Aufgaben und Altar-Elemente ist sie
 * eine Kategorie wie jede andere.
 */
export const SIGIL_CATEGORY_ID = 'sigils';

/** [id, Name (nur Datenbank — angezeigt wird `categories.builtin.<id>`), Emoji]. */
export const BUILTIN_CATEGORIES: readonly [string, string, string][] = [
  [SIGIL_CATEGORY_ID, 'Sigils', '🔯'],
  [FALLBACK_CATEGORY_ID, 'Other', '📦'],
];

/**
 * Was ein frischer Vault außer den Builtins bekommt: normale, umbenenn- und
 * löschbare Kategorien, in der App-Sprache angelegt (`categories.starter.<key>`).
 * Die Schlüssel sind zugleich die IDs.
 */
export const STARTER_CATEGORIES: readonly [string, string][] = [
  ['paradigm', '🌀'],
  ['ritual', '🪄'],
  ['meditation', '🧘'],
  ['herbs', '🌿'],
  ['crystals', '🔮'],
  ['candles', '🕯️'],
  ['deities', '✨'],
  ['tools', '⚗️'],
];

/** Die vier Inhaltstabellen mit `category_id`. Literal, weil in SQL interpoliert. */
export const CATEGORIZED_TABLES = ['wiki_articles', 'operations', 'tasks', 'altar_items'] as const;

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

/** Eine Kategoriezeile, wie `seedBuiltins` und die Migration v38 sie schreiben. */
export interface CategorySeedRow {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  is_builtin: boolean;
  deleted_at: string | null;
}

export async function insertCategoryRows(db: Database, rows: readonly CategorySeedRow[]): Promise<void> {
  for (const row of rows) {
    await db.execute(
      'INSERT INTO categories (id, name, emoji, sort_order, is_builtin, deleted_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [row.id, row.name, row.emoji, row.sort_order, row.is_builtin ? 1 : 0, row.deleted_at]
    );
  }
}

/**
 * Legt die eingebauten Kategorien und das Starter-Set an. Nur für frische
 * Vaults. `starterName` übersetzt einen STARTER_CATEGORIES-Schlüssel in die
 * App-Sprache — der Aufrufer reicht `i18n.t` durch, damit diese Datei frei von
 * i18n bleibt.
 */
export async function seedBuiltins(
  db: Database,
  starterName: (key: string) => string
): Promise<void> {
  const rows: CategorySeedRow[] = [
    ...BUILTIN_CATEGORIES.map(([id, name, emoji]) => ({
      id, name, emoji, is_builtin: true,
    })),
    ...STARTER_CATEGORIES.map(([key, emoji]) => ({
      id: key, name: starterName(key), emoji, is_builtin: false,
    })),
  ].map((row, i) => ({ ...row, sort_order: i, deleted_at: null }));
  // Sonstiges ans Ende, wie es auch die Migration und der Store halten.
  const other = rows.find((r) => r.id === FALLBACK_CATEGORY_ID)!;
  const ordered = [...rows.filter((r) => r !== other), other].map((r, i) => ({ ...r, sort_order: i }));
  await insertCategoryRows(db, ordered);
}

/**
 * Haengt alle Inhalte einer Kategorie — in allen vier Modulen — auf das
 * Sammelbecken um und meldet, wie viele es waren. **Vor** jedem endgültigen
 * Löschen einer Kategorie aufzurufen.
 *
 * Vorher hat das niemand getan: `runPeriodicCleanup` und `emptyTrash` haben
 * Kategoriezeilen hart gelöscht und die Inhalte unangetastet gelassen, die
 * damit auf eine `category_id` zeigten, zu der es keine Zeile mehr gab. Seit
 * v33 verhindert ON DELETE RESTRICT das — der Loeschversuch schlaegt fehl,
 * statt still Muell zu hinterlassen. Dieser Helfer ist die Gegenseite davon:
 * Er sorgt dafuer, dass das Löschen erlaubt ist, ohne dass ein Inhalt
 * verschwindet.
 */
export async function reassignCategoryContent(db: Database, categoryId: string): Promise<number> {
  // Das Sammelbecken selbst ist eingebaut und wird nie gelöscht.
  if (categoryId === FALLBACK_CATEGORY_ID) return 0;
  let moved = 0;
  for (const table of CATEGORIZED_TABLES) {
    const result = await db.execute(
      `UPDATE ${table} SET category_id = $1 WHERE category_id = $2`,
      [FALLBACK_CATEGORY_ID, categoryId]
    );
    moved += result.rowsAffected ?? 0;
  }
  return moved;
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
    task: 'tasks',
    altar: 'altars',
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

// ─────────────────────────────────────────────────────────────────────────────
// Bildreferenzen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Das vollstaendige Inventar der Spalten, in denen ein Bild referenziert sein
 * kann. Drei Sorten, weil sie unterschiedlich behandelt werden muessen:
 *
 * - `html` — der Verweis steckt in einem `src`-Attribut. Wird umgeschrieben.
 * - `plain` — die Spalte *ist* der Verweis. Wird umgeschrieben.
 * - `legacy` — die Spalte haelt heute eine Data-URL. Wird **gelesen**, aber nie
 *   umgeschrieben.
 *
 * Die `legacy`-Gruppe ist der Grund, warum diese Liste vollstaendig sein muss
 * und nicht nur die umschreibbaren Spalten nennt. `collectUsedImageFilenames`
 * entscheidet, welche Datei die Aufraeum-Aktion loeschen darf; eine Spalte, die
 * hier fehlt, waere eine Referenz, die niemand sieht. Data-URLs stoeren dabei
 * nicht — sie enthalten keine 64 Hex-Zeichen mit Bildendung und fallen von
 * selbst durch.
 *
 * Umgeschrieben werden sie trotzdem nicht, und das ist Absicht:
 * `wiki_articles`/`operations` `icon` und `cover_image` werden von `Favicon`
 * und `Banner` per `FileReader` als Data-URL geschrieben, und ihre Renderer
 * pruefen mit `isImageIcon` auf `data:` / `blob:` / `/`. Ein Dateiname wuerde
 * dort als Text durchfallen. Dasselbe gilt fuer `altars.thumbnail_data` /
 * `icon_data`, `operations.drawing_data` / `thumbnail_data` und
 * `altar_items.image_data` (siehe die Base64-Notiz in `database.md`).
 *
 * Migration v35 und `collectUsedImageFilenames` lesen dieselbe Liste. Liefe
 * jede fuer sich, wuerde die Bereinigung frueher oder spaeter ein Bild
 * loeschen, das die Migration noch kennt.
 */
export const IMAGE_FIELDS: {
  table: string;
  html: string[];
  plain: string[];
  legacy: string[];
}[] = [
  { table: 'journal_entries', html: ['content'], plain: [], legacy: [] },
  { table: 'wiki_articles', html: ['content'], plain: [], legacy: ['icon', 'cover_image'] },
  {
    table: 'operations',
    html: ['content'],
    plain: [],
    legacy: ['icon', 'cover_image', 'drawing_data', 'thumbnail_data'],
  },
  { table: 'altars', html: [], plain: ['background_image_data'], legacy: ['thumbnail_data', 'icon_data'] },
  { table: 'altar_items', html: [], plain: [], legacy: ['image_data'] },
];

/**
 * Spiegelt `is_valid_image_name` in `src-tauri/src/images.rs`: ein gespeichertes
 * Bild heisst nach dem SHA-256 seines eigenen Inhalts.
 *
 * Das Format ist eine Eigenschaft der Spalten, nicht der Oberflaeche — deshalb
 * steht es hier und nicht in `images.ts`, das es nur re-exportiert. `db.ts`
 * kann es so in Migration v35 benutzen, ohne die Tauri-Module zu ziehen, die
 * `scripts/schema-check.mjs` gar nicht hat.
 */
const STORED_IMAGE_RE = /^[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)$/;

/** Dieselbe Form, ungeankert — zum Aufsammeln aus HTML. */
const IMAGE_NAME_RE = /[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)/g;

/**
 * Der gespeicherte Dateiname einer Referenz, oder null.
 *
 * Nimmt auch einen vollen Pfad: v35 schreibt jeden absoluten Pfad um, den sie
 * findet, aber eine `.emerald`-Datei aus einer aelteren Version traegt weiter
 * welche.
 */
export function storedImageName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const base = ref.split(/[\\/]/).pop() ?? '';
  return STORED_IMAGE_RE.test(base) ? base : null;
}

/**
 * Alle Spalten einer Tabelle, die einen Bildverweis halten koennen.
 *
 * Fuer alles, was nicht zwischen den drei Gruppen unterscheiden muss — der
 * Backup-Export und beide Import-Modi wollen schlicht "jede Spalte, in der ein
 * Bild stecken kann".
 */
export function imageColumns(table: string): string[] {
  const entry = IMAGE_FIELDS.find((f) => f.table === table);
  return entry ? [...entry.html, ...entry.plain, ...entry.legacy] : [];
}

/**
 * Alle Bild-Dateinamen, die dieser Vault tatsaechlich referenziert.
 *
 * Diagnose- und Aufraeumcode, kein Produktivpfad: die Funktion scannt ganze
 * Tabellen. Sie steht neben `checkIntegrity`, weil sie dieselbe Rolle hat —
 * etwas pruefen, das keine Fremdschluesselbeziehung abdecken kann.
 */
export async function collectUsedImageFilenames(db: Database): Promise<Set<string>> {
  const used = new Set<string>();

  for (const { table, html, plain, legacy } of IMAGE_FIELDS) {
    const columns = [...html, ...plain, ...legacy];
    const rows = await db.select<Record<string, string | null>[]>(
      `SELECT ${columns.join(', ')} FROM ${table}`
    );
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (!value) continue;
        // Ein Data-URL enthaelt keine 64 Hex-Zeichen mit Bildendung und
        // faellt von selbst durch — deshalb duerfen die `legacy`-Spalten hier
        // ohne Sonderbehandlung mitlaufen.
        for (const match of value.matchAll(IMAGE_NAME_RE)) used.add(match[0]);
      }
    }
  }

  return used;
}
