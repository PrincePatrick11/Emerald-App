import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { getActiveDbConnectionString, getActiveVaultId } from './vaultManager';
import { BASELINE_VERSION, IMAGE_FIELDS, TABLE_DDL, createSchema, ddlIfNotExists, seedBuiltins, storedImageName } from './schema';
import { normalizeSchema } from './normalizeSchema';
import { adoptLegacyImages, rewriteImageRefs } from './images';

// Per-vault DB cache: SQLite identifier → Database instance
const _dbCache = new Map<string, Database>();
// Serialises the first-load for each vault to avoid duplicate runMigrations calls
const _initPromises = new Map<string, Promise<Database>>();

/**
 * Close and drop all cached connections. Call before switching vaults.
 *
 * Dropping the JavaScript reference is not enough: the connection pool lives in
 * `tauri-plugin-sql`, and an open pool keeps the file locked. On Windows that
 * means the vault's folder cannot be moved, relocated, or deleted for the rest
 * of the session — which is exactly what the vault modal's "delete files"
 * checkbox tries to do.
 */
export async function resetDbCache(): Promise<void> {
  // Erst die laufenden Ladevorgaenge abwarten, dann leeren. Ein `getDb()`
  // traegt seine Verbindung erst *nach* `Database.load` in den Cache ein — wer
  // nur leert, uebersieht genau die: sie landet danach in der frisch geleerten
  // Map, wird nie geschlossen, und auf Windows bleibt die Datei bis zum
  // Neustart gesperrt.
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
 * Das Löschen der Dateien eines Vaults braucht die Datenbank entsperrt.
 * `resetDbCache()` allein reicht dafür nicht: die Editoren halten entprellte
 * Speicher-Timer, und einer, der in genau diesem Moment feuert, öffnet über
 * `getDb()` wieder die Datei, die gerade verschwinden soll.
 *
 * `getDb()` wirft solange `DB_CLOSED`. Die Speicher-Timer sind fire-and-forget
 * und fangen das ab — die verlorene Änderung gehört zu dem Vault, der gerade
 * gelöscht wird.
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
  const identifier = await getActiveDbConnectionString();

  if (_dbCache.has(identifier)) return _dbCache.get(identifier)!;
  if (_initPromises.has(identifier)) return _initPromises.get(identifier)!;

  const promise = (async () => {
    // SQLite does not create a directory for its own file, so the vault folder
    // has to exist before the load.
    await invoke('ensure_vault_dirs', { vaultId });
    const db = await Database.load(identifier);
    await runMigrations(db);
    await runPeriodicCleanup(db);
    _dbCache.set(identifier, db);
    _initPromises.delete(identifier);
    return db;
  })();

  _initPromises.set(identifier, promise);
  return promise;
}

type Migration = {
  version: number;
  name: string;
  /**
   * Eingefrorene Historie: v1–v32, so wie bestehende Datenbanken sie gelaufen
   * sind. Nur bei diesen werden „already applied"-Fehler geschluckt (siehe
   * isAlreadyAppliedError). Neue Migrationen ab v33 tragen das Flag nicht und
   * schlagen laut fehl, wenn etwas schiefgeht.
   */
  legacy?: true;
  up: (db: Database) => Promise<void>;
};

/**
 * Whether an error from a migration's `up` indicates the schema change was
 * already applied by an older version of the app.
 *
 * Gilt ausschließlich für `legacy`-Migrationen. Das Schlucken ist bequem, aber
 * gefährlich: Es bricht die *gesamte* restliche Migration ab und stempelt sie
 * trotzdem als angewendet. Genau daran ist v4 gescheitert — v1 legt `altars`
 * bereits mit `background_preset` an, v4 fängt mit einem ALTER für dieselbe
 * Spalte an, und alles danach (u. a. `altar_placements.altar_id` und das
 * Default-Altar-Seeding) wurde nie ausgeführt. Die Notfall-Migrationen v30 und
 * v31 existieren deshalb. Für neue Migrationen darf das nie wieder gelten.
 */
function isAlreadyAppliedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate column name|already exists|table .* already exists/i.test(msg);
}

/**
 * Ist das eine unberührte Datei? Dann bekommt sie das Baseline-Schema statt 33
 * Migrationsschritten. `schema_version` allein reicht als Kriterium nicht: Eine
 * Datenbank aus der Zeit vor dem Migrationssystem hätte Tabellen, aber keine
 * Versionstabelle — sie muss die Kette laufen.
 */
async function isEmptyDatabase(db: Database): Promise<boolean> {
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  return (rows[0]?.n ?? 0) === 0;
}

export async function runMigrations(db: Database): Promise<void> {
  // Use DELETE journal mode — simpler than WAL, survives unclean shutdowns
  await db.execute('PRAGMA journal_mode = DELETE');

  const latest = MIGRATIONS[MIGRATIONS.length - 1].version;
  if (latest !== BASELINE_VERSION) {
    throw new Error(
      `[db] schema.ts steht auf BASELINE_VERSION ${BASELINE_VERSION}, die letzte Migration ist v${latest}. ` +
        'Beide müssen zusammenpassen, sonst bekommen frische und migrierte Vaults unterschiedliche Schemata.'
    );
  }

  // Frische Datei: Baseline direkt anlegen und die Kette überspringen.
  if (await isEmptyDatabase(db)) {
    await createSchema(db);
    await seedBuiltins(db);
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
      [BASELINE_VERSION, 'baseline', now]
    );
    return;
  }

  await db.execute(ddlIfNotExists(TABLE_DDL.schema_version));

  const versionRows = await db.select<{ version: number | null }[]>(
    'SELECT COALESCE(MAX(version), 0) AS version FROM schema_version'
  );
  const currentVersion = versionRows[0]?.version ?? 0;

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
}

/**
 * Tabellen, aus denen der 30-Tage-Purge endgültig löscht. Läuft bei jedem
 * Öffnen eines Vaults, bewusst getrennt vom Migrationssystem — idempotent,
 * zeitabhängig und kein Teil der Schema-Historie.
 *
 * Kategorietabellen stehen bewusst **nicht** hier. Eine Kategorie nach 30 Tagen
 * hart zu löschen, während Artikel, Operationen oder Tasks noch darauf zeigen,
 * hinterließ ins Leere zeigende `category_id`-Werte — still und unbemerkt. Seit
 * v33 verhindert ein Foreign Key mit ON DELETE RESTRICT das ohnehin. Kategorien
 * werden nur noch über den Papierkorb entfernt, und dort werden ihre Inhalte
 * vorher auf die Default-Kategorie umgehängt (siehe `reassignCategoryContent`).
 *
 * Table names interpolated into SQL — must stay a hardcoded literal list.
 */
const CLEANUP_TABLES = [
  'journal_entries',
  'wiki_articles',
  'tags',
  'operations',
  'tasks',
] as const;

/**
 * Die nächste laufende Nummer für `journal_entries`, `wiki_articles` oder
 * `operations`.
 *
 * Früher wurde `entry_number` gar nicht geschrieben — die Stores holten sich
 * beim Lesen `SELECT *, ROWID as entry_number` und überschrieben damit die
 * Spalte, die Migration v9 einmal befuellt hatte. Das ging so lange gut, bis
 * ein Replace-Import die ROWIDs neu vergab und sich alle angezeigten Nummern
 * verschoben. Jetzt wird die Nummer beim Anlegen vergeben und bleibt.
 *
 * Table name interpolated into SQL — nur mit literalen Namen aufrufen.
 */
export async function nextEntryNumber(
  db: Database,
  table: 'journal_entries' | 'wiki_articles' | 'operations'
): Promise<number> {
  const rows = await db.select<{ n: number }[]>(
    `SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM ${table}`
  );
  return rows[0]?.n ?? 1;
}

/** Alle IDs, auf die eine polymorphe Verknüpfung zeigen darf. */
const CONTENT_IDS = `(SELECT id FROM journal_entries
                      UNION ALL SELECT id FROM wiki_articles
                      UNION ALL SELECT id FROM operations)`;

async function runPeriodicCleanup(db: Database): Promise<void> {
  // Auto-purge trash items older than 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const table of CLEANUP_TABLES) {
    await db.execute(
      `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
      [cutoff]
    );
  }

  await sweepDanglingLinks(db);
}

/**
 * Entfernt Verknüpfungen, deren Ziel nicht mehr existiert.
 *
 * `links` und `task_links.target_id` sind polymorph — das `*_type`-Feld
 * entscheidet, welche Tabelle gemeint ist — und können deshalb keinen Foreign
 * Key tragen. Es räumt hier also nichts von selbst auf, und jedes endgültige
 * Löschen von Inhalten hinterlässt Waisen, wenn es nicht ausdrücklich passiert.
 *
 * Wird sowohl vom 30-Tage-Purge als auch vom Leeren des Papierkorbs benutzt,
 * damit beide Wege dasselbe Ergebnis liefern.
 */
export async function sweepDanglingLinks(db: Database): Promise<void> {
  const contentIds = `${CONTENT_IDS}`;
  await db.execute(
    `DELETE FROM links
      WHERE source_id NOT IN ${contentIds}
         OR target_id NOT IN ${contentIds}`
  );
  await db.execute(`DELETE FROM task_links WHERE target_id NOT IN ${contentIds}`);
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
    // Erste Migration ohne `legacy`-Flag: Fehler werden nicht mehr geschluckt.
    //
    // Bringt bestehende Datenbanken auf das Schema aus `schema.ts` — dasselbe
    // DDL, das frische Vaults über den Baseline-Pfad bekommen. Ab hier sind die
    // beiden Wege wieder deckungsgleich, und `scripts/schema-check.mjs` prueft
    // genau das.
    //
    // Der Ablauf steht in `normalizeSchema.ts`; er ist zu umfangreich, um hier
    // noch lesbar zu sein.
    version: 33,
    name: 'normalize_schema',
    up: normalizeSchema,
  },
  {
    // Eine eingebaute „Other"-Kategorie für Operationen. Bis hierher gab es nur
    // `sigils` und `servitors`, weshalb Operationen einer gelöschten Kategorie
    // bei den Sigillen landeten — inhaltlich falsch, denn eine Operation wird
    // nicht dadurch zum Sigill, dass ihre Kategorie verschwindet.
    //
    // v33 legt sie auf Vaults an, die den Rebuild noch vor sich haben; dieser
    // Schritt holt sie für alle nach, die ihn schon hinter sich haben.
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
    // Bilder gehoeren ab hier dem Vault. Sie liegen in `{vaultDir}/images/`, und
    // referenziert wird nur noch der Dateiname.
    //
    // Vorher stand in `content` der absolute Pfad in eine Ablage, die sich alle
    // Vaults geteilt haben. Das hat drei Dinge gleichzeitig kaputtgemacht: die
    // Datenbank war an einen Rechner und einen Benutzer gebunden, ein Bild war
    // aus jedem Vault sichtbar, und Aufraeumen war unmoeglich — `cleanup_unused_images`
    // musste entfernt werden, weil es Bilder fremder Vaults als unbenutzt
    // geloescht hat.
    //
    // Der Umzug der Datenbankdatei selbst ist *keine* Migration: sie zieht um,
    // bevor sie geoeffnet wird. Das macht `migrate_vault_layout`, angestossen
    // aus `vaultManager.loadVaultsFile()`.
    version: 35,
    name: 'vault_scoped_images',
    up: async (db) => {
      const adopt = new Set<string>();
      const updates: { sql: string; params: unknown[] }[] = [];

      // Bewusst ohne die `legacy`-Spalten aus IMAGE_FIELDS: die halten
      // Data-URLs, und ihre Renderer koennen mit einem Dateinamen nichts
      // anfangen. Gelesen werden sie trotzdem — von
      // `collectUsedImageFilenames`, damit die Aufraeum-Aktion nichts loescht,
      // worauf sie noch zeigen.
      for (const { table, html, plain } of IMAGE_FIELDS) {
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

      // Erst kopieren, dann umschreiben. Schlaegt das Kopieren fehl, wird
      // trotzdem umgeschrieben: der Protokoll-Handler faellt auf die alte
      // gemeinsame Ablage zurueck, das Bild bleibt also sichtbar. Andersherum
      // — umschreiben ohne Kopie und ohne Fallback — waere es weg.
      // `adoptLegacyImages` schreibt in den *aktiven* Vault. Das passt, weil
      // `runMigrations` ausschliesslich aus `getDb()` laeuft und das immer den
      // aktiven Vault oeffnet — aber die Annahme steht nicht in der Signatur.
      if (adopt.size > 0) {
        try {
          await adoptLegacyImages([...adopt]);
        } catch (err) {
          console.warn('[db] v35: Uebernahme aus der alten Bildablage fehlgeschlagen', err);
        }
      }

      for (const { sql, params } of updates) {
        await db.execute(sql, params);
      }
    },
  },
];
