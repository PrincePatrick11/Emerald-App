// A dashboard filter that names categories that no longer exist shows nothing;
// only a filter without the rule shows everything. Run: node scripts/check-dashboard-filter.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The source imports without extensions: bundle it in memory instead of running it as is.
const { outputFiles } = await build({
  entryPoints: ['src/lib/dashboards.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
});
const code = outputFiles[0].text;
const { dashboardEntries, parseDashboardFilter } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const entry = (id, category_id, tags = []) => ({
  id, category_id, tags, title: id, created_at: '', updated_at: '', entry_number: 1,
});
const entries = [entry('a', 'c1', ['t1']), entry('b', null), entry('c', 'c2', ['t2'])];
const sort = { by: 'title', dir: 'asc' };
const ids = (filter, live) => dashboardEntries(entries, { filter, sort }, live).map((e) => e.id);

// No rule: everything.
const all = { categories: new Set(['c1', 'c2']), tags: new Set(['t1', 't2']) };
assert.deepEqual(ids({}, all), ['a', 'b', 'c']);
// The category is gone from the filter, which keeps an empty rule (as read back from the database).
assert.deepEqual(ids(parseDashboardFilter('{"categories":[],"tags":[]}'), all), []);
assert.deepEqual(ids(parseDashboardFilter('{"categories":[]}'), all), []);
// The category still named but gone or in the trash (not live): nothing.
assert.deepEqual(ids({ categories: ['c1'] }, { ...all, categories: new Set(['c2']) }), []);
assert.deepEqual(ids({ categories: ['gone'] }, all), []);
// A live one still passes.
assert.deepEqual(ids({ categories: ['c1'] }, { ...all, categories: new Set(['c1']) }), ['a']);
// Tags: a known one passes, an unknown one matches nothing.
assert.deepEqual(ids({ tags: ['t1'] }, all), ['a']);
assert.deepEqual(ids({ tags: ['gone'] }, all), []);
// A tag in the trash (not live) matches nothing; a purged one leaves an empty rule, which also matches nothing.
assert.deepEqual(ids({ tags: ['t1'] }, { ...all, tags: new Set(['t2']) }), []);
assert.deepEqual(ids(parseDashboardFilter('{"tags":[]}'), all), []);
console.log('dashboard filter check ok');
