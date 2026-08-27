/**
 * Prüft die vier Locale-Dateien gegeneinander:
 *
 *   1. Key-Parität — jede Sprache hat exakt dieselbe Menge an Leaf-Keys wie en.
 *   2. Platzhalter-Parität — jeder Key hat in jeder Sprache dieselben
 *      {{interpolationen}} wie in en (ein vergessener Platzhalter fällt sonst
 *      erst zur Laufzeit als roher Text auf).
 *
 * Bewusst keine Dead-Key-Erkennung: dynamische Präfixe wie
 * `t(`${module}.categories.${id}`)` machen jede Code-Suche zu verrauscht.
 *
 *   npm run check:i18n
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const REFERENCE = 'en';
const LANGUAGES = ['en', 'de', 'es', 'fr'];

/** Verschachteltes Objekt zu flachen "a.b.c"-Pfaden. */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

function placeholders(value) {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
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
    if (!flat[lng].has(key)) errors.push(`${lng}: fehlender Key "${key}"`);
  }
  for (const key of flat[lng].keys()) {
    if (!refKeys.has(key)) errors.push(`${lng}: überzähliger Key "${key}" (nicht in ${REFERENCE})`);
  }
  for (const [key, refValue] of refKeys) {
    const value = flat[lng].get(key);
    if (value === undefined) continue;
    const want = placeholders(refValue).join(',');
    const got = placeholders(value).join(',');
    if (want !== got) {
      errors.push(`${lng}: "${key}" hat Platzhalter [${got}], ${REFERENCE} hat [${want}]`);
    }
  }
}

if (errors.length > 0) {
  console.error(`i18n-Check fehlgeschlagen (${errors.length} Problem(e)):\n`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`i18n-Check ok: ${refKeys.size} Keys, ${LANGUAGES.length} Sprachen in Parität.`);
