/**
 * Generates all app icons from the two templates under
 * `src-tauri/icons/source/`.
 *
 * The script is needed because two templates meet in one folder:
 * `emerald.svg` is cut out (Windows and Linux draw no box around an
 * icon), `emerald-macos.svg` sits on the rounded plate that macOS
 * expects and that `tauri icon` does not add itself. Every run of
 * `tauri icon` writes *all* targets, though — a second run would overwrite the
 * first completely. Hence: two runs into separate folders, and from the
 * second only `icon.icns` is taken, the one file that only
 * macOS reads.
 *
 * Without this script the obvious action — an `npx tauri icon` with
 * whichever template happens to be at hand — would be exactly the wrong one, and the
 * mistake would only show up on a Mac.
 *
 * Does not run in CI: the icons live in the repository as a result, because the
 * Rust build needs them and because changing them is a design
 * decision, not a build task.
 *
 *   npm run icons
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE = 'src-tauri/icons/source';
const TARGET = 'src-tauri/icons';

const work = mkdtempSync(join(tmpdir(), 'emerald-icons-'));
const squareOut = join(work, 'square');
const macOut = join(work, 'macos');

/** `tauri` is a local dependency; npm puts the shim in node_modules/.bin. */
function tauriIcon(source, out) {
  execFileSync('npm', ['exec', '--', 'tauri', 'icon', source, '-o', out], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
}

try {
  tauriIcon(`${SOURCE}/emerald.svg`, squareOut);
  tauriIcon(`${SOURCE}/emerald-macos.svg`, macOut);

  // First the complete cut-out set …
  cpSync(squareOut, TARGET, { recursive: true });
  // … then the one file that has to come from the plate.
  copyFileSync(join(macOut, 'icon.icns'), join(TARGET, 'icon.icns'));

  // And the favicon that `index.html` shows in the dev browser. It comes out
  // of this run too, instead of being a fifth hand-maintained copy of the geometry.
  copyFileSync(`${SOURCE}/emerald.svg`, 'public/favicon.svg');

  console.log(`Icons generated: ${TARGET} (icon.icns from the macOS template), public/favicon.svg`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
