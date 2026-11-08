import { parseAssignments } from './blocks/templates';
import Database from './sqlite';
import { invoke } from '@tauri-apps/api/core';
import { getActiveVaultId } from './vaultManager';
import {
  ALTAR_ITEMS_INDEX_DDL, ALTARS_INDEX_DDL, BASELINE_VERSION, BLOCK_DEFINITIONS_INDEX_DDL, ENTRIES_INDEX_DDL, LEXICON_INDEX_DDL, TABLE_DDL,
  TEMPLATES_INDEX_DDL, createSchema, ddlIfNotExists, purgeCategory, seedBuiltins, storedImageName,
} from './schema';
import { normalizeSchema } from './normalizeSchema';
import { adoptLegacyImages, rewriteImageRefs } from './images';
import { migrateLinkedIdsToContent } from './migrateLinkedIdsToContent';
import { migrateJournalFieldsToContent } from './migrateJournalFieldsToContent';
import { mergeCategoryTables } from './mergeCategoryTables';
import { backupDatabaseFile, columnNames, createIndexesIfMissing, dropColumnsIfPresent } from './dbRebuild';
import { migrateOperationStatusToBlocks } from './migrateOperationStatusToBlocks';
import { convertLegacySigils, hasLegacySigilRows } from './migrateLegacySigils';
import { IMAGE_FIELDS_V48, TITLED_TABLES_V48 } from './schemaV48';
import { unifyEntries } from './unifyEntries';
import { tagsById } from './tagsById';
import { rewriteTagRefs, stripTagIds } from './tagRefs';
import { ALTAR_SETTING_KEYS, altarSettingsJson } from './altarSettings';
import type { EntryType } from '../types';
import { makeCategoryOptional } from './nullableCategory';
import { seedSigilTemplate } from './templateRows';
import { migrateRoutinesToTemplates } from './migrateRoutinesToTemplates';
import i18n from '../i18n';
import { LEGACY_UNTITLED_TITLES } from './entryTitle';
import { useSettingsStore } from '../store/settingsStore';
import { dropTriggers, installTriggers, isTracked, markMigrated } from './sync/tracking';

// Per-vault DB cache: vault id → Database instance
const _dbCache = new Map<string, Database>();
// Serialises the first-load for each vault to avoid duplicate runMigrations calls
const _initPromises = new Map<string, Promise<Database>>();

/**
 * Counts every time the database is swapped out from under its readers: every
 * closing of the connections (`resetDbCache`) and every swapped-in import
 * (`markDbReplaced`). Anyone reading across several awaits (the automatic
 * backup) can tell from it that their state is no longer all of a piece — even
 * if in the end everything looks as before.
 */
let _epoch = 0;

export function dbEpoch(): number {
  return _epoch;
}

/** The content was replaced, the connection stayed — after swapping in an import. */
export function markDbReplaced(): void {
  _epoch++;
}

/**
 * Close and drop all cached connections. Call before switching vaults.
 *
 * Dropping the JavaScript reference is not enough: the connection pool lives in
 * Rust (`db.rs`), and an open pool keeps the file locked. On Windows that
 * means the vault's folder cannot be moved, relocated, or deleted for the rest
 * of the session — which is exactly what the vault picker's "delete files"
 * checkbox tries to do.
 */
export async function resetDbCache(): Promise<void> {
  _epoch++;
  // First wait for the running loads, then clear. A `getDb()`
  // enters its connection into the cache only *after* `Database.load` — anyone who
  // just clears misses exactly those: they land in the freshly cleared
  // map afterwards, are never closed, and on Windows the file stays locked
  // until restart.
  const pending = [..._initPromises.values()];
  if (pending.length) await Promise.all(pending.map((p) => p.catch(() => null)));

  const open = [..._dbCache.values()];
  _dbCache.clear();
  _initPromises.clear();
  await Promise.all(
    open.map((db) => db.close().catch((err) => console.warn('[db] close failed', err)))
  );
}

/** Set while {@link withDbClosed} runs; `getDb()` refuses to open anything. */
let _blocked = false;

/**
 * Runs `fn` with every connection closed and no new one allowed.
 *
 * Deleting a vault's files needs the database unlocked.
 * `resetDbCache()` alone is not enough for that: the editors hold debounced
 * save timers, and one that fires at exactly that moment reopens, via
 * `getDb()`, the file that is about to disappear.
 *
 * Meanwhile `getDb()` throws `DB_CLOSED`. The save timers are fire-and-forget
 * and catch that — the lost change belongs to the vault that is just being
 * deleted.
 */
export async function withDbClosed<T>(fn: () => Promise<T>): Promise<T> {
  _blocked = true;
  try {
    await resetDbCache();
    return await fn();
  } finally {
    _blocked = false;
  }
}

export async function getDb(): Promise<Database> {
  if (_blocked) throw new Error('DB_CLOSED');
  const vaultId = await getActiveVaultId();

  if (_dbCache.has(vaultId)) return _dbCache.get(vaultId)!;
  if (_initPromises.has(vaultId)) return _initPromises.get(vaultId)!;

  const promise = (async () => {
    // SQLite does not create a directory for its own file, so the vault folder
    // has to exist before the load.
    await invoke('ensure_vault_dirs', { vaultId });
    const db = await Database.load(vaultId);
    await runMigrations(db);
    // Of the backups made before a rebuild (`backupDatabaseFile`) only the
    // newest is kept. Opening must not fail because of this.
    await invoke('prune_migration_backups', { vaultId })
      .catch((e: unknown) => console.warn('[db] migration backups:', e));
    await runPeriodicCleanup(db, trashRetentionFor(vaultId));
    _dbCache.set(vaultId, db);
    _initPromises.delete(vaultId);
    return db;
  })();

  _initPromises.set(vaultId, promise);
  return promise;
}

type Migration = {
  version: number;
  name: string;
  /**
   * Frozen history: v1–v32, as existing databases have run them. Only for
   * these are "already applied" errors swallowed (see
   * isAlreadyAppliedError). New migrations from v33 on do not carry the flag and
   * fail loudly if anything goes wrong.
   */
  legacy?: true;
  up: (db: Database) => Promise<void>;
};

/**
 * Whether an error from a migration's `up` indicates the schema change was
 * already applied by an older version of the app.
 *
 * Applies exclusively to `legacy` migrations. Swallowing is convenient but
 * dangerous: it aborts the *entire* rest of the migration and stamps it as
 * applied anyway. That is exactly how v4 failed — v1 already creates `altars`
 * with `background_preset`, v4 starts with an ALTER for the same
 * column, and everything after it (including `altar_placements.altar_id` and the
 * default altar seeding) was never executed. The emergency migrations v30 and
 * v31 exist for that reason. This must never apply to new migrations again.
 */
function isAlreadyAppliedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate column name|already exists|table .* already exists/i.test(msg);
}

/**
 * Is this an untouched file? Then it gets the baseline schema instead of 33
 * migration steps. `schema_version` alone is not enough as a criterion: a
 * database from before the migration system would have tables but no
 * version table — it must run the chain.
 */
async function isEmptyDatabase(db: Database): Promise<boolean> {
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  return (rows[0]?.n ?? 0) === 0;
}

/**
 * The blocks branch first stamped its three migrations as v39–v41; v39
 * then went to `category_optional`. A development vault with the old
 * numbering would otherwise sit at "v41 done" and never get `category_optional`.
 * Re-stamp once by name (descending — `version` is unique)
 * and catch up v39; for every other vault it is just a quick look at the table.
 */
const RENUMBERED_BLOCK_MIGRATIONS: readonly [string, number][] = [
  ['sigils_to_blocks', 42],
  ['operation_status_to_blocks', 41],
  ['block_definitions', 40],
];

async function renumberBlockMigrations(db: Database): Promise<void> {
  const rows = await db.select<{ version: number; name: string }[]>(
    "SELECT version, name FROM schema_version WHERE name IN ('sigils_to_blocks', 'operation_status_to_blocks', 'block_definitions')"
  );
  const target = new Map(RENUMBERED_BLOCK_MIGRATIONS);
  if (rows.every((r) => r.version === target.get(r.name))) return;
  for (const [name, version] of RENUMBERED_BLOCK_MIGRATIONS) {
    await db.execute('UPDATE schema_version SET version = $1 WHERE name = $2', [version, name]);
  }
  const done = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM schema_version WHERE name = 'category_optional' OR (name = 'baseline' AND version >= 39)"
  );
  if ((done[0]?.n ?? 0) > 0) return;
  console.warn('[db] Block migrations restamped, catching up on v39 category_optional');
  await makeCategoryOptional(db);
  await db.execute(
    'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
    [39, 'category_optional', new Date().toISOString()]
  );
}

export async function runMigrations(db: Database): Promise<void> {
  // Use DELETE journal mode — simpler than WAL, survives unclean shutdowns
  await db.execute('PRAGMA journal_mode = DELETE');

  const latest = MIGRATIONS[MIGRATIONS.length - 1].version;
  if (latest !== BASELINE_VERSION) {
    throw new Error(
      `[db] schema.ts is at BASELINE_VERSION ${BASELINE_VERSION}, the last migration is v${latest}. ` +
        'They must match, or fresh and migrated vaults get different schemas.'
    );
  }

  // Fresh file: create the baseline directly and skip the chain.
  if (await isEmptyDatabase(db)) {
    await createSchema(db);
    // The starter set is created in the language that is active at first
    // open — `main.tsx` waits for the stored language before anything
    // opens the database.
    await seedBuiltins(db, (key) => i18n.t(`categories.starter.${key}`));
    // Not in seedBuiltins: schema.ts imports no block logic.
    await seedSigilTemplate(db, i18n.t);
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
      [BASELINE_VERSION, 'baseline', now]
    );
    return;
  }

  await db.execute(ddlIfNotExists(TABLE_DDL.schema_version));
  await renumberBlockMigrations(db);

  const versionRows = await db.select<{ version: number | null }[]>(
    'SELECT COALESCE(MAX(version), 0) AS version FROM schema_version'
  );
  const currentVersion = versionRows[0]?.version ?? 0;

  // A migration changes rows on every device on its own, so sync starts over
  // from a snapshot. Noted first: a crash in the chain must not lose that.
  const tracked = await isTracked(db);
  if (tracked && latest > currentVersion) {
    await markMigrated(db);
    await dropTriggers(db);
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    try {
      await migration.up(db);
    } catch (err) {
      if (!migration.legacy || !isAlreadyAppliedError(err)) throw err;
      console.warn(
        `[db] Migration v${migration.version} (${migration.name}) had pre-existing schema, marking applied`
      );
    }
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
      [migration.version, migration.name, new Date().toISOString()]
    );
  }

  if (tracked) await installTriggers(db);
}

/**
 * Tables from which the purge after the vault's trash retention period deletes permanently. Runs on every
 * opening of a vault, deliberately separate from the migration system — idempotent,
 * time-dependent and not part of the schema history.
 *
 * `categories` is not here: whatever still points to a category must first
 * be detached from it (ON DELETE RESTRICT, since v33). `runPeriodicCleanup`
 * does that afterwards, like emptying the trash.
 *
 * Table names interpolated into SQL — must stay a hardcoded literal list.
 */
const CLEANUP_TABLES = [
  'entries',
  'tags',
  'tasks',
  // No foreign keys and no follow-up: entries carry their own copies.
  'block_definitions',
  'templates',
  // ON DELETE CASCADE takes their vocabulary along — it carries no `deleted_at` of its own.
  'languages',
  // Likewise an altar's placements; what pointed to it is swept by `sweepDanglingTaskLinks`.
  'altars',
  // And those of an item.
  'altar_items',
] as const;

/**
 * The next running number of an entry type — each type counts on its own,
 * as in the days of the three tables. Entries in the trash count too, so that
 * a number does not occur twice after a restore.
 *
 * Formerly `entry_number` was not written at all — the stores fetched
 * `SELECT *, ROWID as entry_number` on read, overwriting the
 * column that migration v9 had once filled. That worked until
 * a replace import reassigned the ROWIDs and all displayed numbers
 * shifted. Now the number is assigned on creation and stays.
 */
export async function nextEntryNumber(db: Database, type: EntryType): Promise<number> {
  const rows = await db.select<{ n: number }[]>(
    'SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM entries WHERE type = $1',
    [type]
  );
  return rows[0]?.n ?? 1;
}

/** When the target of a link exists — the same types and the same
 *  rule as `checkIntegrity` (schema.ts), otherwise the sweep deletes exactly the
 *  rows the diagnosis considers valid: an entry counts only under
 *  its own type. Soft-deleted rows deliberately count:
 *  trash contents are not orphans yet. */
const LINK_TARGET_EXISTS = `(
  (target_type IN ('journal', 'wiki', 'operation')
    AND EXISTS (SELECT 1 FROM entries e WHERE e.id = task_links.target_id AND e.type = task_links.target_type))
  OR (target_type = 'task' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_links.target_id))
  OR (target_type = 'altar' AND EXISTS (SELECT 1 FROM altars a WHERE a.id = task_links.target_id))
)`;

/**
 * The trash retention period of the vault being opened right now — its
 * settings are loaded by `openActiveVault` before `getDb()`. If the loaded
 * settings belong to another vault, nothing is purged (`null`): that vault's period
 * could irrevocably clear a trash set to "never". (For
 * an unreadable `settings.json`, `loadForVault` itself sets the period to never.)
 */
function trashRetentionFor(vaultId: string): number | null {
  const { vaultId: settingsVaultId, settings } = useSettingsStore.getState();
  return settingsVaultId === vaultId ? settings.trash.retentionDays : null;
}

async function runPeriodicCleanup(db: Database, retentionDays: number | null): Promise<void> {
  // Permanently delete trash contents older than the configured period — "never" skips this.
  if (retentionDays !== null) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    // Tags are attached to entries by ID: whoever goes is removed from every list first.
    const expiredTags = await db.select<{ id: string }[]>(
      'SELECT id FROM tags WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [cutoff]
    );
    await stripTagIds(db, expiredTags.map((t) => t.id));
    // One transaction instead of one commit per table — this runs on every open.
    await db.batch(CLEANUP_TABLES.map((table) => [
      `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
      [cutoff],
    ] as const));
    // Categories last, after their contents are uncategorized. The database
    // is enough here: the stores only load after `getDb()`.
    const expired = await db.select<{ id: string }[]>(
      'SELECT id FROM categories WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [cutoff]
    );
    for (const { id } of expired) await purgeCategory(db, id);
  }

  await sweepDanglingTaskLinks(db);
  await sweepDanglingTagIds(db);
}

/**
 * Removes tag IDs without a tag row from every list. One can arise when
 * a tag is permanently deleted while a draft or an open entry still holds the
 * old list and saves afterwards.
 */
async function sweepDanglingTagIds(db: Database): Promise<void> {
  const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM tags')).map((r) => r.id));
  await rewriteTagRefs(db, (ids) => ids.filter((id) => known.has(id)));
}

/**
 * Removes links whose target no longer exists.
 *
 * `task_links.target_id` is polymorphic — `target_type` decides which
 * table is meant — and therefore cannot carry a foreign key. So nothing cleans up here by itself, and every permanent
 * deletion of content leaves orphans unless it happens explicitly.
 *
 * Used both by the purge after the retention period and by emptying the trash,
 * so that both paths give the same result.
 */
export async function sweepDanglingTaskLinks(db: Database): Promise<void> {
  await db.execute(`DELETE FROM task_links WHERE NOT ${LINK_TARGET_EXISTS}`);
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    legacy: true,
    name: 'initial_schema',
    up: async (db) => {
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
      await db.execute('CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)');

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

      await db.execute(`
        CREATE TABLE IF NOT EXISTS wiki_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '📄',
          is_builtin INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `);
      // Custom Properties were removed in 0.2.0, but this migration is history and must
      // stay byte-for-byte what older vaults already applied. Migration 32 drops the
      // table again at the end of the run, so fresh vaults never end up with it.
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
      await db.execute('CREATE INDEX IF NOT EXISTS idx_custom_props_entry ON custom_properties(entry_id, entry_type)');

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
      await db.execute(`
        CREATE TABLE IF NOT EXISTS task_links (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_type TEXT NOT NULL
        )
      `);
      await db.execute('CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_id)');
    },
  },
  {
    version: 2,
    legacy: true,
    name: 'soft_delete_journal_wiki',
    up: async (db) => {
      await db.execute('ALTER TABLE journal_entries ADD COLUMN deleted_at TEXT');
      await db.execute('ALTER TABLE wiki_articles ADD COLUMN deleted_at TEXT');
    },
  },
  {
    version: 3,
    legacy: true,
    name: 'altar_item_image_and_placement_columns',
    up: async (db) => {
      await db.execute('ALTER TABLE altar_items ADD COLUMN image_data TEXT');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN scale REAL NOT NULL DEFAULT 1');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN width REAL NOT NULL DEFAULT 8');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN height REAL NOT NULL DEFAULT 8');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN rotation REAL NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN opacity REAL NOT NULL DEFAULT 1');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 4,
    legacy: true,
    name: 'altar_background_and_default_altar',
    up: async (db) => {
      await db.execute('ALTER TABLE altars ADD COLUMN background_preset TEXT NOT NULL DEFAULT \'midnight\'');
      await db.execute('ALTER TABLE altars ADD COLUMN background_image_data TEXT');
      await db.execute('ALTER TABLE altar_placements ADD COLUMN altar_id TEXT');

      const existingAltars = await db.select<{ id: string }[]>(
        'SELECT id FROM altars ORDER BY created_at ASC, title ASC'
      );
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
    },
  },
  {
    version: 5,
    legacy: true,
    name: 'tags_soft_delete_and_affected_ids',
    up: async (db) => {
      await db.execute('ALTER TABLE tags ADD COLUMN deleted_at TEXT');
      await db.execute('ALTER TABLE tags ADD COLUMN affected_ids TEXT NOT NULL DEFAULT \'[]\'');
    },
  },
  {
    version: 6,
    legacy: true,
    name: 'wiki_article_cover_and_icon',
    up: async (db) => {
      await db.execute('ALTER TABLE wiki_articles ADD COLUMN cover_image TEXT');
      await db.execute('ALTER TABLE wiki_articles ADD COLUMN icon TEXT');
    },
  },
  {
    version: 7,
    legacy: true,
    name: 'seed_builtin_op_categories',
    up: async (db) => {
      const catCount = await db.select<{ n: number }[]>(
        'SELECT COUNT(*) as n FROM operation_categories WHERE is_builtin=1'
      );
      if ((catCount[0]?.n ?? 0) === 0) {
        await db.execute(
          'INSERT INTO operation_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)',
          ['sigils', 'Sigils', '🔯', 0, 1]
        );
        await db.execute(
          'INSERT INTO operation_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)',
          ['servitors', 'Servitors', '👁️', 1, 1]
        );
      }
    },
  },
  {
    version: 8,
    legacy: true,
    name: 'op_categories_rewrite_to_fixed_ids',
    up: async (db) => {
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
        await db.execute('UPDATE operations SET category_id = $1 WHERE category_id = $2', [fixedId, oldId]);
        await db.execute('DELETE FROM operation_categories WHERE id = $1', [oldId]);
      }
    },
  },
  {
    version: 9,
    legacy: true,
    name: 'entry_number_and_creations_columns',
    up: async (db) => {
      // entry_number for disambiguation of same-name entries. Seeded from
      // ROWID (always exists, never reused within a table) rather than
      // AUTOINCREMENT so that existing rows get a stable, compact number.
      await db.execute('ALTER TABLE journal_entries ADD COLUMN entry_number INTEGER');
      await db.execute('UPDATE journal_entries SET entry_number = ROWID WHERE entry_number IS NULL');

      await db.execute('ALTER TABLE wiki_articles ADD COLUMN entry_number INTEGER');
      await db.execute('UPDATE wiki_articles SET entry_number = ROWID WHERE entry_number IS NULL');

      await db.execute('ALTER TABLE operations ADD COLUMN entry_number INTEGER');
      await db.execute('UPDATE operations SET entry_number = ROWID WHERE entry_number IS NULL');

      await db.execute('ALTER TABLE creations ADD COLUMN entry_number INTEGER');
      await db.execute('UPDATE creations SET entry_number = ROWID WHERE entry_number IS NULL');

      // The remaining creations columns duplicated what was already in v1's
      // CREATE TABLE, but they were historically added via ALTER after the
      // table was created — keep the migration explicit so the schema_version
      // record reflects the historical order.
      await db.execute('UPDATE creations SET tool_type=\'sigil\' WHERE tool_type IS NULL OR tool_type=\'drawing\'');
    },
  },
  {
    version: 10,
    legacy: true,
    name: 'operation_extra_columns',
    up: async (db) => {
      await db.execute('ALTER TABLE operations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
      await db.execute('ALTER TABLE operations ADD COLUMN end_date TEXT');
      await db.execute('ALTER TABLE operations ADD COLUMN version TEXT');
      await db.execute('ALTER TABLE operations ADD COLUMN icon TEXT');
      await db.execute('ALTER TABLE operations ADD COLUMN cover_image TEXT');
    },
  },
  {
    // Belongs to the removed Custom Properties feature, but left intact for the same
    // reason as the CREATE in migration 1: this is history older vaults already ran.
    // `meta` is already part of that CREATE, so on a fresh vault the first ALTER raises
    // "duplicate column name"; isAlreadyAppliedError absorbs it and the rest of this body
    // is skipped, which is the established path for columns that later moved into the
    // initial schema. Nothing is lost either way — migration 32 drops the table.
    version: 11,
    legacy: true,
    name: 'custom_properties_meta_and_type_rename',
    up: async (db) => {
      await db.execute('ALTER TABLE custom_properties ADD COLUMN meta TEXT');
      await db.execute('ALTER TABLE custom_properties ADD COLUMN show_in_entry INTEGER NOT NULL DEFAULT 0');
      // Rename old 'checkbox' type to 'toggle' (checkbox is now a separate simple type)
      await db.execute("UPDATE custom_properties SET type='toggle' WHERE type='checkbox'");
    },
  },
  {
    version: 12,
    legacy: true,
    name: 'wiki_categories_builtin_seed',
    up: async (db) => {
      const wikiCatCount = await db.select<{ n: number }[]>(
        'SELECT COUNT(*) as n FROM wiki_categories WHERE is_builtin=1'
      );
      if ((wikiCatCount[0]?.n ?? 0) === 0) {
        const builtinCats = [
          { id: 'paradigm',   name: 'Paradigma',  emoji: '🌀', sort_order: 0 },
          { id: 'bannung',    name: 'Bannung',    emoji: '🚫', sort_order: 1 },
          { id: 'meditation', name: 'Meditation', emoji: '🧘', sort_order: 2 },
          { id: 'ritual',     name: 'Ritual',     emoji: '🕯️', sort_order: 3 },
          { id: 'deity',      name: 'Deity',      emoji: '✨',  sort_order: 4 },
          { id: 'herb',       name: 'Herb',       emoji: '🌿',  sort_order: 5 },
          { id: 'symbol',     name: 'Symbol',     emoji: '🔮', sort_order: 6 },
          { id: 'tool',       name: 'Tool',       emoji: '⚗️', sort_order: 7 },
          { id: 'concept',    name: 'Concept',    emoji: '📖', sort_order: 8 },
          { id: 'spell',      name: 'Spell',      emoji: '🌙', sort_order: 9 },
          { id: 'other',      name: 'Other',      emoji: '📄', sort_order: 10 },
        ];
        for (const cat of builtinCats) {
          await db.execute(
            'INSERT INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)',
            [cat.id, cat.name, cat.emoji, cat.sort_order, 1]
          );
        }
      }

      // Ensure additional built-ins are present even when migrating from
      // older installs that pre-date them
      await db.execute(
        "INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('paradigm','Paradigma','🌀',0,1)"
      );
      await db.execute(
        "INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('bannung','Bannung','🚫',1,1)"
      );
      await db.execute(
        "INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('meditation','Meditation','🧘',2,1)"
      );
      await db.execute(
        "INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ('sigil_charging','Sigil Charging','⚡',3,1)"
      );

      // Set canonical sort order for all built-ins (idempotent)
      for (const [id, order] of [
        ['paradigm', 0], ['bannung', 1], ['meditation', 2], ['sigil_charging', 3],
        ['ritual', 4], ['deity', 5], ['herb', 6], ['symbol', 7],
        ['tool', 8], ['concept', 9], ['spell', 10], ['other', 11],
      ] as [string, number][]) {
        await db.execute(
          'UPDATE wiki_categories SET sort_order=$1 WHERE id=$2 AND is_builtin=1',
          [order, id]
        );
      }
    },
  },
  {
    version: 13,
    legacy: true,
    name: 'routines_linked_ids',
    up: async (db) => {
      await db.execute("ALTER TABLE routines ADD COLUMN operation_ids TEXT NOT NULL DEFAULT '[]'");
      await db.execute("ALTER TABLE routines ADD COLUMN wiki_ids TEXT NOT NULL DEFAULT '[]'");
    },
  },
  {
    version: 14,
    legacy: true,
    name: 'journal_entries_paradigm_and_links',
    up: async (db) => {
      await db.execute('ALTER TABLE journal_entries ADD COLUMN paradigm_id TEXT');
      await db.execute('ALTER TABLE journal_entries ADD COLUMN linked_operation_ids TEXT');
      await db.execute('ALTER TABLE journal_entries ADD COLUMN linked_wiki_ids TEXT');
    },
  },
  {
    version: 15,
    legacy: true,
    name: 'journal_entries_bannung_and_meditation',
    up: async (db) => {
      await db.execute('ALTER TABLE journal_entries ADD COLUMN is_bannung INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE journal_entries ADD COLUMN bannung_type_wiki_id TEXT');
      await db.execute('ALTER TABLE journal_entries ADD COLUMN is_meditation INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE journal_entries ADD COLUMN meditation_duration INTEGER');
      await db.execute('ALTER TABLE journal_entries ADD COLUMN meditation_type_wiki_id TEXT');
    },
  },
  {
    version: 16,
    legacy: true,
    name: 'categories_soft_delete',
    up: async (db) => {
      await db.execute('ALTER TABLE wiki_categories ADD COLUMN deleted_at TEXT');
      await db.execute('ALTER TABLE operation_categories ADD COLUMN deleted_at TEXT');
    },
  },
  {
    version: 17,
    legacy: true,
    name: 'seed_task_default_category',
    up: async (db) => {
      await db.execute(
        "INSERT OR IGNORE INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)",
        ['general', 'Allgemein', '📋', 0, 0]
      );
    },
  },
  {
    version: 18,
    legacy: true,
    name: 'altar_grid_options_per_altar',
    up: async (db) => {
      // Keep numeric defaults in sync with DEFAULT_GRID_* in altarConstants.ts
      await db.execute("ALTER TABLE altars ADD COLUMN grid_enabled INTEGER NOT NULL DEFAULT 0");
      await db.execute("ALTER TABLE altars ADD COLUMN grid_size REAL NOT NULL DEFAULT 32");
      await db.execute("ALTER TABLE altars ADD COLUMN grid_opacity REAL NOT NULL DEFAULT 0.06");
      await db.execute("ALTER TABLE altars ADD COLUMN grid_color TEXT NOT NULL DEFAULT '#dce8e2'");
      await db.execute("ALTER TABLE altars ADD COLUMN snap_to_grid INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    version: 19,
    legacy: true,
    name: 'altar_rotation_snap_and_scale_to_grid',
    up: async (db) => {
      await db.execute("ALTER TABLE altars ADD COLUMN rotation_snap_enabled INTEGER NOT NULL DEFAULT 0");
      await db.execute("ALTER TABLE altars ADD COLUMN rotation_snap_angle REAL NOT NULL DEFAULT 15");
      await db.execute("ALTER TABLE altars ADD COLUMN snap_scale_to_grid INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    // aspect_ratio column is unused — ratio is always derived from resolution via parseResolution.
    // Kept for backwards compatibility with existing DBs; do not read or write this column.
    version: 20,
    legacy: true,
    name: 'altar_aspect_ratio',
    up: async (db) => {
      await db.execute("ALTER TABLE altars ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '16:9'");
    },
  },
  {
    version: 21,
    legacy: true,
    name: 'altar_resolution',
    up: async (db) => {
      await db.execute("ALTER TABLE altars ADD COLUMN resolution TEXT NOT NULL DEFAULT '1920x1080'");
    },
  },
  {
    version: 22,
    legacy: true,
    name: 'altar_categories_table',
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS altar_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      const catCount = await db.select<{ n: number }[]>('SELECT COUNT(*) as n FROM altar_categories');
      if ((catCount[0]?.n ?? 0) === 0) {
        const now = new Date().toISOString();
        for (const [id, name, emoji] of [
          ['candle',  'Candle',  '🕯️'],
          ['crystal', 'Crystal', '🔮'],
          ['herb',    'Herb',    '🌿'],
          ['deity',   'Deity',   '✨'],
          ['symbol',  'Symbol',  '🌙'],
          ['tool',    'Tool',    '🔔'],
          ['table',   'Table',   '🪵'],
          ['other',   'Other',   '📦'],
        ]) {
          await db.execute(
            'INSERT OR IGNORE INTO altar_categories (id, name, emoji, created_at) VALUES ($1,$2,$3,$4)',
            [id, name, emoji, now]
          );
        }
      }
    },
  },
  {
    version: 23,
    legacy: true,
    name: 'altar_categories_capitalize_and_fix_emojis',
    up: async (db) => {
      // Capitalize default category names and sync altar_items.category to match
      for (const [id, oldName, newName] of [
        ['candle',  'candle',  'Candle'],
        ['crystal', 'crystal', 'Crystal'],
        ['herb',    'herb',    'Herb'],
        ['deity',   'deity',   'Deity'],
        ['symbol',  'symbol',  'Symbol'],
        ['tool',    'tool',    'Tool'],
        ['table',   'table',   'Table'],
        ['other',   'other',   'Other'],
      ]) {
        await db.execute(
          'UPDATE altar_categories SET name=$1 WHERE id=$2 AND name=$3',
          [newName, id, oldName]
        );
        await db.execute(
          'UPDATE altar_items SET category=$1 WHERE category=$2',
          [newName, oldName]
        );
      }
      // Fix text symbol ☽ → emoji 🌙 for the symbol category
      await db.execute(
        "UPDATE altar_categories SET emoji='🌙' WHERE id='symbol' AND emoji='☽'"
      );
    },
  },
  {
    version: 25,
    legacy: true,
    name: 'altar_background_overlay',
    up: async (db) => {
      await db.execute('ALTER TABLE altars ADD COLUMN background_overlay REAL NOT NULL DEFAULT 0.2');
    },
  },
  {
    version: 26,
    legacy: true,
    name: 'altar_thumbnail_data',
    up: async (db) => {
      await db.execute('ALTER TABLE altars ADD COLUMN thumbnail_data TEXT');
    },
  },
  {
    version: 27,
    legacy: true,
    name: 'altar_background_overlay_color',
    up: async (db) => {
      await db.execute("ALTER TABLE altars ADD COLUMN background_overlay_color TEXT NOT NULL DEFAULT 'dark'");
    },
  },
  {
    version: 28,
    legacy: true,
    name: 'altar_categories_sort_order',
    up: async (db) => {
      await db.execute('ALTER TABLE altar_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
      const rows = await db.select<{ id: string }[]>('SELECT id FROM altar_categories ORDER BY created_at ASC, name ASC');
      for (let i = 0; i < rows.length; i++) {
        await db.execute('UPDATE altar_categories SET sort_order=$1 WHERE id=$2', [i, rows[i].id]);
      }
    },
  },
  {
    version: 29,
    legacy: true,
    name: 'altar_icon_data',
    up: async (db) => {
      await db.execute('ALTER TABLE altars ADD COLUMN icon_data TEXT DEFAULT NULL');
    },
  },
  {
    // Guard migration: ensures all altar_placements columns from v3/v4 exist.
    // Needed for DBs where v3 was recorded as applied but run against older code
    // that didn't include all of these columns yet.
    version: 30,
    legacy: true,
    name: 'altar_placements_column_guard',
    up: async (db) => {
      const cols = await db.select<{ name: string }[]>('PRAGMA table_info(altar_placements)');
      const has = new Set(cols.map(c => c.name));
      if (!has.has('scale'))     await db.execute('ALTER TABLE altar_placements ADD COLUMN scale REAL NOT NULL DEFAULT 1');
      if (!has.has('z_index'))   await db.execute('ALTER TABLE altar_placements ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0');
      if (!has.has('width'))     await db.execute('ALTER TABLE altar_placements ADD COLUMN width REAL NOT NULL DEFAULT 8');
      if (!has.has('height'))    await db.execute('ALTER TABLE altar_placements ADD COLUMN height REAL NOT NULL DEFAULT 8');
      if (!has.has('rotation'))  await db.execute('ALTER TABLE altar_placements ADD COLUMN rotation REAL NOT NULL DEFAULT 0');
      if (!has.has('opacity'))   await db.execute('ALTER TABLE altar_placements ADD COLUMN opacity REAL NOT NULL DEFAULT 1');
      if (!has.has('locked'))    await db.execute('ALTER TABLE altar_placements ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
      if (!has.has('hidden'))    await db.execute('ALTER TABLE altar_placements ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
      if (!has.has('altar_id'))  await db.execute('ALTER TABLE altar_placements ADD COLUMN altar_id TEXT');
    },
  },
  {
    // Belt-and-suspenders follow-up to v30: uses try/catch per column instead of
    // PRAGMA so it is immune to any result-format quirks in plugin-sql.
    // Runs unconditionally on DBs that had v30 applied but columns still missing.
    version: 31,
    legacy: true,
    name: 'altar_placements_column_guard_v2',
    up: async (db) => {
      const tryAdd = async (sql: string) => {
        try { await db.execute(sql); } catch { /* column already exists — ignore */ }
      };
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN scale REAL NOT NULL DEFAULT 1');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN width REAL NOT NULL DEFAULT 8');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN height REAL NOT NULL DEFAULT 8');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN rotation REAL NOT NULL DEFAULT 0');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN opacity REAL NOT NULL DEFAULT 1');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
      await tryAdd('ALTER TABLE altar_placements ADD COLUMN altar_id TEXT');
    },
  },
  {
    // Final step of the Custom Properties removal. Migration 11 created this table;
    // that migration is gone, so fresh databases never had it, and nothing has read
    // or written it since 0.2.0. Dropping it deletes any rows an older database still
    // holds — deliberate, and irreversible.
    version: 32,
    legacy: true,
    name: 'drop_custom_properties',
    up: async (db) => {
      await db.execute('DROP INDEX IF EXISTS idx_custom_props_entry');
      await db.execute('DROP TABLE IF EXISTS custom_properties');
    },
  },
  {
    // First migration without the `legacy` flag: errors are no longer swallowed.
    //
    // Brings existing databases to the schema from `schema.ts` — the same
    // DDL that fresh vaults get via the baseline path. From here on the
    // two paths coincide again, and `scripts/schema-check.mjs` checks
    // exactly that.
    //
    // The procedure is in `normalizeSchema.ts`; it is too extensive to remain
    // readable here.
    version: 33,
    name: 'normalize_schema',
    up: normalizeSchema,
  },
  {
    // A built-in "Other" category for operations. Until here there were only
    // `sigils` and `servitors`, so operations of a deleted category
    // ended up with the sigils — wrong in substance, since an operation does
    // not become a sigil just because its category disappears.
    //
    // v33 creates it on vaults that still have the rebuild ahead of them; this
    // step catches it up for all that already have it behind them.
    version: 34,
    name: 'operation_other_category',
    up: async (db) => {
      await db.execute(
        `INSERT OR IGNORE INTO operation_categories (id, name, emoji, sort_order, is_builtin)
         VALUES ('other', 'Other', '📦', 2, 1)`
      );
    },
  },
  {
    // From here on, images belong to the vault. They live in `{vaultDir}/images/`, and
    // only the file name is referenced.
    //
    // Before, `content` held the absolute path into a store that all
    // vaults shared. That broke three things at once: the
    // database was tied to one machine and one user, an image was
    // visible from every vault, and cleanup was impossible — `cleanup_unused_images`
    // had to be removed because it deleted images of other vaults as unused.
    //
    // Moving the database file itself is *not* a migration: it moves
    // before it is opened. That is done by `migrate_vault_layout`, triggered
    // from `vaultManager.loadVaultsFile()`.
    version: 35,
    name: 'vault_scoped_images',
    up: async (db) => {
      const adopt = new Set<string>();
      const updates: { sql: string; params: unknown[] }[] = [];

      // Deliberately without the `legacy` columns from IMAGE_FIELDS_V48: they hold
      // data URLs, and their renderers cannot do anything with a file name.
      // They are read all the same — by
      // `collectUsedImageFilenames`, so that the cleanup action does not delete
      // anything they still point to.
      for (const { table, html, plain } of IMAGE_FIELDS_V48) {
        const columns = [...html, ...plain];
        if (columns.length === 0) continue;
        const rows = await db.select<Record<string, string | null>[]>(
          `SELECT id, ${columns.join(', ')} FROM ${table}`
        );

        for (const row of rows) {
          const next: Record<string, string> = {};

          for (const column of html) {
            const value = row[column];
            if (!value) continue;
            const rewritten = rewriteImageRefs(value, (ref) => {
              const name = storedImageName(ref);
              if (!name || name === ref) return null;
              adopt.add(name);
              return name;
            });
            if (rewritten !== value) next[column] = rewritten;
          }

          for (const column of plain) {
            const value = row[column];
            if (!value) continue;
            const name = storedImageName(value);
            if (!name || name === value) continue;
            adopt.add(name);
            next[column] = name;
          }

          const changed = Object.keys(next);
          if (!changed.length) continue;
          updates.push({
            sql: `UPDATE ${table} SET ${changed.map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${changed.length + 1}`,
            params: [...changed.map((c) => next[c]), row.id],
          });
        }
      }

      // Copy first, then rewrite. If copying fails, the rewrite
      // happens anyway: the protocol handler falls back to the old
      // shared store, so the image stays visible. The other way round
      // — rewriting without a copy and without a fallback — it would be gone.
      // `adoptLegacyImages` writes into the *active* vault. That works because
      // `runMigrations` runs exclusively from `getDb()`, which always opens the
      // active vault — but the assumption is not in the signature.
      if (adopt.size > 0) {
        try {
          await adoptLegacyImages([...adopt]);
        } catch (err) {
          console.warn('[db] v35: adopting the old image store failed', err);
        }
      }

      for (const { sql, params } of updates) {
        await db.execute(sql, params);
      }
    },
  },
  {
    // The journal columns `linked_operation_ids`/`linked_wiki_ids` were the
    // two link fields in the right sidebar. They are replaced by the
    // link field, which reads the links from the entry's CONTENT
    // — the columns would then have no display anymore. Their content
    // therefore moves once, here, into the text as a link chip.
    //
    // The columns themselves stay (export, import and checkIntegrity know
    // them), but are emptied: the same link should not appear in two
    // places.
    version: 36,
    name: 'journal_linked_ids_to_content',
    up: async (db) => {
      await migrateLinkedIdsToContent(db);
    },
  },
  {
    // Paradigm, banishing and meditation were three fixed fields on the
    // journal entry, each tied to a wiki category. They are gone —
    // an entry now links freely, and the link field shows the targets
    // sorted by category. As with v36, the stored values move
    // once into the text as a link chip; the columns stay in the schema and
    // are emptied.
    version: 37,
    name: 'journal_paradigm_bannung_meditation_to_content',
    up: async (db) => {
      await migrateJournalFieldsToContent(db);
    },
  },
  {
    // Four category tables — one per module, three of them identical in structure —
    // become the one `categories`. A category can since then hold articles,
    // operations, tasks and altar items at the same time. Only `other` and
    // `sigils` stay built in; all other builtins become normal
    // categories, same-named ones from different modules merge into each other.
    //
    // The procedure is in `mergeCategoryTables.ts` — a rebuild like v33, with
    // the foreign-key trap on renaming, which is explained there.
    version: 38,
    name: 'merge_category_tables',
    up: mergeCategoryTables,
  },
  {
    // `category_id` becomes nullable — "uncategorized" is the normal case of a
    // new entry rather than an accident —, and `other` loses its
    // special status. Procedure and foreign-key trap in `nullableCategory.ts`.
    //
    // Careful when reading v38 above: both build from the same
    // `TABLE_DDL`. A vault from before v38 thus already gets the nullable
    // column there; v39 recognises that and only catches up `is_builtin`.
    version: 39,
    name: 'category_optional',
    up: makeCategoryOptional,
  },
  {
    // The custom blocks of the blocks view get their table. Purely
    // additive: entries carry their copies in `content`, only the
    // template is stored here. IF NOT EXISTS, so that a run that created the table but was not
    // stamped does not get stuck at the next start.
    version: 40,
    name: 'block_definitions',
    up: async (db) => {
      await db.execute(ddlIfNotExists(TABLE_DDL.block_definitions));
      await createIndexesIfMissing(db, [BLOCK_DEFINITIONS_INDEX_DDL]);
    },
  },
  {
    // Status, end date and version of operations were fixed columns with
    // filter, list item and chips. They become the copy of a custom
    // "Status" block in the content; the columns stay and are emptied.
    // Procedure in `migrateOperationStatusToBlocks.ts`.
    version: 41,
    name: 'operation_status_to_blocks',
    up: migrateOperationStatusToBlocks,
  },
  {
    // The sigil operation loses its own view and its own
    // columns: calculator, drawing and charge become blocks in the content, the
    // drawing an image file. A backup first — the drawings
    // move from the database into files. Procedure in `migrateLegacySigils.ts`;
    // whatever fails to save here is caught up by v49 (`unifyEntries.ts`).
    version: 42,
    name: 'sigils_to_blocks',
    up: async (db) => {
      if (await hasLegacySigilRows(db)) await backupDatabaseFile(db, 'v42');
      await convertLegacySigils(db, { includeSigilCategory: true });
    },
  },
  {
    // The templates of the templates dashboard get their table. Plus the
    // built-in template "Sigil" as the default for operation × sigils —
    // until here the sigil set of new operations was hard-wired
    // (`lib/blocks/layouts.ts`). Additive and repeatable like v40.
    version: 43,
    name: 'templates',
    up: async (db) => {
      await db.execute(ddlIfNotExists(TABLE_DDL.templates));
      await createIndexesIfMissing(db, [TEMPLATES_INDEX_DDL]);
      await seedSigilTemplate(db, i18n.t);
    },
  },
  {
    // Since the sidebar rework, routines had no way into
    // the interface anymore; templates can do everything they could. Each becomes a
    // template without an assignment, after which the table is dropped. A backup
    // first if there are routines. Procedure in `migrateRoutinesToTemplates.ts`.
    version: 44,
    name: 'routines_to_templates',
    up: (db) => migrateRoutinesToTemplates(db, i18n.t),
  },
  {
    // The lexicon gets its two tables: the languages and their
    // vocabulary. Purely additive and repeatable like v40 and v43 — there is
    // nothing to rewrite, the module is new.
    version: 45,
    name: 'lexicon',
    up: async (db) => {
      await db.execute(ddlIfNotExists(TABLE_DDL.languages));
      await db.execute(ddlIfNotExists(TABLE_DDL.lexicon_entries));
      await createIndexesIfMissing(db, LEXICON_INDEX_DDL);
    },
  },
  {
    // Altars get a trash like everything else: until here the button deleted
    // immediately and permanently, without confirmation and without a way back.
    // Additive and repeatable — the column is only added where it is missing.
    version: 46,
    name: 'altars_soft_delete',
    up: async (db) => {
      const columns = await db.select<{ name: string }[]>('PRAGMA table_info(altars)');
      if (!columns.some((column) => column.name === 'deleted_at')) {
        await db.execute('ALTER TABLE altars ADD COLUMN deleted_at TEXT');
      }
      await createIndexesIfMissing(db, [ALTARS_INDEX_DDL]);
    },
  },
  {
    // `links` mirrored an entry's link chips on every save —
    // for a backlinks panel that was never wired in. Nobody ever read it;
    // the chips themselves are in `content`. The indexes go with it.
    version: 47,
    name: 'drop_links',
    up: async (db) => {
      await db.execute('DROP TABLE IF EXISTS links');
    },
  },
  {
    // Since v48 new entries have an empty title, and "Untitled…" is displayed in the
    // app's language (`displayTitle`). The English default titles of earlier times
    // become empty — repeatable, a backup import calls it too.
    version: 48,
    name: 'untitled_is_empty',
    up: (db) => clearLegacyUntitledTitles(db, TITLED_TABLES_V48),
  },
  {
    // Journal, wiki and operations into one table `entries` — the dead
    // columns, `slug` and `moon_phase` are left behind (`unifyEntries.ts`).
    version: 49,
    name: 'unify_entries',
    up: unifyEntries,
  },
  {
    // Two columns nobody ever read: `tasks.tags` (tasks never had
    // tags) and `altars.intention` (the field from the time before altars with
    // a background; v33 filled it last). Repeatable.
    version: 50,
    name: 'drop_dead_columns',
    up: async (db) => {
      await dropColumnsIfPresent(db, 'tasks', ['tags']);
      await dropColumnsIfPresent(db, 'altars', ['intention']);
    },
  },
  {
    // The twelve display columns of an altar become one JSON column
    // `settings` (`lib/altarSettings.ts`). Without rebuilding the table — a DROP
    // TABLE would take the placements along via ON DELETE CASCADE. Repeatable:
    // it is only filled where `settings` is still empty, and the old columns go only afterwards.
    version: 51,
    name: 'altar_settings',
    up: altarSettingsToJson,
  },
  {
    // Altar items get a trash — until now a deleted one was
    // gone immediately, from every altar. Additive and repeatable.
    version: 52,
    name: 'altar_items_soft_delete',
    up: async (db) => {
      const columns = await columnNames(db, 'altar_items');
      if (!columns.has('updated_at')) {
        await db.execute("ALTER TABLE altar_items ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
      }
      if (!columns.has('deleted_at')) await db.execute('ALTER TABLE altar_items ADD COLUMN deleted_at TEXT');
      await db.execute("UPDATE altar_items SET updated_at = created_at WHERE updated_at = ''");
      await createIndexesIfMissing(db, [ALTAR_ITEMS_INDEX_DDL]);
    },
  },
  {
    // Tags by ID instead of by name (`tagsById.ts`).
    version: 53,
    name: 'tags_by_id',
    up: tagsById,
  },
  {
    // Four more columns that nothing read or wrote anymore: description and
    // due date of a task, the description of custom blocks and templates —
    // fields without input. Repeatable like v50.
    version: 54,
    name: 'drop_unused_descriptions',
    up: async (db) => {
      await dropColumnsIfPresent(db, 'tasks', ['description', 'due_date']);
      await dropColumnsIfPresent(db, 'block_definitions', ['description']);
      await dropColumnsIfPresent(db, 'templates', ['description']);
    },
  },
  {
    // The list columns as an index (`idx_entries_list`, see `ENTRIES_INDEX_DDL`):
    // startup would otherwise read them through the overflow pages of every content.
    // `idx_entries_deleted` is merged into it. Repeatable.
    version: 55,
    name: 'entries_list_index',
    up: async (db) => {
      await db.execute('DROP INDEX IF EXISTS idx_entries_deleted');
      await createIndexesIfMissing(db, ENTRIES_INDEX_DDL);
    },
  },
  {
    // A block in an entry no longer knows its definition, so the definition
    // needs no revision. An assignment now always means "new entries start with
    // it": what was only offered for selection goes (`parseAssignments`). Repeatable.
    version: 56,
    name: 'simple_copies_and_assignments',
    up: async (db) => {
      await dropColumnsIfPresent(db, 'block_definitions', ['revision']);
      const rows = await db.select<{ id: string; assignments: string }[]>('SELECT id, assignments FROM templates');
      await db.batch(rows.map((row) => ['UPDATE templates SET assignments=$1 WHERE id=$2', [JSON.stringify(parseAssignments(row.assignments)), row.id]] as const));
      // A trashed template holds no assignments any more.
      await db.execute("UPDATE templates SET assignments='[]' WHERE deleted_at IS NOT NULL");
    },
  },
];

async function altarSettingsToJson(db: Database): Promise<void> {
  const columns = await columnNames(db, 'altars');
  if (!ALTAR_SETTING_KEYS.some((key) => columns.has(key))) return;
  await backupDatabaseFile(db, 'v51');
  if (!columns.has('settings')) {
    await db.execute("ALTER TABLE altars ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
  }
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM altars WHERE settings = '{}'");
  for (const row of rows) {
    await db.execute('UPDATE altars SET settings=$1 WHERE id=$2', [altarSettingsJson(row), row.id]);
  }
  await dropColumnsIfPresent(db, 'altars', ALTAR_SETTING_KEYS);
}

/** The tables whose rows carry a title that may be empty. */
const TITLED_TABLES = ['entries', 'tasks', 'altars'] as const;

/**
 * Empties the English default titles of earlier versions (`LEGACY_UNTITLED_TITLES`).
 * `tables` is for v48, which runs before `entries`.
 */
export async function clearLegacyUntitledTitles(
  db: Database,
  tables: readonly string[] = TITLED_TABLES,
): Promise<void> {
  const placeholders = LEGACY_UNTITLED_TITLES.map((_, i) => `$${i + 1}`).join(', ');
  for (const table of tables) {
    await db.execute(`UPDATE ${table} SET title='' WHERE trim(title) IN (${placeholders})`, [...LEGACY_UNTITLED_TITLES]);
  }
}
