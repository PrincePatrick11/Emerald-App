/**
 * Asserts that a built seed database is one the app will actually open.
 *
 * build_seed.mjs already proves the important structural property - that
 * runMigrations applies nothing to it. This checks the things that would still
 * let a "successful" build produce a useless vault: no content, no trash to
 * test against, link chips left as raw placeholder text.
 *
 *   node check_seed.mjs <path to emerald.db>
 *
 * Only for a plain database — what build_seed.mjs writes. A checkout with
 * vault encryption encrypts the seed on its first start (see the README),
 * and node:sqlite cannot read it after that.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node check_seed.mjs <emerald.db>');
  process.exit(2);
}

if (!readFileSync(path).subarray(0, 15).equals(Buffer.from('SQLite format 3'))) {
  console.error('not a plain SQLite file — the app has encrypted this seed already (see README, "Seed vault")');
  process.exit(2);
}

const db = new DatabaseSync(path);
const q = (sql) => db.prepare(sql).all();
const one = (sql) => q(sql)[0];

let failed = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!condition) failed++;
}

const version = one('SELECT MAX(version) AS v FROM schema_version').v;
check('stamped at a baseline version', typeof version === 'number' && version > 0, `v${version}`);
check('exactly one schema_version row', one('SELECT COUNT(*) AS n FROM schema_version').n === 1);
check('no foreign key violations', q('PRAGMA foreign_key_check').length === 0);

const tables = q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .map((r) => r.name);
// Since v49 journal entries, wiki articles and operations share one `entries`
// table; before that each had its own. Both are a valid seed, for the
// checkout it was built from.
const unified = tables.includes('entries');
const modules = unified
  ? ['journal', 'wiki', 'operation'].map((type) => [type, `entries WHERE type = '${type}'`, 'AND'])
  : ['journal_entries', 'wiki_articles', 'operations'].map((table) => [table, table, 'WHERE']);

check('the sigil category is there', one("SELECT COUNT(*) AS n FROM categories WHERE id = 'sigils'").n === 1);
if (unified) check('an altar is there, an operation of the altars', one("SELECT COUNT(*) AS n FROM entries WHERE category_id = 'altars' AND content LIKE '%core.altar%'").n >= 1);
if (tables.includes('images')) {
  const pictures = one("SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL").n;
  check('Images has pictures', pictures >= 3, `${pictures}`);
  check('Images has a trashed picture', one("SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NOT NULL").n >= 1);
  check('some pictures carry the tag Altar Library',
    one("SELECT COUNT(*) AS n FROM images WHERE tags LIKE '%\"altar-library\"%'").n >= 2);
  check('every picture names a stored file', q('SELECT file FROM images').every((r) => /^[0-9a-f]{64}\.(png|jpe?g|gif|webp|svg)$/.test(r.file)));
}
if (tables.includes('symbols')) check('an own symbol is there', one('SELECT COUNT(*) AS n FROM symbols').n >= 1);
if (unified) {
  check('a canvas block is there', one("SELECT COUNT(*) AS n FROM entries WHERE content LIKE '%core.canvas%'").n >= 1);
  check('a painting block is there', one("SELECT COUNT(*) AS n FROM entries WHERE content LIKE '%core.paint%'").n >= 1);
}

// A vault with an empty module renders an empty screen, which is exactly what
// the seed exists to avoid.
for (const [label, from] of modules) {
  const n = one(`SELECT COUNT(*) AS n FROM ${from}`).n;
  check(`${label} has content`, n > 0, `${n} rows`);
}
for (const table of ['tasks', 'tags', 'categories']) {
  const n = one(`SELECT COUNT(*) AS n FROM ${table}`).n;
  check(`${table} has content`, n > 0, `${n} rows`);
}

// Trash needs something in it, or the trash view cannot be tested without
// deleting something first.
for (const [label, from, and] of modules) {
  const n = one(`SELECT COUNT(*) AS n FROM ${from} ${and} deleted_at IS NOT NULL`).n;
  check(`${label} has a trashed row`, n >= 1, `${n}`);
}
for (const table of ['tags', 'categories', 'tasks']) {
  const n = one(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NOT NULL`).n;
  check(`${table} has a trashed row`, n >= 1, `${n}`);
}
// Older than the trash retention and the app purges them as soon as it opens
// the vault. 7 days is the shortest retention a vault can be set to.
const trashDates = [
  ...modules.map(([, from, and]) => `${from} ${and} deleted_at IS NOT NULL`),
  ...['tags', 'categories', 'tasks'].map((table) => `${table} WHERE deleted_at IS NOT NULL`),
].flatMap((where) => q(`SELECT deleted_at FROM ${where}`).map((r) => Date.parse(r.deleted_at)));
const oldest = trashDates.length ? Math.min(...trashDates) : NaN;
check('trashed rows are recent enough to survive the purge',
  Date.now() - oldest < 7 * 24 * 60 * 60 * 1000, Number.isNaN(oldest) ? 'none' : new Date(oldest).toISOString());

const contents = q(modules.map(([, from]) => `SELECT content FROM ${from}`).join(' UNION ALL '))
  .map((r) => String(r.content ?? ''));

if (unified) {
  // Tags are referenced by id there; a name left in the list matches nothing.
  const tagIds = new Set(q('SELECT id FROM tags').map((r) => r.id));
  const used = q("SELECT tags FROM entries WHERE tags != '[]'").flatMap((r) => JSON.parse(r.tags));
  check('entries carry tags', used.length > 0, `${used.length}`);
  check('every entry tag is a tag id', used.every((id) => tagIds.has(id)));
}
check('internal link chips rendered',
  contents.some((c) => c.includes('data-type="internalLink"')));
check('no unexpanded @@chip() placeholders',
  !contents.some((c) => c.includes('@@chip(')));
check('no unexpanded @@file() placeholders',
  !contents.some((c) => c.includes('@@file(')) && !(tables.includes('images') && q('SELECT file FROM images').some((r) => r.file.includes('@@file('))));

// The app follows a link only to a UUID (isValidLinkTarget in
// src/lib/internalLinkHtml.ts); a readable id would make every chip dead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The altar tables went with v63; an older checkout's seed still has them.
const linkable = [...modules.map(([, from]) => from), 'tasks', ...(tables.includes('altars') ? ['altars'] : [])]
  .flatMap((from) => q(`SELECT id FROM ${from}`).map((r) => r.id));
const badIds = linkable.filter((id) => !UUID_RE.test(id));
check('every linkable row has a UUID', badIds.length === 0, badIds.slice(0, 3).join(', '));
const chipIds = contents.flatMap((c) => [...c.matchAll(/data-id="([^"]*)"/g)].map((m) => m[1]));
const linkableSet = new Set(linkable);
check('every link chip points at an existing row',
  chipIds.every((id) => linkableSet.has(id)), `${chipIds.length} chips`);

check('a subtask points at its parent',
  one('SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id IS NOT NULL').n >= 1);

db.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
