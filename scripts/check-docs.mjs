/**
 * Checks the docs (README, AGENTS, CONTRIBUTING, CHANGELOG, Documentation/**, tools/**):
 *
 *   1. Target file exists — a moved or renamed file is noticed immediately.
 *   2. Anchor exists — `file.md#section` must point to a heading in the target file.
 *      Renamed headings would otherwise silently break the cross-references.
 *
 * Anchors are built the way GitHub does it (lowercase, punctuation removed, spaces → `-`,
 * duplicates get `-1`, `-2`, …). Links to http(s)/mailto and paths that lead out of the
 * repo (README: `../../releases` is GitHub-relative) are skipped.
 *
 * In addition, paths in backticks must exist if they are written out starting with a folder
 * of the repo (`src/lib/db.ts`). This catches what links do not: agents mostly name
 * files without a link. The CHANGELOG is exempt, it describes the past.
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
      if (recursive && !name.startsWith('.') && name !== 'node_modules') out.push(...markdownFiles(path, true));
    } else if (name.endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

/** Text without fenced code blocks — headings and links inside them do not count. */
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

const files = [
  ...markdownFiles(root, false),
  ...markdownFiles(join(root, 'Documentation'), true),
  ...markdownFiles(join(root, 'tools'), true),
];
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const anchorCache = new Map();
const anchorsFor = (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(texts.get(file) ?? readFileSync(file, 'utf8')));
  return anchorCache.get(file);
};

const problems = [];
for (const [file, text] of texts) {
  // Remove inline code so that `[a](b)` in backticks does not count as a link.
  const body = stripFences(text).replace(/`[^`\n]*`/g, '');
  for (const [, target] of body.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [path, anchor] = target.split('#');
    const targetFile = path ? resolve(dirname(file), decodeURI(path)) : file;
    if (relative(root, targetFile).startsWith('..')) continue;
    const where = relative(root, file).split(sep).join('/');
    if (!existsSync(targetFile)) {
      problems.push(`${where}: file missing →${target}`);
    } else if (anchor && targetFile.endsWith('.md') && !anchorsFor(targetFile).has(anchor.toLowerCase())) {
      problems.push(`${where}: anchor missing →${target}`);
    }
  }
  if (file.endsWith('CHANGELOG.md')) continue;
  const where = relative(root, file).split(sep).join('/');
  for (const [, path] of stripFences(text).matchAll(/`((?:src|src-tauri|scripts|tools|Documentation|\.github)\/[\w./-]+\.\w+)`/g)) {
    if (!existsSync(join(root, path))) problems.push(`${where}: path missing →${path}`);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problems in the docs:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ Doc links and paths in ${files.length} files are fine`);
