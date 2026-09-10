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
   export { TEXT_BLOCK_TYPE, BLOCK_ATTR } from '${root}/src/lib/blocks/types';
   export { parseFields, serializeFields, createFieldsBlock, isElementEmpty, isHiddenInRead, linkFromSlot, imageFromSlot } from '${root}/src/lib/blocks/fields';
   export { instantiateDefinition, updateInstanceToDefinition, isOutdatedCopy, blockOrigin, updateCopiesInContent, removeCopiesFromContent, parseDefinitionElements, parseDefinitionDisplay } from '${root}/src/lib/blocks/definitions';
   export { entryBlockSummary } from '${root}/src/lib/blocks/entrySummary';
   export { withLegacyStatus, statusDefinition, hasLegacyStatus, convertLegacyStatusRows, STATUS_DEFINITION_ID } from '${root}/src/lib/blocks/legacyStatus';
   export { extractUniqueLetters, parseSigilCalc, serializeSigilCalc, createSigilCalcBlock, createSigilCanvasBlock, createSigilChargeBlock, parseSigilCharge, serializeSigilCharge, sigilState, withoutConcealed, withChargeUnloaded, sigilImage, withSigilImage, letterList } from '${root}/src/lib/blocks/sigil';
   export { renderBlocksForExport } from '${root}/src/lib/blocks/exportRender';
   export { internalLinkChipHtml } from '${root}/src/lib/internalLinkHtml';
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

const {
  parseBlocks, serializeBlocks, createTextBlock, neutralizeSectionTags, TEXT_BLOCK_TYPE, BLOCK_ATTR, extractInternalLinks,
  parseFields, serializeFields, createFieldsBlock, isElementEmpty, isHiddenInRead, linkFromSlot, imageFromSlot,
  internalLinkChipHtml,
  instantiateDefinition, updateInstanceToDefinition, isOutdatedCopy, blockOrigin, updateCopiesInContent,
  removeCopiesFromContent, parseDefinitionElements, parseDefinitionDisplay, entryBlockSummary,
  withLegacyStatus, statusDefinition, hasLegacyStatus, convertLegacyStatusRows, STATUS_DEFINITION_ID,
  extractUniqueLetters, parseSigilCalc, serializeSigilCalc, createSigilCalcBlock, createSigilCanvasBlock,
  createSigilChargeBlock, parseSigilCharge, serializeSigilCharge, sigilState, withoutConcealed, withChargeUnloaded,
  sigilImage, withSigilImage, letterList, renderBlocksForExport,
} = bundle;

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

console.log('\n4c. Feldblock\n');
{
  const text = { label: (el) => el.label || el.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p };

  const fresh = parseFields(createFieldsBlock('shorttext'));
  check(
    'ein neuer Feldblock hat ein Element und die Standard-Anzeigeregeln',
    fresh.elements.length === 1 && fresh.elements[0].kind === 'shorttext' &&
      fresh.display.readHideEmpty === true && fresh.display.readOnly === false,
    fresh
  );
  check('ein leeres Element ist leer und im Lesemodus ausgeblendet',
    isElementEmpty(fresh.elements[0], fresh) && isHiddenInRead(fresh.elements[0], fresh));

  const block = createFieldsBlock('shorttext');
  const model = parseFields(block);
  const el = model.elements[0];
  const written = serializeFields(block, { ...model, values: { [el.id]: '<b>fett</b> & so' } }, text);
  check('der Wert steht im JSON', JSON.parse(written.attrs[BLOCK_ATTR.data]).values[el.id] === '<b>fett</b> & so');
  check('und escaped im Fallback', written.html.includes('&lt;b&gt;fett&lt;/b&gt; &amp; so') && !written.html.includes('<b>'), written.html);

  const reparsed = parseFields(parseBlocks(serializeBlocks([written]))[0]);
  check('Round-Trip über das Blockformat', reparsed.values[el.id] === '<b>fett</b> & so', reparsed);

  const linkBlock = createFieldsBlock('link');
  const linkModel = parseFields(linkBlock);
  const linkEl = linkModel.elements[0];
  const chip = internalLinkChipHtml({ id: '22222222-2222-2222-2222-222222222222', entryType: 'wiki', label: 'Ziel "A"' });
  const withLink = serializeFields(linkBlock, { ...linkModel, slots: { [linkEl.id]: chip } }, text);
  check('der Link steht als Slot im Markup, nicht im JSON',
    withLink.html.includes(`data-block-slot="el:${linkEl.id}"`) && !(withLink.attrs[BLOCK_ATTR.data] ?? '').includes('2222'),
    withLink);
  const html = serializeBlocks([createTextBlock('<p>x</p>'), withLink]);
  check('extractInternalLinks findet den Link im Feldblock', extractInternalLinks(html).length === 1);
  const slotBack = parseFields(parseBlocks(html)[1]).slots[linkEl.id];
  const target = linkFromSlot(slotBack);
  check('der Slot liest sich samt Label zurück', target?.id === '22222222-2222-2222-2222-222222222222' && target?.label === 'Ziel "A"', target);

  const imgBlock = createFieldsBlock('image');
  const imgModel = parseFields(imgBlock);
  const imgEl = imgModel.elements[0];
  const name = `${'ab'.repeat(32)}.png`;
  const withImg = serializeFields(imgBlock, { ...imgModel, slots: { [imgEl.id]: `<img src="${name}">` } }, text);
  check('das Bild steht als src im Markup (Bild-Aufräumen findet es)', withImg.html.includes(`src="${name}"`) && imageFromSlot(parseFields(withImg).slots[imgEl.id]) === name);

  const broken = parseFields({ id: 'x', type: 'core.fields', html: '', attrs: { [BLOCK_ATTR.config]: '{kaputt', [BLOCK_ATTR.data]: '[1,2' } });
  check('kaputtes JSON ergibt einen leeren Block statt eines Fehlers', broken.elements.length === 0 && Object.keys(broken.values).length === 0);

  const orphanBlock = { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify({ values: { weg: 'bleibt', [el.id]: 42 } }) } };
  const orphanModel = parseFields(orphanBlock);
  check('ein Wert der falschen Art wird verworfen', orphanModel.values[el.id] === undefined);
  const orphanOut = serializeFields(orphanBlock, orphanModel, text);
  check('Werte ohne bekanntes Element bleiben erhalten', JSON.parse(orphanOut.attrs[BLOCK_ATTR.data]).values.weg === 'bleibt');

  const hostile = {
    id: 'h', type: 'core.fields', html: '',
    attrs: { [BLOCK_ATTR.config]: JSON.stringify({ elements: [
      { id: 'constructor', kind: 'link', label: '' },
      { id: '__proto__', kind: 'link', label: '' },
      { id: 'toString', kind: 'shorttext', label: '' },
      { id: 'ok-1', kind: 'shorttext', label: '' },
    ] }) },
  };
  let hostileModel;
  let threw = false;
  try {
    hostileModel = parseFields(hostile);
    for (const el of hostileModel.elements) {
      isElementEmpty(el, hostileModel);
      linkFromSlot(hostileModel.slots[el.id]);
    }
    linkFromSlot(hostileModel.slots.constructor);
    imageFromSlot(hostileModel.slots.constructor);
  } catch {
    threw = true;
  }
  check('Element-IDs wie constructor/__proto__/toString werden verworfen, nichts wirft',
    !threw && hostileModel.elements.length === 1 && hostileModel.elements[0].id === 'ok-1', hostileModel?.elements);

  const toggleBlock = createFieldsBlock('toggle');
  const toggleModel = parseFields(toggleBlock);
  const toggleEl = toggleModel.elements[0];
  check('Ja/Nein ist nie leer — ungesetzt heißt Nein',
    !isElementEmpty(toggleEl, toggleModel) && !isElementEmpty(toggleEl, { ...toggleModel, values: { [toggleEl.id]: false } }));

  const brokenConfig = parseFields({ id: 'b', type: 'core.fields', html: '', attrs: { [BLOCK_ATTR.config]: '{kaputt' } });
  const brokenData = parseFields({ ...block, attrs: { ...block.attrs, [BLOCK_ATTR.data]: '"nur ein Text"' } });
  check('unlesbare Config oder Daten setzen broken', brokenConfig.broken && brokenData.broken && !model.broken);

  const orphanSlot = serializeFields(block, { ...model, slots: { weg: chip } }, text);
  check('ein Slot ohne bekanntes Element übersteht das Schreiben',
    parseFields(orphanSlot).slots.weg === chip && extractInternalLinks(orphanSlot.html).length === 1, orphanSlot.html);

  const selectBlock = createFieldsBlock('select');
  const selectModel = parseFields(selectBlock);
  const selectEl = { ...selectModel.elements[0], options: [{ id: 'o1', label: 'Eins' }] };
  check('ein Wert mit gelöschter Option gilt als leer',
    isElementEmpty(selectEl, { ...selectModel, elements: [selectEl], values: { [selectEl.id]: 'o-geloescht' } }));

  const keepEmpty = { ...el, hideWhenEmpty: false };
  check('hideWhenEmpty am Element schlägt die Blockregel',
    !isHiddenInRead(keepEmpty, { ...model, elements: [keepEmpty] }) && isHiddenInRead(el, model));
}

console.log('\n4d. Eigene Blöcke: Kopien und Aktualisieren\n');
{
  const text = { label: (el) => el.label || el.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p };
  const def = {
    id: 'def-1', name: 'Ritual', icon: '🕯️', description: '', revision: 1, sort_order: 0,
    created_at: '', updated_at: '', deleted_at: null,
    display: { readHideEmpty: true, readOnly: false, showTitle: true },
    elements: [{ id: 'e-date', kind: 'date', label: 'Datum' }, { id: 'e-result', kind: 'shorttext', label: 'Ergebnis' }],
  };

  const copy = instantiateDefinition(def);
  const copyModel = parseFields(copy);
  check('eine Kopie trägt Herkunft, Revision, Name und die Titel-Regel',
    blockOrigin(copy)?.id === 'def-1' && blockOrigin(copy)?.rev === 1 && copyModel.name === 'Ritual' &&
      copy.attrs['data-block-show-title'] === '1', copy);
  check('die Element-IDs der Kopie sind die der Definition',
    copyModel.elements.map((e) => e.id).join() === 'e-date,e-result');

  const filled = serializeFields(copy, { ...copyModel, values: { 'e-date': '2026-09-10', 'e-result': 'gut' } }, text);
  check('eine Kopie der aktuellen Revision ist nicht veraltet', !isOutdatedCopy(filled, def));

  const def2 = {
    ...def, revision: 2,
    display: { readHideEmpty: false, readOnly: true, showTitle: false },
    elements: [
      { id: 'e-result', kind: 'shorttext', label: 'Resultat' },
      { id: 'e-mood', kind: 'select', label: 'Stimmung', options: [{ id: 'o1', label: 'ruhig' }] },
      { id: 'e-date', kind: 'date', label: 'Datum', archived: true },
    ],
  };
  check('eine ältere Revision ist veraltet', isOutdatedCopy(filled, def2));

  const titled = { ...filled, attrs: { ...filled.attrs, 'data-block-title': 'Mein Titel' } };
  const updated = updateInstanceToDefinition(titled, def2, text);
  const um = parseFields(updated);
  check('Werte bleiben an ihrer Element-ID', um.values['e-result'] === 'gut' && um.values['e-date'] === '2026-09-10', um.values);
  check('die Beschriftung kommt aus der Definition', um.elements.find((e) => e.id === 'e-result')?.label === 'Resultat');
  check('ein neues Feld kommt leer dazu, in der Reihenfolge der Definition',
    um.elements.filter((e) => !e.archived).map((e) => e.id).join() === 'e-result,e-mood' && um.values['e-mood'] === undefined,
    um.elements);
  check('ein entferntes Feld wird archiviert, nicht gelöscht', um.elements.find((e) => e.id === 'e-date')?.archived === true);
  check('ein archiviertes Feld fehlt im Fallback und im Lesemodus',
    !updated.html.includes('2026-09-10') && isHiddenInRead(um.elements.find((e) => e.id === 'e-date'), um), updated.html);
  check('die Anzeigeregeln kommen aus der Definition', um.display.readHideEmpty === false && um.display.readOnly === true);
  check('der eigene Titel bleibt, die Revision steht auf der neuen',
    updated.attrs['data-block-title'] === 'Mein Titel' && blockOrigin(updated)?.rev === 2 && !isOutdatedCopy(updated, def2));

  const def3 = {
    ...def2, revision: 3,
    elements: [...def2.elements.filter((e) => e.id !== 'e-date'), { id: 'e-date', kind: 'date', label: 'Datum' }],
  };
  const back = parseFields(updateInstanceToDefinition(updated, def3, text));
  check('ein zurückgeholtes Feld bringt seinen Wert mit',
    !back.elements.find((e) => e.id === 'e-date')?.archived && back.values['e-date'] === '2026-09-10');

  const clash = { ...def2, revision: 4, elements: [{ id: 'e-result', kind: 'number', label: 'X' }] };
  check('eine andere Art unter derselben ID verwirft den Wert nicht',
    parseFields(updateInstanceToDefinition(updated, clash, text)).values['e-result'] === 'gut');

  const content = serializeBlocks([createTextBlock('<p>a</p>'), filled, createFieldsBlock('number')]);
  const updatedContent = updateCopiesInContent(content, def2, text);
  const updatedBlocks = parseBlocks(updatedContent ?? '');
  check('updateCopiesInContent aktualisiert nur die Kopie',
    updatedBlocks.length === 3 && blockOrigin(updatedBlocks[1])?.rev === 2 && updatedBlocks[0].html === '<p>a</p>', updatedBlocks);
  check('ohne veraltete Kopie liefert es null', updateCopiesInContent(updatedContent, def2, text) === null);

  const removed = removeCopiesFromContent(content, 'def-1');
  check('removeCopiesFromContent entfernt nur die Kopien dieser Definition',
    parseBlocks(removed ?? '').length === 2 && removeCopiesFromContent(removed, 'def-1') === null);

  const summary = entryBlockSummary('x', content);
  check('entryBlockSummary liefert Herkunft und Feldwerte unter Definition:Element',
    summary.origins.length === 1 && summary.fieldValues['def-1:e-result'] === 'gut', summary);
  check('ein Inhalt ohne eigene Blöcke hat keine Herkunft', entryBlockSummary('y', '<p>nur Text</p>').origins.length === 0);

  check('Definitionsspalten: kaputtes JSON ergibt die Standardwerte',
    parseDefinitionElements('{kaputt').length === 0 && parseDefinitionDisplay('nope').showTitle === true &&
      parseDefinitionDisplay('nope').readHideEmpty === true);
  check('Definitionsspalten: gefährliche und doppelte IDs fallen weg',
    parseDefinitionElements(JSON.stringify([
      { id: '__proto__', kind: 'date', label: '' }, { id: 'ok', kind: 'date', label: '' }, { id: 'ok', kind: 'number', label: '' },
    ])).map((e) => e.id).join() === 'ok');
}

console.log('\n4e. Altstatus der Operationen wird ein Block\n');
{
  const labels = {
    'blocks.status.name': 'Status', 'blocks.status.active': 'Aktiv', 'blocks.status.endDate': 'Enddatum',
    'blocks.status.version': 'Version', 'blocks.fields.yes': 'Ja', 'blocks.fields.no': 'Nein',
  };
  const t = (key) => labels[key] ?? key;
  const def = statusDefinition(t, '2026-01-01T00:00:00.000Z');

  check('Aktiv ohne Enddatum und Version ist kein Altstatus',
    !hasLegacyStatus({ isActive: true, endDate: null, version: ' ' }) && hasLegacyStatus({ isActive: false, endDate: null, version: null }));

  const out = withLegacyStatus('<p>Text</p>', { isActive: false, endDate: '2026-03-01', version: ' 1.2 ' }, def, t);
  const [status, text] = parseBlocks(out);
  const model = parseFields(status);
  check('der Status-Block steht vor dem Inhalt, der Text bleibt',
    status?.type === 'core.fields' && status.attrs['data-block-origin'] === STATUS_DEFINITION_ID && text?.html === '<p>Text</p>', out);
  check('Werte: inaktiv, Enddatum, Version getrimmt',
    model.values.active === false && model.values['end-date'] === '2026-03-01' && model.values.version === '1.2', model.values);
  check('der Fallback nennt die Werte lesbar', status.html.includes('Nein') && status.html.includes('1.2'), status.html);

  const md = parseFields(parseBlocks(withLegacyStatus('', { isActive: true, endDate: 'Sep 10, 2026', version: null }, def, t))[0]);
  check('ein Datum aus einem Markdown-Export wird ISO', md.values['end-date'] === '2026-09-10', md.values);

  const rows = [
    { id: 'a', content: '<p>x</p>', is_active: 0, end_date: null, version: null },
    { id: 'b', content: '<p>y</p>', is_active: 1, end_date: null, version: '' },
  ];
  const converted = convertLegacyStatusRows(rows, t, 'now');
  check('convertLegacyStatusRows: nur die Zeile mit Altstatus, Spalten geleert',
    converted.definition?.id === STATUS_DEFINITION_ID && converted.rows[1] === rows[1] &&
      converted.rows[0].is_active === 1 && converted.rows[0].content.includes('data-block-origin'), converted.rows);
  check('ohne Altstatus braucht es keine Definition', convertLegacyStatusRows([rows[1]], t, 'now').definition === null);

  // i18n noch nicht bereit: `t` gibt den Schlüssel zurück — nie als Beschriftung verewigen.
  const raw = statusDefinition((key) => key, 'now');
  check('ohne Übersetzung: englische Beschriftungen statt Schlüssel',
    raw.name === 'Status' && raw.elements.map((e) => e.label).join() === 'Active,End date,Version', raw);
  const rawHtml = parseBlocks(withLegacyStatus('', { isActive: false, endDate: null, version: null }, raw, (key) => key))[0].html;
  check('ohne Übersetzung: auch der Fallback-Text ohne Schlüssel', rawHtml.includes('No') && !rawHtml.includes('blocks.'), rawHtml);
}

console.log('\n4f. Sigillen-Blöcke\n');
{
  check('Buchstabenbank: jeder Buchstabe einmal, groß, ohne Akzente',
    extractUniqueLetters('Äpfel äpfel!').join('') === 'APFEL', extractUniqueLetters('Äpfel äpfel!'));

  const calc = serializeSigilCalc(createSigilCalcBlock(), { intention: 'Ich <b>bin</b>', letters: ['I', 'C'], implemented: ['I', 'X'] });
  const calcBack = parseSigilCalc(parseBlocks(serializeBlocks([calc, createTextBlock('<p>x</p>')]))[0]);
  check('Rechner: Round-Trip, Umgesetztes nur aus der Bank',
    calcBack.intention === 'Ich <b>bin</b>' && calcBack.letters.join() === 'I,C' && calcBack.implemented.join() === 'I', calcBack);
  check('Rechner: der Fallback ist escaped', calc.html.includes('&lt;b&gt;') && !calc.html.includes('<b>'), calc.html);

  const canvas = withSigilImage(createSigilCanvasBlock(), `${'ab'.repeat(32)}.png`);
  check('Zeichnung: der Dateiname steht als src im Markup', sigilImage(canvas) === `${'ab'.repeat(32)}.png` && canvas.html.startsWith('<img src="'));

  const odd = parseSigilCharge({ ...createSigilChargeBlock(), attrs: { 'data-block-data': JSON.stringify({ loaded: 'ja', revealDate: 'morgen', lock: 'alles' }) } });
  check('Ladung: Unsinn fällt auf sichere Werte zurück', !odd.loaded && odd.revealDate === null && odd.lock === 'entry', odd);

  const charged = serializeSigilCharge(createSigilChargeBlock(), { loaded: true, revealDate: '2030-01-01', lock: 'entry', technique: null });
  const blocks = [calc, canvas, charged];
  const before = sigilState(blocks, '2029-12-31');
  const after = sigilState(blocks, '2030-01-01');
  check('geladen vor dem Datum: verborgen und ganz gesperrt', before.concealed && before.lockEntry && before.lockSigil, before);
  check('am Enthüllungstag: sichtbar, aber weiter gesperrt', !after.concealed && after.lockEntry, after);
  const sigilOnly = sigilState([serializeSigilCharge(createSigilChargeBlock(), { loaded: true, revealDate: '2030-01-01', lock: 'sigil', technique: null })], '2029-01-01');
  check('Sperre „nur Sigille": Eintrag bearbeitbar, Sigillen-Blöcke nicht', !sigilOnly.lockEntry && sigilOnly.lockSigil);

  const content = serializeBlocks([createTextBlock('<p>Notiz</p>'), ...blocks]);
  const hiddenContent = withoutConcealed(content, '2029-12-31');
  check('verborgen: Suche und Export sehen Rechner und Zeichnung nicht',
    !hiddenContent.includes('core.sigil.calc') && !hiddenContent.includes('core.sigil.canvas') && hiddenContent.includes('Notiz'), hiddenContent);
  check('enthüllt: alles bleibt', withoutConcealed(content, '2030-02-01') === content);

  const unloaded = withChargeUnloaded(content);
  check('eine Kopie wird entladen', !sigilState(parseBlocks(unloaded), '2029-12-31').loaded && withChargeUnloaded(unloaded) === unloaded);

  const secret = { ...createTextBlock('<p>geheim</p>'), attrs: { 'data-block-hidden': '1' } };
  const exportText = {
    title: (b) => `T:${b.type}`, date: (iso) => `D:${iso}`, number: (n) => `N:${n}`, targetDate: 'Ziel', technique: 'Technik',
    loaded: 'Geladen', notLoaded: 'Offen', drawing: 'Zeichnung',
    fields: { label: (e) => e.label || e.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p },
  };
  const exportedContent = serializeBlocks([createTextBlock('<p>sichtbar</p>'), secret, ...blocks]);
  const exported = renderBlocksForExport(exportedContent, exportText, '2029-12-31');
  check('Export: ausgeblendete Blöcke und die verborgene Sigille fehlen, die Ladung bleibt',
    exported.includes('sichtbar') && !exported.includes('geheim') && !exported.includes('Ich') && !exported.includes('<img')
      && exported.includes('<dt>Ziel</dt><dd>D:2030-01-01</dd>') && exported.includes('Geladen'), exported);
  check('Export: keine Sections, Titel als Überschrift, Text ohne Titel',
    !exported.includes('<section') && exported.includes('<h3>T:core.sigil.charge</h3>') && !exported.includes('T:core.text'), exported);
  const revealed = renderBlocksForExport(exportedContent, exportText, '2030-02-01');
  check('Export nach dem Zieldatum: Rechner und Zeichnung (mit Alt-Text) sind dabei',
    revealed.includes('Ich &lt;b&gt;bin') && revealed.includes(`<img src="${'ab'.repeat(32)}.png" alt="Zeichnung" data-export-placeholder="1">`), revealed);

  const fieldsBlock = {
    id: 'fx', type: 'core.fields', html: '',
    attrs: {
      'data-block-config': JSON.stringify({
        elements: [
          { id: 'e1', kind: 'date', label: 'Datum' },
          { id: 'e2', kind: 'number', label: 'Leer' },
          { id: 'e3', kind: 'shorttext', label: 'Alt', archived: true },
          { id: 'e4', kind: 'number', label: 'Menge' },
        ],
        display: { readHideEmpty: true },
      }),
      'data-block-data': JSON.stringify({ values: { e1: '2030-05-01', e3: 'weg', e4: 3 } }),
    },
  };
  const titled = { ...createTextBlock('<p>mit Titel</p>'), attrs: { 'data-block-show-title': '1' } };
  const fieldsOut = renderBlocksForExport(serializeBlocks([fieldsBlock, titled]), exportText, '2030-01-01');
  check('Export: Felder wie im Lesemodus — formatiert, ohne Leeres und Archiviertes',
    fieldsOut.includes('<dt>Datum</dt><dd>D:2030-05-01</dd>') && fieldsOut.includes('<dt>Menge</dt><dd>N:3</dd>')
      && !fieldsOut.includes('Leer') && !fieldsOut.includes('weg'), fieldsOut);
  check('Export: ein Textblock mit eingeschaltetem Titel trägt ihn', fieldsOut.includes('<h3>T:core.text</h3><p>mit Titel</p>'), fieldsOut);

  const journalSigil = serializeBlocks([createTextBlock('<p>Tagebuch</p>'), ...blocks]);
  check('eine Sigille im Journal verbirgt sich genauso', !withoutConcealed(journalSigil, '2029-12-31').includes('core.sigil.calc'));
  check('Buchstabenliste: höchstens 500, nur kurze Zeichenketten',
    letterList([...Array(2000).fill('A'), 'x'.repeat(9), 3]).length === 500 && letterList(['AB', 'x'.repeat(9), 3]).join() === 'AB');
  const t0 = Date.now();
  parseSigilCharge({ ...createSigilChargeBlock(), html: '<p '.repeat(50000) });
  check('Ladetechnik-Regex bleibt auf präpariertem Markup schnell', Date.now() - t0 < 500, `${Date.now() - t0} ms`);
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
