// Collects the signature of the updater artifact from a bundle directory and
// stores it as a fragment. Each platform job in the release workflow calls this
// once; `updater-manifest.mjs` later assembles the fragments into a
// `latest.json`.
//
// Why a Node script and not a shell one-liner: the three runners come with three
// different shells (bash, bash, pwsh). Node is already available on all three, because
// the build needs it.
//
// Usage:
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

// Both are errors that can no longer be seen in the release: without a signature
// the platform is missing from the manifest, and with two the choice between them
// would be a guess. Better to fail loudly here than to publish half a manifest.
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
  // The name of the bundle itself, without the `.sig`. It is stored under this name
  // on the release too, and `updater-manifest.mjs` finds its URL through it.
  file: signatureFile.slice(0, -'.sig'.length),
  signature: readFileSync(join(dir, signatureFile), 'utf8').trim(),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `${platform}.json`), JSON.stringify(fragment, null, 2));
console.log(`${platform}: ${fragment.file}`);
