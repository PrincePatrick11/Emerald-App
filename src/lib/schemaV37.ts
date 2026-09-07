/**
 * Eingefrorenes Schema, Stand v37 — der Zustand, den Migration v33
 * (`normalizeSchema.ts`) herstellt.
 *
 * Bis v37 hat v33 direkt aus `schema.ts` gebaut, weil beide dasselbe Schema
 * meinten. Seit v38 die vier Kategorie-Tabellen zu einer zusammenlegt, stimmt
 * das nicht mehr: Liefe v33 gegen das lebende DDL, legte es auf alten Vaults
 * `categories` an und scheiterte beim Kopieren der Inhalte, deren Spalten es
 * nicht mehr gibt. Also bekommt v33 hier seine eigene Kopie der Tabellen, die
 * sich seither geändert haben. Alle anderen zieht es weiter aus `schema.ts` —
 * **wer eine davon in einer späteren Migration ändert, friert sie hier ein.**
 *
 * `scripts/schema-check.mjs` beweist weiterhin, dass Baseline und Kettenende
 * beim identischen Schema landen.
 *
 * Zweite Aufgabe der Datei: die eingebauten Kategorien von damals als Daten
 * (`LEGACY_*_CATEGORIES`), die v36–v38 und der Import alter Dateien noch
 * brauchen, um IDs von früher zu Namen und Emojis aufzulösen.
 */
import { TABLE_DDL, type TableName } from './schema';

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
  V37_TABLES.map((t) => [t, FROZEN[t] ?? TABLE_DDL[t as TableName]])
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
 * Die eingebauten Kategorien von vor v38, wie die Kette v7/v12/v22 sie
 * angelegt hat: [id, Seed-Name, Emoji]. Gebraucht von den Migrationen v36–v38
 * (Emoji-Rückfall, Erkennung „noch nicht umbenannt") und vom Import alter
 * `.emerald`-Dateien, die eine Wiki-Kategorie noch über ihre Builtin-ID nennen.
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
