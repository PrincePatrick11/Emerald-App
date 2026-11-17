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

// Entries have no type: a dashboard shows the categories of its filter.
const inDashboard = (id) =>
  `entries WHERE category_id IN (SELECT j.value FROM dashboards d, json_each(d.filter, '$.categories') j WHERE d.id = '${id}')`;
const dashboards = ['journal', 'knowledge', 'practice'].map((id) => [id, inDashboard(id)]);

/** Entries with a block of this type. */
const withBlock = (type, where = '1') =>
  one(`SELECT COUNT(DISTINCT e.id) AS n FROM entries e JOIN blocks b ON b.entry_id = e.id WHERE b.type = '${type}' AND ${where}`).n;

check('the sigil category is there', one("SELECT COUNT(*) AS n FROM categories WHERE id = 'sigils'").n === 1);
check('an altar is there, an entry of the category Altars', withBlock('core.altar', "e.category_id = 'altars'") >= 1);
check('the Dream Journal has an entry', one("SELECT COUNT(*) AS n FROM entries WHERE category_id = 'dreams'").n >= 1);
const pictures = one('SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL').n;
check('Images has pictures', pictures >= 3, `${pictures}`);
check('Images has a trashed picture', one('SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NOT NULL').n >= 1);
check('some pictures carry the tag Altar Library', one("SELECT COUNT(*) AS n FROM image_tags WHERE tag_id = 'altar-library'").n >= 2);
check('every picture names a stored file', q('SELECT file FROM images').every((r) => /^[0-9a-f]{64}\.(png|jpe?g|gif|webp|svg)$/.test(r.file)));
check('an own symbol is there', one('SELECT COUNT(*) AS n FROM symbols').n >= 1);
check('a template of its own is there', one("SELECT COUNT(*) AS n FROM templates WHERE id NOT LIKE 'core-%'").n >= 1);
check('a canvas block is there', withBlock('core.canvas') >= 1);
check('a painting block is there', withBlock('core.paint') >= 1);

// A dashboard without entries renders an empty screen, which is exactly what
// the seed exists to avoid.
for (const [label, from] of dashboards) {
  const n = one(`SELECT COUNT(*) AS n FROM ${from}`).n;
  check(`${label} has content`, n > 0, `${n} rows`);
}
for (const table of ['tasks', 'tags', 'categories']) {
  const n = one(`SELECT COUNT(*) AS n FROM ${table}`).n;
  check(`${table} has content`, n > 0, `${n} rows`);
}

// Trash needs something in it, or the trash view cannot be tested without
// deleting something first.
for (const [label, from] of dashboards) {
  const n = one(`SELECT COUNT(*) AS n FROM ${from} AND deleted_at IS NOT NULL`).n;
  check(`${label} has a trashed row`, n >= 1, `${n}`);
}
for (const table of ['tags', 'categories', 'tasks']) {
  const n = one(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NOT NULL`).n;
  check(`${table} has a trashed row`, n >= 1, `${n}`);
}
// Older than the trash retention and the app purges them as soon as it opens
// the vault. 7 days is the shortest retention a vault can be set to.
const trashDates = ['entries', 'tags', 'categories', 'tasks', 'images']
  .flatMap((table) => q(`SELECT deleted_at FROM ${table} WHERE deleted_at IS NOT NULL`).map((r) => Date.parse(r.deleted_at)));
const oldest = trashDates.length ? Math.min(...trashDates) : NaN;
check('trashed rows are recent enough to survive the purge',
  Date.now() - oldest < 7 * 24 * 60 * 60 * 1000, Number.isNaN(oldest) ? 'none' : new Date(oldest).toISOString());

const contents = q("SELECT html || ' ' || COALESCE(config, '') || ' ' || COALESCE(data, '') || ' ' || attrs AS content FROM blocks WHERE entry_id IS NOT NULL")
  .map((r) => String(r.content ?? ''));
const empty = one('SELECT COUNT(*) AS n FROM entries e WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.entry_id = e.id)').n;
check('every entry has its block rows', one('SELECT COUNT(*) AS n FROM blocks').n > 0 && empty === 0, `${empty} without`);

const tagIds = new Set(q('SELECT id FROM tags').map((r) => r.id));
const used = q('SELECT tag_id FROM entry_tags').map((r) => r.tag_id);
check('entries carry tags', used.length > 0, `${used.length}`);
check('every entry tag is a tag id', used.every((id) => tagIds.has(id)));
check('internal link chips rendered',
  contents.some((c) => c.includes('data-type="internalLink"')));
check('a link chip points at a task',
  contents.some((c) => c.includes('data-target-kind="task"')));
check('no unexpanded @@chip() placeholders',
  !contents.some((c) => c.includes('@@chip(')));
check('no unexpanded @@file() placeholders',
  !contents.some((c) => c.includes('@@file(')) && !q('SELECT file FROM images').some((r) => r.file.includes('@@file(')));

// The app follows a link only to a UUID (isValidLinkTarget in
// src/lib/internalLinkHtml.ts); a readable id would make every chip dead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linkable = ['entries', 'tasks'].flatMap((table) => q(`SELECT id FROM ${table}`).map((r) => r.id));
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
