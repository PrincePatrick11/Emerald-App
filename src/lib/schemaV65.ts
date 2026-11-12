/**
 * Frozen schema, as of v65 — the two tables that still carried the block
 * stack as `content` until v66 dropped the column (`dropContentColumns` in
 * `db.ts`). v43 creates `templates` and v49 creates `entries` in this shape:
 * the migrations between them and v66 (v44, v49, v61–v65) read and write
 * `content`, and v66 then gives it up.
 * **Change nothing here:** `scripts/schema-check.mjs` proves that the chain
 * via this state ends up at the same schema as a fresh vault.
 */

export const TEMPLATES_DDL_V65 = `
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
    )`;

export const ENTRIES_DDL_V65 = `
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
    )`;
