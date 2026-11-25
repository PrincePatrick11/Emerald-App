/**
 * Checks the block format in stored content (`src/lib/blocks/blockHtml.ts`):
 * legacy content without a wrapper, round trips, unknown block types, attribute entities,
 * foreign `<section>` tags in text.
 *
 * Runs under Node without a browser — the same environment in which migrations and
 * schema-check need these functions later. That is why `blockHtml.ts` must not
 * use a `DOMParser`, and this test enforces it.
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
// Derived from this script's location, not from cwd — also works from another directory.
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

const entry = join(workDir, 'entry.ts');
writeFileSync(
  entry,
  `export { parseBlocks, serializeBlocks, createTextBlock, blockSectionHtml, neutralizeSectionTags } from '${root}/src/lib/blocks/blockHtml';
   export { TEXT_BLOCK_TYPE, BLOCK_ATTR } from '${root}/src/lib/blocks/types';
   export { parseFields, serializeFields, createFieldsBlock, isElementEmpty, isHiddenInRead, linkFromSlot, imageFromSlot } from '${root}/src/lib/blocks/fields';
   export { instantiateDefinition, parseDefinitionElements, parseDefinitionDisplay, remapDefinitionDefaults, definitionImageRefs } from '${root}/src/lib/blocks/definitions';
   export { entryBlockSummary, entryBlockValue } from '${root}/src/lib/blocks/entrySummary';
   export { createSigilBlock, parseSigilCharge, serializeSigilCharge, sigilPartBlock, sigilPartId, withSigilPart, shownSigilParts, isSigilBroken, SIGIL_SETTINGS } from '${root}/src/lib/blocks/sigil';
   export { extractUniqueLetters, parseSigilCalc, serializeSigilCalc, letterList } from '${root}/src/lib/blocks/sigilCalc';
   export { contentSearchText } from '${root}/src/lib/searchText';
   export { paintDocFromJson, paintDocToJson, emptyPaintDoc, isPaintDocEmpty, thinPoints, transformStroke, mergeDown, canMergeDown, strokeSamples, inPolygon, symmetricCopies, mirrorStroke, splitStroke } from '${root}/src/lib/paint/document';
   export { symbolFromDrawing } from '${root}/src/components/editors/canvas/symbols/fromDrawing';
   export { readUserSymbol } from '${root}/src/lib/userSymbols';
   export { group, ungroup, withGroups, moveInStack, copiesOf, align } from '${root}/src/components/editors/canvas/canvasActions';
   export { renderBlocksForExport } from '${root}/src/lib/blocks/exportRender';
   export { createPaintBlock, PAINT_BLOCK_TYPE, parseDrawing, withDrawing, withDrawingImage, drawingImage } from '${root}/src/lib/blocks/paint';
   export { resolveBlockType, registerBlockType, upgradeBlock, blockSearchText, blockStorageTag, blockActionsOf, withDuplicatedBlock, copiedBlock, entryEffects } from '${root}/src/lib/blocks/blockTypes';
   export { readBlockSettings, withBlockSetting, RefReporter } from '${root}/src/lib/blocks/toolkit';
   export { blockSuggestions, resolveProperty } from '${root}/src/lib/blocks/entryProperties';
   export { createCanvasBlock, parseCanvasBlock, withCanvasScene, withCanvasParts, withCanvasStripTag, withoutCanvasFile, CANVAS_BLOCK_TYPE, ALTAR_BLOCK_TYPE } from '${root}/src/lib/blocks/canvas';
   export { resolveStartTemplate, instantiateTemplateBlocks, templateStart, mergeTemplateTags, areBlocksEmpty, fieldsWithTemplate, fieldsWithoutTemplate } from '${root}/src/lib/blocks/templates';
   export { internalLinkChipHtml } from '${root}/src/lib/internalLinkHtml';
   export { extractInternalLinks } from '${root}/src/lib/internalLinkHtml';
   export { toBlockRow, fromBlockRow } from '${root}/src/lib/blocks/blockRows';
   export { htmlPlainText } from '${root}/src/lib/blocks/plainText';
   export { blockRefs, blockTagsOf, linkedIdsOf, blockWithoutImage } from '${root}/src/lib/blocks/blockRefs';
   export { withoutImage } from '${root}/src/lib/imageUsage';
   export { keyBetween, evenKeys, positionsFor, isPositionKey } from '${root}/src/lib/blocks/position';
   export { blocksOfContent, planBlockWrite, clearSavedBlocks, contentOf } from '${root}/src/lib/blockStore';
   export { contentToBlocks, blocksToContent, parseManifest, renameStoredFiles, relinkWithinFile, gentlestImageMode, storedNameStem, EMERALD_FORMAT_VERSION } from '${root}/src/lib/emerald/manifest';`
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
  instantiateDefinition, parseDefinitionElements, parseDefinitionDisplay, entryBlockSummary, entryBlockValue,
  extractUniqueLetters, parseSigilCalc, serializeSigilCalc, letterList, contentSearchText,
  createSigilBlock, parseSigilCharge, serializeSigilCharge, sigilPartBlock, sigilPartId, withSigilPart, shownSigilParts, isSigilBroken, SIGIL_SETTINGS,
  drawingImage, withDrawingImage, renderBlocksForExport, parseDrawing, withDrawing,
  paintDocFromJson, paintDocToJson, emptyPaintDoc, isPaintDocEmpty, thinPoints, transformStroke, mergeDown, canMergeDown, strokeSamples, inPolygon, symmetricCopies, mirrorStroke, splitStroke,
  group, ungroup, withGroups, moveInStack, copiesOf, align,
  symbolFromDrawing, readUserSymbol,
  remapDefinitionDefaults, definitionImageRefs,
  resolveStartTemplate, instantiateTemplateBlocks,
  templateStart, mergeTemplateTags, areBlocksEmpty,
  fieldsWithTemplate, fieldsWithoutTemplate,
  createCanvasBlock, parseCanvasBlock, withCanvasScene, withCanvasParts, withCanvasStripTag, withoutCanvasFile, CANVAS_BLOCK_TYPE, ALTAR_BLOCK_TYPE,
  createPaintBlock, PAINT_BLOCK_TYPE, resolveBlockType,
  registerBlockType, upgradeBlock, blockSearchText, blockStorageTag, blockActionsOf, withDuplicatedBlock, copiedBlock, entryEffects,
  readBlockSettings, withBlockSetting, RefReporter, blockSuggestions, resolveProperty, blockTagsOf, linkedIdsOf, blockWithoutImage,
  toBlockRow, fromBlockRow, htmlPlainText, blockRefs, withoutImage, keyBetween, evenKeys, positionsFor, isPositionKey,
  blocksOfContent, planBlockWrite, clearSavedBlocks, contentOf,
  contentToBlocks, blocksToContent, parseManifest, renameStoredFiles, relinkWithinFile, gentlestImageMode, storedNameStem,
  EMERALD_FORMAT_VERSION,
} = bundle;

const failures = [];
function check(label, ok, detail) {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    failures.push(label);
  }
}

const roundTrips = (html) => serializeBlocks(parseBlocks(html)) === html;
const types = (blocks) => blocks.map((b) => b.type);

console.log('\n1. Legacy content without a wrapper\n');
{
  const legacy = '<p>Hallo <strong>Welt</strong></p><ul><li><p>eins</p></li></ul>'; // lang-ok
  const blocks = parseBlocks(legacy);
  check('is exactly one text block', blocks.length === 1 && blocks[0].type === TEXT_BLOCK_TYPE, blocks);
  check('with unchanged HTML', blocks[0]?.html === legacy, blocks[0]?.html);
  check('is written back byte for byte (no wrapper)', roundTrips(legacy));
  check('empty content yields no blocks', parseBlocks('').length === 0);
  check('no blocks yield empty content', serializeBlocks([]) === '');
  check('an empty text block yields empty content', serializeBlocks([createTextBlock()]) === '');
}

console.log('\n2. Several blocks\n');
{
  const blocks = [createTextBlock('<p>a</p>'), createTextBlock('<p>b</p>')];
  const html = serializeBlocks(blocks);
  check(
    'are written as sections',
    html.startsWith(`<section data-block="core.text" data-block-id="${blocks[0].id}">`),
    html
  );
  check('and come back identical (IDs, types, HTML)', isDeepStrictEqual(parseBlocks(html), blocks), parseBlocks(html));

  const hidden = [{ ...createTextBlock('<p>x</p>'), attrs: { 'data-block-hidden': '1' } }];
  const hiddenHtml = serializeBlocks(hidden);
  check('a single text block WITH an attribute stays wrapped', hiddenHtml.startsWith('<section'), hiddenHtml);
  check('and keeps the attribute', parseBlocks(hiddenHtml)[0]?.attrs['data-block-hidden'] === '1');
}

console.log('\n3. Unknown types and attributes\n');
{
  const unknown =
    '<section data-block="plugin.x" data-block-id="u1" data-block-v="3" ' +
    'data-block-data="{&quot;a&quot;:&quot;&lt;b&gt; &amp; c&quot;}"><p>Fallback</p></section>';
  const [block] = parseBlocks(unknown);
  check('type is preserved', block?.type === 'plugin.x', block);
  check('attributes are decoded', block?.attrs['data-block-data'] === '{"a":"<b> & c"}', block?.attrs);
  check('attribute order is preserved', Object.keys(block?.attrs ?? {}).join() === 'data-block-v,data-block-data');
  check('unknown block comes back byte for byte', roundTrips(unknown), serializeBlocks(parseBlocks(unknown)));

  const hostile = '<section data-block="plugin.x" data-block-id="u4" onclick="alert(1)" class="c" data-ok="2"></section>';
  const [cleaned] = parseBlocks(hostile);
  check('only data-* is passed through', isDeepStrictEqual(cleaned?.attrs, { 'data-ok': '2' }), cleaned?.attrs);

  const noId = parseBlocks('<section data-block="plugin.x"><p>x</p></section>')[0];
  check('a block without an ID gets one', typeof noId?.id === 'string' && noId.id.length > 0, noId);

  const upper = parseBlocks('<SECTION DATA-BLOCK="plugin.x" data-block-id="u6"><p>x</p></SECTION>');
  check('tag case does not matter', upper.length === 1 && upper[0].type === 'plugin.x', upper);
}

console.log('\n4. Loose content and foreign sections\n');
{
  const mixed = '<p>vor</p><section data-block="plugin.x" data-block-id="u1"><p>mitte</p></section><p>nach</p>'; // lang-ok
  const blocks = parseBlocks(mixed);
  check(
    'loose content before and after a block becomes one text block each',
    isDeepStrictEqual(types(blocks), [TEXT_BLOCK_TYPE, 'plugin.x', TEXT_BLOCK_TYPE]) &&
      blocks[0].html === '<p>vor</p>' && blocks[2].html === '<p>nach</p>', // lang-ok
    blocks
  );

  const spaced = '<section data-block="plugin.x" data-block-id="a"></section>\n  <section data-block="plugin.x" data-block-id="b"></section>';
  check('whitespace between blocks does not create a text block', parseBlocks(spaced).length === 2, parseBlocks(spaced));

  const foreign = '<section><p>x</p></section><section data-block="plugin.x" data-block-id="u2"><p>y</p></section>';
  const f = parseBlocks(foreign);
  check(
    'a <section> without data-block stays text and does not disturb the following block',
    f.length === 2 && f[0].type === TEXT_BLOCK_TYPE && f[0].html === '<section><p>x</p></section>' &&
      f[1].type === 'plugin.x' && f[1].html === '<p>y</p>',
    f
  );

  const nested = '<section data-block="plugin.x" data-block-id="u3"><section><p>i</p></section><p>j</p></section><p>k</p>';
  const n = parseBlocks(nested);
  check(
    'a section inside the block does not close it early',
    n.length === 2 && n[0].html === '<section><p>i</p></section><p>j</p>' && n[1].html === '<p>k</p>',
    n
  );

  const broken = parseBlocks('<p>a</p><section data-block="plugin.x" data-block-id="u5"><p>kaputt'); // lang-ok
  check(
    'a block that is never closed keeps the rest instead of losing it',
    broken.length === 2 && broken[1].type === 'plugin.x' && broken[1].html === '<p>kaputt', // lang-ok
    broken
  );
}

console.log('\n4b. Deception attempts\n');
{
  // This is how an older WebKit writes a chip whose target title looks like a block tag:
  // `<` in the attribute value stays unescaped.
  const trap = '<p><span data-type="internalLink" data-label="<section data-block=&quot;x&quot;>">t</span> Rest</p>';
  const html = serializeBlocks([createTextBlock('<p>a</p>'), createTextBlock(neutralizeSectionTags(trap))]);
  const blocks = parseBlocks(html);
  check(
    'a <section> in a chip attribute value does not split the text block',
    blocks.length === 2 && blocks.every((b) => b.type === TEXT_BLOCK_TYPE) && blocks[1].html.includes('Rest'),
    blocks
  );

  const dup = parseBlocks(
    '<section data-block="plugin.x" data-block-id="same"></section><section data-block="plugin.x" data-block-id="same"></section>'
  );
  check('duplicate block IDs are resolved on reading', dup.length === 2 && dup[0].id !== dup[1].id, dup);

  const quoted = parseBlocks('<section data-block="plugin.x" data-block-id="q" data-block-data="a>b"><p>x</p></section>');
  check(
    'a > in a quoted section attribute does not end the tag',
    quoted.length === 1 && quoted[0].attrs['data-block-data'] === 'a>b' && quoted[0].html === '<p>x</p>',
    quoted
  );

  const commented = parseBlocks(
    '<section data-block="plugin.x" data-block-id="c1"><p>a</p><!-- </section> --><p>b</p></section>' +
      '<!-- <section data-block="plugin.y" data-block-id="c2"> -->'
  );
  check(
    'section tags in comments do not count',
    commented.length === 2 && commented[0].html === '<p>a</p><!-- </section> --><p>b</p>' && commented[1].type === TEXT_BLOCK_TYPE,
    commented
  );

  const inAttr = parseBlocks(
    '<section data-block="plugin.x" data-block-id="h"><a href="x</section>y">l</a></section><p>danach</p>' // lang-ok
  );
  check(
    'a </section> in an attribute value does not close the block',
    inAttr.length === 2 && inAttr[0].html === '<a href="x</section>y">l</a>' && inAttr[1].html === '<p>danach</p>', // lang-ok
    inAttr
  );
}

console.log('\n4c. Field block\n');
{
  const text = { label: (el) => el.label || el.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p }; // lang-ok

  const fresh = parseFields(createFieldsBlock('shorttext'));
  check(
    'a new field block has one element and the default display rules',
    fresh.elements.length === 1 && fresh.elements[0].kind === 'shorttext' &&
      fresh.display.readHideEmpty === true && fresh.display.readOnly === false,
    fresh
  );
  check('an empty element is empty and hidden in read mode',
    isElementEmpty(fresh.elements[0], fresh) && isHiddenInRead(fresh.elements[0], fresh));

  const block = createFieldsBlock('shorttext');
  const model = parseFields(block);
  const el = model.elements[0];
  const written = serializeFields(block, { ...model, values: { [el.id]: '<b>fett</b> & so' } }, text); // lang-ok
  check('the value is in the JSON', JSON.parse(written.attrs[BLOCK_ATTR.data]).values[el.id] === '<b>fett</b> & so'); // lang-ok
  check('and escaped in the fallback', written.html.includes('&lt;b&gt;fett&lt;/b&gt; &amp; so') && !written.html.includes('<b>'), written.html); // lang-ok

  const reparsed = parseFields(parseBlocks(serializeBlocks([written]))[0]);
  check('round trip through the block format', reparsed.values[el.id] === '<b>fett</b> & so', reparsed); // lang-ok

  const linkBlock = createFieldsBlock('link');
  const linkModel = parseFields(linkBlock);
  const linkEl = linkModel.elements[0];
  const chip = internalLinkChipHtml({ id: '22222222-2222-2222-2222-222222222222', targetKind: 'entry', label: 'Ziel "A"' }); // lang-ok
  const withLink = serializeFields(linkBlock, { ...linkModel, slots: { [linkEl.id]: chip } }, text);
  check('the link is a slot in the markup, not in the JSON',
    withLink.html.includes(`data-block-slot="el:${linkEl.id}"`) && !(withLink.attrs[BLOCK_ATTR.data] ?? '').includes('2222'),
    withLink);
  const html = serializeBlocks([createTextBlock('<p>x</p>'), withLink]);
  check('extractInternalLinks finds the link in the field block', extractInternalLinks(html).length === 1);
  const slotBack = parseFields(parseBlocks(html)[1]).slots[linkEl.id];
  const target = linkFromSlot(slotBack);
  check('the slot reads back with its label', target?.id === '22222222-2222-2222-2222-222222222222' && target?.label === 'Ziel "A"', target); // lang-ok

  const imgBlock = createFieldsBlock('image');
  const imgModel = parseFields(imgBlock);
  const imgEl = imgModel.elements[0];
  const name = `${'ab'.repeat(32)}.png`;
  const withImg = serializeFields(imgBlock, { ...imgModel, slots: { [imgEl.id]: `<img src="${name}">` } }, text);
  check('the image is a src in the markup (image cleanup finds it)', withImg.html.includes(`src="${name}"`) && imageFromSlot(parseFields(withImg).slots[imgEl.id]) === name);

  const textBlock = createFieldsBlock('text');
  const textModel = parseFields(textBlock);
  const textEl = textModel.elements[0];
  check('an empty text element is empty', isElementEmpty(textEl, { ...textModel, slots: { [textEl.id]: '<h2></h2><ul><li><p></p></li></ul>' } }));
  const richHtml = `<h2>Titel</h2><ul><li><p>Punkt</p></li></ul><p>mit ${chip}</p>`; // lang-ok
  const withText = serializeFields(textBlock, { ...textModel, slots: { [textEl.id]: richHtml } }, text);
  const textBack = parseFields(parseBlocks(serializeBlocks([withText]))[0]);
  check('a text element is HTML in the slot and reads back',
    textBack.slots[textEl.id] === richHtml && !isElementEmpty(textEl, textBack), textBack);
  check('extractInternalLinks finds the link in the text element', extractInternalLinks(serializeBlocks([withText])).length === 1);

  const broken = parseFields({ id: 'x', type: 'core.fields', html: '', attrs: { [BLOCK_ATTR.config]: '{kaputt', [BLOCK_ATTR.data]: '[1,2' } }); // lang-ok
  check('broken JSON yields an empty block instead of an error', broken.elements.length === 0 && Object.keys(broken.values).length === 0);

  const orphanBlock = { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify({ values: { weg: 'bleibt', [el.id]: 42 } }) } }; // lang-ok
  const orphanModel = parseFields(orphanBlock);
  check('a value of the wrong kind is discarded', orphanModel.values[el.id] === undefined);
  const orphanOut = serializeFields(orphanBlock, orphanModel, text);
  check('values without a known element are preserved', JSON.parse(orphanOut.attrs[BLOCK_ATTR.data]).values.weg === 'bleibt'); // lang-ok

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
  check('element IDs like constructor/__proto__/toString are discarded, nothing throws',
    !threw && hostileModel.elements.length === 1 && hostileModel.elements[0].id === 'ok-1', hostileModel?.elements);

  const toggleBlock = createFieldsBlock('toggle');
  const toggleModel = parseFields(toggleBlock);
  const toggleEl = toggleModel.elements[0];
  check('yes/no is never empty — unset means no',
    !isElementEmpty(toggleEl, toggleModel) && !isElementEmpty(toggleEl, { ...toggleModel, values: { [toggleEl.id]: false } }));

  const brokenConfig = parseFields({ id: 'b', type: 'core.fields', html: '', attrs: { [BLOCK_ATTR.config]: '{kaputt' } }); // lang-ok
  const brokenData = parseFields({ ...block, attrs: { ...block.attrs, [BLOCK_ATTR.data]: '"nur ein Text"' } }); // lang-ok
  check('unreadable config or data set broken', brokenConfig.broken && brokenData.broken && !model.broken);

  const orphanSlot = serializeFields(block, { ...model, slots: { weg: chip } }, text);
  check('a slot without a known element survives writing',
    parseFields(orphanSlot).slots.weg === chip && extractInternalLinks(orphanSlot.html).length === 1, orphanSlot.html);

  const selectBlock = createFieldsBlock('select');
  const selectModel = parseFields(selectBlock);
  const selectEl = { ...selectModel.elements[0], options: [{ id: 'o1', label: 'Eins' }] }; // lang-ok
  check('a value with a deleted option counts as empty',
    isElementEmpty(selectEl, { ...selectModel, elements: [selectEl], values: { [selectEl.id]: 'o-geloescht' } })); // lang-ok

  const keepEmpty = { ...el, hideWhenEmpty: false };
  check('hideWhenEmpty on the element beats the block rule',
    !isHiddenInRead(keepEmpty, { ...model, elements: [keepEmpty] }) && isHiddenInRead(el, model));
}

console.log('\n4d. Custom blocks: copies\n');
{
  const text = { label: (el) => el.label || el.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p };
  const def = {
    id: 'def-1', name: 'Ritual', icon: '🕯️', sort_order: 0,
    created_at: '', updated_at: '', deleted_at: null,
    display: { readHideEmpty: true, readOnly: false, showTitle: true },
    elements: [{ id: 'e-date', kind: 'date', label: 'Datum' }, { id: 'e-result', kind: 'shorttext', label: 'Ergebnis' }],
  };

  const copy = instantiateDefinition(def, text);
  const copyModel = parseFields(copy);
  check('a copy carries name and title rule and no link to its definition',
    copyModel.name === 'Ritual' && copy.attrs['data-block-show-title'] === '1'
      && !copy.attrs['data-block-origin'] && !copy.attrs['data-block-rev'], copy);
  check('the element IDs of the copy are those of the definition',
    copyModel.elements.map((e) => e.id).join() === 'e-date,e-result');

  const filled = serializeFields(copy, { ...copyModel, values: { 'e-date': '2026-09-10', 'e-result': 'gut' } }, text);
  check('a copy notes which definition it came from, and keeps the note when its values change',
    copyModel.definition === def.id && parseFields(filled).definition === def.id, copy.attrs);
  check('a note of a foreign shape is not read',
    parseFields({ ...copy, attrs: { ...copy.attrs, 'data-block-config': JSON.stringify({ elements: [], definition: '../x y' }) } }).definition === undefined);
  const content = serializeBlocks([createTextBlock('<p>a</p>'), filled, createFieldsBlock('number')]);
  check('a field archived by an earlier version is gone from the definition',
    parseDefinitionElements(JSON.stringify([{ id: 'a', kind: 'date', label: 'A', archived: true }, { id: 'b', kind: 'date', label: 'B' }])).map((e) => e.id).join() === 'b');
  check('a copy from before keeps working with its old markers',
    parseFields({ ...filled, attrs: { ...filled.attrs, 'data-block-origin': 'def-1', 'data-block-rev': '1' } }).values['e-result'] === 'gut');

  const plainSummary = entryBlockSummary({ id: 'x', content, created_at: '2026-01-01T12:00:00Z' });
  check('a summary without sigil blocks is empty',
    !plainSummary.effects.lockEntry && plainSummary.effects.concealed.size === 0 && plainSummary.info.short.length === 0 && plainSummary.info.long.length === 0
      && plainSummary.properties.rows.length === 0 && plainSummary.values.length === 0);

  check('definition columns: broken JSON yields the defaults',
    parseDefinitionElements('{kaputt').length === 0 && parseDefinitionDisplay('nope').showTitle === true &&
      parseDefinitionDisplay('nope').readHideEmpty === true);
  check('definition columns: dangerous and duplicate IDs are dropped',
    parseDefinitionElements(JSON.stringify([
      { id: '__proto__', kind: 'date', label: '' }, { id: 'ok', kind: 'date', label: '' }, { id: 'ok', kind: 'number', label: '' },
    ])).map((e) => e.id).join() === 'ok');

  const [preset] = parseDefinitionElements(JSON.stringify([{
    id: 'e-list', kind: 'checklist', label: 'Schritte',
    defaultValue: [{ id: 'i1', text: 'Kerze', checked: false }, { id: 'i2', text: 'Räuchern', checked: true }, 'kaputt'], // lang-ok
  }]));
  const prefilledDef = {
    ...def,
    elements: [preset, { id: 'e-on', kind: 'toggle', label: 'An', defaultValue: true },
      { id: 'e-n', kind: 'number', label: 'N', defaultValue: 'drei' }, { id: 'e-pic', kind: 'image', label: 'Bild', defaultValue: 'x.png' }],
  };
  const parsedDefaults = parseDefinitionElements(JSON.stringify(prefilledDef.elements));
  check('default: checked by kind, an image only as a stored file name', parsedDefaults[0].defaultValue.length === 2
    && parsedDefaults[1].defaultValue === true && parsedDefaults[2].defaultValue === undefined
    && parsedDefaults[3].defaultValue === undefined, parsedDefaults);
  const pdef = { ...prefilledDef, elements: parsedDefaults };
  const prefilled = instantiateDefinition(pdef, text);
  const pm = parseFields(prefilled);
  const items = pm.values['e-list'];
  check('a new copy starts with the defaults, including the fallback',
    items?.map((i) => `${i.text}:${i.checked}`).join() === 'Kerze:false,Räuchern:true' && pm.values['e-on'] === true // lang-ok
      && prefilled.html.includes('Kerze') && prefilled.html.includes('<dd>Ja</dd>'), { values: pm.values, html: prefilled.html });
  check('the copy does not carry the default in its config, and items get their own IDs',
    !prefilled.attrs['data-block-config'].includes('defaultValue') && items.every((i) => i.id !== 'i1' && i.id !== 'i2'),
    prefilled.attrs['data-block-config']);
}

// A sigil is written as the UI writes it: each part as a block of its own, then back into the sigil block.
const withPart = (block, part, change) => withSigilPart(block, part, change(sigilPartBlock(block, part)));
function sigilOf({ calc, drawing, charge } = {}) {
  let block = createSigilBlock();
  if (calc) block = withPart(block, 'calc', (p) => serializeSigilCalc(p, calc));
  if (drawing) block = withPart(block, 'drawing', (p) => withDrawingImage(p, drawing));
  if (charge) block = withPart(block, 'charge', (p) => serializeSigilCharge(p, charge));
  return block;
}
const effectsOn = (blocks, today) => entryEffects(blocks, { today });
/** The texts the export is checked with: a key shows as `K:<key>`. */
const exportText = {
  title: (b) => `T:${b.type}`, date: (iso) => `D:${iso}`, number: (n) => `N:${n}`, t: (key) => `K:${key}`,
  yes: 'Ja', no: 'Nein', concealed: (until) => `C:${until}`, reveal: 'R', conceal: 'Z',
};
const drawnFile = `${'ab'.repeat(32)}.png`;
const calcData = { intention: 'Ich <b>bin</b>', letters: ['I', 'C'], implemented: ['I', 'X'] };
const chargeData = { loaded: true, revealDate: '2030-01-01', lock: 'entry', technique: null };

console.log('\n4f. Sigils\n');
{
  check('letter bank: each letter once, uppercase, without accents',
    extractUniqueLetters('Äpfel äpfel!').join('') === 'APFEL', extractUniqueLetters('Äpfel äpfel!')); // lang-ok

  const sigil = sigilOf({ calc: calcData, drawing: drawnFile, charge: chargeData });
  const back = parseBlocks(serializeBlocks([createTextBlock('<p>x</p>'), sigil]))[1];
  check('a sigil is one block of a type the app knows', sigil.type === 'core.sigil' && !!resolveBlockType(sigil) && !isSigilBroken(sigil), sigil);
  const calcBack = parseSigilCalc(sigilPartBlock(back, 'calc'));
  check('calculator: round trip, implemented letters only from the bank',
    calcBack.intention === 'Ich <b>bin</b>' && calcBack.letters.join() === 'I,C' && calcBack.implemented.join() === 'I', calcBack);
  check('calculator: the fallback is escaped', back.html.includes('&lt;b&gt;') && !back.html.includes('<b>'), back.html);
  check('drawing: its picture is a src in the block\'s markup', drawingImage(sigilPartBlock(back, 'drawing')) === drawnFile, back.html);
  check('charge: round trip', parseSigilCharge(sigilPartBlock(back, 'charge')).revealDate === '2030-01-01');
  check('parts are named <block>:<part>',
    sigilPartBlock(back, 'calc').id === sigilPartId(sigil.id, 'calc') && sigilPartId(sigil.id, 'drawing') === `${sigil.id}:drawing`);
  const [calcSetting, , chargeSetting] = SIGIL_SETTINGS;
  const shown = shownSigilParts(createSigilBlock());
  check('settings: a new sigil shows all three parts', shown.calc && shown.drawing && shown.charge, shown);
  const calcOff = withBlockSetting(sigil, calcSetting, false);
  check('settings: a part switched off is not shown, but keeps what it holds',
    !shownSigilParts(calcOff).calc && shownSigilParts(calcOff).drawing && parseSigilCalc(sigilPartBlock(calcOff, 'calc')).intention === 'Ich <b>bin</b>'
      && readBlockSettings(calcOff, SIGIL_SETTINGS).calc === false, calcOff.attrs);
  check('settings: a loaded charge stays shown even switched off, an unloaded one does not',
    shownSigilParts(withBlockSetting(sigil, chargeSetting, false)).charge
      && !shownSigilParts(withBlockSetting(sigilOf({ charge: { ...chargeData, loaded: false } }), chargeSetting, false)).charge);

  // The paint document: vector strokes as data JSON, the rendered image and layer images as src.
  {
    const canvas = withDrawingImage(createPaintBlock(), drawnFile);
    check('drawing: the file name is a src in the markup', drawingImage(canvas) === drawnFile && canvas.html.startsWith('<img src="'));
    const old = `${'ab'.repeat(32)}.png`;
    const render = `${'cd'.repeat(32)}.png`;
    const legacy = parseDrawing(canvas);
    check('drawing: an old image becomes the only layer, nothing lost',
      legacy.render === old && legacy.doc?.layers.length === 1 && legacy.doc.layers[0].image === old && legacy.doc.layers[0].strokes.length === 0, legacy);
    check('drawing: an empty block has neither image nor document', parseDrawing(createPaintBlock()).doc === null);

    const stroke = { id: 's1', tool: 'pen', color: '#EF4444', size: 8, points: [1.234, 2.345, 0.5, 10, 20, 0.777], pressure: true };
    const doc = { layers: [{ ...legacy.doc.layers[0], strokes: [stroke] }, { id: 'top', name: 'Oben', hidden: true, image: null, strokes: [] }] }; // lang-ok
    const saved = withDrawing(canvas, render, doc);
    const back = parseDrawing(parseBlocks(serializeBlocks([saved]))[0]);
    check('drawing: the render comes first, the layer image after it, both as src',
      drawingImage(saved) === render && saved.html.includes(`src="${old}"`) && saved.html.indexOf(render) < saved.html.indexOf(old), saved.html);
    check('drawing: round trip keeps layers, strokes, the layer image; points rounded',
      back.render === render && back.doc?.layers.length === 2 && back.doc.layers[0].image === old
        && back.doc.layers[1].name === 'Oben' && back.doc.layers[1].hidden // lang-ok
        && isDeepStrictEqual(back.doc.layers[0].strokes[0].points, [1.2, 2.3, 0.5, 10, 20, 0.78])
        && back.doc.layers[0].strokes[0].color === '#ef4444' && back.doc.layers[0].strokes[0].pressure, back);
    const exported = renderBlocksForExport(serializeBlocks([saved]), 'pdf', exportText);
    check('drawing: the export shows only the render', exported.includes(render) && !exported.includes(old), exported);

    // Something that knows only the image (an older app) replaced it: the new image counts, as a layer.
    const replaced = { ...saved, html: `<img src="${'ef'.repeat(32)}.png" alt="">` };
    const stale = parseDrawing(replaced);
    check('drawing: an unmarked image wins over a stale document',
      stale.doc?.layers.length === 1 && stale.doc.layers[0].image === `${'ef'.repeat(32)}.png`, stale);

    const emptied = withDrawing(saved, null, null);
    check('drawing: emptied, the block holds nothing', emptied.html === '' && emptied.attrs['data-block-data'] === undefined, emptied);
    check('drawing: an empty document is empty', isPaintDocEmpty(emptyPaintDoc()) && !isPaintDocEmpty(doc));

    const junk = paintDocFromJson({ v: 1, layers: [
      { id: 'a', strokes: [{ t: 'pen', s: 9999, c: 'red; x', p: [1, 2, 3, 'x'] }, { t: 'nope', s: 2, p: [1, 2, 3] }, { t: 'line', s: 2, p: [0, 0, 0.5, 5, 5, 0.5, 9, 9, 0.5] }] },
      { id: 'a', strokes: [] }, { id: '<b>', strokes: [] },
    ] });
    check('drawing: doctored JSON is bounded and cleaned',
      junk?.layers.length === 1 && junk.layers[0].strokes.length === 2 && junk.layers[0].strokes[0].size === 120
        && junk.layers[0].strokes[0].color === '#000000' && junk.layers[0].strokes[0].points.length === 3
        && junk.layers[0].strokes[0].points[2] === 1 && junk.layers[0].strokes[1].points.length === 6, junk);
    check('drawing: not a document', paintDocFromJson({ v: 2, layers: [] }) === null && paintDocFromJson('x') === null);
    const thin = thinPoints([0, 0, 0.5, 0.1, 0.1, 0.5, 0.2, 0.2, 0.5, 5, 5, 0.5, 5.1, 5.1, 0.5]);
    check('drawing: thinning drops close points, keeps the ends', isDeepStrictEqual(thin, [0, 0, 0.5, 5, 5, 0.5, 5.1, 5.1, 0.5]), thin);

    // Layer extras and turned shapes: stored only when they differ, older documents read with the defaults.
    const extras = paintDocFromJson(paintDocToJson({ layers: [
      { id: 'a', name: '', hidden: false, locked: true, opacity: 0.456, image: null, imageRect: { x: 0, y: 0, width: 1200, height: 800 },
        strokes: [{ id: 'r', tool: 'rect', color: '#112233', size: 4, points: [10, 10, 0.5, 50, 30, 0.5], pressure: false, rotation: 0.5 }] },
    ] }));
    check('drawing: lock, opacity and a turned rectangle survive the round trip',
      extras?.layers[0].locked && extras.layers[0].opacity === 0.46 && extras.layers[0].strokes[0].rotation === 0.5, extras);
    const plain = paintDocFromJson({ v: 1, layers: [{ id: 'a', strokes: [{ t: 'pen', s: 2, p: [1, 2, 0.5] }] }] });
    check('drawing: an older layer is unlocked, opaque, its image the whole page, its strokes unturned',
      plain?.layers[0].locked === false && plain.layers[0].opacity === 1 && plain.layers[0].imageRect.width === 1200
        && plain.layers[0].strokes[0].rotation === 0, plain);
    const pen = { id: 'p', tool: 'pen', color: '#000000', size: 10, points: [0, 0, 0.5, 10, 0, 0.5], pressure: false, rotation: 0, filled: false, sides: 5, rings: [] };
    const scaled = transformStroke(pen, { dx: 5, dy: 0, scale: 2, angle: 0, cx: 0, cy: 0 });
    check('drawing: a transform moves and scales points and width', isDeepStrictEqual(scaled.points, [5, 0, 0.5, 25, 0, 0.5]) && scaled.size === 20, scaled);
    const layerOf = (id, strokes, image = null) => ({ id, name: '', hidden: false, locked: false, opacity: 1, image, imageRect: { x: 0, y: 0, width: 1200, height: 800 }, strokes });
    const two = { layers: [layerOf('low', [pen]), layerOf('up', [{ ...pen, id: 'q' }])] };
    const merged = mergeDown(two, 'up');
    check('drawing: merging down appends the strokes to the layer below',
      merged.layers.length === 1 && merged.layers[0].strokes.map((x) => x.id).join() === 'p,q', merged);
    check('drawing: a layer with eraser strokes or an image does not merge',
      !canMergeDown({ layers: [layerOf('low', []), layerOf('up', [{ ...pen, tool: 'eraser' }])] }, 'up')
        && !canMergeDown({ layers: [layerOf('low', []), layerOf('up', [], 'x.png')] }, 'up') && !canMergeDown(two, 'low'));
    const shapes = paintDocFromJson(paintDocToJson({ layers: [layerOf('s', [
      { ...pen, id: 'st', tool: 'star', sides: 7, filled: true, points: [0, 0, 0.5, 100, 100, 0.5], rings: [] },
      { ...pen, id: 'fi', tool: 'fill', points: [5, 5, 1], rings: [[0, 0, 10, 0, 10, 10, 0, 10], [2, 2, 4, 2, 4, 4]] },
    ])] }));
    const [star, fill] = shapes?.layers[0].strokes ?? [];
    check('drawing: a filled star keeps its points, a fill its outlines',
      star?.sides === 7 && star.filled && fill?.tool === 'fill' && fill.rings.length === 2 && fill.rings[1].length === 6, shapes);
    check('drawing: an older document gets outlined shapes and no fill outlines',
      plain?.layers[0].strokes[0].filled === false && plain.layers[0].strokes[0].rings.length === 0, plain);
    const left = { ...pen, points: [100, 100, 0.5, 200, 100, 0.5] };
    check('drawing: mirror symmetry adds the copy across the middle',
      isDeepStrictEqual(symmetricCopies(left, { kind: 'mirror' })[0].points, [1100, 100, 0.5, 1000, 100, 0.5])
        && symmetricCopies(left, { kind: 'quad' }).length === 3 && symmetricCopies(left, { kind: 'radial', rays: 6 }).length === 5
        && symmetricCopies(left, { kind: 'off' }).length === 0);
    check('drawing: a mirrored polygon mirrors its turn',
      mirrorStroke({ ...pen, tool: 'polygon', rotation: 0.3, points: [0, 0, 0.5, 10, 10, 0.5] }, 'x', 600).rotation === -0.3);
    const long = { ...pen, points: [0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5, 30, 0, 0.5, 40, 0, 0.5, 50, 0, 0.5] };
    const split = splitStroke(long, (x) => x >= 15 && x <= 35);
    check('drawing: a freehand stroke is cut where it leaves the area, the pieces meeting',
      split?.pieces.length === 3 && split.inside.length === 1
        && isDeepStrictEqual(split.inside[0].points, [10, 0, 0.5, 20, 0, 0.5, 30, 0, 0.5, 40, 0, 0.5])
        && split.pieces[0].points.length === 9 && splitStroke({ ...pen, tool: 'line', points: [0, 0, 0.5, 50, 0, 0.5] }, () => true) === null, split);
    check('drawing: a lasso takes a stroke with a point inside it',
      inPolygon(5, 5, [0, 0, 10, 0, 10, 10, 0, 10]) && !inPolygon(15, 5, [0, 0, 10, 0, 10, 10, 0, 10])
        && strokeSamples({ ...pen, tool: 'ellipse', points: [0, 0, 0.5, 20, 10, 0.5] }).length === 16);
  }

  {
    const el = (id, z, extra = {}) => ({ id, type: 'shape', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, locked: false, hidden: false, z, props: {}, ...extra });
    const scene = [el('a', 0), el('b', 1), el('c', 2), el('d', 3)];
    const order = (els) => [...els].sort((p, q) => p.z - q.z).map((e) => e.id).join('');
    const grouped = group(scene, ['a', 'c'], 'g');
    check('canvas: a group is stacked together where its topmost member was',
      order(grouped) === 'bacd' && grouped.filter((e) => e.group === 'g').length === 2, order(grouped));
    check('canvas: one member pulls in its group, ungrouping dissolves it',
      withGroups(grouped, ['a']).sort().join() === 'a,c' && ungroup(grouped, ['c']).every((e) => !e.group));
    check('canvas: a locked element stays out of a group',
      group([el('a', 0), el('b', 1, { locked: true })], ['a', 'b'], 'g').every((e) => !e.group));
    check('canvas: moving in the stack keeps the moved ones together',
      order(moveInStack(scene, ['a', 'b'], 2)) === 'cdab' && order(moveInStack(scene, ['d'], 0)) === 'dabc');
    let n = 0;
    const copies = copiesOf(grouped.filter((e) => e.group), grouped, 10, () => `n${n++}`);
    const pair = [el('a', 0, { x: 100, y: 0, group: 'g' }), el('b', 1, { x: 200, y: 0, group: 'g' }), el('c', 2, { x: 500, y: 300 })];
    const lined = align(pair, ['a', 'b', 'c'], 'left', { width: 1000, height: 600 });
    check('canvas: aligning moves a group as one, its members keeping their distance',
      lined[1].x - lined[0].x === 100 && lined[0].x === 100 && lined[2].x === 100, lined.map((e) => e.x));
    const sketch = emptyPaintDoc();
    sketch.layers[0].strokes = [
      { id: 'p', tool: 'pen', color: '#ff0000', size: 20, points: [100, 100, 0.5, 300, 200, 0.5, 500, 100, 0.5], pressure: false, rotation: 0, filled: false, sides: 5, rings: [] },
      { id: 'l', tool: 'line', color: '#00ff00', size: 10, points: [100, 400, 0.5, 500, 400, 0.5], pressure: false, rotation: 0, filled: false, sides: 5, rings: [] },
      { id: 'e', tool: 'eraser', color: '#000000', size: 40, points: [2000, 2000, 0.5, 2100, 2100, 0.5], pressure: false, rotation: 0, filled: false, sides: 5, rings: [] },
    ];
    const made = symbolFromDrawing(sketch);
    const coords = (d) => (d.match(/-?[0-9.]+/g) ?? []).map(Number);
    check('symbols: a drawing becomes lines and filled parts inside the box, the eraser left out',
      made && made.d.startsWith('M') && made.solid.length > 0 && coords(made.d + made.solid).every((n) => n >= -0.01 && n <= 100.01)
        && Math.abs(made.weight - 10 * (88 / 420)) < 0.2 && symbolFromDrawing(emptyPaintDoc()) === null, made);
    check('symbols: an own symbol from a file needs an id and plain path data',
      readUserSymbol({ id: 'a', name: 'x', d: 'M0 0L10 10', solid: '', weight: 99 })?.weight === 16
        && readUserSymbol({ id: 'b', d: '<svg/>' }) === null && readUserSymbol({ d: 'M0 0L1 1' }) === null);
    check('canvas: copies of a group form a new group of their own',
      copies.length === 2 && copies[0].group && copies[0].group !== 'g' && copies[0].group === copies[1].group, copies);
  }

  const odd = parseSigilCharge({ id: 'v', type: 'sigil.charge', html: '', attrs: { 'data-block-data': JSON.stringify({ loaded: 'ja', revealDate: 'morgen', lock: 'alles' }) } });
  check('charge: nonsense falls back to safe values', !odd.loaded && odd.revealDate === null && odd.lock === 'entry', odd);

  const calcId = sigilPartId(sigil.id, 'calc');
  const drawId = sigilPartId(sigil.id, 'drawing');
  const painting = withDrawingImage(createPaintBlock(), `${'99'.repeat(32)}.png`);
  const before = effectsOn([sigil, painting], '2029-12-31');
  const after = effectsOn([sigil, painting], '2030-01-01');
  check('loaded before the date: calculator and drawing concealed and locked, the entry locked by the sigil',
    before.concealed.get(calcId) === '2030-01-01' && before.concealed.has(drawId) && before.lockEntry && before.lockedBy.has(sigil.id)
      && before.locked.has(calcId) && before.locked.has(drawId), before);
  check('the charge leaves everything else alone (a painting, the charge itself)',
    !before.concealed.has(painting.id) && !before.locked.has(painting.id) && !before.concealed.has(sigilPartId(sigil.id, 'charge'))
      && !before.concealed.has(sigil.id), before);
  check('on the reveal day: visible, but still locked', after.concealed.size === 0 && after.lockEntry && after.locked.has(calcId), after);
  const sigilOnly = effectsOn([sigilOf({ calc: calcData, charge: { ...chargeData, lock: 'sigil' } })], '2029-01-01');
  check('lock "only this sigil": entry editable, calculator and drawing not', !sigilOnly.lockEntry && sigilOnly.locked.size === 2, sigilOnly);
  const noDate = sigilOf({ calc: calcData, charge: { ...chargeData, revealDate: null } });
  const noDateFx = effectsOn([noDate], '2099-01-01');
  check('loaded without a target date: hidden until unloaded',
    noDateFx.concealed.has(sigilPartId(noDate.id, 'calc')) && noDateFx.concealed.get(sigilPartId(noDate.id, 'calc')) === null, noDateFx);
  const other = sigilOf({ calc: { ...calcData, intention: 'Offen' } });
  const twoFx = effectsOn([sigil, other], '2029-12-31');
  check('a charge conceals only its own sigil\'s parts',
    !twoFx.concealed.has(sigilPartId(other.id, 'calc')) && !twoFx.locked.has(sigilPartId(other.id, 'calc')), twoFx);
  const unloaded = withPart(sigil, 'charge', (p) => serializeSigilCharge(p, { ...parseSigilCharge(p), loaded: false }));
  const unloadedFx = effectsOn([unloaded], '2029-12-31');
  check('unloading conceals and locks nothing any more',
    unloadedFx.concealed.size === 0 && unloadedFx.locked.size === 0 && !unloadedFx.lockEntry, unloadedFx);
  const hiddenSigil = { ...sigil, attrs: { ...sigil.attrs, [BLOCK_ATTR.hidden]: '1' } };
  check('a hidden sigil (the eye) still conceals and locks', effectsOn([hiddenSigil], '2029-12-31').concealed.has(calcId));
  const broken = { ...sigil, attrs: { ...sigil.attrs, [BLOCK_ATTR.data]: '{kaputt' } };
  check('an unreadable sigil does nothing to the entry and is marked as unreadable',
    isSigilBroken(broken) && effectsOn([broken], '2029-12-31') === effectsOn([], '2029-12-31'));
  check('switching the loaded charge off does not lift its effect',
    effectsOn([withBlockSetting(sigil, chargeSetting, false)], '2029-12-31').concealed.has(calcId));

  const content = serializeBlocks([createTextBlock('<p>Notiz</p>'), sigil]);
  const found = contentSearchText(content, '2029-12-31');
  check('search: the concealed calculator is not found, the rest of the entry is',
    found.includes('Notiz') && !found.includes('Ich') && found.includes('2030-01-01'), found);
  check('search: after the target date the calculator is found',
    contentSearchText(content, '2030-02-01').includes('Ich <b>bin</b>'), contentSearchText(content, '2030-02-01'));
  check('search: a calculator switched off is not found',
    !contentSearchText(serializeBlocks([withBlockSetting(unloaded, calcSetting, false)]), '2029-12-31').includes('Ich'));
  check('search: the block alone reads alike',
    !blockSearchText(sigil, { today: '2029-12-31' }).includes('Ich') && blockSearchText(unloaded, { today: '2029-12-31' }).includes('Ich'));
  const oddlyEncoded = content.replace(/&quot;/g, '&#34;');
  check('search: differently encoded content conceals all the same', !contentSearchText(oddlyEncoded, '2029-12-31').includes('Ich'));
  check('a sigil in the journal hides itself the same way',
    !contentSearchText(serializeBlocks([createTextBlock('<p>Tagebuch</p>'), sigil]), '2029-12-31').includes('Ich'));

  const secret = { ...createTextBlock('<p>geheim</p>'), attrs: { 'data-block-hidden': '1' } };
  const exportedContent = serializeBlocks([createTextBlock('<p>sichtbar</p>'), secret, sigil]);
  const exported = renderBlocksForExport(exportedContent, 'pdf', exportText, '2029-12-31');
  check('export: hidden blocks and the concealed parts are missing, the charge stays',
    exported.includes('sichtbar') && !exported.includes('geheim') && !exported.includes('Ich') && !exported.includes('<img')
      && exported.includes('<dt>K:creation.targetDate</dt><dd>D:2030-01-01</dd>') && exported.includes('<p>K:blocks.sigil.loaded</p>'), exported);
  check('export: no sections, the parts under their headings, no title of its own',
    !exported.includes('<section') && exported.includes('<h4>K:blocks.types.sigil.parts.charge</h4><dl>')
      && !exported.includes('<h4>K:blocks.types.sigil.parts.calc</h4>') && !exported.includes('T:core.sigil') && !exported.includes('T:core.text'), exported);
  const revealed = renderBlocksForExport(exportedContent, 'pdf', exportText, '2030-02-01');
  check('export after the target date: calculator and drawing (with alt text) are included',
    revealed.includes('<h4>K:blocks.types.sigil.parts.calc</h4><p>Ich &lt;b&gt;bin')
      && revealed.includes(`<img src="${drawnFile}" alt="K:blocks.types.sigil.parts.drawing" data-export-placeholder="1">`), revealed);
  for (const format of ['pdf', 'markdown']) {
    const out = renderBlocksForExport(exportedContent, format, exportText, '2029-12-31');
    check(`export (${format}): a concealed part is missing, with no cover`, out === exported && !out.includes('export-concealed'), out);
  }
  const html = renderBlocksForExport(exportedContent, 'html', exportText, '2029-12-31');
  check('export (HTML): the concealed parts are there, covered under their headings, with a switch',
    html.includes('<h4>K:blocks.types.sigil.parts.calc</h4><div class="export-concealed"><p class="export-concealed-cover"><span>C:2030-01-01</span><button type="button" class="export-concealed-toggle" data-reveal="R" data-conceal="Z">R</button></p><div class="export-concealed-body"><p>Ich &lt;b&gt;bin')
      && html.includes(`<div class="export-concealed-body"><img src="${drawnFile}"`)
      && (html.match(/class="export-concealed"/g) ?? []).length === 2, html);
  check('export (HTML): hidden blocks stay missing, the charge stays open',
    !html.includes('geheim') && html.includes('<p>K:blocks.sigil.loaded</p>') && !/export-concealed-body"><h4>K:blocks\.types\.sigil\.parts\.charge/.test(html), html);
  check('export (HTML): after the target date nothing is covered',
    renderBlocksForExport(exportedContent, 'html', exportText, '2030-02-01') === revealed, renderBlocksForExport(exportedContent, 'html', exportText, '2030-02-01'));
  check('export (HTML): a part switched off stays missing even concealed',
    !renderBlocksForExport(serializeBlocks([withBlockSetting(sigil, calcSetting, false)]), 'html', exportText, '2029-12-31').includes('Ich'));
  check('export: a part switched off is not exported',
    !renderBlocksForExport(serializeBlocks([withBlockSetting(unloaded, calcSetting, false)]), 'pdf', exportText, '2029-12-31').includes('Ich'));
  check('export: an unreadable sigil shows its markup, as read mode does',
    renderBlocksForExport(serializeBlocks([broken]), 'pdf', exportText, '2029-12-31').includes('Ich &lt;b&gt;bin'));
  check('the stored row text holds a concealed calculator too: the row outlives the day',
    toBlockRow(sigil).text.includes('Ich <b>bin</b>'), toBlockRow(sigil).text);

  const sigilEntry = (id, c) => ({ id, content: c, created_at: '2029-12-01T12:00:00Z' });
  const summary = entryBlockSummary(sigilEntry('sigil-one', content), '2029-12-31');
  check('the summary knows the sigil\'s effect (locked)', summary.effects.lockEntry && summary.effects.concealed.has(calcId), summary.effects);
  check('the sigil puts its target date into both forms of the info line',
    ['short', 'long'].every((form) => summary.info[form].length === 1 && summary.info[form][0].key === 'sigil.targetDate'
      && summary.info[form][0].value.iso === '2030-01-01'), summary.info);
  check('one sigil adds one target date row to the properties panel (#188)',
    summary.properties.rows.length === 1 && summary.properties.rows[0].labelKey === 'creation.targetDate'
      && summary.properties.rows[0].value.iso === '2030-01-01' && summary.properties.icon === null, summary.properties);
  check('the sigil offers its target date to filter and sort by',
    entryBlockValue(sigilEntry('sigil-one', content), 'sigil.targetDate')?.iso === '2030-01-01'
      && summary.values.length === 1 && summary.values.every((v) => v.filter && v.sort), summary.values);
  {
    // Two sigils: an unloaded one first, then a loaded one — the loaded one's date speaks, as in the info line.
    const unloadedFirst = sigilOf({ charge: { ...chargeData, loaded: false, revealDate: '2031-01-01' } });
    const loadedSecond = sigilOf({ charge: { ...chargeData, revealDate: '2032-06-01' } });
    const both = sigilEntry('two-sigils', serializeBlocks([unloadedFirst, loadedSecond]));
    const twoSummary = entryBlockSummary(both, '2029-12-31');
    check('of two sigils the loaded one gives the value to sort by, as in the info line',
      entryBlockValue(both, 'sigil.targetDate')?.iso === '2032-06-01' && twoSummary.info.long[0]?.value.iso === '2032-06-01',
      { values: twoSummary.values, info: twoSummary.info.long });
  }
  const hiddenSummary = entryBlockSummary(sigilEntry('sigil-hidden', serializeBlocks([hiddenSigil])), '2029-12-31');
  check('a hidden sigil still shows its target date in lists and still sorts by it, but adds no panel row',
    hiddenSummary.info.short[0]?.value.iso === '2030-01-01' && hiddenSummary.values[0]?.value?.iso === '2030-01-01'
      && hiddenSummary.properties.rows.length === 0, hiddenSummary);
  const noCharge = withBlockSetting(unloaded, chargeSetting, false);
  const noChargeSummary = entryBlockSummary(sigilEntry('sigil-no-charge', serializeBlocks([noCharge])), '2029-12-31');
  check('with the charge switched off there is no target date anywhere',
    noChargeSummary.info.short.length === 0 && noChargeSummary.properties.rows.length === 0 && noChargeSummary.values.length === 0, noChargeSummary);

  {
    // Duplicating: the copy right after, loaded as well, its charge acting on the copy's parts.
    const stack = withDuplicatedBlock([createTextBlock('<p>a</p>'), sigil], sigil.id, 'dup-sigil');
    const dupFx = effectsOn(stack, '2029-12-31');
    check('a duplicated sigil comes right after its original, loaded, concealing its own parts',
      stack[2]?.id === 'dup-sigil' && dupFx.concealed.has(sigilPartId('dup-sigil', 'calc')) && dupFx.concealed.has(calcId)
        && parseSigilCalc(sigilPartBlock(stack[2], 'calc')).intention === 'Ich <b>bin</b>', dupFx);
  }

  const fieldsBlock = {
    id: 'fx', type: 'core.fields', html: '',
    attrs: {
      'data-block-config': JSON.stringify({
        elements: [
          { id: 'e1', kind: 'date', label: 'Datum' },
          { id: 'e2', kind: 'number', label: 'Leer' },
          { id: 'e3', kind: 'shorttext', label: 'Alt', archived: true },
          { id: 'e4', kind: 'number', label: 'Menge' },
          { id: 'e5', kind: 'moon', label: '' },
          { id: 'e6', kind: 'image', label: 'Foto' },
        ],
        display: { readHideEmpty: true },
      }),
      'data-block-data': JSON.stringify({ values: { e1: '2030-05-01', e3: 'weg', e4: 3, e5: 'full' } }),
    },
    html: `<dl><dt>Foto</dt><dd data-block-slot="el:e6"><img src="${'ef'.repeat(32)}.png"></dd></dl>`,
  };
  const titled = { ...createTextBlock('<p>mit Titel</p>'), attrs: { 'data-block-show-title': '1' } };
  const fieldsOut = renderBlocksForExport(serializeBlocks([fieldsBlock, titled]), 'pdf', exportText, '2030-01-01');
  check('export: fields as in read mode — formatted, without empty and archived ones',
    fieldsOut.includes('<dt>Datum</dt><dd>D:2030-05-01</dd>') && fieldsOut.includes('<dt>Menge</dt><dd>N:3</dd>')
      && !fieldsOut.includes('Leer') && !fieldsOut.includes('weg'), fieldsOut);
  check('export: an unnamed field is labelled by its kind, the moon phase worded with its symbol',
    fieldsOut.includes('<dt>K:blocks.kinds.moon</dt><dd>🌕 K:moonPhase.full</dd>'), fieldsOut);
  check('export: a picture of an image field is named after its row',
    fieldsOut.includes(`<dt>Foto</dt><dd><img src="${'ef'.repeat(32)}.png" alt="Foto" data-export-placeholder="1"></dd>`), fieldsOut);
  check('export: a text block with the title switched on carries it', fieldsOut.includes('<h3>T:core.text</h3><p>mit Titel</p>'), fieldsOut);

  check('letter list: at most 500, only short strings',
    letterList([...Array(2000).fill('A'), 'x'.repeat(9), 3]).length === 500 && letterList(['AB', 'x'.repeat(9), 3]).join() === 'AB');
  const t0 = Date.now();
  parseSigilCharge({ id: 'v', type: 'sigil.charge', html: '<p '.repeat(50000), attrs: {} });
  check('charge technique regex stays fast on crafted markup', Date.now() - t0 < 500, `${Date.now() - t0} ms`);
  {
    // Opening tags without a closing one (an imported file): reading stays linear.
    const t1 = Date.now();
    sigilPartBlock({ ...createSigilBlock(), html: '<div data-sigil-part="calc">x'.repeat(40000) }, 'calc');
    parseSigilCharge({ id: 'v', type: 'sigil.charge', html: '<p data-block-slot="technique">x'.repeat(40000), attrs: {} });
    check('sigil slots stay fast on unclosed crafted markup', Date.now() - t1 < 500, `${Date.now() - t1} ms`);
  }
}

console.log('\n4g. Link and image defaults with markup\n');
{
  const linkTargetId = 'b1111111-1111-1111-1111-111111111111';
  const img = `${'cd'.repeat(32)}.png`;
  const text = {
    title: (b) => `T:${b.type}`, date: (iso) => iso, number: String, t: (key) => key,
    yes: 'Ja', no: 'Nein', concealed: (until) => `C:${until}`, reveal: 'R', conceal: 'Z',
  };
  const fallbackText = { label: (e) => e.label, yes: 'Ja', no: 'Nein', moonName: (p) => p };

  const elements = parseDefinitionElements(JSON.stringify([
    { id: 'lnk', kind: 'link', label: 'Quelle', defaultValue: { id: linkTargetId, targetKind: 'entry', label: 'Artikel' } },
    { id: 'pic', kind: 'image', label: 'Bild', defaultValue: `bilder/${img}` },
    { id: 'lnk2', kind: 'link', label: 'Kaputt', defaultValue: { id: 'nicht-uuid', targetKind: 'entry', label: 'x' } }, // lang-ok
    { id: 'pic2', kind: 'image', label: 'Fremd', defaultValue: 'javascript:alert(1)' },
    // The altar field is gone (v62 made it a link field); one left over is dropped.
    { id: 'alt', kind: 'altar', label: 'Altar' },
  ]));
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  check('defaults: link and image are read, image as a plain file name',
    byId.lnk.defaultValue?.targetKind === 'entry' && byId.pic.defaultValue === img, elements);
  check('defaults: links only valid targets, images only stored files; an altar field is no element',
    byId.lnk2.defaultValue === undefined && byId.pic2.defaultValue === undefined && !byId.alt);

  const def = {
    id: 'def-slots', name: 'Ritualplatz', icon: '🕯️', sort_order: 0,
    created_at: '', updated_at: '', deleted_at: null,
    display: { readHideEmpty: true, readOnly: false, showTitle: true }, elements,
  };
  const copy = instantiateDefinition(def, fallbackText);
  const cm = parseFields(copy);
  check('a new copy carries chip and image in its slots',
    linkFromSlot(cm.slots.lnk)?.id === linkTargetId && imageFromSlot(cm.slots.pic) === img && !cm.slots.lnk2 && !cm.slots.pic2, cm.slots);
  check('the links of the copy are in the content (link table, backlinks)',
    extractInternalLinks(serializeBlocks([copy])).length === 1);
  check('export: the link field shows its chip', renderBlocksForExport(serializeBlocks([copy]), 'pdf', text).includes('data-target-kind="entry"'));

  const remapped = parseDefinitionElements(remapDefinitionDefaults(
    JSON.stringify(elements), (name) => (name === img ? `${'ef'.repeat(32)}.png` : name),
    (t) => ({ id: `abcd1234-${t.id}`, label: 'Neu' }),
  ));
  const rm = Object.fromEntries(remapped.map((e) => [e.id, e]));
  check('import: image defaults follow the stored images, link defaults the new IDs',
    rm.pic.defaultValue === `${'ef'.repeat(32)}.png` && rm.lnk.defaultValue?.id === `abcd1234-${linkTargetId}` && rm.lnk.defaultValue?.label === 'Neu', remapped);
  check('the images of the defaults are known', definitionImageRefs(elements).join() === img);
}

console.log('\n4g2. The paint block\n');
{
  const paint = createPaintBlock();
  const render = `${'5a'.repeat(32)}.png`;
  const saved = withDrawing(paint, render, emptyPaintDoc());
  const back = parseDrawing(parseBlocks(serializeBlocks([saved]))[0]);
  check('paint: a type of its own, known to the app, a drawing like the sigil\'s',
    paint.type === PAINT_BLOCK_TYPE && !!resolveBlockType(paint));
  check('paint: picture and document survive the round trip', back.render === render && !!back.doc, back);
  const text = {
    title: () => 'Painting', date: (iso) => iso, number: String, t: (key) => key,
    yes: '', no: '', concealed: () => '', reveal: '', conceal: '',
  };
  check('paint: the export shows the picture', renderBlocksForExport(serializeBlocks([saved]), 'pdf', text).includes(render));
  check('paint: an empty one exports nothing of it', !renderBlocksForExport(serializeBlocks([paint]), 'pdf', text).includes('<img'));
}

console.log('\n5. What is derived from the content sees through the blocks\n');
{
  const chip =
    '<span data-type="internalLink" class="internal-link" data-id="11111111-1111-1111-1111-111111111111" ' +
    'data-target-kind="entry" data-label="A">A</span>';
  const html = serializeBlocks([createTextBlock('<p>ohne</p>'), createTextBlock(`<p>${chip}</p>`)]); // lang-ok
  const links = extractInternalLinks(html);
  check('extractInternalLinks finds chips in wrapped text blocks', links.length === 1 && links[0].targetKind === 'entry', links);
  const taskChip = internalLinkChipHtml({ id: '33333333-3333-3333-3333-333333333333', targetKind: 'task', label: 'T' });
  const taskLinks = extractInternalLinks(serializeBlocks([createTextBlock(`<p>${taskChip}</p>`)]));
  check('a task chip is written and read back as a task', taskChip.includes('data-target-kind="task"') && taskLinks.length === 1 && taskLinks[0].targetKind === 'task', taskLinks);
}

console.log('\n6. Templates: start template, insertion\n');
{
  const tpl = (id, content = '') => ({ id, name: id, icon: '', title: '', content, tags: [], sort_order: 0, created_at: '', updated_at: '', deleted_at: null });
  const own = tpl('own');
  const standard = tpl('standard');
  const all = [standard, own];
  check('start: the category\'s own start template before the default',
    resolveStartTemplate(all, { template_id: 'own' }, 'standard')?.id === 'own');
  check('start: a category without one gets the default',
    resolveStartTemplate(all, { template_id: null }, 'standard')?.id === 'standard');
  check('start: no category gets the default',
    resolveStartTemplate(all, null, 'standard')?.id === 'standard');
  check('start: a start template in the trash (not among the active) falls back to the default',
    resolveStartTemplate(all, { template_id: 'trashed' }, 'standard')?.id === 'standard');
  check('start: neither — none',
    resolveStartTemplate(all, { template_id: null }, null) === null && resolveStartTemplate(all, null, 'gone') === null);

  // Insertion: new IDs, everything else as it is — a loaded sigil arrives loaded, acting on its own new parts.
  const sigilBlock = sigilOf({ drawing: `${'ef'.repeat(32)}.png`, charge: { ...chargeData, revealDate: null } });
  const sigilTpl = tpl('sigil-tpl', serializeBlocks([createTextBlock('<p>Absicht</p>'), sigilBlock]));
  const first = instantiateTemplateBlocks(sigilTpl);
  const second = instantiateTemplateBlocks(sigilTpl);
  check('insertion: no block remembers the template', first.every((b) => !b.attrs['data-template-origin']), first.map((b) => b.attrs));
  check('insertion: new block IDs, different ones the second time too',
    first.every((b, i) => b.id !== parseBlocks(sigilTpl.content)[i].id && b.id !== second[i].id));
  const insertedFx = effectsOn(first, '2029-12-31');
  check('insertion: the copy stays loaded and conceals its own new drawing, which came along',
    insertedFx.concealed.has(sigilPartId(first[1].id, 'drawing')) && !insertedFx.concealed.has(sigilPartId(sigilBlock.id, 'drawing'))
      && drawingImage(sigilPartBlock(first[1], 'drawing')) === `${'ef'.repeat(32)}.png`, insertedFx);
  const existing = sigilOf({ drawing: `${'12'.repeat(32)}.png` });
  check('appended: the entry\'s own sigil stays visible',
    !effectsOn([existing, ...first], '2029-12-31').concealed.has(sigilPartId(existing.id, 'drawing')));
  check('the built-in sigil template\'s block shows all its parts', Object.values(shownSigilParts(createSigilBlock())).every(Boolean));

  // Title and tags when undoing a template.
  const journalStd = { ...sigilTpl, id: 'journal-std', title: 'Tagebuch', tags: ['tag-j'] };

  // Tags are IDs: the same ID is the same tag, there is no other spelling.
  const cleared = fieldsWithoutTemplate({ title: 'Tagebuch', tags: ['eigen', 'tag-j'] }, journalStd);
  check('fields without template: title empty again, its tags gone',
    cleared.title === '' && cleared.tags.join() === 'eigen', cleared);
  const withNew = fieldsWithTemplate(cleared, { title: ' Artikel ', tags: ['eigen', 'neu'] });
  check('fields with template: title only without a custom one, tags without duplicates',
    withNew.title === 'Artikel' && withNew.tags.join() === 'eigen,neu', withNew);
  check('fields with template: a custom title stays',
    fieldsWithTemplate({ title: 'Mein Titel', tags: [] }, { title: 'Artikel', tags: [] }).title === 'Mein Titel');
  check('fields with template: without a custom title that of the template is used',
    fieldsWithTemplate({ title: '  ', tags: [] }, { title: 'Artikel', tags: [] }).title === 'Artikel');

  check('empty: no content', areBlocksEmpty(parseBlocks('')));
  check('empty: only empty paragraphs', areBlocksEmpty(parseBlocks('<p></p><p style="text-align: center"><br></p>')));
  check('not empty: text', !areBlocksEmpty(parseBlocks('<p>x</p>')));
  check('not empty: an image', !areBlocksEmpty(parseBlocks(`<p><img src="${'a'.repeat(64)}.png"></p>`)));
  check('not empty: a field block', !areBlocksEmpty(parseBlocks(serializeBlocks([createFieldsBlock('shorttext')]))));

  const start = templateStart({ ...sigilTpl, title: '  Ritual ', tags: ['a'] });
  check('start from template: title trimmed, tags copied, content inserted',
    start.title === 'Ritual' && start.tags.join() === 'a' && parseBlocks(start.content).length === 2, start);
  check('start without template: empty, the title too',
    JSON.stringify(templateStart(null)) === JSON.stringify({ title: '', content: '', tags: [], templateId: null }));
  check('merge tags without duplicate IDs', mergeTemplateTags(['a', 'b'], ['a', 'c']).join() === 'a,b,c');

  check('empty blocks', areBlocksEmpty([createTextBlock('<p></p>')]) && !areBlocksEmpty([createTextBlock('<p>x</p>')]));
}

console.log('\nCanvas block\n');
{
  const pic = `${'a'.repeat(64)}.png`;
  const bg = `${'b'.repeat(64)}.webp`;
  const render = `${'c'.repeat(64)}.png`;
  const image = (id, file) => ({ id, type: 'image', x: 10, y: 20, width: 100, height: 50, rotation: 0, opacity: 1, locked: false, hidden: false, z: 0, ref: file, props: { src: file, emoji: '' } });
  const fresh = createCanvasBlock();
  const parsed = parseCanvasBlock(fresh);
  check('a new canvas: empty, every part but "Images" below on, no render',
    fresh.type === CANVAS_BLOCK_TYPE && parsed.scene.elements.length === 0 && !parsed.parts.images
      && parsed.parts.shapes && parsed.parts.drawing && parsed.render === null, parsed);
  const altar = parseCanvasBlock(createCanvasBlock(ALTAR_BLOCK_TYPE));
  check('a new altar: the same canvas, with "Images" below', altar.parts.images && altar.parts.shapes, altar.parts);
  check('an altar without config still has "Images" below',
    parseCanvasBlock({ id: 'a', type: ALTAR_BLOCK_TYPE, html: '', attrs: {} }).parts.images);
  check('"Images" below a new altar or canvas have no tag chosen; the altar type keeps its pictures under "Altar Library", a canvas has no storage',
    altar.stripTag === null && parsed.stripTag === null
      && blockStorageTag(createCanvasBlock(ALTAR_BLOCK_TYPE))?.id === 'altar-library' && blockStorageTag(fresh) === null,
    [altar.stripTag, parsed.stripTag]);
  const allTags = withCanvasStripTag(createCanvasBlock(ALTAR_BLOCK_TYPE), '');
  const otherTag = withCanvasParts(withCanvasStripTag(allTags, 'venus'), { ...altar.parts, shapes: false });
  check('the strip\'s tag is kept: cleared stays cleared, another one survives a change of parts',
    parseCanvasBlock(allTags).stripTag === '' && parseCanvasBlock(otherTag).stripTag === 'venus'
      && !parseCanvasBlock(otherTag).parts.shapes, parseCanvasBlock(otherTag));
  check('a foreign tag value counts as none set',
    parseCanvasBlock({ ...allTags, attrs: { ...allTags.attrs, 'data-block-config': JSON.stringify({ tag: '<x>' }) } }).stripTag === null);

  const scene = { ...parsed.scene, elements: [image('i1', pic), image('i2', pic)], background: { fill: { kind: 'none' }, image: { src: bg, fit: 'cover' }, tint: null } };
  const full = withCanvasScene(fresh, scene, render);
  check('the inner HTML: the render first, then each picture once, then the background',
    full.html === `<img src="${render}" alt="" data-canvas="render"><img src="${pic}" alt="" data-canvas="image"><img src="${bg}" alt="" data-canvas="background">`, full.html);
  const back = parseCanvasBlock(parseBlocks(serializeBlocks([full]))[0]);
  check('scene and render survive the round trip', back.render === render && back.scene.elements.length === 2 && back.scene.elements[0].ref === pic, back);

  const off = parseCanvasBlock(withCanvasParts(full, { ...parsed.parts, drawing: false, images: true })).parts;
  check('parts are kept', off.drawing === false && off.images === true);

  const without = parseCanvasBlock(withoutCanvasFile(full, pic));
  check('a picture taken out: its elements go, the render with them', without.scene.elements.length === 0 && without.render === null, without);
  const noBg = parseCanvasBlock(withoutCanvasFile(full, bg));
  check('the background picture taken out: the elements stay', noBg.scene.elements.length === 2 && noBg.scene.background.image === null, noBg.scene);

  const broken = { ...fresh, attrs: { ...fresh.attrs, [BLOCK_ATTR.data]: '{nope' } };
  check('unreadable data is broken and never rewritten', parseCanvasBlock(broken).broken && withoutCanvasFile(broken, pic) === broken);
  const foreign = { ...fresh, attrs: { ...fresh.attrs, [BLOCK_ATTR.data]: JSON.stringify({ width: 1e9, elements: [{ id: 'x y', type: 'image' }, { id: 'ok', type: 'shape', x: 'a' }] }) } };
  const read = parseCanvasBlock(foreign).scene;
  check('foreign data: sizes bounded, bad ids left out, numbers filled in',
    read.width === 8192 && read.elements.length === 1 && read.elements[0].x === 0, read);

  const exported = renderBlocksForExport(serializeBlocks([full]), 'pdf', { title: () => 'Canvas' });
  check('the export shows the rendered picture', exported.includes(render) && !exported.includes(`src="${pic}"`), exported);
}

console.log('\n7. Blocks as rows (blocks, block_refs)\n');
{
  const pic = `${'1'.repeat(64)}.png`;
  const layerPic = `${'2'.repeat(64)}.png`;
  const render = `${'3'.repeat(64)}.png`;
  const bg = `${'4'.repeat(64)}.jpg`;
  const def = `${'5'.repeat(64)}.webp`;
  const linked = '33333333-3333-3333-3333-333333333333';
  const chip = internalLinkChipHtml({ id: linked, targetKind: 'entry', label: 'Ziel' }); // lang-ok
  const fallback = { label: (e) => e.label, yes: 'Yes', no: 'No', moonName: (p) => p };

  const linkBlock = createFieldsBlock('link');
  const linkModel = parseFields(linkBlock);
  const withLink = serializeFields(linkBlock, { ...linkModel, slots: { [linkModel.elements[0].id]: chip } }, fallback);
  const imageBlock = createFieldsBlock('image');
  const imageModel = parseFields(imageBlock);
  const withImage = serializeFields(imageBlock, { ...imageModel, slots: { [imageModel.elements[0].id]: `<img src="${pic}">` } }, fallback);
  const paint = withDrawing(createPaintBlock(), render, { layers: [{ ...emptyPaintDoc().layers[0], image: layerPic }] });
  const canvasBase = createCanvasBlock();
  const canvas = withCanvasScene(canvasBase, {
    ...parseCanvasBlock(canvasBase).scene,
    elements: [{ id: 'i1', type: 'image', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, locked: false, hidden: false, z: 0, ref: pic, props: { src: pic, emoji: '' } }],
    background: { fill: { kind: 'none' }, image: { src: bg, fit: 'cover' }, tint: null },
  }, render);
  const withDefault = {
    ...createFieldsBlock('image'),
    attrs: { [BLOCK_ATTR.config]: JSON.stringify({ elements: [{ id: 'img', kind: 'image', label: 'Bild', defaultValue: def }] }) }, // lang-ok
  };
  const sigilPart = withPart(createSigilBlock(), 'drawing',
    (p) => withDrawing(p, render, { layers: [{ ...emptyPaintDoc().layers[0], id: 'L1', image: layerPic }] }));
  const oddAttrs = {
    id: 'odd', type: 'x.future',
    html: `<p>Neu ${chip}</p>`, // lang-ok
    attrs: { 'data-block-origin': 'abc', [BLOCK_ATTR.hidden]: '0', [BLOCK_ATTR.version]: 'v2', 'data-zz': 'ä"<', [BLOCK_ATTR.title]: '' }, // lang-ok
  };
  const titled = {
    ...createTextBlock(`<h2>Kopf</h2><p>eins<strong>zwei</strong> &amp; ${chip}</p><img src="${pic}">`), // lang-ok
    attrs: { [BLOCK_ATTR.showTitle]: '0', [BLOCK_ATTR.title]: 'Mein Text', [BLOCK_ATTR.hidden]: '1', [BLOCK_ATTR.version]: '3' }, // lang-ok
  };
  const samples = [titled, withLink, withImage, paint, canvas, withDefault, sigilPart, oddAttrs, createTextBlock('<p>x</p>'),
    createSigilBlock()];

  const roundTripsAsRow = (b) => {
    const back = fromBlockRow({ ...toBlockRow(b) });
    // Next to a second block, so that a plain text block is written with its section too.
    const other = { id: 'other', type: 'core.text', html: '', attrs: {} };
    return serializeBlocks([back, other]) === serializeBlocks([b, other]) && back.id === b.id && back.type === b.type;
  };
  check('every kind of block comes back from its row as the same string', samples.every(roundTripsAsRow),
    samples.filter((b) => !roundTripsAsRow(b)).map((b) => b.type));
  const oddRow = toBlockRow(oddAttrs);
  check('values the app does not write that way stay in attrs, the known ones get columns',
    oddRow.hidden === 0 && oddRow.version === null && oddRow.title === '' && JSON.parse(oddRow.attrs)['data-block-hidden'] === '0'
      && JSON.parse(oddRow.attrs)['data-block-v'] === 'v2' && JSON.parse(oddRow.attrs)['data-block-origin'] === 'abc', oddRow);
  const titledRow = toBlockRow(titled);
  check('hidden, title, show title and version have columns of their own',
    titledRow.hidden === 1 && titledRow.title === 'Mein Text' && titledRow.show_title === 0 && titledRow.version === 3 && titledRow.attrs === '{}', titledRow); // lang-ok
  const reordered = { ...titled, attrs: Object.fromEntries(Object.entries(titled.attrs).reverse()) };
  check('the instance attributes are written in one order, however the block holds them',
    serializeBlocks([reordered, oddAttrs]) === serializeBlocks([titled, oddAttrs]));
  const foreignRow = fromBlockRow({ id: 'f', type: 'core.text', html: '', attrs: '{"onclick":"x","data-ok":"1","data-block":"y","data-n":5}' });
  check('a row\'s attrs keep only data-* strings, never the type or the ID', JSON.stringify(foreignRow.attrs) === '{"data-ok":"1"}', foreignRow.attrs);
  check('unreadable attrs JSON loses only itself', Object.keys(fromBlockRow({ id: 'f', type: 'core.text', html: '', attrs: '{nope' }).attrs).length === 0);

  check('search text: tags gone, words kept apart by block elements, chips their own word, entities decoded',
    blockSearchText(titled) === 'Kopf einszwei & Ziel', blockSearchText(titled)); // lang-ok
  check('search text: a fields block reads as its fallback', blockSearchText(withLink).includes('Ziel'), blockSearchText(withLink)); // lang-ok
  check('search text: a canvas and a drawing have none', blockSearchText(canvas) === '' && blockSearchText(paint) === '');
  check('search text: an unknown type is read as its markup', blockSearchText({ id: 'u', type: 'x.y', html: '<p>Fremd</p>', attrs: {} }) === 'Fremd'); // lang-ok
  check('the row text is the block search text', toBlockRow(titled).text === blockSearchText(titled));

  const withoutVersion = (b) => ({ ...b, attrs: Object.fromEntries(Object.entries(b.attrs).filter(([k]) => k !== 'data-block-v')) });
  const refs = (b) => blockRefs(b).map((r) => `${r.kind}:${r.target === linked ? 'L' : r.target.slice(0, 1)}:${r.role}`).sort().join(' ');
  check('refs: a text block points at its chip and its picture', refs(withoutVersion(titled)) === 'entry:L:content image:1:content', refs(withoutVersion(titled)));
  check('refs: the same text block in a newer format (v3) keeps its picture as its own', refs(titled) === 'entry:L:content image:1:default', refs(titled));
  check('refs: link and image fields', refs(withLink) === 'entry:L:content' && refs(withImage) === 'image:1:content', [refs(withLink), refs(withImage)]);
  check('refs: a drawing has its render and its layers', refs(paint) === 'image:2:layer image:3:render', refs(paint));
  check('refs: a canvas has its pictures, its background and its render', refs(canvas) === 'image:1:content image:3:render image:4:background', refs(canvas));
  check('refs: a prefill is a default', refs(withDefault) === 'image:5:default', refs(withDefault));
  check('refs: a sigil\'s drawing part is a drawing', refs(sigilPart) === 'image:2:layer image:3:render', refs(sigilPart));
  check('refs: an unknown type shows what its markup shows', refs(oddAttrs) === 'entry:L:content', refs(oddAttrs));
  check('refs: no duplicates', blockRefs({ ...titled, html: titled.html + titled.html }).length === 2);
  {
    const t0 = performance.now();
    blockRefs({ id: 'x', type: 'core.text', html: '<span'.repeat(200000), attrs: {} });
    const ms = Math.round(performance.now() - t0);
    check('refs: stay fast on a long run of <span without a >', ms < 500, `${ms} ms`);
  }

  // #107: the pictures of a sigil's drawing part are the drawing — "Images" cannot take them out.
  const partStack = serializeBlocks([sigilPart, createTextBlock('<p>x</p>')]);
  check('#107: taking the render or a layer out of "Images" leaves a drawing part whole',
    withoutImage(partStack, render) === partStack && withoutImage(partStack, layerPic) === partStack);
  const imageStack = serializeBlocks([withImage, createTextBlock('<p>x</p>')]);
  check('taking a picture out of "Images" still empties an image field',
    withoutImage(imageStack, pic) !== imageStack && !withoutImage(imageStack, pic).includes(pic));

  const even = evenKeys(5);
  check('positions: evenly spread keys ascend and are valid', even.every((k, i) => isPositionKey(k) && (i === 0 || even[i - 1] < k)), even);
  const many = evenKeys(5000);
  check('positions: thousands still ascend and stay short', many.every((k, i) => i === 0 || many[i - 1] < k) && many.every((k) => k.length <= 3));
  let lo = null;
  let hi = null;
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const k = keyBetween(lo, hi);
    if ((lo !== null && !(lo < k)) || (hi !== null && !(k < hi)) || !isPositionKey(k)) ok = false;
    if (i % 2) lo = k; else hi = k;
  }
  check('positions: there is always a key in between', ok);
  const prev = new Map([['a', 'A'], ['b', 'M'], ['c', 'Z'], ['d', 'k']]);
  const moved = positionsFor(prev, ['a', 'c', 'b', 'd']);
  check('positions: moving one block changes one key', moved.filter((k, i) => k !== prev.get(['a', 'c', 'b', 'd'][i])).length === 1
    && moved.every((k, i) => i === 0 || moved[i - 1] < k), moved);
  const inserted = positionsFor(prev, ['a', 'n', 'b', 'c', 'd']);
  check('positions: inserting one keeps every other key', inserted.filter((k, i) => k !== prev.get(['a', 'n', 'b', 'c', 'd'][i])).length === 1
    && inserted.every((k, i) => i === 0 || inserted[i - 1] < k), inserted);
  const appended = positionsFor(prev, ['a', 'b', 'c', 'd', ...Array.from({ length: 1000 }, (_, i) => `n${i}`)]);
  check('positions: a thousand appended stay short and ascend', appended.every((k, i) => (i === 0 || appended[i - 1] < k) && k.length < 20));

  // The write plan against a database that has nothing saved yet.
  const db = { select: async () => [] };
  const owner = { kind: 'entry', id: 'e1' };
  clearSavedBlocks();
  const stack = [titled, withLink, paint];
  const first = await planBlockWrite(db, owner, stack, 'T1');
  first.commit();
  const upserts = (plan) => plan.statements.filter(([q]) => q.includes('INSERT INTO blocks')).length;
  check('write: a new stack writes every block, with its references',
    upserts(first) === 3 && first.statements.some(([q]) => q.includes('INSERT OR IGNORE INTO block_refs')) && first.content === serializeBlocks(stack));
  const typed = [{ ...titled, html: titled.html + '<p>mehr</p>' }, withLink, paint]; // lang-ok
  const second = await planBlockWrite(db, owner, typed, 'T2');
  check('write: a keystroke writes only its block', upserts(second) === 1 && second.changed === 1
    && second.statements.every(([, v]) => !v.includes(withLink.id) && !v.includes(paint.id)), second.statements.map(([q]) => q.slice(0, 40)));
  second.commit();
  const noop = await planBlockWrite(db, owner, typed, 'T3');
  check('write: nothing changed, nothing written', noop.statements.length === 0 && noop.changed === 0);
  const swapped = await planBlockWrite(db, owner, [typed[0], typed[2], typed[1]], 'T4');
  check('write: a move writes one position', swapped.statements.length === 1 && swapped.statements[0][0].startsWith('UPDATE blocks SET position'), swapped.statements);
  swapped.commit();
  const removed = await planBlockWrite(db, owner, [typed[0], typed[2]], 'T5');
  check('write: a removed block is deleted', removed.statements.length === 1 && removed.statements[0][0].startsWith('DELETE FROM blocks'), removed.statements);
  const ascending = [...first.statements, ...second.statements, ...swapped.statements].every(([q]) => {
    const n = [...q.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    return n.every((v, i) => i === 0 || v >= n[i - 1] || n.slice(0, i).includes(v));
  });
  check('write: placeholders ascend in every statement', ascending);

  const one = createTextBlock('<p>nur Text</p>'); // lang-ok
  check('a single plain text block keeps the ID it was saved under, though its content carries none',
    blocksOfContent(serializeBlocks([one]), [one.id])[0].id === one.id && blocksOfContent(serializeBlocks([one]), null)[0].id !== one.id);
  check('content of no blocks is empty', contentOf([]) === '');

  // Markup from imports and other devices: crafted tags without a `>`, quotes that never close,
  // a script without its end. Reading them must stay fast — this runs when a vault opens.
  const crafted = ['<script', '<a ', '<a "', '<section data-block="x" a="', '<!--', '<!-- a', "<p a='", '<style>'];
  let slowest = 0;
  for (const piece of crafted) {
    const input = piece.repeat(Math.ceil(400_000 / piece.length)) + '>';
    const started = performance.now();
    parseBlocks(input);
    htmlPlainText(input);
    slowest = Math.max(slowest, performance.now() - started);
  }
  check('crafted markup of 400 KB is read in well under a second', slowest < 1000, `${Math.round(slowest)} ms`);
  const afterUnclosed = parseBlocks('<p title="x <section data-block="core.text" data-block-id="q1">body</section>');
  check('a quote left open before a block does not hide the section of that block', afterUnclosed.some((blk) => blk.id === 'q1'),
    afterUnclosed.map((blk) => blk.id));
  check('plain text: script and style content is dropped, an unclosed script is not',
    htmlPlainText('<p>a</p><script>x()</script><style>p{}</style><p>b</p>') === 'a b'
      && htmlPlainText('<p>a</p><script>x').includes('x'), htmlPlainText('<p>a</p><script>x()</script><style>p{}</style><p>b</p>'));
  check('plain text: a chip inside a word still stands apart, formatting does not',
    htmlPlainText(`ab${chip}cd <b>fe</b>tt`) === 'ab Ziel cd fett', htmlPlainText(`ab${chip}cd <b>fe</b>tt`)); // lang-ok
}

console.log('\n7b. Block interfaces: registry, toolkit, copies, actions, settings, properties\n');

{
  let twice = false;
  try {
    registerBlockType(resolveBlockType(createTextBlock('')));
  } catch {
    twice = true;
  }
  check('a type ID registers once', twice);

  // A type of the test's own, as an extension would register one.
  registerBlockType({
    id: 'test.tagger', origin: 'plugin', icon: resolveBlockType(createTextBlock('')).icon, labelKey: 'x', descriptionKey: 'x',
    group: 'text', dataVersion: 2, defaultShowTitle: false,
    upgrade: (b, from) => ({ ...b, attrs: { ...b.attrs, 'data-block-data': JSON.stringify({ from }) } }),
    properties: {
      mayContribute: (c) => c.includes('test.tagger'),
      tags: () => ['moon-tag', '<bad>'],
      icon: () => '🌕',
      cover: () => null,
      rows: (_b, ctx) => [{ key: 'day', labelKey: 'x', value: { kind: 'date', iso: ctx.entryDate ?? '' } }],
      overridable: { icon: false, cover: true },
    },
    listInfo: {
      mayContribute: (c) => c.includes('test.tagger'),
      parts: () => [
        { key: 'both', rank: 0, icon: resolveBlockType(createTextBlock('')).icon, labelKey: 'x', value: { kind: 'text', text: 'b' } },
        { key: 'long', rank: 0, icon: resolveBlockType(createTextBlock('')).icon, labelKey: 'x', value: { kind: 'text', text: 'l' }, forms: ['long'] },
      ],
    },
    settings: [
      { key: 'show', labelKey: 'x', kind: 'toggle', initial: true },
      { key: 'mode', labelKey: 'x', kind: 'select', options: [{ value: 'a', labelKey: 'a' }, { value: 'b', labelKey: 'b' }], initial: 'a' },
    ],
  });
  const tagger = { id: 'tg', type: 'test.tagger', html: '', attrs: {} };

  // A type that conceals another block as a whole, as an extension might: covered in HTML, missing elsewhere.
  registerBlockType({
    id: 'test.veil', origin: 'plugin', icon: resolveBlockType(createTextBlock('')).icon, labelKey: 'x', descriptionKey: 'x',
    group: 'text', dataVersion: 1, defaultShowTitle: false,
    entryEffect: { mayContribute: (c) => c.includes('test.veil'), read: () => ({ concealed: new Map([['veiled', '2031-01-01']]) }) },
  });
  const veiled = { ...createTextBlock('<p>darunter</p>'), id: 'veiled', attrs: { 'data-block-show-title': '1' } };
  const veilContent = serializeBlocks([{ id: 'vl', type: 'test.veil', html: '', attrs: {} }, veiled, createTextBlock('<p>offen</p>')]);
  const veilPdf = renderBlocksForExport(veilContent, 'pdf', exportText, '2030-01-01');
  const veilHtml = renderBlocksForExport(veilContent, 'html', exportText, '2030-01-01');
  check('export: a block concealed as a whole is missing in PDF, the rest stays',
    !veilPdf.includes('darunter') && !veilPdf.includes('T:core.text') && veilPdf.includes('offen'), veilPdf);
  check('export: a block concealed as a whole is covered in HTML, its title above the cover',
    veilHtml.includes('<h3>T:core.text</h3><div class="export-concealed"><p class="export-concealed-cover"><span>C:2031-01-01</span>')
      && veilHtml.includes('<div class="export-concealed-body"><p>darunter</p></div>') && veilHtml.includes('offen'), veilHtml);
  check('a block\'s tags are references of kind tag; a malformed ID is left out',
    JSON.stringify(blockRefs(tagger)) === JSON.stringify([{ kind: 'tag', target: 'moon-tag', role: 'tag' }]), blockRefs(tagger));
  check('the tags of a stack come from its blocks', blockTagsOf([tagger, createTextBlock('<p>x</p>')]).join() === 'moon-tag');

  const up = upgradeBlock(tagger);
  check('an older block is brought up to its type\'s data version',
    up.attrs['data-block-v'] === '2' && JSON.parse(up.attrs['data-block-data']).from === 1, up);
  check('a current block stays as it is', upgradeBlock(up) === up);
  const newer = { ...tagger, attrs: { 'data-block-v': '3' } };
  check('a block from a newer version has no type here and is not touched', resolveBlockType(newer) === undefined && upgradeBlock(newer) === newer);

  const defs = resolveBlockType(tagger).settings;
  const start = readBlockSettings(tagger, defs);
  check('settings start at their start values', start.show === true && start.mode === 'a', start);
  const set = withBlockSetting(withBlockSetting(tagger, defs[0], false), defs[1], 'b');
  const read = readBlockSettings(set, defs);
  check('a setting is stored with the block and read back', read.show === false && read.mode === 'b', set.attrs);
  check('values back at their start are not stored',
    withBlockSetting(withBlockSetting(set, defs[0], true), defs[1], 'a').attrs['data-block-settings'] === undefined);
  check('a stored value that does not fit its description reads as the start value',
    readBlockSettings({ ...tagger, attrs: { 'data-block-settings': '{"show":"yes","mode":"z"}' } }, defs).mode === 'a');
  check('settings travel through a row and the content',
    fromBlockRow(toBlockRow(set)).attrs['data-block-settings'] === set.attrs['data-block-settings']
      && parseBlocks(serializeBlocks([set]))[0].attrs['data-block-settings'] === set.attrs['data-block-settings']);

  const ctx = { entryId: 'e', entryDate: '2026-11-25', today: '2026-11-25' };
  const suggested = blockSuggestions([tagger], ctx);
  const icon = resolveProperty('🔥', suggested.icon, '📓');
  check('a block\'s icon that may not be overridden stands before the user\'s',
    icon?.value === '🌕' && icon.source === 'block' && icon.blockId === 'tg', icon);
  const overridable = { ...suggested.icon, overridable: true };
  check('the user\'s value stands before an overridable block value, that before the category\'s',
    resolveProperty('🔥', overridable, '📓')?.source === 'user' && resolveProperty('', overridable, '📓')?.source === 'block'
      && resolveProperty(null, blockSuggestions([], ctx).icon, '📓')?.source === 'category');
  check('a hidden block suggests nothing', blockSuggestions([{ ...tagger, attrs: { 'data-block-hidden': '1' } }], ctx).icon === null);
  check('a block\'s rows come with its context',
    suggested.rows.length === 1 && suggested.rows[0].value.iso === '2026-11-25' && suggested.rows[0].blockId === 'tg', suggested.rows);
  const taggerSummary = entryBlockSummary({ id: 'tagger-entry', content: serializeBlocks([tagger]), created_at: '2026-11-25T12:00:00Z' });
  check('a part meant for the long form only stays out of the short one',
    taggerSummary.info.short.map((p) => p.key).join() === 'both' && taggerSummary.info.long.map((p) => p.key).join() === 'both,long',
    taggerSummary.info);
  check('the summary carries what the visible blocks suggest', taggerSummary.properties.icon?.value === '🌕', taggerSummary.properties);
}

{
  const empty = createCanvasBlock();
  check('an empty canvas offers nothing to save', blockActionsOf(empty, { reading: false }).length === 0);
  const filled = withCanvasScene(empty, { ...parseCanvasBlock(empty).scene, background: { fill: { kind: 'solid', color: '#000000' }, image: null, tint: null } }, null);
  check('a canvas with something on it offers "Save as picture", while reading too',
    blockActionsOf(filled, { reading: true }).map((a) => a.id).join() === 'savePicture' && blockActionsOf(filled, { reading: false }).length === 1);
  check('a text block has no actions', blockActionsOf(createTextBlock('<p>x</p>'), { reading: false }).length === 0);

  const target = '44444444-4444-4444-4444-444444444444';
  const chip = internalLinkChipHtml({ id: target, targetKind: 'entry', label: 'Ziel' }); // lang-ok
  const content = serializeBlocks([createTextBlock(`<p>${chip}</p>`), createCanvasBlock()]);
  check('linked entries come from the blocks\' references', [...linkedIdsOf(content)].join() === target);

  const pic = 'a'.repeat(64) + '.png';
  const text = createTextBlock(`<p>eins</p><img src="${pic}" alt=""><p>zwei</p>`);
  const without = blockWithoutImage(text, pic);
  check('a text block lets a picture go, nothing else',
    !without.html.includes(pic) && without.html.includes('zwei') && blockWithoutImage(without, pic) === without, without.html);
  const reporter = new RefReporter();
  reporter.image('not-a-picture.txt');
  reporter.icon('🙂');
  reporter.entry('');
  check('the reporter drops what is no reference', reporter.refs.length === 0, reporter.refs);
}

{
  const empty = createCanvasBlock();
  const none = withCanvasScene(empty, { ...parseCanvasBlock(empty).scene, background: { fill: { kind: 'none' }, image: null, tint: null } }, null);
  check('a canvas whose background draws nothing offers nothing to save', blockActionsOf(none, { reading: true }).length === 0);

  // A canvas from a newer app: its render and background stay what they are, and "Images" leaves it alone.
  const pic = 'b'.repeat(64) + '.png';
  const render = 'c'.repeat(64) + '.png';
  const drawn = withCanvasScene(empty, { ...parseCanvasBlock(empty).scene, elements: [] , background: { fill: { kind: 'none' }, image: { src: pic, fit: 'cover' }, tint: null } }, render);
  const tooNew = { ...drawn, attrs: { ...drawn.attrs, 'data-block-v': '9' } };
  const roles = blockRefs(tooNew).map((r) => `${r.kind}:${r.role}`).sort().join(' ');
  check('a known type in a newer format keeps its pictures as its own, not as shown ones', roles === 'image:default image:default', roles);
  check('"Images" does not take a picture out of a block in a newer format', blockWithoutImage(tooNew, pic) === tooNew);
  check('an unknown type still lets "Images" take a picture out of its markup',
    !blockWithoutImage({ id: 'u', type: 'x.y', html: `<img src="${pic}" alt="">`, attrs: {} }, pic).html.includes(pic));
}

console.log('\n8. .emerald manifest (lib/emerald/manifest.ts)\n');
{
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  const newA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const newB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const outside = '33333333-3333-4333-8333-333333333333';
  const pic = `${'ab'.repeat(32)}.png`;
  const kept = `${'cd'.repeat(32)}.jpg`;
  const chipTo = (id, label) => internalLinkChipHtml({ id, targetKind: 'entry', label });

  // Two entries of one file that link to each other, plus a link outside and pictures.
  const contentA = serializeBlocks([
    { ...createTextBlock(`<p>see ${chipTo(idB, 'B')} and ${chipTo(outside, 'Elsewhere')}</p><img src="${pic}">`), id: 'blk-a' },
  ]);
  const fields = createFieldsBlock();
  const contentB = serializeBlocks([
    { ...createTextBlock(`<p>back to ${chipTo(idA, 'A')}</p><img src="${kept}">`), id: 'blk-b' },
    { ...fields, attrs: { ...fields.attrs, [BLOCK_ATTR.data]: JSON.stringify({ slots: { l: `link:${idA}` } }) } },
  ]);
  const manifest = {
    format: 'emerald', version: EMERALD_FORMAT_VERSION, kind: 'items', exportedAt: '2026-11-14T00:00:00.000Z',
    items: [
      { kind: 'entry', id: idA, title: 'A', number: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '', icon: '🌙', cover: null,
        category: { id: 'c-ritual', name: 'Ritual', icon: '🕯️', builtin: false }, tags: ['x'], blocks: contentToBlocks(contentA) },
      { kind: 'entry', id: idB, title: 'B', number: 2, createdAt: '', updatedAt: '', icon: '', cover: null, category: null, tags: [],
        blocks: contentToBlocks(contentB) },
      { kind: 'template', id: 'tpl', name: 'T', title: 'New', createdAt: '', updatedAt: '', icon: '📄', tags: [], blocks: [] },
    ],
    links: [{ id: outside, kind: 'entry', title: 'Elsewhere' }],
    omittedImages: [pic],
    blockDefinitions: [{ id: 'def-1', name: 'Plant' }, { id: '../x' }, 'x'],
  };
  const parsed = parseManifest(JSON.stringify(manifest));
  check('a manifest round-trips through JSON', typeof parsed === 'object' && parsed.items.length === 3 && parsed.links.length === 1, parsed);
  check('a category goes with its ID; a custom block only with a harmless one',
    parsed.items[0].category?.id === 'c-ritual' && parsed.blockDefinitions.map((d) => d.id).join() === 'def-1', parsed.blockDefinitions);
  check('block rows give back the content byte for byte',
    blocksToContent(parsed.items[0].blocks) === contentA && blocksToContent(parsed.items[1].blocks) === contentB,
    blocksToContent(parsed.items[1].blocks));

  const idMap = new Map([[idA, newA], [idB, newB]]);
  const importedA = relinkWithinFile(blocksToContent(parsed.items[0].blocks), idMap);
  const importedB = relinkWithinFile(blocksToContent(parsed.items[1].blocks), idMap);
  const targets = (html) => extractInternalLinks(html).map((l) => l.id);
  check('two entries of one file stay linked to each other (chips)',
    targets(importedA).includes(newB) && targets(importedB).includes(newA) && !importedA.includes(idB) && !importedB.includes(idA),
    { a: targets(importedA), b: targets(importedB) });
  check('a field block’s link slot follows too', importedB.includes(`link:${newA}`), importedB);
  check('a link outside the file is left for the title lookup', targets(importedA).includes(outside));

  const placeholder = `${'ef'.repeat(32)}.png`;
  const stored = `${'01'.repeat(32)}.jpg`;
  const byStem = new Map([[storedNameStem(pic), placeholder], [storedNameStem(kept), stored]]);
  const renamedA = renameStoredFiles(importedA, byStem);
  const renamedB = renameStoredFiles(importedB, byStem);
  check('a left-out picture becomes the placeholder', renamedA.includes(placeholder) && !renamedA.includes(pic), renamedA);
  check('a picture of the file gets its new name', renamedB.includes(stored) && !renamedB.includes(kept), renamedB);
  check('a picture compressed to another type is found by its hash',
    renameStoredFiles(`<img src="${'ab'.repeat(32)}.webp">`, byStem).includes(placeholder));

  check('the gentlest picture setting wins', gentlestImageMode('placeholder', 'none') === 'none'
    && gentlestImageMode('strong', 'balanced') === 'balanced');

  {
    // A concealed sigil travels whole in .emerald (.vault.emerald copies the rows as they are): it arrives concealed.
    const concealedContent = serializeBlocks([createTextBlock('<p>Notiz</p>'), sigilOf({ calc: calcData, drawing: drawnFile, charge: chargeData })]);
    const sigilFile = parseManifest(JSON.stringify({ ...manifest, items: [{ ...manifest.items[0], blocks: contentToBlocks(concealedContent) }] }));
    const arrived = relinkWithinFile(blocksToContent(sigilFile.items[0].blocks), idMap);
    const arrivedFx = entryEffects(parseBlocks(arrived), { today: '2029-12-31' });
    check('.emerald: a concealed sigil goes along whole, byte for byte, and arrives concealed and locked',
      arrived === concealedContent && arrived.includes('Ich &lt;b&gt;bin') && arrived.includes(drawnFile)
        && arrivedFx.lockEntry && arrivedFx.concealed.size === 2, arrived);
  }

  check('an older manifest is named as such', parseManifest(JSON.stringify({ ...manifest, version: 6 })) === 'oldVersion');
  check('a newer manifest is named as such', parseManifest(JSON.stringify({ ...manifest, version: EMERALD_FORMAT_VERSION + 1 })) === 'newVersion');
  check('a vault file is no file of entries', parseManifest(JSON.stringify({ ...manifest, kind: 'vault' })) === 'unsupported');
  check('no JSON, another format or no item is refused',
    parseManifest('nope') === 'unsupported' && parseManifest('{"format":"x","version":7}') === 'unsupported'
      && parseManifest(JSON.stringify({ ...manifest, items: [] })) === 'unsupported');
  const hostile = parseManifest(JSON.stringify({ ...manifest, items: [
    { kind: 'entry', id: idA, title: 7, tags: ['ok', 3, null], category: { name: 5 }, blocks: [{ id: 'b', type: 'core.text', html: '<p>x</p>', hidden: 'yes', version: -1 }, { type: 'core.text' }, 'x'] },
    { kind: 'script', id: 'x' },
    null,
  ] }));
  check('more items than the limit are refused as too large',
    parseManifest(JSON.stringify({ ...manifest, items: Array.from({ length: 1001 }, () => manifest.items[2]) })) === 'tooLarge');
  check('more picture details than the limit are refused as too large',
    parseManifest(JSON.stringify({ ...manifest, images: Array.from({ length: 50_001 }, () => ({ file: pic })) })) === 'tooLarge');
  const details = parseManifest(JSON.stringify({ ...manifest, images: [
    { file: pic, name: '  Moon ', note: 7, tags: [' a ', 'a', '', 5, 'x'.repeat(101), ...Array.from({ length: 200 }, (_, i) => `t${i}`)] },
    { file: '../evil.png', name: 'x' },
    'x',
    null,
  ] }));
  check('picture details from a foreign file: a stored name only, the name trimmed, tags bounded and once each',
    typeof details === 'object' && details.images.length === 1 && details.images[0].name === 'Moon' && details.images[0].note === ''
      && details.images[0].tags.length === 100 && details.images[0].tags[0] === 'a' && !details.images[0].tags.some((t) => t.length > 100),
    typeof details === 'object' ? details.images : details);
  check('a file without picture details reads as none', typeof parseManifest(JSON.stringify(manifest)) === 'object'
    && parseManifest(JSON.stringify(manifest)).images.length === 0);
  const shortId = parseManifest(JSON.stringify({ ...manifest, items: [{ ...manifest.items[0], id: 'e' }, manifest.items[2]] }));
  const twice = parseManifest(JSON.stringify({ ...manifest, items: [manifest.items[0], { ...manifest.items[1], id: idA }] }));
  check('an item ID that appears twice is taken once', typeof twice === 'object' && twice.items.length === 1, twice);
  check('an entry whose ID is no UUID is dropped', typeof shortId === 'object' && shortId.items.length === 1 && shortId.items[0].kind === 'template', shortId);
  check('re-linking replaces whole IDs only, in one pass',
    relinkWithinFile(`x${idA}y ${idA.slice(0, 8)}`, idMap) === `x${newA}y ${idA.slice(0, 8)}`);
  // A copy an older merge import made carries its ID with an 8-character prefix.
  const mergedId = `mf3k2x9q-${idB}`;
  const merged = parseManifest(JSON.stringify({ ...manifest, items: [{ ...manifest.items[0], id: mergedId }] }));
  check('an entry copied by an older merge (prefixed ID) is read', typeof merged === 'object' && merged.items[0]?.id === mergedId, merged);
  const mergedMap = new Map([[mergedId, newB], [idA, newA]]);
  check('a prefixed ID is re-linked whole',
    relinkWithinFile(`a ${mergedId} b data-id="${mergedId}"`, mergedMap) === `a ${newB} b data-id="${newB}"`);
  check('a link to an older merge copy outside the file keeps its ID, even when its original is in the file',
    relinkWithinFile(`data-id="abcdefgh-${idA}" link:${idA}`, mergedMap) === `data-id="abcdefgh-${idA}" link:${newA}`);
  check('a prefix is not cut out of a longer run of characters',
    relinkWithinFile(`xabcdefgh-${idA}`, mergedMap) === `xabcdefgh-${newA}`);
  check('foreign values of the wrong type are dropped, not trusted',
    typeof hostile === 'object' && hostile.items.length === 1 && hostile.items[0].title === ''
      && hostile.items[0].tags.join() === 'ok' && hostile.items[0].category === null
      && hostile.items[0].blocks.length === 1 && hostile.items[0].blocks[0].hidden === 0 && hostile.items[0].blocks[0].version === null,
    hostile);
}

console.log('');

if (failures.length) {
  console.error(`${failures.length} check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('All checks passed.\n');
