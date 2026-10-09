/**
 * Gives a fresh MCP instance a vault with test data in it.
 *
 * Emerald is vault-based: the database is not in the app-data dir, it is in a
 * directory named by `<app-data>/vaults.json`. Seeding therefore means writing
 * an emerald.db somewhere and registering it as the active vault - dropping a
 * file into the app-data dir would do nothing at all.
 *
 * The vault goes to `<app-data>/vaults/<id>`, which is where the app itself
 * puts vaults it creates (vault.rs, `default_dir_for`) and inside one of the
 * roots the Rust side allows file access under.
 *
 * Refuses to touch an instance that already has a vaults.json unless --force.
 * That is what keeps slot 0 - the long-lived MCP environment with real work in
 * it - out of this entirely, while every new worktree gets a seeded vault.
 *
 *   node provision.mjs --checkout <dir> --app-data <dir> [--vault-id seed]
 *                      [--name "MCP Test Vault"] [--locale en] [--force]
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSeed, DEFAULT_FIXTURE } from './build_seed.mjs';

function parseArgs(argv) {
  const out = {
    'vault-id': 'seed',
    name: 'MCP Test Vault',
    icon: '\u{1F9EA}',
    locale: 'en',
    fixture: DEFAULT_FIXTURE,
    force: false,
  };
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

  const vaultId = opts['vault-id'];
  const vaultDir = join(appData, 'vaults', vaultId);
  mkdirSync(join(vaultDir, 'images'), { recursive: true });

  const seed = await buildSeed({
    checkout: opts.checkout,
    out: join(vaultDir, 'emerald.db'),
    fixture: opts.fixture,
    locale: opts.locale,
    verify: true,
    force: true,
  });

  // Shape and field names come from vaultManager.ts (VaultsFile, version 2).
  // Absolute paths are fine here: this file is generated per instance on this
  // machine, and the app has retarget_registry for the portable case.
  writeJson(vaultsFile, {
    version: 2,
    vaults: [{
      id: vaultId,
      name: opts.name,
      path: vaultDir,
      createdAt: new Date().toISOString(),
      icon: opts.icon,
    }],
    activeVaultId: vaultId,
  });

  return { vault_dir: vaultDir, vaults_file: vaultsFile, ...seed };
}

const result = await provision(parseArgs(process.argv.slice(2)));
console.log(JSON.stringify(result, null, 2));
