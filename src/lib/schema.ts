/**
 * Emeralds Schema an einer Stelle.
 *
 * Der Baseline-Pfad in `db.ts` führt es für frische Vaults direkt aus; die
 * Rebuild-Migrationen v33 (`normalizeSchema.ts`, gegen die eingefrorene Kopie
 * in `schemaV37.ts`), v38/v39 (`mergeCategoryTables.ts`/`nullableCategory.ts`,
 * gegen dieses DDL und `schemaV48.ts`) und v49 (`unifyEntries.ts`) bringen
 * bestehende Vaults auf denselben Stand. `scripts/schema-check.mjs`
 * beweist, dass beide Wege beim identischen Schema landen — ohne diese Prüfung
 * produziert ein Baseline-Squash erfahrungsgemäß nach ein paar Releases zwei
 * verschiedene Schemata, und niemand merkt es.
 *
 * Wer eine Spalte ändern will, ändert sie hier — und schreibt zusätzlich eine
 * neue Migration, die dasselbe für bestehende Datenbanken tut. Baut die
 * Migration eine Tabelle neu, die v33, v38 oder v39 ebenfalls anfassen, bekommen
 * die ihren alten Stand eingefroren (siehe `schemaV37.ts` und `schemaV48.ts`).
 */
import type Database from './sqlite';

/**
 * Muss der höchsten Version in MIGRATIONS entsprechen. `db.ts` prüft das beim
 * Start, damit ein neuer Migrationsschritt nicht vergessen werden kann.
 */
export const BASELINE_VERSION = 55;

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
  'categories',
  'block_definitions',
  'templates',
  'altars',
  'entries',
  'altar_items',
  'tasks',
  'altar_placements',
  'task_links',
  'languages',
  'lexicon_entries',
] as const;

export type TableName = (typeof TABLES)[number];

export const TABLE_DDL: Record<TableName, string> = {
  schema_version: `
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,

  // Einträge und Vorlagen tragen Tag-IDs als JSON (seit v53, vorher Namen;
  // `lib/tagRefs.ts`). Ein Tag im Papierkorb bleibt in ihren Listen stehen.
  tags: `
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#8347ff',
      deleted_at TEXT
    )`,

  // Eine Liste für Wiki, Operationen, Aufgaben und Altar-Elemente (seit v38;
  // vorher vier gleich gebaute Tabellen je Modul). Eingebaut ist seit v39 nur
  // noch `sigils`, deren neue Operationen mit den Sigillen-Blöcken beginnen.
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

  // Die eigenen Blöcke der Blöcke-Ansicht (seit v40). Eine Definition ist die
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
      elements TEXT NOT NULL DEFAULT '[]',
      display TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // Die Vorlagen des Vorlagen-Dashboards (seit v43): Titel, Blockstapel und
  // Tags, die ein Eintrag beim Anlegen oder Einfügen als Kopie bekommt. Wie
  // `block_definitions` ohne Fremdschlüssel — Einträge merken sich nur die
  // Herkunft im `content` (`data-template-origin`). `assignments` ist JSON
  // (lib/blocks/templates.ts): welche Eintragsart × Kategorie die Vorlage
  // anbietet und wo sie Standard ist; die Kategorie-IDs darin räumt
  // `dropCategoryFromTemplates` beim endgültigen Löschen einer Kategorie.
  // Der Icon-Default ist `DEFAULT_TEMPLATE_ICON`.
  templates: `
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📄',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      assignments TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // `settings` (seit v51) ist JSON: Hintergrund, Raster, Einrasten und
  // Auflösung (`lib/altarSettings.ts`) — vorher zwölf eigene Spalten. Die
  // Bildspalten bleiben Spalten, das Bild-Aufräumen sucht dort.
  altars: `
    CREATE TABLE altars (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Altar',
      background_image_data TEXT,
      thumbnail_data TEXT,
      icon_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      settings TEXT NOT NULL DEFAULT '{}'
    )`,

  // Journal-Einträge, Wiki-Artikel und Operationen in einer Tabelle (seit v49;
  // vorher drei, siehe `schemaV48.ts`). Was sie unterscheidet, steht im
  // Inhalt — Blöcke —, nicht in Spalten: `type` sagt nur, in welchem Modul der
  // Eintrag steht. Ein Typwechsel ist deshalb ein UPDATE (`entryTypeChange`).
  // - `category_id`: das Journal hat keine Kategorien; Store und Typwechsel
  //   halten sie dort auf NULL.
  // - `entry_number` zählt pro Typ (`nextEntryNumber`) — dieselben Nummern
  //   wie zu Zeiten der drei Tabellen.
  // - Die Mondphase eines Journal-Eintrags folgt aus `created_at`
  //   (`entryMoonPhase`), sie ist keine Spalte.
  entries: `
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('journal', 'wiki', 'operation')),
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      icon TEXT,
      cover_image TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // category_id hielt bis v33 den Kategorie-*Namen* statt der ID — die einzige
  // namensbasierte Referenz im ganzen Schema. Deshalb musste v23 ein Rename
  // über zwei Tabellen kaskadieren.
  // `updated_at`/`deleted_at` seit v52: ein gelöschtes Element liegt im
  // Papierkorb, seine Platzierungen bleiben stehen und kommen mit ihm zurück.
  // Endgültig weg nimmt ON DELETE CASCADE sie mit.
  altar_items: `
    CREATE TABLE altar_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '✨',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      note TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    )`,

  tasks: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Task',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
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

  // target_id ist polymorph — kein Foreign Key möglich; checkIntegrity() prüft die Beziehung.
  task_links: `
    CREATE TABLE task_links (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      UNIQUE (task_id, target_id, target_type)
    )`,

  // Die Sprachen des Lexikons (seit v45): je eine Sprache mit ihrem Alphabet,
  // die Vokabeln stehen in `lexicon_entries`. `alphabet` ist JSON
  // (lib/lexicon.ts): Paare `{ from, to }`, mit denen das Übersetzen-Feld
  // Zeichen für Zeichen umschreibt. Ohne Fremdschlüssel nach außen — eine
  // Sprache hängt an keinem Eintrag und kein Eintrag an ihr.
  // Der Icon-Default ist `DEFAULT_LANGUAGE_ICON`.
  languages: `
    CREATE TABLE languages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🗣️',
      alphabet TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // Die Vokabeln einer Sprache (seit v45). Kein eigenes `deleted_at`: eine
  // gelöschte Vokabel ist sofort weg (mit Rückgängig im Speicher), in den
  // Papierkorb wandert nur die Sprache als Ganzes. ON DELETE CASCADE räumt
  // deshalb beim endgültigen Löschen der Sprache mit auf.
  lexicon_entries: `
    CREATE TABLE lexicon_entries (
      id TEXT PRIMARY KEY,
      language_id TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      term TEXT NOT NULL DEFAULT '',
      translation TEXT NOT NULL DEFAULT '',
      pronunciation TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
};


/**
 * Was v38 (`mergeCategoryTables`) und v39 (`nullableCategory`) mitten in der
 * Kette anlegen — auf jeder Foreign-Key-Spalte, auf beiden Seiten von
 * `task_links` und auf jeder `deleted_at`-Spalte. Dort gibt es `links` und die
 * drei Eintragstabellen noch; v47 wirft `links` weg, v49 die drei.
 */
/**
 * Die Indizes aus `INDEX_DDL_V38`, die es noch gibt. Die `deleted_at`-Indizes,
 * weil `runPeriodicCleanup` bei jedem Öffnen eines Vaults einen Bereichsscan
 * über alle Soft-Delete-Tabellen fährt.
 */
const KEPT_INDEX_DDL_V38: readonly string[] = [
  'CREATE INDEX idx_task_links_task ON task_links(task_id)',
  'CREATE INDEX idx_task_links_target ON task_links(target_id)',
  'CREATE INDEX idx_tasks_category ON tasks(category_id)',
  'CREATE INDEX idx_tasks_parent ON tasks(parent_task_id)',
  'CREATE INDEX idx_altar_items_category ON altar_items(category_id)',
  'CREATE INDEX idx_altar_placements_altar ON altar_placements(altar_id)',
  'CREATE INDEX idx_altar_placements_item ON altar_placements(item_id)',
  ...(['tags', 'categories', 'tasks'] as const).map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
];

/** Die aus `INDEX_DDL_V38`, deren Tabellen v47 (`links`) und v49 (die drei Eintragstabellen) verwerfen. */
const DROPPED_INDEX_DDL_V38: readonly string[] = [
  'CREATE INDEX idx_links_source ON links(source_id)',
  'CREATE INDEX idx_links_target ON links(target_id)',
  'CREATE INDEX idx_wiki_articles_category ON wiki_articles(category_id)',
  'CREATE INDEX idx_operations_category ON operations(category_id)',
  ...(['journal_entries', 'wiki_articles', 'operations'] as const).map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
];

export const INDEX_DDL_V38: readonly string[] = [...DROPPED_INDEX_DDL_V38, ...KEPT_INDEX_DDL_V38];

/**
 * Der Index von `block_definitions` (v40), getrennt von `INDEX_DDL_V38`: v38
 * (`mergeCategoryTables`) und v39 (`nullableCategory`) legen ihre Liste mitten
 * in der Kette an, wo es die Tabelle noch nicht gibt. v40 legt ihn an, frische
 * Vaults über `INDEX_DDL`.
 */
export const BLOCK_DEFINITIONS_INDEX_DDL = 'CREATE INDEX idx_block_definitions_deleted ON block_definitions(deleted_at)';

/** Der Index von `templates` (v43) — aus demselben Grund getrennt wie der von `block_definitions`. */
export const TEMPLATES_INDEX_DDL = 'CREATE INDEX idx_templates_deleted ON templates(deleted_at)';

/** Die Indizes des Lexikons (v45) — getrennt wie die beiden darüber. */
export const LEXICON_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_languages_deleted ON languages(deleted_at)',
  'CREATE INDEX idx_lexicon_entries_language ON lexicon_entries(language_id)',
];

/** Der Index des Altar-Papierkorbs (v46) — getrennt wie die darüber. */
export const ALTARS_INDEX_DDL = 'CREATE INDEX idx_altars_deleted ON altars(deleted_at)';

/** Der Index des Papierkorbs der Altar-Elemente (v52). */
export const ALTAR_ITEMS_INDEX_DDL = 'CREATE INDEX idx_altar_items_deleted ON altar_items(deleted_at)';

/**
 * Die Indizes von `entries`. `type` samt `deleted_at`, weil jedes Modul seine
 * lebenden Einträge so lädt.
 *
 * `idx_entries_list` (v55) trägt jede Spalte, die die Listen beim Start lesen
 * (`fetchEntries`, erste Stufe), und die Tags (`rewriteTagRefs` beim Öffnen).
 * In der Zeile liegen `tags`, `created_at` … hinter `content`: ohne den Index
 * las SQLite dafür die Überlaufseiten jedes Eintrags — und SQLCipher
 * entschlüsselte dafür fast die ganze Datei. Mit ihm reicht der Index allein.
 * `deleted_at` führt, so dient er auch dem Bereichsscan von
 * `runPeriodicCleanup`. Icon und Titelbild fehlen bewusst: sie können
 * Data-URLs sein. Die wenigen Einträge, die eins tragen, findet der Teilindex
 * `idx_entries_decorated` — eine Abfrage nutzt ihn nur mit genau dieser
 * Bedingung im WHERE.
 */
export const ENTRIES_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_entries_type ON entries(type, deleted_at)',
  'CREATE INDEX idx_entries_category ON entries(category_id)',
  'CREATE INDEX idx_entries_list ON entries(deleted_at, type, title, category_id, entry_number, tags, created_at, updated_at, id)',
  'CREATE INDEX idx_entries_decorated ON entries(deleted_at) WHERE icon IS NOT NULL OR cover_image IS NOT NULL',
];

/** Alle Indizes des aktuellen Schemas — was ein frischer Vault bekommt. */
export const INDEX_DDL: readonly string[] = [
  ...KEPT_INDEX_DDL_V38, BLOCK_DEFINITIONS_INDEX_DDL, TEMPLATES_INDEX_DDL, ...LEXICON_INDEX_DDL, ALTARS_INDEX_DDL,
  ...ENTRIES_INDEX_DDL, ALTAR_ITEMS_INDEX_DDL,
];

/**
 * Das frühere Sammelbecken. Seit v39 ist es keins mehr: `category_id` darf
 * NULL sein, ein Eintrag ohne Kategorie ist der Normalfall, und `other` ist
 * eine gewöhnliche Kategorie wie jede andere — umbenenn- und löschbar, in
 * frischen Vaults gar nicht erst angelegt. Die Konstante bleibt für die
 * Migrationen v36–v39 und das Heben alter Sicherungen, die den alten
 * Sonderstatus noch kennen.
 */
export const FALLBACK_CATEGORY_ID = 'other';

/**
 * Seit v39 die einzige eingebaute Kategorie. Eine neue Operation darin beginnt
 * mit den Sigillen-Blöcken — seit v43 nicht mehr fest verdrahtet, sondern über
 * die eingebaute Vorlage `core-sigil`, die dort Standard ist (und die der
 * Nutzer ändern oder löschen kann). Für Artikel, Aufgaben und Altar-Elemente
 * ist sie eine Kategorie wie jede andere.
 */
export const SIGIL_CATEGORY_ID = 'sigils';

/**
 * [id, Name (nur Datenbank — angezeigt wird `categories.builtin.<id>`), Emoji].
 * Seit v39 nur noch eine: `other` hat seinen Sonderstatus verloren.
 */
export const BUILTIN_CATEGORIES: readonly [string, string, string][] = [
  [SIGIL_CATEGORY_ID, 'Sigils', '🔯'],
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

/** Die Inhaltstabellen mit `category_id` (Wiki und Operationen stehen in `entries`). Literal, weil in SQL interpoliert. */
export const CATEGORIZED_TABLES = ['entries', 'tasks', 'altar_items'] as const;

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
  await insertCategoryRows(db, rows);
}

/**
 * Löst die Kategorie von allen ihren Inhalten — in allen vier Modulen — und
 * meldet, wie viele es waren. **Vor** jedem endgültigen Löschen einer
 * Kategorie aufzurufen.
 *
 * Vorher hat das niemand getan: `runPeriodicCleanup` und `emptyTrash` haben
 * Kategoriezeilen hart gelöscht und die Inhalte unangetastet gelassen, die
 * damit auf eine `category_id` zeigten, zu der es keine Zeile mehr gab. Seit
 * v33 verhindert ON DELETE RESTRICT das — der Loeschversuch schlaegt fehl,
 * statt still Muell zu hinterlassen. Dieser Helfer ist die Gegenseite davon:
 * Er sorgt dafuer, dass das Löschen erlaubt ist, ohne dass ein Inhalt
 * verschwindet.
 *
 * Bis v38 landeten die Inhalte auf dem Sammelbecken `other`. Seit `category_id`
 * NULL sein darf, werden sie schlicht kategorielos — dasselbe, was ein neuer
 * Eintrag ohnehin ist.
 *
 * Seit v43 nimmt es die Kategorie auch aus den Zuweisungen der Vorlagen
 * (`dropCategoryFromTemplates`) — beide Aufräumarbeiten gehören zum selben
 * endgültigen Löschen.
 *
 * Mit `to` ziehen die Inhalte statt dessen in diese Kategorie — wenn eine
 * zurückgeholte in ihrer gleichnamigen aufgeht (`categoryStore.restoreCategory`).
 */
/** Endgültig löschen: erst die Inhalte lösen (ON DELETE RESTRICT), dann die Zeile. */
export async function purgeCategory(db: Database, categoryId: string): Promise<void> {
  await reassignCategoryContent(db, categoryId);
  await db.execute('DELETE FROM categories WHERE id=$1', [categoryId]);
}

export async function reassignCategoryContent(db: Database, categoryId: string, to: string | null = null): Promise<number> {
  let moved = 0;
  for (const table of CATEGORIZED_TABLES) {
    const result = await db.execute(
      `UPDATE ${table} SET category_id = $1 WHERE category_id = $2`,
      [to, categoryId]
    );
    moved += result.rowsAffected ?? 0;
  }
  // Vorlagen zählen nicht mit — sie sind keine Inhalte. Beim Zusammenlegen
  // ziehen ihre Zuweisungen mit, sonst gehen sie.
  if (to) await moveCategoryInTemplates(db, categoryId, to);
  else await dropCategoryFromTemplates(db, categoryId);
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
 * polymorphe `task_links`, die Kategorie-IDs im JSON der Vorlagen und die
 * Tag-IDs in Einträgen und Vorlagen. Foreign Keys decken den Rest ab, das
 * prüft `PRAGMA foreign_key_check`.
 *
 * Nur für Verifikation und Diagnose gedacht, nicht für den Produktionspfad —
 * die Abfragen scannen mehrere Tabellen vollständig.
 */
export async function checkIntegrity(db: Database): Promise<Orphan[]> {
  const orphans: Orphan[] = [];

  // Polymorphe Ziele: das *_type-Feld entscheidet, wo das Ziel steht. Die drei
  // Eintragsarten stehen in `entries` und müssen dort auch den Typ tragen.
  const contentTargets: Record<string, string> = {
    journal: "SELECT id FROM entries WHERE type = 'journal'",
    wiki: "SELECT id FROM entries WHERE type = 'wiki'",
    operation: "SELECT id FROM entries WHERE type = 'operation'",
    task: 'SELECT id FROM tasks',
    altar: 'SELECT id FROM altars',
  };

  for (const [type, target] of Object.entries(contentTargets)) {
    const rows = await db.select<{ id: string }[]>(
      `SELECT target_id AS id FROM task_links
        WHERE target_type = $1
          AND target_id NOT IN (${target})`,
      [type]
    );
    for (const r of rows) {
      orphans.push({ table: 'task_links', column: 'target_id', id: r.id, missingTarget: type });
    }
  }

  const idsOf = async (target: string): Promise<Set<string>> => {
    const rows = await db.select<{ id: string }[]>(`SELECT id FROM ${target}`);
    return new Set(rows.map((r) => r.id));
  };

  // Kategorie-IDs in den Zuweisungen der Vorlagen.
  const categoryIds = await idsOf('categories');
  const templates = await db.select<{ id: string; assignments: string | null }[]>('SELECT id, assignments FROM templates');
  for (const r of templates) {
    const assignments = rawAssignments(r.assignments);
    if (!assignments) {
      orphans.push({ table: 'templates', column: 'assignments', id: r.id, missingTarget: '(kein gültiges JSON)' });
      continue;
    }
    for (const category of assignments.map(assignedCategory)) {
      if (category !== null && !categoryIds.has(category)) {
        orphans.push({ table: 'templates', column: 'assignments', id: r.id, missingTarget: `categories.${category}` });
      }
    }
  }

  // Tag-IDs, auch die im Papierkorb: eine ID ohne Zeile in `tags` zeigt ins Leere.
  const tagIds = await idsOf('tags');
  for (const table of ['entries', 'templates'] as const) {
    const rows = await db.select<{ id: string; tags: string }[]>(`SELECT id, tags FROM ${table} WHERE tags != '[]'`);
    for (const r of rows) {
      for (const tag of rawJsonList(r.tags) ?? []) {
        if (typeof tag !== 'string' || !tagIds.has(tag)) {
          orphans.push({ table, column: 'tags', id: r.id, missingTarget: `tags.${String(tag)}` });
        }
      }
    }
  }

  return orphans;
}

/** Das rohe `assignments`-JSON einer Vorlagenzeile als Liste — `null`, wenn es keine ist. */
function rawAssignments(json: string | null): unknown[] | null {
  return rawJsonList(json);
}

/** Ein JSON-Array aus einer Spalte — `null`, wenn es keins ist. */
function rawJsonList(json: string | null): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Die Kategorie-ID einer rohen Zuweisung — `null` für „alle" (`'*'`) und „ohne
 * Kategorie". Dieselbe Regel wie `assignedCategoryId` in
 * `lib/blocks/templates.ts`, das diese Datei nicht importiert.
 */
function assignedCategory(a: unknown): string | null {
  const category = (a as { category?: unknown } | null)?.category;
  return typeof category === 'string' && category !== '*' ? category : null;
}

/**
 * Nimmt eine Kategorie aus den Zuweisungen aller Vorlagen — auch aus dem
 * Papierkorb. `reassignCategoryContent` ruft es beim endgültigen Löschen einer
 * Kategorie auf; nicht zusätzlich aufrufen. Vorlagen haben keinen
 * Fremdschlüssel, der das erzwingen würde, und eine Zuweisung ins Leere böte
 * die Vorlage in einer Kombination an, die es nicht mehr gibt.
 */
export async function dropCategoryFromTemplates(db: Database, categoryId: string): Promise<void> {
  const rows = await db.select<{ id: string; assignments: string | null }[]>(
    'SELECT id, assignments FROM templates WHERE instr(assignments, $1) > 0',
    [categoryId]
  );
  for (const row of rows) {
    const assignments = rawAssignments(row.assignments);
    if (!assignments) continue;
    const kept = assignments.filter((a) => assignedCategory(a) !== categoryId);
    if (kept.length === assignments.length) continue;
    await db.execute('UPDATE templates SET assignments=$1 WHERE id=$2', [JSON.stringify(kept), row.id]);
  }
}

/**
 * Hängt die Zuweisungen an `from` auf `to` um — wenn eine Kategorie in ihrer
 * gleichnamigen aufgeht. Hatte eine Vorlage beide, bleibt eine Zuweisung. Ein
 * Stern zieht nur mit, wenn für diesen Typ und `to` noch keine aktive Vorlage
 * einen trägt: zwei Standards für dieselbe Kombination gibt es nicht. Sterne
 * gehören aktiven Vorlagen (wie in `restoreTemplate`) — eine im Papierkorb
 * verliert ihren hier.
 */
async function moveCategoryInTemplates(db: Database, from: string, to: string): Promise<void> {
  const rows = await db.select<{ id: string; assignments: string | null; deleted_at: string | null }[]>(
    'SELECT id, assignments, deleted_at FROM templates ORDER BY deleted_at IS NOT NULL'
  );
  const parsed = rows.map((row) => ({ id: row.id, active: !row.deleted_at, assignments: rawAssignments(row.assignments) }));
  const entryTypeOf = (a: unknown) => String((a as { entryType?: unknown } | null)?.entryType);
  const isDefault = (a: unknown) => (a as { isDefault?: unknown } | null)?.isDefault === true;
  const starred = new Set(parsed.filter((row) => row.active).flatMap(({ assignments }) =>
    (assignments ?? []).filter((a) => assignedCategory(a) === to && isDefault(a)).map(entryTypeOf)));
  for (const { id, active, assignments } of parsed) {
    if (!assignments?.some((a) => assignedCategory(a) === from)) continue;
    const next: unknown[] = [];
    for (const a of assignments) {
      if (assignedCategory(a) !== from) { next.push(a); continue; }
      const entryType = entryTypeOf(a);
      if (assignments.some((b) => assignedCategory(b) === to && entryTypeOf(b) === entryType)) continue;
      const star = active && isDefault(a) && !starred.has(entryType);
      if (star) starred.add(entryType);
      next.push({ ...(a as object), category: to, isDefault: star });
    }
    await db.execute('UPDATE templates SET assignments=$1 WHERE id=$2', [JSON.stringify(next), id]);
  }
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
 * `entries.icon` und `cover_image` werden von
 * `MediaPropertyRow` (Icons wie in `Favicon` über `readIconFile`) per
 * `FileReader` als Data-URL geschrieben, und ihre Renderer
 * pruefen mit `isImageIcon` auf `data:` / `blob:` / `/`. Ein Dateiname wuerde
 * dort als Text durchfallen. Dasselbe gilt fuer `altars.thumbnail_data` /
 * `icon_data` und `altar_items.image_data` (siehe die Base64-Notiz in
 * `database.md`).
 *
 * Migration v35 läuft über den Stand von damals (`IMAGE_FIELDS_V48`), noch mit
 * den drei Eintragstabellen.
 */
export const IMAGE_FIELDS: {
  table: string;
  html: string[];
  plain: string[];
  legacy: string[];
}[] = [
  { table: 'entries', html: ['content'], plain: [], legacy: ['icon', 'cover_image'] },
  { table: 'altars', html: [], plain: ['background_image_data'], legacy: ['thumbnail_data', 'icon_data'] },
  { table: 'altar_items', html: [], plain: [], legacy: ['image_data'] },
];

/**
 * Spiegelt `is_valid_image_name` in `src-tauri/src/images.rs`: ein gespeichertes
 * Bild heisst nach einem Hash seines eigenen Inhalts — SHA-256, in einem
 * verschluesselten Vault ein mit dem Vault-Schluessel gebildeter.
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

  // Bild-Vorgaben eigener Blöcke: das `elements`-JSON nennt die Datei, bevor
  // eine Kopie sie in einen Inhalt schreibt. Nicht in IMAGE_FIELDS — Migration
  // v35 läuft über diese Liste, und die Tabelle entsteht erst mit v40.
  const definitions = await db.select<{ elements: string | null }[]>('SELECT elements FROM block_definitions');
  for (const { elements } of definitions) {
    for (const match of (elements ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
  }

  // Bilder im Blockstapel der Vorlagen (v43) — aus demselben Grund nicht in IMAGE_FIELDS.
  const templates = await db.select<{ content: string | null }[]>('SELECT content FROM templates');
  for (const { content } of templates) {
    for (const match of (content ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
  }

  return used;
}
