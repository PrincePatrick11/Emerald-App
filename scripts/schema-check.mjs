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
      // The backup import asks which pictures the vault has: none here.
      if (cmd === 'list_image_files') return [];
      // A backup embeds its pictures; the harness has no files, so the name stands in for the bytes.
      if (cmd === 'read_image_as_base64') return 'data:image/png;base64,' + Buffer.from(String(args?.filename ?? '')).toString('base64');
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
   export { TABLES, TABLE_DDL, BASELINE_VERSION, FRESH_START_VERSION, checkIntegrity, reassignCategoryContent, collectUsedImageFilenames } from '${root}/src/lib/schema';
   export { assertPayloadReferencesResolve, buildBackupFrom, doMerge, doReplace, readBackupPayload, BACKUP_OUTDATED, BACKUP_TOO_NEW } from '${root}/src/lib/dbBackup';
   export { invalidateVaultCache } from '${root}/src/lib/vaultManager';
   export { clearSavedBlocks, readContents, replaceOwnerBlocks } from '${root}/src/lib/blockStore';
   export { entriesWithFieldValue } from '${root}/src/lib/blocks/blockQuery';
   export { collectImageUses } from '${root}/src/lib/imageUsage';`
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
  assertPayloadReferencesResolve, buildBackupFrom, doMerge, doReplace, readBackupPayload, BACKUP_OUTDATED, BACKUP_TOO_NEW,
  invalidateVaultCache, clearSavedBlocks, readContents, replaceOwnerBlocks, entriesWithFieldValue, collectImageUses,
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

  // The mechanism for the steps to come: a vault at the fresh start runs a
  // step above it once, stamps it, and keeps the schema otherwise.
  const db = await freshVault('future-step.db');
  let ran = 0;
  const step = { version: FRESH_START_VERSION + 1, name: 'harness_step', up: async (d) => { ran++; await d.execute('CREATE TABLE harness_step (id TEXT)'); } };
  await runMigrations(db, [step], step.version);
  await runMigrations(db, [step], step.version);
  const stamped = (await db.select('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version).join();
  check('a migration step above the fresh start runs once and is stamped',
    ran === 1 && stamped === `${BASELINE_VERSION},${step.version}`, `${ran} / ${stamped}`);
  check('the runner refuses steps that do not end at the baseline',
    await throwsCode(() => runMigrations(db, [step]), 'BASELINE_VERSION'));
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
    `INSERT INTO entries (id,title,created_at,updated_at,tags)
     VALUES ('e1','Artikel',$1,$1,'[]')`,
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
    await db.execute("INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl4','t1','e1','wiki')");
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
    `INSERT INTO entries (id,title,category_id,created_at,updated_at,tags)
     VALUES ('a1','Wichtiger Artikel','temporaer',$1,$1,'[]')`,
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
    'starter set as normal categories, translated (harness: en)',
    cats.some((c) => c.id === 'herbs' && c.is_builtin === 0 && c.name === 'Herbs'),
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
    'with calculator, drawing and charge as fields and paint blocks (harness: English name)',
    t?.name === 'Sigil' && !content.includes('core.sigil.') && content.includes('data-block="core.paint"')
      && ['sigilCalc', 'sigilCharge'].every((kind) => content.includes(kind)),
    content
  );
  check('the altar template, the start template of "altars"; no other category has one',
    starts.altars === 'core-altar' && Object.entries(starts).every(([id, tpl]) => ['sigils', 'altars'].includes(id) || tpl === null), JSON.stringify(starts));
  const dashboards = await baseline.select('SELECT id, builtin, position, filter, sort FROM dashboards ORDER BY position');
  const filterOf = (id) => JSON.parse(dashboards.find((d) => d.id === id)?.filter ?? 'null');
  check('four built-in dashboards, "all" first, each with its key as ID',
    dashboards.map((d) => d.id).join() === 'all,journal,operations,wiki' && dashboards.every((d) => d.builtin === d.id), JSON.stringify(dashboards));
  check('"all" has no filter; journal, operations and wiki filter by their starter categories',
    JSON.stringify(filterOf('all')) === '{}'
      && JSON.stringify(filterOf('journal')) === JSON.stringify({ categories: ['journal'] })
      && JSON.stringify(filterOf('operations')) === JSON.stringify({ categories: ['sigils', 'altars', 'ritual', 'meditation'] })
      && JSON.stringify(filterOf('wiki')) === JSON.stringify({ categories: ['paradigm', 'herbs', 'crystals', 'candles', 'deities', 'tools'] }),
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
    [JSON.stringify({ categories: ['weg', 'herbs', 'fehlt'] }), now],
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
    !d1.filter.includes('"weg"') && d1.filter.includes('"herbs"'),
    d1.filter
  );
  // A category's start template: deleting the template for good leaves the category without one.
  await db.execute("UPDATE categories SET template_id='t1' WHERE id='herbs'");
  await db.execute("DELETE FROM templates WHERE id='t1'");
  check('deleting a start template for good clears it on its category (ON DELETE SET NULL)',
    (await db.select("SELECT template_id FROM categories WHERE id='herbs'"))[0].template_id === null);
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
  check('the seeded templates have their block rows', seeded.n >= 4, seeded);

  const linked = '44444444-4444-4444-4444-444444444444';
  const chip = `<span data-type="internalLink" class="internal-link" data-id="${linked}" data-entry-type="wiki" data-label="Ziel">Ziel</span>`;
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

  // Re-encrypting a vault renames pictures in every table by `rowid` (`rewrite_tables` in `reencrypt.rs`).
  const withoutRowid = [];
  for (const table of TABLES) {
    try { await db.select(`SELECT rowid FROM ${table} LIMIT 0`); } catch { withoutRowid.push(table); }
  }
  check('every table has a rowid, which re-encrypting needs', withoutRowid.length === 0, withoutRowid.join(', '));

  // The lists read only the index at startup (`fetchEntries`).
  const plan = async (sql) => (await db.select(`EXPLAIN QUERY PLAN ${sql}`)).map((r) => r.detail).join(' | ');
  const list = await plan('SELECT id, title, category_id, entry_number, tags, created_at, updated_at, deleted_at FROM entries WHERE deleted_at IS NULL');
  check('the list query reads only the index', list.includes('COVERING INDEX idx_entries_list'), list);
  const decorated = await plan('SELECT id, icon, cover_image FROM entries WHERE deleted_at IS NULL AND (icon IS NOT NULL OR cover_image IS NOT NULL)');
  check('icon and cover image come via the partial index', decorated.includes('idx_entries_decorated'), decorated);
  const chunk = await plan('SELECT rowid AS rid, id FROM entries WHERE +deleted_at IS NULL AND rowid > 1 ORDER BY rowid LIMIT 1000');
  check('the content chunks run along the rowid, without sorting', !chunk.includes('TEMP B-TREE'), chunk);
  db.close();
}

console.log('\n10. Readers of the block rows: "Images", image cleanup, field values\n');

{
  const db = await freshVault('readers.db');
  clearSavedBlocks();
  const name = (c) => `${c.repeat(64)}.png`;
  const [shown, render, layer, tplPic, trashed] = ['1', '2', '3', '4', '5'].map(name);
  const enc = (value) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // A custom block with a drawing part (#107): its render and layer are the drawing.
  const part = `<section data-block="core.fields" data-block-id="sp" data-block-config="${enc({ elements: [{ id: 'd', kind: 'sigilCanvas', label: '' }] })}"`
    + ` data-block-data="${enc({ values: { d: { v: 1, layers: [{ id: 'L1', image: true }] } } })}">`
    + `<dl><dt>Zeichnung</dt><dd data-block-slot="el:d"><img src="${render}" alt="" data-paint="render"><img src="${layer}" alt="" data-paint="L1"></dd></dl></section>`; // lang-ok
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

  // Field values through SQLite's JSON functions (#37).
  const fields = (id, values) => `<section data-block="core.fields" data-block-id="${id}"`
    + ` data-block-config="${enc({ elements: [{ id: 'n1', kind: 'number', label: 'N' }, { id: 's1', kind: 'shorttext', label: 'S' }, { id: 'b1', kind: 'toggle', label: 'B' }] })}"`
    + ` data-block-data="${enc({ values })}"><dl></dl></section>`;
  await insertWithStack(db, 'entries', { id: 'f1', title: 'F1', created_at: now, updated_at: now }, fields('fa', { n1: 5, s1: 'Hallo Welt', b1: true })); // lang-ok
  await insertWithStack(db, 'entries', { id: 'f2', title: 'F2', created_at: now, updated_at: now }, fields('fb', { n1: 7, s1: '', b1: false }));
  await insertWithStack(db, 'entries', { id: 'f3', title: 'F3', created_at: now, updated_at: now, deleted_at: now }, fields('fc', { n1: 5 }));
  const ids = async (elementId, condition, extra = {}) => (await entriesWithFieldValue(db, { elementId, condition, ...extra })).sort().join();
  check('field values: equals a number, the trash left out', (await ids('n1', { op: 'equals', value: 5 })) === 'f1');
  check('field values: the trash on request', (await ids('n1', { op: 'equals', value: 5 }, { includeDeleted: true })) === 'f1,f3');
  check('field values: contains, regardless of case', (await ids('s1', { op: 'contains', value: 'WELT' })) === 'f1');
  check('field values: a toggle', (await ids('b1', { op: 'equals', value: false })) === 'f2');
  check('field values: empty, only in blocks that have the element', (await ids('s1', { op: 'empty' })) === 'f2', await ids('s1', { op: 'empty' }));
  check('field values: not empty', (await ids('s1', { op: 'notEmpty' })) === 'f1');
  let refusedId = false;
  try { await entriesWithFieldValue(db, { elementId: 'x".evil', condition: { op: 'empty' } }); } catch { refusedId = true; }
  check('field values: an element ID that is no ID is refused', refusedId);

  check('readers: schema identical to the fresh vault', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  db.close();
}

console.log("\n11. Backups: the round trip of '16', older and newer files refused\n");

{
  const { createHash } = await import('node:crypto');
  // Every picture the import saves gets a name of its own, the hash of what it was given.
  const savedName = (dataUrl) => `${createHash('sha256').update(dataUrl).digest('hex')}.png`;
  globalThis.harnessSaveImage = savedName;
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
  /** The file through JSON, as it is written and read, and checked like on opening it. */
  const reread = (file) => {
    const copy = JSON.parse(JSON.stringify(file));
    readBackupPayload(copy);
    return copy;
  };
  /** A stored name in the file → the name the import saved it under. */
  const namesAfterImport = (file) => new Map(Object.entries(file.images).map(([name, url]) => [name, savedName(url)]));
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
  const chipTo = (id) => `<span data-type="internalLink" class="internal-link" data-id="${id}" data-entry-type="entry" data-label="Ziel">Ziel</span>`; // lang-ok
  const scene = {
    width: 1600, height: 1000, elements: [], guides: [], guidesLocked: false,
    background: { fill: null, image: { src: pic('4') }, tint: null },
  };
  const fieldsConfig = {
    elements: [
      { id: 'ln', kind: 'link', label: 'L', defaultValue: { id: W, entryType: 'entry', label: 'Ziel' } }, // lang-ok
      { id: 'im', kind: 'image', label: 'I', defaultValue: pic('5') },
    ],
  };
  const journalStack =
    `<section data-block="core.text" data-block-id="t1"><p>Link ${chipTo(W)}</p><img src="${pic('1')}"></section>`
    + `<section data-block="core.paint" data-block-id="p1" data-block-config="${attr({ sigil: true })}" data-block-data="${attr({ v: 1, layers: [{ id: 'L1', image: true, strokes: [] }] })}">`
    + `<img src="${pic('2')}" alt="" data-paint="render"><img src="${pic('3')}" alt="" data-paint="L1"></section>`
    + `<section data-block="core.canvas" data-block-id="c1" data-block-data="${attr(scene)}"><img src="${pic('4')}" alt="" data-canvas="background"></section>`
    + `<section data-block="core.fields" data-block-id="f1" data-block-config="${attr(fieldsConfig)}"></section>`;

  const src = await freshVault('backup-src.db');
  await insertWithStack(src, 'entries', { id: W, title: 'Ziel', created_at: now, updated_at: now }, '<p>Ziel</p>'); // lang-ok
  await insertWithStack(src, 'entries', { id: J, title: 'Quelle', created_at: now, updated_at: now }, journalStack); // lang-ok
  await insertWithStack(src, 'templates', { id: TPL, name: 'Vorlage', created_at: now, updated_at: now }, `<p>Bild</p><img src="${pic('6')}">`); // lang-ok
  await src.execute(`INSERT INTO tasks (id,title,created_at,updated_at) VALUES ($1,'Aufgabe',$2,$2)`, [TASK, now]); // lang-ok
  await src.execute(`INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl1',$1,$2,'entry')`, [TASK, W]);
  // A block written at another time than the others keeps that time.
  await src.execute("UPDATE blocks SET updated_at = '2025-05-05T05:05:05.000Z' WHERE entry_id = $1 AND id = 'p1'", [J]);
  const journalBefore = await blockRows(src, 'entry', J);
  const sigilBefore = await blockRows(src, 'template', 'core-sigil');

  const backup = await buildBackupFrom(src, FULL);
  check("export: version '16', the blocks as rows, no content on their owners",
    backup.version === '16' && Array.isArray(backup.data.blocks) && backup.data.blocks.length > 0
      && backup.data.entries.every((r) => !('content' in r)) && backup.data.templates.every((r) => !('content' in r))
      && backup.data.blocks.every((r) => !('row_id' in r) && !('text' in r)), backup.data.blocks?.[0]);
  check("export: every picture of the blocks travels, the one only in a prefill's JSON too",
    ['1', '2', '3', '4', '5', '6'].every((c) => pic(c) in backup.images), Object.keys(backup.images));

  // (a) Replace into an empty vault: the same rows, pictures renamed, references rebuilt.
  const restored = reread(backup);
  const dst = await freshVault('backup-dst.db');
  clearSavedBlocks();
  await doReplace(dst, restored);
  const names = namesAfterImport(restored);
  for (const [kind, id, label] of [['entry', J, 'journal entry'], ['entry', W, 'wiki article'], ['template', TPL, 'template']]) {
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
  check("restore: schema identical to the fresh vault", JSON.stringify(await readSchema(dst)) === JSON.stringify(schemaA));
  dst.close();

  // (b) Merge into the vault it came from: copies under prefixed IDs, links pointing at the copies.
  clearSavedBlocks();
  await doMerge(src, reread(backup));
  const [copy] = await src.select('SELECT id FROM entries WHERE id LIKE $1', [`%-${J}`]);
  const prefixed = copy ? copy.id.slice(0, copy.id.length - J.length) + W : null;
  const copyStack = copy ? await stackOf(src, 'entry', copy.id) : '';
  check("merge: the copy's chip and link prefill point at the copied target",
    !!copy && copyStack.includes(`data-id="${prefixed}"`) && !copyStack.includes(`data-id="${W}"`)
      && copyStack.includes(`&quot;id&quot;:&quot;${prefixed}&quot;`), copyStack);
  check("merge: the copy's references to entries point at the copied target",
    !!copy && (await refRows(src, 'entry', copy.id)).filter((r) => r.target_kind === 'entry').every((r) => r.target === prefixed));
  check("merge: the original keeps its blocks", JSON.stringify(await blockRows(src, 'entry', J)) === JSON.stringify(journalBefore));
  check("merge: a template that is already there gets no second set of blocks", (await blockRows(src, 'template', TPL)).length === 1);
  src.close();

  // (c) A partial replace — journal and tasks only: no other owner gets blocks, a link to the missing article goes.
  const partial = reread(backup);
  partial.data.entries = partial.data.entries.filter((r) => r.id !== W);
  const dst2 = await freshVault('backup-partial.db');
  clearSavedBlocks();
  await doReplace(dst2, partial);
  check('partial restore: the journal entry has its blocks, the wiki article neither row nor blocks',
    (await blockRows(dst2, 'entry', J)).length === 4 && (await blockRows(dst2, 'entry', W)).length === 0
      && (await dst2.select('SELECT COUNT(*) AS n FROM entries WHERE id = $1', [W]))[0].n === 0);
  check('partial restore: the task link to the article left out is swept',
    (await dst2.select('SELECT COUNT(*) AS n FROM task_links'))[0].n === 0);
  dst2.close();

  // As a new vault (add-vault): the seeded sigil template goes first, the file's arrives with its own blocks.
  const fresh = await freshVault('backup-add-vault.db');
  clearSavedBlocks();
  await fresh.execute("DELETE FROM templates WHERE id = 'core-sigil'");
  const asNew = reread(backup);
  await doReplace(fresh, asNew);
  check('new vault: the sigil template has exactly the blocks of the file',
    JSON.stringify(await blockRows(fresh, 'template', 'core-sigil')) === JSON.stringify(renamed(sigilBefore, namesAfterImport(asNew))));
  fresh.close();

  // A crafted file with short picture keys: every name is renamed once, nothing grows key by key.
  const crafted = reread(backup);
  crafted.images = { ...crafted.images, '': 'data:image/png;base64,AA', 0: 'data:image/png;base64,AB', a: 'data:image/png;base64,AC' };
  const dst3 = await freshVault('backup-crafted.db');
  clearSavedBlocks();
  await doReplace(dst3, crafted);
  const longest = (await dst3.select('SELECT MAX(LENGTH(html) + LENGTH(COALESCE(data, \'\'))) AS n FROM blocks'))[0].n;
  check('crafted picture keys: the import finishes and the blocks keep their size', longest < 5000, longest);
  dst3.close();


  // Files of other versions: refused when they are read, before anything happens.
  const refused = (version, code) => throwsCode(() => readBackupPayload({ ...JSON.parse(JSON.stringify(backup)), version }), code);
  check("a backup of '15' (entries with a type) is refused as outdated", await refused('15', BACKUP_OUTDATED));
  check("a backup of '14' (the last version before the fresh start) is refused as outdated", await refused('14', BACKUP_OUTDATED));
  check("a backup of '1' is refused as outdated", await refused('1', BACKUP_OUTDATED));
  check("a backup of '17' is refused as too new", await refused('17', BACKUP_TOO_NEW));
  check('a backup without a usable version is refused', await throwsCode(() => readBackupPayload({ ...backup, version: 'x' }), 'Unsupported backup version'));
  const fixture = (name) => JSON.parse(readFileSync(join(process.cwd(), 'tools/mcp/seed/imports', name), 'utf8'));
  for (const name of ['backup-v12-altars.emeralddb', 'backup-v13-pre-rebuild.emeralddb']) {
    check(`the old fixture ${name} is refused as outdated`, await throwsCode(() => readBackupPayload(fixture(name)), BACKUP_OUTDATED));
  }
  delete globalThis.harnessSaveImage;
}

console.log('\n12. Mirrored constants\n');

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

console.log('');

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error(`\nWorking directory for inspection: ${workDir}\n`);
  process.exit(1);
}

rmSync(workDir, { recursive: true, force: true });
console.log('All checks passed.\n');
