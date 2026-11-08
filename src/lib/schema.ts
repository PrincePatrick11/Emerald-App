/**
 * Emerald's schema in one place.
 *
 * The baseline path in `db.ts` executes it directly for fresh vaults; the
 * rebuild migrations v33 (`normalizeSchema.ts`, against the frozen copy
 * in `schemaV37.ts`), v38/v39 (`mergeCategoryTables.ts`/`nullableCategory.ts`,
 * against this DDL and `schemaV48.ts`) and v49 (`unifyEntries.ts`) bring
 * existing vaults to the same state. `scripts/schema-check.mjs`
 * proves that both paths end up at the identical schema — without this check
 * a baseline squash, experience shows, produces two different schemas
 * after a few releases, and nobody notices.
 *
 * Whoever wants to change a column changes it here — and additionally writes a
 * new migration that does the same for existing databases. If the
 * migration rebuilds a table that v33, v38 or v39 also touch, those
 * get their old state frozen (see `schemaV37.ts` and `schemaV48.ts`).
 */
import type Database from './sqlite';

/**
 * Must match the highest version in MIGRATIONS. `db.ts` checks this at
 * startup so that a new migration step cannot be forgotten.
 */
export const BASELINE_VERSION = 56;

/**
 * Tables in dependency order: parents before children.
 *
 * This order is not cosmetic. Foreign keys are permanently on in this app
 * — sqlx sets `foreign_keys = ON` as a default pragma on every
 * pool connection — and an INSERT immediately checks whether the parent row exists.
 * Whoever reorders here breaks the rebuild migrations and the backup import.
 *
 * `schema_version` is deliberately first and is rebuilt by no rebuild:
 * it holds the migration state that the rebuild is currently working through.
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
  'images',
] as const;

export type TableName = (typeof TABLES)[number];

export const TABLE_DDL: Record<TableName, string> = {
  schema_version: `
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,

  // Entries and templates carry tag IDs as JSON (since v53, names before;
  // `lib/tagRefs.ts`). A tag in the trash stays in their lists.
  tags: `
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#8347ff',
      deleted_at TEXT
    )`,

  // One list for wiki, operations, tasks and altar items (since v38;
  // before, four identically built tables, one per module). Since v39 the only
  // built-in one is `sigils`, whose new operations start with the sigil blocks.
  // Everything else is created by the user; uniqueness of names is checked by the store
  // (categoryKey), not the database — a UNIQUE index would block
  // restoring from the trash as soon as an active category
  // of the same name exists.
  categories: `
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📁',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    )`,

  // The custom blocks of the blocks view (since v40). A definition is the
  // template for copies: an inserted block carries elements and display rules
  // itself in the `content` and remembers only origin and revision
  // (`data-block-origin`/`-rev`). Hence no foreign key and no
  // cleanup on deletion — the copies manage without their definition.
  // `elements`/`display` are JSON (lib/blocks/definitions.ts); `revision`
  // rises with every change that affects copies. The icon default is
  // `DEFAULT_DEFINITION_ICON` — here as a literal so that the schema imports nothing from
  // the block logic.
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

  // The templates of the templates dashboard (since v43): title, block stack and
  // tags that an entry receives as a copy on creation or insertion. Like
  // `block_definitions` without a foreign key — entries remember only the
  // origin in the `content` (`data-template-origin`). `assignments` is JSON
  // (lib/blocks/templates.ts): which entry kind × category the template
  // offers and where it is the default; the category IDs in it are cleaned up by
  // `dropCategoryFromTemplates` when a category is permanently deleted.
  // The icon default is `DEFAULT_TEMPLATE_ICON`.
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

  // `settings` (since v51) is JSON: background, grid, snapping and
  // resolution (`lib/altarSettings.ts`) — formerly twelve columns of their own. The
  // image columns remain columns, the image cleanup looks there.
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

  // Journal entries, wiki articles and operations in one table (since v49;
  // before, three, see `schemaV48.ts`). What distinguishes them is in the
  // content — blocks —, not in columns: `type` only says in which module the
  // entry lives. A type change is therefore an UPDATE (`entryTypeChange`).
  // - `category_id`: the journal has no categories; store and type change
  //   keep it NULL there.
  // - `entry_number` counts per type (`nextEntryNumber`) — the same numbers
  //   as in the days of the three tables.
  // - The moon phase of a journal entry follows from `created_at`
  //   (`entryMoonPhase`), it is not a column.
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

  // category_id held the category *name* instead of the ID until v33 — the only
  // name-based reference in the whole schema. That is why v23 had to cascade a rename
  // across two tables.
  // `updated_at`/`deleted_at` since v52: a deleted item lies in the
  // trash, its placements stay and come back with it.
  // When it is gone for good, ON DELETE CASCADE takes them along.
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

  // target_id is polymorphic — no foreign key possible; checkIntegrity() checks the relationship.
  task_links: `
    CREATE TABLE task_links (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      UNIQUE (task_id, target_id, target_type)
    )`,

  // The languages of the lexicon (since v45): one language each with its alphabet,
  // the vocabulary is in `lexicon_entries`. `alphabet` is JSON
  // (lib/lexicon.ts): pairs `{ from, to }` with which the translate field
  // rewrites character by character. No foreign key to the outside — a
  // language hangs off no entry and no entry off it.
  // The icon default is `DEFAULT_LANGUAGE_ICON`.
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

  // The vocabulary of a language (since v45). No `deleted_at` of its own: a
  // deleted word is gone immediately (with undo in memory), only the
  // language as a whole goes to the trash. ON DELETE CASCADE therefore
  // cleans up too when the language is permanently deleted.
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

  // The vault's images as a place of their own, like tags and categories
  // (since v56): a row gives a stored file (`storedImageName`) a name, tags
  // (IDs as JSON, `lib/tagRefs.ts`) and a note. Every other file of the
  // folder is listed too, unnamed; a row keeps its file from the cleanup.
  // `detached` (JSON) holds, while the picture is in the trash, the texts it
  // was taken out of, so that restoring it puts it back there.
  images: `
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      detached TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
};


/**
 * What v38 (`mergeCategoryTables`) and v39 (`nullableCategory`) create in the
 * middle of the chain — on every foreign key column, on both sides of
 * `task_links` and on every `deleted_at` column. There `links` and the
 * three entry tables still exist; v47 drops `links`, v49 the three.
 */
/**
 * The indexes from `INDEX_DDL_V38` that still exist. The `deleted_at` indexes,
 * because `runPeriodicCleanup` runs a range scan over all soft-delete tables
 * every time a vault is opened.
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

/** Those from `INDEX_DDL_V38` whose tables v47 (`links`) and v49 (the three entry tables) drop. */
const DROPPED_INDEX_DDL_V38: readonly string[] = [
  'CREATE INDEX idx_links_source ON links(source_id)',
  'CREATE INDEX idx_links_target ON links(target_id)',
  'CREATE INDEX idx_wiki_articles_category ON wiki_articles(category_id)',
  'CREATE INDEX idx_operations_category ON operations(category_id)',
  ...(['journal_entries', 'wiki_articles', 'operations'] as const).map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
];

export const INDEX_DDL_V38: readonly string[] = [...DROPPED_INDEX_DDL_V38, ...KEPT_INDEX_DDL_V38];

/**
 * The index of `block_definitions` (v40), separate from `INDEX_DDL_V38`: v38
 * (`mergeCategoryTables`) and v39 (`nullableCategory`) create their list in the middle
 * of the chain, where the table does not yet exist. v40 creates it, fresh
 * vaults via `INDEX_DDL`.
 */
export const BLOCK_DEFINITIONS_INDEX_DDL = 'CREATE INDEX idx_block_definitions_deleted ON block_definitions(deleted_at)';

/** The index of `templates` (v43) — separate for the same reason as that of `block_definitions`. */
export const TEMPLATES_INDEX_DDL = 'CREATE INDEX idx_templates_deleted ON templates(deleted_at)';

/** The lexicon's indexes (v45) — separate like the two above. */
export const LEXICON_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_languages_deleted ON languages(deleted_at)',
  'CREATE INDEX idx_lexicon_entries_language ON lexicon_entries(language_id)',
];

/** The index of the altar trash (v46) — separate like those above. */
export const ALTARS_INDEX_DDL = 'CREATE INDEX idx_altars_deleted ON altars(deleted_at)';

/** The index of the altar items' trash (v52). */
export const ALTAR_ITEMS_INDEX_DDL = 'CREATE INDEX idx_altar_items_deleted ON altar_items(deleted_at)';

/**
 * The indexes of `entries` as v49 created them — frozen for
 * `unifyEntries`, so that the chain at v55 sees the same rebuild as a real
 * v54 vault. v55 replaces `idx_entries_deleted` (`ENTRIES_INDEX_DDL`).
 */
export const ENTRIES_INDEX_DDL_V49: readonly string[] = [
  'CREATE INDEX idx_entries_type ON entries(type, deleted_at)',
  'CREATE INDEX idx_entries_category ON entries(category_id)',
  'CREATE INDEX idx_entries_deleted ON entries(deleted_at)',
];

/**
 * The indexes of `entries`. `type` together with `deleted_at`, because every module
 * loads its live entries that way.
 *
 * `idx_entries_list` (v55) carries every column that the lists read at startup
 * (`fetchEntries`, first stage), and the tags (`rewriteTagRefs` on open).
 * In the row, `tags`, `created_at` … lie behind `content`: without the index
 * SQLite read the overflow pages of every entry for that — and SQLCipher
 * decrypted almost the whole file for it. With it, the index alone is enough.
 * `deleted_at` leads, so it also serves the range scan of
 * `runPeriodicCleanup`. Icon and cover image are deliberately missing: they can be
 * data URLs. The few entries that carry one are found by the partial index
 * `idx_entries_decorated` — a query uses it only with exactly this
 * condition in its WHERE.
 */
export const ENTRIES_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_entries_type ON entries(type, deleted_at)',
  'CREATE INDEX idx_entries_category ON entries(category_id)',
  'CREATE INDEX idx_entries_list ON entries(deleted_at, type, title, category_id, entry_number, tags, created_at, updated_at, id)',
  'CREATE INDEX idx_entries_decorated ON entries(deleted_at) WHERE icon IS NOT NULL OR cover_image IS NOT NULL',
];

/** The index of `images` (v56): its trash. */
export const IMAGES_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_images_deleted ON images(deleted_at)',
];

/** All indexes of the current schema — what a fresh vault gets. */
export const INDEX_DDL: readonly string[] = [
  ...KEPT_INDEX_DDL_V38, BLOCK_DEFINITIONS_INDEX_DDL, TEMPLATES_INDEX_DDL, ...LEXICON_INDEX_DDL, ALTARS_INDEX_DDL,
  ...ENTRIES_INDEX_DDL, ALTAR_ITEMS_INDEX_DDL, ...IMAGES_INDEX_DDL,
];

/**
 * The former catch-all. Since v39 it is none any more: `category_id` may be
 * NULL, an entry without a category is the normal case, and `other` is
 * an ordinary category like any other — renamable and deletable, not even
 * created in fresh vaults. The constant remains for the
 * migrations v36–v39 and for lifting old backups that still know the old
 * special status.
 */
export const FALLBACK_CATEGORY_ID = 'other';

/**
 * Since v39 the only built-in category. A new operation in it starts
 * with the sigil blocks — since v43 no longer hard-wired, but via
 * the built-in template `core-sigil`, which is the default there (and which the
 * user can change or delete). For articles, tasks and altar items
 * it is a category like any other.
 */
export const SIGIL_CATEGORY_ID = 'sigils';

/**
 * [id, name (database only — `categories.builtin.<id>` is displayed), emoji].
 * Since v39 only one: `other` has lost its special status.
 */
export const BUILTIN_CATEGORIES: readonly [string, string, string][] = [
  [SIGIL_CATEGORY_ID, 'Sigils', '🔯'],
];

/**
 * What a fresh vault gets besides the built-ins: normal, renamable and
 * deletable categories, created in the app language (`categories.starter.<key>`).
 * The keys are at the same time the IDs.
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

/** The content tables with `category_id` (wiki and operations are in `entries`). A literal, because it is interpolated into SQL. */
export const CATEGORIZED_TABLES = ['entries', 'tasks', 'altar_items'] as const;

/**
 * The same DDL, but compatible with an already existing table.
 * The chain path needs this for `schema_version`, which may already exist
 * there — without this detour the CREATE would stand in the code a second time, and that is
 * exactly what the separation of baseline and chain would otherwise have failed on.
 */
export function ddlIfNotExists(ddl: string): string {
  return ddl.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ');
}

/** Creates tables and indexes. The order follows TABLES. */
export async function createSchema(db: Database): Promise<void> {
  for (const table of TABLES) {
    await db.execute(TABLE_DDL[table]);
  }
  for (const sql of INDEX_DDL) {
    await db.execute(sql);
  }
}

/** A category row as `seedBuiltins` and migration v38 write it. */
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
 * Creates the built-in categories and the starter set. Only for fresh
 * vaults. `starterName` translates a STARTER_CATEGORIES key into the
 * app language — the caller passes `i18n.t` through so that this file stays free of
 * i18n.
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
 * Detaches the category from all its contents — in all four modules — and
 * reports how many there were. To be called **before** every permanent deletion of a
 * category.
 *
 * Nobody used to do that: `runPeriodicCleanup` and `emptyTrash` hard-deleted
 * category rows and left the contents untouched, which
 * thereby pointed to a `category_id` for which no row existed any more. Since
 * v33 ON DELETE RESTRICT prevents that — the delete attempt fails
 * instead of silently leaving garbage behind. This helper is the other side of it:
 * it ensures that deleting is allowed without any content
 * disappearing.
 *
 * Until v38 the contents landed in the catch-all `other`. Since `category_id`
 * may be NULL, they simply become categoryless — the same as a new
 * entry is anyway.
 *
 * Since v43 it also removes the category from the templates' assignments
 * (`dropCategoryFromTemplates`) — both cleanup jobs belong to the same
 * permanent deletion.
 *
 * With `to` the contents move into that category instead — when a
 * restored one merges into the one of the same name (`categoryStore.restoreCategory`).
 */
/** Delete permanently: first detach the contents (ON DELETE RESTRICT), then the row. */
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
  // Templates do not count — they are not contents. On merging
  // their assignments move along, otherwise they are removed.
  if (to) await moveCategoryInTemplates(db, categoryId, to);
  else await dropCategoryFromTemplates(db, categoryId);
  return moved;
}

/** An orphaned reference: row `id` in `table` points to a target that is missing. */
export interface Orphan {
  table: string;
  column: string;
  id: string;
  missingTarget: string;
}

/**
 * Checks the relationships for which no foreign key can be declared: the
 * polymorphic `task_links`, the category IDs in the templates' JSON and the
 * tag IDs in entries and templates. Foreign keys cover the rest, which
 * `PRAGMA foreign_key_check` checks.
 *
 * Intended only for verification and diagnosis, not for the production path —
 * the queries scan several tables completely.
 */
export async function checkIntegrity(db: Database): Promise<Orphan[]> {
  const orphans: Orphan[] = [];

  // Polymorphic targets: the *_type field decides where the target is. The three
  // entry kinds are in `entries` and must carry the type there too.
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

  // Category IDs in the templates' assignments.
  const categoryIds = await idsOf('categories');
  const templates = await db.select<{ id: string; assignments: string | null }[]>('SELECT id, assignments FROM templates');
  for (const r of templates) {
    const assignments = rawAssignments(r.assignments);
    if (!assignments) {
      orphans.push({ table: 'templates', column: 'assignments', id: r.id, missingTarget: '(invalid JSON)' });
      continue;
    }
    for (const category of assignments.map(assignedCategory)) {
      if (category !== null && !categoryIds.has(category)) {
        orphans.push({ table: 'templates', column: 'assignments', id: r.id, missingTarget: `categories.${category}` });
      }
    }
  }

  // Tag IDs, including those in the trash: an ID without a row in `tags` points nowhere.
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

/** The raw `assignments` JSON of a template row as a list — `null` if it is not one. */
function rawAssignments(json: string | null): unknown[] | null {
  return rawJsonList(json);
}

/** A JSON array from a column — `null` if it is not one. */
function rawJsonList(json: string | null): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The category ID of a raw assignment — `null` for "all" (`'*'`) and "no
 * category". The same rule as `assignedCategoryId` in
 * `lib/blocks/templates.ts`, which this file does not import.
 */
function assignedCategory(a: unknown): string | null {
  const category = (a as { category?: unknown } | null)?.category;
  return typeof category === 'string' && category !== '*' ? category : null;
}

/**
 * Removes a category from the assignments of all templates — including those in the
 * trash. `reassignCategoryContent` calls it on permanent deletion of a
 * category; do not call it in addition. Templates have no
 * foreign key that would enforce this, and an assignment pointing nowhere would offer
 * the template in a combination that no longer exists.
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
 * Re-attaches the assignments on `from` to `to` — when a category merges into
 * the one of the same name. If a template had both, one assignment remains. A
 * star only moves along if no active template carries one yet for this type
 * and `to`: there are not two defaults for the same combination. Stars
 * belong to active templates (as in `restoreTemplate`) — one in the trash
 * loses its star here.
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
// Image references
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete inventory of the columns in which an image can be referenced.
 * Three kinds, because they have to be treated differently:
 *
 * - `html` — the reference sits in a `src` attribute. Is rewritten.
 * - `plain` — the column *is* the reference. Is rewritten.
 * - `legacy` — the column today holds a data URL. Is **read**, but never
 *   rewritten.
 *
 * The `legacy` group is the reason why this list has to be complete
 * and not name only the rewritable columns. `collectUsedImageFilenames`
 * decides which file the cleanup action may delete; a column that is
 * missing here would be a reference nobody sees. Data URLs do not
 * interfere — they contain no 64 hex characters with an image extension and fall
 * through by themselves.
 *
 * They are still not rewritten, and that is intentional:
 * `entries.icon` and `cover_image` are written by
 * `MediaPropertyRow` (icons as in `Favicon` via `readIconFile`) as a data URL
 * through `FileReader`, and their renderers
 * check with `isImageIcon` for `data:` / `blob:` / `/`. A file name would
 * fall through there as text. The same applies to `altars.thumbnail_data` /
 * `icon_data` and `altar_items.image_data` (see the Base64 note in
 * `database.md`).
 *
 * Migration v35 runs over the state of that time (`IMAGE_FIELDS_V48`), still with
 * the three entry tables.
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
 * Mirrors `is_valid_image_name` in `src-tauri/src/images.rs`: a stored
 * image is named after a hash of its own content — SHA-256, in an
 * encrypted vault one formed with the vault key.
 *
 * The format is a property of the columns, not of the UI — which is why
 * it lives here and not in `images.ts`, which only re-exports it. `db.ts`
 * can thus use it in migration v35 without pulling in the Tauri modules that
 * `scripts/schema-check.mjs` does not have at all.
 */
const STORED_IMAGE_RE = /^[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)$/;

/** The same form, unanchored — for collecting from HTML. */
const IMAGE_NAME_RE = /[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)/g;

/**
 * The stored file name of a reference, or null.
 *
 * Also accepts a full path: v35 rewrites every absolute path it
 * finds, but a `.emerald` file from an older version still carries
 * some.
 */
export function storedImageName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const base = ref.split(/[\\/]/).pop() ?? '';
  return STORED_IMAGE_RE.test(base) ? base : null;
}

/**
 * All columns of a table that can hold an image reference.
 *
 * For everything that does not need to distinguish between the three groups — the
 * backup export and both import modes simply want "every column in which an
 * image can be".
 */
export function imageColumns(table: string): string[] {
  const entry = IMAGE_FIELDS.find((f) => f.table === table);
  return entry ? [...entry.html, ...entry.plain, ...entry.legacy] : [];
}

/**
 * All image file names that this vault actually references.
 *
 * Diagnostic and cleanup code, not a production path: the function scans entire
 * tables. It sits next to `checkIntegrity` because it has the same role —
 * checking something that no foreign key relationship can cover.
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
        // A data URL contains no 64 hex characters with an image extension and
        // falls through by itself — which is why the `legacy` columns may run
        // along here without special handling.
        for (const match of value.matchAll(IMAGE_NAME_RE)) used.add(match[0]);
      }
    }
  }

  // Image defaults of custom blocks: the `elements` JSON names the file before
  // a copy writes it into a content. Not in IMAGE_FIELDS — migration
  // v35 runs over that list, and the table only comes into being with v40.
  const definitions = await db.select<{ elements: string | null }[]>('SELECT elements FROM block_definitions');
  for (const { elements } of definitions) {
    for (const match of (elements ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
  }

  // Images taken into "Images" (v56) stay, used anywhere or not — not in
  // IMAGE_FIELDS for the same reason. A row in the trash keeps its file until
  // it is deleted for good.
  const kept = await db.select<{ file: string }[]>('SELECT file FROM images');
  for (const { file } of kept) if (storedImageName(file)) used.add(file);

  // Images in the templates' block stack (v43) — not in IMAGE_FIELDS for the same reason.
  const templates = await db.select<{ content: string | null }[]>('SELECT content FROM templates');
  for (const { content } of templates) {
    for (const match of (content ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
  }

  return used;
}
