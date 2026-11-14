/**
 * Emerald's schema in one place — the only record of what a vault looks like.
 *
 * `db.ts` creates fresh vaults straight from it. Whoever changes a column
 * changes it here, appends a step to `MIGRATIONS` in `db.ts` that does the same
 * for vaults created before, and raises `BASELINE_VERSION`
 * (`scripts/schema-check.mjs` checks the fresh vault against these strings).
 */
import type Database from './sqlite';

/**
 * The oldest schema this version opens. Everything below came out of the old
 * migration chain (v1–v66), which is gone: such a vault is recognised and
 * refused, not changed (`VAULT_OUTDATED` in `db.ts`). So is v100, the first
 * fresh schema, which still told entries apart by a type: it was never released.
 */
export const FRESH_START_VERSION = 101;

/**
 * What a fresh vault is stamped with. Equals the last step in `MIGRATIONS`
 * (`FRESH_START_VERSION` while there is none); `db.ts` checks this at startup
 * so that a new migration step cannot be forgotten.
 */
export const BASELINE_VERSION = 101;

/**
 * Tables in dependency order: parents before children.
 *
 * This order is not cosmetic. Foreign keys are permanently on in this app
 * — sqlx sets `foreign_keys = ON` as a default pragma on every
 * pool connection — and an INSERT immediately checks whether the parent row exists.
 * Whoever reorders here breaks the backup import.
 */
export const TABLES = [
  'schema_version',
  'tags',
  // Before `categories`: a category names its start template.
  'templates',
  'categories',
  'dashboards',
  'block_definitions',
  'entries',
  'blocks',
  'block_refs',
  'tasks',
  'task_links',
  'languages',
  'lexicon_entries',
  'symbols',
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

  // Entries and templates carry tag IDs as JSON (`lib/tagRefs.ts`). A tag in
  // the trash stays in their lists.
  tags: `
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#8347ff',
      deleted_at TEXT
    )`,

  // One list for entries and tasks; an entry has at most one. Built in are
  // `journal`, `sigils` and `altars` (`BUILTIN_CATEGORIES`). Everything else is
  // created by the user; uniqueness of names is checked by the store
  // (categoryKey), not the database — a UNIQUE index would block
  // restoring from the trash as soon as an active category
  // of the same name exists.
  // `template_id`: the template a new entry of the category starts with
  // (`resolveStartTemplate`); without one — or with one in the trash — the
  // vault's default template applies (setting `templates.defaultTemplateId`).
  categories: `
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📁',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
      deleted_at TEXT
    )`,

  // Views over entries by filter rules (`lib/dashboards.ts`). The built-in
  // ones carry their key in `builtin` and as ID (`BUILTIN_DASHBOARDS`), so
  // that devices seeded apart mean the same rows. `filter`, `sort` and
  // `display` are JSON. The category IDs in `filter` have no foreign key:
  // `reassignCategoryContent` drops or moves them with the category.
  dashboards: `
    CREATE TABLE dashboards (
      id TEXT PRIMARY KEY,
      builtin TEXT,
      name TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      filter TEXT NOT NULL DEFAULT '{}',
      sort TEXT NOT NULL DEFAULT '{}',
      display TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // The custom blocks of the blocks view. A definition is the
  // template for copies: an inserted block carries elements and display rules
  // itself in its row of `blocks` and does not know where it came from. Hence no
  // foreign key and no cleanup on deletion.
  // `elements`/`display` are JSON (lib/blocks/definitions.ts). The icon default is
  // `DEFAULT_DEFINITION_ICON` — here as a literal so that the schema imports nothing from
  // the block logic.
  block_definitions: `
    CREATE TABLE block_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🧩',
      elements TEXT NOT NULL DEFAULT '[]',
      display TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // The templates of the templates dashboard: title, block stack and
  // tags that an entry receives as a copy on creation or insertion. The block
  // stack is in `blocks`. Like
  // `block_definitions` without a foreign key — entries remember nothing of it.
  // Which categories start with it is said by the category (`template_id`).
  // The icon default is `DEFAULT_TEMPLATE_ICON`.
  templates: `
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📄',
      title TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // All entries in one table, without a type: what an entry is follows from
  // its category, which dashboards show it (`lib/dashboards.ts`) and its
  // blocks (rows of `blocks`).
  // - `category_id`: at most one category, NULL for none.
  // - `entry_number` runs over all entries (`nextEntryNumber`), unique
  //   (`idx_entries_number`).
  // - The moon phase of an entry of the category Journal follows from
  //   `created_at` (`entryMoonPhase`), it is not a column.
  entries: `
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      icon TEXT,
      cover_image TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  // The blocks of entries and templates, one row each. Exactly one owner: an entry or a template, both
  // CASCADE — a block is nothing without its owner. Block IDs are unique per
  // owner only (a duplicated entry keeps them), hence `row_id` as the key.
  // `position` sorts as a string (`lib/blocks/position.ts`): moving a block
  // writes its row alone. The instance attributes have columns of their own;
  // `config`/`data` are the block's JSON as written, `attrs` (JSON) what else
  // it carries, `html` its inner markup, `text` its plain text for the search
  // (`lib/blocks/blockRows.ts`). The only record of the blocks
  // (`lib/blockStore.ts`).
  blocks: `
    CREATE TABLE blocks (
      row_id INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
      template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
      position TEXT NOT NULL,
      type TEXT NOT NULL,
      version INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      show_title INTEGER,
      config TEXT,
      data TEXT,
      attrs TEXT NOT NULL DEFAULT '{}',
      html TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      CHECK ((entry_id IS NULL) <> (template_id IS NULL)),
      UNIQUE (entry_id, id),
      UNIQUE (template_id, id)
    )`,

  // What a block points at: an entry by ID or a picture by its
  // stored file name, with the role it plays there (`lib/blocks/blockRefs.ts`).
  // Rewritten whenever its block is written; gone with it. Not `WITHOUT ROWID`:
  // re-encrypting a vault renames pictures in every table by `rowid`
  // (`rewrite_tables` in `reencrypt.rs`).
  block_refs: `
    CREATE TABLE block_refs (
      block_row INTEGER NOT NULL REFERENCES blocks(row_id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('entry', 'image')),
      target TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('content', 'render', 'layer', 'background', 'default')),
      PRIMARY KEY (block_row, target_kind, target, role)
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

  // target_id is polymorphic — an entry or a task, `target_type` says which;
  // no foreign key possible; checkIntegrity() checks the relationship.
  task_links: `
    CREATE TABLE task_links (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('entry', 'task')),
      UNIQUE (task_id, target_id, target_type)
    )`,

  // The languages of the lexicon: one language each with its alphabet,
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

  // The vocabulary of a language. No `deleted_at` of its own: a
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

  // The vault's own symbols for the canvas editor's library, made
  // from drawings: `d` the lines and `solid` the filled parts as path data in a
  // box of 100 × 100, `weight` the lines' width there. No trash: a removed one
  // is gone at once, with undo in memory, like a word of the lexicon.
  symbols: `
    CREATE TABLE symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      d TEXT NOT NULL DEFAULT '',
      solid TEXT NOT NULL DEFAULT '',
      weight REAL NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL
    )`,

  // The vault's images as a place of their own, like tags and categories:
  // a row gives a stored file (`storedImageName`) a name, tags
  // (IDs as JSON, `lib/tagRefs.ts`) and a note. A file without a row is
  // listed too, unnamed, where something shows it; a row keeps its file from the cleanup.
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
 * The indexes of `entries`. `idx_entries_number` keeps the running number
 * unique (it allows any number of NULLs).
 *
 * `idx_entries_list` carries every column that the lists read at startup
 * (`fetchEntries`, first stage), and the tags (`rewriteTagRefs` on open):
 * without it SQLite would read the overflow pages of rows made long by icons
 * and covers as data URLs — and SQLCipher decrypt almost the whole file for
 * it. `deleted_at` leads, so it also serves the range scan of
 * `runPeriodicCleanup`. Icon and cover image are deliberately missing: they can be
 * data URLs. The few entries that carry one are found by the partial index
 * `idx_entries_decorated` — a query uses it only with exactly this
 * condition in its WHERE.
 */
const ENTRIES_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_entries_category ON entries(category_id)',
  'CREATE UNIQUE INDEX idx_entries_number ON entries(entry_number)',
  'CREATE INDEX idx_entries_list ON entries(deleted_at, title, category_id, entry_number, tags, created_at, updated_at, id)',
  'CREATE INDEX idx_entries_decorated ON entries(deleted_at) WHERE icon IS NOT NULL OR cover_image IS NOT NULL',
];

/**
 * All indexes of the schema — what a fresh vault gets: on the foreign key
 * columns, on both sides of `task_links`, an owner's blocks in order, every
 * block pointing at an entry or a picture, and every `deleted_at` column,
 * because `runPeriodicCleanup` runs a range scan over all soft-delete tables
 * every time a vault is opened.
 */
export const INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_task_links_task ON task_links(task_id)',
  'CREATE INDEX idx_task_links_target ON task_links(target_id)',
  'CREATE INDEX idx_tasks_category ON tasks(category_id)',
  'CREATE INDEX idx_tasks_parent ON tasks(parent_task_id)',
  'CREATE INDEX idx_categories_template ON categories(template_id)',
  ...(['tags', 'categories', 'dashboards', 'tasks', 'block_definitions', 'templates', 'languages', 'images'] as const)
    .map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
  'CREATE INDEX idx_lexicon_entries_language ON lexicon_entries(language_id)',
  ...ENTRIES_INDEX_DDL,
  'CREATE INDEX idx_blocks_entry ON blocks(entry_id, position)',
  'CREATE INDEX idx_blocks_template ON blocks(template_id, position)',
  'CREATE INDEX idx_block_refs_target ON block_refs(target_kind, target)',
];


/**
 * Built in: the journal. A dashboard of the same name shows it, and the moon
 * phase belongs to its entries (`entryMoonPhase`).
 */
export const JOURNAL_CATEGORY_ID = 'journal';

/**
 * Built in. A new entry in it starts with the sigil blocks, via the
 * built-in template `core-sigil` as its start template (which the user can
 * change or delete).
 */
export const SIGIL_CATEGORY_ID = 'sigils';

/**
 * Built in: a new entry in it starts with an altar and a text
 * for notes, via the built-in template `core-altar`. An altar is an
 * entry of this category, not a module of its own.
 */
export const ALTAR_CATEGORY_ID = 'altars';

/**
 * The tag "Altar Library": what an Altar block's "Images" show at first,
 * created by the block when it needs it. A fixed ID, so that synced devices
 * arrive at the same tag. An ordinary tag otherwise — renamable, deletable.
 */
export const ALTAR_LIBRARY_TAG_ID = 'altar-library';
export const ALTAR_LIBRARY_TAG_NAME = 'Altar Library';

/** [id, name (database only — `categories.builtin.<id>` is displayed), emoji]. */
export const BUILTIN_CATEGORIES: readonly [string, string, string][] = [
  [JOURNAL_CATEGORY_ID, 'Journal', '📓'],
  [SIGIL_CATEGORY_ID, 'Sigils', '🔯'],
  [ALTAR_CATEGORY_ID, 'Altars', '🪔'],
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

/**
 * The built-in dashboards of a fresh vault, in the order of the rail: key
 * (= ID), the categories their filter starts with, and their order. "All
 * entries" has no filter, so that no entry can become unfindable. Renaming
 * and changing the filters is the user's business afterwards.
 */
export const BUILTIN_DASHBOARDS: readonly {
  key: 'all' | 'journal' | 'operations' | 'wiki';
  categories: readonly string[] | null;
  sort: { by: 'created' | 'title' | 'updated'; dir: 'asc' | 'desc' };
}[] = [
  { key: 'all', categories: null, sort: { by: 'updated', dir: 'desc' } },
  { key: 'journal', categories: [JOURNAL_CATEGORY_ID], sort: { by: 'created', dir: 'desc' } },
  { key: 'operations', categories: [SIGIL_CATEGORY_ID, ALTAR_CATEGORY_ID, 'ritual', 'meditation'], sort: { by: 'updated', dir: 'desc' } },
  { key: 'wiki', categories: ['paradigm', 'herbs', 'crystals', 'candles', 'deities', 'tools'], sort: { by: 'title', dir: 'asc' } },
];

/** The content tables with `category_id`. A literal, because it is interpolated into SQL. */
export const CATEGORIZED_TABLES = ['entries', 'tasks'] as const;

/** Creates tables and indexes. The order follows TABLES. */
export async function createSchema(db: Database): Promise<void> {
  for (const table of TABLES) {
    await db.execute(TABLE_DDL[table]);
  }
  for (const sql of INDEX_DDL) {
    await db.execute(sql);
  }
}

/**
 * Creates the built-in categories, the starter set and the built-in
 * dashboards. Only for fresh vaults. `starterName` translates a
 * STARTER_CATEGORIES key into the app language — the caller passes `i18n.t`
 * through so that this file stays free of i18n. The start templates of
 * `sigils` and `altars` are set by their seeds (`lib/templateRows.ts`).
 */
export async function seedBuiltins(
  db: Database,
  starterName: (key: string) => string
): Promise<void> {
  const rows = [
    ...BUILTIN_CATEGORIES.map(([id, name, emoji]) => ({ id, name, emoji, is_builtin: 1 })),
    ...STARTER_CATEGORIES.map(([key, emoji]) => ({ id: key, name: starterName(key), emoji, is_builtin: 0 })),
  ];
  for (const [i, row] of rows.entries()) {
    await db.execute(
      'INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)',
      [row.id, row.name, row.emoji, i, row.is_builtin]
    );
  }
  const now = new Date().toISOString();
  for (const [i, dashboard] of BUILTIN_DASHBOARDS.entries()) {
    const filter = dashboard.categories ? { categories: [...dashboard.categories] } : {};
    await db.execute(
      `INSERT INTO dashboards (id, builtin, position, filter, sort, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [dashboard.key, dashboard.key, i, JSON.stringify(filter), JSON.stringify(dashboard.sort), now]
    );
  }
}

/** Delete permanently: first detach the contents (ON DELETE RESTRICT), then the row. */
export async function purgeCategory(db: Database, categoryId: string): Promise<void> {
  await reassignCategoryContent(db, categoryId);
  await db.execute('DELETE FROM categories WHERE id=$1', [categoryId]);
}

/**
 * Detaches the category from all its contents and reports how many there
 * were. To be called **before** every permanent deletion of a category: ON
 * DELETE RESTRICT makes the delete fail otherwise, and this ensures that
 * deleting is allowed without any content disappearing — the contents simply
 * become categoryless. It also takes the category out of every dashboard's
 * filter (`dropCategoryFromDashboards`) — both cleanup jobs belong to the
 * same permanent deletion.
 *
 * With `to` the contents move into that category instead — when a
 * restored one merges into the one of the same name (`categoryStore.restoreCategory`)
 * — and the dashboards name `to` where they named it.
 */
export async function reassignCategoryContent(db: Database, categoryId: string, to: string | null = null): Promise<number> {
  let moved = 0;
  for (const table of CATEGORIZED_TABLES) {
    const result = await db.execute(
      `UPDATE ${table} SET category_id = $1 WHERE category_id = $2`,
      [to, categoryId]
    );
    moved += result.rowsAffected ?? 0;
  }
  await replaceCategoryInDashboards(db, categoryId, to);
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
 * polymorphic `task_links`, the category IDs in the dashboards' filters and
 * the tag IDs in entries and templates. Foreign keys cover the rest, which
 * `PRAGMA foreign_key_check` checks.
 *
 * Intended only for verification and diagnosis, not for the production path —
 * the queries scan several tables completely.
 */
export async function checkIntegrity(db: Database): Promise<Orphan[]> {
  const orphans: Orphan[] = [];

  // Polymorphic targets: the *_type field decides where the target is.
  const contentTargets: Record<string, string> = {
    entry: 'SELECT id FROM entries',
    task: 'SELECT id FROM tasks',
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

  // Category IDs in the dashboards' filters.
  const categoryIds = await idsOf('categories');
  const dashboards = await db.select<{ id: string; filter: string | null }[]>('SELECT id, filter FROM dashboards');
  for (const r of dashboards) {
    const filter = rawFilter(r.filter);
    if (!filter) {
      orphans.push({ table: 'dashboards', column: 'filter', id: r.id, missingTarget: '(invalid JSON)' });
      continue;
    }
    for (const category of filterCategories(filter)) {
      if (!categoryIds.has(category)) {
        orphans.push({ table: 'dashboards', column: 'filter', id: r.id, missingTarget: `categories.${category}` });
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

/** A JSON array from a column — `null` if it is not one. */
function rawJsonList(json: string | null): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The raw `filter` JSON of a dashboard row as an object — `null` if it is not one. */
function rawFilter(json: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * The category IDs of a raw filter. The same reading as `parseDashboardFilter`
 * in `lib/dashboards.ts`, which this file does not import.
 */
function filterCategories(filter: Record<string, unknown>): string[] {
  const categories = filter.categories;
  return Array.isArray(categories) ? categories.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * Replaces category `from` in every dashboard's filter by `to`, or drops it
 * (`to` null) — the trash included. `reassignCategoryContent` calls it; do
 * not call it in addition. A filter naming a category that no longer exists
 * would match nothing, and one naming it twice after a merge would be noise.
 */
async function replaceCategoryInDashboards(db: Database, from: string, to: string | null): Promise<void> {
  const rows = await db.select<{ id: string; filter: string | null }[]>(
    'SELECT id, filter FROM dashboards WHERE instr(filter, $1) > 0',
    [from]
  );
  for (const row of rows) {
    const filter = rawFilter(row.filter);
    if (!filter || !Array.isArray(filter.categories)) continue;
    const categories = filterCategories(filter);
    if (!categories.includes(from)) continue;
    const next = [...new Set(categories.map((c) => (c === from ? to : c)).filter((c): c is string => c !== null))];
    await db.execute('UPDATE dashboards SET filter=$1 WHERE id=$2', [JSON.stringify({ ...filter, categories: next }), row.id]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Image references
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The block stack of an entry or template as sync carries it (`content`,
 * `lib/sync/blockStack.ts`). The vault has no such column: its blocks are rows
 * of `blocks`, and what they name is in `block_refs`.
 */
export const BLOCK_STACK_COLUMN = 'content';

/**
 * The columns of a row in which an image can be referenced, besides the
 * blocks (read through `block_refs` and the rows of `blocks`). Three kinds,
 * because they have to be treated differently:
 *
 * - `html` — the reference sits in a `src` attribute. Is rewritten.
 * - `plain` — the column *is* the reference. Is rewritten.
 * - `legacy` — the column today holds a data URL. Is **read**, but never
 *   rewritten.
 *
 * Today only `legacy` holds columns; `html` and `plain` stay for an image
 * column of the future (see "Rules for Future Schema Changes" in `database.md`).
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
 * fall through there as text (see the Base64 note in `database.md`).
 */
export const IMAGE_FIELDS: {
  table: string;
  html: string[];
  plain: string[];
  legacy: string[];
}[] = [
  { table: 'entries', html: [], plain: [], legacy: ['icon', 'cover_image'] },
];

/**
 * Mirrors `is_valid_image_name` in `src-tauri/src/images.rs`: a stored
 * image is named after a hash of its own content — SHA-256, in an
 * encrypted vault one formed with the vault key.
 *
 * The format is a property of the columns, not of the UI — which is why
 * it lives here and not in `images.ts`, which only re-exports it, so that
 * `scripts/schema-check.mjs` can use it without the Tauri modules.
 */
const STORED_IMAGE_RE = /^[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)$/;

/** The same form, unanchored — for collecting from HTML. */
const IMAGE_NAME_RE = /[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)/g;

/** Every stored image name anywhere in a text — markup, JSON, whatever holds it. */
export function storedImageNamesIn(text: string): string[] {
  return text.match(IMAGE_NAME_RE) ?? [];
}

/**
 * The stored file name of a reference, or null. Also accepts a path: the
 * name is its last part.
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

  // Every picture a block names, with whatever role (`block_refs`, rewritten
  // with each save of the block) — of entries and templates, the trash included.
  const refs = await db.select<{ target: string }[]>("SELECT DISTINCT target FROM block_refs WHERE target_kind = 'image'");
  for (const { target } of refs) used.add(target);
  // And every name anywhere in a block's row: what decides about deleting a file
  // for good must not depend on `blockRefs` reading the block — broken JSON, a
  // type from a newer version, a drawing it reads only in part.
  const blockRows = await db.select<Record<string, string | null>[]>('SELECT title, config, data, attrs, html FROM blocks');
  for (const row of blockRows) {
    for (const value of Object.values(row)) {
      for (const match of (value ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
    }
  }

  for (const { table, html, plain, legacy } of IMAGE_FIELDS) {
    const columns = [...html, ...plain, ...legacy];
    if (!columns.length) continue;
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
  // a copy writes it into a block.
  const definitions = await db.select<{ elements: string | null }[]>('SELECT elements FROM block_definitions');
  for (const { elements } of definitions) {
    for (const match of (elements ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
  }

  // Images taken into "Images" stay, used anywhere or not. A row in the trash
  // keeps its file until it is deleted for good. So do the places it was taken
  // out of (`detached`): a canvas lost its render with it, and a restore writes
  // them back.
  const kept = await db.select<{ file: string; detached: string | null }[]>('SELECT file, detached FROM images');
  for (const { file, detached } of kept) {
    if (storedImageName(file)) used.add(file);
    for (const match of (detached ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
  }

  return used;
}
