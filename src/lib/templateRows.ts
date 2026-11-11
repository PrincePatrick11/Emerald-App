import type Database from './sqlite';
import type { TFunction } from 'i18next';
import { nowIso } from './helpers';
import { fromRow, type DbRow } from './row';
import { ALTAR_CATEGORY_ID, SIGIL_CATEGORY_ID } from './schema';
import { serializeBlocks } from './blocks/blockHtml';
import { translatedOr } from './blocks/blockAttrs';
import { sigilBlockSet } from './blocks/sigil';
import { altarBlockSet } from './blocks/canvas';
import { ALTAR_TEMPLATE_ID, SIGIL_TEMPLATE_ID, templateToRow, type Template } from './blocks/templates';

/**
 * The accesses to `templates` that store, migration, fresh vaults and
 * imports share. Here instead of in the store, because migrations and `lib/` modules
 * may not import a store — the same pattern as `blockDefinitionRows`.
 */

/** The next free position at the end of the list — also behind templates in the trash. */
export async function nextTemplateSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM templates');
  return rows[0]?.n ?? 0;
}

export async function insertTemplateRow(db: Database, template: Template): Promise<void> {
  const row = templateToRow(template);
  await db.execute(
    `INSERT INTO templates
       (id, name, icon, title, content, tags, assignments, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.id, row.name, row.icon, row.title, row.content, row.tags, row.assignments,
      row.sort_order, row.created_at, row.updated_at, row.deleted_at,
    ]
  );
}

/** A template by ID — also from the trash, unlike the store, which holds only the active ones. */
export async function templateById(db: Database, id: string): Promise<Template | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM templates WHERE id=$1', [id]);
  return row ? fromRow.template(row) : undefined;
}

/**
 * The built-in "Sigil" template: calculator, drawing and charge, default
 * for operations of the "Sigils" category — what was hard-wired up to v42.
 * The name ends up permanently in the row; if i18n is not ready yet, English.
 */
function sigilTemplate(t: TFunction, now: string, sortOrder: number): Omit<Template, 'assignments'> {
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

/**
 * Creates the sigil template if it does not yet exist (including in the trash)
 * — for fresh vaults and migration v43. Without the "Sigils" category
 * (only a doctored database) it stays without an assignment.
 */
export async function seedSigilTemplate(db: Database, t: TFunction): Promise<void> {
  if (await templateById(db, SIGIL_TEMPLATE_ID)) return;
  const [category] = await db.select<{ id: string }[]>('SELECT id FROM categories WHERE id=$1', [SIGIL_CATEGORY_ID]);
  await insertTemplateRow(db, {
    ...sigilTemplate(t, nowIso(), await nextTemplateSortOrder(db)),
    assignments: category ? [{ entryType: 'operation', category: SIGIL_CATEGORY_ID }] : [],
  });
}

/**
 * Creates the built-in "Altar" template if it does not yet exist (including
 * in the trash) — for fresh vaults and migration v61: an altar and a text for
 * notes, default for operations of the "Altars" category.
 */
export async function seedAltarTemplate(db: Database, t: TFunction): Promise<void> {
  if (await templateById(db, ALTAR_TEMPLATE_ID)) return;
  const [category] = await db.select<{ id: string }[]>('SELECT id FROM categories WHERE id=$1', [ALTAR_CATEGORY_ID]);
  const now = nowIso();
  await insertTemplateRow(db, {
    id: ALTAR_TEMPLATE_ID,
    name: translatedOr(t, 'templates.builtin.altar', 'Altar'),
    icon: '🛐',
    title: '',
    content: serializeBlocks(altarBlockSet()),
    tags: [],
    sort_order: await nextTemplateSortOrder(db),
    created_at: now,
    updated_at: now,
    deleted_at: null,
    assignments: category ? [{ entryType: 'operation', category: ALTAR_CATEGORY_ID }] : [],
  });
}
