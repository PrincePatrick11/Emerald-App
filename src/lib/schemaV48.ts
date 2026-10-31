/**
 * Frozen schema, as of v48 — every table that a later migration
 * rebuilt: the three entry tables before v49 (`unifyEntries.ts`)
 * merges them into `entries`, and `tasks`, `altar_items` and `tags` before
 * v50, v52, v53 and v54 remove or add columns.
 *
 * The migrations before that still build or read these tables: v33 creates
 * `journal_entries` and `tags` (`schemaV37.ts` fetches them from here), v38 and
 * v39 rebuild `wiki_articles`, `operations`, `tasks` and `altar_items`, v35
 * runs over their image columns, v48 over their titles. In the live `schema.ts`
 * they look different or are missing — so they stand here as they
 * looked up to then.
 * **Change nothing here:** `scripts/schema-check.mjs` proves that the chain
 * via this state ends up at the same schema as a fresh vault.
 */
import { TABLE_DDL, type TableName } from './schema';

export type V48Table = 'journal_entries' | 'wiki_articles' | 'operations' | 'tasks' | 'altar_items' | 'tags';

export const V48_TABLE_DDL: Record<V48Table, string> = {
  // `affected_ids`: whom a tag in the trash is given back to on
  // restoring — until v53 tags were attached to entries by name.
  tags: `
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#8347ff',
      affected_ids TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT
    )`,

  altar_items: `
    CREATE TABLE altar_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '✨',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      note TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_at TEXT NOT NULL
    )`,

  // `tags` was never read or written (v50 removes it).
  tasks: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Task',
      description TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
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

  // paradigm_id, bannung_type_wiki_id, meditation_type_wiki_id and the two
  // linked_*_ids arrays refer to wiki articles and operations respectively
  // (emptied and unread since v36/v37).
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
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
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
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
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
};

/** The DDL that a migration up to v48 means for `table`: the frozen version, otherwise the live one. */
export function ddlBeforeV49(table: string): string {
  return (V48_TABLE_DDL as Record<string, string>)[table] ?? TABLE_DDL[table as TableName];
}

/** The image columns up to v48 — v35 runs over them (see `IMAGE_FIELDS` in `schema.ts`). */
export const IMAGE_FIELDS_V48: { table: string; html: string[]; plain: string[]; legacy: string[] }[] = [
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

/** The tables with a title up to v48 — v48 (`untitled_is_empty`) clears their default titles. */
export const TITLED_TABLES_V48 = ['journal_entries', 'wiki_articles', 'operations', 'tasks', 'altars'] as const;
