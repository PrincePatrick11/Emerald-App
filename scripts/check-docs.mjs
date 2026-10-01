/**
 * Prüft die relativen Links der Doku (README, CONTRIBUTING, CHANGELOG, Documentation/**):
 *
 *   1. Zieldatei existiert — eine verschobene oder umbenannte Datei fällt sofort auf.
 *   2. Anker existiert — `datei.md#abschnitt` muss auf eine Überschrift der Zieldatei
 *      zeigen. Umbenannte Überschriften brechen sonst still die Querverweise.
 *
 * Anker werden wie bei GitHub gebildet (Kleinbuchstaben, Satzzeichen weg, Leerzeichen → `-`,
 * Duplikate bekommen `-1`, `-2`, …). Links auf http(s)/mailto und Pfade, die aus dem Repo
 * herausführen (README: `../../releases` ist GitHub-relativ), werden übersprungen.
 *
 *   npm run check:docs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function markdownFiles(dir, recursive) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (recursive) out.push(...markdownFiles(path, true));
    } else if (name.endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

/** Text ohne Fenced-Code-Blöcke — Überschriften und Links darin zählen nicht. */
function stripFences(text) {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
}

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\- _]/gu, '')
    .replace(/ /g, '-');
}

function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const [, heading] of stripFences(text).matchAll(/^#{1,6} +(.+?) *#*$/gm)) {
    const base = slug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

const files = [...markdownFiles(root, false), ...markdownFiles(join(root, 'Documentation'), true)];
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const anchorCache = new Map();
const anchorsFor = (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(texts.get(file) ?? readFileSync(file, 'utf8')));
  return anchorCache.get(file);
};

const problems = [];
for (const [file, text] of texts) {
  // Inline-Code entfernen, damit `[a](b)` in Backticks nicht als Link zählt.
  const body = stripFences(text).replace(/`[^`\n]*`/g, '');
  for (const [, target] of body.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [path, anchor] = target.split('#');
    const targetFile = path ? resolve(dirname(file), decodeURI(path)) : file;
    if (relative(root, targetFile).startsWith('..')) continue;
    const where = relative(root, file).split(sep).join('/');
    if (!existsSync(targetFile)) {
      problems.push(`${where}: Datei fehlt → ${target}`);
    } else if (anchor && targetFile.endsWith('.md') && !anchorsFor(targetFile).has(anchor.toLowerCase())) {
      problems.push(`${where}: Anker fehlt → ${target}`);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} kaputte Doku-Links:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ Doku-Links in ${files.length} Dateien in Ordnung`);
