// Assembles `latest.json` from the platform jobs' fragments — the
// manifest that the in-app updater queries.
//
// The download addresses are NOT guessed: GitHub rewrites special characters in
// asset names ("Emerald App_0.2.0_x64-setup.exe" becomes
// "Emerald.App_0.2.0_x64-setup.exe"), so a self-built URL would lead
// nowhere. Instead the release's assets are read and the local
// file name is resolved against their names.
//
// Usage:
//   node scripts/updater-manifest.mjs --tag v0.3.0 --assets assets.json \
//     --fragments updater-fragments --notes release-notes.md --out latest.json

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const tag = arg('tag');
const assetsFile = arg('assets');
const fragmentsDir = arg('fragments', 'updater-fragments');
const notesFile = arg('notes');
const outFile = arg('out', 'latest.json');

if (!tag || !assetsFile) {
  console.error('usage: --tag <vX.Y.Z> --assets <json> [--fragments <dir>] [--notes <md>] [--out <file>]');
  process.exit(1);
}

/** How GitHub writes an asset name: everything outside this set becomes
 *  a dot. Both sides of the comparison go through here, so that the local
 *  name and the published one end up in the same form. */
function normalize(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '.');
}

const assets = JSON.parse(readFileSync(assetsFile, 'utf8'));
const byName = new Map(assets.map((a) => [normalize(a.name), a.url]));

const fragments = readdirSync(fragmentsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(fragmentsDir, f), 'utf8')));

if (!fragments.length) {
  console.error(`::error::no fragments in ${fragmentsDir}`);
  process.exit(1);
}

const platforms = {};
for (const { platform, file, signature } of fragments) {
  const url = byName.get(normalize(file));
  if (!url) {
    console.error(
      `::error::${platform}: no release asset matches '${file}'. ` +
      `Release has: ${assets.map((a) => a.name).join(', ')}`,
    );
    process.exit(1);
  }
  platforms[platform] = { signature, url };
}

const manifest = {
  version: tag.replace(/^v/, ''),
  notes: notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : '',
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outFile, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
