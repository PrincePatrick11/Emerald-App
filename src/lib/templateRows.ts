import type Database from './sqlite';
import type { TFunction } from 'i18next';
import { nowIso } from './helpers';
import { fromRow, type DbRow } from './row';
import { readContents, replaceOwnerBlocks } from './blockStore';
import { ALTAR_CATEGORY_ID, SIGIL_CATEGORY_ID } from './schema';
import { serializeBlocks } from './blocks/blockHtml';
import { translatedOr } from './blocks/blockAttrs';
import { sigilBlockSet } from './blocks/sigil';
import { altarBlockSet } from './blocks/canvas';
import { ALTAR_TEMPLATE_ID, SIGIL_TEMPLATE_ID, templateToRow, type Template } from './blocks/templates';

/**
 * The accesses to `templates` that store, fresh vaults and imports share.
 * Here instead of in the store, because `lib/` modules may not import a store — the same pattern as `blockDefinitionRows`.
 */

/** The next free position at the end of the list — also behind templates in the trash. */
export async function nextTemplateSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM templates');
  return rows[0]?.n ?? 0;
}

/** The INSERT of a template row, without its blocks — for a batch that writes them along (`templateStore`). */
export function insertTemplateStatement(template: Template): readonly [string, unknown[]] {
  const row = templateToRow(template);
  return [
    `INSERT INTO templates
       (id, name, icon, title, tags, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.id, row.name, row.icon, row.title, row.tags,
      row.sort_order, row.created_at, row.updated_at, row.deleted_at,
    ],
  ];
}

/** A template with its block stack — for the seeds of a fresh vault. */
export async function insertTemplateRow(db: Database, template: Template): Promise<void> {
  const blocks = replaceOwnerBlocks({ kind: 'template', id: template.id }, template.content, template.updated_at, { hasRows: false });
  await db.batch([insertTemplateStatement(template), ...blocks.statements]);
  blocks.commit();
}

/** A template by ID — also from the trash, unlike the store, which holds only the active ones; its blocks from their rows. */
export async function templateById(db: Database, id: string): Promise<Template | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM templates WHERE id=$1', [id]);
  if (!row) return undefined;
  const template = fromRow.template(row);
  return { ...template, content: (await readContents(db, 'template', [id])).get(id) ?? '' };
}

/**
 * The built-in "Sigil" template: calculator, drawing and charge, the start
 * template of the "Sigils" category.
 * The name ends up permanently in the row; if i18n is not ready yet, English.
 */
function sigilTemplate(t: TFunction, now: string, sortOrder: number): Template {
  return {
    id: SIGIL_TEMPLATE_ID,
    name: translatedOr(t, 'templates.builtin.sigil', 'Sigil'),
    icon: '🔯',
    title: '',
    content: serializeBlocks(sigilBlockSet()),
    tags: [],
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/** Makes the template the start template of the category — if the category exists and has none yet. */
async function startCategoryWith(db: Database, categoryId: string, templateId: string): Promise<void> {
  await db.execute('UPDATE categories SET template_id=$1 WHERE id=$2 AND template_id IS NULL', [templateId, categoryId]);
}

/**
 * Creates the sigil template if it does not yet exist (including in the trash)
 * — for fresh vaults — and makes it the start template of "Sigils".
 */
export async function seedSigilTemplate(db: Database, t: TFunction): Promise<void> {
  if (await templateById(db, SIGIL_TEMPLATE_ID)) return;
  await insertTemplateRow(db, sigilTemplate(t, nowIso(), await nextTemplateSortOrder(db)));
  await startCategoryWith(db, SIGIL_CATEGORY_ID, SIGIL_TEMPLATE_ID);
}

/**
 * Creates the built-in "Altar" template if it does not yet exist (including
 * in the trash) — for fresh vaults: an altar and a text for
 * notes, the start template of the "Altars" category.
 */
export async function seedAltarTemplate(db: Database, t: TFunction): Promise<void> {
  if (await templateById(db, ALTAR_TEMPLATE_ID)) return;
  const now = nowIso();
  await insertTemplateRow(db, {
    id: ALTAR_TEMPLATE_ID,
    name: translatedOr(t, 'templates.builtin.altar', 'Altar'),
    icon: '🪔',
    title: '',
    content: serializeBlocks(altarBlockSet()),
    tags: [],
    sort_order: await nextTemplateSortOrder(db),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  await startCategoryWith(db, ALTAR_CATEGORY_ID, ALTAR_TEMPLATE_ID);
}
