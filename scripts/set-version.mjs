// Setzt die Version an allen drei Stellen, die zeichengleich sein muessen:
// package.json, src-tauri/tauri.conf.json und src-tauri/Cargo.toml.
//
// Gedacht fuer `updater-test.yml`, das im Runner eine erfundene Version
// einsetzt, bevor es baut — nicht fuer das Vorbereiten eines echten Releases.
// Dort ist das Setzen der Version ein bewusster Commit, und `prepare-release`
// prueft den Tag genau dagegen.
//
// Aufruf: node scripts/set-version.mjs 99.0.0

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

// Semver ohne Vorspiel: die Windows-Installer wollen drei Zahlen, und eine
// Version, die Tauri nicht parsen kann, scheitert erst mitten im Bundling.
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`::error::expected a version like 99.0.0, got '${version ?? ''}'`);
  process.exit(1);
}

/** Schreibt mit den Zeilenenden, die die Datei schon hatte. Die drei Dateien
 *  liegen hier mit CRLF; ein Durchlauf mit LF machte aus einer geaenderten
 *  Zeile eine komplett geaenderte Datei — im Runner egal, aber wer das Skript
 *  einmal lokal laufen laesst, saehe einen Diff ueber alles. */
function writeKeepingEol(path, original, next) {
  // Erst auf LF vereinheitlichen, dann umstellen: `next` kann die Zeilenenden
  // des Originals schon tragen — bei Cargo.toml wird nur eine Zeile ersetzt,
  // der Rest bleibt, wie er war. Ohne das Vereinheitlichen wuerde aus jedem
  // `\r\n` ein `\r\r\n`. Das faellt niemandem auf, dessen Checkout LF benutzt,
  // und zerlegt auf einem Windows-Runner mit `core.autocrlf` das Cargo.toml.
  const lf = next.replace(/\r\n/g, '\n');
  writeFileSync(path, original.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf);
}

function patchJson(path) {
  const original = readFileSync(path, 'utf8');
  const json = JSON.parse(original);
  json.version = version;
  writeKeepingEol(path, original, `${JSON.stringify(json, null, 2)}\n`);
}

patchJson('package.json');
patchJson('src-tauri/tauri.conf.json');

// Nur die erste `version = "…"` — das ist die des Pakets selbst. Die der
// Abhaengigkeiten stehen weiter unten und gehen die Version der App nichts an.
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
let replaced = false;
const patched = cargo.replace(/^version\s*=\s*"[^"]+"/m, () => {
  replaced = true;
  return `version = "${version}"`;
});
if (!replaced) {
  console.error('::error::no top-level version found in src-tauri/Cargo.toml');
  process.exit(1);
}
writeKeepingEol('src-tauri/Cargo.toml', cargo, patched);

console.log(`version set to ${version} in all three sites`);
