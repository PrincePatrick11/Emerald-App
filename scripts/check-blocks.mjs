/**
 * Prüft das Blockformat im gespeicherten Inhalt (`src/lib/blocks/blockHtml.ts`):
 * Altinhalt ohne Wrapper, Round-Trips, unbekannte Blocktypen, Attribut-Entities,
 * fremde `<section>`-Tags im Text.
 *
 * Läuft unter Node ohne Browser — dieselbe Umgebung, in der Migrationen und
 * schema-check diese Funktionen später brauchen. Deshalb darf `blockHtml.ts`
 * keinen `DOMParser` benutzen, und dieser Test hält das fest.
 *
 *   npm run check:blocks
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const workDir = mkdtempSync(join(tmpdir(), 'emerald-blocks-'));
// Aus der Lage dieses Skripts, nicht aus cwd — läuft auch aus einem anderen Verzeichnis.
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

const entry = join(workDir, 'entry.ts');
writeFileSync(
  entry,
  `export { parseBlocks, serializeBlocks, createTextBlock, blockSectionHtml, neutralizeSectionTags } from '${root}/src/lib/blocks/blockHtml';
   export { TEXT_BLOCK_TYPE } from '${root}/src/lib/blocks/types';
   export { extractInternalLinks } from '${root}/src/lib/internalLinkHtml';`
);

const bundlePath = join(workDir, 'bundle.mjs');
let bundle;
try {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'warning',
  });
  bundle = await import(pathToFileURL(bundlePath).href);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const { parseBlocks, serializeBlocks, createTextBlock, neutralizeSectionTags, TEXT_BLOCK_TYPE, extractInternalLinks } = bundle;

const failures = [];
function check(label, ok, detail) {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.log(`  FEHLT ${label}`);
    if (detail !== undefined) console.log(`        ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    failures.push(label);
  }
}

const roundTrips = (html) => serializeBlocks(parseBlocks(html)) === html;
const types = (blocks) => blocks.map((b) => b.type);

console.log('\n1. Altinhalt ohne Wrapper\n');
{
  const legacy = '<p>Hallo <strong>Welt</strong></p><ul><li><p>eins</p></li></ul>';
  const blocks = parseBlocks(legacy);
  check('ist genau ein Textblock', blocks.length === 1 && blocks[0].type === TEXT_BLOCK_TYPE, blocks);
  check('mit unverändertem HTML', blocks[0]?.html === legacy, blocks[0]?.html);
  check('wird Byte für Byte zurückgeschrieben (kein Wrapper)', roundTrips(legacy));
  check('leerer Inhalt ergibt keine Blöcke', parseBlocks('').length === 0);
  check('keine Blöcke ergeben leeren Inhalt', serializeBlocks([]) === '');
  check('ein leerer Textblock ergibt leeren Inhalt', serializeBlocks([createTextBlock()]) === '');
}

console.log('\n2. Mehrere Blöcke\n');
{
  const blocks = [createTextBlock('<p>a</p>'), createTextBlock('<p>b</p>')];
  const html = serializeBlocks(blocks);
  check(
    'werden als Sections geschrieben',
    html.startsWith(`<section data-block="core.text" data-block-id="${blocks[0].id}">`),
    html
  );
  check('und kommen identisch zurück (IDs, Typen, HTML)', isDeepStrictEqual(parseBlocks(html), blocks), parseBlocks(html));

  const hidden = [{ ...createTextBlock('<p>x</p>'), attrs: { 'data-block-hidden': '1' } }];
  const hiddenHtml = serializeBlocks(hidden);
  check('ein einzelner Textblock MIT Attribut bleibt gewrappt', hiddenHtml.startsWith('<section'), hiddenHtml);
  check('und behält das Attribut', parseBlocks(hiddenHtml)[0]?.attrs['data-block-hidden'] === '1');
}

console.log('\n3. Unbekannte Typen und Attribute\n');
{
  const unknown =
    '<section data-block="plugin.x" data-block-id="u1" data-block-v="3" ' +
    'data-block-data="{&quot;a&quot;:&quot;&lt;b&gt; &amp; c&quot;}"><p>Fallback</p></section>';
  const [block] = parseBlocks(unknown);
  check('Typ bleibt erhalten', block?.type === 'plugin.x', block);
  check('Attribute werden dekodiert', block?.attrs['data-block-data'] === '{"a":"<b> & c"}', block?.attrs);
  check('Reihenfolge der Attribute bleibt', Object.keys(block?.attrs ?? {}).join() === 'data-block-v,data-block-data');
  check('unbekannter Block kommt Byte für Byte zurück', roundTrips(unknown), serializeBlocks(parseBlocks(unknown)));

  const hostile = '<section data-block="plugin.x" data-block-id="u4" onclick="alert(1)" class="c" data-ok="2"></section>';
  const [cleaned] = parseBlocks(hostile);
  check('nur data-* wird durchgereicht', isDeepStrictEqual(cleaned?.attrs, { 'data-ok': '2' }), cleaned?.attrs);

  const noId = parseBlocks('<section data-block="plugin.x"><p>x</p></section>')[0];
  check('ein Block ohne ID bekommt eine', typeof noId?.id === 'string' && noId.id.length > 0, noId);

  const upper = parseBlocks('<SECTION DATA-BLOCK="plugin.x" data-block-id="u6"><p>x</p></SECTION>');
  check('Groß-/Kleinschreibung der Tags ist egal', upper.length === 1 && upper[0].type === 'plugin.x', upper);
}

console.log('\n4. Loser Inhalt und fremde Sections\n');
{
  const mixed = '<p>vor</p><section data-block="plugin.x" data-block-id="u1"><p>mitte</p></section><p>nach</p>';
  const blocks = parseBlocks(mixed);
  check(
    'loser Inhalt vor und nach einem Block wird je ein Textblock',
    isDeepStrictEqual(types(blocks), [TEXT_BLOCK_TYPE, 'plugin.x', TEXT_BLOCK_TYPE]) &&
      blocks[0].html === '<p>vor</p>' && blocks[2].html === '<p>nach</p>',
    blocks
  );

  const spaced = '<section data-block="plugin.x" data-block-id="a"></section>\n  <section data-block="plugin.x" data-block-id="b"></section>';
  check('Leerraum zwischen Blöcken erzeugt keinen Textblock', parseBlocks(spaced).length === 2, parseBlocks(spaced));

  const foreign = '<section><p>x</p></section><section data-block="plugin.x" data-block-id="u2"><p>y</p></section>';
  const f = parseBlocks(foreign);
  check(
    'ein <section> ohne data-block bleibt Text und stört den Folgeblock nicht',
    f.length === 2 && f[0].type === TEXT_BLOCK_TYPE && f[0].html === '<section><p>x</p></section>' &&
      f[1].type === 'plugin.x' && f[1].html === '<p>y</p>',
    f
  );

  const nested = '<section data-block="plugin.x" data-block-id="u3"><section><p>i</p></section><p>j</p></section><p>k</p>';
  const n = parseBlocks(nested);
  check(
    'eine Section im Block schließt ihn nicht vorzeitig',
    n.length === 2 && n[0].html === '<section><p>i</p></section><p>j</p>' && n[1].html === '<p>k</p>',
    n
  );

  const broken = parseBlocks('<p>a</p><section data-block="plugin.x" data-block-id="u5"><p>kaputt');
  check(
    'ein nie geschlossener Block behält den Rest statt ihn zu verlieren',
    broken.length === 2 && broken[1].type === 'plugin.x' && broken[1].html === '<p>kaputt',
    broken
  );
}

console.log('\n4b. Täuschungsversuche\n');
{
  // So schreibt ein älteres WebKit einen Chip, dessen Ziel-Titel wie ein Block-Tag aussieht:
  // `<` im Attributwert bleibt unescaped.
  const trap = '<p><span data-type="internalLink" data-label="<section data-block=&quot;x&quot;>">t</span> Rest</p>';
  const html = serializeBlocks([createTextBlock('<p>a</p>'), createTextBlock(neutralizeSectionTags(trap))]);
  const blocks = parseBlocks(html);
  check(
    'ein <section> im Attributwert eines Chips spaltet den Textblock nicht',
    blocks.length === 2 && blocks.every((b) => b.type === TEXT_BLOCK_TYPE) && blocks[1].html.includes('Rest'),
    blocks
  );

  const dup = parseBlocks(
    '<section data-block="plugin.x" data-block-id="same"></section><section data-block="plugin.x" data-block-id="same"></section>'
  );
  check('doppelte Block-IDs werden beim Lesen aufgelöst', dup.length === 2 && dup[0].id !== dup[1].id, dup);

  const quoted = parseBlocks('<section data-block="plugin.x" data-block-id="q" data-block-data="a>b"><p>x</p></section>');
  check(
    'ein > in einem gequoteten Section-Attribut beendet das Tag nicht',
    quoted.length === 1 && quoted[0].attrs['data-block-data'] === 'a>b' && quoted[0].html === '<p>x</p>',
    quoted
  );

  const commented = parseBlocks(
    '<section data-block="plugin.x" data-block-id="c1"><p>a</p><!-- </section> --><p>b</p></section>' +
      '<!-- <section data-block="plugin.y" data-block-id="c2"> -->'
  );
  check(
    'Section-Tags in Kommentaren zählen nicht',
    commented.length === 2 && commented[0].html === '<p>a</p><!-- </section> --><p>b</p>' && commented[1].type === TEXT_BLOCK_TYPE,
    commented
  );

  const inAttr = parseBlocks(
    '<section data-block="plugin.x" data-block-id="h"><a href="x</section>y">l</a></section><p>danach</p>'
  );
  check(
    'ein </section> in einem Attributwert schließt den Block nicht',
    inAttr.length === 2 && inAttr[0].html === '<a href="x</section>y">l</a>' && inAttr[1].html === '<p>danach</p>',
    inAttr
  );
}

console.log('\n5. Was aus dem Inhalt abgeleitet wird, sieht die Blöcke durch\n');
{
  const chip =
    '<span data-type="internalLink" class="internal-link" data-id="11111111-1111-1111-1111-111111111111" ' +
    'data-entry-type="wiki" data-label="A">A</span>';
  const html = serializeBlocks([createTextBlock('<p>ohne</p>'), createTextBlock(`<p>${chip}</p>`)]);
  const links = extractInternalLinks(html);
  check('extractInternalLinks findet Chips in gewrappten Textblöcken', links.length === 1 && links[0].entryType === 'wiki', links);
}

console.log('');

if (failures.length) {
  console.error(`${failures.length} Prüfung(en) fehlgeschlagen:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('Alle Prüfungen bestanden.\n');
