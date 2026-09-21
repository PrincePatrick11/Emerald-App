// Setzt aus den Fragmenten der Plattform-Jobs die `latest.json` zusammen — das
// Manifest, das der In-App-Updater abfragt.
//
// Die Download-Adressen werden NICHT geraten: GitHub schreibt Sonderzeichen in
// Asset-Namen um (aus "Emerald App_0.2.0_x64-setup.exe" wird
// "Emerald.App_0.2.0_x64-setup.exe"), eine selbst gebaute URL liefe also ins
// Leere. Stattdessen werden die Assets des Releases gelesen und der lokale
// Dateiname gegen ihre Namen aufgeloest.
//
// Aufruf:
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

/** Wie GitHub einen Asset-Namen schreibt: alles ausserhalb dieser Menge wird
 *  zum Punkt. Beide Seiten des Vergleichs laufen hier durch, damit der lokale
 *  Name und der veroeffentlichte auf derselben Form landen. */
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
