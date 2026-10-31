/**
 * Frozen schema, as of v37 — the state that migration v33
 * (`normalizeSchema.ts`) produces.
 *
 * Up to v37, v33 built directly from `schema.ts`, because both meant the same
 * schema. Since v38 merges the four category tables into one, that is no
 * longer true: if v33 ran against the live DDL, it would create `categories`
 * on old vaults and fail when copying the contents, whose columns no longer
 * exist. So v33 gets its own copy here of the tables that have changed
 * since. It still pulls all the others from `schema.ts` —
 * **whoever changes one of them in a later migration freezes it here.**
 * (`journal_entries` comes from `schemaV48.ts`: unchanged up to v48, merged
 * into `entries` since v49.)
 *
 * `scripts/schema-check.mjs` continues to prove that baseline and chain end
 * land on the identical schema.
 *
 * The file's second job: the built-in categories of that time as data
 * (`LEGACY_*_CATEGORIES`), which v36–v38 and the import of old files still
 * need to resolve IDs from back then to names and emojis.
 */
import { ddlBeforeV49 } from './schemaV48';

export const V37_TABLES = [
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

export type V37TableName = (typeof V37_TABLES)[number];

const V37_SOFT_DELETE_TABLES = [
  'journal_entries',
  'wiki_articles',
  'tags',
  'operations',
  'wiki_categories',
  'operation_categories',
  'tasks',
  'task_categories',
] as const;

const FROZEN: Partial<Record<V37TableName, string>> = {
  // Since v47 (`drop_links`) the table no longer exists — v33 still builds it.
  links: `
    CREATE TABLE links (
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    )`,

  // Since v46 (`altars_soft_delete`) the table carries `deleted_at` — v33 builds it without.
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

  // Since v44 (`routines_to_templates`) the table no longer exists in the live schema.
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
};

export const V37_TABLE_DDL: Record<V37TableName, string> = Object.fromEntries(
  V37_TABLES.map((t) => [t, FROZEN[t] ?? ddlBeforeV49(t)])
) as Record<V37TableName, string>;

export const V37_INDEX_DDL: string[] = [
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
  ...V37_SOFT_DELETE_TABLES.map((t) => `CREATE INDEX idx_${t}_deleted ON ${t}(deleted_at)`),
];

/**
 * The built-in categories from before v38, as the chain v7/v12/v22 created
 * them: [id, seed name, emoji]. Needed by migrations v36–v38
 * (emoji fallback, detection of "not renamed yet") and by the import of old
 * `.emerald` files that still name a wiki category by its built-in ID.
 */
export const LEGACY_WIKI_CATEGORIES: readonly [string, string, string][] = [
  ['paradigm', 'Paradigma', '🌀'],
  ['bannung', 'Bannung', '🚫'],
  ['meditation', 'Meditation', '🧘'],
  ['sigil_charging', 'Sigil Charging', '⚡'],
  ['ritual', 'Ritual', '🕯️'],
  ['deity', 'Deity', '✨'],
  ['herb', 'Herb', '🌿'],
  ['symbol', 'Symbol', '🔮'],
  ['tool', 'Tool', '⚗️'],
  ['concept', 'Concept', '📖'],
  ['spell', 'Spell', '🌙'],
  ['other', 'Other', '📄'],
];

export const LEGACY_ALTAR_CATEGORIES: readonly [string, string, string][] = [
  ['candle', 'Candle', '🕯️'],
  ['crystal', 'Crystal', '🔮'],
  ['deity', 'Deity', '✨'],
  ['herb', 'Herb', '🌿'],
  ['other', 'Other', '📦'],
  ['symbol', 'Symbol', '🌙'],
  ['table', 'Table', '🪵'],
  ['tool', 'Tool', '🔔'],
];
