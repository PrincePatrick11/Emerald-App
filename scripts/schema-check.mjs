/**
 * Checks the schema of a fresh vault, and that everything from before the
 * fresh start of the schema is refused without being touched.
 *
 * `schema.ts` is the only record of the schema: `db.ts` creates fresh vaults
 * straight from it, and the old migration chain is gone. What is left to
 * prove is that the fresh vault is what the app and its import expect —
 * foreign keys, the checks no constraint can do, the seeds, the indexes the
 * lists rely on, the readers of the block rows, a backup's round trip — and
 * that a vault, a backup or a file from an older version comes back as a
 * refusal, byte for byte as it was.
 *
 * Runs against `node:sqlite` instead of the app, so the run takes seconds
 * and needs no Tauri environment.
 *
 *   npm run check:schema
 */
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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
      // vaultManager reads vaults.json: none here, a first start.
      if (cmd === 'read_file') throw new Error('ENOENT (Harness)');
      if (cmd === 'save_image') {
        // The backup checks give every picture a name of its own (section 11).
        if (globalThis.harnessSaveImage) return globalThis.harnessSaveImage(String(args?.dataUrl ?? ''));
        return '${'c'.repeat(64)}.png';
      }
      // Icons the same way, in a folder of their own (section 11 lists them).
      if (cmd === 'save_icon') {
        if (globalThis.harnessSaveImage) return globalThis.harnessSaveImage(String(args?.dataUrl ?? ''));
        return '${'f'.repeat(64)}.png';
      }
      // The backup import asks which pictures the vault has: none here.
      if (cmd === 'list_image_files') return [];
      // The icons the backup export may embed: those a check puts here.
      if (cmd === 'list_icon_files') return (globalThis.harnessIconFiles ?? []).map((name) => ({ name, bytes: 1 }));
      // A backup embeds its pictures; the harness has no files, so the name stands in for the bytes.
      // An icon is no file of images/, as in the vault.
      if (cmd === 'read_image_as_base64' && (globalThis.harnessIconFiles ?? []).includes(args?.filename)) throw new Error('file not found');
      if (cmd === 'read_image_as_base64' || cmd === 'read_icon_as_base64') return 'data:image/png;base64,' + Buffer.from(String(args?.filename ?? '')).toString('base64');
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

const root = process.cwd().replace(/\\/g, '/');
const entry = join(workDir, 'entry.ts');
writeFileSync(
  entry,
  `export { runMigrations, VAULT_OUTDATED, VAULT_TOO_NEW, sweepDanglingTaskLinks } from '${root}/src/lib/db';
   export { TABLES, TABLE_DDL, BASELINE_VERSION, FRESH_START_VERSION, checkIntegrity, reassignCategoryContent, collectUsedImageFilenames, collectUsedIconFilenames, replaceTagsInDashboards } from '${root}/src/lib/schema';
   export { readTagLinks, replaceTagId, tagStatements } from '${root}/src/lib/tagRefs';
   export { assertPayloadReferencesResolve, collectVaultContent, definitionRows, doMerge, doReplace, FULL_BACKUP_OPTIONS, insertBlockDefinitions, prepareRawDatabase, resolveImportedCategories, vaultContentOf, vaultManifestOf } from '${root}/src/lib/dbBackup';
   export { categoryRowsOf, contentToBlocks, manifestCategoryOf, parseManifest, parseVaultManifest, usedDefinitionIds, EMERALD_FORMAT_VERSION } from '${root}/src/lib/emerald/manifest';
   export { invalidateVaultCache } from '${root}/src/lib/vaultManager';
   export { clearSavedBlocks, readContents, replaceOwnerBlocks, retagBlocks, dropBlockTagStatements, placeholders } from '${root}/src/lib/blockStore';
   export { BUILTIN_TEMPLATE_IDS } from '${root}/src/lib/blocks/templates';
   export { parseBlocks } from '${root}/src/lib/blocks/blockHtml';
   export { parseFields } from '${root}/src/lib/blocks/fields';
   export { registerBlockType } from '${root}/src/lib/blocks/blockTypes';
   export { collectImageUses } from '${root}/src/lib/imageUsage';
   export { imageDetailsOf, importImageDetails } from '${root}/src/lib/emerald/imageDetails';`
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
  runMigrations, VAULT_OUTDATED, VAULT_TOO_NEW, sweepDanglingTaskLinks,
  TABLES, BASELINE_VERSION, FRESH_START_VERSION, checkIntegrity, reassignCategoryContent, collectUsedImageFilenames,
  collectUsedIconFilenames, replaceTagsInDashboards, readTagLinks, replaceTagId, tagStatements,
  assertPayloadReferencesResolve, collectVaultContent, definitionRows, doMerge, doReplace, insertBlockDefinitions,
  resolveImportedCategories, vaultContentOf, vaultManifestOf, FULL_BACKUP_OPTIONS, prepareRawDatabase,
  categoryRowsOf, contentToBlocks, manifestCategoryOf, parseManifest, parseVaultManifest, usedDefinitionIds, EMERALD_FORMAT_VERSION,
  invalidateVaultCache, clearSavedBlocks, readContents, replaceOwnerBlocks, retagBlocks, dropBlockTagStatements, placeholders, BUILTIN_TEMPLATE_IDS, parseBlocks, parseFields, registerBlockType, collectImageUses,
  imageDetailsOf, importImageDetails,
} = await import(pathToFileURL(bundlePath).href);

const now = new Date().toISOString();

/** A row of entries or templates, with its block stack as block rows — what the stores write. */
async function insertWithStack(db, table, row, content) {
  const columns = Object.keys(row);
  await db.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    columns.map((c) => row[c]),
  );
  const plan = replaceOwnerBlocks({ kind: table === 'entries' ? 'entry' : 'template', id: row.id }, content, row.updated_at ?? now, { hasRows: false });
  for (const [query, values] of plan.statements) await db.execute(query, values ?? []);
  plan.commit();
}

/** An owner's block stack as the rows give it. */
async function stackOf(db, kind, id) {
  return (await readContents(db, kind, [id])).get(id) ?? '';
}

/* ------------------------------------------------------------------ *
 * Read out the schema
 * ------------------------------------------------------------------ */

/** Whitespace and quoting are no difference between two schemas. */
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
  ).filter((i) => TABLES.includes(i.tbl_name)).map((i) => ({ name: i.name, table: i.tbl_name, sql: normalizeSql(i.sql) }));
  return out;
}

/** A database of its own in a directory of its own. */
function freshDb(name) {
  const dir = join(workDir, name.replace(/\.db$/, ''));
  mkdirSync(dir, { recursive: true });
  process.env.EMERALD_HARNESS_DIR = dir;
  invalidateVaultCache();
  return new HarnessDb(join(dir, name));
}

/** A fresh vault, as `getDb()` makes it. */
async function freshVault(name) {
  const db = freshDb(name);
  await runMigrations(db);
  return db;
}

/** Whether `fn` throws an error whose message holds `code`. */
async function throwsCode(fn, code) {
  try {
    await fn();
    return false;
  } catch (err) {
    return String(err?.message ?? err).includes(code);
  }
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

console.log('\n1. The fresh vault\n');

const baseline = await freshVault('baseline.db');
const schemaA = await readSchema(baseline);
{
  const tables = (await baseline.select("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"))
    .map((t) => t.name);
  check('exactly the tables of schema.ts', JSON.stringify(tables) === JSON.stringify([...TABLES].sort()), tables.join(', '));
  check('every table has the DDL of schema.ts', TABLES.every((t) => schemaA[t].sql.startsWith(`CREATE TABLE ${t}(`)));
  const stamps = await baseline.select('SELECT version, name FROM schema_version');
  check(`stamped once, at BASELINE_VERSION (${BASELINE_VERSION})`,
    stamps.length === 1 && stamps[0].version === BASELINE_VERSION && stamps[0].name === 'baseline', JSON.stringify(stamps));
  check('the fresh start is above every version of the old chain (v1–v66)', FRESH_START_VERSION > 66 && BASELINE_VERSION >= FRESH_START_VERSION);
  await runMigrations(baseline);
  check('opening it again changes nothing', JSON.stringify(await readSchema(baseline)) === JSON.stringify(schemaA)
    && (await baseline.select('SELECT COUNT(*) AS n FROM schema_version'))[0].n === 1);
  const violations = await baseline.select('PRAGMA foreign_key_check');
  check('foreign_key_check empty', violations.length === 0, JSON.stringify(violations));
}

console.log('\n2. Vaults from another version are refused and stay as they were\n');

{
  /** A vault file as an older version left it, closed, and its bytes. */
  const prepare = async (name, sql) => {
    const db = freshDb(name);
    db.raw.exec(sql);
    db.close();
    return join(workDir, name.replace(/\.db$/, ''), name);
  };
  const refuses = async (path, code) => {
    const before = readFileSync(path);
    const db = new HarnessDb(path);
    const refused = await throwsCode(() => runMigrations(db), code);
    db.close();
    return refused && Buffer.compare(before, readFileSync(path)) === 0;
  };
  const v66 = await prepare('old-v66.db', `
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_version VALUES (66, 'drop_content_columns', '2026-10-01');
    CREATE TABLE entries (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO entries VALUES ('e1', 'Alt');`); // lang-ok
  check('a vault of the old chain (v66) is refused as outdated, byte for byte unchanged', await refuses(v66, VAULT_OUTDATED));
  const unversioned = await prepare('old-unversioned.db', 'CREATE TABLE journal_entries (id TEXT PRIMARY KEY);');
  check('tables without schema_version: outdated, unchanged', await refuses(unversioned, VAULT_OUTDATED));
  const emptyVersion = await prepare('old-empty-version.db', `
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY);`);
  check('an empty version table next to old tables: outdated, unchanged', await refuses(emptyVersion, VAULT_OUTDATED));
  const withContent = await prepare('old-unstamped-content.db', `
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE entries (id TEXT PRIMARY KEY);
    INSERT INTO entries VALUES ('e1');`);
  check('tables of today without a stamp but with entries: outdated, unchanged', await refuses(withContent, VAULT_OUTDATED));

  // A new vault whose creation was cut short before the stamp: created again on the next open.
  {
    const db = freshDb('unfinished.db');
    for (const table of ['schema_version', 'tags', 'templates', 'categories']) db.raw.exec(schemaA[table].sql.replace(/^CREATE TABLE (\w+)\(/, 'CREATE TABLE $1 ('));
    db.raw.exec("INSERT INTO categories (id, name) VALUES ('half', 'Half')");
    await runMigrations(db);
    check('a new vault cut short before its stamp is created again, complete',
      JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA)
        && (await db.select("SELECT COUNT(*) AS n FROM categories WHERE id = 'half'"))[0].n === 0
        && (await db.select('SELECT version FROM schema_version'))[0]?.version === BASELINE_VERSION);
    db.close();
  }
  const newer = await prepare('newer.db', `
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_version VALUES (${BASELINE_VERSION + 1}, 'future', '2030-01-01');`);
  check('a vault of a newer version is refused as too new, unchanged', await refuses(newer, VAULT_TOO_NEW));
  // The first fresh schema still told entries apart by a type; it was never released.
  const firstFresh = await prepare('first-fresh.db', `
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_version VALUES (100, 'baseline', '2026-11-01');
    CREATE TABLE entries (id TEXT PRIMARY KEY, type TEXT NOT NULL);`);
  check('a vault of the first fresh schema (v100, entries with a type) is refused as outdated, unchanged', await refuses(firstFresh, VAULT_OUTDATED));
  // v101 kept tags as JSON and icons as data URLs in the rows; it was never released either.
  const jsonTags = await prepare('json-tags.db', `
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_version VALUES (101, 'baseline', '2026-11-14');
    CREATE TABLE entries (id TEXT PRIMARY KEY, tags TEXT NOT NULL DEFAULT '[]');`);
  check('a vault of v101 (tags as JSON) is refused as outdated, unchanged', await refuses(jsonTags, VAULT_OUTDATED));

  // The mechanism for the steps to come: a vault at the baseline runs a
  // step above it once, stamps it, and keeps the schema otherwise.
  const db = await freshVault('future-step.db');
  let ran = 0;
  const step = { version: BASELINE_VERSION + 1, name: 'harness_step', up: async (d) => { ran++; await d.execute('CREATE TABLE harness_step (id TEXT)'); } };
  await runMigrations(db, [step], step.version);
  await runMigrations(db, [step], step.version);
  const stamped = (await db.select('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version).join();
  check('a migration step above the fresh start runs once and is stamped',
    ran === 1 && stamped === `${BASELINE_VERSION},${step.version}`, `${ran} / ${stamped}`);
  check('the runner refuses steps that do not end at the baseline',
    await throwsCode(() => runMigrations(db, [step]), 'BASELINE_VERSION'));
  db.close();
}

console.log('\n2b. v102 to v103: block_refs takes the tags a block gives its entry\n');

{
  // A vault as v102 left it: block_refs with the narrower CHECKs, one row in it.
  const db = await freshVault('v102.db');
  db.raw.exec(`
    DROP TABLE block_refs;
    CREATE TABLE block_refs (
      block_row INTEGER NOT NULL REFERENCES blocks(row_id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('entry', 'image', 'icon')),
      target TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('content', 'render', 'layer', 'background', 'default', 'icon')),
      PRIMARY KEY (block_row, target_kind, target, role)
    );
    CREATE INDEX idx_block_refs_target ON block_refs(target_kind, target);
    DELETE FROM schema_version;
    INSERT INTO schema_version VALUES (102, 'baseline', '2026-11-20');
    INSERT INTO entries (id, title, created_at, updated_at) VALUES ('e1', 'Eins', '${now}', '${now}');
    INSERT INTO blocks (id, entry_id, position, type, updated_at) VALUES ('b1', 'e1', 'a0', 'core.text', '${now}');
    INSERT INTO block_refs SELECT row_id, 'entry', 'e2', 'content' FROM blocks WHERE id = 'b1';`); // lang-ok
  await runMigrations(db);
  check('the migrated vault has the schema of a fresh one', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  const kept = await db.select('SELECT target_kind, target, role FROM block_refs');
  check('its references stay', JSON.stringify(kept) === JSON.stringify([{ target_kind: 'entry', target: 'e2', role: 'content' }]), JSON.stringify(kept));
  await db.execute("INSERT INTO block_refs SELECT row_id, 'tag', 't1', 'tag' FROM blocks WHERE id = 'b1'");
  check('a tag can be referenced now', (await db.select("SELECT COUNT(*) AS n FROM block_refs WHERE target_kind = 'tag'"))[0].n === 1);
  const stamps = (await db.select('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version).join();
  check('stamped with the step', stamps === `102,${BASELINE_VERSION}`, stamps);
  const violations = await db.select('PRAGMA foreign_key_check');
  check('foreign_key_check empty after the step', violations.length === 0, JSON.stringify(violations));
  db.close();
}

console.log('\n3. checkIntegrity finds what foreign keys do not cover\n');

{
  // The polymorphic tables and the JSON arrays cannot be secured by a
  // constraint. checkIntegrity is the replacement — this test makes
  // sure that it actually triggers and does not merely return empty.
  const db = freshDb('integrity.db');
  await runMigrations(db);
  await db.execute(
    `INSERT INTO entries (id,title,created_at,updated_at)
     VALUES ('e1','Artikel',$1,$1)`,
    [now]
  );
  await db.execute(`INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('t1','Aufgabe',$1,$1)`, [now]);
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type)
     VALUES ('tl1','t1','fehlt','entry'), ('tl2','t1','e1','task'), ('tl3','t1','e1','entry')`
  );

  const found = await checkIntegrity(db);
  const hit = (id, type) => found.some((o) => o.table === 'task_links' && o.id === id && o.missingTarget === type);

  check('orphan in task_links detected', hit('fehlt', 'entry'));
  check('a link with the wrong kind counts as an orphan', hit('e1', 'task'));
  check('the correct link to the same entry does not', !hit('e1', 'entry'), JSON.stringify(found));
  let badKind = false;
  try {
    await db.execute("INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl4','t1','e1','note')");
  } catch {
    badKind = true;
  }
  check('a link target kind other than entry/task is refused by the CHECK', badKind);
  await sweepDanglingTaskLinks(db);
  const kept = (await db.select('SELECT id FROM task_links ORDER BY id')).map((r) => r.id);
  check('the sweep removes the same links that checkIntegrity reports', JSON.stringify(kept) === '["tl3"]', JSON.stringify(kept));
  check(
    'PRAGMA foreign_key_check sees none of this',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  // A dashboard filtering by a tag that is gone points nowhere.
  await db.execute("INSERT INTO tags (id,name) VALUES ('tg1','Da')");
  await db.execute(
    `INSERT INTO dashboards (id,name,filter,created_at,updated_at) VALUES ('dt','T',$1,$2,$2)`,
    [JSON.stringify({ tags: ['tg1', 'weg'] }), now],
  );
  check('checkIntegrity reports a dashboard filtering by a missing tag',
    (await checkIntegrity(db)).some((o) => o.table === 'dashboards' && o.missingTarget === 'tags.weg'));
  await replaceTagsInDashboards(db, ['weg']);
  check('replaceTagsInDashboards drops a tag that is gone from the filters',
    JSON.parse((await db.select("SELECT filter FROM dashboards WHERE id='dt'"))[0].filter).tags.join() === 'tg1');
  db.close();
}

console.log('\n3b. Tags are links with foreign keys\n');

{
  const db = await freshVault('tag-links.db');
  await db.execute("INSERT INTO tags (id,name) VALUES ('ta','A'), ('tb','B'), ('tc','C')");
  await db.execute("INSERT INTO entries (id,title,created_at,updated_at) VALUES ('e1','Eins',$1,$1), ('e2','Zwei',$1,$1)", [now]); // lang-ok
  await db.execute("INSERT INTO images (id,file,created_at,updated_at) VALUES ('im','" + 'a'.repeat(64) + ".png',$1,$1)", [now]);
  await db.batch([
    ...tagStatements('entry', 'e1', ['tc', 'ta', 'missing']),
    ...tagStatements('entry', 'e2', ['ta', 'tb']),
    ...tagStatements('image', 'im', ['tb']),
    ...tagStatements('template', 'core-sigil', ['ta']),
  ]);
  const tags = async (owner, id) => ((await readTagLinks(db, owner, [id])).get(id) ?? []).join();
  check('the tags keep the order they were given in; an unknown ID is skipped', (await tags('entry', 'e1')) === 'tc,ta', await tags('entry', 'e1'));
  let refusedLink = false;
  try { await db.execute("INSERT INTO entry_tags (entry_id, tag_id) VALUES ('e1','nope')"); } catch { refusedLink = true; }
  check('a link to a tag that does not exist is refused (foreign key)', refusedLink);
  await replaceTagId(db, 'ta', 'tb');
  check('merging tags: the links move over, an owner carrying both keeps one',
    (await tags('entry', 'e1')) === 'tc,tb' && (await tags('entry', 'e2')) === 'tb' && (await tags('template', 'core-sigil')) === 'tb',
    [await tags('entry', 'e1'), await tags('entry', 'e2')]);
  await db.execute("DELETE FROM tags WHERE id='tb'");
  check('deleting a tag for good takes its links with it (CASCADE)',
    (await tags('entry', 'e1')) === 'tc' && (await tags('entry', 'e2')) === '' && (await tags('image', 'im')) === '');
  await db.execute("DELETE FROM entries WHERE id='e1'");
  check('deleting an entry for good takes its links with it (CASCADE)',
    (await db.select("SELECT COUNT(*) AS n FROM entry_tags WHERE entry_id='e1'"))[0].n === 0);
  check('tag links: no orphans, foreign keys hold', (await checkIntegrity(db)).length === 0 && (await db.select('PRAGMA foreign_key_check')).length === 0);
  db.close();
}

console.log('\n4. Deleting a category loses no entries\n');

{
  const db = baseline;
  await db.execute(
    `INSERT INTO categories (id,name,emoji,sort_order,is_builtin)
     VALUES ('temporaer','Temporär','🧪',99,0)` // lang-ok
  );
  await db.execute(
    `INSERT INTO entries (id,title,category_id,created_at,updated_at)
     VALUES ('a1','Wichtiger Artikel','temporaer',$1,$1)`,
    [now]
  );
  // The same category also holds content of the other modules.
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
  // There is no catch-all: the content becomes categoryless.
  check('article is now without a category', article?.category_id === null);
  check('article content unchanged', article?.title === 'Wichtiger Artikel');
}

console.log('\n5. Backup with entries without a category\n');

{
  // The pre-check of the backup import must not read `category_id = NULL` as
  // an unresolvable reference: every new entry starts that way.
  const db = freshDb('nullcat.db');
  await runMigrations(db);

  const payload = {
    categories: [{ id: 'sigils', name: 'Sigils' }],
    entries: [{ id: 'a', title: 'Ohne', category_id: null }, { id: 'o', title: 'Ohne', category_id: null }], // lang-ok
    tasks: [{ id: 't', title: 'Ohne', category_id: null }], // lang-ok
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
    await assertPayloadReferencesResolve(db, { entries: [{ id: 'b', category_id: '' }] });
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

console.log('\n7. Seeds: built-in categories, starter set, built-in templates and dashboards\n');

{
  const cats = await baseline.select('SELECT id, name, is_builtin, sort_order FROM categories ORDER BY sort_order');
  check(
    'three builtins, "journal", "sigils" and "altars", and no "other"',
    cats.filter((c) => c.is_builtin === 1).map((c) => c.id).join() === 'journal,sigils,altars' &&
      cats[0].id === 'journal' && !cats.some((c) => c.id === 'other'),
    JSON.stringify(cats)
  );
  check(
    'exactly the seven start categories, the starter set as normal categories, translated (harness: en)',
    cats.map((c) => c.id).join() === 'journal,dreams,sigils,altars,ritual,deities,crystals'
      && JSON.stringify(cats.filter((c) => c.is_builtin === 0).map((c) => c.name)) === JSON.stringify(['Dream Journal', 'Ritual', 'Deities', 'Crystals']),
    JSON.stringify(cats)
  );
  check(
    'the dream journal comes right after the journal, ahead of sigils and altars',
    cats.slice(0, 4).map((c) => c.id).join() === 'journal,dreams,sigils,altars',
    JSON.stringify(cats)
  );
  const [t] = await baseline.select("SELECT * FROM templates WHERE id='core-sigil'");
  const content = await stackOf(baseline, 'template', 'core-sigil');
  const starts = Object.fromEntries((await baseline.select('SELECT id, template_id FROM categories')).map((c) => [c.id, c.template_id]));
  check(
    'exactly one sigil template, the start template of "sigils"',
    !!t && starts.sigils === 'core-sigil',
    JSON.stringify(starts)
  );
  check(
    'with a sigil block, then a text for notes (harness: English name)',
    t?.name === 'Sigil' && [...content.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1]).join() === 'core.sigil,core.text',
    content
  );
  check('the altar template, the start template of "altars"',
    starts.altars === 'core-altar', JSON.stringify(starts));
  check('every start category starts with its own built-in template',
    Object.keys(starts).length === 7 && Object.entries({
      journal: 'core-journal', dreams: 'core-dreams', sigils: 'core-sigil', altars: 'core-altar',
      ritual: 'core-ritual', deities: 'core-deities', crystals: 'core-crystals',
    }).every(([id, tpl]) => starts[id] === tpl), JSON.stringify(starts));
  check('the built-in templates are exactly BUILTIN_TEMPLATE_IDS',
    (await baseline.select('SELECT id FROM templates ORDER BY id')).map((r) => r.id).join() === [...BUILTIN_TEMPLATE_IDS].sort().join());
  // What each built-in template starts with: its blocks in order, and the named fields of its field block (harness: English).
  const builtinStacks = {
    'core-journal': ['Journal', 'core.moon,core.text', []],
    'core-dreams': ['Dream Journal', 'core.moon,core.fields', [['text', 'Dream'], ['shorttext', 'Feeling/Mood'], ['text', 'Interpretation']]],
    'core-ritual': ['Ritual', 'core.moon,core.fields', [['shorttext', 'Intention'], ['checklist', 'Materials'], ['text', 'Procedure'], ['text', 'Outcome']]],
    'core-deities': ['Deity', 'core.fields,core.text', [['image', 'Image'], ['shorttext', 'Pantheon/Tradition'], ['shorttext', 'Domains'], ['shorttext', 'Symbols and offerings']]],
    'core-crystals': ['Crystal', 'core.fields,core.text', [['image', 'Image'], ['shorttext', 'Colour'], ['shorttext', 'Effect'], ['shorttext', 'Element/Chakra']]],
  };
  for (const [id, [name, types, fields]] of Object.entries(builtinStacks)) {
    const [row] = await baseline.select('SELECT name FROM templates WHERE id=$1', [id]);
    const blocks = parseBlocks(await stackOf(baseline, 'template', id));
    const named = blocks.filter((b) => b.type === 'core.fields').flatMap((b) => parseFields(b).elements.map((e) => [e.kind, e.label]));
    check(`${id}: ${types} (harness: English names)`,
      row?.name === name && blocks.map((b) => b.type).join() === types && JSON.stringify(named) === JSON.stringify(fields),
      JSON.stringify({ name: row?.name, types: blocks.map((b) => b.type), named }));
  }
  const dashboards = await baseline.select('SELECT id, builtin, position, filter, sort FROM dashboards ORDER BY position');
  const filterOf = (id) => JSON.parse(dashboards.find((d) => d.id === id)?.filter ?? 'null');
  check('four built-in dashboards, "all" first, each with its key as ID',
    dashboards.map((d) => d.id).join() === 'all,journal,practice,knowledge' && dashboards.every((d) => d.builtin === d.id), JSON.stringify(dashboards));
  check('"all" has no filter; journal, practice and knowledge filter by their starter categories',
    JSON.stringify(filterOf('all')) === '{}'
      && JSON.stringify(filterOf('journal')) === JSON.stringify({ categories: ['journal', 'dreams'] })
      && JSON.stringify(filterOf('practice')) === JSON.stringify({ categories: ['sigils', 'altars', 'ritual'] })
      && JSON.stringify(filterOf('knowledge')) === JSON.stringify({ categories: ['deities', 'crystals'] }),
    JSON.stringify(dashboards));
  check('every category of a dashboard exists', (await checkIntegrity(baseline)).filter((o) => o.table === 'dashboards').length === 0);
}

console.log('\n8. Templates and the lexicon\n');

{
  // Dashboard filters: detect orphans, clean them up when a category is permanently deleted.
  const db = await freshVault('templates.db');
  await db.execute(
    `INSERT INTO categories (id,name,emoji,sort_order,is_builtin) VALUES ('weg','Weg','x',99,0)`
  );
  await db.execute(
    `INSERT INTO dashboards (id,name,filter,created_at,updated_at) VALUES ('d1','Eigen',$1,$2,$2)`, // lang-ok
    [JSON.stringify({ categories: ['weg', 'crystals', 'fehlt'] }), now],
  );
  await insertWithStack(db, 'templates', { id: 't1', name: 'Vorlage', created_at: now, updated_at: now }, `<p><img src="${'d'.repeat(64)}.png"></p>`);
  const orphans = await checkIntegrity(db);
  check(
    'checkIntegrity reports a dashboard filtering by a missing category',
    orphans.length === 1 && orphans[0].table === 'dashboards' && orphans[0].missingTarget === 'categories.fehlt',
    JSON.stringify(orphans)
  );
  await reassignCategoryContent(db, 'weg');
  const [d1] = await db.select("SELECT filter FROM dashboards WHERE id='d1'");
  check(
    'reassignCategoryContent removes the category from the dashboards\' filters',
    !d1.filter.includes('"weg"') && d1.filter.includes('"crystals"'),
    d1.filter
  );
  // A category's start template: deleting the template for good leaves the category without one.
  await db.execute("UPDATE categories SET template_id='t1' WHERE id='crystals'");
  await db.execute("DELETE FROM templates WHERE id='t1'");
  check('deleting a start template for good clears it on its category (ON DELETE SET NULL)',
    (await db.select("SELECT template_id FROM categories WHERE id='crystals'"))[0].template_id === null);
  await insertWithStack(db, 'templates', { id: 't1', name: 'Vorlage', created_at: now, updated_at: now }, `<p><img src="${'d'.repeat(64)}.png"></p>`);
  check(
    'collectUsedImageFilenames knows images in the block stack of a template',
    (await collectUsedImageFilenames(db)).has(`${'d'.repeat(64)}.png`)
  );
  await db.execute(
    `INSERT INTO images (id, file, created_at, updated_at) VALUES ('im1',$1,$2,$2)`,
    [`${'e'.repeat(64)}.webp`, new Date().toISOString()],
  );
  check(
    'collectUsedImageFilenames keeps a picture of "Images", used anywhere or not',
    (await collectUsedImageFilenames(db)).has(`${'e'.repeat(64)}.webp`)
  );

  // Merging: the dashboards name the surviving category, once.
  await db.execute(`INSERT INTO categories (id,name,emoji,sort_order,is_builtin) VALUES ('alt','Alt','x',100,0), ('neu','Neu','x',101,0)`);
  await db.execute(
    `INSERT INTO dashboards (id,name,filter,created_at,updated_at) VALUES ('d2','A',$1,$3,$3), ('d3','B',$2,$3,$3)`,
    [JSON.stringify({ categories: ['alt'] }), JSON.stringify({ categories: ['alt', 'neu'] }), now],
  );
  await reassignCategoryContent(db, 'alt', 'neu');
  const merged = Object.fromEntries((await db.select("SELECT id, filter FROM dashboards WHERE id IN ('d2','d3')"))
    .map((r) => [r.id, JSON.parse(r.filter).categories]));
  check('merging: a dashboard of the old category shows the surviving one',
    JSON.stringify(merged.d2) === '["neu"]', JSON.stringify(merged));
  check('merging: a dashboard with both categories names the survivor once',
    JSON.stringify(merged.d3) === '["neu"]', JSON.stringify(merged));
  check('merging: no orphans', (await checkIntegrity(db)).filter((o) => o.missingTarget !== 'categories.fehlt').length === 0);
  db.close();
}
{
  const db = await freshVault('lexicon.db');
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

  db.close();
}

console.log('\n9. Block rows\n');

{
  const db = await freshVault('blocks.db');
  const [seeded] = await db.select("SELECT COUNT(*) AS n FROM blocks WHERE template_id IN ('core-sigil', 'core-altar')");
  check('the seeded templates have their block rows', seeded.n >= 3, JSON.stringify(seeded));

  const linked = '44444444-4444-4444-4444-444444444444';
  const chip = `<span data-type="internalLink" class="internal-link" data-id="${linked}" data-target-kind="entry" data-label="Ziel">Ziel</span>`;
  await insertWithStack(db, 'entries', { id: 'p1', title: 'Plain', created_at: now, updated_at: now }, `<p>Text ${chip}</p>`);
  const [p1] = await db.select("SELECT type, text FROM blocks WHERE entry_id = 'p1'");
  check('a text entry is one text row with its plain text', p1?.type === 'core.text' && p1.text === 'Text Ziel', p1); // lang-ok
  check('its chip is a reference', (await db.select('SELECT COUNT(*) AS n FROM block_refs WHERE target = $1', [linked]))[0].n === 1);

  // An entry deleted for good takes its blocks along (CASCADE), and their references.
  await db.execute("DELETE FROM entries WHERE id = 'p1'");
  check('deleting an entry deletes its blocks and refs',
    (await db.select("SELECT COUNT(*) AS n FROM blocks WHERE entry_id = 'p1'"))[0].n === 0
      && (await db.select('SELECT COUNT(*) AS n FROM block_refs WHERE target = $1', [linked]))[0].n === 0);

  // A row with both owners or none is refused.
  let refused = 0;
  for (const sql of [
    "INSERT INTO blocks (id, entry_id, template_id, position, type, updated_at) VALUES ('x', 'nope', 'core-sigil', 'V', 'core.text', 'now')",
    "INSERT INTO blocks (id, position, type, updated_at) VALUES ('x', 'V', 'core.text', 'now')",
  ]) {
    try { await db.execute(sql); } catch { refused++; }
  }
  check('blocks: exactly one owner (CHECK)', refused === 2);

  // Re-encrypting a vault renames pictures in every table by `rowid` (`rewrite_database` in `reencrypt.rs`).
  const withoutRowid = [];
  for (const table of TABLES) {
    try { await db.select(`SELECT rowid FROM ${table} LIMIT 0`); } catch { withoutRowid.push(table); }
  }
  check('every table has a rowid, which re-encrypting needs', withoutRowid.length === 0, withoutRowid.join(', '));

  // The lists read only the index at startup (`fetchEntries`).
  const plan = async (sql) => (await db.select(`EXPLAIN QUERY PLAN ${sql}`)).map((r) => r.detail).join(' | ');
  const list = await plan('SELECT id, title, category_id, entry_number, icon, cover_image, created_at, updated_at, deleted_at FROM entries WHERE deleted_at IS NULL');
  check('the list query reads only the index, icon and cover included', list.includes('COVERING INDEX idx_entries_list'), list);
  const links = await plan('SELECT entry_id AS owner, tag_id AS tag FROM entry_tags ORDER BY rowid');
  check('the tags of the lists come in one scan of entry_tags', links.includes('entry_tags') && !links.includes('TEMP B-TREE'), links);
  const chunk = await plan('SELECT rowid AS rid, id FROM entries WHERE +deleted_at IS NULL AND rowid > 1 ORDER BY rowid LIMIT 1000');
  check('the content chunks run along the rowid, without sorting', !chunk.includes('TEMP B-TREE'), chunk);
  db.close();
}

console.log('\n10. Readers of the block rows: "Images", image cleanup\n');

{
  const db = await freshVault('readers.db');
  clearSavedBlocks();
  const name = (c) => `${c.repeat(64)}.png`;
  const [shown, render, layer, tplPic, trashed] = ['1', '2', '3', '4', '5'].map(name);
  const enc = (value) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // A sigil with a drawing part (#107): its render and layer are the drawing.
  const part = `<section data-block="core.sigil" data-block-id="sp" data-block-data="${enc({ drawing: { v: 1, layers: [{ id: 'L1', image: true }] } })}">`
    + `<div data-sigil-part="drawing"><img src="${render}" alt="" data-paint="render"><img src="${layer}" alt="" data-paint="L1"></div></section>`;
  const text = `<section data-block="core.text" data-block-id="tx"><p><img src="${shown}"></p></section>`;
  await insertWithStack(db, 'entries', { id: 'u1', title: 'Uses', created_at: now, updated_at: now }, part + text);
  await insertWithStack(db, 'entries', { id: 'u2', title: 'Gone', created_at: now, updated_at: now, deleted_at: now }, `<p><img src="${trashed}"></p>`);
  await insertWithStack(db, 'templates', { id: 'ut', name: 'Tpl', created_at: now, updated_at: now }, `<p><img src="${tplPic}"></p>`);

  const uses = await collectImageUses(db);
  const roles = (file) => (uses.get(file) ?? []).map((u) => `${u.kind}:${u.id}:${u.role}`).join(' ');
  check('Images: a picture in a text is shown by its entry', roles(shown) === 'entry:u1:content', roles(shown));
  check('Images (#107): a drawing part\'s render and layer are the drawing, not pictures of their own',
    roles(render) === 'entry:u1:render' && roles(layer) === 'entry:u1:layer', [roles(render), roles(layer)]);
  check('Images: a template shows its picture; the trash shows nothing', roles(tplPic) === 'template:ut:content' && !uses.has(trashed),
    [roles(tplPic), roles(trashed)]);
  const used = await collectUsedImageFilenames(db);
  check('image cleanup: every picture a block names is in use, the trash included',
    [shown, render, layer, tplPic, trashed].every((f) => used.has(f)), [...used]);
  check('image cleanup: a picture nobody names is not', !used.has(name('6')));
  // A canvas whose JSON cannot be read still names its pictures in its markup: the cleanup keeps them.
  await insertWithStack(db, 'entries', { id: 'u3', title: 'Broken', created_at: now, updated_at: now },
    `<section data-block="core.canvas" data-block-id="cv" data-block-data="{nope"><img src="${name('7')}" data-canvas="image"></section>`);
  check('image cleanup: a block it cannot read keeps the pictures its row names', (await collectUsedImageFilenames(db)).has(name('7')));

  // Icons: the columns, and the copies of a custom block, which all name the same file.
  const icon = (c) => `${c.repeat(64)}.png`;
  await db.execute("UPDATE entries SET icon=$1 WHERE id='u1'", [icon('a')]);
  await db.execute("UPDATE templates SET icon=$1 WHERE id='ut'", [icon('b')]);
  await db.execute(`INSERT INTO languages (id,name,icon,created_at,updated_at) VALUES ('lg','L',$1,$2,$3)`, [icon('c'), now, now]);
  const copy = (id) => `<section data-block="core.fields" data-block-id="${id}" data-block-config="${enc({ elements: [{ id: 'n', kind: 'number', label: 'N' }], name: 'Block', icon: icon('d') })}"><dl></dl></section>`;
  await insertWithStack(db, 'entries', { id: 'u4', title: 'Copy 1', created_at: now, updated_at: now }, copy('k1'));
  await insertWithStack(db, 'entries', { id: 'u5', title: 'Copy 2', created_at: now, updated_at: now, deleted_at: now }, copy('k2'));
  const iconRefs = await db.select("SELECT DISTINCT target FROM block_refs WHERE target_kind='icon' AND role='icon'");
  check('a block copy names its icon in block_refs, both copies the same file',
    iconRefs.length === 1 && iconRefs[0].target === icon('d'), iconRefs);
  const usedIcons = await collectUsedIconFilenames(db);
  check('icon cleanup: the icons of entries, templates, languages and block copies are in use, the trash included',
    ['a', 'b', 'c', 'd'].every((c) => usedIcons.has(icon(c))), [...usedIcons]);
  check('icon cleanup: an icon nobody names is not', !usedIcons.has(icon('e')));
  check('Images: an icon is no use of a picture', ![...uses.keys()].includes(icon('a')) && !(await collectImageUses(db)).has(icon('d')));
  // A cover is a picture of "Images", used by its entry.
  await db.execute("UPDATE entries SET cover_image=$1 WHERE id='u1'", [name('8')]);
  check('Images: a cover is a use of its entry, with the role cover',
    ((await collectImageUses(db)).get(name('8')) ?? []).map((u) => `${u.kind}:${u.id}:${u.role}`).join() === 'entry:u1:cover');
  check('image cleanup: a cover is in use', (await collectUsedImageFilenames(db)).has(name('8')));

  check('readers: schema identical to the fresh vault', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  db.close();
}

console.log('\n11. .vault.emerald: the round trip of a vault content, other versions refused\n');

{
  const { createHash } = await import('node:crypto');
  // Every picture the import stores gets a name of its own here, as Rust gives it.
  const savedName = (name) => `${createHash('sha256').update(name).digest('hex')}.png`;
  const FULL = {
    categoryIds: null, includeUncategorized: true, includeTasks: true, includeTags: true,
    includeLexicon: true, dateFrom: '', dateTo: '', includeDeleted: true,
  };
  const ownColumn = { entry: 'entry_id', template: 'template_id' };
  const blockRows = async (db, kind, id) => (await db.select(
    `SELECT id, position, type, version, hidden, title, show_title, config, data, attrs, html, updated_at FROM blocks WHERE ${ownColumn[kind]} = $1 ORDER BY position`, [id],
  )).map((r) => ({ ...r }));
  const refRows = async (db, kind, id) => (await db.select(
    `SELECT b.id AS block, r.target_kind, r.target, r.role FROM block_refs r JOIN blocks b ON b.row_id = r.block_row
      WHERE b.${ownColumn[kind]} = $1 ORDER BY b.id, r.target_kind, r.target, r.role`, [id],
  )).map((r) => ({ ...r }));
  /**
   * What writing and opening a `.vault.emerald` does: the manifest through
   * JSON and read back as on opening; the archive's pictures and icons stored
   * under names of this vault (`store_emerald_files`).
   */
  const asFile = (collected) => ({
    content: vaultContentOf(JSON.stringify(vaultManifestOf(collected.content))),
    files: {
      images: new Map(collected.images.map((name) => [name, savedName(name)])),
      icons: new Map(collected.icons.map((name) => [name, savedName(name)])),
    },
  });
  const renamed = (value, names) => {
    let out = JSON.stringify(value);
    for (const [from, to] of names) out = out.split(from).join(to);
    return JSON.parse(out);
  };

  const W = '7b000000-0000-4000-8000-000000000001';
  const J = '7b000000-0000-4000-8000-000000000002';
  const TPL = '7b000000-0000-4000-8000-000000000003';
  const TASK = '7b000000-0000-4000-8000-000000000004';
  const pic = (c) => `${c.repeat(64)}.png`;
  const attr = (value) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const chipTo = (id) => `<span data-type="internalLink" class="internal-link" data-id="${id}" data-target-kind="entry" data-label="Ziel">Ziel</span>`; // lang-ok
  const scene = {
    width: 1600, height: 1000, elements: [], guides: [], guidesLocked: false,
    background: { fill: null, image: { src: pic('4') }, tint: null },
  };
  const fieldsConfig = {
    elements: [
      { id: 'ln', kind: 'link', label: 'L', defaultValue: { id: W, targetKind: 'entry', label: 'Ziel' } }, // lang-ok
      { id: 'im', kind: 'image', label: 'I', defaultValue: pic('5') },
    ],
  };
  const journalStack =
    `<section data-block="core.text" data-block-id="t1"><p>Link ${chipTo(W)}</p><img src="${pic('1')}"></section>`
    + `<section data-block="core.paint" data-block-id="p1" data-block-data="${attr({ v: 1, layers: [{ id: 'L1', image: true, strokes: [] }] })}">`
    + `<img src="${pic('2')}" alt="" data-paint="render"><img src="${pic('3')}" alt="" data-paint="L1"></section>`
    + `<section data-block="core.canvas" data-block-id="c1" data-block-data="${attr(scene)}"><img src="${pic('4')}" alt="" data-canvas="background"></section>`
    + `<section data-block="core.fields" data-block-id="f1" data-block-config="${attr(fieldsConfig)}"></section>`;

  const src = await freshVault('backup-src.db');
  const ico = (c) => `${c.repeat(64)}.webp`;
  const iconCopy = `<section data-block="core.fields" data-block-id="ic" data-block-config="${attr({ elements: [{ id: 'n', kind: 'number', label: 'N' }], name: 'B', icon: ico('a') })}"><dl></dl></section>`;
  await insertWithStack(src, 'entries', { id: W, title: 'Ziel', icon: ico('b'), cover_image: pic('7'), created_at: now, updated_at: now }, '<p>Ziel</p>' + iconCopy); // lang-ok
  await insertWithStack(src, 'entries', { id: J, title: 'Quelle', created_at: now, updated_at: now }, journalStack); // lang-ok
  await insertWithStack(src, 'templates', { id: TPL, name: 'Vorlage', icon: ico('c'), created_at: now, updated_at: now }, `<p>Bild</p><img src="${pic('6')}">`); // lang-ok
  await src.execute("INSERT INTO tags (id,name) VALUES ('t-a','Alpha'), ('t-b','Beta')");
  await src.execute(`INSERT INTO images (id,file,created_at,updated_at) VALUES ('img1',$1,$2,$2)`, [pic('8'), now]);
  await src.batch([
    ...tagStatements('entry', W, ['t-b', 't-a']),
    ...tagStatements('template', TPL, ['t-a']),
    ...tagStatements('image', 'img1', ['t-b']),
  ]);
  globalThis.harnessIconFiles = [ico('a'), ico('b'), ico('c')];
  await src.execute(`INSERT INTO tasks (id,title,created_at,updated_at) VALUES ($1,'Aufgabe',$2,$2)`, [TASK, now]); // lang-ok
  await src.execute(`INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl1',$1,$2,'entry')`, [TASK, W]);
  // A block written at another time than the others keeps that time.
  await src.execute("UPDATE blocks SET updated_at = '2025-05-05T05:05:05.000Z' WHERE entry_id = $1 AND id = 'p1'", [J]);
  const journalBefore = await blockRows(src, 'entry', J);
  const sigilBefore = await blockRows(src, 'template', 'core-sigil');
  const journalTplBefore = await blockRows(src, 'template', 'core-journal');

  const collected = await collectVaultContent(src, FULL);
  const backup = collected.content;
  check('export: a manifest of the kind vault, the blocks as rows, no content on their owners',
    vaultManifestOf(backup).kind === 'vault' && vaultManifestOf(backup).version === EMERALD_FORMAT_VERSION && Array.isArray(backup.data.blocks) && backup.data.blocks.length > 0
      && backup.data.entries.every((r) => !('content' in r)) && backup.data.templates.every((r) => !('content' in r))
      && backup.data.blocks.every((r) => !('row_id' in r) && !('text' in r)), backup.data.blocks?.[0]);
  check("export: every picture of the blocks travels, the one only in a prefill's JSON too",
    ['1', '2', '3', '4', '5', '6'].every((c) => collected.images.includes(pic(c))), collected.images);
  check('export: the cover travels as a picture', collected.images.includes(pic('7')));
  check('export: the manifest carries names only, no picture data', !JSON.stringify(vaultManifestOf(backup)).includes('data:image'));
  check("export: the icons travel as files of their own — the entry's, the template's and a block copy's — the entry's and the template's not among the pictures",
    ['a', 'b', 'c'].every((c) => collected.icons.includes(ico(c))) && !collected.images.includes(ico('b')) && !collected.images.includes(ico('c')), { icons: collected.icons, images: collected.images });
  check('export: rows carry their tags as arrays of IDs, in their order',
    backup.data.entries.find((r) => r.id === W)?.tags.join() === 't-b,t-a'
      && backup.data.templates.find((r) => r.id === TPL)?.tags.join() === 't-a'
      && backup.data.vaultImages.find((r) => r.id === 'img1')?.tags.join() === 't-b');

  // (a) Replace into an empty vault: the same rows, pictures renamed, references rebuilt.
  // The target vault has none of the source's icon files.
  globalThis.harnessIconFiles = [];
  const restored = asFile(collected);
  const dst = await freshVault('backup-dst.db');
  clearSavedBlocks();
  await doReplace(dst, restored.content, restored.files);
  const iconNames = restored.files.icons;
  const names = new Map([...restored.files.images, ...iconNames]);
  for (const [kind, id, label] of [['entry', J, 'journal entry'], ['entry', W, 'second entry'], ['template', TPL, 'template']]) {
    const expected = renamed(await blockRows(src, kind, id), names);
    const got = await blockRows(dst, kind, id);
    check(`restore: the ${label} has its blocks unchanged, position and time included`,
      got.length > 0 && JSON.stringify(got) === JSON.stringify(expected), { got, expected });
    // Sorted after renaming: the new names sort differently.
    const sorted = (refs) => refs.map((r) => JSON.stringify(r)).sort().join('\n');
    const refs = await refRows(dst, kind, id);
    check(`restore: the references of the ${label} are rebuilt`,
      sorted(refs) === sorted(renamed(await refRows(src, kind, id), names)), { refs, src: renamed(await refRows(src, kind, id), names) });
  }
  check("restore: the prefill's picture is referenced as a default",
    (await refRows(dst, 'entry', J)).some((r) => r.role === 'default' && r.target === names.get(pic('5'))));
  check("restore: the vault's own templates keep their blocks",
    (await dst.select("SELECT COUNT(*) AS n FROM blocks WHERE template_id = 'core-sigil'"))[0].n > 0);
  const [wRow] = await dst.select('SELECT icon, cover_image FROM entries WHERE id = $1', [W]);
  const [tRow] = await dst.select('SELECT icon FROM templates WHERE id = $1', [TPL]);
  check('restore: icons are stored anew and the rows name them', wRow.icon === iconNames.get(ico('b')) && tRow.icon === iconNames.get(ico('c')), { wRow, tRow });
  check('restore: the cover names the picture stored here', wRow.cover_image === names.get(pic('7')), wRow);
  check("restore: the block copy's icon is renamed and referenced as an icon",
    (await refRows(dst, 'entry', W)).some((r) => r.target_kind === 'icon' && r.target === iconNames.get(ico('a'))));
  const tagsOf = async (db, owner, id) => ((await readTagLinks(db, owner, [id])).get(id) ?? []).join();
  check('restore: entries, templates and pictures get their tags back, in their order',
    (await tagsOf(dst, 'entry', W)) === 't-b,t-a' && (await tagsOf(dst, 'template', TPL)) === 't-a' && (await tagsOf(dst, 'image', 'img1')) === 't-b',
    [await tagsOf(dst, 'entry', W), await tagsOf(dst, 'template', TPL), await tagsOf(dst, 'image', 'img1')]);
  check("restore: schema identical to the fresh vault", JSON.stringify(await readSchema(dst)) === JSON.stringify(schemaA));
  dst.close();

  // (b) Merge into the vault it came from: copies under fresh IDs, links pointing at the copies.
  clearSavedBlocks();
  const again = asFile(collected);
  await doMerge(src, again.content, again.files);
  const copyOf = async (id) => (await src.select(
    'SELECT c.id FROM entries c JOIN entries o ON o.id = $1 WHERE c.title = o.title AND c.id <> o.id', [id]))[0] ?? null;
  // By title: J's and W's titles are unique in this fixture.
  const copy = await copyOf(J);
  const copyWId = (await copyOf(W))?.id ?? null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  check('merge: the copies carry plain UUIDs, as a .emerald file requires',
    !!copy && uuidRe.test(copy.id) && !!copyWId && uuidRe.test(copyWId), { copy, copyWId });
  const copyStack = copy ? await stackOf(src, 'entry', copy.id) : '';
  check("merge: the copy's chip and link prefill point at the copied target",
    !!copy && copyStack.includes(`data-id="${copyWId}"`) && !copyStack.includes(`data-id="${W}"`)
      && copyStack.includes(`&quot;id&quot;:&quot;${copyWId}&quot;`), copyStack);
  check("merge: the copy's references to entries point at the copied target",
    !!copy && (await refRows(src, 'entry', copy.id)).filter((r) => r.target_kind === 'entry').every((r) => r.target === copyWId));
  check("merge: the original keeps its blocks", JSON.stringify(await blockRows(src, 'entry', J)) === JSON.stringify(journalBefore));
  check("merge: a template that is already there gets no second set of blocks", (await blockRows(src, 'template', TPL)).length === 1);
  check('merge: the copy carries the tags of its original, the template keeps its own',
    !!copyWId && (await readTagLinks(src, 'entry', [copyWId])).get(copyWId)?.join() === 't-b,t-a' && (await readTagLinks(src, 'template', [TPL])).get(TPL)?.join() === 't-a');
  src.close();

  // (c) A partial replace — journal and tasks only: no other owner gets blocks, a link to the missing article goes.
  const partial = asFile(collected);
  partial.content.data.entries = partial.content.data.entries.filter((r) => r.id !== W);
  const dst2 = await freshVault('backup-partial.db');
  clearSavedBlocks();
  await doReplace(dst2, partial.content, partial.files);
  check('partial restore: the journal entry has its blocks, the second entry neither row nor blocks',
    (await blockRows(dst2, 'entry', J)).length === 4 && (await blockRows(dst2, 'entry', W)).length === 0
      && (await dst2.select('SELECT COUNT(*) AS n FROM entries WHERE id = $1', [W]))[0].n === 0);
  check('partial restore: the task link to the article left out is swept',
    (await dst2.select('SELECT COUNT(*) AS n FROM task_links'))[0].n === 0);
  dst2.close();

  // As a new vault (add-vault): the seeded built-in templates go first (as `importDatabase` does), the file's arrive with their own blocks.
  const fresh = await freshVault('backup-add-vault.db');
  clearSavedBlocks();
  check('new vault: the seeded templates are exactly the built-ins a restore replaces',
    JSON.stringify((await fresh.select('SELECT id FROM templates ORDER BY id')).map((r) => r.id)) === JSON.stringify([...BUILTIN_TEMPLATE_IDS].sort()));
  await fresh.execute(`DELETE FROM templates WHERE id IN (${placeholders(BUILTIN_TEMPLATE_IDS.length)})`, [...BUILTIN_TEMPLATE_IDS]);
  const asNew = asFile(collected);
  await doReplace(fresh, asNew.content, asNew.files);
  check('new vault: the sigil template has exactly the blocks of the file',
    JSON.stringify(await blockRows(fresh, 'template', 'core-sigil')) === JSON.stringify(renamed(sigilBefore, asNew.files.images)));
  check('new vault: the journal template has exactly the blocks of the file',
    journalTplBefore.length === 2 && JSON.stringify(await blockRows(fresh, 'template', 'core-journal')) === JSON.stringify(journalTplBefore), journalTplBefore);
  fresh.close();

  // A crafted file with short picture keys: every name is renamed once, nothing grows key by key.
  const crafted = asFile(collected);
  for (const key of ['', '0', 'a']) crafted.files.images.set(key, savedName(key));
  const dst3 = await freshVault('backup-crafted.db');
  clearSavedBlocks();
  await doReplace(dst3, crafted.content, crafted.files);
  const longest = (await dst3.select('SELECT MAX(LENGTH(html) + LENGTH(COALESCE(data, \'\'))) AS n FROM blocks'))[0].n;
  check('crafted picture keys: the import finishes and the blocks keep their size', longest < 5000, longest);
  dst3.close();

  // A starter category renamed here (or named in another app language there)
  // is still the same category: matched by ID, no duplicate, and the built-in
  // dashboards keep pointing at it.
  const dreamsSrc = await freshVault('backup-starter-src.db');
  clearSavedBlocks();
  await insertWithStack(dreamsSrc, 'entries', { id: 'dream-1', title: 'Tower', category_id: 'dreams', created_at: now, updated_at: now }, '<p>Tower</p>');
  const dreamsBackup = await collectVaultContent(dreamsSrc, FULL);
  dreamsSrc.close();
  const dreamsDst = await freshVault('backup-starter-dst.db');
  await dreamsDst.execute("UPDATE categories SET name = 'Träume' WHERE id = 'dreams'"); // lang-ok
  const categoriesBefore = (await dreamsDst.select('SELECT COUNT(*) AS n FROM categories'))[0].n;
  clearSavedBlocks();
  const dreamsFile = asFile(dreamsBackup);
  await doReplace(dreamsDst, dreamsFile.content, dreamsFile.files);
  const categoriesAfter = (await dreamsDst.select('SELECT COUNT(*) AS n FROM categories'))[0].n;
  const [dreamEntry] = await dreamsDst.select("SELECT category_id FROM entries WHERE id = 'dream-1'");
  const journalFilter = JSON.parse((await dreamsDst.select("SELECT filter FROM dashboards WHERE id = 'journal'"))[0].filter);
  check('replace after renaming a starter category: no duplicate category is created',
    categoriesAfter === categoriesBefore, { categoriesBefore, categoriesAfter });
  check('replace after renaming a starter category: its entries stay in it and the Journal dashboard still shows it',
    dreamEntry?.category_id === 'dreams' && journalFilter.categories?.includes('dreams'), { dreamEntry, journalFilter });
  dreamsDst.close();

  // The starter renamed in the file and its old name given to a category of
  // its own there: two categories in the file stay two here.
  const swapSrc = await freshVault('backup-starter-swap-src.db');
  clearSavedBlocks();
  const dreamsName = (await swapSrc.select("SELECT name FROM categories WHERE id = 'dreams'"))[0].name;
  await swapSrc.execute("UPDATE categories SET name = 'Visions' WHERE id = 'dreams'");
  await swapSrc.execute("INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ('c-own', $1, '🌙', 99, 0)", [dreamsName]);
  await insertWithStack(swapSrc, 'entries', { id: 'vision-1', title: 'Vision', category_id: 'dreams', created_at: now, updated_at: now }, '<p>Vision</p>');
  await insertWithStack(swapSrc, 'entries', { id: 'own-1', title: 'Own', category_id: 'c-own', created_at: now, updated_at: now }, '<p>Own</p>');
  const swapBackup = await collectVaultContent(swapSrc, FULL);
  swapSrc.close();
  const swapDst = await freshVault('backup-starter-swap-dst.db');
  const localDreams = (await swapDst.select("SELECT name FROM categories WHERE id = 'dreams'"))[0].name;
  clearSavedBlocks();
  const swapFile = asFile(swapBackup);
  await doReplace(swapDst, swapFile.content, swapFile.files);
  const swapped = await swapDst.select("SELECT e.id, c.name FROM entries e JOIN categories c ON c.id = e.category_id WHERE e.id IN ('vision-1', 'own-1') ORDER BY e.id");
  const swapJournal = JSON.parse((await swapDst.select("SELECT filter FROM dashboards WHERE id = 'journal'"))[0].filter);
  const [visionsRow] = await swapDst.select("SELECT id FROM categories WHERE name = 'Visions'");
  check("replace: a renamed starter and a category with the starter's old name stay two categories",
    localDreams === dreamsName && swapped.map((r) => `${r.id}:${r.name}`).join() === `own-1:${dreamsName},vision-1:Visions`
      && !!visionsRow && swapJournal.categories?.includes(visionsRow.id), JSON.stringify({ localDreams, swapped, swapJournal, visionsRow }));
  swapDst.close();

  // Merging keeps the same rule: the renamed starter is the same category.
  const mergeDst = await freshVault('backup-starter-merge-dst.db');
  await mergeDst.execute("UPDATE categories SET name = 'Kräuter und Träume' WHERE id = 'dreams'"); // lang-ok
  const mergeBefore = (await mergeDst.select('SELECT COUNT(*) AS n FROM categories'))[0].n;
  clearSavedBlocks();
  const mergeFile = asFile(dreamsBackup);
  await doMerge(mergeDst, mergeFile.content, mergeFile.files);
  const [merged] = await mergeDst.select("SELECT category_id FROM entries WHERE title = 'Tower'");
  check('merge after renaming a starter category: no duplicate, the entry lands in it',
    (await mergeDst.select('SELECT COUNT(*) AS n FROM categories'))[0].n === mergeBefore && merged?.category_id === 'dreams', merged);
  mergeDst.close();

  // ── A .emerald file of entries: the same rule for its categories, its custom blocks along ──
  {
    const itemSrc = await freshVault('items-src.db');
    clearSavedBlocks();
    const DEF = 'def-plant';
    await itemSrc.execute(
      "INSERT INTO block_definitions (id, name, icon, elements, display, sort_order, created_at, updated_at) VALUES ($1, 'Plant', '🌿', '[]', '{}', 0, $2, $2)",
      [DEF, now],
    );
    await itemSrc.execute("INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ('c-ritual', 'Night work', '🕯️', 98, 0), ('c-new', 'Only there', '🌙', 99, 0)");
    const copyOf = `<section data-block="core.fields" data-block-id="f1" data-block-config="${attr({ elements: [], name: 'Plant', icon: '🌿', definition: DEF })}"></section>`;
    const source = [
      { id: '7c000000-0000-4000-8000-000000000001', category: 'dreams', content: '<p>Tower</p>' + copyOf },
      { id: '7c000000-0000-4000-8000-000000000002', category: 'c-ritual', content: '<p>Night</p>' },
      { id: '7c000000-0000-4000-8000-000000000003', category: 'c-new', content: '<p>New</p>' },
    ];
    // The exporting app runs in another language: the starter is shown under its name there.
    const shown = { dreams: 'Traumtagebuch' }; // lang-ok
    const categoryRows = new Map((await itemSrc.select('SELECT id, name, emoji, is_builtin FROM categories')).map((c) => [c.id, c]));
    const items = source.map((e) => ({
      kind: 'entry', id: e.id, title: e.id, number: null, createdAt: now, updatedAt: now, icon: '', cover: null, tags: [],
      category: manifestCategoryOf(categoryRows.get(e.category), shown[e.category] ?? categoryRows.get(e.category).name),
      blocks: contentToBlocks(e.content),
    }));
    const definitionIds = usedDefinitionIds(source.map((e) => e.content));
    const manifest = {
      format: 'emerald', version: EMERALD_FORMAT_VERSION, kind: 'items', exportedAt: now, items, links: [], omittedImages: [],
      blockDefinitions: await definitionRows(itemSrc, definitionIds),
    };
    itemSrc.close();
    check('.emerald: the copy of a custom block names its definition, which goes along',
      definitionIds.join() === DEF && manifest.blockDefinitions.length === 1, definitionIds);
    const parsed = parseManifest(JSON.stringify(manifest));
    check('.emerald: the manifest carries the starter category with its ID', typeof parsed === 'object'
      && parsed.items[0].category?.id === 'dreams' && parsed.items[0].category?.name === 'Traumtagebuch', parsed); // lang-ok

    const itemDst = await freshVault('items-dst.db');
    await itemDst.execute("UPDATE categories SET name = 'Visions' WHERE id = 'dreams'");
    await itemDst.execute("INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ('c-local', 'night WORK', '🕯️', 98, 0)");
    const before = (await itemDst.select('SELECT COUNT(*) AS n FROM categories'))[0].n;
    const { map } = await resolveImportedCategories(itemDst, categoryRowsOf(parsed.items, (icon) => icon));
    const [created] = await itemDst.select("SELECT id FROM categories WHERE name = 'Only there'");
    check('.emerald: a renamed starter category from another language is found by its ID, no duplicate',
      map.get('dreams') === 'dreams', [...map]);
    check('.emerald: another category goes by the name it had at export', map.get('c-ritual') === 'c-local', [...map]);
    check('.emerald: a category without a namesake here is created, once',
      !!created && map.get('c-new') === created.id && (await itemDst.select('SELECT COUNT(*) AS n FROM categories'))[0].n === before + 1);
    // A starter ID no longer in the starter set (`herbs`, a former starter): an ordinary category, created under its name.
    const old = await resolveImportedCategories(itemDst, [{ id: 'herbs', name: 'Kräuter', emoji: '🌿', is_builtin: 0 }]); // lang-ok
    const [herbs] = await itemDst.select("SELECT id, name, is_builtin FROM categories WHERE name = 'Kräuter'"); // lang-ok
    check('.emerald: a category under a starter ID that no longer exists is created under its name',
      !!herbs && herbs.is_builtin === 0 && old.map.get('herbs') === herbs.id, [...old.map]);
    const again = await resolveImportedCategories(itemDst, [{ id: 'herbs', name: 'Herbs', emoji: '🌿', is_builtin: 0 }]);
    check('.emerald: …and matched by name, not by that ID, the next time',
      again.map.get('herbs') !== herbs.id && (await itemDst.select("SELECT COUNT(*) AS n FROM categories WHERE name = 'Herbs'"))[0].n === 1, [...again.map]);
    await insertBlockDefinitions(itemDst, parsed.blockDefinitions);
    await insertBlockDefinitions(itemDst, parsed.blockDefinitions);
    const definitions = await itemDst.select('SELECT id, name FROM block_definitions WHERE id = $1', [DEF]);
    check('.emerald: the custom block is created, and recognised by its ID the second time', definitions.length === 1 && definitions[0].name === 'Plant', definitions);
    itemDst.close();
  }

  // ── A .emerald file of entries: the pictures in "Images" bring name, note and tags ──
  {
    const pic = (c) => `${c.repeat(64)}.png`;
    const src = await freshVault('items-images-src.db');
    await src.execute("INSERT INTO tags (id, name, color) VALUES ('t-night', 'Night', '#111111'), ('t-fresh', 'Fresh', '#222222'), ('t-gone', 'Gone', '#333333')");
    await src.execute("UPDATE tags SET deleted_at = $1 WHERE id = 't-gone'", [now]);
    await src.execute(
      `INSERT INTO images (id, file, name, note, created_at, updated_at) VALUES
         ('img-moon', $1, 'Moon', 'Over the hill', $4, $4),
         ('img-bare', $2, '', '', $4, $4),
         ('img-trash', $3, 'Trashed', '', $4, $4)`,
      [pic('a'), pic('b'), pic('c'), now],
    );
    await src.execute("UPDATE images SET deleted_at = $1 WHERE id = 'img-trash'", [now]);
    await src.batch(tagStatements('image', 'img-moon', ['t-night', 't-fresh', 't-gone']));
    const details = await imageDetailsOf(src, [pic('a'), pic('b'), pic('c'), pic('d')]);
    const moon = details.find((d) => d.file === pic('a'));
    check('.emerald: a picture in "Images" goes with name, note and its live tags in order; one in the trash or not there without',
      details.length === 2 && moon?.name === 'Moon' && moon.note === 'Over the hill' && moon.tags.join() === 'Night,Fresh'
        && !details.some((d) => d.file === pic('c')), details);
    const manifest = {
      format: 'emerald', version: EMERALD_FORMAT_VERSION, kind: 'items', exportedAt: now, links: [], omittedImages: [], blockDefinitions: [],
      items: [{ kind: 'entry', id: '7c000000-0000-4000-8000-0000000000aa', title: 'Pictures', number: null, createdAt: now, updatedAt: now, icon: '', cover: null, tags: [], category: null, blocks: [] }],
      images: [...details, { file: 'not-a-picture', name: 'x', note: '', tags: [] }],
    };
    const parsed = parseManifest(JSON.stringify(manifest));
    check('.emerald: the manifest reads the pictures\' details, a foreign file name dropped',
      typeof parsed === 'object' && parsed.images.length === 2 && parsed.images[0].tags.join() === 'Night,Fresh', parsed?.images);

    /** Tag names → IDs as the import does: an existing tag by name regardless of case, else a new one. */
    const tagIdsIn = (db) => async (names) => {
      const ids = [];
      for (const name of names) {
        const [hit] = await db.select('SELECT id FROM tags WHERE lower(name) = lower($1)', [name]);
        const id = hit?.id ?? `t-new-${name}`;
        if (!hit) await db.execute("INSERT INTO tags (id, name, color) VALUES ($1, $2, '#00ff00')", [id, name]);
        ids.push(id);
      }
      return ids;
    };
    const storedBy = (pairs) => new Map(pairs.map(([from, to]) => [from.replace(/\.[a-z]+$/, ''), to]));

    // Another vault: "night" is there with its own colour, "Fresh" is not.
    const dst = await freshVault('items-images-dst.db');
    await dst.execute("INSERT INTO tags (id, name, color) VALUES ('t-local', 'night', '#abcdef')");
    // The moon was stored under another name (compressed on export); the bare one did not come.
    const changed = await importImageDetails(dst, parsed.images, storedBy([[pic('a'), pic('e')]]), tagIdsIn(dst));
    const [arrived] = await dst.select('SELECT id, name, note, deleted_at FROM images WHERE file = $1', [pic('e')]);
    const arrivedTags = arrived ? (await readTagLinks(dst, 'image', [arrived.id])).get(arrived.id) ?? [] : [];
    const [local] = await dst.select("SELECT color FROM tags WHERE id = 't-local'");
    check('.emerald into another vault: the picture arrives in "Images" with name, note and both tags',
      changed === 1 && arrived?.name === 'Moon' && arrived.note === 'Over the hill' && arrived.deleted_at === null
        && arrivedTags.join() === 't-local,t-new-Fresh', { changed, arrived, arrivedTags });
    check('.emerald into another vault: an existing tag keeps its colour and gains no namesake',
      local?.color === '#abcdef' && (await dst.select("SELECT COUNT(*) AS n FROM tags WHERE lower(name) = 'night'"))[0].n === 1, local);
    check('.emerald into another vault: a picture the file did not bring gets no details',
      (await dst.select('SELECT COUNT(*) AS n FROM images'))[0].n === 1);
    check('.emerald into another vault: importing again changes nothing',
      await importImageDetails(dst, parsed.images, storedBy([[pic('a'), pic('e')]]), tagIdsIn(dst)) === 0
        && (await dst.select('SELECT COUNT(*) AS n FROM images'))[0].n === 1);
    dst.close();

    // The same vault: one picture per file; a name and note it has stay, an
    // empty one is filled, tags are added; one in the trash comes back.
    await src.execute("UPDATE images SET name = 'Renamed here' WHERE id = 'img-moon'");
    await src.batch(tagStatements('image', 'img-moon', ['t-night']));
    const same = [
      { ...moon, note: 'From the file' },
      { file: pic('b'), name: 'Named in the file', note: 'Note', tags: [] },
      { file: pic('c'), name: 'Other', note: '', tags: ['Night'] },
    ];
    await importImageDetails(src, same, storedBy([[pic('a'), pic('a')], [pic('b'), pic('b')], [pic('c'), pic('c')]]), tagIdsIn(src));
    const rows = new Map((await src.select('SELECT id, name, note, deleted_at FROM images')).map((r) => [r.id, r]));
    const sameTags = await readTagLinks(src, 'image');
    check('.emerald into the same vault: no second picture, its own name and note stay, its tags come back',
      rows.size === 3 && rows.get('img-moon').name === 'Renamed here' && rows.get('img-moon').note === 'Over the hill'
        && sameTags.get('img-moon')?.join() === 't-night,t-fresh', { rows: [...rows.values()], tags: [...sameTags] });
    check('.emerald into the same vault: an unnamed picture takes the name and note of the file',
      rows.get('img-bare').name === 'Named in the file' && rows.get('img-bare').note === 'Note', rows.get('img-bare'));
    check('.emerald into the same vault: a picture in the trash comes back, keeping its name',
      rows.get('img-trash').deleted_at === null && rows.get('img-trash').name === 'Trashed'
        && sameTags.get('img-trash')?.join() === 't-night', rows.get('img-trash'));
    src.close();
  }


  // Files of other versions or kinds: refused when they are read, before anything happens.
  const manifestJson = JSON.parse(JSON.stringify(vaultManifestOf(backup)));
  const problem = (patch) => parseVaultManifest(JSON.stringify({ ...manifestJson, ...patch }));
  check('a manifest of format 6 is refused as old', problem({ version: 6 }) === 'oldVersion');
  check('a manifest of a newer format is refused as too new', problem({ version: EMERALD_FORMAT_VERSION + 1 }) === 'newVersion');
  check('a file of entries is no vault', problem({ kind: 'items' }) === 'unsupported');
  check('a vault manifest without data, or no JSON, is refused',
    problem({ data: [] }) === 'unsupported' && parseVaultManifest('nope') === 'unsupported');
  const strayEntry = { ...manifestJson, data: { ...manifestJson.data, entries: [{ id: 'x', category_id: 'not-in-file' }] } };
  check('an entry is in a category only if the file carries it',
    vaultContentOf(JSON.stringify(strayEntry)).data.entries[0].category_id === null);

  // ── Tags a block gives (block_refs kind `tag`, #186): written only for a tag that exists, carried through every import, moved by a tag merge ──
  {
    // A test type that gives the tags its data names — no built-in block gives any yet.
    registerBlockType({
      id: 'test.tagger', origin: 'plugin', icon: () => null, labelKey: 'x', descriptionKey: 'x', group: 'fields', dataVersion: 1, defaultShowTitle: false,
      properties: {
        mayContribute: (content) => content.includes('test.tagger'),
        tags: (block) => { try { return JSON.parse(block.attrs['data-block-data']).tags ?? []; } catch { return []; } },
        overridable: { icon: true, cover: true },
      },
    });
    const tagger = (id, tags) => `<section data-block="test.tagger" data-block-id="${id}" data-block-data="${attr({ tags })}"></section>`;
    const tagRefs = async (db, id) => (await refRows(db, 'entry', id)).filter((r) => r.target_kind === 'tag').map((r) => r.target).join();
    const givenIn = async (db, id) => JSON.parse((await db.select("SELECT data FROM blocks WHERE entry_id = $1 AND type = 'test.tagger'", [id]))[0]?.data ?? '{}').tags?.join();
    const E = '7d000000-0000-4000-8000-000000000001';
    const src = await freshVault('block-tags-src.db');
    clearSavedBlocks();
    await src.execute("INSERT INTO tags (id, name, color) VALUES ('bt-src', 'Ritual', '#00e699')");
    await insertWithStack(src, 'entries', { id: E, title: 'Tagged', created_at: now, updated_at: now }, '<p>a</p>' + tagger('tb', ['bt-src', 'bt-ghost']));
    check('block tags: written as references of kind tag — only for a tag that exists', (await tagRefs(src, E)) === 'bt-src', await tagRefs(src, E));
    check("block tags: never among the entry's own tags", !(await readTagLinks(src, 'entry', [E])).has(E));
    const collectedTags = await collectVaultContent(src, FULL);

    const dst = await freshVault('block-tags-replace.db');
    clearSavedBlocks();
    const replaced = asFile(collectedTags);
    await doReplace(dst, replaced.content, replaced.files);
    check('block tags, replace: the tag keeps its ID, the reference is rebuilt from the block', (await tagRefs(dst, E)) === 'bt-src', await tagRefs(dst, E));
    dst.close();

    const merge = await freshVault('block-tags-merge.db');
    await merge.execute("INSERT INTO tags (id, name, color) VALUES ('bt-here', 'ritual', '#3b82f6')");
    clearSavedBlocks();
    const merged = asFile(collectedTags);
    await doMerge(merge, merged.content, merged.files);
    const [copy] = await merge.select("SELECT id FROM entries WHERE title = 'Tagged'");
    check('block tags, merge: the block names the tag of the same name here, its reference with it; a tag it cannot place gives nothing',
      (await givenIn(merge, copy?.id)) === 'bt-here,bt-ghost' && (await tagRefs(merge, copy?.id)) === 'bt-here',
      [await givenIn(merge, copy?.id), await tagRefs(merge, copy?.id)]);
    check('block tags, merge: no second tag of the same name', (await merge.select("SELECT COUNT(*) AS n FROM tags WHERE lower(name) = 'ritual'"))[0].n === 1);

    await merge.execute("INSERT INTO tags (id, name, color) VALUES ('bt-other', 'Andere', '#f43f5e')"); // lang-ok
    const owners = await retagBlocks(merge, 'bt-here', 'bt-other');
    check('tag merge: the blocks that gave the tag give the other one, data and references alike',
      (await givenIn(merge, copy?.id)) === 'bt-other,bt-ghost' && (await tagRefs(merge, copy?.id)) === 'bt-other'
        && owners.length === 1 && owners[0].kind === 'entry' && owners[0].id === copy?.id, owners);
    await merge.batch([['DELETE FROM tags WHERE id = $1', ['bt-other']], ...dropBlockTagStatements(['bt-other'])]);
    check('a tag deleted for good: the blocks give it no more', (await tagRefs(merge, copy?.id)) === '');
    check('block tags: schema identical to the fresh vault', JSON.stringify(await readSchema(merge)) === JSON.stringify(schemaA));
    merge.close();
    src.close();
  }
  delete globalThis.harnessIconFiles;
}

console.log('\n12. The raw backup: an open and a closed vault, replaced and merged\n');

{
  const { copyFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const savedName = (name) => `${createHash('sha256').update(`raw:${name}`).digest('hex')}.png`;
  const pic = (c) => `${c.repeat(64)}.png`;
  const RAW_SETTINGS = { version: 1, trash: { retentionDays: 7 } };

  /** A vault with an entry, a picture, a tag and a task — the source of both backups. */
  async function sourceVault(name, title) {
    const db = await freshVault(name);
    clearSavedBlocks();
    await insertWithStack(db, 'entries', { id: `${name}-e`, title, category_id: 'dreams', created_at: now, updated_at: now }, `<p>${title}</p><img src="${pic('9')}">`);
    await db.execute("INSERT INTO tags (id,name) VALUES ('raw-tag','Raw')");
    await db.batch(tagStatements('entry', `${name}-e`, ['raw-tag']));
    await db.execute(`INSERT INTO tasks (id,title,created_at,updated_at) VALUES ($1,'Task',$2,$2)`, [`${name}-t`, now]);
    return db;
  }

  /**
   * What importing a raw backup does with its database (`rawBackupContent`):
   * brought to this schema, read whole like a vault with the backup's
   * settings, its pictures stored under names of this vault.
   */
  async function readRaw(copyPath) {
    const copy = new HarnessDb(copyPath);
    try {
      await prepareRawDatabase(copy);
      const collected = await collectVaultContent(copy, FULL_BACKUP_OPTIONS, { settings: RAW_SETTINGS });
      return {
        content: collected.content,
        files: { images: new Map(collected.images.map((n) => [n, savedName(n)])), icons: new Map() },
      };
    } finally {
      copy.close();
    }
  }

  // Open: copied with `VACUUM INTO` while the vault stays open, as `raw_backup.rs` does.
  const open = await sourceVault('raw-open-src.db', 'While open');
  const openCopy = join(workDir, 'raw-open-copy.db');
  await open.execute(`VACUUM INTO '${openCopy.replace(/'/g, "''")}'`);
  // Written after the copy: not in the backup.
  await insertWithStack(open, 'entries', { id: 'later', title: 'Later', created_at: now, updated_at: now }, '<p>Later</p>');
  open.close();
  // Closed: the file as it lies.
  const closed = await sourceVault('raw-closed-src.db', 'While closed');
  const closedPath = join(workDir, 'raw-closed-src', 'raw-closed-src.db');
  closed.close();
  const closedCopy = join(workDir, 'raw-closed-copy.db');
  copyFileSync(closedPath, closedCopy);

  for (const [label, copyPath, id, title] of [
    ['an open vault', openCopy, 'raw-open-src.db-e', 'While open'],
    ['a closed vault', closedCopy, 'raw-closed-src.db-e', 'While closed'],
  ]) {
    const raw = await readRaw(copyPath);
    check(`raw backup of ${label}: read like a vault, with its settings`,
      raw.content.data.entries.some((r) => r.id === id) && raw.content.settings === RAW_SETTINGS
        && !raw.content.data.entries.some((r) => r.id === 'later'), raw.content.data.entries.map((r) => r.id));

    const replaced = await freshVault(`raw-replace-${label.split(' ')[1]}.db`);
    clearSavedBlocks();
    await doReplace(replaced, raw.content, raw.files);
    const [entry] = await replaced.select('SELECT title, category_id FROM entries WHERE id = $1', [id]);
    const stack = await stackOf(replaced, 'entry', id);
    check(`raw backup of ${label}, replaced: entry, category, tag, task and picture are back`,
      entry?.title === title && entry.category_id === 'dreams'
        && ((await readTagLinks(replaced, 'entry', [id])).get(id) ?? []).join() === 'raw-tag'
        && (await replaced.select('SELECT COUNT(*) AS n FROM tasks'))[0].n === 1
        && stack.includes(savedName(pic('9'))), { entry, stack });
    check(`raw backup of ${label}, replaced: schema identical to the fresh vault`,
      JSON.stringify(await readSchema(replaced)) === JSON.stringify(schemaA));
    const categoriesBefore = (await replaced.select('SELECT COUNT(*) AS n FROM categories'))[0].n;

    // Merged into the vault it was just restored to: a copy beside the original, no second category.
    clearSavedBlocks();
    const again = await readRaw(copyPath);
    await doMerge(replaced, again.content, again.files);
    const copies = await replaced.select('SELECT id, category_id FROM entries WHERE title = $1 AND id <> $2', [title, id]);
    check(`raw backup of ${label}, merged: a copy beside the original, in the same starter category`,
      copies.length === 1 && copies[0].category_id === 'dreams'
        && (await replaced.select('SELECT COUNT(*) AS n FROM entries WHERE id = $1', [id]))[0].n === 1
        && (await replaced.select('SELECT COUNT(*) AS n FROM categories'))[0].n === categoriesBefore, copies);
    replaced.close();
  }

  // What is no vault's database is refused before anything is written.
  const emptyPath = join(workDir, 'raw-empty.db');
  new HarnessDb(emptyPath).close();
  const empty = new HarnessDb(emptyPath);
  check('raw backup without a schema: refused, nothing created in it',
    await prepareRawDatabase(empty).then(() => false, () => true)
      && (await empty.select("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'"))[0].n === 0);
  empty.close();
  const newerPath = join(workDir, 'raw-newer.db');
  copyFileSync(closedPath, newerPath);
  const newer = new HarnessDb(newerPath);
  await newer.execute('INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)', [BASELINE_VERSION + 1, 'future', now]);
  check('raw backup from a newer app: refused', await prepareRawDatabase(newer).then(() => false, () => true));
  newer.close();
}

console.log('\n13. Mirrored constants\n');

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

  // The `.emerald` format: Rust checks the version and item count before any
  // picture is stored, the frontend writes and reads the same.
  const emeraldRs = read('src-tauri/src/emerald_file.rs');
  const manifestTs = read('src/lib/emerald/manifest.ts');
  check(
    '.emerald: Rust and the frontend name the same format version',
    emeraldRs.includes(`const FORMAT_VERSION: u64 = ${EMERALD_FORMAT_VERSION};`),
  );
  const maxItems = /const MAX_ITEMS: usize = (\d+);/.exec(emeraldRs)?.[1];
  const tsItems = /MANIFEST_LIMITS = \{ items: ([\d_]+),/.exec(manifestTs)?.[1]?.replace(/_/g, '');
  check('.emerald: Rust and the frontend allow the same number of items', !!maxItems && maxItems === tsItems, { maxItems, tsItems });
  // The start page offers what Rust accepts for "keep" — plus "all".
  const keepRs = /const KEEP_CHOICES: \[u32; \d+\] = \[([\d, ]+)\];/.exec(read('src-tauri/src/auto_backup.rs'))?.[1];
  const keepTs = /BACKUP_KEEP_OPTIONS = \[([\d, ]+), null\]/.exec(read('src/store/autoBackupStore.ts'))?.[1];
  check('automatic backup: Rust and the start page know the same retention choices', !!keepRs && keepRs === keepTs, { keepRs, keepTs });
  check(
    "automatic backup: the vault's own folder is called backups",
    read('src-tauri/src/vault.rs').includes('pub const BACKUP_SUBDIR: &str = "backups";'),
  );

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
  check(
    'DB_FILE matches in vault.rs and vaultManager.ts',
    vaultRs.includes('pub const DB_FILE: &str = "emerald.db"') &&
      vaultManagerTs.includes("const DB_FILE = 'emerald.db'")
  );
  check(
    'the image folder is called images (Rust is the only source)',
    vaultRs.includes('pub const IMAGES_SUBDIR: &str = "images"')
  );
  // The icon folder appears as a folder in Rust and as the path under the scheme on both sides.
  const iconsTs = read('src/lib/icons.ts');
  check(
    'the icon folder is called icons, and the scheme serves it under /icons/ on both sides',
    vaultRs.includes('pub const ICONS_SUBDIR: &str = "icons"') && imagesRs.includes('strip_prefix("icons/")')
      && iconsTs.includes('/icons/${icon}')
  );
  check(
    'emerald-img: icons build their URL with the builder of the pictures (schemeUrl)',
    iconsTs.includes('schemeUrl(') && imagesTs.includes('export function schemeUrl')
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

console.log('');

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error(`\nWorking directory for inspection: ${workDir}\n`);
  process.exit(1);
}

rmSync(workDir, { recursive: true, force: true });
console.log('All checks passed.\n');
