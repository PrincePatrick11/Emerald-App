/**
 * Asserts that a built seed database is one the app will actually use
 * (Emerald 0.1.3.x schema).
 *
 * build_seed.mjs runs the app's own migrations, so the schema is right by
 * construction. This checks the things that would still let a "successful"
 * build produce a useless vault: no content, no trash to test against, link
 * chips or image placeholders left as raw text, images that don't exist.
 *
 *   node check_seed.mjs <path to emerald.db>
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node check_seed.mjs <emerald.db>');
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
check('migrated', typeof version === 'number' && version > 0, `v${version}`);
check('custom_properties has show_in_entry',
  q('PRAGMA table_info(custom_properties)').some((c) => c.name === 'show_in_entry'));
check('the sigil category is there', one("SELECT COUNT(*) AS n FROM operation_categories WHERE id = 'sigils'").n === 1);

const modules = ['journal_entries', 'wiki_articles', 'operations'];
for (const table of modules) {
  const live = one(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`).n;
  check(`${table} has content`, live > 0, `${live} rows`);
}
for (const table of ['journal_entries', 'wiki_articles']) {
  const trashed = one(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NOT NULL`).n;
  check(`${table} has a trashed row`, trashed >= 1, `${trashed}`);
}
for (const table of ['tags', 'links', 'altars']) {
  const n = one(`SELECT COUNT(*) AS n FROM ${table}`).n;
  check(`${table} has content`, n > 0, `${n} rows`);
}

const contents = q(modules.map((t) => `SELECT content FROM ${t}`).join(' UNION ALL ')).map((r) => String(r.content ?? ''));
check('no raw placeholders left', !contents.some((c) => c.includes('@@')));
check('internal-link chips present', contents.some((c) => c.includes('data-type="internalLink"')));

const images = [...new Set(contents.flatMap((c) => [...c.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1])))];
check('content references images', images.length > 0, `${images.length}`);
for (const src of images) check(`image exists: ${src.split(/[\\/]/).pop()}`, existsSync(src));

process.exit(failed ? 1 : 0);
