/**
 * Builds an emerald.db pre-filled with test data, headlessly.
 *
 * The schema is not reproduced here. It is taken from the app checkout this is
 * pointed at, by bundling that checkout's own `src/lib/schema.ts` and calling
 * the real `createSchema` and `seedBuiltins`. A checkout on a branch that
 * changed the schema therefore gets a seed for *its* schema, which a golden
 * .db committed to this repo could never do.
 *
 * The finished file is stamped at BASELINE_VERSION, so the app treats it as
 * current: no migration runs against it, and a checkout since the fresh start
 * of the schema refuses a vault stamped any lower as one of an older version.

 *
 * The bundling technique (esbuild + Tauri stubs + a node:sqlite adapter behind
 * the tauri-plugin-sql interface) is lifted from the app's own
 * scripts/schema-check.mjs, which runs this way in CI.
 *
 *   node build_seed.mjs --checkout <dir> --out <emerald.db> [--fixture f.json]
 *                       [--locale en] [--verify] [--force]
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = join(HERE, 'fixture.json');
export const SEED_IMAGES = join(HERE, 'images');

/**
 * The pictures in seed/images, each with the name the vault stores it under:
 * the SHA-256 of its content and its extension, as the app names a copied
 * file in a vault without a key (`image_name` in images.rs). The fixture
 * names them as @@file(<file in seed/images>)@@; provision.mjs copies them.
 */
export function seedImageFiles() {
  if (!existsSync(SEED_IMAGES)) return [];
  return readdirSync(SEED_IMAGES).filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f)).map((f) => {
    const source = join(SEED_IMAGES, f);
    const ext = f.split('.').pop().toLowerCase();
    return { key: f, source, name: `${createHash('sha256').update(readFileSync(source)).digest('hex')}.${ext}` };
  });
}

/* -- args ------------------------------------------------------------- */

export function parseArgs(argv) {
  const out = { fixture: join(HERE, 'fixture.json'), locale: 'en', verify: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verify') out.verify = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  if (!out.checkout) throw new Error('--checkout <dir> is required');
  if (!out.out) throw new Error('--out <emerald.db> is required');
  out.checkout = resolve(out.checkout);
  out.out = resolve(out.out);
  return out;
}

/* -- node:sqlite behind the tauri-plugin-sql interface ----------------- */

/** The plugin uses $1 placeholders; node:sqlite binds SQLite's own ?1 form. */
function toIndexedPlaceholders(sql) {
  return sql.replace(/\$(\d+)/g, '?$1');
}

class HarnessDb {
  constructor(path) {
    this.raw = new DatabaseSync(path);
  }
  async execute(sql, params = []) {
    if (!params.length) {
      // exec() copes with PRAGMA and VACUUM; prepare().run() does not.
      this.raw.exec(sql);
      return { rowsAffected: 0 };
    }
    const info = this.raw.prepare(toIndexedPlaceholders(sql)).run(...params);
    return { rowsAffected: Number(info.changes ?? 0) };
  }
  async select(sql, params = []) {
    return this.raw.prepare(toIndexedPlaceholders(sql)).all(...params);
  }
  close() {
    this.raw.close();
  }
}

/* -- bundling the checkout's schema ------------------------------------ */

const STUBS = {
  '@tauri-apps/plugin-sql': `
    export default class Database {
      static async load() { throw new Error('Database.load is not used in the seed builder'); }
    }`,
  // vaultManager is only pulled in transitively; nothing here writes a vault.
  '@tauri-apps/api/core': `
    export async function invoke(cmd) {
      // Newer checkouts open databases through invoke('db_load', ...) instead
      // of the plugin above; here every database is HarnessDb.
      if (String(cmd).startsWith('db_')) throw new Error(cmd + ' is not used in the seed builder');
      if (cmd === 'read_file') throw new Error('ENOENT (seed builder)');
      if (cmd === 'legacy_default_db_exists') return true;
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
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

async function loadAppModules(checkout, workDir) {
  // esbuild comes from the checkout's node_modules - the launcher runs
  // `npm install` in a fresh checkout before getting here.
  const require_ = createRequire(join(checkout, 'package.json'));
  const { build } = await import(pathToFileURL(require_.resolve('esbuild')).href);

  const src = checkout.replace(/\\/g, '/') + '/src/lib';
  // Since v66 the blocks of entries and templates are rows of `blocks` only;
  // a checkout that far writes them through its own block store.
  const blockStore = join(checkout, 'src', 'lib', 'blockStore.ts');
  const hasBlockRows = existsSync(blockStore) && readFileSync(blockStore, 'utf-8').includes('export function replaceOwnerBlocks');
  const entry = join(workDir, 'entry.ts');
  writeFileSync(
    entry,
    `export { BASELINE_VERSION, TABLES, createSchema, seedBuiltins, checkIntegrity } from '${src}/schema';
     export { internalLinkChipHtml } from '${src}/internalLinkHtml';
     export { runMigrations, MIGRATIONS } from '${src}/db';
     ${hasBlockRows ? `export { replaceOwnerBlocks } from '${src}/blockStore';` : ''}`
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
  return import(pathToFileURL(bundlePath).href);
}

/* -- fixture ----------------------------------------------------------- */

/** Starter category names as the app would render them, read from the
 *  checkout's own locale file rather than the i18n runtime. */
function starterNamer(checkout, locale) {
  let messages = {};
  try {
    messages = JSON.parse(
      readFileSync(join(checkout, 'src', 'i18n', 'locales', `${locale}.json`), 'utf-8')
    );
  } catch {
    /* fall through to the key-derived name */
  }
  return (dottedKey) => {
    const value = dottedKey.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), messages);
    if (typeof value === 'string') return value;
    const leaf = dottedKey.split('.').pop() ?? dottedKey;
    return leaf.charAt(0).toUpperCase() + leaf.slice(1);
  };
}

const CHIP_RE = /@@chip\(([^,]+),([^,]+),([^)]*)\)@@/g;
const FILE_RE = /@@file\(([^)]+)\)@@/g;
let fileNames = null;

/** @@file(moon.png)@@ → the stored name of seed/images/moon.png. */
function expandFiles(value) {
  if (typeof value !== 'string' || !value.includes('@@file(')) return value;
  fileNames ??= new Map(seedImageFiles().map((f) => [f.key, f.name]));
  return value.replace(FILE_RE, (_, key) => {
    const name = fileNames.get(key.trim());
    if (!name) throw new Error(`fixture names a picture seed/images does not have: ${key}`);
    return name;
  });
}

function expandChips(value, chipHtml) {
  if (typeof value !== 'string' || !value.includes('@@chip(')) return value;
  return value.replace(CHIP_RE, (_, id, entryType, label) =>
    chipHtml({ id: id.trim(), entryType: entryType.trim(), label: label.trim() })
  );
}

/** Columns a table actually has. Mirrors dbBackup.insertRows: a fixture key
 *  the schema no longer knows is dropped instead of failing the insert. */
function columnsOf(db, table) {
  return new Set(db.raw.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

/** Which owner kind a table's rows are, for their block rows. */
const BLOCK_OWNERS = { entries: 'entry', templates: 'template' };

async function insertRows(db, table, rows, chipHtml, report, app = {}) {
  if (!rows?.length) return;
  const known = columnsOf(db, table);
  const dropped = new Set();
  // Since v66 a block stack is no column but rows of `blocks`.
  const owner = BLOCK_OWNERS[table];
  const asBlockRows = owner && !known.has('content') && typeof app.replaceOwnerBlocks === 'function';
  const now = new Date().toISOString();
  for (const row of rows) {
    const cols = [];
    const values = [];
    for (const [key, raw] of Object.entries(row)) {
      if (key.startsWith('_')) continue;
      if (!known.has(key)) {
        dropped.add(key);
        continue;
      }
      cols.push(key);
      values.push(expandFiles(expandChips(raw, chipHtml)));
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    await db.execute(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
      values
    );
    if (asBlockRows && typeof row.content === 'string') {
      const content = expandFiles(expandChips(row.content, chipHtml));
      const plan = app.replaceOwnerBlocks({ kind: owner, id: row.id }, content, row.updated_at ?? now, { hasRows: false });
      for (const [query, params] of plan.statements) await db.execute(query, params ?? []);
    }
  }
  if (asBlockRows) dropped.delete('content');
  report.counts[table] = (report.counts[table] ?? 0) + rows.length;
  if (dropped.size) report.dropped[table] = [...dropped];
}

/** Two passes: a subtask's parent may sit further down the fixture, and the
 *  self-referencing foreign key is checked at insert time. */
async function insertTasks(db, tasks, chipHtml, report) {
  await insertRows(db, 'tasks', tasks.map(({ parent_task_id, ...rest }) => rest), chipHtml, report);
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    await db.execute('UPDATE tasks SET parent_task_id = $1 WHERE id = $2', [
      task.parent_task_id, task.id,
    ]);
  }
}

/* -- readable fixture ids → UUIDs ---------------------------------------- */

const SEED_ID_RE = /seed-[a-z0-9]+(?:-[a-z0-9]+)*/g;

/** A stable UUID for a readable fixture id: SHA-1 of the name, laid out as a
 *  version 5 UUID. Stable, so a repro step that names an id stays valid
 *  across rebuilds. */
export function seedUuid(name) {
  const hex = createHash('sha1').update('emerald-seed:' + name).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The fixture names its rows `seed-wiki-sigil` and so on, which keeps it
 * readable. The app only follows internal links to UUIDs
 * (isValidLinkTarget in src/lib/internalLinkHtml.ts), so every id a fixture
 * row declares is replaced by its UUID here - in its own row and wherever it
 * is referenced: foreign keys, JSON id lists, @@chip() placeholders.
 * `_`-prefixed keys are comments and stay as they are. The
 * regex is greedy, so `seed-task-prep-candles` is never read as
 * `seed-task-prep`; a seed-like token that no row declares is left alone.
 */
export function withUuids(fixture) {
  const ids = new Map();
  for (const [key, rows] of Object.entries(fixture)) {
    if (key.startsWith('_') || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (typeof row?.id === 'string' && row.id.startsWith('seed-')) ids.set(row.id, seedUuid(row.id));
    }
  }
  const swap = (value) => {
    if (typeof value === 'string') return value.replace(SEED_ID_RE, (token) => ids.get(token) ?? token);
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k.startsWith('_') ? v : swap(v)]));
    }
    return value;
  };
  return swap(fixture);
}

/**
 * Trashed rows are dated relative to the build, a day ago. A fixed date
 * would age past the vault's trash retention (30 days by default), and the
 * app purges such rows the moment it opens the vault - the trash would be
 * empty again. Their order among themselves is kept.
 */
export function withFreshTrash(fixture, now = Date.now()) {
  const dated = [];
  for (const [key, rows] of Object.entries(fixture)) {
    if (key.startsWith('_') || !Array.isArray(rows)) continue;
    for (const row of rows) if (row?.deleted_at) dated.push(row);
  }
  if (!dated.length) return fixture;
  const latest = Math.max(...dated.map((row) => Date.parse(row.deleted_at)));
  const shift = now - 24 * 60 * 60 * 1000 - latest;
  const fresh = (rows) => rows.map((row) =>
    row?.deleted_at ? { ...row, deleted_at: new Date(Date.parse(row.deleted_at) + shift).toISOString() } : row);
  return Object.fromEntries(Object.entries(fixture).map(([key, rows]) =>
    [key, !key.startsWith('_') && Array.isArray(rows) ? fresh(rows) : rows]));
}

/* -- fitting the fixture to the checkout's schema ----------------------- */

const ENTRY_SOURCES = [
  ['journal_entries', 'journal'],
  ['wiki_articles', 'wiki'],
  ['operations', 'operation'],
];

/**
 * The fixture is written against the three content tables Emerald had up to
 * v48. Checkouts since v49 keep journal entries, wiki articles and operations
 * in one `entries` table told apart by `type`, and since v53 an entry lists
 * its tags by id rather than by name.
 *
 * Rather than keep two fixtures in step, the old shape is translated here
 * when the checkout turns out to be a newer one. Columns that went away with
 * the old tables (slug, mood, ingredients, ...) are dropped by insertRows like
 * any other column the schema no longer has; plain HTML is still valid
 * content, the app reads it as a single text block.
 *
 * Checkouts with a `dashboards` table have no entry types at all: what an
 * entry is follows from its category. There a journal entry goes into the
 * category Journal, numbers run over all entries, link targets are `entry`
 * or `task`, and every category of the fixture joins the dashboard of the
 * module most of its entries came from (`_dashboardCategories`, applied by
 * `fitDashboards` once the rows are in).
 */
function fitFixture(fixture, tables) {
  if (!tables.includes('entries') || fixture.entries) return fixture;
  const typeless = tables.includes('dashboards');

  const tagIds = new Map((fixture.tags ?? []).map((tag) => [tag.name, tag.id]));
  const tagsById = (json) => JSON.stringify(JSON.parse(json).map((name) => tagIds.get(name) ?? name));

  const entries = [];
  for (const [source, type] of ENTRY_SOURCES) {
    for (const row of fixture[source] ?? []) {
      const entry = typeless ? { ...row } : { ...row, type };
      if (row.tags) entry.tags = tagsById(row.tags);
      if (typeless && type === 'journal') entry.category_id = 'journal';
      // The journal has no categories; the app keeps the column NULL there.
      else if (type === 'journal') delete entry.category_id;
      entries.push(Object.assign(entry, { _type: type }));
    }
  }
  if (!typeless) return { ...fixture, entries: entries.map(({ _type, ...entry }) => entry) };

  // One count over all entries, in creation order.
  [...entries].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .forEach((entry, i) => { entry.entry_number = i + 1; });
  const uses = new Map();
  for (const entry of entries) {
    if (!entry.category_id || entry.category_id === 'journal') continue;
    const counts = uses.get(entry.category_id) ?? { wiki: 0, operation: 0 };
    counts[entry._type] += 1;
    uses.set(entry.category_id, counts);
  }
  const fixtureCategories = new Set((fixture.categories ?? []).map((c) => c.id));
  const dashboardCategories = { wiki: [], operations: [] };
  for (const [category, counts] of uses) {
    if (!fixtureCategories.has(category)) continue;
    dashboardCategories[counts.operation > counts.wiki ? 'operations' : 'wiki'].push(category);
  }
  const target = (type) => (type === 'task' ? 'task' : 'entry');
  return {
    ...fixture,
    entries: entries.map(({ _type, ...entry }) => entry),
    task_links: (fixture.task_links ?? []).map((link) => ({ ...link, target_type: target(link.target_type) })),
    _typelessChips: true,
    _dashboardCategories: dashboardCategories,
  };
}

/** Adds the fixture's own categories to the built-in dashboards `fitFixture` chose for them. */
async function fitDashboards(db, fixture) {
  for (const [dashboard, categories] of Object.entries(fixture._dashboardCategories ?? {})) {
    if (!categories.length) continue;
    const rows = await db.select('SELECT filter FROM dashboards WHERE id = $1', [dashboard]);
    if (!rows.length) continue;
    const filter = JSON.parse(rows[0].filter || '{}');
    filter.categories = [...new Set([...(filter.categories ?? []), ...categories])];
    await db.execute('UPDATE dashboards SET filter = $1 WHERE id = $2', [JSON.stringify(filter), dashboard]);
  }
}

/* -- build ------------------------------------------------------------- */

export async function buildSeed(opts) {
  if (existsSync(opts.out) && !opts.force) {
    throw new Error(`${opts.out} already exists (pass --force to replace it)`);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'emerald-seed-'));
  // The staging database lives next to the output, not in workDir: Windows
  // keeps the file handle for a while after close(), and a workDir holding a
  // SQLite file cannot be removed reliably at the end. workDir therefore only
  // ever contains esbuild artefacts.
  mkdirSync(dirname(opts.out), { recursive: true });
  const stagingPath = join(dirname(opts.out), `.emerald-seed-${process.pid}.db`);
  let db = null;
  try {
    const app = await loadAppModules(opts.checkout, workDir);
    const fixture = fitFixture(withFreshTrash(withUuids(JSON.parse(readFileSync(opts.fixture, 'utf-8')))), app.TABLES);

    db = new HarnessDb(stagingPath);
    // Match what the app opens with; a WAL sidecar would be left behind here.
    await db.execute('PRAGMA journal_mode = DELETE');
    await db.execute('PRAGMA foreign_keys = ON');

    await app.createSchema(db);
    await app.seedBuiltins(db, starterNamer(opts.checkout, opts.locale));

    const report = { counts: {}, dropped: {} };
    // Without entry types a chip names its target kind: an entry, or a task.
    const chipHtml = fixture._typelessChips
      ? (chip) => app.internalLinkChipHtml({ ...chip, entryType: chip.entryType === 'task' ? 'task' : 'entry' })
      : app.internalLinkChipHtml;

    // TABLES order is dependency order: parents before children, and it has to
    // be followed exactly - task_links comes after tasks for a reason.
    // schema_version is stamped separately at the end.
    for (const table of app.TABLES) {
      if (table === 'schema_version') continue;
      if (table === 'tasks') {
        await insertTasks(db, fixture.tasks ?? [], chipHtml, report);
        continue;
      }
      await insertRows(db, table, fixture[table], chipHtml, report, app);
    }

    await fitDashboards(db, fixture);

    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1, $2, $3)',
      [app.BASELINE_VERSION, 'baseline', new Date().toISOString()]
    );

    const violations = db.raw.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) {
      throw new Error('seed violates foreign keys: ' + JSON.stringify(violations));
    }
    const orphans = await app.checkIntegrity(db);
    db.close();
    db = null;

    if (opts.verify) await verifyNoMigrations(app, stagingPath);

    rmSync(opts.out, { force: true });
    renameSync(stagingPath, opts.out);

    return {
      out: opts.out,
      baseline_version: app.BASELINE_VERSION,
      counts: report.counts,
      dropped_columns: report.dropped,
      dangling_references: orphans.length,
      verified: opts.verify,
    };
  } finally {
    // Cleanup must never throw: it runs while a real error is unwinding, and
    // an EBUSY here would replace that error with a far less useful one. The
    // close is what makes the staging file removable in the first place.
    if (db) { try { db.close(); } catch { /* already closed */ } }
    discard(workDir, { recursive: true });
    discard(stagingPath); // only present when the build threw before the rename
  }
}

function discard(path, extra = {}) {
  try {
    rmSync(path, { force: true, maxRetries: 10, retryDelay: 100, ...extra });
  } catch (err) {
    console.error(`warning: could not remove ${path}: ${err.code ?? err.message}`);
  }
}

/**
 * The seed claims to be current. Prove it: runMigrations must apply nothing
 * and leave the version untouched. Run against the staging file itself - if a
 * migration did fire it would mutate it, but that is the failure we are
 * looking for and the file is discarded either way.
 */
async function verifyNoMigrations(app, stagingPath) {
  const probe = new HarnessDb(stagingPath);
  let before, after, version;
  try {
    before = probe.raw.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n;
    await app.runMigrations(probe);
    after = probe.raw.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n;
    version = probe.raw.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
  } finally {
    probe.close();
  }
  if (after !== before) {
    throw new Error(`seed is not at baseline: runMigrations applied ${after - before} migration(s)`);
  }
  if (version !== app.BASELINE_VERSION) {
    throw new Error(`seed stamped v${version}, expected v${app.BASELINE_VERSION}`);
  }
}

// Importable as a module (provision.mjs uses it) and runnable as a CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSeed(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
