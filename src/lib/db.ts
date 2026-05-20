import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { getActiveDbName } from './vaultManager';

// Per-vault DB cache: SQLite identifier → Database instance
const _dbCache = new Map<string, Database>();
// Serialises the first-load for each vault to avoid duplicate runMigrations calls
const _initPromises = new Map<string, Promise<Database>>();

/** Drop all cached connections. Call before switching vaults. */
export function resetDbCache(): void {
  _dbCache.clear();
  _initPromises.clear();
}

export async function getDb(): Promise<Database> {
  const dbName = await getActiveDbName();
  const identifier = `sqlite:${dbName}`;

  if (_dbCache.has(identifier)) return _dbCache.get(identifier)!;
  if (_initPromises.has(identifier)) return _initPromises.get(identifier)!;

  const promise = (async () => {
    await invoke('ensure_app_storage_dirs');
    const db = await Database.load(identifier);
    await runMigrations(db);
    _dbCache.set(identifier, db);
    _initPromises.delete(identifier);
    return db;
  })();

  _initPromises.set(identifier, promise);
  return promise;
}

async function runMigrations(db: Database): Promise<void> {
  // Use DELETE journal mode — simpler than WAL, survives unclean shutdowns
  await db.execute('PRAGMA journal_mode = DELETE');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Entry',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      moon_phase TEXT,
      mood TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Article',
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#8347ff'
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS links (
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    )
  `);

  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)'
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS altars (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Altar',
      intention TEXT NOT NULL DEFAULT '',
      background_preset TEXT NOT NULL DEFAULT 'midnight',
      background_image_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS altar_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '✨',
      category TEXT NOT NULL DEFAULT 'other',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS altar_placements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 50,
      y REAL NOT NULL DEFAULT 50
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS altar_intentions (
      date TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT ''
    )
  `);

  // Migration: add deleted_at column for soft-delete / trash (30-day retention)
  for (const table of ['journal_entries', 'wiki_articles']) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // Migration: image_data for altar items + scale for placements
  try {
    await db.execute(`ALTER TABLE altar_items ADD COLUMN image_data TEXT`);
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE altar_placements ADD COLUMN scale REAL NOT NULL DEFAULT 1`);
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE altar_placements ADD COLUMN altar_id TEXT`);
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE altars ADD COLUMN background_preset TEXT NOT NULL DEFAULT 'midnight'`);
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE altars ADD COLUMN background_image_data TEXT`);
  } catch { /* already exists */ }

  const existingAltars = await db.select<{ id: string }[]>('SELECT id FROM altars ORDER BY created_at ASC, title ASC');
  let defaultAltarId = existingAltars[0]?.id;
  if (!defaultAltarId) {
    defaultAltarId = crypto.randomUUID();
    const legacyIntention = await db.select<{ text: string }[]>(
      'SELECT text FROM altar_intentions ORDER BY date DESC LIMIT 1'
    );
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO altars (id, title, intention, background_preset, background_image_data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [defaultAltarId, 'Primary Altar', legacyIntention[0]?.text ?? '', 'midnight', null, now, now]
    );
  }
  await db.execute('UPDATE altar_placements SET altar_id=$1 WHERE altar_id IS NULL', [defaultAltarId]);

  // Migration: add deleted_at + affected_ids to tags (for trash support)
  try {
    await db.execute(`ALTER TABLE tags ADD COLUMN deleted_at TEXT`);
  } catch { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE tags ADD COLUMN affected_ids TEXT NOT NULL DEFAULT '[]'`);
  } catch { /* already exists */ }

  // Migration: cover image for wiki articles
  try {
    await db.execute(`ALTER TABLE wiki_articles ADD COLUMN cover_image TEXT`);
  } catch { /* already exists */ }

  // Migration: custom icon for wiki articles
  try {
    await db.execute(`ALTER TABLE wiki_articles ADD COLUMN icon TEXT`);
  } catch { /* already exists */ }

  // Operations tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS operation_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '⚡',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Operation',
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Creation',
      description TEXT NOT NULL DEFAULT '',
      target_reveal_date TEXT,
      charging_technique_wiki_id TEXT,
      is_loaded INTEGER NOT NULL DEFAULT 0,
      tool_type TEXT NOT NULL DEFAULT 'sigil',
      intention_text TEXT NOT NULL DEFAULT '',
      letter_bank TEXT NOT NULL DEFAULT '[]',
      implemented_letters TEXT NOT NULL DEFAULT '[]',
      show_intention_in_properties INTEGER NOT NULL DEFAULT 1,
      show_letter_bank_in_properties INTEGER NOT NULL DEFAULT 1,
      show_sigil INTEGER NOT NULL DEFAULT 1,
      drawing_data TEXT,
      thumbnail_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT
    )
  `);

  // Seed built-in categories if not present (use fixed IDs for i18n)
  const catCount = await db.select<{ n: number }[]>('SELECT COUNT(*) as n FROM operation_categories WHERE is_builtin=1');
  if ((catCount[0]?.n ?? 0) === 0) {
    await db.execute(
      `INSERT INTO operation_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
      ['sigils', 'Sigils', '🔯', 0, 1]
    );
    await db.execute(
      `INSERT INTO operation_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
      ['servitors', 'Servitors', '👁️', 1, 1]
    );
  }

  // Migration: replace UUID-based built-in op category IDs with fixed string IDs
  for (const [fixedId, sortOrder] of [['sigils', 0], ['servitors', 1]] as const) {
    const exists = await db.select<{ n: number }[]>(
      'SELECT COUNT(*) as n FROM operation_categories WHERE id = $1', [fixedId]
    );
    if ((exists[0]?.n ?? 0) > 0) continue;
    const old = await db.select<{ id: string }[]>(
      'SELECT id FROM operation_categories WHERE is_builtin=1 AND sort_order=$1', [sortOrder]
    );
    if (old.length === 0) continue;
    const oldId = old[0].id;
    await db.execute(
      `INSERT OR IGNORE INTO operation_categories (id, name, emoji, sort_order, is_builtin)
       SELECT $1, name, emoji, sort_order, is_builtin FROM operation_categories WHERE id = $2`,
      [fixedId, oldId]
    );
    await db.execute(`UPDATE operations SET category_id = $1 WHERE category_id = $2`, [fixedId, oldId]);
    await db.execute(`DELETE FROM operation_categories WHERE id = $1`, [oldId]);
  }

  // Migration: entry_number for disambiguation of same-name entries.
  // Seeded from ROWID (always exists, never reused within a table) rather than
  // AUTOINCREMENT so that existing rows get a stable, compact number without
  // schema changes. New rows inherit ROWID via the store INSERT.
  try {
    await db.execute(`ALTER TABLE journal_entries ADD COLUMN entry_number INTEGER`);
  } catch { /* already exists */ }
  await db.execute(`UPDATE journal_entries SET entry_number = ROWID WHERE entry_number IS NULL`);

  try {
    await db.execute(`ALTER TABLE wiki_articles ADD COLUMN entry_number INTEGER`);
  } catch { /* already exists */ }
  await db.execute(`UPDATE wiki_articles SET entry_number = ROWID WHERE entry_number IS NULL`);

  try {
    await db.execute(`ALTER TABLE operations ADD COLUMN entry_number INTEGER`);
  } catch { /* already exists */ }
  await db.execute(`UPDATE operations SET entry_number = ROWID WHERE entry_number IS NULL`);

  try {
    await db.execute(`ALTER TABLE creations ADD COLUMN entry_number INTEGER`);
  } catch { /* already exists */ }
  await db.execute(`UPDATE creations SET entry_number = ROWID WHERE entry_number IS NULL`);
  try { await db.execute(`ALTER TABLE creations ADD COLUMN target_reveal_date TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN charging_technique_wiki_id TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN is_loaded INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN intention_text TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN letter_bank TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN implemented_letters TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN show_intention_in_properties INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN show_letter_bank_in_properties INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE creations ADD COLUMN show_sigil INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  await db.execute(`UPDATE creations SET tool_type='sigil' WHERE tool_type IS NULL OR tool_type='drawing'`);

  // Migration: operation properties (active status, end date, version)
  try { await db.execute(`ALTER TABLE operations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN end_date TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN version TEXT`); } catch { /* exists */ }
  // Migration: operation icon + cover image
  try { await db.execute(`ALTER TABLE operations ADD COLUMN icon TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN cover_image TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN description TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN target_reveal_date TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN charging_technique_wiki_id TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN is_loaded INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN intention_text TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN letter_bank TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN implemented_letters TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN show_intention_in_properties INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN show_letter_bank_in_properties INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN show_sigil INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN drawing_data TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operations ADD COLUMN thumbnail_data TEXT`); } catch { /* exists */ }

  // Wiki categories table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📄',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  const wikiCatCount = await db.select<{ n: number }[]>('SELECT COUNT(*) as n FROM wiki_categories WHERE is_builtin=1');
  if ((wikiCatCount[0]?.n ?? 0) === 0) {
    const builtinCats = [
      { id: 'paradigm',   name: 'Paradigma',  emoji: '🌀', sort_order: 0 },
      { id: 'bannung',    name: 'Bannung',    emoji: '🚫', sort_order: 1 },
      { id: 'meditation', name: 'Meditation', emoji: '🧘', sort_order: 2 },
      { id: 'ritual',     name: 'Ritual',     emoji: '🕯️', sort_order: 3 },
      { id: 'deity',      name: 'Deity',      emoji: '✨',  sort_order: 4 },
      { id: 'herb',       name: 'Herb',       emoji: '🌿',  sort_order: 5 },
      { id: 'symbol',     name: 'Symbol',     emoji: '🔮',  sort_order: 6 },
      { id: 'tool',       name: 'Tool',       emoji: '⚗️',  sort_order: 7 },
      { id: 'concept',    name: 'Concept',    emoji: '📖',  sort_order: 8 },
      { id: 'spell',      name: 'Spell',      emoji: '🌙',  sort_order: 9 },
      { id: 'other',      name: 'Other',      emoji: '📄',  sort_order: 10 },
    ];
    for (const cat of builtinCats) {
      await db.execute(
        `INSERT INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
        [cat.id, cat.name, cat.emoji, cat.sort_order, 1]
      );
    }
  }

  // Custom properties (user-defined per entry)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS custom_properties (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      value TEXT,
      meta TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_custom_props_entry ON custom_properties(entry_id, entry_type)'
  );
  // Migration: meta + show_in_entry columns for existing installations
  try { await db.execute(`ALTER TABLE custom_properties ADD COLUMN meta TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE custom_properties ADD COLUMN show_in_entry INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  // Migration: rename old 'checkbox' type to 'toggle' (checkbox is now a separate simple type)
  await db.execute(`UPDATE custom_properties SET type='toggle' WHERE type='checkbox'`);

  // Migration: add built-in wiki categories + fix sort orders
  await db.execute(
    `INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('paradigm','Paradigma','🌀',0,1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('bannung','Bannung','🚫',1,1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('meditation','Meditation','🧘',2,1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('sigil_charging','Sigil Charging','⚡',3,1)`
  );
  // Set canonical sort order for all built-ins (idempotent)
  for (const [id, order] of [['paradigm',0],['bannung',1],['meditation',2],['sigil_charging',3],['ritual',4],['deity',5],['herb',6],['symbol',7],['tool',8],['concept',9],['spell',10],['other',11]] as [string,number][]) {
    await db.execute(`UPDATE wiki_categories SET sort_order=$1 WHERE id=$2 AND is_builtin=1`, [order, id]);
  }
  // Routines table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📋',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Migration: operation_ids + wiki_ids on routines
  try { await db.execute(`ALTER TABLE routines ADD COLUMN operation_ids TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE routines ADD COLUMN wiki_ids TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }

  // Migration: paradigm_id + linked_operation_ids + linked_wiki_ids on journal entries
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN paradigm_id TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN linked_operation_ids TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN linked_wiki_ids TEXT`); } catch { /* exists */ }

  // Migration: bannung + meditation tracking on journal entries
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN is_bannung INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN bannung_type_wiki_id TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN is_meditation INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN meditation_duration INTEGER`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE journal_entries ADD COLUMN meditation_type_wiki_id TEXT`); } catch { /* exists */ }

  // Migration: soft-delete support for categories
  try { await db.execute(`ALTER TABLE wiki_categories ADD COLUMN deleted_at TEXT`); } catch { /* exists */ }
  try { await db.execute(`ALTER TABLE operation_categories ADD COLUMN deleted_at TEXT`); } catch { /* exists */ }

  // Auto-purge trash items older than 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const table of ['journal_entries', 'wiki_articles', 'tags', 'operations', 'creations', 'wiki_categories', 'operation_categories']) {
    await db.execute(
      `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
      [cutoff]
    );
  }

  // Task categories table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📋',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    )
  `);

  // Tasks table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Task',
      description TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      parent_task_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT
    )
  `);

  // Task links table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_links (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL
    )
  `);

  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id)'
  );
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_id)'
  );

  // Seed default category (idempotent)
  await db.execute(
    `INSERT OR IGNORE INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
    ['general', 'Allgemein', '📋', 0, 0]
  );

  // Auto-purge tasks from trash
  await db.execute(
    `DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoff]
  );
  await db.execute(
    `DELETE FROM task_categories WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoff]
  );
}
