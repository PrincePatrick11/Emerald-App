/**
 * Checks that fresh and migrated vaults end up with the identical schema.
 *
 * This is the test without which the baseline squash cannot be justified:
 * `db.ts` has two paths to the schema — the DDL from `schema.ts` for fresh
 * files, and the migration steps for existing ones. If they drift apart,
 * nobody notices until a user sees an error message.
 *
 * Runs against `node:sqlite` instead of the app, so the run takes seconds
 * and needs no Tauri environment.
 *
 *   npm run check:schema
 */
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workDir = mkdtempSync(join(tmpdir(), 'emerald-schema-'));

/* ------------------------------------------------------------------ *
 * Adapter: node:sqlite behind the interface of src/lib/sqlite.ts
 * ------------------------------------------------------------------ */

/**
 * The app uses `$1` placeholders. node:sqlite does not bind those positionally
 * ("column index out of range"), whereas SQLite's own `?1` form does — even
 * when the same placeholder occurs several times, as in `trashStore.emptyTrash`.
 */
function toIndexedPlaceholders(sql) {
  return sql.replace(/\$(\d+)/g, '?$1');
}

class HarnessDb {
  constructor(path) {
    this.raw = new DatabaseSync(path);
  }

  async execute(sql, params = []) {
    if (!params.length) {
      // exec() copes with PRAGMA and VACUUM, prepare().run() does not consistently.
      this.raw.exec(sql);
      return { rowsAffected: 0 };
    }
    const stmt = this.raw.prepare(toIndexedPlaceholders(sql));
    const info = stmt.run(...params);
    return { rowsAffected: Number(info.changes ?? 0) };
  }

  async select(sql, params = []) {
    const stmt = this.raw.prepare(toIndexedPlaceholders(sql));
    return stmt.all(...params);
  }

  /** Like `db_batch`: one transaction, all or nothing. */
  async batch(statements) {
    let affected = 0;
    this.raw.exec('BEGIN');
    try {
      for (const [sql, params = []] of statements) affected += (await this.execute(sql, params)).rowsAffected;
      this.raw.exec('COMMIT');
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
    return affected;
  }

  close() {
    this.raw.close();
  }
}

/* ------------------------------------------------------------------ *
 * Build the bundle — the Tauri modules do not exist in node
 * ------------------------------------------------------------------ */

const STUBS = {
  '@tauri-apps/api/core': `
    export async function invoke(cmd, args) {
      // The database here is HarnessDb. A path that nevertheless wants to open it
      // through the app layer (src/lib/sqlite.ts) should fail loudly.
      if (String(cmd).startsWith('db_')) throw new Error(cmd + ' is not used in the harness');
      // vaultManager reads vaults.json and creates it on the first failure.
      if (cmd === 'read_file') throw new Error('ENOENT (Harness)');
      // Migration v42 saves sigil drawings as a file: a fixed
      // name, and a forced failure if the data URL carries "FAIL".
      if (cmd === 'save_image') {
        if (String(args?.dataUrl ?? '').includes('FAIL')) throw new Error('save_image failed (Harness)');
        return '${'c'.repeat(64)}.png';
      }
      // Without vaults.json this command decides whether it is a first start
      // (empty vault list) or an existing installation is adopted. The
      // harness needs the second case: an empty list would mean no active
      // vault, and v33 backs up the database file via getActiveDbFile().
      if (cmd === 'legacy_default_db_exists') return true;
      // A vault is a directory; in the harness that is simply the
      // working directory, so that the backup from v33 lands there.
      if (cmd === 'migrate_vault_layout' || cmd === 'default_vault_dir' || cmd === 'new_vault_base_dir') {
        return process.env.EMERALD_HARNESS_DIR;
      }
      return undefined;
    }`,
  '@tauri-apps/api/path': `
    export async function appDataDir() { return process.env.EMERALD_HARNESS_DIR; }`,
};

const stubPlugin = {
  name: 'tauri-stubs',
  setup(b) {
    const filter = new RegExp(
      `^(${Object.keys(STUBS).map((k) => k.replace(/[/@-]/g, '\\$&')).join('|')})$`
    );
    b.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: STUBS[args.path],
      loader: 'js',
    }));
  },
};

const entry = join(workDir, 'entry.ts');
writeFileSync(
  entry,
  `export { runMigrations, MIGRATIONS, clearLegacyUntitledTitles, sweepDanglingTaskLinks } from '${process.cwd().replace(/\\/g, '/')}/src/lib/db';
   export { TABLES, TABLE_DDL, ddlIfNotExists, checkIntegrity, reassignCategoryContent, collectUsedImageFilenames } from '${process.cwd().replace(/\\/g, '/')}/src/lib/schema';
   export { copyTable } from '${process.cwd().replace(/\\/g, '/')}/src/lib/dbRebuild';
   export { ddlBeforeV49 } from '${process.cwd().replace(/\\/g, '/')}/src/lib/schemaV48';
   export { assertPayloadReferencesResolve, dropUnknownTagIds, entryRowsForInsert, importTagsAndRemap, migrateBackupPayload, withRoutinesAsTemplates } from '${process.cwd().replace(/\\/g, '/')}/src/lib/dbBackup';
   export { invalidateVaultCache } from '${process.cwd().replace(/\\/g, '/')}/src/lib/vaultManager';
   export { convertLegacySigils, needsSigilConversion, sigilRowToContent } from '${process.cwd().replace(/\\/g, '/')}/src/lib/migrateLegacySigils';
   export { linkedIdsToContent, rowsLinkSource } from '${process.cwd().replace(/\\/g, '/')}/src/lib/migrateLinkedIdsToContent';
   export { journalFieldsToContent } from '${process.cwd().replace(/\\/g, '/')}/src/lib/migrateJournalFieldsToContent';
   export { stripTagIds, replaceTagId } from '${process.cwd().replace(/\\/g, '/')}/src/lib/tagRefs';`
);

const bundlePath = join(workDir, 'bundle.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  plugins: [stubPlugin],
  logLevel: 'warning',
});

process.env.EMERALD_HARNESS_DIR = workDir;

// `dbBackup` pulls in `DOMParser` via the full-text extraction, which Node
// does not know. The harness never parses HTML — it checks schema and references —,
// so a placeholder is enough for the import to go through.
globalThis.DOMParser ??= class {
  parseFromString() {
    throw new Error('DOMParser is not supported in the schema harness');
  }
};

// Likewise `localStorage`: i18n reads the stored language from it. Empty is
// the right answer — the harness runs in English, and that is exactly what
// the category name checks further down expect.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const {
  runMigrations, MIGRATIONS, clearLegacyUntitledTitles, sweepDanglingTaskLinks, entryRowsForInsert, TABLES, TABLE_DDL,
  ddlIfNotExists, checkIntegrity, reassignCategoryContent,
  collectUsedImageFilenames, invalidateVaultCache, copyTable, ddlBeforeV49,
  assertPayloadReferencesResolve, convertLegacySigils, migrateBackupPayload, withRoutinesAsTemplates,
  needsSigilConversion, sigilRowToContent, linkedIdsToContent, rowsLinkSource, journalFieldsToContent,
  stripTagIds, replaceTagId, importTagsAndRemap, dropUnknownTagIds,
} = await import(pathToFileURL(bundlePath).href);

/* ------------------------------------------------------------------ *
 * Read out and compare the schema
 * ------------------------------------------------------------------ */

/**
 * `ALTER TABLE ... RENAME` writes the table name back to sqlite_master
 * quoted, a direct CREATE does not. For the comparison that is
 * meaningless, so strip it — together with the indentation from the DDL.
 *
 * The same goes for whitespace around commas and parentheses: `ALTER TABLE ... ADD COLUMN`
 * (v46) appends its column as `, name TYPE)` to the stored text, where
 * the baseline DDL writes `, name TYPE )`. The same table.
 */
function normalizeSql(sql) {
  return (sql ?? '')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/ ?([,()]) ?/g, '$1')
    .trim();
}

async function readSchema(db) {
  const out = {};
  for (const table of TABLES) {
    const [master] = await db.select(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
      [table]
    );
    out[table] = {
      sql: normalizeSql(master?.sql),
      columns: (await db.select(`PRAGMA table_info(${table})`)).map((c) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        dflt: c.dflt_value,
        pk: c.pk,
      })),
      foreignKeys: (await db.select(`PRAGMA foreign_key_list(${table})`))
        .map((f) => ({ table: f.table, from: f.from, to: f.to, onDelete: f.on_delete }))
        .sort((a, b) => `${a.from}`.localeCompare(`${b.from}`)),
    };
  }
  out._indexes = (
    await db.select(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name"
    )
  ).map((i) => ({ name: i.name, table: i.tbl_name, sql: normalizeSql(i.sql) }));
  return out;
}

/* ------------------------------------------------------------------ *
 * The two paths to the schema
 * ------------------------------------------------------------------ */

/** `links` as it stood up to v46 — for tests that recreate a vault from before v47. */
const LINKS_BEFORE_V47 = `CREATE TABLE links (
  source_id TEXT NOT NULL, source_type TEXT NOT NULL,
  target_id TEXT NOT NULL, target_type TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id))`;

function freshDb(name) {
  // Every run gets its own directory, otherwise the snapshots that v33 stores
  // under a fixed name collide.
  //
  // `invalidateVaultCache()` is needed for this since `vaultManager` caches
  // the vault path: without the reset the first run keeps its directory
  // for all later ones, and the separation here would be ineffective
  // — visible when v33 reports "backup of an earlier attempt already
  // exists at …" although it is a fresh file.
  const dir = join(workDir, name.replace(/\.db$/, ''));
  mkdirSync(dir, { recursive: true });
  process.env.EMERALD_HARNESS_DIR = dir;
  invalidateVaultCache();
  return new HarnessDb(join(dir, name));
}

/** The baseline path: untouched file. */
async function buildViaBaseline() {
  const db = freshDb('baseline.db');
  await runMigrations(db);
  return db;
}

/**
 * Replays v1–v32 the way an existing database ran them —
 * including swallowing "already applied" errors, which v4 fails on.
 * Afterwards the schema from before the rebuild is in place; `seed` may fill it.
 */
async function chainTo32(name, seed) {
  const db = freshDb(name);
  await db.execute(ddlIfNotExists(TABLE_DDL.schema_version));

  for (const m of MIGRATIONS) {
    if (m.version > 32) break;
    try {
      await m.up(db);
    } catch (err) {
      if (!/duplicate column name|already exists/i.test(String(err.message))) throw err;
    }
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1,$2,$3)',
      [m.version, m.name, new Date().toISOString()]
    );
  }

  if (seed) await seed(db);
  return db;
}

/**
 * The chain path: v1–v32, then runMigrations takes over and applies the rest.
 * With `until` the chain stops after that version — for tests that want to see the state
 * right after a migration, before a later one (such as v49) rebuilds the
 * tables. `runMigrations(db)` afterwards continues the chain.
 */
async function buildViaChain(name, seed, until) {
  const db = await chainTo32(name, seed);
  if (until === undefined) {
    await runMigrations(db);
    return db;
  }
  for (const m of MIGRATIONS) {
    if (m.version <= 32 || m.version > until) continue;
    await m.up(db);
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1,$2,$3)',
      [m.version, m.name, new Date().toISOString()]
    );
  }
  return db;
}

/* ------------------------------------------------------------------ *
 * Test data for the rebuild
 * ------------------------------------------------------------------ */

const now = new Date().toISOString();

/** Reproduces exactly the states that v33 has to repair. */
/** A valid image name: 64 hex characters plus extension. */
const LEGACY_IMAGE = `${'a1b2c3d4e5f60718'.repeat(4)}.png`;

/**
 * Image references as they stood in the database before v35: an absolute path
 * in the HTML of a journal row, one directly in an altar column, and next to them
 * a data URL each, which v35 must not touch.
 *
 * A database of its own instead of seedLegacyData, because an altar inserted here would
 * defeat the check "v33 creates exactly one default altar".
 */
async function seedImageRefs(db) {
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags)
     VALUES ('j1','Eintrag',$2,$1,$1,'[]')`,
    [now, `<p>x</p><img src="C:\\Users\\x\\Roaming\\app\\images\\${LEGACY_IMAGE}"><img src="data:image/png;base64,AAAA">`]
  );
  await db.execute(
    `INSERT INTO altars (id,title,intention,background_preset,background_image_data,icon_data,created_at,updated_at)
     VALUES ('a1','Altar','','custom',$2,'data:image/png;base64,BBBB',$1,$1)`,
    [now, `/home/x/.local/share/app/images/${LEGACY_IMAGE}`]
  );
}

/**
 * Journal links as they stood in the columns before v36: an
 * operation and a wiki article, one of them already present as a chip in the
 * text (must not be appended twice), plus a row with broken
 * JSON, which the migration must leave alone.
 *
 * A database of its own instead of seedLegacyData, so that the count checks there
 * do not shift.
 */
async function seedLinkedIds(db) {
  const chip = '<span data-type="internalLink" class="internal-link" data-id="w1" data-entry-type="wiki" data-label="Artikel">Artikel</span>';
  // j1: the normal case — one operation and one article, both only in the columns.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_operation_ids,linked_wiki_ids)
     VALUES ('j1','Eintrag','<p>Bestehender Text</p>',$1,$1,'[]','["o1"]','["w1"]')`,
    [now]
  );
  // j2: broken JSON.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_operation_ids)
     VALUES ('j2','Zweiter','<p>Zweiter</p>',$1,$1,'[]','{oops')`,
    [now]
  );
  // j3: w1 is already a chip in the text (no second block), w2 does not exist.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_wiki_ids)
     VALUES ('j3','Dritter',$2,$1,$1,'[]','["w1","w2"]')`,
    [now, `<p>${chip}</p>`]
  );
  // j4: still-empty entry — the first block comes without a separator line.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_operation_ids)
     VALUES ('j4','Vierter','<p></p>',$1,$1,'[]','["o1"]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w1','Artikel','artikel','','ritual',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o1','Operation','','sigils',$1,$1,'[]')`,
    [now]
  );
}

/**
 * The three fixed journal fields as they stood in the columns before v37:
 * once complete with articles and duration, once a set is_bannung
 * without an article (the checkbox existed before the selection behind it), once a
 * paradigm whose article no longer exists.
 */
async function seedJournalFields(db) {
  for (const [id, title, category] of [
    ['w1', 'Chaos', 'paradigm'],
    ['w2', 'LBRP', 'bannung'],
    ['w3', 'Stilles Sitzen', 'meditation'],
  ]) {
    await db.execute(
      `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
       VALUES ($1,$2,$1,'',$3,$4,$4,'[]')`,
      [id, title, category, now]
    );
  }
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,
       paradigm_id,is_bannung,bannung_type_wiki_id,is_meditation,meditation_type_wiki_id,meditation_duration)
     VALUES ('j1','Eintrag','<p>Bestehender Text</p>',$1,$1,'[]','w1',1,'w2',1,'w3',20)`,
    [now]
  );
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,is_bannung)
     VALUES ('j2','Zweiter','<p></p>',$1,$1,'[]',1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,paradigm_id)
     VALUES ('j3','Dritter','<p>Text</p>',$1,$1,'[]','weg')`,
    [now]
  );
}

/**
 * Categories as v38 has to merge them — set up against the schema from before v33
 * so that they run through the whole chain: a custom wiki category
 * "candle" (lowercase) against the built-in altar "Candle", a custom
 * operations category "Ritual" against the built-in wiki "ritual", a
 * deleted wiki "Foo" against an active tasks "foo", a task in
 * "general" — and a piece of content on each category, plus placements and
 * task links, which have to survive the rebuild of the child tables.
 */
async function seedCategoryMerge(db) {
  await db.execute(
    `INSERT INTO wiki_categories (id,name,emoji,sort_order,is_builtin) VALUES ('wc1','candle','🔥',50,0)`
  );
  await db.execute(
    `INSERT INTO wiki_categories (id,name,emoji,sort_order,is_builtin,deleted_at) VALUES ('wc2','Foo','🅵',51,0,$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO operation_categories (id,name,emoji,sort_order,is_builtin) VALUES ('oc1','Ritual','🪄',5,0)`
  );
  await db.execute(
    `INSERT INTO task_categories (id,name,emoji,sort_order,is_builtin) VALUES ('tc1','foo','🅵',1,0)`
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w1','Kerzenkunde','kerzenkunde','','wc1',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w2','Ritualaufbau','ritualaufbau','','ritual',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o1','Abendritual','','oc1',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o2','Sigill','','sigils',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,created_at,updated_at,tags)
     VALUES ('t1','Allgemeines','','general',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,parent_task_id,created_at,updated_at,tags)
     VALUES ('t2','Foo-Aufgabe','','tc1','t1',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl1','t1','w1','wiki')`
  );
  await db.execute(
    `INSERT INTO altars (id,title,intention,background_preset,created_at,updated_at)
     VALUES ('a1','Altar','','midnight',$1,$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_items (id,name,emoji,category,note,created_at) VALUES ('i1','Kerze','🕯️','Candle','',$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_items (id,name,emoji,category,note,created_at) VALUES ('i2','Ding','✨','Other','',$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_placements (id,altar_id,item_id,x,y) VALUES ('p1','a1','i1',10,20)`
  );
  await db.execute(
    `INSERT INTO altar_placements (id,altar_id,item_id,x,y) VALUES ('p2','a1','i2',30,40)`
  );
}

/**
 * Operations as v41 finds them: an inactive one with text, an active one with
 * end date and version without text, one in the normal state, which must stay untouched.
 * Deliberately not in "Sigils" — there v42 afterwards puts the sigil set in front.
 */
async function seedOperationStatus(db) {
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,is_active,end_date,version)
     VALUES ('s1','Ruhend','<p>Text</p>','other',$1,$1,'[]',0,NULL,NULL)`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,is_active,end_date,version)
     VALUES ('s2','Befristet','','other',$1,$1,'[]',1,'2026-03-01','1.2')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('s3','Normal','<p>unberührt</p>','other',$1,$1,'[]')`, // lang-ok
    [now]
  );
}

/**
 * Sigils as v42 finds them: a complete one (drawing, intention,
 * letters, loaded, date, charging technique, notes), one whose drawing
 * cannot be saved, an empty one in the category and an
 * ordinary operation with notes.
 */
async function seedSigils(db) {
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('wt1','Ekstase','ekstase','','other',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,description,intention_text,
       letter_bank,implemented_letters,drawing_data,is_loaded,target_reveal_date,charging_technique_wiki_id)
     VALUES ('g1','Stärke','','sigils',$1,$1,'[]','Notiz','Ich bin stark','["I","C"]','["I"]', -- lang-ok
       'data:image/png;base64,AAAA',1,'2099-01-01','wt1')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,drawing_data)
     VALUES ('g2','Klemmt','','sigils',$1,$1,'[]','data:image/png;base64,FAIL')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('g3','Leer','','sigils',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,description)
     VALUES ('g4','Gewöhnlich','<p>Text</p>','other',$1,$1,'[]','Nur Notiz')`, // lang-ok
    [now]
  );
  // A hidden drawing, a drawing that is not an image, and an
  // operation that already carries sigil blocks (an aborted v42 run).
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,drawing_data,show_sigil)
     VALUES ('g5','Versteckt','','sigils',$1,$1,'[]','data:image/png;base64,CCCC',0)`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,drawing_data)
     VALUES ('g6','Kein Bild','','sigils',$1,$1,'[]','data:text/html;base64,PHNjcmlwdD4=')`, // lang-ok
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('g7','Schon Blöcke','<section data-block="core.sigil.calc" data-block-id="x1"></section>','sigils',$1,$1,'[]')`, // lang-ok
    [now]
  );
}

async function seedLegacyData(db) {
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_wiki_ids)
     VALUES ('j1','Eintrag','',$1,$1,'[]',NULL)`,
    [now]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w1','Artikel','artikel','','ritual',$1,$1,'[]')`,
    [now]
  );
  // Article whose category was hard-deleted — the silent legacy data.
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w2','Waise','waise','','geloescht',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o1','Operation','','sigils',$1,$1,'[]')`,
    [now]
  );
  // Legacy creations row: must survive as an operation.
  await db.execute(
    `INSERT INTO creations (id,title,description,created_at,updated_at,tags,intention_text)
     VALUES ('c1','Alte Kreation','Beschreibung',$1,$1,'[]','Absicht')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,created_at,updated_at,tags)
     VALUES ('t1','Aufgabe','','general',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,parent_task_id,created_at,updated_at,tags)
     VALUES ('t2','Unteraufgabe','','general','t1',$1,$1,'[]')`,
    [now]
  );
  // Duplicate task_link — the new UNIQUE cannot handle it.
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl1','t1','w1','wiki')`
  );
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl2','t1','w1','wiki')`
  );
  // Altar item with a category *name* instead of an ID, plus a placement without an altar:
  // exactly the v4 damage.
  await db.execute(
    `INSERT INTO altar_items (id,name,emoji,category,note,created_at)
     VALUES ('i1','Kerze','🕯️','Candle','',$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_placements (id,item_id,x,y) VALUES ('p1','i1',10,20)`
  );
  // Routine with Markdown, raw HTML, tag and a link to the operation — becomes a template in v44.
  await db.execute(
    `INSERT INTO routines (id,name,emoji,content,tags,operation_ids,wiki_ids,created_at,updated_at)
     VALUES ('r1-routine','Morgenritual','🌅','**Atmen** <script>x</script> [böse](javascript:alert(1)) [gut](https://example.org)','["ritual"]','["o1","fehlt"]','[]',$1,$1)`, // lang-ok
    [now]
  );
}

/* ------------------------------------------------------------------ *
 * Execution
 * ------------------------------------------------------------------ */

const failures = [];
function check(label, ok, detail) {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(String(detail).split('\n').map((l) => `        ${l}`).join('\n'));
    failures.push(label);
  }
}

console.log('\n1. Baseline against migration chain\n');

const baseline = await buildViaBaseline();
const chain = await buildViaChain('chain.db');

const schemaA = await readSchema(baseline);
const schemaB = await readSchema(chain);

for (const table of TABLES) {
  const a = schemaA[table];
  const b = schemaB[table];
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(
    `${table}`,
    same,
    same
      ? null
      : `baseline: ${JSON.stringify(a, null, 1)}\nchain:    ${JSON.stringify(b, null, 1)}`
  );
}
check(
  'Indexes',
  JSON.stringify(schemaA._indexes) === JSON.stringify(schemaB._indexes),
  `baseline: ${JSON.stringify(schemaA._indexes)}\nchain:    ${JSON.stringify(schemaB._indexes)}`
);

const droppedCheck = await chain.select(
  `SELECT name FROM sqlite_master WHERE type='table' AND name IN (
     'creations','altar_intentions','custom_properties',
     'wiki_categories','operation_categories','task_categories','altar_categories','_category_id_map',
     'journal_entries','wiki_articles','operations'
   ) OR name LIKE '%_old'`
);
check('legacy tables, old category and entry tables and _old tables removed', droppedCheck.length === 0, JSON.stringify(droppedCheck));

console.log('\n2. Foreign keys\n');
for (const [label, db] of [['baseline', baseline], ['chain', chain]]) {
  const violations = await db.select('PRAGMA foreign_key_check');
  check(`${label}: foreign_key_check empty`, violations.length === 0, JSON.stringify(violations));
}

console.log('\n3. Rebuild on real data\n');

const seeded = await buildViaChain('seeded.db', seedLegacyData);

const rows = async (sql) => (await seeded.select(sql))[0];

check(
  'creations row is preserved as an operation',
  (await rows("SELECT COUNT(*) n FROM entries WHERE id='c1' AND type='operation'")).n === 1
);
check(
  'operations complete (1 own + 1 from creations)',
  (await rows("SELECT COUNT(*) n FROM entries WHERE type='operation'")).n === 2
);
check(
  'altar_items.category_id now holds the ID',
  (await rows("SELECT category_id c FROM altar_items WHERE id='i1'")).c === 'candle'
);
check(
  // v38 moves an unknown category to `other` — that is the state
  // v39 finds afterwards, it does not move anything itself.
  'orphaned article moved to "other" during the v38 upgrade',
  (await rows("SELECT category_id c FROM entries WHERE id='w2' AND type='wiki'")).c === 'other'
);
check(
  'article with a valid category unchanged',
  (await rows("SELECT category_id c FROM entries WHERE id='w1' AND type='wiki'")).c === 'ritual'
);
check(
  'no journal entry lost',
  (await rows("SELECT COUNT(*) n FROM entries WHERE type='journal'")).n === 1
);
check(
  'after v49 the journal has neither category nor icon',
  (await rows("SELECT COUNT(*) n FROM entries WHERE type='journal' AND (category_id IS NOT NULL OR icon IS NOT NULL)")).n === 0
);
check(
  'duplicate task_link removed',
  (await rows('SELECT COUNT(*) n FROM task_links')).n === 1
);
check(
  'subtask keeps its parent',
  (await rows("SELECT parent_task_id p FROM tasks WHERE id='t2'")).p === 't1'
);
check(
  'homeless placement has been given an altar',
  (await rows("SELECT COUNT(*) n FROM altar_placements WHERE altar_id IS NOT NULL")).n === 1
);
check(
  'default altar was created after the fact (v4 damage)',
  (await rows('SELECT COUNT(*) n FROM altars')).n === 1
);
const seededViolations = await seeded.select('PRAGMA foreign_key_check');
check('real data: foreign_key_check empty', seededViolations.length === 0, JSON.stringify(seededViolations));

const orphans = await checkIntegrity(seeded);
check(
  'checkIntegrity: no orphans in the polymorphic tables',
  orphans.length === 0,
  JSON.stringify(orphans)
);

console.log('\n3b. Migration v44: routines become templates\n');

{
  const [routineTable] = await seeded.select("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='routines'");
  const [tpl] = await seeded.select("SELECT * FROM templates WHERE id='r1-routine'");
  check('the routines table is gone', routineTable.n === 0);
  // Since v53 the template carries the ID of the tag "ritual" — v53 created it.
  const tagNamesOf = async (db, json) => {
    const names = [];
    for (const id of JSON.parse(json ?? '[]')) names.push((await db.select('SELECT name FROM tags WHERE id=?1', [id]))[0]?.name);
    return names.join(',');
  };
  check('the routine is a template with name, emoji, tags and without assignment',
    tpl && tpl.name === 'Morgenritual' && tpl.icon === '🌅' && (await tagNamesOf(seeded, tpl.tags)) === 'ritual' && tpl.assignments === '[]',
    JSON.stringify(tpl));
  check('Markdown is formatted, raw HTML is escaped',
    tpl && tpl.content.includes('<strong>Atmen</strong>') && !tpl.content.includes('<script>') && tpl.content.includes('&lt;script&gt;'),
    tpl?.content);
  check('only http(s) links stay links, javascript: becomes text',
    tpl && !tpl.content.includes('javascript:') && tpl.content.includes('href="https://example.org"') && tpl.content.includes('böse'), // lang-ok
    tpl?.content);
  check('the linked operation becomes a link chip, a missing target is dropped',
    tpl && tpl.content.includes('data-id="o1"') && !tpl.content.includes('fehlt'),
    tpl?.content);
  const backups = readdirSync(join(workDir, 'seeded')).filter((f) => f.includes('.pre-v44'));
  check('v44 created a backup beforehand', backups.length === 1, backups.join(', '));
}

console.log('\n3c. Routines from older backups\n');

{
  // A '7' file with a routine: link to a bundled operation, to
  // one in the vault (o1 from the seed) and to one that the filter left out.
  const backup = {
    version: '7', type: 'backup', exportedAt: now, filters: {}, images: {},
    data: {
      operations: [{ id: 'bk-op', title: 'Aus der Datei', icon: null, category_id: null, entry_number: 1, deleted_at: null }], // lang-ok
      wikiArticles: [], categories: [], templates: [{ id: 'bk-tpl', name: 'Datei-Vorlage', sort_order: 4 }],
      routines: [{
        id: 'bk-routine', name: 'Alt', emoji: '🕯', content: 'Text', tags: '[]',
        operation_ids: '["bk-op","o1","weggefiltert"]', wiki_ids: '[]', created_at: now, updated_at: now,
      }],
    },
  };
  migrateBackupPayload(backup);
  check('migrateBackupPayload leaves the routines for the import', backup.data.routines.length === 1 && backup.sourceVersion === 7);
  const d = await withRoutinesAsTemplates(seeded, backup.data);
  const converted = d.templates.find((t) => t.id === 'bk-routine');
  check('import: link targets from file and vault become chips, missing ones are dropped',
    converted && converted.content.includes('data-id="bk-op"') && converted.content.includes('data-id="o1"') && !converted.content.includes('weggefiltert'),
    converted?.content);
  check('import: the routine comes after the templates of the file, without a routines remainder',
    converted && converted.sort_order === 5 && d.routines.length === 0, JSON.stringify(converted));
}

console.log('\n4. checkIntegrity finds what foreign keys do not cover\n');

{
  // The polymorphic tables and the JSON arrays cannot be secured by a
  // constraint. checkIntegrity is the replacement — this test makes
  // sure that it actually triggers and does not merely return empty.
  const db = freshDb('integrity.db');
  await runMigrations(db);
  await db.execute(
    `INSERT INTO entries (id,type,title,content,created_at,updated_at,tags)
     VALUES ('e1','wiki','Artikel','',$1,$1,'[]')`,
    [now]
  );
  await db.execute(`INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('t1','Aufgabe',$1,$1)`, [now]);
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type)
     VALUES ('tl1','t1','fehlt','wiki'), ('tl2','t1','e1','journal'), ('tl3','t1','e1','wiki')`
  );

  const found = await checkIntegrity(db);
  const hit = (id, type) => found.some((o) => o.table === 'task_links' && o.id === id && o.missingTarget === type);

  check('orphan in task_links detected', hit('fehlt', 'wiki'));
  check('a link with the wrong type counts as an orphan', hit('e1', 'journal'));
  check('the correct link to the same entry does not', !hit('e1', 'wiki'), JSON.stringify(found));
  await sweepDanglingTaskLinks(db);
  const kept = (await db.select('SELECT id FROM task_links ORDER BY id')).map((r) => r.id);
  check('the sweep removes the same links that checkIntegrity reports', JSON.stringify(kept) === '["tl3"]', JSON.stringify(kept));
  check(
    'PRAGMA foreign_key_check sees none of this',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

console.log('\n5. Deleting a category loses no entries\n');

{
  const db = baseline;
  await db.execute(
    `INSERT INTO categories (id,name,emoji,sort_order,is_builtin)
     VALUES ('temporaer','Temporär','🧪',99,0)` // lang-ok
  );
  await db.execute(
    `INSERT INTO entries (id,type,title,content,category_id,created_at,updated_at,tags)
     VALUES ('a1','wiki','Wichtiger Artikel','Inhalt','temporaer',$1,$1,'[]')`,
    [now]
  );
  // Since v38 the same category also holds content of the other modules.
  await db.execute(
    `INSERT INTO tasks (id,title,category_id,created_at,updated_at)
     VALUES ('a1t','Aufgabe','temporaer',$1,$1)`,
    [now]
  );

  // Without reassigning, ON DELETE RESTRICT has to refuse the deletion — otherwise
  // a category_id without a counterpart would arise again.
  let blocked = false;
  try {
    await db.execute("DELETE FROM categories WHERE id='temporaer'");
  } catch {
    blocked = true;
  }
  check('RESTRICT refuses to delete a category in use', blocked);

  const moved = await reassignCategoryContent(db, 'temporaer');
  check('reassignCategoryContent reassigned article and task', moved === 2);

  await db.execute("DELETE FROM categories WHERE id='temporaer'");

  const [article] = await db.select("SELECT title, category_id FROM entries WHERE id='a1'");
  check('article still exists after the category deletion', article !== undefined);
  // Since v39 there is no catch-all any more: the content becomes categoryless.
  check('article is now without a category', article?.category_id === null);
  check('article content unchanged', article?.title === 'Wichtiger Artikel');
}

console.log('\n5b. Backup with entries without a category\n');

{
  // The pre-check of the backup import read `category_id = NULL` as an
  // unresolvable reference and aborted the whole import — exactly in the
  // state with which every new entry has started since v39. It runs before the
  // first DELETE, so the backup simply could not be restored.
  const db = freshDb('nullcat.db');
  await runMigrations(db);

  const payload = {
    categories: [{ id: 'sigils', name: 'Sigils' }],
    wikiArticles: [{ id: 'a', title: 'Ohne', category_id: null }], // lang-ok
    operations: [{ id: 'o', title: 'Ohne', category_id: null }], // lang-ok
    tasks: [{ id: 't', title: 'Ohne', category_id: null }], // lang-ok
    altarItems: [{ id: 'i', name: 'Ohne', category_id: null }], // lang-ok
  };

  let accepted = true;
  let message = '';
  try {
    await assertPayloadReferencesResolve(db, payload);
  } catch (err) {
    accepted = false;
    message = String(err?.message ?? err);
  }
  check('entries without a category do not block the import', accepted, message);

  // An empty *string* remains a hit into nothing and must keep being noticed.
  let rejected = false;
  try {
    await assertPayloadReferencesResolve(db, { wikiArticles: [{ id: 'b', category_id: '' }] });
  } catch {
    rejected = true;
  }
  check('an empty category ID still counts as a broken reference', rejected);

  // And a real reference into nothing likewise.
  let unknownRejected = false;
  try {
    await assertPayloadReferencesResolve(db, { tasks: [{ id: 'c', category_id: 'gibtsnicht' }] });
  } catch {
    unknownRejected = true;
  }
  check('an unknown category ID still counts as a broken reference', unknownRejected);
  db.close();
}

console.log('\n6. Insertion order during import\n');

{
  // A backup import inserts row by row. With active foreign keys
  // the parent row has to be there beforehand — and `tasks.parent_task_id` points to
  // the same table, so a child can come before its parent in the
  // file. dbBackup solves this with insertTasks(): first insert without parent
  // reference, then fill it in. This is exactly what is reproduced here.
  const db = freshDb('import.db');
  await runMigrations(db);

  const kind = [
    { id: 'kind', title: 'Unteraufgabe', parent_task_id: 'eltern' },
    { id: 'eltern', title: 'Aufgabe', parent_task_id: null },
  ];

  let naiveFailed = false;
  try {
    for (const t of kind) {
      await db.execute(
        `INSERT INTO tasks (id,title,category_id,parent_task_id,created_at,updated_at)
         VALUES ($1,$2,NULL,$3,$4,$4)`,
        [t.id, t.title, t.parent_task_id, now]
      );
    }
  } catch {
    naiveFailed = true;
  }
  check('naive insertion in file order fails on the foreign key', naiveFailed);

  await db.execute('DELETE FROM tasks');
  for (const t of kind) {
    await db.execute(
      `INSERT INTO tasks (id,title,category_id,parent_task_id,created_at,updated_at)
       VALUES ($1,$2,NULL,NULL,$3,$3)`,
      [t.id, t.title, now]
    );
  }
  for (const t of kind.filter((x) => x.parent_task_id)) {
    await db.execute(
      'UPDATE tasks SET parent_task_id=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM tasks WHERE id=$1)',
      [t.parent_task_id, t.id]
    );
  }
  const [child] = await db.select("SELECT parent_task_id FROM tasks WHERE id='kind'");
  check('filling in the parent reference afterwards works (insertTasks)', child?.parent_task_id === 'eltern');
  check(
    'import order leaves no violation behind',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

console.log('\n7. Backup and resumption\n');

const chainDir = join(workDir, 'chain');
const backups = readdirSync(chainDir).filter((f) => f.includes('.pre-v33'));
check(`v33 created exactly one backup (${backups.length})`, backups.length === 1, backups.join(', '));
if (backups.length) {
  const restored = new HarnessDb(join(chainDir, backups[0]));
  const hasOld = await restored.select(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='creations'"
  );
  check('backup contains the state *before* the rebuild', hasOld.length === 1);
  restored.close();
}

{
  // The rebuild can abort between dropOldTables and the stamping: the
  // *_old tables are gone by then, but v33 is unstamped. Without the
  // alreadyRebuilt check, repairLegacyDamage would run on the next start against
  // the already renamed schema ("no such column: category") — and since v33
  // carries no legacy flag, the vault could never be opened again.
  // Reproduced the way it happens: v1–v32 stamped, v33 ran once,
  // but not stamped — then runMigrations takes over with v33 again.
  const db = await chainTo32('resume.db');
  await MIGRATIONS.find((m) => m.version === 33).up(db);

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('aborted v33 rebuild does not break on the next start', resumed, message);
  check(
    'schema unchanged after resumption',
    (await db.select(
      "SELECT COUNT(*) AS n FROM pragma_table_info('entries') WHERE name='category_id'"
    ))[0].n === 1
  );
  check(
    'resumption leaves no FK violation',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

{
  // The same for v38: fully rebuilt, but unstamped. On the next start
  // contentRebuilt recognises the state and only catches up on the cleanup.
  const db = await buildViaChain('resume38.db');
  await db.execute('DELETE FROM schema_version WHERE version = 38');

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('aborted v38 rebuild does not break on the next start', resumed, message);
  check(
    'schema unchanged after the v38 resumption',
    JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA)
  );
  db.close();
}

{
  // The dangerous moment in v39: the new tables are in place and filled,
  // the cleanup of the *_old tables has begun — `task_links_old` and
  // `altar_placements_old` are gone, `tasks_old` and `altar_items_old` still exist.
  // Without a marker the next start would remove the finished `tasks`, and its
  // ON DELETE CASCADE would take the equally finished `task_links` with it.
  const db = await buildViaChain('resume39.db', seedLegacyData, 48);
  const before = {
    links: (await db.select('SELECT COUNT(*) n FROM task_links'))[0].n,
    placements: (await db.select('SELECT COUNT(*) n FROM altar_placements'))[0].n,
  };
  check('initial state: child tables are filled', before.links > 0 && before.placements > 0,
    JSON.stringify(before));

  // Reproduce the abort: unstamp v39, rebuild by hand until shortly
  // before the end. The stamps after it (v40–v48) go too: an abort in
  // v39 never gets as far as them, and the run resumes at the highest stamp.
  // Not as far as v47 either — so `links` still exists there.
  await db.execute('DELETE FROM schema_version WHERE version >= 39');
  await db.execute(LINKS_BEFORE_V47);
  for (const t of ['task_links', 'altar_placements', 'tasks', 'altar_items', 'operations', 'wiki_articles']) {
    await db.execute(`ALTER TABLE ${t} RENAME TO ${t}_old`);
  }
  for (const t of ['wiki_articles', 'operations', 'altar_items', 'tasks', 'altar_placements', 'task_links']) {
    await db.execute(ddlBeforeV49(t));
    await copyTable(db, t, `${t}_old`);
  }
  await db.execute('CREATE TABLE IF NOT EXISTS _v39_content_rebuilt (done INTEGER)');
  await db.execute('DROP TABLE task_links_old');
  await db.execute('DROP TABLE altar_placements_old');

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('aborted v39 cleanup does not break on the next start', resumed, message);
  check(
    'resumption did not empty the child tables via CASCADE',
    (await db.select('SELECT COUNT(*) n FROM task_links'))[0].n === before.links &&
      (await db.select('SELECT COUNT(*) n FROM altar_placements'))[0].n === before.placements,
    JSON.stringify({
      before,
      links: (await db.select('SELECT COUNT(*) n FROM task_links'))[0].n,
      placements: (await db.select('SELECT COUNT(*) n FROM altar_placements'))[0].n,
    })
  );
  check(
    'marker and *_old tables are cleaned up',
    (await db.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name='_v39_content_rebuilt' OR name LIKE '%_old')"
    )).length === 0
  );
  check(
    'indexes are in place after the resumption too',
    (await db.select(
      "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_entries_category'"
    ))[0].n === 1
  );
  check(
    'resumption leaves no FK violation',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

console.log('\n8. Migration v35: image references\n');

{
  const v35 = await buildViaChain('v35.db', seedImageRefs);
  const [entry] = await v35.select("SELECT content FROM entries WHERE id='j1' AND type='journal'");
  const [altar] = await v35.select("SELECT background_image_data, icon_data FROM altars WHERE id='a1'");

  check(
    'absolute path in the HTML was reduced to the file name',
    entry.content.includes(`src="${LEGACY_IMAGE}"`) && !entry.content.includes('AppData'),
    entry.content
  );
  check(
    'the data URL next to it was left untouched',
    entry.content.includes('src="data:image/png;base64,AAAA"'),
    entry.content
  );
  check(
    'absolute path in a plain column was reduced',
    altar.background_image_data === LEGACY_IMAGE,
    altar.background_image_data
  );
  check(
    'a legacy column was NOT rewritten',
    altar.icon_data === 'data:image/png;base64,BBBB',
    altar.icon_data
  );

  // This is the property the cleanup action depends on: whatever the
  // migration knows, the used set must know too, otherwise the
  // cleanup deletes a file that is still referenced.
  const used = await collectUsedImageFilenames(v35);
  check(
    'collectUsedImageFilenames finds the reference again',
    used.has(LEGACY_IMAGE),
    [...used].join(', ')
  );
  v35.close();
}

console.log('\n8b. Migration v36: journal links into the content\n');

{
  // Up to v48: after that the columns whose clearing is checked here no longer exist.
  const v36 = await buildViaChain('v36.db', seedLinkedIds, 48);
  const [entry] = await v36.select(
    "SELECT content, linked_operation_ids, linked_wiki_ids FROM journal_entries WHERE id='j1'"
  );
  const [broken] = await v36.select(
    "SELECT content, linked_operation_ids FROM journal_entries WHERE id='j2'"
  );

  check(
    'the operation is a link chip in the content',
    entry.content.includes('data-id="o1"') && entry.content.includes('data-entry-type="operation"'),
    entry.content
  );
  check(
    'the wiki article likewise',
    entry.content.includes('data-id="w1"') && entry.content.includes('data-entry-type="wiki"'),
    entry.content
  );
  check(
    'each link got a separator line and a category heading',
    (entry.content.match(/<hr>/g) ?? []).length === 2 && (entry.content.match(/<h3>/g) ?? []).length === 2,
    entry.content
  );
  check(
    'the existing text stayed in front',
    entry.content.startsWith('<p>Bestehender Text</p>'),
    entry.content
  );
  check(
    'both columns are cleared',
    entry.linked_operation_ids === '[]' && entry.linked_wiki_ids === '[]',
    `${entry.linked_operation_ids} / ${entry.linked_wiki_ids}`
  );
  // Broken JSON must not clear the column: the original value would otherwise
  // be irretrievably gone.
  check(
    'broken JSON leaves the row untouched',
    broken.linked_operation_ids === '{oops' && broken.content === '<p>Zweiter</p>',
    `${broken.linked_operation_ids} / ${broken.content}`
  );

  const [third] = await v36.select(
    "SELECT content, linked_wiki_ids FROM journal_entries WHERE id='j3'"
  );
  check(
    'a target already linked in the text is not appended twice',
    (third.content.match(/data-id="w1"/g) ?? []).length === 1 && !third.content.includes('<hr>'),
    third.content
  );
  check(
    'a target that no longer exists is skipped, the column is cleared anyway',
    !third.content.includes('data-id="w2"') && third.linked_wiki_ids === '[]',
    `${third.content} / ${third.linked_wiki_ids}`
  );

  const [fourth] = await v36.select("SELECT content FROM journal_entries WHERE id='j4'");
  check(
    'in the empty entry the separator line is omitted',
    !fourth.content.includes('<hr>') && fourth.content.includes('data-id="o1"'),
    fourth.content
  );

  await runMigrations(v36);
  const [carried] = await v36.select("SELECT content FROM entries WHERE id='j1' AND type='journal'");
  check('v49 carries over the converted content unchanged', carried?.content === entry.content, carried?.content);

  v36.close();
}

console.log('\n8c. Migration v37: paradigm/banishing/meditation into the content\n');

{
  const v37 = await buildViaChain('v37.db', seedJournalFields, 48);
  const [entry] = await v37.select(
    `SELECT content, paradigm_id, is_bannung, bannung_type_wiki_id,
            is_meditation, meditation_type_wiki_id, meditation_duration
       FROM journal_entries WHERE id='j1'`
  );

  check(
    'all three fields are link chips in the content',
    ['w1', 'w2', 'w3'].every((id) => entry.content.includes(`data-id="${id}"`)),
    entry.content
  );
  check(
    'each got a separator line and a category heading',
    (entry.content.match(/<hr>/g) ?? []).length === 3 && (entry.content.match(/<h3>/g) ?? []).length === 3,
    entry.content
  );
  // The duration has no link target and would vanish without the text addition.
  check(
    'the meditation duration is text after its chip',
    /data-id="w3"[\s\S]*?<\/span> \(20 min\)/.test(entry.content),
    entry.content
  );
  check(
    'the existing text stayed in front',
    entry.content.startsWith('<p>Bestehender Text</p>'),
    entry.content
  );
  check(
    'all six columns are cleared',
    entry.paradigm_id === null && entry.is_bannung === 0 && entry.bannung_type_wiki_id === null &&
      entry.is_meditation === 0 && entry.meditation_type_wiki_id === null && entry.meditation_duration === null,
    JSON.stringify(entry)
  );

  const [flagOnly] = await v37.select("SELECT content, is_bannung FROM journal_entries WHERE id='j2'");
  // A checkbox without an article cannot yield a chip — the name of the category
  // stays as text, otherwise the information would be gone without replacement.
  check(
    'a set is_bannung without an article becomes text, in the empty entry without a separator line',
    /<p>🚫 .+<\/p>/.test(flagOnly.content) && !flagOnly.content.includes('<hr>') &&
      !flagOnly.content.includes('data-type="internalLink"') && flagOnly.is_bannung === 0,
    flagOnly.content
  );

  const [gone] = await v37.select("SELECT content, paradigm_id FROM journal_entries WHERE id='j3'");
  check(
    'an article that no longer exists is skipped, the column is cleared anyway',
    gone.content === '<p>Text</p>' && gone.paradigm_id === null,
    `${gone.content} / ${gone.paradigm_id}`
  );

  await runMigrations(v37);
  const [carried] = await v37.select("SELECT content FROM entries WHERE id='j1' AND type='journal'");
  check('v49 carries over the converted content unchanged', carried?.content === entry.content, carried?.content);

  v37.close();
}

console.log('\n8c2. Import of old backups: journal fields become blocks before insertion\n');

{
  // A backup carries targets and categories itself — already as a list.
  const source = rowsLinkSource(
    {
      operation: [{ id: 'o1', title: 'Ritual', icon: null, category_id: 'ritual', entry_number: 4 }],
      wiki: [
        { id: 'w1', title: 'Chaos', icon: 'data:image/png;base64,AAAA', category_id: 'paradigm', entry_number: 1 },
        { id: 'w3', title: 'Stilles Sitzen', icon: null, category_id: 'meditation', entry_number: 3 },
        { id: 'w9', title: 'Im Papierkorb', icon: null, category_id: null, entry_number: 9, deleted_at: now },
      ],
    },
    [
      { id: 'paradigm', name: 'Paradigma', emoji: '🌀', is_builtin: 0 },
      { id: 'meditation', name: 'Meditation', emoji: '🧘', is_builtin: 0 },
      { id: 'ritual', name: 'Ritual', emoji: '🪄', is_builtin: 0 },
    ],
  );
  const row = {
    id: 'j9', content: '<p>Alt</p>',
    linked_operation_ids: '["o1","weg"]', linked_wiki_ids: '["w9"]',
    paradigm_id: 'w1', is_bannung: 0, bannung_type_wiki_id: null,
    is_meditation: 1, meditation_type_wiki_id: 'w3', meditation_duration: 15,
  };
  const linked = linkedIdsToContent(row.content, row, source);
  const content = journalFieldsToContent(linked, row, source);
  check(
    'linked operation, paradigm and meditation are chips after the text',
    content.startsWith('<p>Alt</p>') && ['o1', 'w1', 'w3'].every((id) => content.includes(`data-id="${id}"`)),
    content
  );
  check(
    'targets in the trash of the file or without a row are dropped',
    !content.includes('data-id="w9"') && !content.includes('data-id="weg"'),
    content
  );
  check(
    'the category of the file becomes a heading, the duration text after the chip',
    content.includes('<h3>Ritual</h3>') && /data-id="w3"[\s\S]*?<\/span> \(15 min\)/.test(content),
    content
  );
  check('an image icon does not end up in the chip', !content.includes('base64'), content);
  check(
    'broken JSON leaves the row untouched',
    linkedIdsToContent('<p>x</p>', { id: 'j8', linked_wiki_ids: '{kaputt' }, source) === null
  );
  check(
    'a row without legacy data stays as it is',
    journalFieldsToContent(linkedIdsToContent('<p>x</p>', { id: 'j7' }, source), {}, source) === '<p>x</p>'
  );
}

console.log('\n8d. Migration v38: four category tables become one\n');

{
  const v38 = await buildViaChain('v38.db', seedCategoryMerge);
  const one = async (sql) => (await v38.select(sql))[0];
  const cats = await v38.select('SELECT id, name, emoji, is_builtin, deleted_at, sort_order FROM categories ORDER BY sort_order');
  const byId = new Map(cats.map((c) => [c.id, c]));

  check(
    'the four old tables are gone, the one is there',
    (await v38.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('wiki_categories','operation_categories','task_categories','altar_categories','_category_id_map')"
    )).length === 0 && byId.size > 0
  );
  check(
    'exactly one "Other" — the three "other" and the tasks "general" merged into it',
    cats.filter((c) => c.name.toLowerCase() === 'other' || c.id === 'general').length === 1,
    JSON.stringify(cats)
  );
  check(
    // v38 creates it as a builtin, v39 takes that away again: as an ordinary
    // category it keeps its content and can be renamed and deleted.
    'v39: "other" is an ordinary category with a translated name',
    byId.get('other')?.is_builtin === 0 && byId.get('other')?.name === 'Other',
    JSON.stringify(cats)
  );
  check('"sigils" stays built in', byId.get('sigils')?.is_builtin === 1);
  check(
    'custom wiki "candle" and built-in altar "Candle" are one category (wiki wins)',
    byId.has('wc1') && !byId.has('candle') && byId.get('wc1').emoji === '🔥',
    JSON.stringify(cats)
  );
  check(
    'the altar item now belongs to the merged category',
    (await one("SELECT category_id c FROM altar_items WHERE id='i1'")).c === 'wc1'
  );
  check(
    'custom operations "Ritual" merged into the wiki "ritual", the operation follows',
    !byId.has('oc1') && byId.has('ritual') &&
      (await one("SELECT category_id c FROM entries WHERE id='o1' AND type='operation'")).c === 'ritual'
  );
  check(
    'former builtins are normal categories with a translated name',
    byId.get('ritual')?.is_builtin === 0 && byId.get('ritual')?.name === 'Ritual'
  );
  check(
    'deleted wiki "Foo" and active tasks "foo" are one active category',
    byId.has('wc2') && byId.get('wc2').deleted_at === null && !byId.has('tc1') &&
      (await one("SELECT category_id c FROM tasks WHERE id='t2'")).c === 'wc2'
  );
  check(
    'task from "general" is in "other"',
    (await one("SELECT category_id c FROM tasks WHERE id='t1'")).c === 'other'
  );
  check(
    'subtask keeps its parent',
    (await one("SELECT parent_task_id p FROM tasks WHERE id='t2'")).p === 't1'
  );
  check(
    'articles unchanged on their categories',
    (await one("SELECT category_id c FROM entries WHERE id='w1'")).c === 'wc1' &&
      (await one("SELECT category_id c FROM entries WHERE id='w2'")).c === 'ritual'
  );
  // The trap of the rebuild: renaming altar_items/tasks redirects the
  // foreign keys of the child tables — without rebuilding them too, the DROP
  // of the *_old tables would take all placements and task links with it.
  check(
    'altar placements survived the rebuild',
    (await one('SELECT COUNT(*) n FROM altar_placements')).n === 2
  );
  check(
    'task links survived the rebuild',
    (await one('SELECT COUNT(*) n FROM task_links')).n === 1
  );
  check(
    // The order comes from v38; v39 does not re-sort.
    'sigils first, other last',
    cats[0].id === 'sigils' && cats[cats.length - 1].id === 'other'
  );
  const v38Violations = await v38.select('PRAGMA foreign_key_check');
  check('v38: foreign_key_check empty', v38Violations.length === 0, JSON.stringify(v38Violations));
  check(
    'v38: schema identical to the baseline',
    JSON.stringify(await readSchema(v38)) === JSON.stringify(schemaA)
  );

  const v38Backups = readdirSync(join(workDir, 'v38')).filter((f) => f.includes('.pre-v38'));
  check(`v38 created exactly one backup (${v38Backups.length})`, v38Backups.length === 1, v38Backups.join(', '));
  if (v38Backups.length) {
    const restored = new HarnessDb(join(workDir, 'v38', v38Backups[0]));
    const hasOld = await restored.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_categories'"
    );
    check('v38 backup contains the state *before* the merge', hasOld.length === 1);
    restored.close();
  }
  v38.close();
}

console.log('\n8e. Fresh vault: builtins and starter set\n');

{
  const cats = await baseline.select('SELECT id, name, is_builtin, sort_order FROM categories ORDER BY sort_order');
  check(
    // Since v39 only one. `other` is no longer created at all: it was
    // the default for new entries, and they simply have none now.
    'exactly one builtin, "sigils", and no "other"',
    cats.filter((c) => c.is_builtin === 1).length === 1 &&
      cats[0].id === 'sigils' && !cats.some((c) => c.id === 'other'),
    JSON.stringify(cats)
  );
  check(
    'starter set as normal categories, translated (harness: en)',
    cats.some((c) => c.id === 'herbs' && c.is_builtin === 0 && c.name === 'Herbs'),
    JSON.stringify(cats)
  );
}

console.log('\n8f. Migration v41: status, end date and version become a block\n');

{
  const v41 = await buildViaChain('v41.db', seedOperationStatus, 48);
  const op = async (id) => (await v41.select('SELECT content, is_active, end_date, version, updated_at FROM operations WHERE id=?1', [id]))[0];
  const [s1, s2, s3] = [await op('s1'), await op('s2'), await op('s3')];
  const defs = await v41.select("SELECT id, elements FROM block_definitions WHERE id='core-status'");

  check(
    'the inactive operation has the status block before its text',
    // With two blocks the text gets its wrapper too.
    s1.content.startsWith('<section data-block="core.fields"') && s1.content.includes('data-block-origin="core-status"') &&
      s1.content.endsWith('<p>Text</p></section>'),
    s1.content
  );
  check('end date and version are in the block', s2.content.includes('2026-03-01') && s2.content.includes('1.2'), s2.content);
  check(
    'the three columns are cleared',
    [s1, s2].every((r) => r.is_active === 1 && r.end_date === null && r.version === null),
    JSON.stringify([s1, s2])
  );
  check('an operation without a legacy status stays untouched', s3.content === '<p>unberührt</p>', s3.content); // lang-ok
  check('updated_at stays as it was', [s1, s2, s3].every((r) => r.updated_at === now));
  check(
    'the definition "Status" exists exactly once, with three elements',
    defs.length === 1 && JSON.parse(defs[0].elements).length === 3,
    JSON.stringify(defs)
  );
  // Via the chain, not the baseline: v41 only runs there at all.
  const plain = await buildViaChain('v41-plain.db', async (db) => {
    await db.execute(
      `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
       VALUES ('p1','Normal','<p>x</p>','other',$1,$1,'[]')`,
      [now]
    );
  });
  check(
    'without a legacy status v41 creates no definition',
    (await plain.select('SELECT COUNT(*) AS n FROM block_definitions'))[0].n === 0
  );
  plain.close();
  await runMigrations(v41);
  const [carried] = await v41.select("SELECT content FROM entries WHERE id='s1' AND type='operation'");
  check('v49 carries over the status block unchanged', carried?.content === s1.content, carried?.content);
  check('v41: schema identical to the baseline', JSON.stringify(await readSchema(v41)) === JSON.stringify(schemaA));
  v41.close();
}

console.log('\n8g. Migration v42: sigils become blocks\n');

{
  const v42 = await buildViaChain('v42.db', seedSigils, 48);
  const op = async (id) => (await v42.select(
    'SELECT content, drawing_data, intention_text, is_loaded, description, updated_at FROM operations WHERE id=?1', [id]
  ))[0];
  const [g1, g2, g3, g4] = [await op('g1'), await op('g2'), await op('g3'), await op('g4')];
  const image = `${'c'.repeat(64)}.png`;

  check(
    'complete sigil: calculator, drawing (as a file), charge, notes',
    g1.content.startsWith('<section data-block="core.sigil.calc"') && g1.content.includes(`src="${image}"`) &&
      g1.content.includes('data-block="core.sigil.charge"') && g1.content.includes('data-id="wt1"') &&
      g1.content.includes('<p>Notiz</p>') && g1.content.includes('Ich bin stark'),
    g1.content
  );
  check('no base64 drawing in the content', !g1.content.includes('base64'));
  check(
    'the sigil columns are cleared',
    g1.drawing_data === null && g1.intention_text === '' && g1.is_loaded === 0 && g1.description === '',
    JSON.stringify(g1)
  );
  check(
    'if saving the drawing fails, the row stays untouched',
    g2.drawing_data === 'data:image/png;base64,FAIL' && g2.content === '',
    JSON.stringify(g2)
  );
  check(
    'the empty operation of the category gets the sigil set',
    ['core.sigil.calc', 'core.sigil.canvas', 'core.sigil.charge'].every((t) => g3.content.includes(`data-block="${t}"`)),
    g3.content
  );
  check(
    'an ordinary operation with notes gets only the text block',
    g4.content.includes('Nur Notiz') && g4.content.includes('<p>Text</p>') && !g4.content.includes('core.sigil'), // lang-ok
    g4.content
  );
  check('updated_at stays as it was', [g1, g2, g3, g4].every((r) => r.updated_at === now));
  check(
    'v42 created a backup beforehand',
    readdirSync(join(workDir, 'v42')).some((f) => f.includes('.pre-v42'))
  );

  // Catching up on opening: only rows with legacy data — a sigil from which the
  // user removed the blocks does not get them back.
  await v42.execute("UPDATE operations SET content='<p>ohne</p>' WHERE id='g3'"); // lang-ok
  await v42.execute("UPDATE operations SET drawing_data='data:image/png;base64,BBBB' WHERE id='g2'");
  const retry = await convertLegacySigils(v42, { includeSigilCategory: false });
  const [g2b, g3b] = [await op('g2'), await op('g3')];
  check('the catch-up converts the failed row', retry.converted === 1 && g2b.content.includes(`src="${image}"`), JSON.stringify(retry));
  check('the catch-up adds nothing to an emptied sigil', g3b.content === '<p>ohne</p>', g3b.content); // lang-ok

  const [g5, g6, g7] = [await op('g5'), await op('g6'), await op('g7')];
  check(
    '`show_sigil = 0` without a charge: the drawing block is hidden',
    /<section data-block="core\.sigil\.canvas"[^>]*data-block-hidden="1"/.test(g5.content),
    g5.content
  );
  check(
    'a drawing that is not an image is discarded instead of being retried endlessly',
    g6.drawing_data === null && g6.content.includes('core.sigil.calc') && !g6.content.includes('src='),
    JSON.stringify(g6)
  );
  check(
    'if the content already carries sigil blocks, no second set is added',
    g7.content.split('core.sigil.calc').length === 2,
    g7.content
  );

  // Import: the same conversion on rows of a backup, before insertion.
  const fileRow = (over) => ({
    id: 'h', content: '', category_id: 'other', description: '', intention_text: '', letter_bank: '[]',
    implemented_letters: '[]', drawing_data: null, is_loaded: 0, target_reveal_date: null,
    charging_technique_wiki_id: null, show_sigil: 1, ...over,
  });
  const h1 = fileRow({ category_id: 'sigils', intention_text: 'A', charging_technique_wiki_id: 'wt1' });
  const h3 = fileRow({ category_id: 'sigils' });
  const h4 = fileRow({ letter_bank: '["X"]' });
  check(
    'import: rows with legacy data are recognised, empty ones of the category only from old files',
    needsSigilConversion(h1, false) && needsSigilConversion(h4, false) && !needsSigilConversion(fileRow({}), true)
      && needsSigilConversion(h3, true) && !needsSigilConversion(h3, false)
  );
  const h1Content = await sigilRowToContent(h1, (id) => (id === 'wt1' ? { title: 'Technik', icon: '🔥', entry_number: 3 } : undefined));
  check(
    'import: the row becomes calculator, drawing and charge — with charging technique from the file',
    h1Content.includes('core.sigil.calc') && h1Content.includes('core.sigil.charge') && h1Content.includes('Technik'),
    h1Content
  );
  check(
    'import: if saving the drawing fails, the conversion reports it',
    (await sigilRowToContent(fileRow({ drawing_data: 'data:image/png;base64,FAIL' }), () => undefined)) === undefined
  );

  await runMigrations(v42);
  const [carried] = await v42.select("SELECT content FROM entries WHERE id='g1' AND type='operation'");
  check('v49 carries over the sigil blocks unchanged', carried?.content === g1.content, carried?.content);
  check('v42: schema identical to the baseline', JSON.stringify(await readSchema(v42)) === JSON.stringify(schemaA));
  v42.close();
}

console.log('\n8h. Restamping: block migrations with the old numbering (v39–v41)\n');

{
  // The blocks branch first counted block_definitions/status/sigils as
  // v39–v41; v39 then went to category_optional. Reproduce such a
  // development vault: turn the stamps back, v39 is missing.
  // Up to v46: such a vault dates from before v47, and v48 needs the old entry tables.
  const db = await buildViaChain('renumber.db', async () => {}, 46);
  await db.execute("DELETE FROM schema_version WHERE name = 'category_optional'");
  await db.execute("UPDATE schema_version SET version = 39 WHERE name = 'block_definitions'");
  await db.execute("UPDATE schema_version SET version = 40 WHERE name = 'operation_status_to_blocks'");
  await db.execute("UPDATE schema_version SET version = 41 WHERE name = 'sigils_to_blocks'");
  // Such a vault dates from before v47: `links` still exists (the chain stopped
  // at v46), and v47 and everything after it are pending.
  await runMigrations(db);
  const stamps = Object.fromEntries(
    (await db.select('SELECT name, version FROM schema_version WHERE version >= 39')).map((r) => [r.name, r.version])
  );
  check(
    'old numbering is restamped and v39 is caught up',
    stamps.category_optional === 39 && stamps.block_definitions === 40 &&
      stamps.operation_status_to_blocks === 41 && stamps.sigils_to_blocks === 42,
    JSON.stringify(stamps)
  );
  check('restamped vault: schema identical to the baseline', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  db.close();
}

console.log('\n8i. Migration v43: templates and the sigil template\n');

{
  const sigilTemplate = async (db) => (await db.select("SELECT * FROM templates WHERE id='core-sigil'"));
  for (const [label, db] of [['fresh vault', baseline], ['chain', chain]]) {
    const rows = await sigilTemplate(db);
    const t = rows[0];
    check(
      `${label}: exactly one sigil template, default for operation × sigils`,
      rows.length === 1 &&
        JSON.stringify(JSON.parse(t.assignments)) === JSON.stringify([{ entryType: 'operation', category: 'sigils', isDefault: true }]),
      JSON.stringify(rows)
    );
    check(
      `${label}: with calculator, drawing and charge (harness: English name)`,
      t && t.name === 'Sigil' &&
        ['core.sigil.calc', 'core.sigil.canvas', 'core.sigil.charge'].every((type) => t.content.includes(`data-block="${type}"`)),
      t?.content
    );
  }

  // A second run (created, but not stamped) creates nothing twice.
  const v43 = MIGRATIONS.find((m) => m.version === 43);
  await v43.up(chain);
  check('v43 is repeatable', (await sigilTemplate(chain)).length === 1);

  // Assignments: detect orphans, clean them up when a category is permanently deleted.
  const db = freshDb('templates.db');
  await runMigrations(db);
  await db.execute(
    `INSERT INTO categories (id,name,emoji,sort_order,is_builtin) VALUES ('weg','Weg','x',99,0)`
  );
  await db.execute(
    `INSERT INTO templates (id,name,content,assignments,created_at,updated_at)
     VALUES ('t1','Vorlage','<p><img src="${'d'.repeat(64)}.png"></p>',?1,?2,?2)`,
    [JSON.stringify([
      { entryType: 'wiki', category: 'weg', isDefault: true },
      { entryType: 'wiki', category: '*', isDefault: false },
      { entryType: 'operation', category: 'fehlt', isDefault: false },
    ]), now]
  );
  const orphans = await checkIntegrity(db);
  check(
    'checkIntegrity reports the assignment to a missing category, not "*"',
    orphans.length === 1 && orphans[0].table === 'templates' && orphans[0].missingTarget === 'categories.fehlt',
    JSON.stringify(orphans)
  );
  await reassignCategoryContent(db, 'weg');
  const [t1] = await db.select("SELECT assignments FROM templates WHERE id='t1'");
  check(
    'reassignCategoryContent removes the category from the assignments',
    !t1.assignments.includes('"weg"') && t1.assignments.includes('"*"'),
    t1.assignments
  );
  check(
    'collectUsedImageFilenames knows images in the block stack of a template',
    (await collectUsedImageFilenames(db)).has(`${'d'.repeat(64)}.png`)
  );
  await db.execute(
    `INSERT INTO categories (id,name,emoji,sort_order,is_builtin) VALUES ('bildkat','Bilder','x',99,0)`
  );
  await db.execute(
    `INSERT INTO images (id, file, category_id, created_at, updated_at) VALUES ('im1',$1,'bildkat',$2,$2)`,
    [`${'e'.repeat(64)}.webp`, new Date().toISOString()],
  );
  check(
    'collectUsedImageFilenames keeps an image taken into "Images", used anywhere or not',
    (await collectUsedImageFilenames(db)).has(`${'e'.repeat(64)}.webp`)
  );
  await reassignCategoryContent(db, 'bildkat');
  check(
    'reassignCategoryContent uncategorizes an image too',
    (await db.select("SELECT category_id FROM images WHERE id='im1'"))[0].category_id === null
  );

  // Merging: assignments move along, one star per type and category, active templates first.
  await db.execute(`INSERT INTO categories (id,name,emoji,sort_order,is_builtin) VALUES ('alt','Alt','x',100,0), ('neu','Neu','x',101,0)`);
  const insertTpl = (id, assignments, deletedAt = null) => db.execute(
    `INSERT INTO templates (id,name,content,assignments,created_at,updated_at,deleted_at) VALUES (?1,?1,'',?2,?3,?3,?4)`,
    [id, JSON.stringify(assignments), now, deletedAt]
  );
  await insertTpl('papierkorb', [{ entryType: 'operation', category: 'alt', isDefault: true }], now);
  await insertTpl('m1', [{ entryType: 'wiki', category: 'alt', isDefault: true }, { entryType: 'operation', category: 'alt', isDefault: true }]);
  await insertTpl('m2', [{ entryType: 'wiki', category: 'neu', isDefault: true }]);
  await insertTpl('m3', [{ entryType: 'wiki', category: 'alt', isDefault: false }, { entryType: 'wiki', category: 'neu', isDefault: false }]);
  await reassignCategoryContent(db, 'alt', 'neu');
  const merged = Object.fromEntries((await db.select("SELECT id, assignments FROM templates WHERE id IN ('papierkorb','m1','m2','m3')"))
    .map((r) => [r.id, JSON.parse(r.assignments)]));
  const stars = Object.values(merged).flat().filter((a) => a.category === 'neu' && a.isDefault).map((a) => a.entryType).sort();
  check('merging: no assignment stays on the old category',
    !JSON.stringify(merged).includes('"alt"'), JSON.stringify(merged));
  check('merging: one star per type, the existing one wins, the active template before the one in the trash',
    stars.join() === 'operation,wiki' && merged.m2[0].isDefault && merged.m1.find((a) => a.entryType === 'operation').isDefault
      && !merged.papierkorb[0].isDefault, JSON.stringify(merged));
  check('merging: a template with both categories keeps one assignment',
    merged.m3.length === 1 && merged.m3[0].category === 'neu', JSON.stringify(merged.m3));
  check('merging: no orphans', (await checkIntegrity(db)).filter((o) => o.table === 'templates' && o.missingTarget !== 'categories.fehlt').length === 0);
  db.close();
}

console.log('\n8j. Migration v45: the lexicon\n');

{
  const db = freshDb('lexicon.db');
  await runMigrations(db);
  await db.execute(
    `INSERT INTO languages (id,name,icon,alphabet,sort_order,created_at,updated_at)
     VALUES ('l1','Enochisch','L','[{"from":"th","to":"T"}]',0,?1,?1)`,
    [now]
  );
  for (const [id, term] of [['w1', 'MADRIAX'], ['w2', 'ZIRDO']]) {
    await db.execute(
      `INSERT INTO lexicon_entries (id,language_id,term,translation,pronunciation,note,sort_order,created_at,updated_at)
       VALUES (?1,'l1',?2,'x','','',0,?3,?3)`,
      [id, term, now]
    );
  }

  // The trash puts the language away, its vocabulary stays attached to it.
  await db.execute(`UPDATE languages SET deleted_at=?1 WHERE id='l1'`, [now]);
  check(
    'the vocabulary survives the trash of its language',
    (await db.select('SELECT COUNT(*) AS n FROM lexicon_entries'))[0].n === 2
  );

  // Permanent deletion takes it along — CLEANUP_TABLES,
  // emptyTrash and permanentlyDeleteLanguage rely on that, none of them cleans up itself.
  await db.execute(`DELETE FROM languages WHERE deleted_at IS NOT NULL`);
  check(
    'ON DELETE CASCADE removes the vocabulary along with the language',
    (await db.select('SELECT COUNT(*) AS n FROM lexicon_entries'))[0].n === 0
  );

  // A second run (created, but not stamped) does not abort.
  const v45 = MIGRATIONS.find((m) => m.version === 45);
  await v45.up(db);
  check('v45 is repeatable', true);
  db.close();
}

console.log('\n8k. Migration v46: altars get a trash\n');

{
  const db = freshDb('altar-trash.db');
  await runMigrations(db);
  check(
    'fresh schema: altars has deleted_at',
    (await db.select('PRAGMA table_info(altars)')).some((c) => c.name === 'deleted_at')
  );
  check(
    'fresh schema: the index on deleted_at is there',
    (await db.select("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_altars_deleted'")).length === 1
  );

  await db.execute(
    `INSERT INTO altars (id,title,created_at,updated_at)
     VALUES ('a1','Altar',?1,?1)`,
    [now]
  );
  await db.execute(`INSERT INTO altar_items (id,name,emoji,note,created_at) VALUES ('i1','Kerze','x','',?1)`, [now]);
  await db.execute(
    `INSERT INTO altar_placements (id,altar_id,item_id,x,y) VALUES ('p1','a1','i1',50,50)`
  );

  // The trash puts the altar away, its placements stay for the way back.
  await db.execute(`UPDATE altars SET deleted_at=?1 WHERE id='a1'`, [now]);
  check(
    'the placements survive the trash of their altar',
    (await db.select('SELECT COUNT(*) AS n FROM altar_placements'))[0].n === 1
  );

  // Permanent deletion takes them along — CLEANUP_TABLES and emptyTrash rely on that.
  await db.execute(`DELETE FROM altars WHERE deleted_at IS NOT NULL`);
  check(
    'ON DELETE CASCADE removes the placements along with the altar',
    (await db.select('SELECT COUNT(*) AS n FROM altar_placements'))[0].n === 0
  );
  check(
    'the library item stays',
    (await db.select('SELECT COUNT(*) AS n FROM altar_items'))[0].n === 1
  );

  // A second run (created, but not stamped) does not abort.
  const v46 = MIGRATIONS.find((m) => m.version === 46);
  await v46.up(db);
  check('v46 is repeatable', true);

  // A vault from before v46: the column is missing, the migration adds it.
  await db.execute('DROP INDEX idx_altars_deleted');
  await db.execute('ALTER TABLE altars DROP COLUMN deleted_at');
  await v46.up(db);
  check(
    'v46 adds the column where it is missing',
    (await db.select('PRAGMA table_info(altars)')).some((c) => c.name === 'deleted_at')
  );
  db.close();
}

console.log('\n8l. Migration v47: the links table goes\n');

{
  const db = freshDb('drop-links.db');
  await runMigrations(db);
  const linksObjects = async () =>
    db.select("SELECT name FROM sqlite_master WHERE name='links' OR tbl_name='links'");
  check('fresh schema: no links table, no index on it', (await linksObjects()).length === 0);

  // A vault from before v47: table and indexes present, with rows in it.
  await db.execute(LINKS_BEFORE_V47);
  await db.execute('CREATE INDEX idx_links_source ON links(source_id)');
  await db.execute('CREATE INDEX idx_links_target ON links(target_id)');
  await db.execute(`INSERT INTO links VALUES ('j1','journal','w1','wiki')`);
  const v47 = MIGRATIONS.find((m) => m.version === 47);
  await v47.up(db);
  check('v47 takes the table and indexes along', (await linksObjects()).length === 0);
  await v47.up(db);
  check('v47 is repeatable', true);
  db.close();
}

console.log('\n8m. Migration v48: old English default titles become empty\n');

{
  // v48 runs before v49 and still knows the three entry tables.
  const db = await buildViaChain('untitled.db', undefined, 48);
  const at = new Date().toISOString();
  await db.execute(`INSERT INTO journal_entries (id, title, content, created_at, updated_at) VALUES ('j1','Untitled Entry','',$1,$1), ('j2','Mein Tag','',$1,$1)`, [at]);
  await db.execute(`INSERT INTO wiki_articles (id, title, slug, content, created_at, updated_at) VALUES ('w1',' Untitled Article ','w1','',$1,$1)`, [at]);
  await db.execute(`INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t1','New Task',$1,$1), ('t2','Untitled Entry list',$1,$1)`, [at]);
  await db.execute(`INSERT INTO operations (id, title, content, created_at, updated_at) VALUES ('o1','Untitled Operation','',$1,$1)`, [at]);
  await db.execute(`INSERT INTO altars (id, title, created_at, updated_at) VALUES ('a1','Untitled Altar',$1,$1)`, [at]);
  const v48 = MIGRATIONS.find((m) => m.version === 48);
  await v48.up(db);
  const titles = Object.fromEntries([
    ...(await db.select('SELECT id, title FROM journal_entries')),
    ...(await db.select('SELECT id, title FROM wiki_articles')),
    ...(await db.select('SELECT id, title FROM tasks')),
    ...(await db.select('SELECT id, title FROM operations')),
    ...(await db.select("SELECT id, title FROM altars WHERE id='a1'")),
  ].map((r) => [r.id, r.title]));
  check('v48 clears the old default titles in all five tables, also with whitespace',
    titles.j1 === '' && titles.w1 === '' && titles.t1 === '' && titles.o1 === '' && titles.a1 === '', JSON.stringify(titles));
  check('v48 leaves custom titles alone, even if they start like that',
    titles.j2 === 'Mein Tag' && titles.t2 === 'Untitled Entry list', JSON.stringify(titles));
  await v48.up(db);
  check('v48 is repeatable', true);

  // The import of old backups calls the same against `entries`.
  await runMigrations(db);
  await db.execute(`INSERT INTO entries (id, type, title, content, created_at, updated_at) VALUES ('e9','wiki','Untitled Article','',$1,$1)`, [at]);
  await clearLegacyUntitledTitles(db);
  check('after v49 it clears the default titles in entries',
    (await db.select("SELECT title FROM entries WHERE id='e9'"))[0]?.title === '');
  db.close();
}

console.log('\n8n. Migration v49: three entry tables become entries\n');

{
  const db = await buildViaChain('v49.db', undefined, 48);
  const at = '2026-01-02T03:04:05.000Z';
  await db.execute(
    `INSERT INTO journal_entries (id, title, content, entry_number, moon_phase, paradigm_id, tags, created_at, updated_at)
     VALUES ('j1','Tag','<p>J</p>',7,'full','alt','["a"]',$1,$1), ('dup','Doppelt','<p>Journal</p>',8,NULL,NULL,'[]',$1,$1)`,
    [at]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id, title, slug, content, category_id, entry_number, icon, cover_image, tags, created_at, updated_at, deleted_at)
     VALUES ('w1','Artikel','w1','<p>W</p>','sigils',3,'🌿','bild.png','[]',$1,$1,NULL),
            ('w2','Gelöscht','w2','','sigils',4,NULL,NULL,'[]',$1,$1,$1), -- lang-ok
            ('dup','Doppelt','dup','<p>Wiki</p>',NULL,1,NULL,NULL,'[]',$1,$1,NULL)`,
    [at]
  );
  await db.execute(
    `INSERT INTO operations (id, title, content, category_id, entry_number, intention_text, tags, created_at, updated_at)
     VALUES ('o1','Operation','<p>O</p>',NULL,12,'weg','["b"]',$1,$1)`,
    [at]
  );

  // Reproduce the abort: the journal has already been moved over and its table is gone,
  // wiki and operations are still there.
  await db.execute(TABLE_DDL.entries);
  await db.execute(
    `INSERT INTO entries (id, type, title, content, entry_number, tags, created_at, updated_at)
     SELECT id, 'journal', title, content, entry_number, tags, created_at, updated_at FROM journal_entries`
  );
  await db.execute('DROP TABLE journal_entries');

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('aborted v49 resumes on the next start', resumed, message);

  const rows = Object.fromEntries((await db.select('SELECT * FROM entries')).map((r) => [r.id, r]));
  check('every row is in entries exactly once', Object.keys(rows).length === 5, JSON.stringify(Object.keys(rows)));
  check(
    'type, number, category, icon, cover image and tags stay',
    rows.w1?.type === 'wiki' && rows.w1.entry_number === 3 && rows.w1.category_id === 'sigils' &&
      rows.w1.icon === '🌿' && rows.w1.cover_image === 'bild.png' &&
      rows.o1?.type === 'operation' && rows.o1.entry_number === 12 &&
      (await db.select('SELECT name FROM tags WHERE id=?1', [JSON.parse(rows.o1.tags)[0]]))[0]?.name === 'b' &&
      rows.j1?.type === 'journal' && rows.j1.entry_number === 7 && rows.j1.content === '<p>J</p>',
    JSON.stringify(rows)
  );
  check('the trash stays trash', rows.w2?.deleted_at === at, JSON.stringify(rows.w2));
  check(
    'an ID from two tables arrives once — the first one wins',
    rows.dup?.type === 'journal' && rows.dup.content === '<p>Journal</p>',
    JSON.stringify(rows.dup)
  );
  check(
    'slug, moon_phase and the dead columns are gone',
    !['slug', 'moon_phase', 'paradigm_id', 'intention_text'].some((c) => c in rows.w1),
    JSON.stringify(Object.keys(rows.w1))
  );
  check(
    'v49 created a backup beforehand',
    readdirSync(join(workDir, 'v49')).some((f) => f.includes('.pre-v49'))
  );
  await MIGRATIONS.find((m) => m.version === 49).up(db);
  check('v49 is repeatable', (await db.select('SELECT COUNT(*) n FROM entries'))[0].n === 5);
  // v49 creates its own (frozen) indexes; as after an
  // aborted run, the chain then catches up with v55.
  await MIGRATIONS.find((m) => m.version === 55).up(db);
  check('v49: schema identical to the baseline', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  db.close();
}

{
  // An '11' file carries `entries`; the import splits it by type again.
  const backup = {
    version: '11', type: 'backup', exportedAt: now, filters: {}, images: {},
    data: {
      entries: [
        { id: 'j', type: 'journal', title: 'J' },
        { id: 'w', type: 'wiki', title: 'W' },
        { id: 'o', type: 'operation', title: 'O' },
        { id: 'x', type: 'unbekannt', title: 'X' }, // lang-ok
      ],
    },
  };
  migrateBackupPayload(backup);
  check(
    "import of an '11': entries is split by type, unknown ones are dropped",
    backup.data.journalEntries.length === 1 && backup.data.wikiArticles[0].id === 'w' &&
      backup.data.operations[0].id === 'o' && !('entries' in backup.data),
    JSON.stringify(backup.data)
  );
  let rejected = false;
  try {
    migrateBackupPayload({ ...backup, version: '99', data: {} });
  } catch {
    rejected = true;
  }
  check('a file from a newer version is rejected', rejected);

  // The same entry in two lists of an old file: once, the first one wins.
  const rows = entryRowsForInsert(
    [{ id: 'x', title: 'Journal', category_id: 'sigils', icon: '🌿' }],
    [{ id: 'x', title: 'Wiki' }, { id: 'w', title: 'W', slug: 'w', category_id: 'c' }],
    [{ id: 'o', title: 'O', intention_text: 'alt' }],
  );
  check(
    'import: a duplicate ID arrives once, the journal without category and icon',
    rows.length === 3 && rows[0].type === 'journal' && rows[0].category_id === null && rows[0].icon === null,
    JSON.stringify(rows)
  );
  check(
    'import: every row carries exactly the columns of entries',
    rows.every((r) => !('slug' in r) && !('intention_text' in r) && 'cover_image' in r) && rows[1].category_id === 'c',
    JSON.stringify(rows)
  );
}

{
  // A sigil whose drawing v42 could not save waits in its
  // column — v49 must not throw it away.
  const db = await buildViaChain('v49-sigil.db', undefined, 48);
  await db.execute(
    `INSERT INTO operations (id, title, content, created_at, updated_at, tags, drawing_data)
     VALUES ('s1','Sigille','',$1,$1,'[]','data:image/png;base64,FAIL')`,
    [now]
  );
  let failed = false;
  try {
    await runMigrations(db);
  } catch {
    failed = true;
  }
  check(
    'v49 aborts as long as a drawing cannot be saved',
    failed && (await db.select("SELECT drawing_data d FROM operations WHERE id='s1'"))[0]?.d === 'data:image/png;base64,FAIL'
  );
  await db.execute("UPDATE operations SET drawing_data='data:image/png;base64,CCCC' WHERE id='s1'");
  await runMigrations(db);
  const [s1] = await db.select("SELECT content FROM entries WHERE id='s1'");
  check('on the next attempt it becomes a block and v49 runs through', s1?.content.includes('core.sigil.canvas'), s1?.content);
  db.close();
}

console.log('\n8o. Migration v50: dead columns go\n');

{
  const db = await buildViaChain('v50.db', undefined, 49);
  await db.execute(
    `INSERT INTO tasks (id, title, tags, created_at, updated_at) VALUES ('t1','Aufgabe','["x"]',$1,$1)`, [now]
  );
  await db.execute(
    `INSERT INTO altars (id, title, intention, grid_size, created_at, updated_at) VALUES ('a1','Altar','alt',40,$1,$1)`, [now]
  );
  await db.execute(`INSERT INTO altar_items (id, name, created_at) VALUES ('i1','Kerze',$1)`, [now]);
  await db.execute(`INSERT INTO altar_placements (id, altar_id, item_id) VALUES ('p1','a1','i1')`);
  const v50 = MIGRATIONS.find((m) => m.version === 50);
  await v50.up(db);
  await v50.up(db);
  const cols = async (t) => (await db.select(`PRAGMA table_info(${t})`)).map((c) => c.name);
  check('v50 removes tasks.tags and altars.intention, also on the second run',
    !(await cols('tasks')).includes('tags') && !(await cols('altars')).includes('intention'));
  const [altar] = await db.select("SELECT title, grid_size FROM altars WHERE id='a1'");
  const [placements] = await db.select('SELECT COUNT(*) AS n FROM altar_placements');
  check('rows, remaining columns and placements stay',
    altar?.title === 'Altar' && altar?.grid_size === 40 && placements.n === 1
      && (await db.select("SELECT title FROM tasks WHERE id='t1'"))[0]?.title === 'Aufgabe');
  db.close();
}

console.log('\n8o2. Migration v54: unused descriptions go\n');

{
  const db = await buildViaChain('v54.db', undefined, 53);
  await db.execute(`INSERT INTO tasks (id, title, description, due_date, created_at, updated_at) VALUES ('t1','A','alt','2026-01-01',$1,$1)`, [now]);
  const v54 = MIGRATIONS.find((m) => m.version === 54);
  await v54.up(db);
  await v54.up(db);
  const cols = async (t) => (await db.select(`PRAGMA table_info(${t})`)).map((c) => c.name);
  check('v54 removes the four columns, also on the second run',
    !(await cols('tasks')).some((c) => c === 'description' || c === 'due_date')
      && !(await cols('block_definitions')).includes('description') && !(await cols('templates')).includes('description'));
  check('v54: the task stays', (await db.select("SELECT title FROM tasks WHERE id='t1'"))[0]?.title === 'A');
  db.close();
}

console.log('\n8p. Migration v51: the appearance of an altar becomes JSON\n');

{
  const db = await buildViaChain('v51.db', undefined, 50);
  await db.execute(
    `INSERT INTO altars (id, title, background_preset, background_image_data, grid_enabled, grid_size, grid_color,
       snap_to_grid, rotation_snap_angle, resolution, created_at, updated_at)
     VALUES ('a1','Altar','forest','bg.png',1,48,'#112233',1,30,'4:3',$1,$1), ('a2','Standard','midnight',NULL,0,32,'#dce8e2',0,15,'1920x1080',$1,$1)`,
    [now]
  );
  await db.execute(`INSERT INTO altar_items (id, name, created_at) VALUES ('i1','Kerze',$1)`, [now]);
  await db.execute(`INSERT INTO altar_placements (id, altar_id, item_id) VALUES ('p1','a1','i1')`);
  const v51 = MIGRATIONS.find((m) => m.version === 51);
  await v51.up(db);
  await v51.up(db);
  const cols = (await db.select('PRAGMA table_info(altars)')).map((c) => c.name);
  check('v51: settings is there, the twelve single columns are gone, also on the second run',
    cols.includes('settings') && !cols.includes('grid_size') && !cols.includes('resolution') && !cols.includes('background_preset'),
    cols.join(','));
  const [a1] = await db.select("SELECT settings, background_image_data FROM altars WHERE id='a1'");
  const s1 = JSON.parse(a1.settings);
  check('v51: the values are in settings, the background image stays a column',
    s1.background_preset === 'forest' && s1.grid_enabled === true && s1.grid_size === 48 && s1.grid_color === '#112233'
      && s1.snap_to_grid === true && s1.rotation_snap_angle === 30 && s1.resolution === '4:3' && a1.background_image_data === 'bg.png',
    a1.settings);
  check('v51: the placements stay',
    (await db.select('SELECT COUNT(*) AS n FROM altar_placements'))[0].n === 1);
  db.close();

  // A backup up to format 11 carries the single columns.
  const backup = {
    version: '11',
    data: { altars: [{ id: 'a', title: 'A', grid_size: 64, snap_to_grid: 1, background_overlay: 0.5, resolution: 'kaputt' }] },
  };
  migrateBackupPayload(backup);
  const row = backup.data.altars[0];
  const s = JSON.parse(row.settings);
  check("import of an '11': the single columns become settings, broken values fall back to the default",
    s.grid_size === 64 && s.snap_to_grid === true && s.background_overlay === 0.5 && s.resolution === '1920x1080'
      && !('grid_size' in row) && row.title === 'A',
    JSON.stringify(row));
}

console.log('\n8q. Migration v52: altar items get a trash\n');

{
  const db = await buildViaChain('v52.db', undefined, 51);
  await db.execute(`INSERT INTO altars (id, title, created_at, updated_at) VALUES ('a1','Altar',$1,$1)`, [now]);
  await db.execute(`INSERT INTO altar_items (id, name, created_at) VALUES ('i1','Kerze','2025-01-01T00:00:00.000Z')`);
  await db.execute(`INSERT INTO altar_placements (id, altar_id, item_id) VALUES ('p1','a1','i1')`);
  const v52 = MIGRATIONS.find((m) => m.version === 52);
  await v52.up(db);
  await v52.up(db);
  const [item] = await db.select("SELECT updated_at, deleted_at FROM altar_items WHERE id='i1'");
  check('v52: updated_at = created_at, deleted_at empty, also on the second run',
    item?.updated_at === '2025-01-01T00:00:00.000Z' && item?.deleted_at === null, JSON.stringify(item));
  check('v52: the index on deleted_at is there',
    (await db.select("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_altar_items_deleted'")).length === 1);

  // The trash leaves the placements in place; the expiry takes them along.
  await db.execute("UPDATE altar_items SET deleted_at='2000-01-01T00:00:00.000Z' WHERE id='i1'");
  check('v52: the placement survives the trash of its item',
    (await db.select('SELECT COUNT(*) AS n FROM altar_placements'))[0].n === 1);
  await db.execute("DELETE FROM altar_items WHERE deleted_at IS NOT NULL AND deleted_at < '2001-01-01'");
  check('v52: when permanently deleted, the placement goes along via CASCADE',
    (await db.select('SELECT COUNT(*) AS n FROM altar_placements'))[0].n === 0);
  db.close();

  const backup = { version: '11', data: { altarItems: [{ id: 'i', name: 'I', created_at: '2024-02-02' }] } };
  migrateBackupPayload(backup);
  check("import of an '11': an altar item gets updated_at = created_at",
    backup.data.altarItems[0].updated_at === '2024-02-02');
}

console.log('\n8r. Migration v53: tags by ID\n');

{
  const db = await buildViaChain('v53.db', undefined, 52);
  const at = '2026-01-02T03:04:05.000Z';
  await db.execute(
    `INSERT INTO tags (id, name, color, deleted_at, affected_ids) VALUES
       ('tLive','Ritual','#111111',NULL,'[]'),
       ('tGone','Mond','#222222',$1,'[{"id":"e2","type":"journal"},{"id":"e3","type":"wiki"},{"id":"weg","type":"wiki"}]'),
       ('tTwin','alt','#333333',$1,'[{"id":"e4","type":"journal"}]'),
       ('tTwinLive','ALT','#444444',NULL,'[]')`,
    [at]
  );
  const entry = (id, type, tags, deleted = null) =>
    db.execute(
      `INSERT INTO entries (id, type, title, content, tags, created_at, updated_at, deleted_at) VALUES ($1,$2,'','',$3,$4,$4,$5)`,
      [id, type, JSON.stringify(tags), at, deleted]
    );
  await entry('e1', 'journal', ['ritual', 'Ritual', 'Verwaist']);  // spellings + a name without a tag // lang-ok
  await entry('e2', 'journal', ['Ritual']);                         // lost "Mond" on deletion // lang-ok
  await entry('e3', 'wiki', [], at);                               // in the trash, lost "Mond" // lang-ok
  await entry('e4', 'journal', ['alt']);                            // carries the living namesake "ALT" // lang-ok
  await entry('e5', 'operation', ['Mond'], at);                     // in the trash, kept the name // lang-ok
  await db.execute(
    `INSERT INTO templates (id, name, tags, created_at, updated_at) VALUES ('tp','Vorlage','["verwaist"]',$1,$1)`, [at]
  );

  const v53 = MIGRATIONS.find((m) => m.version === 53);
  await v53.up(db);
  await v53.up(db);
  const tagsOf = async (table, id) => JSON.parse((await db.select(`SELECT tags FROM ${table} WHERE id=?1`, [id]))[0].tags);
  const orphanId = (await db.select("SELECT id FROM tags WHERE name='Verwaist'"))[0]?.id;
  check('v53: affected_ids is gone, also on the second run',
    !(await db.select('PRAGMA table_info(tags)')).some((c) => c.name === 'affected_ids'));
  check('v53: spellings become one ID, a name without a tag gets a new one',
    !!orphanId && JSON.stringify(await tagsOf('entries', 'e1')) === JSON.stringify(['tLive', orphanId])
      && (await db.select("SELECT COUNT(*) AS n FROM tags WHERE lower(name)='verwaist'"))[0].n === 1,
    JSON.stringify(await tagsOf('entries', 'e1')));
  check('v53: the template finds the same new tag', JSON.stringify(await tagsOf('templates', 'tp')) === JSON.stringify([orphanId]));
  check('v53: the tag in the trash is back in the rows that lost it — also in the trash',
    JSON.stringify(await tagsOf('entries', 'e2')) === JSON.stringify(['tLive', 'tGone'])
      && JSON.stringify(await tagsOf('entries', 'e3')) === JSON.stringify(['tGone']));
  check('v53: not where a living one with the same name now exists',
    JSON.stringify(await tagsOf('entries', 'e4')) === JSON.stringify(['tTwinLive']), JSON.stringify(await tagsOf('entries', 'e4')));
  check('v53: a name in the trash becomes the ID of the tag in the trash',
    JSON.stringify(await tagsOf('entries', 'e5')) === JSON.stringify(['tGone']));
  check('v53: checkIntegrity finds no tag orphans',
    !(await checkIntegrity(db)).some((o) => o.column === 'tags'), JSON.stringify(await checkIntegrity(db)));

  // The tag lists of today include `images` (v56), which this vault gets first.
  await MIGRATIONS.find((m) => m.version === 56).up(db);
  await db.execute(
    `INSERT INTO images (id, file, tags, created_at, updated_at) VALUES ('img1',$1,'["tGone","tLive"]',$2,$2)`,
    [`${'c'.repeat(64)}.png`, at],
  );

  // A tag goes for good: first out of every list.
  await stripTagIds(db, ['tGone']);
  check('stripTagIds removes the ID from every list, also in the trash',
    JSON.stringify(await tagsOf('entries', 'e2')) === JSON.stringify(['tLive']) && (await tagsOf('entries', 'e3')).length === 0);
  check('stripTagIds removes it from an image too', JSON.stringify(await tagsOf('images', 'img1')) === JSON.stringify(['tLive']));
  await replaceTagId(db, 'tTwinLive', 'tLive');
  check('replaceTagId replaces without duplicates', JSON.stringify(await tagsOf('entries', 'e4')) === JSON.stringify(['tLive']));
  await db.execute(`UPDATE entries SET tags='["gibtsnicht"]' WHERE id='e5'`);
  check('checkIntegrity reports a tag ID without a tag',
    (await checkIntegrity(db)).some((o) => o.column === 'tags' && o.id === 'e5'));
  db.close();

  // A backup up to format 11 carries names.
  const backup = {
    version: '11',
    data: {
      tags: [
        { id: 'bt1', name: 'Ritual', color: '#111111', deleted_at: null, affected_ids: '[]' },
        { id: 'bt2', name: 'Mond', color: '#222222', deleted_at: at, affected_ids: '[{"id":"bj2","type":"journal"}]' },
      ],
      entries: [
        { id: 'bj1', type: 'journal', title: '', tags: '["ritual","Neu"]' },
        { id: 'bj2', type: 'journal', title: '', tags: '[]' },
      ],
      templates: [{ id: 'btp', name: 'V', tags: '["Ritual"]' }],
      routines: [{ id: 'br', name: 'R', tags: '["Mond"]' }],
    },
  };
  migrateBackupPayload(backup);
  const fresh = backup.data.tags.find((t) => t.name === 'Neu');
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const j = Object.fromEntries(backup.data.journalEntries.map((r) => [r.id, JSON.parse(r.tags)]));
  check("import of an '11': names become IDs, a name without a tag gets one in the file",
    !!fresh && JSON.stringify(j.bj1) === JSON.stringify(['bt1', fresh.id]) && JSON.stringify(j.bj2) === JSON.stringify(['bt2'])
      && backup.data.templates[0].tags === '["bt1"]' && backup.data.routines[0].tags === '["bt2"]'
      && backup.data.tags.every((t) => !('affected_ids' in t)),
    JSON.stringify(backup.data));

  // The tags of a file into a vault that already has some.
  const vault = await buildViaChain('v53-import.db');
  await vault.execute(
    `INSERT INTO tags (id, name, color, deleted_at) VALUES ('same','Gleich','#111111',NULL), ('local','Ritual','#222222',NULL),
       ('trashed','Mond','#333333',$1)`,
    [at]
  );
  await vault.execute(`INSERT INTO entries (id, type, title, content, tags, created_at, updated_at) VALUES ('alt','journal','','','["same","weg"]',$1,$1)`, [at]);
  const remapped = await importTagsAndRemap(vault, {
    tags: [
      { id: 'same', name: 'Anders benannt', color: '#000000' },   // same ID → same tag // lang-ok
      { id: 'fileRitual', name: 'RITUAL', color: '#abcdef' },     // same name → the local one
      { id: 'fileMond', name: 'mond', color: 'url(x)' },          // local in the trash → comes back
      { id: 'fileNeu', name: 'Neu', color: 'kaputt' },            // new, broken colour → one from the palette // lang-ok
      { id: 'bad id!', name: 'Böse' },                            // not a valid ID → dropped // lang-ok
    ],
    journalEntries: [{ id: 'f1', tags: '["same","fileRitual","fileMond","fileNeu","bad id!","abgewählt"]' }], // lang-ok
  });
  check('import: tags by ID, name, trash and new — unknown ones drop out of the row',
    sameList(JSON.parse(remapped.journalEntries[0].tags), ['same', 'local', 'trashed', 'fileNeu']) && remapped.tags.length === 0,
    remapped.journalEntries[0].tags);
  const tagRows = Object.fromEntries((await vault.select('SELECT id, name, color, deleted_at FROM tags')).map((t) => [t.id, t]));
  check('import: the local tag keeps name and colour, the one from the trash lives again, the new one has a valid colour',
    tagRows.same.name === 'Gleich' && tagRows.trashed.deleted_at === null && /^#[0-9a-f]{6}$/i.test(tagRows.fileNeu.color)
      && !tagRows['bad id!'],
    JSON.stringify(tagRows));
  await dropUnknownTagIds(vault);
  check('import: afterwards every tag ID without a tag drops out of the lists',
    (await vault.select("SELECT tags FROM entries WHERE id='alt'"))[0].tags === '["same"]');
  vault.close();
}

/* ------------------------------------------------------------------ *
 * Constants that exist twice — once in TypeScript, once in Rust
 * ------------------------------------------------------------------ */

console.log('\n8s. Migration v55: list index instead of idx_entries_deleted\n');

{
  const db = await buildViaChain('v55.db', undefined, 54);
  const indexNames = async () => (await db.select(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entries' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )).map((r) => r.name).join(',');
  const before = await indexNames();
  check('before v55 idx_entries_deleted exists', before.includes('idx_entries_deleted'), before);
  await runMigrations(db);
  const after = await indexNames();
  check(
    'v55 replaces idx_entries_deleted with idx_entries_list and idx_entries_decorated',
    after === 'idx_entries_category,idx_entries_decorated,idx_entries_list,idx_entries_type',
    after
  );
  await MIGRATIONS.find((m) => m.version === 55).up(db);
  check('v55 is repeatable', (await indexNames()) === after, await indexNames());
  const plan = async (sql) => (await db.select(`EXPLAIN QUERY PLAN ${sql}`)).map((r) => r.detail).join(' | ');
  const list = await plan('SELECT id, type, title, category_id, entry_number, tags, created_at, updated_at, deleted_at FROM entries WHERE deleted_at IS NULL');
  check('the list query reads only the index', list.includes('COVERING INDEX idx_entries_list'), list);
  const decorated = await plan('SELECT id, icon, cover_image FROM entries WHERE deleted_at IS NULL AND (icon IS NOT NULL OR cover_image IS NOT NULL)');
  check('icon and cover image come via the partial index', decorated.includes('idx_entries_decorated'), decorated);
  const chunk = await plan('SELECT rowid AS rid, id, content FROM entries WHERE +deleted_at IS NULL AND rowid > 1 ORDER BY rowid LIMIT 1000');
  check('the content chunks run along the rowid, without sorting', !chunk.includes('TEMP B-TREE'), chunk);
  check('v55: schema identical to the baseline', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  db.close();
}

console.log('\n9. Mirrored constants\n');

{
  const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
  const imagesRs = read('src-tauri/src/images.rs');
  const imagesTs = read('src/lib/images.ts');
  const schemaTs = read('src/lib/schema.ts');
  const vaultRs = read('src-tauri/src/vault.rs');
  const vaultManagerTs = read('src/lib/vaultManager.ts');
  const tauriConf = read('src-tauri/tauri.conf.json');

  // Deliberately literal comparisons instead of parsed values: whoever changes one of these
  // constants should fail here and be forced to update the other
  // side too. A comment "Mirrors X in Y" does not achieve that.

  // The file name of a stored image is the boundary between the
  // URI scheme and the file system. If the checks drift apart,
  // one side accepts something the other rejects.
  check(
    'image extensions: images.rs knows the same six as schema.ts',
    imagesRs.includes('["png", "jpg", "jpeg", "gif", "webp", "svg"]') &&
      schemaTs.includes('(?:png|jpe?g|gif|webp|svg)')
  );
  check(
    'hash length in the file name is 64 on both sides',
    imagesRs.includes('stem.len() == 64') && schemaTs.includes('[0-9a-f]{64}')
  );

  // The database name builds the connection string on one side, the
  // guard in delete_vault_files on the other.
  // TypeScript writes the name of the migration backup, Rust cleans up by
  // it. If the two drift apart, everything is left lying around — or Rust
  // recognises files that are not backups.
  const dbRebuildTs = read('src/lib/dbRebuild.ts');
  check(
    'migration backup: dbRebuild.ts writes what vault.rs cleans up (emerald.db.pre-vNN.bak)',
    dbRebuildTs.includes('`${await getActiveDbFile()}.pre-${tag}.bak`') &&
      vaultRs.includes('.strip_prefix(".pre-v")?') && vaultRs.includes('.strip_suffix(".bak")?') &&
      vaultManagerTs.includes("const DB_FILE = 'emerald.db'")
  );
  check(
    'DB_FILE matches in vault.rs and vaultManager.ts',
    vaultRs.includes('pub const DB_FILE: &str = "emerald.db"') &&
      vaultManagerTs.includes("const DB_FILE = 'emerald.db'")
  );
  check(
    'the image folder is called images (Rust is the only source)',
    vaultRs.includes('pub const IMAGES_SUBDIR: &str = "images"')
  );

  // The scheme appears in three places: handler, URL construction and CSP. If one of the
  // two URL forms is missing in the CSP, exactly one platform breaks — and only
  // in the build for it.
  check(
    'emerald-img: handler and URL construction name the same scheme',
    imagesRs.includes('"emerald-img"') &&
      imagesTs.includes('emerald-img://localhost/') &&
      imagesTs.includes('http://emerald-img.localhost/')
  );
  check(
    'img-src allows both URL forms of the scheme',
    tauriConf.includes('emerald-img:') && tauriConf.includes('http://emerald-img.localhost')
  );
}

/* ------------------------------------------------------------------ */

baseline.close();
chain.close();
seeded.close();

console.log('');

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error(`\nWorking directory for inspection: ${workDir}\n`);
  process.exit(1);
}

rmSync(workDir, { recursive: true, force: true });
console.log('All checks passed.\n');
