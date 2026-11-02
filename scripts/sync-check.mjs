/**
 * Proves that devices syncing through a server end up with the same rows,
 * against the real schema and the real migration runner.
 *
 * A server here is what the real one will be: an ordered list that refuses a
 * push from a device that has not seen all of it.
 *
 * Runs against `node:sqlite`, like `check:schema`, so no Tauri is needed.
 *
 *   npm run check:sync
 */
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workDir = mkdtempSync(join(tmpdir(), 'emerald-sync-'));
process.env.EMERALD_HARNESS_DIR = workDir;

class HarnessDb {
  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');
  }
  async execute(sql, params = []) {
    if (!params.length) {
      this.raw.exec(sql);
      return { rowsAffected: 0 };
    }
    const info = this.raw.prepare(sql.replace(/\$(\d+)/g, '?$1')).run(...params);
    return { rowsAffected: Number(info.changes ?? 0) };
  }
  async select(sql, params = []) {
    return this.raw.prepare(sql.replace(/\$(\d+)/g, '?$1')).all(...params);
  }
  async batch(statements) {
    this.raw.exec('BEGIN');
    try {
      for (const [sql, params = []] of statements) await this.execute(sql, params);
      this.raw.exec('COMMIT');
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }
}

const STUBS = {
  '@tauri-apps/api/core': `export async function invoke(cmd) {
    if (cmd === 'legacy_default_db_exists') return true;
    if (cmd === 'migrate_vault_layout' || cmd === 'default_vault_dir' || cmd === 'new_vault_base_dir') return process.env.EMERALD_HARNESS_DIR;
    return undefined;
  }`,
  '@tauri-apps/api/path': 'export async function appDataDir() { return process.env.EMERALD_HARNESS_DIR; }',
};
const stubPlugin = {
  name: 'tauri-stubs',
  setup(b) {
    b.onResolve({ filter: /^@tauri-apps\/api\/(core|path)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};
const root = process.cwd().replace(/\\/g, '/');
const entry = join(workDir, 'entry.ts');
writeFileSync(
  entry,
  `export { runMigrations } from '${root}/src/lib/db';
   export { BASELINE_VERSION, TABLES, TABLE_DDL, INDEX_DDL } from '${root}/src/lib/schema';
   export * from '${root}/src/lib/sync/tracking';
   export * from '${root}/src/lib/sync/apply';
   export * from '${root}/src/lib/sync/settings';`
);
const bundlePath = join(workDir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundlePath, plugins: [stubPlugin], logLevel: 'warning' });

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator ??= { language: 'en' };
const sync = await import(pathToFileURL(bundlePath).href);
const {
  SYNCED_TABLES, TABLES, TABLE_DDL, INDEX_DDL, BASELINE_VERSION,
  startTracking, stopTracking, isTracked, needsSnapshot, clearSnapshotNeeded, markSnapshotNeeded,
  collectChanges, acknowledge, pendingRows, dropTriggers, installTriggers, applyRemoteChanges, runMigrations,
  flattenSettings, settingsDiff, mergeIncomingSettings, snapshotFrames, replaceWithSnapshot, beginRestore, restoreFrame, isRestoring, acknowledgeChanges, positionStatements, readPosition,
} = sync;

const NOW = '2026-11-01T00:00:00.000Z';
const allFrames = async (db, maxBytes = 1000) => { const out = []; for await (const f of snapshotFrames(db, maxBytes)) out.push(JSON.parse(JSON.stringify(f))); return out; };
let copies = 0;
const OPTIONS = { newId: () => `copy-${++copies}`, conflictTitle: (t) => `${t} (conflict)` };

class Server {
  log = [];
}

class Device {
  cursor = 0;
  constructor(server) {
    this.server = server;
    this.db = new HarnessDb();
  }
  run(sql, ...params) {
    return this.db.raw.prepare(sql).run(...params);
  }
  get(sql, ...params) {
    return this.db.raw.prepare(sql).get(...params);
  }
  /** Pull, resolve, push; the same order the real client will use. */
  async sync() {
    const { log } = this.server;
    const result = await applyRemoteChanges(this.db, log.slice(this.cursor), OPTIONS);
    this.cursor = log.length;
    for (;;) {
      const { changes, lastSeq, done } = await collectChanges(this.db, this.maxBytes);
      log.push(...changes);
      this.cursor = log.length;
      await acknowledgeChanges(this.db, changes, lastSeq);
      if (done) {
        await acknowledge(this.db, lastSeq);
        return result;
      }
    }
  }
  maxBytes = Infinity;
  dump() {
    return Object.fromEntries(SYNCED_TABLES.map((t) => [t, this.db.raw.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
  }
}

async function makeDevice(server) {
  const device = new Device(server);
  for (const table of TABLES) device.db.raw.exec(TABLE_DDL[table]);
  for (const index of INDEX_DDL) device.db.raw.exec(index);
  await startTracking(device.db);
  await clearSnapshotNeeded(device.db);
  return device;
}

async function pair() {
  const server = new Server();
  return [server, await makeDevice(server), await makeDevice(server)];
}

/** Everybody pulls until nothing moves, then all must hold the same rows. */
async function assertConverged(...devices) {
  for (let round = 0; round < 3; round++) for (const d of devices) await d.sync();
  const [first, ...rest] = devices;
  for (const other of rest) assert.deepEqual(other.dump(), first.dump());
  for (const d of devices) {
    assert.deepEqual(d.db.raw.prepare('PRAGMA foreign_key_check').all(), [], 'dangling reference');
    assert.equal((await pendingRows(d.db)).length, 0, 'nothing left to push');
  }
}

const entry_ = (d, id, n, fields = {}) =>
  d.run(
    'INSERT INTO entries (id, type, title, content, entry_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, fields.type ?? 'journal', fields.title ?? '', fields.content ?? '', n, NOW, NOW
  );

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok ${name}`);
}

console.log('Capture');

await test('a plain write reaches the other device', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO categories (id, name) VALUES ('c', 'Cat')");
  entry_(a, 'e', 1, { title: 'T', content: '<p>x</p>' });
  a.run("UPDATE entries SET category_id = NULL, title = 'U' WHERE id = 'e'");
  await assertConverged(a, b);
  assert.equal(b.get("SELECT title FROM entries WHERE id = 'e'").title, 'U');
});

await test('what a device applies does not come back from it', async () => {
  const [server, a, b] = await pair();
  entry_(a, 'e', 1);
  await a.sync();
  const before = server.log.length;
  await b.sync();
  assert.equal(server.log.length, before);
  assert.equal(b.get('SELECT count(*) c FROM _sync_log').c, 0);
});

await test('a whole-row write that changes nothing is not logged', async () => {
  const [, a] = await pair();
  entry_(a, 'e', 1);
  await a.sync();
  a.run("UPDATE entries SET title = title, content = content WHERE id = 'e'");
  assert.equal((await pendingRows(a.db)).length, 0);
});

await test('many saves of one entry fold into one change', async () => {
  const [, a] = await pair();
  entry_(a, 'e', 1);
  await a.sync();
  for (let i = 0; i < 50; i++) a.run("UPDATE entries SET content = ? WHERE id = 'e'", `<p>${i}</p>`);
  const { changes } = await collectChanges(a.db);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changed, ['content']);
  assert.equal(changes[0].row.content, '<p>49</p>');
  assert.equal(a.get('SELECT count(*) c FROM _sync_log').c, 50);
});

await test('the log stores names, not values', async () => {
  const [, a] = await pair();
  entry_(a, 'e', 1, { content: 'secret-text' });
  a.run("UPDATE entries SET content = 'more-secret-text' WHERE id = 'e'");
  assert.ok(!JSON.stringify(a.db.raw.prepare('SELECT * FROM _sync_log').all()).includes('secret'));
});

await test('created and deleted between two pushes tells nobody', async () => {
  const [server, a] = await pair();
  entry_(a, 'e', 1);
  a.run("DELETE FROM entries WHERE id = 'e'");
  await a.sync();
  assert.equal(server.log.length, 0);
});

await test('delete and undo between two pushes keeps the row', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1, { title: 'T' });
  await assertConverged(a, b);
  const row = a.get("SELECT * FROM entries WHERE id = 'e'");
  a.run("DELETE FROM entries WHERE id = 'e'");
  entry_(a, 'e', row.entry_number, { title: 'Back' });
  await assertConverged(a, b);
  assert.equal(b.get("SELECT title FROM entries WHERE id = 'e'").title, 'Back');
});

await test('foreign key actions travel', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('p', 'P', ?, ?)", NOW, NOW);
  a.run("INSERT INTO tasks (id, title, parent_task_id, created_at, updated_at) VALUES ('k', 'K', 'p', ?, ?)", NOW, NOW);
  a.run("INSERT INTO task_links (id, task_id, target_id, target_type) VALUES ('l', 'p', 'x', 'journal')");
  a.run("INSERT INTO altars (id, title, created_at, updated_at) VALUES ('a', 'A', ?, ?)", NOW, NOW);
  a.run("INSERT INTO altar_items (id, name, created_at) VALUES ('i', 'I', ?)", NOW);
  a.run("INSERT INTO altar_placements (id, altar_id, item_id) VALUES ('pl', 'a', 'i')");
  await assertConverged(a, b);
  a.run("DELETE FROM tasks WHERE id = 'p'");
  a.run("DELETE FROM altars WHERE id = 'a'");
  await assertConverged(a, b);
  assert.equal(b.get("SELECT parent_task_id p FROM tasks WHERE id = 'k'").p, null);
  assert.equal(b.get('SELECT count(*) c FROM altar_placements').c, 0);
});

console.log('Conflicts between two devices');

await test('different columns of one row both survive', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1, { title: 'T' });
  await assertConverged(a, b);
  a.run("UPDATE entries SET title = 'from A' WHERE id = 'e'");
  b.run("UPDATE entries SET icon = 'leaf' WHERE id = 'e'");
  await a.sync();
  await assertConverged(a, b);
  const row = a.get("SELECT title, icon FROM entries WHERE id = 'e'");
  assert.deepEqual({ ...row }, { title: 'from A', icon: 'leaf' });
});

await test('both changed the text: nothing is lost', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1, { title: 'T', content: '<p>base</p>' });
  await assertConverged(a, b);
  a.run("UPDATE entries SET content = '<p>A</p>' WHERE id = 'e'");
  b.run("UPDATE entries SET content = '<p>B</p>' WHERE id = 'e'");
  await a.sync();
  const { conflicts } = await b.sync();
  assert.equal(conflicts.length, 1);
  await assertConverged(a, b);
  const texts = a.db.raw.prepare('SELECT content FROM entries ORDER BY content').all().map((r) => r.content);
  assert.deepEqual(texts, ['<p>A</p>', '<p>B</p>']);
  const copy = a.get('SELECT title, entry_number n FROM entries WHERE id = ?', conflicts[0].copyId);
  assert.equal(copy.title, 'T (conflict)');
  assert.notEqual(copy.n, 1);
});

await test('both wrote the same text: no conflict', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1);
  await assertConverged(a, b);
  a.run("UPDATE entries SET content = 'same' WHERE id = 'e'");
  b.run("UPDATE entries SET content = 'same' WHERE id = 'e'");
  await a.sync();
  assert.equal((await b.sync()).conflicts.length, 0);
  await assertConverged(a, b);
});

await test('a short field both changed: the later push stands', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1);
  await assertConverged(a, b);
  a.run("UPDATE entries SET title = 'A' WHERE id = 'e'");
  b.run("UPDATE entries SET title = 'B' WHERE id = 'e'");
  await a.sync();
  await b.sync();
  await assertConverged(a, b);
  assert.equal(a.get("SELECT title FROM entries WHERE id = 'e'").title, 'B');
});

await test('edited here, deleted there: the edit keeps the row', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1, { title: 'T', content: 'text' });
  await assertConverged(a, b);
  a.run("DELETE FROM entries WHERE id = 'e'");
  b.run("UPDATE entries SET title = 'edited' WHERE id = 'e'");
  await a.sync();
  await b.sync();
  await assertConverged(a, b);
  const row = a.get("SELECT title, content FROM entries WHERE id = 'e'");
  assert.deepEqual({ ...row }, { title: 'edited', content: 'text' });
});

await test('deleted here, edited there: the edit brings the row back', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1, { title: 'T', content: 'text' });
  await assertConverged(a, b);
  b.run("UPDATE entries SET title = 'edited' WHERE id = 'e'");
  a.run("DELETE FROM entries WHERE id = 'e'");
  await b.sync();
  await a.sync();
  await assertConverged(a, b);
  const row = b.get("SELECT title, content FROM entries WHERE id = 'e'");
  assert.deepEqual({ ...row }, { title: 'edited', content: 'text' });
});

await test('both deleted', async () => {
  const [, a, b] = await pair();
  entry_(a, 'e', 1);
  await assertConverged(a, b);
  a.run("DELETE FROM entries WHERE id = 'e'");
  b.run("DELETE FROM entries WHERE id = 'e'");
  await assertConverged(a, b);
});

await test('same new tag name: merged, and entries follow', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO tags (id, name) VALUES ('ta', 'same')");
  b.run("INSERT INTO tags (id, name) VALUES ('tb', 'same')");
  entry_(b, 'e', 1);
  b.run(`UPDATE entries SET tags = '["tb"]' WHERE id = 'e'`);
  await a.sync();
  await assertConverged(a, b);
  assert.equal(a.get('SELECT count(*) c FROM tags').c, 1);
  assert.equal(a.get("SELECT tags FROM entries WHERE id = 'e'").tags, '["ta"]');
});

await test('same entry number: one moves on', async () => {
  const [, a, b] = await pair();
  entry_(a, 'x', 7);
  entry_(b, 'y', 7);
  await a.sync();
  await assertConverged(a, b);
  const numbers = a.db.raw.prepare('SELECT entry_number n FROM entries ORDER BY n').all().map((r) => r.n);
  assert.equal(new Set(numbers).size, 2);
});

await test('same task link: one survives', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t', 'T', ?, ?)", NOW, NOW);
  await assertConverged(a, b);
  a.run("INSERT INTO task_links (id, task_id, target_id, target_type) VALUES ('la', 't', 'x', 'journal')");
  b.run("INSERT INTO task_links (id, task_id, target_id, target_type) VALUES ('lb', 't', 'x', 'journal')");
  await a.sync();
  await assertConverged(a, b);
  assert.equal(a.get('SELECT count(*) c FROM task_links').c, 1);
});

await test('moved into a category the other device deleted', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO categories (id, name) VALUES ('c', 'Cat')");
  entry_(a, 'e', 1, { type: 'wiki' });
  await assertConverged(a, b);
  a.run("DELETE FROM categories WHERE id = 'c'");
  b.run("UPDATE entries SET category_id = 'c' WHERE id = 'e'");
  await a.sync();
  await assertConverged(a, b);
  assert.equal(a.get('SELECT count(*) c FROM categories').c, 0);
  assert.equal(b.get("SELECT category_id c FROM entries WHERE id = 'e'").c, null);
});

await test('a placement on an altar the other device deleted', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO altars (id, title, created_at, updated_at) VALUES ('a', 'A', ?, ?)", NOW, NOW);
  a.run("INSERT INTO altar_items (id, name, created_at) VALUES ('i', 'I', ?)", NOW);
  await assertConverged(a, b);
  a.run("DELETE FROM altars WHERE id = 'a'");
  b.run("INSERT INTO altar_placements (id, altar_id, item_id) VALUES ('pl', 'a', 'i')");
  await a.sync();
  await assertConverged(a, b);
  assert.equal(a.get('SELECT count(*) c FROM altar_placements').c, 0);
});

await test('data from another version is refused before anything is written', async () => {
  const [, a] = await pair();
  const bad = [{ table: 'entries; DROP TABLE tags', id: 'x', op: 'delete' }];
  await assert.rejects(applyRemoteChanges(a.db, bad, OPTIONS), /SYNC_UNKNOWN_SHAPE/);
  const column = [{ table: 'tags', id: 'x', op: 'upsert', changed: ['evil'], row: { id: 'x', evil: 1 } }];
  await assert.rejects(applyRemoteChanges(a.db, column, OPTIONS), /SYNC_UNKNOWN_SHAPE/);
});

await test('a failed apply leaves log and rows as they were', async () => {
  const [, a] = await pair();
  entry_(a, 'e', 1);
  const before = a.db.raw.prepare('SELECT * FROM _sync_log').all();
  const bad = [
    { table: 'tags', id: 't', op: 'upsert', changed: ['id', 'name'], row: { id: 't', name: 'n' } },
    { table: 'entries', id: 'z', op: 'upsert', changed: ['id'], row: { id: 'z', type: 'not-a-type' } },
  ];
  await assert.rejects(applyRemoteChanges(a.db, bad, OPTIONS));
  assert.deepEqual(a.db.raw.prepare('SELECT * FROM _sync_log').all(), before);
  assert.equal(a.get('SELECT count(*) c FROM tags').c, 0);
  assert.equal(a.get('SELECT applying FROM _sync_ctx').applying, 0);
});

console.log('Snapshots');

await test('a new device starts from a snapshot and goes on from there', async () => {
  const [server, a] = await pair();
  entry_(a, 'e', 1, { title: 'T' });
  await a.sync();
  const b = await makeDevice(server);
  b.run("INSERT INTO categories (id, name) VALUES ('seeded', 'Starter')");
  await replaceWithSnapshot(b.db, await allFrames(a.db), [], positionStatements({ cursor: server.log.length, epoch: 3 }));
  b.cursor = server.log.length;
  assert.equal(b.get('SELECT count(*) c FROM categories').c, 0, 'the seeded row is gone');
  assert.equal(b.get('SELECT count(*) c FROM _sync_log').c, 0, 'restoring logs nothing');
  assert.deepEqual({ ...(await readPosition(b.db)) }, { cursor: server.log.length, epoch: 3 });
  await assertConverged(a, b);
  b.run("UPDATE entries SET title = 'later' WHERE id = 'e'");
  await assertConverged(a, b);
  assert.equal(a.get("SELECT title FROM entries WHERE id = 'e'").title, 'later');
});

await test('starting over keeps what this device had not pushed', async () => {
  const [server, a, b] = await pair();
  entry_(a, 'e', 1, { title: 'T' });
  entry_(a, 'gone', 2);
  await assertConverged(a, b);
  a.run("UPDATE entries SET icon = 'from-snapshot' WHERE id = 'e'");
  await a.sync();
  b.run("UPDATE entries SET title = 'mine' WHERE id = 'e'");
  entry_(b, 'new', 3);
  b.run("DELETE FROM entries WHERE id = 'gone'");
  const { changes } = await collectChanges(b.db);
  await replaceWithSnapshot(b.db, await allFrames(a.db), changes, positionStatements({ cursor: server.log.length }));
  b.cursor = server.log.length;
  const row = b.get("SELECT title, icon FROM entries WHERE id = 'e'");
  assert.deepEqual({ ...row }, { title: 'mine', icon: 'from-snapshot' });
  await assertConverged(a, b);
  assert.equal(a.get("SELECT count(*) c FROM entries WHERE id IN ('new', 'gone')").c, 1);
});

await test('a kept row that no longer fits gives way', async () => {
  const [, a, b] = await pair();
  a.run("INSERT INTO tags (id, name) VALUES ('ta', 'same')");
  b.run("INSERT INTO tags (id, name) VALUES ('tb', 'same')");
  const { changes } = await collectChanges(b.db);
  await replaceWithSnapshot(b.db, await allFrames(a.db), changes, []);
  assert.equal(b.get('SELECT count(*) c FROM tags').c, 1);
});

await test('a large snapshot comes in pieces, parents first, tasks together', async () => {
  const [, a] = await pair();
  a.run("INSERT INTO categories (id, name) VALUES ('c', 'Cat')");
  for (let i = 0; i < 50; i++) entry_(a, `e${i}`, i + 1, { content: 'x'.repeat(500) });
  a.run("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('z-parent', 'P', ?, ?)", NOW, NOW);
  a.run("INSERT INTO tasks (id, title, parent_task_id, created_at, updated_at) VALUES ('a-child', 'K', 'z-parent', ?, ?)", NOW, NOW);
  const frames = await allFrames(a.db, 2000);
  assert.ok(frames.filter((f) => f.table === 'entries').length > 5);
  assert.equal(frames.filter((f) => f.table === 'tasks').length, 1);
  const tables = frames.map((f) => f.table);
  assert.ok(tables.indexOf('categories') < tables.indexOf('entries'));
  const b = await makeDevice(new Server());
  await replaceWithSnapshot(b.db, frames, [], []);
  assert.deepEqual(b.dump(), a.dump());
});

await test('a restore that stops halfway says so', async () => {
  const [, a] = await pair();
  for (let i = 0; i < 20; i++) entry_(a, `e${i}`, i + 1, { content: 'x'.repeat(500) });
  const frames = await allFrames(a.db, 2000);
  const b = await makeDevice(new Server());
  await beginRestore(b.db);
  await restoreFrame(b.db, frames.find((f) => f.table === 'entries'));
  assert.equal(await isRestoring(b.db), true);
  await replaceWithSnapshot(b.db, frames, [], []);
  assert.equal(await isRestoring(b.db), false);
  assert.deepEqual(b.dump(), a.dump());
});

await test('a child read after its parent frame loses nothing once the log arrives', async () => {
  const [server, a] = await pair();
  a.run("INSERT INTO categories (id, name) VALUES ('old', 'Old')");
  entry_(a, 'e', 1, { type: 'wiki' });
  await a.sync();
  const frames = await allFrames(a.db);
  // Written while the snapshot was being read: the entry frame knows a category the categories frame does not.
  a.run("INSERT INTO categories (id, name) VALUES ('new', 'New')");
  a.run("UPDATE entries SET category_id = 'new' WHERE id = 'e'");
  frames.find((f) => f.table === 'entries').rows[0].category_id = 'new';
  const b = await makeDevice(server);
  await replaceWithSnapshot(b.db, frames, [], []);
  b.cursor = server.log.length;
  await assertConverged(a, b);
  assert.equal(b.get("SELECT category_id c FROM entries WHERE id = 'e'").c, 'new');
});

console.log('Settings');

await test('settings merge key by key, and this device keeps what it changed', async () => {
  const start = { version: 1, appearance: { theme: 'a', uiFont: 'x', uiScale: 100 }, trash: { retentionDays: 30 } };
  const base = flattenSettings(start);
  assert.equal('appearance.uiScale' in base, false, 'the scale belongs to the screen');
  assert.equal('version' in base, false);
  const mine = structuredClone(start);
  mine.appearance.theme = 'mine';
  mine.appearance.uiScale = 150;
  assert.deepEqual(settingsDiff(base, flattenSettings(mine)), { 'appearance.theme': 'mine' });
  const merged = mergeIncomingSettings(mine, base, { 'appearance.theme': 'theirs', 'appearance.uiFont': 'y', 'trash.retentionDays': null, 'appearance.uiScale': 90 });
  assert.equal(merged.changed, true);
  assert.equal(merged.settings.appearance.theme, 'mine');
  assert.equal(merged.settings.appearance.uiFont, 'y');
  assert.equal(merged.settings.appearance.uiScale, 150);
  assert.equal(merged.settings.trash.retentionDays, null);
  assert.deepEqual(settingsDiff(merged.base, flattenSettings(merged.settings)), { 'appearance.theme': 'mine' }, 'still goes out');
  assert.equal(mergeIncomingSettings(start, base, base).changed, false);
});

console.log('Long offline');

await test('many changes go out in parts, and references survive every part', async () => {
  const [server, a, b] = await pair();
  a.maxBytes = 300;
  a.run("INSERT INTO categories (id, name) VALUES ('c', 'Cat')");
  for (let i = 0; i < 30; i++) entry_(a, `e${i}`, i + 1, { content: 'x'.repeat(100) });
  a.db.raw.prepare("UPDATE entries SET category_id = 'c' WHERE id = 'e7'").run();
  a.run("UPDATE categories SET name = 'Renamed' WHERE id = 'c'");
  a.run("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('z', 'P', ?, ?)", NOW, NOW);
  a.run("INSERT INTO tasks (id, title, parent_task_id, created_at, updated_at) VALUES ('k', 'K', 'z', ?, ?)", NOW, NOW);
  a.run("INSERT INTO altars (id, title, created_at, updated_at) VALUES ('al', 'A', ?, ?)", NOW, NOW);
  // Large enough to end a part: a parent after it would come too late.
  a.run("INSERT INTO altar_items (id, name, created_at) VALUES ('it', ?, ?)", 'y'.repeat(400), NOW);
  a.run("INSERT INTO altar_placements (id, altar_id, item_id) VALUES ('pl', 'al', 'it')");
  // Applied part by part, as the server would hand them out one push at a time.
  let parts = 0;
  for (;;) {
    const { changes, lastSeq, done } = await collectChanges(a.db, a.maxBytes);
    await applyRemoteChanges(b.db, changes, OPTIONS);
    await acknowledgeChanges(a.db, changes, lastSeq);
    server.log.push(...changes);
    parts++;
    if (done) { await acknowledge(a.db, lastSeq); break; }
  }
  a.cursor = b.cursor = server.log.length;
  assert.ok(parts > 3, `${parts} parts`);
  assert.equal(b.get('SELECT count(*) c FROM _sync_log').c, 0, 'the receiver repaired nothing');
  assert.deepEqual(b.dump(), a.dump());
});

console.log('Migrations and untracked vaults');

await test('a vault that is not connected carries nothing', async () => {
  const db = new HarnessDb();
  await runMigrations(db);
  assert.equal(await isTracked(db), false);
  const names = db.raw.prepare('SELECT name FROM sqlite_master').all().map((r) => r.name);
  assert.deepEqual(names.filter((name) => name.startsWith('_sync_')), []);
});

await test('a pending migration runs under tracking and asks for a snapshot', async () => {
  const db = new HarnessDb();
  await runMigrations(db);
  await startTracking(db);
  await clearSnapshotNeeded(db);
  // One step behind: the last migration runs again.
  db.raw.prepare('UPDATE schema_version SET version = ?').run(BASELINE_VERSION - 1);
  db.raw.exec("INSERT INTO tags (id, name) VALUES ('t', 'before')");
  await runMigrations(db);
  assert.equal(await needsSnapshot(db), true);
  assert.equal((await pendingRows(db)).length, 0);
  db.raw.exec("INSERT INTO tags (id, name) VALUES ('u', 'after')");
  assert.equal((await pendingRows(db)).length, 1, 'triggers are back after the chain');
});

await test('DROP COLUMN works once the triggers are out, and new columns are tracked after', async () => {
  const db = new HarnessDb();
  await runMigrations(db);
  await startTracking(db);
  assert.throws(() => db.raw.exec('ALTER TABLE tasks DROP COLUMN sort_order'));
  await dropTriggers(db);
  db.raw.exec('ALTER TABLE tasks DROP COLUMN sort_order');
  db.raw.exec('ALTER TABLE tasks ADD COLUMN extra TEXT');
  await installTriggers(db);
  db.raw.exec("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t', 'T', 'x', 'x')");
  await markSnapshotNeeded(db);
  db.raw.exec("UPDATE tasks SET extra = 'y' WHERE id = 't'");
  assert.deepEqual((await pendingRows(db))[0].columns, ['extra']);
});

await test('stopping removes the tables and triggers', async () => {
  const db = new HarnessDb();
  await runMigrations(db);
  // SQLite keeps `sqlite_sequence` once AUTOINCREMENT was used; it cannot be dropped.
  const names = () => db.raw.prepare("SELECT name FROM sqlite_master WHERE name <> 'sqlite_sequence' ORDER BY name").all();
  const before = names();
  await startTracking(db);
  await stopTracking(db);
  assert.deepEqual(names(), before);
});

console.log('Random work on three devices');

/** Small, seeded generator, so a failure repeats. */
function randomizer(seed) {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0) / 2 ** 32);
  return { int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
}

async function randomRun(seed) {
  const r = randomizer(seed);
  const server = new Server();
  const devices = [await makeDevice(server), await makeDevice(server), await makeDevice(server)];
  if (seed % 2) for (const d of devices) d.maxBytes = 60;
  let counter = 0;
  const id = (kind) => `${kind}${seed}-${++counter}`;
  const ids = (d, table) => d.db.raw.prepare(`SELECT id FROM ${table}`).all().map((x) => x.id);
  const nextNumber = (d) => d.get('SELECT COALESCE(MAX(entry_number), 0) + 1 n FROM entries').n;
  const actions = [
    (d) => entry_(d, id('e'), nextNumber(d), { title: 't', content: `c${r.int(5)}` }),
    (d) => { const e = r.pick(ids(d, 'entries')); if (e) d.run('UPDATE entries SET content = ? WHERE id = ?', `c${r.int(1000)}`, e); },
    (d) => { const e = r.pick(ids(d, 'entries')); if (e) d.run('UPDATE entries SET title = ? WHERE id = ?', `t${r.int(1000)}`, e); },
    (d) => { const e = r.pick(ids(d, 'entries')); if (e) d.run('DELETE FROM entries WHERE id = ?', e); },
    (d) => { const e = r.pick(ids(d, 'entries')); if (e) d.run('UPDATE entries SET deleted_at = ? WHERE id = ?', NOW, e); },
    (d) => d.run('INSERT INTO categories (id, name) VALUES (?, ?)', id('c'), 'cat'),
    (d) => {
      const c = r.pick(ids(d, 'categories'));
      if (!c) return;
      for (const t of ['entries', 'tasks', 'altar_items']) d.run(`UPDATE ${t} SET category_id = NULL WHERE category_id = ?`, c);
      d.run('DELETE FROM categories WHERE id = ?', c);
    },
    (d) => { const e = r.pick(ids(d, 'entries')); const c = r.pick(ids(d, 'categories')); if (e && c) d.run('UPDATE entries SET category_id = ? WHERE id = ?', c, e); },
    (d) => d.run('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)', id('t'), `tag${r.int(4)}`),
    (d) => { const e = r.pick(ids(d, 'entries')); const t = r.pick(ids(d, 'tags')); if (e && t) d.run('UPDATE entries SET tags = ? WHERE id = ?', JSON.stringify([t]), e); },
    (d) => { const t = r.pick(ids(d, 'tags')); if (t) d.run('DELETE FROM tags WHERE id = ?', t); },
    (d) => d.run('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', id('k'), 'task', NOW, NOW),
    (d) => { const k = r.pick(ids(d, 'tasks')); const p = r.pick(ids(d, 'tasks')); if (k && p && k !== p) d.run('UPDATE tasks SET parent_task_id = ? WHERE id = ?', p, k); },
    (d) => { const k = r.pick(ids(d, 'tasks')); if (k) d.run('DELETE FROM tasks WHERE id = ?', k); },
    (d) => { const k = r.pick(ids(d, 'tasks')); if (k) d.run('INSERT OR IGNORE INTO task_links (id, task_id, target_id, target_type) VALUES (?, ?, ?, ?)', id('l'), k, `x${r.int(3)}`, 'journal'); },
    (d) => { d.run('INSERT INTO altars (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', id('a'), 'a', NOW, NOW); d.run('INSERT INTO altar_items (id, name, created_at) VALUES (?, ?, ?)', id('i'), 'i', NOW); },
    (d) => { const a = r.pick(ids(d, 'altars')); const i = r.pick(ids(d, 'altar_items')); if (a && i) d.run('INSERT INTO altar_placements (id, altar_id, item_id) VALUES (?, ?, ?)', id('p'), a, i); },
    (d) => { const a = r.pick(ids(d, 'altars')); if (a) d.run('DELETE FROM altars WHERE id = ?', a); },
    (d) => { const i = r.pick(ids(d, 'altar_items')); if (i) d.run('DELETE FROM altar_items WHERE id = ?', i); },
  ];
  for (let step = 0; step < 150; step++) {
    const device = r.pick(devices);
    if (r.int(4) === 0) await device.sync();
    else r.pick(actions)(device);
  }
  await assertConverged(...devices);
  const numbers = devices[0].db.raw.prepare('SELECT type, entry_number n, count(*) c FROM entries GROUP BY type, n HAVING c > 1').all();
  assert.deepEqual(numbers, [], `seed ${seed}: duplicate entry numbers`);
}

const SEEDS = 300;
await test(`${SEEDS} seeded runs converge with no dangling reference`, async () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    try {
      await randomRun(seed);
    } catch (err) {
      err.message = `seed ${seed}: ${err.message}`;
      throw err;
    }
  }
});

rmSync(workDir, { recursive: true, force: true });
console.log(`\ncheck:sync passed (${passed} tests)`);
