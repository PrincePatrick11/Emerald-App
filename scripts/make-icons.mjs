/**
 * Erzeugt alle App-Symbole aus den beiden Vorlagen unter
 * `src-tauri/icons/source/`.
 *
 * Nötig ist das Skript, weil zwei Vorlagen auf einen Ordner treffen:
 * `emerald.svg` ist freigestellt (Windows und Linux zeichnen keinen Kasten um
 * ein Symbol), `emerald-macos.svg` sitzt auf der gerundeten Platte, die macOS
 * erwartet und die `tauri icon` nicht selbst hinzufügt. Jeder Lauf von
 * `tauri icon` schreibt aber *alle* Ziele — ein zweiter Lauf überschriebe den
 * ersten vollständig. Deshalb: zwei Läufe in getrennte Ordner, und aus dem
 * zweiten wird allein `icon.icns` übernommen, die einzige Datei, die nur
 * macOS liest.
 *
 * Ohne dieses Skript wäre die naheliegende Handlung — ein `npx tauri icon` mit
 * der einen Vorlage, die man gerade zur Hand hat — genau die falsche, und der
 * Fehler fiele erst auf einem Mac auf.
 *
 * Läuft nicht in CI: die Symbole liegen als Ergebnis im Repository, weil der
 * Rust-Build sie braucht und weil ihre Änderung eine gestalterische
 * Entscheidung ist und keine Bauleistung.
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

/** `tauri` liegt als lokale Abhängigkeit; npm legt den Shim in node_modules/.bin. */
function tauriIcon(source, out) {
  execFileSync('npm', ['exec', '--', 'tauri', 'icon', source, '-o', out], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
}

try {
  tauriIcon(`${SOURCE}/emerald.svg`, squareOut);
  tauriIcon(`${SOURCE}/emerald-macos.svg`, macOut);

  // Erst der vollständige freigestellte Satz …
  cpSync(squareOut, TARGET, { recursive: true });
  // … dann die eine Datei, die von der Platte kommen muss.
  copyFileSync(join(macOut, 'icon.icns'), join(TARGET, 'icon.icns'));

  // Und das Favicon, das `index.html` im Dev-Browser zeigt. Es fällt hier mit
  // ab, statt eine fünfte handgepflegte Kopie der Geometrie zu sein.
  copyFileSync(`${SOURCE}/emerald.svg`, 'public/favicon.svg');

  console.log(`Icons erzeugt: ${TARGET} (icon.icns aus der macOS-Vorlage), public/favicon.svg`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
