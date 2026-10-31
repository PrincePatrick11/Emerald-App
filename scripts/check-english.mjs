#!/usr/bin/env node
/**
 * Fails on German in code comments, and in `scripts/` and the workflows also on
 * German anywhere in a line, since their output is read by developers. The app's
 * own strings are not scanned: user-visible text lives in the locale files.
 *
 * It looks for umlauts and for German words that are not also English, so it is a
 * safety net rather than a proof. A line that has to contain German, such as test
 * data, carries the marker `lang-ok`.
 *
 *   npm run check:english [-- path-prefix]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CODE = /\.(ts|tsx|rs|mjs|js|css|html|py|sh|bat|ps1|yml|yaml|toml)$/;
const SKIP = /^(src\/i18n\/locales\/|src\/lib\/emojiSearchData\/|src-tauri\/gen\/|scripts\/check-english\.mjs$)/;
const WHOLE_LINE = /^(scripts\/|\.github\/workflows\/)/;
const GERMAN = /[äöüÄÖÜß]|\b(und|oder|nicht|wird|werden|wurde|sonst|damit|weil|wenn|auch|sind|eine|einen|einem|einer|keine|kein|fuer|ueber|bleibt|dass|muss|kann|nur|noch|beim|zum|zur|der|den|dem|des|das|ist|sich|ohne|aber|hier)\b/i;

/** The comment text of each line, as far as a line-based scan can tell. */
function commentsIn(path, text) {
  const hash = /\.(py|sh|yml|yaml|toml|ps1)$/.test(path);
  const bat = path.endsWith('.bat');
  let inBlock = false;
  return text.split('\n').map((line) => {
    if (hash) return line.match(/(?:^|\s)#(.*)$/)?.[1] ?? '';
    if (bat) return line.match(/^\s*(?:rem\b|::)(.*)$/i)?.[1] ?? '';
    let found = '';
    let rest = line;
    while (rest) {
      if (inBlock) {
        const end = rest.search(/\*\/|-->/);
        if (end < 0) return found + rest;
        found += rest.slice(0, end);
        rest = rest.slice(end + 2);
        inBlock = false;
      } else {
        const open = rest.match(/\/\*|<!--|(?<![:'"`])\/\/(.*)$/);
        if (!open) return found;
        if (open[0].startsWith('//')) return found + open[1];
        rest = rest.slice(open.index + open[0].length);
        inBlock = true;
      }
    }
    return found;
  });
}

const prefix = process.argv[2] ?? '';
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => CODE.test(f) && !SKIP.test(f) && f.startsWith(prefix));

const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const scanned = WHOLE_LINE.test(file) ? lines : commentsIn(file, text);
  scanned.forEach((part, i) => {
    if (!lines[i].includes('lang-ok') && GERMAN.test(part)) {
      problems.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ ${problems.length} lines with German. Translate them, or mark test data with lang-ok.`);
  // Not process.exit: it would cut off the list when stderr is a pipe.
  process.exitCode = 1;
} else {
  console.log(`✓ No German found in ${files.length} files`);
}
