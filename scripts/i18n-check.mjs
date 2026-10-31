/**
 * Checks the four locale files against each other:
 *
 *   1. Key parity — every language has exactly the same set of leaf keys as en.
 *   2. Placeholder parity — every key has the same {{interpolations}} in every
 *      language as in en (a forgotten placeholder would otherwise only show up
 *      at runtime as raw text).
 *
 * Deliberately no dead-key detection: dynamic prefixes such as
 * `t(`${module}.categories.${id}`)` make any code search too noisy.
 *
 *   npm run check:i18n
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const REFERENCE = 'en';
const LANGUAGES = ['en', 'de', 'es', 'fr'];

/** Nested object to flat "a.b.c" paths. */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

/** Only the name counts, not a formatter after it: `{{label, lowercase}}`
 *  in en and `{{label}}` in de are the same placeholder (German capitalises
 *  the noun and omits the formatter). */
function placeholders(value) {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).sort();
}

const flat = {};
for (const lng of LANGUAGES) {
  flat[lng] = flatten(JSON.parse(readFileSync(join(localesDir, `${lng}.json`), 'utf8')));
}

const errors = [];
const refKeys = flat[REFERENCE];

for (const lng of LANGUAGES) {
  if (lng === REFERENCE) continue;
  for (const key of refKeys.keys()) {
    if (!flat[lng].has(key)) errors.push(`${lng}: missing key "${key}"`);
  }
  for (const key of flat[lng].keys()) {
    if (!refKeys.has(key)) errors.push(`${lng}: extra key "${key}" (not in ${REFERENCE})`);
  }
  for (const [key, refValue] of refKeys) {
    const value = flat[lng].get(key);
    if (value === undefined) continue;
    const want = placeholders(refValue).join(',');
    const got = placeholders(value).join(',');
    if (want !== got) {
      errors.push(`${lng}: "${key}" has placeholders [${got}], ${REFERENCE} has [${want}]`);
    }
  }
}

if (errors.length > 0) {
  console.error(`i18n check failed (${errors.length} problem(s)):\n`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`i18n check ok: ${refKeys.size} keys, ${LANGUAGES.length} languages in parity.`);
