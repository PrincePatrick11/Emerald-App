/**
 * Erzeugt `src/fonts.css`: die `@font-face`-Regeln der mitgelieferten
 * Schriften, aus den `@fontsource`-Paketen.
 *
 * Die App lädt keine Schriften aus dem Netz — offline sähe sie sonst anders
 * aus, und jeder Start schickte eine Anfrage an Google. Mitgeliefert werden
 * nur die Zeichensätze `latin` und `latin-ext` (die vier Sprachen der App und
 * was Einträge darüber hinaus an Akzenten tragen) und nur `woff2`, das jede
 * WebView kann. Die Pakete bringen dafür keine fertige Datei mit: ihre
 * Teil-Dateien (`latin-400.css`) lassen den `unicode-range` weg, zwei davon
 * nebeneinander überdeckten einander. Das Skript nimmt die Regeln darum aus
 * den vollständigen Dateien (`400.css`) und behält die beiden Zeichensätze.
 *
 * Eine Schrift oder ein Schnitt dazu: in `FONTS` eintragen, Paket
 * installieren, `npm run fonts`. Die Liste der wählbaren Schriften steht in
 * `src/themes/theme.ts`.
 *
 *   npm run fonts
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Paket → Schnitte, wie `400` oder `400-italic`. */
const FONTS = {
  'alegreya': ['400', '500', '600', '400-italic', '500-italic'],
  'cormorant-garamond': ['400', '500', '600', '400-italic', '500-italic'],
  'ibm-plex-sans': ['400', '500', '600', '700'],
  'inter': ['300', '400', '500', '600'],
  'lora': ['400', '500', '600', '400-italic', '500-italic', '600-italic'],
  'merriweather': ['400', '500', '700'],
  'nunito': ['400', '500', '600', '700'],
  'source-sans-3': ['400', '500', '600', '700'],
};

const SUBSETS = ['latin-ext', 'latin'];
const OUT = 'src/fonts.css';

const rules = [];
for (const [pkg, styles] of Object.entries(FONTS)) {
  for (const style of styles) {
    const css = readFileSync(`node_modules/@fontsource/${pkg}/${style}.css`, 'utf8');
    for (const subset of SUBSETS) {
      const suffix = style.endsWith('-italic') ? style : `${style}-normal`;
      const name = `${pkg}-${subset}-${suffix}`;
      const match = new RegExp(`/\\* ${name} \\*/\\s*(@font-face \\{[^}]*\\})`).exec(css);
      if (!match) throw new Error(`${name} fehlt in @fontsource/${pkg}/${style}.css`);
      const rule = match[1]
        // Nur woff2, relativ zu src/ — Vite nimmt die Datei damit ins Bundle auf.
        .replace(/src: [^;]*;/, `src: url('../node_modules/@fontsource/${pkg}/files/${name}.woff2') format('woff2');`);
      if (!rule.includes('unicode-range')) throw new Error(`${name} ohne unicode-range`);
      rules.push(rule);
    }
  }
}

writeFileSync(OUT, `/* Erzeugt von scripts/make-fonts-css.mjs — nicht von Hand ändern. */\n\n${rules.join('\n\n')}\n`);
console.log(`${OUT}: ${rules.length} Regeln`);
