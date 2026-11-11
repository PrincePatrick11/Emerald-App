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
   export { entryBlockSummary } from '${root}/src/lib/blocks/entrySummary';
   export { withLegacyStatus, statusDefinition, hasLegacyStatus, convertLegacyStatusRows, STATUS_DEFINITION_ID } from '${root}/src/lib/blocks/legacyStatus';
   export { extractUniqueLetters, parseSigilCalc, serializeSigilCalc, createSigilCalcBlock, createSigilCanvasBlock, createSigilChargeBlock, parseSigilCharge, serializeSigilCharge, sigilState, withoutConcealed, sigilImage, withSigilImage, letterList, sigilUnits, sigilPartBlock, sigilPartId, withSigilPart, withChargesCoveringOnly, withRenamedPartTargets, parseSigilDrawing, withSigilDrawing } from '${root}/src/lib/blocks/sigil';
   export { paintDocFromJson, paintDocToJson, emptyPaintDoc, isPaintDocEmpty, thinPoints, transformStroke, mergeDown, canMergeDown, strokeSamples, inPolygon, symmetricCopies, mirrorStroke, splitStroke } from '${root}/src/lib/paint/document';
   export { parseAltarElements, altarElementsJson } from '${root}/src/lib/altarElements';
   export { parseAltarSettings } from '${root}/src/lib/altarSettings';
   export { symbolFromDrawing } from '${root}/src/components/editors/canvas/symbols/fromDrawing';
   export { readUserSymbol } from '${root}/src/lib/userSymbols';
   export { group, ungroup, withGroups, moveInStack, copiesOf, align } from '${root}/src/components/editors/canvas/canvasActions';
   export { renderBlocksForExport } from '${root}/src/lib/blocks/exportRender';
   export { createPaintBlock, isDrawingBlockType, PAINT_BLOCK_TYPE } from '${root}/src/lib/blocks/paint';
   export { resolveBlockType } from '${root}/src/lib/blocks/blockTypes';
   export { createCanvasBlock, parseCanvasBlock, withCanvasScene, withCanvasParts, withCanvasStripTag, withoutCanvasFile, CANVAS_BLOCK_TYPE, ALTAR_BLOCK_TYPE } from '${root}/src/lib/blocks/canvas';
   export { parseAssignments, resolveAssignedTemplate, instantiateTemplateBlocks, isContentEmpty, templateStart, mergeTemplateTags, assignedTemplateAt, areBlocksEmpty, fieldsWithTemplate, fieldsWithoutTemplate } from '${root}/src/lib/blocks/templates';
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
  instantiateDefinition, parseDefinitionElements, parseDefinitionDisplay, entryBlockSummary,
  withLegacyStatus, statusDefinition, hasLegacyStatus, convertLegacyStatusRows, STATUS_DEFINITION_ID,
  extractUniqueLetters, parseSigilCalc, serializeSigilCalc, createSigilCalcBlock, createSigilCanvasBlock,
  createSigilChargeBlock, parseSigilCharge, serializeSigilCharge, sigilState, withoutConcealed,
  sigilImage, withSigilImage, letterList, renderBlocksForExport, parseSigilDrawing, withSigilDrawing,
  paintDocFromJson, paintDocToJson, emptyPaintDoc, isPaintDocEmpty, thinPoints, transformStroke, mergeDown, canMergeDown, strokeSamples, inPolygon, symmetricCopies, mirrorStroke, splitStroke,
  group, ungroup, withGroups, moveInStack, copiesOf, align, parseAltarElements, altarElementsJson, parseAltarSettings,
  symbolFromDrawing, readUserSymbol,
  sigilUnits, sigilPartBlock, sigilPartId, withSigilPart, withChargesCoveringOnly,
  remapDefinitionDefaults, definitionImageRefs, withRenamedPartTargets,
  parseAssignments, resolveAssignedTemplate, instantiateTemplateBlocks, isContentEmpty,
  templateStart, mergeTemplateTags, assignedTemplateAt, areBlocksEmpty,
  fieldsWithTemplate, fieldsWithoutTemplate,
  createCanvasBlock, parseCanvasBlock, withCanvasScene, withCanvasParts, withCanvasStripTag, withoutCanvasFile, CANVAS_BLOCK_TYPE, ALTAR_BLOCK_TYPE,
  createPaintBlock, isDrawingBlockType, PAINT_BLOCK_TYPE, resolveBlockType,
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
  const chip = internalLinkChipHtml({ id: '22222222-2222-2222-2222-222222222222', entryType: 'wiki', label: 'Ziel "A"' }); // lang-ok
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
  const content = serializeBlocks([createTextBlock('<p>a</p>'), filled, createFieldsBlock('number')]);
  check('a field archived by an earlier version is gone from the definition',
    parseDefinitionElements(JSON.stringify([{ id: 'a', kind: 'date', label: 'A', archived: true }, { id: 'b', kind: 'date', label: 'B' }])).map((e) => e.id).join() === 'b');
  check('a copy from before keeps working with its old markers',
    parseFields({ ...filled, attrs: { ...filled.attrs, 'data-block-origin': 'def-1', 'data-block-rev': '1' } }).values['e-result'] === 'gut');

  check('a summary without sigil blocks is empty', entryBlockSummary('x', content).sigil === null);

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

console.log('\n4e. Legacy operation status becomes a block\n');
{
  const labels = {
    'blocks.status.name': 'Status', 'blocks.status.active': 'Aktiv', 'blocks.status.endDate': 'Enddatum',
    'blocks.status.version': 'Version', 'blocks.fields.yes': 'Ja', 'blocks.fields.no': 'Nein',
  };
  const t = (key) => labels[key] ?? key;
  const def = statusDefinition(t, '2026-01-01T00:00:00.000Z');

  check('active without end date and version is not a legacy status',
    !hasLegacyStatus({ isActive: true, endDate: null, version: ' ' }) && hasLegacyStatus({ isActive: false, endDate: null, version: null }));

  const out = withLegacyStatus('<p>Text</p>', { isActive: false, endDate: '2026-03-01', version: ' 1.2 ' }, def, t);
  const [status, text] = parseBlocks(out);
  const model = parseFields(status);
  check('the status block comes before the content, the text stays',
    status?.type === 'core.fields' && model.name === 'Status' && text?.html === '<p>Text</p>', out);
  check('values: inactive, end date, version trimmed',
    model.values.active === false && model.values['end-date'] === '2026-03-01' && model.values.version === '1.2', model.values);
  check('the fallback names the values readably', status.html.includes('Nein') && status.html.includes('1.2'), status.html);

  const md = parseFields(parseBlocks(withLegacyStatus('', { isActive: true, endDate: 'Sep 10, 2026', version: null }, def, t))[0]);
  check('a date from a Markdown export becomes ISO', md.values['end-date'] === '2026-09-10', md.values);

  const rows = [
    { id: 'a', content: '<p>x</p>', is_active: 0, end_date: null, version: null },
    { id: 'b', content: '<p>y</p>', is_active: 1, end_date: null, version: '' },
  ];
  const converted = convertLegacyStatusRows(rows, t, 'now');
  check('convertLegacyStatusRows: only the row with a legacy status, columns cleared',
    converted.definition?.id === STATUS_DEFINITION_ID && converted.rows[1] === rows[1] &&
      converted.rows[0].is_active === 1 && converted.rows[0].content.includes('core.fields'), converted.rows);
  check('without a legacy status no definition is needed', convertLegacyStatusRows([rows[1]], t, 'now').definition === null);

  // i18n not ready yet: `t` returns the key — never make it permanent as a label.
  const raw = statusDefinition((key) => key, 'now');
  check('without translation: English labels instead of keys',
    raw.name === 'Status' && raw.elements.map((e) => e.label).join() === 'Active,End date,Version', raw);
  const rawHtml = parseBlocks(withLegacyStatus('', { isActive: false, endDate: null, version: null }, raw, (key) => key))[0].html;
  check('without translation: the fallback text has no keys either', rawHtml.includes('No') && !rawHtml.includes('blocks.'), rawHtml);
}

console.log('\n4f. Sigil blocks\n');
{
  check('letter bank: each letter once, uppercase, without accents',
    extractUniqueLetters('Äpfel äpfel!').join('') === 'APFEL', extractUniqueLetters('Äpfel äpfel!')); // lang-ok

  const calc = serializeSigilCalc(createSigilCalcBlock(), { intention: 'Ich <b>bin</b>', letters: ['I', 'C'], implemented: ['I', 'X'] });
  const calcBack = parseSigilCalc(parseBlocks(serializeBlocks([calc, createTextBlock('<p>x</p>')]))[0]);
  check('calculator: round trip, implemented letters only from the bank',
    calcBack.intention === 'Ich <b>bin</b>' && calcBack.letters.join() === 'I,C' && calcBack.implemented.join() === 'I', calcBack);
  check('calculator: the fallback is escaped', calc.html.includes('&lt;b&gt;') && !calc.html.includes('<b>'), calc.html);

  const canvas = withSigilImage(createSigilCanvasBlock(), `${'ab'.repeat(32)}.png`);
  check('drawing: the file name is a src in the markup', sigilImage(canvas) === `${'ab'.repeat(32)}.png` && canvas.html.startsWith('<img src="'));

  // The paint document: vector strokes as data JSON, the rendered image and layer images as src.
  {
    const old = `${'ab'.repeat(32)}.png`;
    const render = `${'cd'.repeat(32)}.png`;
    const legacy = parseSigilDrawing(canvas);
    check('drawing: an old image becomes the only layer, nothing lost',
      legacy.render === old && legacy.doc?.layers.length === 1 && legacy.doc.layers[0].image === old && legacy.doc.layers[0].strokes.length === 0, legacy);
    check('drawing: an empty block has neither image nor document', parseSigilDrawing(createSigilCanvasBlock()).doc === null);

    const stroke = { id: 's1', tool: 'pen', color: '#EF4444', size: 8, points: [1.234, 2.345, 0.5, 10, 20, 0.777], pressure: true };
    const doc = { layers: [{ ...legacy.doc.layers[0], strokes: [stroke] }, { id: 'top', name: 'Oben', hidden: true, image: null, strokes: [] }] }; // lang-ok
    const saved = withSigilDrawing(canvas, render, doc);
    const back = parseSigilDrawing(parseBlocks(serializeBlocks([saved]))[0]);
    check('drawing: the render comes first, the layer image after it, both as src',
      sigilImage(saved) === render && saved.html.includes(`src="${old}"`) && saved.html.indexOf(render) < saved.html.indexOf(old), saved.html);
    check('drawing: round trip keeps layers, strokes, the layer image; points rounded',
      back.render === render && back.doc?.layers.length === 2 && back.doc.layers[0].image === old
        && back.doc.layers[1].name === 'Oben' && back.doc.layers[1].hidden // lang-ok
        && isDeepStrictEqual(back.doc.layers[0].strokes[0].points, [1.2, 2.3, 0.5, 10, 20, 0.78])
        && back.doc.layers[0].strokes[0].color === '#ef4444' && back.doc.layers[0].strokes[0].pressure, back);
    const text = {
      title: (b) => b.type, date: (iso) => iso, number: (n) => `${n}`, targetDate: '', technique: '', loaded: '', notLoaded: '',
      drawing: 'D', fields: { label: (e) => e.label, yes: '', no: '', moonName: (p) => p },
    };
    const exported = renderBlocksForExport(serializeBlocks([saved]), text);
    check('drawing: the export shows only the render', exported.includes(render) && !exported.includes(old), exported);

    // Something that knows only the image (an older app) replaced it: the new image counts, as a layer.
    const replaced = { ...saved, html: `<img src="${'ef'.repeat(32)}.png" alt="">` };
    const stale = parseSigilDrawing(replaced);
    check('drawing: an unmarked image wins over a stale document',
      stale.doc?.layers.length === 1 && stale.doc.layers[0].image === `${'ef'.repeat(32)}.png`, stale);

    const emptied = withSigilDrawing(saved, null, null);
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
    const drawn = parseAltarElements(JSON.stringify([
      { id: 'p', kind: 'shape', group: 'g1', shape: { type: 'polygon', sides: 8 } },
      { id: 'q', kind: 'shape', shape: { type: 'star', sides: 40 } },
    ]), 'altar');
    const again = parseAltarElements(altarElementsJson(drawn), 'altar');
    check('altar: a drawn element keeps its group and corners, nonsense is clamped',
      again[0].group === 'g1' && again[0].shape.sides === 8 && !again[1].group && again[1].shape.sides === 12, again);
    const pair = [el('a', 0, { x: 100, y: 0, group: 'g' }), el('b', 1, { x: 200, y: 0, group: 'g' }), el('c', 2, { x: 500, y: 300 })];
    const lined = align(pair, ['a', 'b', 'c'], 'left', { width: 1000, height: 600 });
    check('canvas: aligning moves a group as one, its members keeping their distance',
      lined[1].x - lined[0].x === 100 && lined[0].x === 100 && lined[2].x === 100, lined.map((e) => e.x));
    const settings = parseAltarSettings(JSON.stringify({ guides_locked: true, guides: [
      { id: 'a', orientation: 'vertical', at: 25 }, { id: 'a', orientation: 'vertical', at: 30 },
      { id: 'b', orientation: 'diagonal', at: 10 }, { id: 'c', orientation: 'horizontal', at: 140 },
    ] }));
    check('altar: guides are read with their place in percent, doubles and nonsense left out',
      settings.guides_locked && settings.guides.length === 2 && settings.guides[1].at === 100
        && !parseAltarSettings('{}').guides_locked && parseAltarSettings('{}').guides.length === 0, settings.guides);
    const symbols = parseAltarElements(JSON.stringify([
      { id: 's', kind: 'symbol', symbol: { symbol: 'runes.fehu', d: 'M38 10L38 90', color: '#123456', weight: 99, fill: null } },
      { id: 't', kind: 'symbol', symbol: { symbol: 'planets.sun', d: 'M0 0<script>' } },
    ]), 'altar');
    const symbolsAgain = parseAltarElements(altarElementsJson(symbols), 'altar');
    check('altar: a symbol keeps its path and colour, its weight is clamped, a foreign path gives way to the library\'s',
      symbolsAgain[0].symbol.d === 'M38 10L38 90' && symbolsAgain[0].symbol.color === '#123456' && symbolsAgain[0].symbol.weight === 16
        && symbolsAgain[1].symbol.symbol === 'planets.sun' && !symbolsAgain[1].symbol.d.includes('<'), symbolsAgain);
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

  const odd = parseSigilCharge({ ...createSigilChargeBlock(), attrs: { 'data-block-data': JSON.stringify({ loaded: 'ja', revealDate: 'morgen', lock: 'alles' }) } });
  check('charge: nonsense falls back to safe values', !odd.loaded && odd.revealDate === null && odd.lock === 'entry', odd);

  const chargeData = { loaded: true, revealDate: '2030-01-01', lock: 'entry', technique: null, targets: null };
  const charged = serializeSigilCharge(createSigilChargeBlock(), chargeData);
  const blocks = [calc, canvas, charged];
  const before = sigilState(blocks, '2029-12-31');
  const after = sigilState(blocks, '2030-01-01');
  check('loaded before the date: hidden and fully locked',
    before.concealed.get(calc.id) === '2030-01-01' && before.concealed.has(canvas.id) && before.lockEntry
      && before.locked.has(calc.id) && before.locked.has(canvas.id), before);
  check('on the reveal day: visible, but still locked', after.concealed.size === 0 && after.lockEntry && after.locked.has(calc.id), after);
  const sigilOnly = sigilState([calc, serializeSigilCharge(createSigilChargeBlock(), { ...chargeData, lock: 'sigil' })], '2029-01-01');
  check('lock "sigils only": entry editable, sigil blocks not', !sigilOnly.lockEntry && sigilOnly.locked.has(calc.id));

  const noDate = sigilState([calc, serializeSigilCharge(createSigilChargeBlock(), { ...chargeData, revealDate: null })], '2099-01-01');
  check('loaded without a target date: hidden until unloaded', noDate.concealed.has(calc.id) && noDate.concealed.get(calc.id) === null, noDate);

  const onlyCanvas = serializeSigilCharge(createSigilChargeBlock(), { ...chargeData, lock: 'sigil', targets: [canvas.id] });
  const picked = sigilState([calc, canvas, onlyCanvas], '2029-12-31');
  check('charge with selection: conceals and locks only the chosen drawing',
    picked.concealed.has(canvas.id) && !picked.concealed.has(calc.id) && !picked.locked.has(calc.id) && !picked.lockEntry, picked);
  const pickedBack = parseSigilCharge(parseBlocks(serializeBlocks([onlyCanvas]))[0]);
  check('charge: the selection survives the round trip, without a selection it is missing in the JSON',
    pickedBack.targets?.join() === canvas.id && parseSigilCharge(charged).targets === null
      && !charged.attrs['data-block-data'].includes('targets'), pickedBack);
  const oddTargets = parseSigilCharge({ ...createSigilChargeBlock(), attrs: { 'data-block-data': JSON.stringify({ targets: ['ok-1', 'ok-1', '<x>', 3, 'y'.repeat(65)] }) } });
  check('charge: foreign selection — only harmless, unique IDs', oddTargets.targets?.join() === 'ok-1', oddTargets);
  const later = sigilState([calc, serializeSigilCharge(createSigilChargeBlock(), { ...chargeData, targets: [calc.id] }),
    serializeSigilCharge(createSigilChargeBlock(), { ...chargeData, revealDate: '2031-06-01', targets: [calc.id] })], '2029-12-31');
  check('two charges on the same block: the longer one applies', later.concealed.get(calc.id) === '2031-06-01', later);
  const partial = withoutConcealed(serializeBlocks([calc, canvas, onlyCanvas]), '2029-12-31');
  check('search without the concealed drawing, with the free calculator',
    partial.includes('core.sigil.calc') && !partial.includes('core.sigil.canvas'), partial);

  const content = serializeBlocks([createTextBlock('<p>Notiz</p>'), ...blocks]);
  const hiddenContent = withoutConcealed(content, '2029-12-31');
  check('hidden: search and export do not see calculator and drawing',
    !hiddenContent.includes('core.sigil.calc') && !hiddenContent.includes('core.sigil.canvas') && hiddenContent.includes('Notiz'), hiddenContent);
  check('revealed: everything stays', withoutConcealed(content, '2030-02-01') === content);

  const secret = { ...createTextBlock('<p>geheim</p>'), attrs: { 'data-block-hidden': '1' } };
  const exportText = {
    title: (b) => `T:${b.type}`, date: (iso) => `D:${iso}`, number: (n) => `N:${n}`, targetDate: 'Ziel', technique: 'Technik',
    loaded: 'Geladen', notLoaded: 'Offen', drawing: 'Zeichnung',
    fields: { label: (e) => e.label || e.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p },
  };
  const exportedContent = serializeBlocks([createTextBlock('<p>sichtbar</p>'), secret, ...blocks]);
  const exported = renderBlocksForExport(exportedContent, exportText, '2029-12-31');
  check('export: hidden blocks and the concealed sigil are missing, the charge stays',
    exported.includes('sichtbar') && !exported.includes('geheim') && !exported.includes('Ich') && !exported.includes('<img')
      && exported.includes('<dt>Ziel</dt><dd>D:2030-01-01</dd>') && exported.includes('Geladen'), exported);
  check('export: no sections, title as heading, text without title',
    !exported.includes('<section') && exported.includes('<h3>T:core.sigil.charge</h3>') && !exported.includes('T:core.text'), exported);
  const revealed = renderBlocksForExport(exportedContent, exportText, '2030-02-01');
  check('export after the target date: calculator and drawing (with alt text) are included',
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
  check('export: fields as in read mode — formatted, without empty and archived ones',
    fieldsOut.includes('<dt>Datum</dt><dd>D:2030-05-01</dd>') && fieldsOut.includes('<dt>Menge</dt><dd>N:3</dd>')
      && !fieldsOut.includes('Leer') && !fieldsOut.includes('weg'), fieldsOut);
  check('export: a text block with the title switched on carries it', fieldsOut.includes('<h3>T:core.text</h3><p>mit Titel</p>'), fieldsOut);

  const journalSigil = serializeBlocks([createTextBlock('<p>Tagebuch</p>'), ...blocks]);
  check('a sigil in the journal hides itself the same way', !withoutConcealed(journalSigil, '2029-12-31').includes('core.sigil.calc'));
  check('letter list: at most 500, only short strings',
    letterList([...Array(2000).fill('A'), 'x'.repeat(9), 3]).length === 500 && letterList(['AB', 'x'.repeat(9), 3]).join() === 'AB');
  const t0 = Date.now();
  parseSigilCharge({ ...createSigilChargeBlock(), html: '<p '.repeat(50000) });
  check('charge technique regex stays fast on crafted markup', Date.now() - t0 < 500, `${Date.now() - t0} ms`);
}

console.log('\n4g. Link and image defaults with markup\n');
{
  const wikiId = 'b1111111-1111-1111-1111-111111111111';
  const img = `${'cd'.repeat(32)}.png`;
  const text = {
    title: (b) => `T:${b.type}`, date: (iso) => iso, number: String, targetDate: '', technique: '', loaded: '', notLoaded: '',
    drawing: '', fields: { label: (e) => e.label, yes: 'Ja', no: 'Nein', moonName: (p) => p },
  };

  const elements = parseDefinitionElements(JSON.stringify([
    { id: 'lnk', kind: 'link', label: 'Quelle', defaultValue: { id: wikiId, entryType: 'wiki', label: 'Artikel' } },
    { id: 'pic', kind: 'image', label: 'Bild', defaultValue: `bilder/${img}` },
    { id: 'lnk2', kind: 'link', label: 'Kaputt', defaultValue: { id: 'nicht-uuid', entryType: 'wiki', label: 'x' } }, // lang-ok
    { id: 'pic2', kind: 'image', label: 'Fremd', defaultValue: 'javascript:alert(1)' },
    // The altar field is gone (v62 made it a link field); one left over is dropped.
    { id: 'alt', kind: 'altar', label: 'Altar' },
  ]));
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
  check('defaults: link and image are read, image as a plain file name',
    byId.lnk.defaultValue?.entryType === 'wiki' && byId.pic.defaultValue === img, elements);
  check('defaults: links only valid targets, images only stored files; an altar field is no element',
    byId.lnk2.defaultValue === undefined && byId.pic2.defaultValue === undefined && !byId.alt);

  const def = {
    id: 'def-slots', name: 'Ritualplatz', icon: '🕯️', sort_order: 0,
    created_at: '', updated_at: '', deleted_at: null,
    display: { readHideEmpty: true, readOnly: false, showTitle: true }, elements,
  };
  const copy = instantiateDefinition(def, text.fields);
  const cm = parseFields(copy);
  check('a new copy carries chip and image in its slots',
    linkFromSlot(cm.slots.lnk)?.id === wikiId && imageFromSlot(cm.slots.pic) === img && !cm.slots.lnk2 && !cm.slots.pic2, cm.slots);
  check('the links of the copy are in the content (link table, backlinks)',
    extractInternalLinks(serializeBlocks([copy])).length === 1);
  check('export: the link field shows its chip', renderBlocksForExport(serializeBlocks([copy]), text).includes('data-entry-type="wiki"'));

  const remapped = parseDefinitionElements(remapDefinitionDefaults(
    JSON.stringify(elements), (name) => (name === img ? `${'ef'.repeat(32)}.png` : name),
    (t) => ({ id: `abcd1234-${t.id}`, label: 'Neu' }),
  ));
  const rm = Object.fromEntries(remapped.map((e) => [e.id, e]));
  check('import: image defaults follow the stored images, link defaults the new IDs',
    rm.pic.defaultValue === `${'ef'.repeat(32)}.png` && rm.lnk.defaultValue?.id === `abcd1234-${wikiId}` && rm.lnk.defaultValue?.label === 'Neu', remapped);
  check('the images of the defaults are known', definitionImageRefs(elements).join() === img);
}

console.log('\n4g2. The paint block\n');
{
  const paint = createPaintBlock();
  const render = `${'5a'.repeat(32)}.png`;
  const saved = withSigilDrawing(paint, render, emptyPaintDoc());
  const back = parseSigilDrawing(parseBlocks(serializeBlocks([saved]))[0]);
  check('paint: a type of its own, known to the app, a drawing like the sigil\'s',
    paint.type === PAINT_BLOCK_TYPE && !!resolveBlockType(paint) && isDrawingBlockType(paint.type) && !isDrawingBlockType('core.canvas'));
  check('paint: picture and document survive the round trip', back.render === render && !!back.doc, back);
  const text = {
    title: () => 'Painting', date: (iso) => iso, number: String, targetDate: '', technique: '', loaded: '', notLoaded: '',
    drawing: '', fields: { label: (e) => e.label, yes: '', no: '', moonName: (p) => p },
  };
  check('paint: the export shows the picture', renderBlocksForExport(serializeBlocks([saved]), text).includes(render));
  check('paint: an empty one exports nothing of it', !renderBlocksForExport(serializeBlocks([paint]), text).includes('<img'));
}

console.log('\n4h. Sigils as parts of custom blocks\n');
{
  const text = { label: (e) => e.label || e.kind, yes: 'Ja', no: 'Nein', moonName: (p) => p };
  const def = {
    id: 'def-sigil', name: 'Sigillen-Ritual', icon: '🕯️', sort_order: 0,
    created_at: '', updated_at: '', deleted_at: null,
    display: { readHideEmpty: true, readOnly: false, showTitle: true },
    elements: parseDefinitionElements(JSON.stringify([
      { id: 'ort', kind: 'shorttext', label: 'Ort' },
      { id: 'calc', kind: 'sigilCalc', label: 'Rechner', defaultValue: { intention: 'nein' } },
      { id: 'draw', kind: 'sigilCanvas', label: 'Zeichnung' },
      { id: 'charge', kind: 'sigilCharge', label: 'Ladung' },
    ])),
  };
  check('sigil parts are field kinds, without a default',
    def.elements.map((e) => e.kind).join() === 'shorttext,sigilCalc,sigilCanvas,sigilCharge'
      && def.elements[1].defaultValue === undefined, def.elements);

  // Like the UI: write the part as a virtual block, then back into the model.
  const setPart = (block, elementId, change) => {
    const model = parseFields(block);
    const element = model.elements.find((e) => e.id === elementId);
    const part = change(sigilPartBlock(block, element, model));
    return serializeFields(block, withSigilPart(model, element, part), text);
  };
  let block = instantiateDefinition(def, text);
  block = setPart(block, 'calc', (p) => serializeSigilCalc(p, { intention: 'Geheime Absicht', letters: ['G', 'H'], implemented: [] }));
  block = setPart(block, 'draw', (p) => withSigilImage(p, `${'ab'.repeat(32)}.png`));
  block = setPart(block, 'charge', (p) => serializeSigilCharge(p, {
    loaded: true, revealDate: '2030-01-01', lock: 'entry', technique: null, targets: null,
  }));
  const back = parseBlocks(serializeBlocks([createTextBlock('<p>Notiz</p>'), block]));
  const units = sigilUnits(back);
  check('the parts survive the round trip and are named <block>:<element>',
    units.map((u) => u.block.id).join() === ['calc', 'draw', 'charge'].map((e) => sigilPartId(block.id, e)).join()
      && parseSigilCalc(units[0].block).intention === 'Geheime Absicht' && sigilImage(units[1].block) === `${'ab'.repeat(32)}.png`,
    units.map((u) => u.block));

  const before = sigilState(back, '2029-12-31');
  check('a loaded charge as a part hides and locks the parts, locks the entry',
    before.concealed.has(sigilPartId(block.id, 'calc')) && before.concealed.has(sigilPartId(block.id, 'draw'))
      && before.lockEntry && before.revealDate === '2030-01-01', before);
  const content = serializeBlocks(back);
  const hidden = withoutConcealed(content, '2029-12-31');
  check('search and .emerald do not see hidden parts — the rest of the block stays',
    !hidden.includes('Geheime') && !hidden.includes('abab') && hidden.includes('Notiz')
      && parseBlocks(hidden).length === 2 && sigilUnits(parseBlocks(hidden)).length === 3, hidden);
  check('after the target date everything is there', withoutConcealed(content, '2030-01-02') === content);

  const exportText = {
    title: (b) => `T:${b.type}`, date: (iso) => `D:${iso}`, number: String, targetDate: 'Ziel', technique: 'Technik',
    loaded: 'Geladen', notLoaded: 'Offen', drawing: 'Zeichnung', fields: text,
  };
  const out = renderBlocksForExport(content, exportText, '2029-12-31');
  check('export: hidden parts are missing, the charge is included as a part',
    !out.includes('Geheime') && !out.includes('<img') && out.includes('<dt>Ladung</dt>') && out.includes('Geladen'), out);
  const revealed = renderBlocksForExport(content, exportText, '2030-02-01');
  check('export after the date: calculator and drawing as parts',
    revealed.includes('Geheime Absicht') && revealed.includes('alt="Zeichnung"'), revealed);

  const unloaded = serializeBlocks([createTextBlock('<p>Notiz</p>'), setPart(block, 'charge', (p) => serializeSigilCharge(p, { ...parseSigilCharge(p), loaded: false }))]);
  const afterUnload = sigilState(parseBlocks(unloaded), '2029-12-31');
  check('unloading the part conceals nothing any more', afterUnload.concealed.size === 0 && !afterUnload.lockEntry, afterUnload);

  const standaloneCharge = serializeSigilCharge(createSigilChargeBlock(), {
    loaded: true, revealDate: null, lock: 'sigil', technique: null, targets: [sigilPartId(block.id, 'draw')],
  });
  const mixed = sigilState([...parseBlocks(unloaded), standaloneCharge], '2029-12-31');
  check('a charge block can conceal a part specifically (target <block>:<element>)',
    mixed.concealed.has(sigilPartId(block.id, 'draw')) && !mixed.concealed.has(sigilPartId(block.id, 'calc'))
      && parseSigilCharge(parseBlocks(serializeBlocks([standaloneCharge]))[0]).targets?.[0] === sigilPartId(block.id, 'draw'), mixed);

  const summary = entryBlockSummary('sigil-part', content, '2029-12-31');
  check('the summary knows the sigil in the part (lock, no card image while hidden)',
    summary.sigil?.lockEntry === true && summary.sigil.image === null
      && entryBlockSummary('sigil-part-2', content, '2030-02-01').sigil?.image === `${'ab'.repeat(32)}.png`, summary.sigil);
  const dupId = 'dup-block';
  const targeted = setPart(parseBlocks(unloaded)[1], 'charge', (p) => serializeSigilCharge(p, {
    ...parseSigilCharge(p), targets: [sigilPartId(block.id, 'calc'), 'fremd-block'],
  }));
  const dup = withRenamedPartTargets({ ...targeted, id: dupId }, block.id, dupId);
  const dupCharge = sigilUnits([dup]).find((u) => u.block.type === 'core.sigil.charge');
  check('a duplicated block targets its own parts with its charge',
    parseSigilCharge(dupCharge.block).targets.join() === `${dupId}:calc,fremd-block`, parseSigilCharge(dupCharge.block));

  const oddlyEncoded = content.replace(/&quot;/g, '&#34;');
  check('differently encoded content hides its parts all the same',
    !withoutConcealed(oddlyEncoded, '2029-12-31').includes('Geheime'));

  const emptyDrawing = parseFields(instantiateDefinition(def, text));
  check('an empty drawing as a part stays in read mode (saving it outlasts "Done")',
    !isHiddenInRead(emptyDrawing.elements.find((e) => e.id === 'draw'), emptyDrawing));

  const configured = parseDefinitionElements(JSON.stringify([
    { id: 'c', kind: 'sigilCalc', label: '', calcMode: 'auto', brushColor: '#ef4444' },
    { id: 'c2', kind: 'sigilCalc', label: '', calcMode: 'alles' },
    { id: 'd', kind: 'sigilCanvas', label: '', brushColor: '#ef4444', brushSize: 20, calcMode: 'manual' },
    { id: 'd2', kind: 'sigilCanvas', label: '', brushColor: 'red; x', brushSize: 999 },
    { id: 'l', kind: 'sigilCharge', label: '', defaultValue: { lock: 'sigil', targets: ['d', 'd', '__proto__', '<x>', 5] } },
    { id: 'l2', kind: 'sigilCharge', label: '', defaultValue: { lock: 'alles', targets: 'd' } },
  ]));
  const cf = Object.fromEntries(configured.map((e) => [e.id, e]));
  check('settings of the parts: only matching the kind and valid',
    cf.c.calcMode === 'auto' && cf.c.brushColor === undefined && cf.c2.calcMode === undefined
      && cf.d.brushColor === '#ef4444' && cf.d.brushSize === 20 && cf.d.calcMode === undefined
      && cf.d2.brushColor === undefined && cf.d2.brushSize === undefined, configured);
  check('default of the charge: lock and unique, harmless element IDs — otherwise "all"',
    cf.l.defaultValue.lock === 'sigil' && cf.l.defaultValue.targets.join() === 'd'
      && cf.l2.defaultValue.lock === 'entry' && cf.l2.defaultValue.targets === null, [cf.l.defaultValue, cf.l2.defaultValue]);

  const presetDef = { ...def, id: 'def-preset', elements: configured.filter((e) => ['c', 'd', 'l'].includes(e.id)) };
  const presetCopy = instantiateDefinition(presetDef, text);
  const presetCharge = sigilUnits([presetCopy]).find((u) => u.block.type === 'core.sigil.charge');
  const pc = parseSigilCharge(presetCharge.block);
  check('a new copy carries the charge unloaded, with lock and targets on its own parts',
    !pc.loaded && pc.lock === 'sigil' && pc.targets.join() === sigilPartId(presetCopy.id, 'd'), pc);
  const loadedPreset = setPart(presetCopy, 'l', (p) => serializeSigilCharge(p, { ...parseSigilCharge(p), loaded: true }));
  const presetState = sigilState([loadedPreset], '2029-12-31');
  check('when loaded it conceals exactly the given drawing, not the calculator',
    presetState.concealed.has(sigilPartId(presetCopy.id, 'd')) && !presetState.concealed.has(sigilPartId(presetCopy.id, 'c'))
      && !presetState.lockEntry, presetState);
  check('the setup (mode, brush) is carried into the copy, the default is not',
    parseFields(presetCopy).elements.find((e) => e.id === 'c').calcMode === 'auto'
      && parseFields(presetCopy).elements.find((e) => e.id === 'd').brushSize === 20
      && !presetCopy.attrs['data-block-config'].includes('defaultValue'));
}

console.log('\n5. What is derived from the content sees through the blocks\n');
{
  const chip =
    '<span data-type="internalLink" class="internal-link" data-id="11111111-1111-1111-1111-111111111111" ' +
    'data-entry-type="wiki" data-label="A">A</span>';
  const html = serializeBlocks([createTextBlock('<p>ohne</p>'), createTextBlock(`<p>${chip}</p>`)]); // lang-ok
  const links = extractInternalLinks(html);
  check('extractInternalLinks finds chips in wrapped text blocks', links.length === 1 && links[0].entryType === 'wiki', links);
}

console.log('\n6. Templates: assignment, insertion\n');
{
  const assignments = parseAssignments(JSON.stringify([
    { entryType: 'journal', category: 'ritual', isDefault: true },
    { entryType: 'wiki', category: 'ritual' },
    { entryType: 'wiki', category: 'ritual', isDefault: true },
    { entryType: 'wiki', category: 'offered', isDefault: false },
    { entryType: 'wiki', category: null },
    { entryType: 'operation', category: '<x>' },
    { entryType: 'task', category: '*' },
    'kaputt',
  ]));
  check('assignments: journal always "all", duplicates merge, foreign and merely offered ones are dropped',
    JSON.stringify(assignments) === JSON.stringify([
      { entryType: 'journal', category: '*' },
      { entryType: 'wiki', category: 'ritual' },
      { entryType: 'wiki', category: null },
    ]), assignments);
  check('assignments: unreadable JSON yields none', parseAssignments('{kaputt').length === 0);

  const tpl = (id, assignments, content = '') => ({ id, name: id, icon: '', title: '', content, tags: [], assignments, sort_order: 0, created_at: '', updated_at: '', deleted_at: null });
  const exact = tpl('exact', [{ entryType: 'wiki', category: 'ritual' }]);
  const fallback = tpl('fallback', [{ entryType: 'wiki', category: '*' }]);
  const none = tpl('none', [{ entryType: 'wiki', category: null }]);
  const free = tpl('free', []);
  const all = [free, fallback, exact, none];
  check('assigned: the exact combination before "all categories"', resolveAssignedTemplate(all, 'wiki', 'ritual')?.id === 'exact');
  check('assigned: without one of its own, the fallback', resolveAssignedTemplate(all, 'wiki', 'herbs')?.id === 'fallback');
  check('assigned: "no category" is a combination of its own', resolveAssignedTemplate(all, 'wiki', null)?.id === 'none');
  check('assigned: none for another entry type', resolveAssignedTemplate(all, 'journal', null) === null);

  // Insertion: new IDs, charge targets carried along, everything else as it is.
  const calc = createSigilCalcBlock();
  const canvas = withSigilImage(createSigilCanvasBlock(), `${'ef'.repeat(32)}.png`);
  const charge = serializeSigilCharge(createSigilChargeBlock(), {
    loaded: true, revealDate: null, lock: 'entry', technique: null, targets: [canvas.id],
  });
  const sigilTpl = tpl('sigil-tpl', [], serializeBlocks([createTextBlock('<p>Absicht</p>'), calc, canvas, charge]));
  const first = instantiateTemplateBlocks(sigilTpl);
  const second = instantiateTemplateBlocks(sigilTpl);
  const firstCharge = parseSigilCharge(first[3]);
  check('insertion: no block remembers the template', first.every((b) => !b.attrs['data-template-origin']), first.map((b) => b.attrs));
  check('insertion: new block IDs, different ones the second time too',
    first.every((b, i) => b.id !== parseBlocks(sigilTpl.content)[i].id && b.id !== second[i].id));
  check('insertion: the charge targets the new drawing and stays loaded, the drawing comes along',
    firstCharge.loaded && firstCharge.targets.join() === first[2].id && sigilImage(first[2]) === `${'ef'.repeat(32)}.png`, firstCharge);
  const allCharge = serializeSigilCharge(createSigilChargeBlock(), { loaded: true, revealDate: null, lock: 'entry', technique: null, targets: null });
  const appended = withChargesCoveringOnly([calc, allCharge]);
  const appendedCharge = parseSigilCharge(appended[1]);
  check('appended: a charge for "all sigils" covers only the blocks that came with it',
    appendedCharge.loaded && appendedCharge.targets.join() === calc.id, appendedCharge);
  const existing = createSigilCanvasBlock();
  check('appended: the entry\'s own drawing stays visible',
    !sigilState([existing, ...appended], '2029-12-31').concealed.has(existing.id));
  // A charge as part of a custom block targets `<block ID>:<element ID>` — that is carried along too.
  const partText = { label: (el) => el.label || el.kind, yes: 'Ja', no: 'Nein', moonName: (ph) => ph };
  const partDef = {
    id: 'part-def', name: 'Teile', icon: '', sort_order: 0,
    created_at: '', updated_at: '', deleted_at: null,
    display: { readHideEmpty: true, readOnly: false, showTitle: false },
    elements: parseDefinitionElements(JSON.stringify([
      { id: 'draw', kind: 'sigilCanvas', label: '' },
      { id: 'load', kind: 'sigilCharge', label: '', defaultValue: { lock: 'entry', targets: ['draw'] } },
    ])),
  };
  const partCopy = instantiateDefinition(partDef, partText);
  const [partBlock] = instantiateTemplateBlocks(tpl('part-tpl', [], serializeBlocks([partCopy])));
  const partCharge = parseSigilCharge(sigilUnits([partBlock]).find((u) => u.block.type === 'core.sigil.charge').block);
  check('insertion: a charge as a part targets the part in the new block',
    partBlock.id !== partCopy.id && partCharge.targets.join() === sigilPartId(partBlock.id, 'draw'), partCharge);

  // Title and tags when undoing a template.
  const journalStd = { ...sigilTpl, id: 'journal-std', title: 'Tagebuch', tags: ['tag-j'], assignments: [{ entryType: 'journal', category: '*' }] };

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

  check('empty: no content', isContentEmpty(''));
  check('empty: only empty paragraphs', isContentEmpty('<p></p><p style="text-align: center"><br></p>'));
  check('not empty: text', !isContentEmpty('<p>x</p>'));
  check('not empty: an image', !isContentEmpty(`<p><img src="${'a'.repeat(64)}.png"></p>`));
  check('not empty: a field block', !isContentEmpty(serializeBlocks([createFieldsBlock('shorttext')])));

  const start = templateStart({ ...sigilTpl, title: '  Ritual ', tags: ['a'] });
  check('start from template: title trimmed, tags copied, content inserted',
    start.title === 'Ritual' && start.tags.join() === 'a' && parseBlocks(start.content).length === 4, start);
  check('start without template: empty, the title too',
    JSON.stringify(templateStart(null)) === JSON.stringify({ title: '', content: '', tags: [], templateId: null }));
  check('merge tags without duplicate IDs', mergeTemplateTags(['a', 'b'], ['a', 'c']).join() === 'a,b,c');

  check('assigned exactly here, without fallback',
    assignedTemplateAt(all, 'wiki', 'herbs') === undefined && assignedTemplateAt(all, 'wiki', '*')?.id === 'fallback');
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
  check('"Images" below an altar start with the tag "Altar Library", a canvas\'s with all',
    altar.stripTag === 'altar-library' && parsed.stripTag === '', [altar.stripTag, parsed.stripTag]);
  const allTags = withCanvasStripTag(createCanvasBlock(ALTAR_BLOCK_TYPE), '');
  const otherTag = withCanvasParts(withCanvasStripTag(allTags, 'venus'), { ...altar.parts, shapes: false });
  check('the strip\'s tag is kept: cleared stays cleared, another one survives a change of parts',
    parseCanvasBlock(allTags).stripTag === '' && parseCanvasBlock(otherTag).stripTag === 'venus'
      && !parseCanvasBlock(otherTag).parts.shapes, parseCanvasBlock(otherTag));
  check('a foreign tag value counts as none set',
    parseCanvasBlock({ ...allTags, attrs: { ...allTags.attrs, 'data-block-config': JSON.stringify({ tag: '<x>' }) } }).stripTag === 'altar-library');

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

  const exported = renderBlocksForExport(serializeBlocks([full]), { title: () => 'Canvas' });
  check('the export shows the rendered picture', exported.includes(render) && !exported.includes(`src="${pic}"`), exported);
}

console.log('');

if (failures.length) {
  console.error(`${failures.length} check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('All checks passed.\n');
