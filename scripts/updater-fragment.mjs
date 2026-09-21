// Sammelt aus einem Bundle-Verzeichnis die Signatur des Updater-Artefakts und
// legt sie als Fragment ab. Jeder Plattform-Job im Release-Workflow ruft das
// einmal auf; `updater-manifest.mjs` setzt die Fragmente spaeter zu einer
// `latest.json` zusammen.
//
// Warum ein Node-Skript und kein Shell-Einzeiler: die drei Runner bringen drei
// Shells mit (bash, bash, pwsh). Node liegt auf allen dreien schon bereit, weil
// der Build es braucht.
//
// Aufruf:
//   node scripts/updater-fragment.mjs --platform darwin-aarch64 \
//     --dir src-tauri/target/aarch64-apple-darwin/release/bundle/macos \
//     [--suffix .app.tar.gz.sig]

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'updater-fragments';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const platform = arg('platform');
const dir = arg('dir');
const suffix = arg('suffix') ?? '.sig';

if (!platform || !dir) {
  console.error('usage: --platform <key> --dir <bundle dir> [--suffix <ending>]');
  process.exit(1);
}

let entries;
try {
  entries = readdirSync(dir);
} catch (e) {
  console.error(`::error::cannot read ${dir}: ${e.message}`);
  process.exit(1);
}

const signatures = entries.filter((name) => name.endsWith(suffix));

// Beides ist ein Fehler, den man am Release nicht mehr sieht: ohne Signatur
// fehlt die Plattform im Manifest, bei zweien waere die Wahl zwischen ihnen
// geraten. Lieber hier laut scheitern als ein halbes Manifest veroeffentlichen.
if (signatures.length !== 1) {
  console.error(
    `::error::expected exactly one '${suffix}' in ${dir}, found ${signatures.length}` +
    (signatures.length ? `: ${signatures.join(', ')}` : ` (contents: ${entries.join(', ') || 'empty'})`),
  );
  process.exit(1);
}

const signatureFile = signatures[0];
const fragment = {
  platform,
  // Der Name des Bundles selbst — ohne das `.sig`. Unter diesem Namen liegt es
  // auch am Release, und darueber findet `updater-manifest.mjs` seine URL.
  file: signatureFile.slice(0, -'.sig'.length),
  signature: readFileSync(join(dir, signatureFile), 'utf8').trim(),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `${platform}.json`), JSON.stringify(fragment, null, 2));
console.log(`${platform}: ${fragment.file}`);
