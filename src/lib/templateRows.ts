import type Database from '@tauri-apps/plugin-sql';
import type { TFunction } from 'i18next';
import { nowIso } from './helpers';
import { fromRow, type DbRow } from './row';
import { SIGIL_CATEGORY_ID } from './schema';
import { serializeBlocks } from './blocks/blockHtml';
import { translatedOr } from './blocks/blockAttrs';
import { sigilBlockSet } from './blocks/sigil';
import { SIGIL_TEMPLATE_ID, templateToRow, type Template } from './blocks/templates';

/**
 * Die Zugriffe auf `templates`, die Store, Migration, frische Vaults und
 * Importe teilen. Hier statt im Store, weil Migrationen und `lib/`-Module
 * keinen Store importieren dürfen — dasselbe Muster wie `blockDefinitionRows`.
 */

/** Der nächste freie Platz am Ende der Liste — auch hinter Vorlagen im Papierkorb. */
export async function nextTemplateSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM templates');
  return rows[0]?.n ?? 0;
}

export async function insertTemplateRow(db: Database, template: Template): Promise<void> {
  const row = templateToRow(template);
  await db.execute(
    `INSERT INTO templates
       (id, name, icon, description, title, content, tags, assignments, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      row.id, row.name, row.icon, row.description, row.title, row.content, row.tags, row.assignments,
      row.sort_order, row.created_at, row.updated_at, row.deleted_at,
    ]
  );
}

/** Eine Vorlage nach ID — auch aus dem Papierkorb, anders als der Store, der nur die aktiven hält. */
export async function templateById(db: Database, id: string): Promise<Template | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM templates WHERE id=$1', [id]);
  return row ? fromRow.template(row) : undefined;
}

/**
 * Die eingebaute Vorlage „Sigille": Rechner, Zeichnung und Ladung, Standard
 * für Operationen der Kategorie „Sigillen" — was bis v42 fest verdrahtet war.
 * Der Name landet fest in der Zeile; ist i18n noch nicht bereit, Englisch.
 */
function sigilTemplate(t: TFunction, now: string, sortOrder: number): Omit<Template, 'assignments'> {
  return {
    id: SIGIL_TEMPLATE_ID,
    name: translatedOr(t, 'templates.builtin.sigil', 'Sigil'),
    icon: '🔯',
    description: '',
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
 * Legt die Sigillen-Vorlage an, falls es sie (auch im Papierkorb) noch nicht
 * gibt — für frische Vaults und Migration v43. Ohne die Kategorie „Sigillen"
 * (nur eine präparierte Datenbank) bleibt sie ohne Zuweisung.
 */
export async function seedSigilTemplate(db: Database, t: TFunction): Promise<void> {
  if (await templateById(db, SIGIL_TEMPLATE_ID)) return;
  const [category] = await db.select<{ id: string }[]>('SELECT id FROM categories WHERE id=$1', [SIGIL_CATEGORY_ID]);
  await insertTemplateRow(db, {
    ...sigilTemplate(t, nowIso(), await nextTemplateSortOrder(db)),
    assignments: category ? [{ entryType: 'operation', category: SIGIL_CATEGORY_ID, isDefault: true }] : [],
  });
}
