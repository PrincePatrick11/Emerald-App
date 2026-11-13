import Database from './sqlite';
import { invoke } from '@tauri-apps/api/core';
import { getActiveVaultId } from './vaultManager';
import { BASELINE_VERSION, FRESH_START_VERSION, TABLES, createSchema, purgeCategory, seedBuiltins } from './schema';
import { seedAltarTemplate, seedSigilTemplate } from './templateRows';
import type { EntryType } from '../types';
import i18n from '../i18n';
import { useSettingsStore } from '../store/settingsStore';
import { rewriteTagRefs, stripTagIds } from './tagRefs';
import { dropTriggers, installTriggers, isTracked, markMigrated } from './sync/tracking';
import { clearSavedBlocks } from './blockStore';

/**
 * A vault from before the fresh start (`FRESH_START_VERSION`): its schema came
 * out of the old migration chain, which this version no longer has. It is
 * recognised and left as it is; a converter is a task of its own.
 */
export const VAULT_OUTDATED = 'VAULT_OUTDATED';
/** A vault whose schema is newer than this app knows: it is not touched either. */
export const VAULT_TOO_NEW = 'VAULT_TOO_NEW';

/** Whether an error says the vault's schema is from another version of the app. */
export function vaultVersionErrorOf(err: unknown): typeof VAULT_OUTDATED | typeof VAULT_TOO_NEW | null {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes(VAULT_OUTDATED)) return VAULT_OUTDATED;
  if (message.includes(VAULT_TOO_NEW)) return VAULT_TOO_NEW;
  return null;
}

/** The message for a vault that would not open: what is wrong with its version, or `fallback`. */
export function vaultOpenErrorKey(err: unknown, fallback: string): string {
  const version = vaultVersionErrorOf(err);
  return version === VAULT_OUTDATED ? 'vault.outdated' : version === VAULT_TOO_NEW ? 'vault.tooNew' : fallback;
}

// Per-vault connection cache: vault id → Database instance with a checked schema
const _dbCache = new Map<string, Database>();
// Serialises the first open of each vault
const _openPromises = new Map<string, Promise<Database>>();
// Per vault: the open that also ran the periodic cleanup (once per session)
const _cleaned = new Map<string, Promise<Database>>();

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
  clearSavedBlocks();
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
  clearSavedBlocks();
  // First wait for the running opens, then clear. An open enters its
  // connection into the cache only *after* `Database.load` — anyone who
  // just clears misses exactly those: they land in the freshly cleared
  // map afterwards, are never closed, and on Windows the file stays locked
  // until restart.
  const pending = [..._openPromises.values(), ..._cleaned.values()];
  if (pending.length) await Promise.all(pending.map((p) => p.catch(() => null)));

  const open = [..._dbCache.values()];
  _dbCache.clear();
  _openPromises.clear();
  _cleaned.clear();
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

/**
 * Opens a vault's database and makes sure it is one this version can work with:
 * a fresh file gets the schema, a current one is brought up by `MIGRATIONS`,
 * one from before the fresh start or from a newer app is refused with
 * {@link VAULT_OUTDATED} / {@link VAULT_TOO_NEW} — before anything is written.
 *
 * The unlock gate (`ensureVaultReady`) calls it right after unlocking, so a
 * refused vault never has its settings or drafts read or written.
 */
export async function openVaultDb(vaultId: string): Promise<Database> {
  if (_blocked) throw new Error('DB_CLOSED');
  const cached = _dbCache.get(vaultId);
  if (cached) return cached;
  const pending = _openPromises.get(vaultId);
  if (pending) return pending;

  const promise = (async () => {
    // SQLite does not create a directory for its own file, so the vault folder
    // has to exist before the load.
    await invoke('ensure_vault_dirs', { vaultId });
    const db = await Database.load(vaultId);
    try {
      await runMigrations(db);
    } catch (err) {
      // A refused vault keeps no open connection: the file stays unlocked.
      await db.close().catch(() => {});
      throw err;
    }
    _dbCache.set(vaultId, db);
    return db;
  })().finally(() => _openPromises.delete(vaultId));

  _openPromises.set(vaultId, promise);
  return promise;
}

export async function getDb(): Promise<Database> {
  if (_blocked) throw new Error('DB_CLOSED');
  const vaultId = await getActiveVaultId();
  const cleaned = _cleaned.get(vaultId);
  if (cleaned) return cleaned;

  // The purge needs the vault's settings, which are loaded after the gate
  // opened the database — so it runs on the first `getDb()`, not in the gate.
  const promise = openVaultDb(vaultId).then(async (db) => {
    await runPeriodicCleanup(db, trashRetentionFor(vaultId));
    return db;
  });
  _cleaned.set(vaultId, promise);
  promise.catch(() => {
    if (_cleaned.get(vaultId) === promise) _cleaned.delete(vaultId);
  });
  return promise;
}

export type Migration = {
  /** Above `FRESH_START_VERSION`; the last one equals `BASELINE_VERSION`. */
  version: number;
  name: string;
  up: (db: Database) => Promise<void>;
};

/**
 * The steps that bring a vault created under an earlier state of this schema
 * up to `schema.ts`. Empty since the fresh start: the old chain is gone, and
 * vaults from before it are refused (`VAULT_OUTDATED`). A schema change
 * changes `schema.ts`, appends a step here and raises `BASELINE_VERSION` to
 * its version (see "Rules for Future Schema Changes" in `database.md`).
 */
export const MIGRATIONS: Migration[] = [];

/**
 * Where the file stands: `'empty'` (a new vault), `'unfinished'` (a new vault
 * whose creation was cut short — see below), `'unversioned'` (tables without a
 * version: older than any vault this version opens) or the highest version in
 * `schema_version`. Reads only.
 */
async function storedSchemaState(db: Database): Promise<'empty' | 'unfinished' | 'unversioned' | number> {
  const tables = (await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  )).map((t) => t.name);
  if (tables.length === 0) return 'empty';
  if (tables.includes('schema_version')) {
    const rows = await db.select<{ version: number | null }[]>('SELECT MAX(version) AS version FROM schema_version');
    const version = rows[0]?.version;
    if (version != null) return version;
  }
  // No stamp. The creation of a new vault stamps it last; one cut short in
  // between (the app killed, a seed that threw) holds only tables of
  // `schema.ts` and no content of the user's. Anything else is old.
  const ours = new Set<string>(TABLES);
  if (!tables.every((t) => ours.has(t))) return 'unversioned';
  for (const table of ['entries', 'tasks'] as const) {
    if (!tables.includes(table)) continue;
    const [row] = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
    if ((row?.n ?? 0) > 0) return 'unversioned';
  }
  return 'unfinished';
}

/**
 * Brings an opened database to `baseline` — or refuses it, before anything is
 * written. `migrations` and `baseline` are parameters only for the checks
 * (`scripts/sync-check.mjs`, `scripts/schema-check.mjs`), which exercise the
 * runner with a step of their own; the app always passes the defaults.
 */
export async function runMigrations(
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
  baseline: number = BASELINE_VERSION,
): Promise<void> {
  const latest = migrations.length ? migrations[migrations.length - 1].version : FRESH_START_VERSION;
  if (latest !== baseline) {
    throw new Error(
      `[db] schema.ts is at BASELINE_VERSION ${baseline}, the migrations end at v${latest}. ` +
        'They must match, or fresh and migrated vaults get different schemas.'
    );
  }

  // Read before anything is written: a refused vault stays exactly as it was.
  const state = await storedSchemaState(db);
  const isOld = state === 'unversioned' || (typeof state === 'number' && state < FRESH_START_VERSION);
  if (isOld) throw new Error(VAULT_OUTDATED);
  if (typeof state === 'number' && state > baseline) throw new Error(VAULT_TOO_NEW);

  // Use DELETE journal mode — simpler than WAL, survives unclean shutdowns
  await db.execute('PRAGMA journal_mode = DELETE');

  // A new vault whose creation was cut short starts over: it holds nothing
  // but what the creation itself wrote. Children before parents.
  if (state === 'unfinished') {
    for (const table of [...TABLES].reverse()) await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }

  // New vault: the schema straight from schema.ts, stamped last — until the
  // stamp it counts as unfinished and is created again on the next open.
  if (state === 'empty' || state === 'unfinished') {
    await createSchema(db);
    // The starter set is created in the language that is active at first
    // open — `main.tsx` waits for the stored language before anything
    // opens the database.
    await seedBuiltins(db, (key) => i18n.t(`categories.starter.${key}`));
    // Not in seedBuiltins: schema.ts imports no block logic.
    await seedSigilTemplate(db, i18n.t);
    await seedAltarTemplate(db, i18n.t);
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
      [baseline, 'baseline', new Date().toISOString()]
    );
    return;
  }
  const current = state as number;
  if (current === baseline) return;

  // A migration changes rows on every device on its own, so sync starts over
  // from a snapshot. Noted first: a crash in the chain must not lose that.
  const tracked = await isTracked(db);
  if (tracked) {
    await markMigrated(db);
    await dropTriggers(db);
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    await migration.up(db);
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
      [migration.version, migration.name, new Date().toISOString()]
    );
  }
  if (tracked) await installTriggers(db);
}

/**
 * Tables from which the purge after the vault's trash retention period deletes permanently. Runs on every
 * opening of a vault, deliberately separate from the migrations — idempotent,
 * time-dependent and not part of the schema history.
 *
 * `categories` is not here: whatever still points to a category must first
 * be detached from it (ON DELETE RESTRICT). `runPeriodicCleanup`
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
  // Its file stays until the cleanup in Settings → Storage finds it unused.
  'images',
] as const;

/**
 * The next running number of an entry type — each type counts on its own.
 * Entries in the trash count too, so that a number does not occur twice after
 * a restore. The number is assigned on creation and stays: a replace import
 * reassigns ROWIDs, so the ROWID cannot stand in for it.
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
