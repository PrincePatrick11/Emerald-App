/**
 * Writes files of older app versions (`tools/mcp/seed/imports/`): two backups
 * and two `.emerald` files from before the block rebuild, with the sigil
 * blocks of v42–v63 and altars both as tables (before v62) and as operations
 * (v62/v63). Since the fresh start of the schema the app refuses them, and
 * that is what they are for: `npm run check:schema` checks that the backups
 * are refused, `qacheck` that all four come back as a notice and change
 * nothing.

 *
 * Plain JSON: an `.emeralddb` without the sealed container is still read.
 * Deterministic — run it again after changing it and commit the result:
 *
 *   node tools/mcp/seed/build_import_fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'imports');

/* ---------------- Pictures: small solid PNGs ---------------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A `size`×`size` PNG in one colour, as a data URL. */
function png([r, g, b], size = 48) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

/** The names the files knew the pictures by — stored names, so the import remaps them. */
const IMG = {
  journal: `${'1a'.repeat(32)}.png`,
  sigil: `${'2b'.repeat(32)}.png`,
  altar: `${'3c'.repeat(32)}.png`,
  template: `${'4d'.repeat(32)}.png`,
  item: `${'5e'.repeat(32)}.png`,
};
const DATA = {
  [IMG.journal]: png([46, 160, 90]),
  [IMG.sigil]: png([131, 71, 255]),
  [IMG.altar]: png([220, 150, 40]),
  [IMG.template]: png([40, 120, 220]),
  [IMG.item]: png([200, 60, 60]),
};
const images = (...names) => Object.fromEntries(names.map((n) => [n, DATA[n]]));

/* ---------------- Markup of the old block types ---------------- */

const AT = '2026-10-20T10:00:00.000Z';
const enc = (value) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const section = (type, id, inner = '', attrs = {}) =>
  `<section data-block="${type}" data-block-id="${id}"${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${inner}</section>`;
const text = (id, inner) => section('core.text', id, inner);
const chip = (id, entryType, label) =>
  `<span data-type="internalLink" class="internal-link" data-id="${id}" data-entry-type="${entryType}" data-label="${label}">${label}</span>`;

/** The three sigil blocks as v42–v63 wrote them: a calculator, the drawing, a charge hiding the drawing until 2099. */
function legacySigils(prefix, intention, picture) {
  return section('core.sigil.calc', `${prefix}-calc`, `<p>${intention}</p><p>${intention.toUpperCase().replace(/[^A-Z]/g, '')}</p>`,
    { 'data-block-data': enc({ intention, letters: intention.toUpperCase().replace(/[^A-Z]/g, '').split(''), implemented: [] }) })
    + section('core.sigil.canvas', `${prefix}-draw`, `<img src="${picture}" alt="">`)
    + section('core.sigil.charge', `${prefix}-charge`, '<p>2099-01-01</p>',
      { 'data-block-data': enc({ loaded: true, revealDate: '2099-01-01', lock: 'sigil', targets: [`${prefix}-calc`, `${prefix}-draw`] }) });
}

/** An altar as v62 made it: an altar block (a canvas scene) with one picture, and a text for notes. */
function altarBlocks(prefix, picture) {
  const scene = {
    width: 1600, height: 1000,
    elements: [{
      id: `${prefix}-p1`, type: 'image', x: 600, y: 300, width: 400, height: 400, rotation: 0, opacity: 1,
      locked: false, hidden: false, z: 1, ref: picture, props: { src: picture, emoji: '' },
    }],
    background: { fill: { kind: 'radial', colors: ['#1e1e3c', '#0f0f1e', '#0a0a0f'], cx: 0.5, cy: 0.25 }, image: null, tint: null },
    guides: [], guidesLocked: false,
  };
  return section('core.altar', `${prefix}-altar`, `<img src="${picture}" alt="" data-canvas="image">`, { 'data-block-data': enc(scene) })
    + text(`${prefix}-notes`, '<p>Notizen zum Altar</p>'); // lang-ok
}

/* ---------------- IDs ---------------- */

const ID = {
  wiki: '0f1e2d3c-0000-4000-8000-000000000001',
  journal: '0f1e2d3c-0000-4000-8000-000000000002',
  sigilOp: '0f1e2d3c-0000-4000-8000-000000000003',
  altarOp: '0f1e2d3c-0000-4000-8000-000000000004',
  template: '0f1e2d3c-0000-4000-8000-000000000005',
  task: '0f1e2d3c-0000-4000-8000-000000000006',
  taskLink: '0f1e2d3c-0000-4000-8000-000000000007',
  tag: '0f1e2d3c-0000-4000-8000-000000000008',
  category: '0f1e2d3c-0000-4000-8000-000000000009',
  // The file of before v62: an altar, its picture item and the placement.
  altar: '0f1e2d3c-0000-4000-8000-000000000010',
  item: '0f1e2d3c-0000-4000-8000-000000000011',
  placement: '0f1e2d3c-0000-4000-8000-000000000012',
  journal12: '0f1e2d3c-0000-4000-8000-000000000013',
};

const entry = (row) => ({
  category_id: null, entry_number: 1, icon: null, cover_image: null, tags: '[]', created_at: AT, updated_at: AT, deleted_at: null, ...row,
});

/* ---------------- Backup '13' of v63: sigil blocks, altar as an operation ---------------- */

const backup13 = {
  version: '13',
  type: 'backup',
  exportedAt: AT,
  filters: {
    includeJournal: true, includeWiki: true, includeOperations: true, includeTasks: true, includeTags: true,
    includeLexicon: false, dateFrom: '', dateTo: '', includeDeleted: true,
  },
  data: {
    entries: [
      entry({ id: ID.wiki, type: 'wiki', title: 'Fixture: Zielartikel', category_id: ID.category, content: text('fx-w1', '<p>Ziel der Links</p>') }), // lang-ok
      entry({
        id: ID.journal, type: 'journal', title: 'Fixture: Tagebuch mit Link und Bild', tags: JSON.stringify([ID.tag]), // lang-ok
        content: text('fx-j1', `<p>Siehe ${chip(ID.wiki, 'wiki', 'Fixture: Zielartikel')} und ${chip(ID.altarOp, 'operation', 'Fixture: Altar')}</p><img src="${IMG.journal}">`), // lang-ok
      }),
      entry({
        id: ID.sigilOp, type: 'operation', title: 'Fixture: Siegel', category_id: 'sigils', // lang-ok
        content: legacySigils('fx-s', 'Klarheit', IMG.sigil) + text('fx-s-notes', `<p>Technik: ${chip(ID.wiki, 'wiki', 'Fixture: Zielartikel')}</p>`), // lang-ok
      }),
      entry({ id: ID.altarOp, type: 'operation', title: 'Fixture: Altar', category_id: 'altars', entry_number: 2, icon: '🕯️', content: altarBlocks('fx-a', IMG.altar) }),
    ],
    tags: [{ id: ID.tag, name: 'Fixture', color: '#2ea05a', deleted_at: null }],
    tasks: [{ id: ID.task, title: 'Fixture: Aufgabe', category_id: null, parent_task_id: null, priority: 'medium', completed: 0, sort_order: 0, created_at: AT, updated_at: AT, deleted_at: null }], // lang-ok
    taskLinks: [{ id: ID.taskLink, task_id: ID.task, target_id: ID.altarOp, target_type: 'operation' }],
    categories: [
      { id: 'sigils', name: 'Sigils', emoji: '🔮', sort_order: 0, is_builtin: 1, deleted_at: null },
      { id: 'altars', name: 'Altars', emoji: '🕯️', sort_order: 1, is_builtin: 1, deleted_at: null },
      { id: ID.category, name: 'Fixture', emoji: '🧪', sort_order: 2, is_builtin: 0, deleted_at: null },
    ],
    blockDefinitions: [],
    templates: [{
      id: ID.template, name: 'Fixture: Vorlage mit Siegel', icon: '📄', title: '', tags: '[]', assignments: '[]', sort_order: 9, // lang-ok
      content: legacySigils('fx-t', 'Vorlage', IMG.template), created_at: AT, updated_at: AT, deleted_at: null, // lang-ok
    }],
  },
  images: images(IMG.journal, IMG.sigil, IMG.altar, IMG.template),
};

/* ---------------- Backup '12' of before v62: the altar tables ---------------- */

const backup12 = {
  version: '12',
  type: 'backup',
  exportedAt: AT,
  filters: backup13.filters,
  data: {
    entries: [entry({
      id: ID.journal12, type: 'journal', title: 'Fixture: Tagebuch zum alten Altar', // lang-ok
      content: text('fx-j12', `<p>Am ${chip(ID.altar, 'altar', 'Fixture: Alter Altar')}</p>`), // lang-ok
    })],
    tags: [],
    tasks: [],
    taskLinks: [],
    categories: [],
    blockDefinitions: [],
    templates: [],
    altars: [{
      id: ID.altar, title: 'Fixture: Alter Altar', // lang-ok
      settings: JSON.stringify({ background_preset: 'night', resolution: '1920x1080' }),
      background_image_data: null, icon_data: '🕯️', created_at: AT, updated_at: AT, deleted_at: null,
    }],
    altarItems: [{ id: ID.item, name: 'Fixture: Kerze', emoji: '🕯️', category_id: null, note: 'aus dem alten Altar', image_data: IMG.item, created_at: AT, updated_at: AT, deleted_at: null }], // lang-ok
    altarPlacements: [{ id: ID.placement, altar_id: ID.altar, item_id: ID.item, x: 50, y: 50, width: 30, height: 30, z_index: 1, rotation: 0, opacity: 1, locked: 0, hidden: 0 }],
  },
  images: images(IMG.item),
};

/* ---------------- .emerald files ---------------- */

const entryFile = {
  version: '2',
  type: 'operations',
  title: 'Fixture: Siegel aus .emerald', // lang-ok
  createdAt: AT,
  content: legacySigils('fx-e', 'Mut', IMG.sigil) + text('fx-e-notes', `<p>Bild:</p><img src="${IMG.journal}">`), // lang-ok
  images: images(IMG.sigil, IMG.journal),
  meta: { categoryName: 'Sigils', categoryEmoji: '🔮', tags: ['Fixture'] },
};

const altarFile = {
  version: '1',
  type: 'altar',
  title: 'Fixture: Altar aus .emerald', // lang-ok
  createdAt: AT,
  content: '',
  images: {},
  meta: {
    altarBackgroundPreset: 'night',
    altarResolution: '1920x1080',
    altarIconData: '🕯️',
    altarItems: [{ id: 'item-1', name: 'Fixture: Schale', emoji: '🥣', category: '', note: '', imageData: DATA[IMG.item], createdAt: AT }], // lang-ok
    altarPlacements: [{ itemId: 'item-1', x: 40, y: 40, z_index: 1, width: 25, height: 25, rotation: 0, opacity: 1, locked: false, hidden: false }],
  },
};

mkdirSync(outDir, { recursive: true });
const write = (name, value) => writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
write('backup-v13-pre-rebuild.emeralddb', backup13);
write('backup-v12-altars.emeralddb', backup12);
write('entry-v2-sigils.emerald', entryFile);
write('altar-v1.emerald', altarFile);
console.log(`import fixtures written to ${outDir}`);
