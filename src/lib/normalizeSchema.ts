/**
 * Migration v33 — the rebuild that brings existing databases to the schema of
 * v37 (`schemaV37.ts`; up to v37 that was the same as `schema.ts`).
 *
 * Why this is not the usual 12-step procedure from the SQLite docs:
 * the SQL layer (`db.rs`) runs an sqlx connection pool (default 10
 * connections). `PRAGMA foreign_keys = OFF` and `BEGIN` each hit
 * only *one* connection, and which one serves the next statement is
 * not controllable. Neither is reliably available here, then.
 *
 * The procedure is therefore built so that foreign keys may stay active
 * throughout:
 *
 *   1. Roll back leftovers of an aborted run
 *   2. Take a file snapshot (VACUUM INTO)
 *   3. Repair legacy damage while the old schema is still in place
 *   4. Rename old tables to `*_old`  — at this point no table has a
 *      foreign key yet, so a RENAME cannot bend any reference
 *   5. Create new tables under their final names
 *   6. Copy data parents-before-children
 *   7. Drop `*_old` — nothing refers to them, so no FK violation
 *   8. Create indexes (only now, before that the names would be taken)
 *   9. `PRAGMA foreign_key_check`
 *
 * If the run aborts between 4 and 7, `*_old` tables are left lying around and v33
 * is not stamped. Step 1 restores the initial state on the next start
 * and the rebuild runs again.
 *
 * If it aborts between 7 and 9, the rebuild is finished content-wise, but still
 * unstamped. `alreadyRebuilt` detects that and skips the part that
 * presupposes the old schema — without this check, `repairLegacyDamage` would run
 * against the already renamed column and the vault could never be opened
 * again.
 */
import type Database from './sqlite';
import { V37_TABLES, V37_TABLE_DDL, V37_INDEX_DDL } from './schemaV37';
import {
  assertForeignKeysIntact,
  backupDatabaseFile,
  columnNames,
  copyTable,
  createIndexesIfMissing,
  tableExists,
} from './dbRebuild';

/**
 * `schema_version` survives the rebuild — it records what is currently running.
 *
 * Deliberately the frozen v37 list, not `TABLES` from `schema.ts`: v33 builds
 * the state of back then, not today's (see the header of `schemaV37.ts`).
 */
const REBUILT = V37_TABLES.filter((t) => t !== 'schema_version');

/** Tables that v33 removes without replacement. */
const DROPPED = ['creations', 'altar_intentions'] as const;

/**
 * Restores the state before an aborted rebuild: the half-finished
 * new table is thrown out, `*_old` gets its name back.
 */
async function rollbackPartialRebuild(db: Database): Promise<void> {
  for (const table of REBUILT) {
    if (!(await tableExists(db, `${table}_old`))) continue;
    console.warn(`[db] v33: rolling back remains of an aborted run for ${table}`);
    if (await tableExists(db, table)) {
      await db.execute(`DROP TABLE ${table}`);
    }
    await db.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
  }
}

/**
 * Brings the old tables into a state that the new schema accepts.
 * Runs before the renaming, i.e. against the old schema.
 */
async function repairLegacyDamage(db: Database): Promise<void> {
  // --- Categories that content points at but that no longer exist ------------
  // Caused by the 30-day purge and `emptyTrash`, which hard-deleted categories
  // without touching their content. The new RESTRICT foreign key
  // would otherwise block the rebuild.
  // The fallback IDs of back then as literals: `general` existed only for tasks,
  // and v38 later merges everything into the one `other` anyway.
  for (const [table, target, fallback] of [
    ['operations', 'operation_categories', 'other'],
    ['tasks', 'task_categories', 'general'],
  ] as const) {
    await db.execute(
      `UPDATE ${table} SET category_id = $1
        WHERE category_id IS NULL
           OR category_id NOT IN (SELECT id FROM ${target})`,
      [fallback]
    );
  }
  await db.execute(
    `UPDATE wiki_articles SET category = 'other'
      WHERE category IS NULL
         OR category NOT IN (SELECT id FROM wiki_categories)`
  );

  // The fallback categories must exist, otherwise the foreign key misses
  // again right away. On very old vaults the seeding may have been missing.
  await db.execute(
    `INSERT OR IGNORE INTO operation_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('sigils', 'Sigils', '🔯', 0, 1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO operation_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('other', 'Other', '📦', 2, 1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO wiki_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('other', 'Other', '📄', 11, 1)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO task_categories (id, name, emoji, sort_order, is_builtin)
     VALUES ('general', 'Allgemein', '📋', 0, 0)`
  );
  await db.execute(
    `INSERT OR IGNORE INTO altar_categories (id, name, emoji, created_at)
     VALUES ('other', 'Other', '📦', $1)`,
    [new Date().toISOString()]
  );

  // --- Move creations into operations ---------------------------------------
  // Legacy table, predecessor of operations. No store writes it any more, and
  // the backup never exported it — its rows were silently lost on every
  // restore. Instead of dropping them, they get a home here.
  if (await tableExists(db, 'creations')) {
    await db.execute(`
      INSERT OR IGNORE INTO operations (
        id, title, content, category_id, description, target_reveal_date,
        charging_technique_wiki_id, is_loaded, intention_text, letter_bank,
        implemented_letters, show_intention_in_properties,
        show_letter_bank_in_properties, show_sigil, drawing_data, thumbnail_data,
        created_at, updated_at, tags, deleted_at, entry_number
      )
      SELECT
        id, title, '', 'sigils', description, target_reveal_date,
        charging_technique_wiki_id, is_loaded, intention_text, letter_bank,
        implemented_letters, show_intention_in_properties,
        show_letter_bank_in_properties, show_sigil, drawing_data, thumbnail_data,
        created_at, updated_at, tags, deleted_at, entry_number
      FROM creations
    `);
  }

  // --- Altar placements without an altar ------------------------------------
  // The actual v4 damage: v4 aborted after the first ALTER, `altar_id`
  // only came later with v30/v31 — as NULL for every existing row. These
  // placements have been invisible since, because the app only ever loads placements
  // per altar. The new NOT NULL foreign key now forces a resolution.
  const placementCols = await columnNames(db, 'altar_placements');
  if (!placementCols.has('altar_id')) {
    await db.execute('ALTER TABLE altar_placements ADD COLUMN altar_id TEXT');
  }

  const homeless = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM altar_placements
      WHERE altar_id IS NULL OR altar_id NOT IN (SELECT id FROM altars)`
  );
  if ((homeless[0]?.n ?? 0) > 0) {
    const existing = await db.select<{ id: string }[]>(
      'SELECT id FROM altars ORDER BY created_at ASC, title ASC LIMIT 1'
    );
    let target = existing[0]?.id;
    if (!target) {
      // Not a single altar exists: exactly the scenario for which v4 wanted to
      // create the default altar. It is made up for now — the old
      // placements become visible again as a result.
      target = crypto.randomUUID();
      const legacyIntention = (await tableExists(db, 'altar_intentions'))
        ? await db.select<{ text: string }[]>(
            'SELECT text FROM altar_intentions ORDER BY date DESC LIMIT 1'
          )
        : [];
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO altars (id, title, intention, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [target, 'Primary Altar', legacyIntention[0]?.text ?? '', now]
      );
      console.info('[db] v33: Default-Altar nachgeholt, den Migration v4 nie angelegt hat');
    }
    await db.execute(
      `UPDATE altar_placements SET altar_id = $1
        WHERE altar_id IS NULL OR altar_id NOT IN (SELECT id FROM altars)`,
      [target]
    );
  }

  // Placements whose item has vanished cannot be displayed.
  await db.execute(
    'DELETE FROM altar_placements WHERE item_id NOT IN (SELECT id FROM altar_items)'
  );

  // --- Orphans in the link tables --------------------------------------------
  await db.execute(
    'DELETE FROM task_links WHERE task_id NOT IN (SELECT id FROM tasks)'
  );
  // The new UNIQUE(task_id, target_id, target_type) tolerates no duplicates.
  await db.execute(
    `DELETE FROM task_links WHERE rowid NOT IN (
       SELECT MIN(rowid) FROM task_links GROUP BY task_id, target_id, target_type
     )`
  );

  // --- Backfill sequence numbers ---------------------------------------------
  // Migration v9 filled `entry_number` once from the ROWID, but no
  // INSERT ever wrote the column. A number was still always visible,
  // because the stores laid `ROWID as entry_number` over it when reading.
  // That alias is gone — without a backfill, all entries created since
  // v9 lose their displayed number.
  for (const table of ['journal_entries', 'wiki_articles', 'operations'] as const) {
    await db.execute(
      `UPDATE ${table} SET entry_number = ROWID WHERE entry_number IS NULL`
    );
  }

  // --- Loose ends ------------------------------------------------------------
  await db.execute(
    'UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id NOT IN (SELECT id FROM tasks)'
  );
  await db.execute(
    `UPDATE journal_entries
        SET linked_operation_ids = COALESCE(linked_operation_ids, '[]'),
            linked_wiki_ids      = COALESCE(linked_wiki_ids, '[]')`
  );
}

async function renameOldTables(db: Database): Promise<void> {
  for (const table of REBUILT) {
    if (await tableExists(db, table)) {
      await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_old`);
    }
  }
}

async function createNewTables(db: Database): Promise<void> {
  for (const table of REBUILT) {
    await db.execute(V37_TABLE_DDL[table]);
  }
}

async function copyData(db: Database): Promise<void> {
  // The order follows V37_TABLES: parents before children, because foreign keys are active.
  for (const table of REBUILT) {
    const from = `${table}_old`;
    switch (table) {
      case 'wiki_articles':
        await copyTable(db, table, from, { category_id: 'o.category' });
        break;

      case 'altar_items':
        // The old column held the category *name*. Try by ID first —
        // in case an ID is in there after all — then by name, otherwise 'other'.
        await copyTable(db, table, from, {
          category_id: `COALESCE(
            (SELECT c.id FROM altar_categories c WHERE c.id = o.category),
            (SELECT c.id FROM altar_categories c WHERE c.name = o.category),
            'other'
          )`,
        });
        break;

      case 'journal_entries':
        await copyTable(db, table, from, {
          linked_operation_ids: "COALESCE(o.linked_operation_ids, '[]')",
          linked_wiki_ids: "COALESCE(o.linked_wiki_ids, '[]')",
        });
        break;

      default:
        await copyTable(db, table, from);
    }
  }
}

async function dropOldTables(db: Database): Promise<void> {
  for (const table of REBUILT) {
    await db.execute(`DROP TABLE IF EXISTS ${table}_old`);
  }
  for (const table of DROPPED) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }
}

/**
 * Are the tables already rebuilt? Then v33 was just not stamped any more,
 * for example because the process ended between `dropOldTables` and the stamping.
 */
async function alreadyRebuilt(db: Database): Promise<boolean> {
  for (const table of REBUILT) {
    if (await tableExists(db, `${table}_old`)) return false;
  }
  return (await columnNames(db, 'wiki_articles')).has('category_id');
}

export async function normalizeSchema(db: Database): Promise<void> {
  await rollbackPartialRebuild(db);

  if (await alreadyRebuilt(db)) {
    console.info('[db] v33: rebuild already done, catching up on indexes and verification only');
    await createIndexesIfMissing(db, V37_INDEX_DDL);
    await assertForeignKeysIntact(db, 'v33');
    return;
  }

  await backupDatabaseFile(db, 'v33');
  await repairLegacyDamage(db);
  await renameOldTables(db);
  await createNewTables(db);
  await copyData(db);
  await dropOldTables(db);
  await createIndexesIfMissing(db, V37_INDEX_DDL);
  await assertForeignKeysIntact(db, 'v33');
}
