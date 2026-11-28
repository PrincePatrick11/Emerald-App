import type Database from './sqlite';
import type { TFunction } from 'i18next';
import { nowIso } from './helpers';
import { fromRow, type DbRow } from './row';
import { readContents, replaceOwnerBlocks } from './blockStore';
import {
  ALTAR_CATEGORY_ID, CRYSTALS_CATEGORY_ID, DEITIES_CATEGORY_ID, DREAMS_CATEGORY_ID, JOURNAL_CATEGORY_ID, RITUAL_CATEGORY_ID, SIGIL_CATEGORY_ID,
} from './schema';
import { createTextBlock, serializeBlocks } from './blocks/blockHtml';
import { createNamedFieldsBlock } from './blocks/fields';
import { translatedOr } from './blocks/toolkit';
import { createSigilBlock } from './blocks/sigil';
import { altarBlockSet } from './blocks/canvas';
import { createMoonBlock, moonBlockSet } from './blocks/moon';
import {
  ALTAR_TEMPLATE_ID, CRYSTALS_TEMPLATE_ID, DEITIES_TEMPLATE_ID, DREAMS_TEMPLATE_ID, JOURNAL_TEMPLATE_ID, RITUAL_TEMPLATE_ID, SIGIL_TEMPLATE_ID,
  templateToRow, type Template,
} from './blocks/templates';
import { readTags, tagStatements } from './tagRefs';
import type { BlockInstance } from './blocks/types';

/**
 * The accesses to `templates` that store, fresh vaults and imports share.
 * Here instead of in the store, because `lib/` modules may not import a store — the same pattern as `blockDefinitionRows`.
 */

/** The next free position at the end of the list — also behind templates in the trash. */
export async function nextTemplateSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM templates');
  return rows[0]?.n ?? 0;
}

/**
 * The INSERT of a template row and its tag links, without its blocks — for a
 * batch that writes them along (`templateStore`).
 */
export function insertTemplateStatements(template: Template): [string, unknown[]][] {
  const row = templateToRow(template);
  return [
    [
      `INSERT INTO templates
         (id, name, icon, title, sort_order, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.id, row.name, row.icon, row.title,
        row.sort_order, row.created_at, row.updated_at, row.deleted_at,
      ],
    ],
    ...tagStatements('template', template.id, template.tags),
  ];
}

/** A template with its block stack — for the seeds of a fresh vault. */
async function insertTemplateRow(db: Database, template: Template): Promise<void> {
  const blocks = replaceOwnerBlocks({ kind: 'template', id: template.id }, template.content, template.updated_at, { hasRows: false });
  await db.batch([...insertTemplateStatements(template), ...blocks.statements]);
  blocks.commit();
}

/** A template by ID — also from the trash, unlike the store, which holds only the active ones; its blocks from their rows. */
async function templateById(db: Database, id: string): Promise<Template | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM templates WHERE id=$1', [id]);
  if (!row) return undefined;
  const template = fromRow.template({ ...row, tags: await readTags(db, 'template', id) });
  return { ...template, content: (await readContents(db, 'template', [id])).get(id) ?? '' };
}

/** Makes the template the start template of the category — if the category exists and has none yet. */
async function startCategoryWith(db: Database, categoryId: string, templateId: string): Promise<void> {
  await db.execute('UPDATE categories SET template_id=$1 WHERE id=$2 AND template_id IS NULL', [templateId, categoryId]);
}

/** A field's name in the app language, or `fallback` if i18n is not ready yet. */
type FieldLabeler = (key: string, fallback: string) => string;

/** A built-in template: what it is called and starts with, and the category it starts. */
interface BuiltinTemplate {
  id: string;
  /** Text key of its name; the name ends up permanently in the row — if i18n is not ready yet, `fallback`. */
  nameKey: string;
  fallback: string;
  icon: string;
  /** Its blocks; the names of its fields end up in the row like its own name. */
  blocks: (label: FieldLabeler) => BlockInstance[];
  categoryId: string;
}

/** A field of a built-in template: its kind, and its name under `templates.fields.<key>`. */
type FieldSpec = readonly [kind: string, key: string, fallback: string];

/** One field block with the named fields, in their order. */
function namedFields(label: FieldLabeler, specs: readonly FieldSpec[]): BlockInstance {
  return createNamedFieldsBlock(specs.map(([kind, key, fallback]) => ({ kind, label: label(`templates.fields.${key}`, fallback) })));
}

/**
 * The built-in templates, each the start template of its category and
 * otherwise an ordinary row — editable, deletable. Their IDs are
 * `BUILTIN_TEMPLATE_IDS`, which a restore into a new vault lets the file's
 * own version replace.
 */
const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  // Moon phase and text.
  { id: JOURNAL_TEMPLATE_ID, nameKey: 'templates.builtin.journal', fallback: 'Journal', icon: '📓', blocks: moonBlockSet, categoryId: JOURNAL_CATEGORY_ID },
  {
    id: DREAMS_TEMPLATE_ID, nameKey: 'templates.builtin.dreams', fallback: 'Dream Journal', icon: '💭', categoryId: DREAMS_CATEGORY_ID,
    blocks: (label) => [createMoonBlock(), namedFields(label, [
      ['text', 'dream', 'Dream'],
      ['shorttext', 'mood', 'Feeling/Mood'],
      ['text', 'interpretation', 'Interpretation'],
    ])],
  },
  // One sigil block with all its parts, and a text for notes.
  { id: SIGIL_TEMPLATE_ID, nameKey: 'templates.builtin.sigil', fallback: 'Sigil', icon: '🔯', blocks: () => [createSigilBlock(), createTextBlock()], categoryId: SIGIL_CATEGORY_ID },
  // An altar and a text for notes.
  { id: ALTAR_TEMPLATE_ID, nameKey: 'templates.builtin.altar', fallback: 'Altar', icon: '🪔', blocks: altarBlockSet, categoryId: ALTAR_CATEGORY_ID },
  {
    id: RITUAL_TEMPLATE_ID, nameKey: 'templates.builtin.ritual', fallback: 'Ritual', icon: '🪄', categoryId: RITUAL_CATEGORY_ID,
    blocks: (label) => [createMoonBlock(), namedFields(label, [
      ['shorttext', 'intention', 'Intention'],
      ['checklist', 'materials', 'Materials'],
      ['text', 'procedure', 'Procedure'],
      ['text', 'outcome', 'Outcome'],
    ])],
  },
  {
    id: DEITIES_TEMPLATE_ID, nameKey: 'templates.builtin.deities', fallback: 'Deity', icon: '✨', categoryId: DEITIES_CATEGORY_ID,
    blocks: (label) => [namedFields(label, [
      ['image', 'image', 'Image'],
      ['shorttext', 'pantheon', 'Pantheon/Tradition'],
      ['shorttext', 'domains', 'Domains'],
      ['shorttext', 'symbols', 'Symbols and offerings'],
    ]), createTextBlock()],
  },
  {
    id: CRYSTALS_TEMPLATE_ID, nameKey: 'templates.builtin.crystals', fallback: 'Crystal', icon: '🔮', categoryId: CRYSTALS_CATEGORY_ID,
    blocks: (label) => [namedFields(label, [
      ['image', 'image', 'Image'],
      ['shorttext', 'colour', 'Colour'],
      ['shorttext', 'effect', 'Effect'],
      ['shorttext', 'element', 'Element/Chakra'],
    ]), createTextBlock()],
  },
];

/**
 * Creates every built-in template that does not yet exist (including in the
 * trash) — for fresh vaults — and makes it the start template of its category.
 */
export async function seedBuiltinTemplates(db: Database, t: TFunction): Promise<void> {
  const label: FieldLabeler = (key, fallback) => translatedOr(t, key, fallback);
  for (const builtin of BUILTIN_TEMPLATES) {
    if (await templateById(db, builtin.id)) continue;
    const now = nowIso();
    await insertTemplateRow(db, {
      id: builtin.id,
      name: translatedOr(t, builtin.nameKey, builtin.fallback),
      icon: builtin.icon,
      title: '',
      content: serializeBlocks(builtin.blocks(label)),
      tags: [],
      sort_order: await nextTemplateSortOrder(db),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    await startCategoryWith(db, builtin.categoryId, builtin.id);
  }
}
