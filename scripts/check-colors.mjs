// Colours come from the theme tokens (Documentation/design.md). A raw Tailwind
// palette class in a component is what would leave a custom theme half-applied.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAW = /(?<![\w-])(?:bg|text|border|ring|ring-offset|from|via|to|placeholder|accent|divide|fill|stroke|outline|caret|shadow|decoration)-(?:stone|gray|zinc|neutral|slate|jade|parchment|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+)?(?:\/\d+)?(?![\w-])/g;
// A white ring on a tag's own colour dot reads the same in every theme.
const ALLOWED = /^ring-white\/\d+$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
for (const file of walk('src')) {
  if (!/\.(tsx?|css)$/.test(file) || file.endsWith('fonts.css')) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const [match] of line.matchAll(RAW)) {
      if (!ALLOWED.test(match)) problems.push(`${file}:${i + 1}  ${match}`);
    }
  });
}

if (problems.length) {
  console.error(`✗ ${problems.length} raw colour classes; use a theme token:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('✓ No raw colour classes in src');
