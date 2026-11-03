/**
 * Builds an emerald.db pre-filled with test data, headlessly (Emerald 0.1.3.x).
 *
 * The schema is not reproduced here. 0.1.3.x has no separate schema module:
 * the schema is whatever the migration chain in the checkout's own
 * `src/lib/db.ts` produces. This bundles that file and calls its real
 * `getDb()`, with `@tauri-apps/plugin-sql` replaced by a node:sqlite adapter,
 * so every migration runs exactly as it would on the app's first start. A
 * checkout that changed the schema therefore gets a seed for *its* schema.
 *
 * Test images are generated as PNG files into `--images`, the instance's
 * images dir: `read_image_as_base64` only reads from there, and entry content
 * references images by absolute path.
 *
 *   node build_seed.mjs --checkout <dir> --out <emerald.db> --images <dir>
 *                       [--fixture f.json] [--force]
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = join(HERE, 'fixture.json');

/* -- args ------------------------------------------------------------- */

export function parseArgs(argv) {
  const out = { fixture: DEFAULT_FIXTURE, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  for (const required of ['checkout', 'out', 'images']) {
    if (!out[required]) throw new Error(`--${required} is required`);
  }
  out.checkout = resolve(out.checkout);
  out.out = resolve(out.out);
  out.images = resolve(out.images);
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
      // exec() copes with PRAGMA and multi-statement strings; prepare().run() does not.
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

/* -- bundling the checkout's db.ts ------------------------------------- */

// `Database.load` hands out the harness database at EMERALD_HARNESS_DB;
// vaultManager's file access is answered so it falls back to its default
// vault (`emerald.db`) without touching the disk.
const STUBS = {
  '@tauri-apps/plugin-sql': `
    export default class Database {
      static async load() { return globalThis.__emeraldHarnessDb; }
    }`,
  '@tauri-apps/api/core': `
    export async function invoke(cmd) {
      if (cmd === 'read_file') throw new Error('ENOENT (seed builder)');
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

async function loadAppDb(checkout, workDir) {
  // esbuild comes from the checkout's node_modules (a dependency of Vite) -
  // the launcher runs `npm install` in a fresh checkout before getting here.
  const require_ = createRequire(join(checkout, 'package.json'));
  const { build } = await import(pathToFileURL(require_.resolve('esbuild')).href);

  const src = checkout.replace(/\\/g, '/') + '/src/lib';
  const entry = join(workDir, 'entry.ts');
  writeFileSync(entry, `export { getDb } from '${src}/db';`);

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

/* -- test images --------------------------------------------------------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A minimal RGBA PNG encoder; `pixel(x, y)` returns [r, g, b, a]. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic noise, so the same seed builds the same files. */
function noise(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

// `photo`: large and opaque with fine noise, so compression has something to
// do (several MB as PNG). `diagram`: small with a transparent background, the
// case where the no-WebP fallback must keep PNG.
const IMAGES = {
  photo: () => {
    const rnd = noise(7);
    return png(2400, 1600, (x, y) => {
      const n = (rnd() - 0.5) * 40;
      return [40 + (x / 2400) * 120 + n, 90 + (y / 1600) * 100 + n, 120 - (x / 2400) * 60 + n, 255];
    });
  },
  diagram: () => png(640, 480, (x, y) => {
    const dx = x - 320, dy = y - 240, d = Math.sqrt(dx * dx + dy * dy);
    if (Math.abs(d - 150) < 6 || (Math.abs(dx) < 4 && Math.abs(dy) < 150) || (Math.abs(dy) < 4 && Math.abs(dx) < 150)) {
      return [0, 160, 102, 255];
    }
    return [0, 0, 0, 0];
  }),
};

function writeImages(dir) {
  mkdirSync(dir, { recursive: true });
  const paths = {};
  for (const [name, make] of Object.entries(IMAGES)) {
    const path = join(dir, `seed-${name}.png`);
    writeFileSync(path, make());
    paths[name] = path;
  }
  return paths;
}

/* -- fixture ----------------------------------------------------------- */

/** The markup the editor's InternalLinkExtension writes for a link chip. */
function chipHtml(id, entryType, label) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<span data-type="internalLink" class="internal-link" data-id="${esc(id)}" data-entry-type="${esc(entryType)}" data-label="${esc(label)}">${esc(label)}</span>`;
}

function expand(value, images) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/@@chip\(([^,]+),([^,]+),([^)]*)\)@@/g, (_, id, type, label) => chipHtml(id.trim(), type.trim(), label.trim()))
    .replace(/@@img\(([^)]+)\)@@/g, (_, name) => {
      const path = images[name.trim()];
      if (!path) throw new Error(`fixture references unknown image "${name}"`);
      return path;
    });
}

/** Columns a table actually has; a fixture key the schema doesn't know is dropped. */
function columnsOf(db, table) {
  return new Set(db.raw.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

async function insertRows(db, table, rows, images, report) {
  const known = columnsOf(db, table);
  if (!known.size) {
    report.skipped_tables.push(table);
    return;
  }
  const dropped = new Set();
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
      values.push(expand(raw, images));
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    await db.execute(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, values);
  }
  report.counts[table] = rows.length;
  if (dropped.size) report.dropped[table] = [...dropped];
}

/* -- build ------------------------------------------------------------- */

export async function buildSeed(opts) {
  if (existsSync(opts.out) && !opts.force) {
    throw new Error(`${opts.out} already exists (pass --force to replace it)`);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'emerald-seed-'));
  mkdirSync(dirname(opts.out), { recursive: true });
  // Staged next to the output, not in workDir: Windows keeps the handle for a
  // while after close(), and workDir must stay removable.
  const stagingPath = join(dirname(opts.out), `.emerald-seed-${process.pid}.db`);
  let db = null;
  try {
    const app = await loadAppDb(opts.checkout, workDir);
    const fixture = JSON.parse(readFileSync(opts.fixture, 'utf-8'));

    db = new HarnessDb(stagingPath);
    globalThis.__emeraldHarnessDb = db;
    // The real first start: every migration, the built-in categories, cleanup.
    await app.getDb();

    const images = writeImages(opts.images);
    const report = { counts: {}, dropped: {}, skipped_tables: [] };
    for (const [table, rows] of Object.entries(fixture)) {
      if (table.startsWith('_') || !Array.isArray(rows)) continue;
      await insertRows(db, table, rows, images, report);
    }
    const version = db.raw.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
    db.close();
    db = null;

    rmSync(opts.out, { force: true });
    renameSync(stagingPath, opts.out);

    return { out: opts.out, schema_version: version, images, ...report };
  } finally {
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

// Importable as a module (provision.mjs uses it) and runnable as a CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSeed(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
