/**
 * Gives a fresh MCP instance a vault with test data in it (Emerald 0.1.3.x).
 *
 * In 0.1.3.x a vault is a SQLite file named in `<app-data>/vaults.json`
 * (`dbName`), opened by tauri-plugin-sql relative to the app *config* dir.
 * On macOS and Windows that is the app-data dir; on Linux it is
 * `$XDG_CONFIG_HOME/<identifier>`. Images live in `<app-data>/images`, the
 * only place `read_image_as_base64` reads from.
 *
 * Refuses to touch an instance that already has a vaults.json unless --force.
 * That keeps an instance someone has been working in out of this entirely:
 * the vault is created once, when the instance is new.
 *
 *   node provision.mjs --checkout <dir> --app-data <dir> [--force]
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { buildSeed, DEFAULT_FIXTURE } from './build_seed.mjs';

function parseArgs(argv) {
  const out = { fixture: DEFAULT_FIXTURE, name: 'MCP Test Vault', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  for (const required of ['checkout', 'app-data']) {
    if (!out[required]) throw new Error(`--${required} <dir> is required`);
  }
  out.checkout = resolve(out.checkout);
  out['app-data'] = resolve(out['app-data']);
  return out;
}

/** Where tauri-plugin-sql resolves `sqlite:emerald.db` for this identifier. */
function configDir(appData) {
  if (process.platform !== 'linux') return appData;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, basename(appData));
}

function writeJson(path, value) {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  rmSync(path, { force: true });
  renameSync(tmp, path);
}

async function provision(opts) {
  const appData = opts['app-data'];
  const vaultsFile = join(appData, 'vaults.json');

  if (existsSync(vaultsFile) && !opts.force) {
    return { skipped: 'vaults.json already exists', vaults_file: vaultsFile };
  }

  mkdirSync(appData, { recursive: true });
  const dbName = 'emerald.db';
  const seed = await buildSeed({
    checkout: opts.checkout,
    out: join(configDir(appData), dbName),
    images: join(appData, 'images'),
    fixture: opts.fixture,
    force: true,
  });

  // Shape and field names come from vaultManager.ts (VaultsFile). The id
  // 'default' is the vault the app always keeps in the list.
  writeJson(vaultsFile, {
    vaults: [{ id: 'default', name: opts.name, dbName, createdAt: new Date().toISOString() }],
    activeVaultId: 'default',
  });

  return { vaults_file: vaultsFile, ...seed };
}

const result = await provision(parseArgs(process.argv.slice(2)));
console.log(JSON.stringify(result, null, 2));
