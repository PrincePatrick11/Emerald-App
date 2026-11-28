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
 * schema history, which is gone: such a vault is recognised and
 * refused, not changed (`VAULT_OUTDATED` in `db.ts`). So are v100, the first
 * fresh schema, which still told entries apart by a type, and v101, which kept
 * tags as JSON and icons as data URLs in the rows: neither was released.
 */
export const FRESH_START_VERSION = 102;

/**
 * What a fresh vault is stamped with. Equals the last step in `MIGRATIONS`
 * (`FRESH_START_VERSION` while there is none); `db.ts` checks this at startup
 * so that a new migration step cannot be forgotten.
 */
export const BASELINE_VERSION = 103;

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
  'entry_tags',
  'template_tags',
  'tasks',
  'task_links',
  'languages',
  'lexicon_entries',
  'symbols',
  'images',
  'image_tags',
] as const;

type TableName = (typeof TABLES)[number];

export const TABLE_DDL: Record<TableName, string> = {
  schema_version: `
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,

  // Entries, templates and pictures carry tags through `entry_tags`,
  // `template_tags` and `image_tags` (`lib/tagRefs.ts`). A tag in the trash
  // stays linked; deleted for good, its links go with it (CASCADE).
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
  // that vaults and backups agree on them. `filter`, `sort` and
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
  // - The moon phase is a block (`core.moon`) that follows from
  //   `created_at`; it is not a column.
  // - `icon`: an emoji, or the stored name of a file in `icons/` (`ICON_FIELDS`).
  // - `cover_image`: the stored name of a picture in `images/` (`IMAGE_FIELDS`).
  // - Tags in `entry_tags`.
  entries: `
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      icon TEXT,
      cover_image TEXT,
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

  // What a block points at: an entry or a tag by ID, a picture or an icon by
  // its stored file name, with the role it plays there (`lib/blocks/blockRefs.ts`;
  // each block type reports its own). A tag here is one the block gives its
  // entry while it is there — never in `entry_tags`.
  // Rewritten whenever its block is written; gone with it. Not `WITHOUT ROWID`:
  // re-encrypting a vault renames pictures in every table by `rowid`
  // (`rewrite_database` in `reencrypt.rs`).
  block_refs: `
    CREATE TABLE block_refs (
      block_row INTEGER NOT NULL REFERENCES blocks(row_id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('entry', 'image', 'icon', 'tag')),
      target TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('content', 'render', 'layer', 'background', 'default', 'icon', 'tag')),
      PRIMARY KEY (block_row, target_kind, target, role)
    )`,

  // The tags of an entry, a template and a picture: one row per tag, in the
  // order they were given (`rowid`, `lib/tagRefs.ts`). Gone with their owner
  // and with the tag (CASCADE). Not `WITHOUT ROWID`, like `block_refs`.
  entry_tags: `
    CREATE TABLE entry_tags (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    )`,

  template_tags: `
    CREATE TABLE template_tags (
      template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (template_id, tag_id)
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
  // (`image_tags`) and a note. A file without a row is
  // listed too, unnamed, where something shows it; a row keeps its file from the cleanup.
  // `detached` (JSON) holds, while the picture is in the trash, the texts it
  // was taken out of, so that restoring it puts it back there.
  images: `
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      detached TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  image_tags: `
    CREATE TABLE image_tags (
      image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (image_id, tag_id)
    )`,
};

/**
 * The indexes of `entries`. `idx_entries_number` keeps the running number
 * unique (it allows any number of NULLs).
 *
 * `idx_entries_list` carries every column that the lists read at startup
 * (`fetchEntries`, first stage): without it SQLite would read the table, and
 * SQLCipher decrypt every page of it. `deleted_at` leads, so it also serves
 * the range scan of `runPeriodicCleanup`. Icon and cover image are in it: both
 * hold a short stored file name, never a data URL.
 */
const ENTRIES_INDEX_DDL: readonly string[] = [
  'CREATE INDEX idx_entries_category ON entries(category_id)',
  'CREATE UNIQUE INDEX idx_entries_number ON entries(entry_number)',
  'CREATE INDEX idx_entries_list ON entries(deleted_at, title, category_id, entry_number, icon, cover_image, created_at, updated_at, id)',
];

/**
 * All indexes of the schema — what a fresh vault gets: on the foreign key
 * columns, on both sides of `task_links`, an owner's blocks in order, every
 * block pointing at an entry or a picture, and every `deleted_at` column,
 * because `runPeriodicCleanup` runs a range scan over all soft-delete tables
 * every time a vault is opened.
 */
const INDEX_DDL: readonly string[] = [
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
  // What is pointed at, by kind ("Images", linked entries, a block's tags).
  'CREATE INDEX idx_block_refs_target ON block_refs(target_kind, target)',
  // The other side of the tag links: what carries a tag (`TagsView`, a
  // dashboard filter by tag, merging tags).
  'CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id)',
  'CREATE INDEX idx_template_tags_tag ON template_tags(tag_id)',
  'CREATE INDEX idx_image_tags_tag ON image_tags(tag_id)',
];


/**
 * Built in: the journal. A dashboard of the same name shows it; a new entry
 * in it starts with the built-in template `core-journal` (moon phase and text).
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
 * The dream journal of the starter set: an ordinary category, renamable and
 * deletable, whose new entries start with the built-in template `core-dreams`
 * while it is there.
 */
export const DREAMS_CATEGORY_ID = 'dreams';

/** The other starter categories; each starts with a built-in template of its own (`templateRows.ts`). */
export const RITUAL_CATEGORY_ID = 'ritual';
export const DEITIES_CATEGORY_ID = 'deities';
export const CRYSTALS_CATEGORY_ID = 'crystals';

/** [id, name (database only — `categories.builtin.<id>` is displayed), emoji]. */
const BUILTIN_CATEGORIES: readonly [string, string, string][] = [
  [JOURNAL_CATEGORY_ID, 'Journal', '📓'],
  [SIGIL_CATEGORY_ID, 'Sigils', '🔯'],
  [ALTAR_CATEGORY_ID, 'Altars', '🪔'],
];

/**
 * What a fresh vault gets besides the built-ins: normal, renamable and
 * deletable categories, created in the app language (`categories.starter.<key>`).
 * The keys are at the same time the IDs.
 */
const STARTER_CATEGORIES: readonly [string, string][] = [
  [DREAMS_CATEGORY_ID, '💭'],
  [RITUAL_CATEGORY_ID, '🪄'],
  [DEITIES_CATEGORY_ID, '✨'],
  [CRYSTALS_CATEGORY_ID, '🔮'],
];

/**
 * The IDs of the starter set. They are the same in every vault while the
 * names are translated, so a backup matches a starter by ID, like a built-in.
 */
export const STARTER_CATEGORY_IDS: ReadonlySet<string> = new Set(STARTER_CATEGORIES.map(([key]) => key));

/**
 * The built-in dashboards of a fresh vault, in the order of the rail: key
 * (= ID), the categories their filter starts with, and their order. "All
 * entries" has no filter, so that no entry can become unfindable. Renaming
 * and changing the filters is the user's business afterwards.
 */
const BUILTIN_DASHBOARDS: readonly {
  key: 'all' | 'journal' | 'practice' | 'knowledge';
  categories: readonly string[] | null;
  sort: { by: 'created' | 'title' | 'updated'; dir: 'asc' | 'desc' };
  /** The start values of the `display` column — afterwards the row is all the app reads. */
  display: { view: 'list' | 'cards'; grouping: 'grouped' | 'flat' };
}[] = [
  { key: 'all', categories: null, sort: { by: 'updated', dir: 'desc' }, display: { view: 'list', grouping: 'flat' } },
  { key: 'journal', categories: [JOURNAL_CATEGORY_ID, DREAMS_CATEGORY_ID], sort: { by: 'created', dir: 'desc' }, display: { view: 'list', grouping: 'flat' } },
  { key: 'practice', categories: [SIGIL_CATEGORY_ID, ALTAR_CATEGORY_ID, RITUAL_CATEGORY_ID], sort: { by: 'updated', dir: 'desc' }, display: { view: 'list', grouping: 'grouped' } },
  { key: 'knowledge', categories: [DEITIES_CATEGORY_ID, CRYSTALS_CATEGORY_ID], sort: { by: 'title', dir: 'asc' }, display: { view: 'cards', grouping: 'grouped' } },
];

/** The content tables with `category_id`. A literal, because it is interpolated into SQL. */
const CATEGORIZED_TABLES = ['entries', 'tasks'] as const;

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
 * through so that this file stays free of i18n. The start templates of the
 * categories are set by their seeds (`lib/templateRows.ts`).
 */
export async function seedBuiltins(
  db: Database,
  starterName: (key: string) => string
): Promise<void> {
  const builtins = BUILTIN_CATEGORIES.map(([id, name, emoji]) => ({ id, name, emoji, is_builtin: 1 }));
  const starters = STARTER_CATEGORIES.map(([key, emoji]) => ({ id: key, name: starterName(key), emoji, is_builtin: 0 }));
  // The dream journal comes right after the journal, ahead of sigils and altars.
  const afterJournal = starters.filter((c) => c.id === DREAMS_CATEGORY_ID);
  const rows = [
    ...builtins.filter((c) => c.id === JOURNAL_CATEGORY_ID),
    ...afterJournal,
    ...builtins.filter((c) => c.id !== JOURNAL_CATEGORY_ID),
    ...starters.filter((c) => c.id !== DREAMS_CATEGORY_ID),
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
      `INSERT INTO dashboards (id, builtin, position, filter, sort, display, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [dashboard.key, dashboard.key, i, JSON.stringify(filter), JSON.stringify(dashboard.sort), JSON.stringify(dashboard.display), now]
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
interface Orphan {
  table: string;
  column: string;
  id: string;
  missingTarget: string;
}

/**
 * Checks the relationships for which no foreign key can be declared: the
 * polymorphic `task_links` and the category and tag IDs in the dashboards'
 * filters. Foreign keys cover the rest — the tag links too —, which
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

  // Category and tag IDs in the dashboards' filters, the trash included: an
  // ID without a row points nowhere.
  const categoryIds = await idsOf('categories');
  const tagIds = await idsOf('tags');
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
    for (const tag of filterIds(filter, 'tags')) {
      if (!tagIds.has(tag)) {
        orphans.push({ table: 'dashboards', column: 'filter', id: r.id, missingTarget: `tags.${tag}` });
      }
    }
  }

  return orphans;
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
  return filterIds(filter, 'categories');
}

/** The IDs of one list of a raw filter (`categories`, `tags`). */
function filterIds(filter: Record<string, unknown>, key: 'categories' | 'tags'): string[] {
  const ids = filter[key];
  return Array.isArray(ids) ? ids.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * Drops tags that are gone for good from every dashboard's filter, the trash
 * included — the counterpart of `replaceCategoryInDashboards` for tags. A
 * merged tag is replaced by the one it merged into (`to`).
 */
export async function replaceTagsInDashboards(db: Database, from: Iterable<string>, to: string | null = null): Promise<void> {
  const gone = new Set(from);
  if (!gone.size) return;
  const rows = await db.select<{ id: string; filter: string | null }[]>('SELECT id, filter FROM dashboards');
  for (const row of rows) {
    const filter = rawFilter(row.filter);
    if (!filter || !Array.isArray(filter.tags)) continue;
    const tags = filterIds(filter, 'tags');
    if (!tags.some((t) => gone.has(t))) continue;
    const next = [...new Set(tags.map((t) => (gone.has(t) ? to : t)).filter((t): t is string => t !== null))];
    await db.execute('UPDATE dashboards SET filter=$1 WHERE id=$2', [JSON.stringify({ ...filter, tags: next }), row.id]);
  }
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
 * The columns of a row in which a picture of `images/` can be referenced,
 * besides the blocks (read through `block_refs` and the rows of `blocks`). Two
 * kinds, because they are rewritten differently on import:
 *
 * - `html` — the reference sits in a `src` attribute.
 * - `plain` — the column *is* the reference.
 *
 * The list has to be complete: `collectUsedImageFilenames` decides which file
 * the cleanup action may delete, and a column missing here would be a
 * reference nobody sees. Icons are not pictures of `images/`: their columns
 * are in `ICON_FIELDS`.
 */
export const IMAGE_FIELDS: {
  table: string;
  html: string[];
  plain: string[];
}[] = [
  { table: 'entries', html: [], plain: ['cover_image'] },
];

/**
 * The columns that hold an icon: an emoji, or the stored name of a file in the
 * vault's `icons/` folder (`lib/icons.ts`) — never a data URL. A custom
 * block's copies carry its icon in `blocks.config` and name it in
 * `block_refs` (`target_kind` 'icon'). `collectUsedIconFilenames` and the
 * backup read exactly these.
 */
export const ICON_FIELDS: readonly { table: string; column: string }[] = [
  { table: 'entries', column: 'icon' },
  { table: 'templates', column: 'icon' },
  { table: 'block_definitions', column: 'icon' },
  { table: 'languages', column: 'icon' },
  { table: 'dashboards', column: 'icon' },
];

/**
 * All icon file names this vault references — the trash included, like
 * `collectUsedImageFilenames`: the icon columns, every icon a block names
 * (`block_refs`), and every stored name anywhere in a block's row or a
 * template draft's copy, so that a block `blockRefs` cannot read keeps its
 * icon. Pictures of `images/` that match by chance only make the set larger.
 */
export async function collectUsedIconFilenames(db: Database): Promise<Set<string>> {
  const used = new Set<string>();
  for (const { table, column } of ICON_FIELDS) {
    const rows = await db.select<{ icon: string | null }[]>(`SELECT ${column} AS icon FROM ${table}`);
    for (const { icon } of rows) {
      const name = storedImageName(icon);
      if (name) used.add(name);
    }
  }
  const refs = await db.select<{ target: string }[]>("SELECT DISTINCT target FROM block_refs WHERE target_kind = 'icon'");
  for (const { target } of refs) used.add(target);
  const blockRows = await db.select<{ config: string | null; attrs: string | null }[]>('SELECT config, attrs FROM blocks');
  for (const row of blockRows) {
    for (const value of Object.values(row)) {
      for (const match of (value ?? '').matchAll(IMAGE_NAME_RE)) used.add(match[0]);
    }
  }
  return used;
}

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
 * For everything that does not need to distinguish between the two groups — the
 * backup export and both import modes simply want "every column in which an
 * image can be".
 */
export function imageColumns(table: string): string[] {
  const entry = IMAGE_FIELDS.find((f) => f.table === table);
  return entry ? [...entry.html, ...entry.plain] : [];
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

  for (const { table, html, plain } of IMAGE_FIELDS) {
    const columns = [...html, ...plain];
    if (!columns.length) continue;
    const rows = await db.select<Record<string, string | null>[]>(
      `SELECT ${columns.join(', ')} FROM ${table}`
    );
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (!value) continue;
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
